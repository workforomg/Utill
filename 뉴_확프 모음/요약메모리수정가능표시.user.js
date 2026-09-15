// ==UserScript==
// @name         요약메모리 수정가능 표시
// @namespace    https://github.com/workforomg/Utill
// @version      0.5.0
// @updateURL    https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EC%9A%94%EC%95%BD%EB%A9%94%EB%AA%A8%EB%A6%AC%EC%88%98%EC%A0%95%EA%B0%80%EB%8A%A5%ED%91%9C%EC%8B%9C.user.js
// @downloadURL  https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EC%9A%94%EC%95%BD%EB%A9%94%EB%AA%A8%EB%A6%AC%EC%88%98%EC%A0%95%EA%B0%80%EB%8A%A5%ED%91%9C%EC%8B%9C.user.js
// @author       지유지요
// @description  요약메모리 편집이 가능할때 알림 혹은 요약메모리 모달을 표시합니다
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const PREFIX = '[Crack:SummaryMemoryUpdateDisplay]';
  const SETTINGS_KEY = 'crack-summary-memory-update-display-v2';

  const LABEL_AUTO = '요약메모리 자동열기';
  const LABEL_NOTIFY = '요약메모리 알림 창';
  const COMPLETE_TEXT = '요약 메모리 업데이트 완료';

  const settings = readSettings();

  const state = {
    enabled: settings.enabled,
    notificationEnabled: settings.notificationEnabled,

    activeChatId: null,
    routeHref: PAGE.location.href,

    chatRoot: null,
    chatObserver: null,
    bindGeneration: 0,
    bindRetryTimer: 0,
    routeTransitionTimer: 0,
    routeTransitionOldRoot: null,
    routeTransitionOldGroupIds: '',
    sessionVisit: 0,

    seenCompletionKeys: new Set(),
    lastCompletionAt: 0,
    lastCompletionKey: null,

    openInFlight: false,
    lastOpenAt: 0,

    webpackRequire: null,
    menuRetryTimer: 0,
    toastTimer: 0
  };

  function log(...args) {
    console.log(PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(PREFIX, ...args);
  }

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function readSettings() {
    let value = {};
    try {
      value = GM_getValue(SETTINGS_KEY, {}) || {};
    } catch (_) {}

    return {
      enabled: value.enabled !== false,
      notificationEnabled: value.notificationEnabled !== false
    };
  }

  function saveSettings() {
    try {
      GM_setValue(SETTINGS_KEY, {
        enabled: state.enabled,
        notificationEnabled: state.notificationEnabled
      });
    } catch (_) {}
  }

  function setEnabled(value) {
    state.enabled = !!value;
    saveSettings();
    updateAllSwitches();
    syncObservationState();

    showToast(
      `요약메모리 갱신표시: ${state.enabled ? '켜짐' : '꺼짐'}`,
      { force: true }
    );
  }

  function setNotificationEnabled(value) {
    state.notificationEnabled = !!value;
    saveSettings();
    updateAllSwitches();
    syncObservationState();

    showToast(
      `요약메모리 알림 창: ${state.notificationEnabled ? '켜짐' : '꺼짐'}`,
      { force: true }
    );
  }

  function getCurrentChatId() {
    try {
      const url = new URL(PAGE.location.href);

      const queryId =
        url.searchParams.get('chatId') ||
        url.searchParams.get('chat_id');
      if (queryId) return queryId;

      const path = url.pathname;

      // 현재 Crack 라우트:
      // /stories/:storyId/episodes/:chatId
      const episodeMatch = path.match(/\/episodes\/([^/?#]+)/i);
      if (episodeMatch?.[1]) return decodeURIComponent(episodeMatch[1]);

      const genericMatch = path.match(/\/(?:chats?|chat)\/([^/?#]+)/i);
      if (genericMatch?.[1]) return decodeURIComponent(genericMatch[1]);
    } catch (_) {}

    return null;
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const style = PAGE.getComputedStyle?.(element);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const rect = element.getBoundingClientRect?.();
    return !!rect && rect.width > 0 && rect.height > 0;
  }

  // ---------------------------------------------------------------------------
  // 1) 최적화된 실제 갱신 감지
  //
  // Crack 원본은 현재 chat.isSummaryFreeEditable=true 이고 채팅 상태가 IDLE일 때만
  // 현재 메시지 그룹에 "요약 메모리 업데이트 완료"를 렌더링한다.
  //
  // 따라서 별도 API polling / fetch 감시 / 전체 DOM 감시는 필요하지 않다.
  // 현재 메시지 그룹들이 들어있는 좁은 부모 컨테이너 하나만 관찰한다.
  // ---------------------------------------------------------------------------

  function isCompletionMarker(element) {
    if (!element || element.nodeType !== 1) return false;

    // 원본은 span으로 렌더링하지만 클래스명 변경에 덜 민감하게 텍스트도 확인.
    return normalizeText(element.textContent) === COMPLETE_TEXT;
  }

  function getMarkerGroup(marker) {
    return marker?.closest?.('[data-message-group-id]') || null;
  }

  function makeCompletionKey(marker) {
    const chatId = getCurrentChatId();
    if (!chatId) return null;

    const group = getMarkerGroup(marker);
    const groupId =
      group?.getAttribute?.('data-message-group-id') ||
      group?.dataset?.messageGroupId ||
      '';

    // 정상 Crack UI에서는 groupId가 있다.
    // 없는 경우에는 같은 순간의 중복만 막는 fallback key를 쓴다.
    return groupId
      ? `${chatId}|${groupId}`
      : `${chatId}|marker`;
  }

  function collectCompletionMarkers(node) {
    const result = [];

    if (!node) return result;

    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (isCompletionMarker(parent)) result.push(parent);
      return result;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return result;

    const element = node;
    if (isCompletionMarker(element)) result.push(element);

    element.querySelectorAll?.('span').forEach(span => {
      if (isCompletionMarker(span)) result.push(span);
    });

    return result;
  }

  function triggerExistingMarkerOnSessionEntry(root) {
    if (!root) return false;

    // 사용자가 원하는 동작:
    // - 새로고침 시 현재 세션에 "요약 메모리 업데이트 완료"가 이미 있으면 한 번 열기
    // - A → B → A처럼 세션을 다시 들어왔을 때도 그 세션에 표시가 남아 있으면 다시 한 번 열기
    //
    // 따라서 세션 진입 시 기존 marker를 단순히 seen 처리하면 안 된다.
    // 현재 새 세션 DOM이 확정된 뒤 기존 marker를 '진짜 트리거'로 한 번 처리한다.
    const markers = Array.from(root.querySelectorAll('span'))
      .filter(isCompletionMarker);

    if (!markers.length) return false;

    // 원본 Crack 구조상 isSummaryFreeEditable인 현재 턴에만 이 표시가 붙으므로
    // 정상적으로는 하나만 존재한다. 혹시 복수라면 첫 번째 유효 marker만 처리한다.
    for (const marker of markers) {
      if (onCompletionMarker(marker, 'session-entry-existing')) {
        return true;
      }
    }

    return false;
  }

  function onCompletionMarker(marker, source = 'dom') {
    const chatId = getCurrentChatId();
    if (!chatId || chatId !== state.activeChatId) return false;

    const key = makeCompletionKey(marker);
    if (!key || state.seenCompletionKeys.has(key)) return false;

    // React 재렌더로 같은 marker가 한 프레임 안에 여러 번 들어오는 것 방지.
    const now = Date.now();
    if (
      state.lastCompletionKey === key &&
      now - state.lastCompletionAt < 2500
    ) {
      state.seenCompletionKeys.add(key);
      return false;
    }

    state.seenCompletionKeys.add(key);
    state.lastCompletionKey = key;
    state.lastCompletionAt = now;

    log('요약 메모리 업데이트 완료 감지', {
      chatId,
      key,
      source
    });

    // 이 원본 표시는 isSummaryFreeEditable=true + IDLE일 때만 렌더링된다.
    if (state.notificationEnabled) {
      showToast('현재 요약 메모리를 수정 할 수 있어요.');
    }

    if (state.enabled) {
      openSummaryMemoryDirect('update-complete').catch(error => {
        warn('요약 메모리 자동 열기 실패', error);
      });
    }

    return true;
  }

  function handleChatMutations(mutations) {
    if (!state.enabled && !state.notificationEnabled) return;

    for (const mutation of mutations) {
      // text node가 나중에 채워지는 React 렌더도 지원.
      if (mutation.type === 'characterData') {
        const markers = collectCompletionMarkers(mutation.target);
        for (const marker of markers) onCompletionMarker(marker, 'characterData');
        continue;
      }

      for (const node of mutation.addedNodes || []) {
        const markers = collectCompletionMarkers(node);
        for (const marker of markers) onCompletionMarker(marker, 'addedNode');
      }
    }
  }

  function getDirectMessageGroupIds(root) {
    if (!root) return '';

    return Array.from(root.children || [])
      .filter(child => child?.hasAttribute?.('data-message-group-id'))
      .map(child => child.getAttribute('data-message-group-id') || '')
      .filter(Boolean)
      .join('|');
  }

  function isRouteTransitionStillShowingOldMessages(root) {
    if (!state.routeTransitionOldRoot) return false;

    // React가 같은 목록 컨테이너를 재사용하는 경우:
    // 현재 자식 message-group id들이 이전 세션과 같으면 아직 전환 중이다.
    if (root === state.routeTransitionOldRoot) {
      const currentIds = getDirectMessageGroupIds(root);
      return (
        !!state.routeTransitionOldGroupIds &&
        currentIds === state.routeTransitionOldGroupIds
      );
    }

    // 컨테이너 자체가 교체되는 경우에는 새 root가 나온 것이므로 바로 바인딩 가능.
    return false;
  }

  function findChatMessageRoot() {
    // 메시지 그룹은 Crack 원본에서 data-message-group-id를 갖는다.
    const group = document.querySelector('[data-message-group-id]');
    if (!group) return null;

    // 원본은 모든 그룹을 한 부모의 flex-col-reverse 목록으로 렌더링.
    // 클래스명보다 data-message-group-id 형제 구조를 우선 사용한다.
    let parent = group.parentElement;
    while (parent && parent !== document.body) {
      const directGroups = Array.from(parent.children || [])
        .filter(child => child?.hasAttribute?.('data-message-group-id'));

      if (directGroups.length > 0) return parent;
      parent = parent.parentElement;
    }

    return group.parentElement;
  }

  function disconnectChatObserver() {
    state.chatObserver?.disconnect?.();
    state.chatObserver = null;
    state.chatRoot = null;

    clearTimeout(state.bindRetryTimer);
    state.bindRetryTimer = 0;
  }

  function bindChatObserver() {
    const generation = ++state.bindGeneration;

    disconnectChatObserver();

    if (!state.enabled && !state.notificationEnabled) return;

    const startedAt = Date.now();

    const attempt = () => {
      if (generation !== state.bindGeneration) return;

      const currentId = getCurrentChatId();

      if (currentId !== state.activeChatId) {
        handleRouteChange('observer-bind-route-change');
        return;
      }

      const root = findChatMessageRoot();

      if (!root) {
        // 세션/페이지 진입 시에만 잠깐 재탐색. 상시 polling 아님.
        if (Date.now() - startedAt < 12000) {
          state.bindRetryTimer = setTimeout(attempt, 80);
        }
        return;
      }

      // SPA 세션 이동 직후에는 이전 세션 DOM이 잠깐 그대로 남아 있을 수 있다.
      // 그 시점에 이전 root를 잡아버리면 React가 root를 교체한 뒤 Observer가
      // detached DOM에 남게 된다. 메시지 group id가 실제로 바뀐 뒤 바인딩한다.
      if (
        isRouteTransitionStillShowingOldMessages(root) &&
        Date.now() - startedAt < 4000
      ) {
        state.bindRetryTimer = setTimeout(attempt, 50);
        return;
      }

      // 새 세션 DOM이 확정된 시점에, 이미 렌더되어 있는
      // '요약 메모리 업데이트 완료'도 세션 진입 이벤트로 한 번 처리한다.
      //
      // 이 시점까지 이전 세션 message-group id가 사라질 때까지 기다렸기 때문에
      // 이전 세션의 marker를 새 세션 것으로 오인하지 않는다.
      triggerExistingMarkerOnSessionEntry(root);

      const observer = new MutationObserver(mutations => {
        // React가 메시지 목록 root 자체를 교체했다면 현재 observer는 더 이상
        // 유효하지 않다. 다음 microtask에서 현재 세션 root에 다시 연결한다.
        if (!root.isConnected) {
          queueMicrotask(() => {
            if (generation === state.bindGeneration) {
              bindChatObserver();
            }
          });
          return;
        }

        handleChatMutations(mutations);
      });

      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true
      });

      state.chatRoot = root;
      state.chatObserver = observer;

      // 전환 스냅샷은 이제 필요 없음.
      state.routeTransitionOldRoot = null;
      state.routeTransitionOldGroupIds = '';

      log('채팅 메시지 영역 감시 연결', {
        chatId: state.activeChatId,
        messageGroupIds: getDirectMessageGroupIds(root)
      });
    };

    attempt();
  }

  function syncObservationState() {
    if (!state.enabled && !state.notificationEnabled) {
      disconnectChatObserver();
      return;
    }

    if (!state.chatObserver || !state.chatRoot?.isConnected) {
      bindChatObserver();
    }
  }

  function scanCurrentMarkers() {
    const root = state.chatRoot || findChatMessageRoot();
    if (!root) return false;

    let detected = false;
    root.querySelectorAll('span').forEach(span => {
      if (isCompletionMarker(span)) {
        detected = onCompletionMarker(span, 'manual-scan') || detected;
      }
    });

    return detected;
  }

  // ---------------------------------------------------------------------------
  // 2) 사이드바를 열지 않고 원본 요약 메모리 모달 직접 호출
  // ---------------------------------------------------------------------------

  function findSummaryMemoryButton() {
    const candidates = Array.from(
      document.querySelectorAll('button,[role="button"],a')
    ).filter(element => {
      if (element.closest?.('[role="dialog"]')) return false;
      if (element.closest?.('[data-crack-summary-update-toggle]')) return false;

      const text = normalizeText(element.textContent);
      if (!text.includes('요약 메모리')) return false;
      if (text.includes(LABEL_AUTO) || text.includes(LABEL_NOTIFY)) return false;

      return true;
    });

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      // 사이드 메뉴 원본 행처럼 짧은 텍스트를 우선.
      return normalizeText(a.textContent).length - normalizeText(b.textContent).length;
    });

    return candidates[0];
  }

  function getReactOnClick(element) {
    if (!element) return null;

    try {
      const propsKey = Object.keys(element)
        .find(key => key.startsWith('__reactProps$'));

      const handler = propsKey
        ? element[propsKey]?.onClick
        : null;

      return typeof handler === 'function'
        ? handler
        : null;
    } catch (_) {
      return null;
    }
  }

  function invokeSummaryReactOnClick() {
    const button = findSummaryMemoryButton();
    if (!button) return false;

    const handler = getReactOnClick(button);
    if (!handler) return false;

    try {
      handler();
      return true;
    } catch (error) {
      warn('원본 요약 메모리 React onClick 직접 호출 실패', error);
      return false;
    }
  }

  function getWebpackRequire() {
    if (state.webpackRequire) return state.webpackRequire;

    const queue = PAGE.webpackChunk_N_E;
    if (!queue || typeof queue.push !== 'function') return null;

    let runtime = null;

    try {
      const chunkId =
        `csmu_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      queue.push([
        [chunkId],
        {},
        require => {
          runtime = require;
        }
      ]);
    } catch (_) {
      return null;
    }

    if (runtime) state.webpackRequire = runtime;
    return runtime;
  }

  function parseHotkeyValue(value) {
    const result = {
      key: '',
      code: '',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false
    };

    const pieces = [];

    const visit = item => {
      if (item == null) return;

      if (typeof item === 'string') {
        pieces.push(...item.split(/[+\s]+/).filter(Boolean));
        return;
      }

      if (Array.isArray(item)) {
        item.forEach(visit);
        return;
      }

      if (typeof item === 'object') {
        for (const field of [
          'hotkey',
          'shortcut',
          'keys',
          'key',
          'code',
          'combo',
          'combination'
        ]) {
          if (field in item) visit(item[field]);
        }

        if (item.ctrlKey === true || item.ctrl === true || item.control === true) {
          result.ctrlKey = true;
        }
        if (item.altKey === true || item.alt === true || item.option === true) {
          result.altKey = true;
        }
        if (item.shiftKey === true || item.shift === true) {
          result.shiftKey = true;
        }
        if (
          item.metaKey === true ||
          item.meta === true ||
          item.cmd === true ||
          item.command === true
        ) {
          result.metaKey = true;
        }
      }
    };

    visit(value);

    const modifiers = new Set([
      'ctrl',
      'control',
      'alt',
      'option',
      'shift',
      'meta',
      'cmd',
      'command'
    ]);

    for (const rawPiece of pieces) {
      const piece = String(rawPiece);
      const lower = piece.toLowerCase();

      if (lower === 'ctrl' || lower === 'control') {
        result.ctrlKey = true;
      } else if (lower === 'alt' || lower === 'option') {
        result.altKey = true;
      } else if (lower === 'shift') {
        result.shiftKey = true;
      } else if (
        lower === 'meta' ||
        lower === 'cmd' ||
        lower === 'command'
      ) {
        result.metaKey = true;
      } else if (
        !modifiers.has(lower) &&
        !/^toggle[_-]/i.test(piece)
      ) {
        if (/^(Key|Digit|Numpad|Arrow|F\d)/.test(piece)) {
          result.code = piece;
        } else if (!result.key && piece.length <= 16) {
          result.key = piece;
        }
      }
    }

    const keyMap = {
      slash: '/',
      space: ' ',
      comma: ',',
      period: '.',
      dot: '.',
      enter: 'Enter',
      escape: 'Escape',
      esc: 'Escape'
    };

    if (result.key && keyMap[result.key.toLowerCase()]) {
      result.key = keyMap[result.key.toLowerCase()];
    }

    if (!result.key && /^Key[A-Z]$/.test(result.code)) {
      result.key = result.code.slice(3).toLowerCase();
    }

    if (!result.key && /^Digit[0-9]$/.test(result.code)) {
      result.key = result.code.slice(5);
    }

    if (!result.code && /^[a-z]$/i.test(result.key)) {
      result.code = `Key${result.key.toUpperCase()}`;
    }

    if (!result.code && /^[0-9]$/.test(result.key)) {
      result.code = `Digit${result.key}`;
    }

    return result;
  }

  function dispatchNativeSummaryShortcut() {
    try {
      const require = getWebpackRequire();
      if (!require) return false;

      let shortcut = null;

      for (const module of Object.values(require.c || {})) {
        const exports = module?.exports;

        if (exports?.G9?.TOGGLE_HISTORY_MEMORY) {
          shortcut = exports.G9.TOGGLE_HISTORY_MEMORY;
          break;
        }
      }

      if (!shortcut) return false;

      const hotkey = parseHotkeyValue(shortcut);
      if (!hotkey.key && !hotkey.code) return false;

      const KeyboardEventCtor = PAGE.KeyboardEvent || KeyboardEvent;
      const event = new KeyboardEventCtor('keydown', {
        key: hotkey.key || '',
        code: hotkey.code || '',
        ctrlKey: hotkey.ctrlKey,
        altKey: hotkey.altKey,
        shiftKey: hotkey.shiftKey,
        metaKey: hotkey.metaKey,
        bubbles: true,
        cancelable: true,
        composed: true
      });

      (document.body || document.documentElement || document)
        .dispatchEvent(event);

      return true;
    } catch (error) {
      warn('요약 메모리 기본 단축키 직접 호출 실패', error);
      return false;
    }
  }

  function isSummaryModalOpen() {
    return Array.from(
      document.querySelectorAll('[role="dialog"],[data-radix-dialog-content]')
    ).some(dialog => {
      const text = normalizeText(dialog.textContent);

      return (
        text.includes('요약 메모리') ||
        text.includes('채팅 요약과 기억을 확인하고 관리할 수 있어요')
      );
    });
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForSummaryModal(timeoutMs = 900) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (isSummaryModalOpen()) return true;
      await wait(35);
    }

    return isSummaryModalOpen();
  }

  async function openSummaryMemoryDirect(reason = 'manual') {
    if (state.openInFlight) return false;
    if (Date.now() - state.lastOpenAt < 1200) return false;

    const chatId = getCurrentChatId();
    if (!chatId || chatId !== state.activeChatId) return false;

    if (isSummaryModalOpen()) return true;

    state.openInFlight = true;

    try {
      // 사이드바 DOM은 닫혀 있어도 React 트리에 남아 있으므로
      // 실제 onClick을 직접 호출할 수 있으면 그게 가장 정확하다.
      let invoked = invokeSummaryReactOnClick();
      let opened = invoked
        ? await waitForSummaryModal(500)
        : false;

      // DOM 행을 찾지 못한 빌드/타이밍에서는 원본 TOGGLE_HISTORY_MEMORY
      // 단축키를 직접 발생시킨다. 이 역시 사이드바를 열지 않는다.
      if (!opened) {
        invoked = dispatchNativeSummaryShortcut() || invoked;
        opened = invoked
          ? await waitForSummaryModal(800)
          : false;
      }

      if (opened) {
        state.lastOpenAt = Date.now();
        log('요약 메모리 모달 직접 표시', {
          chatId,
          reason
        });
        return true;
      }

      warn('원본 요약 메모리 모달 호출 실패');
      return false;
    } finally {
      state.openInFlight = false;
    }
  }

  // ---------------------------------------------------------------------------
  // 3) 사이드바 설정 토글
  //
  // 전역 MutationObserver를 사용하지 않는다.
  // 사용자가 실제로 사이드 메뉴 버튼을 누른 순간과 라우트 진입 때 몇 번만 찾는다.
  // ---------------------------------------------------------------------------

  function installStyles() {
    if (document.getElementById('crack-summary-update-display-v2-style')) return;

    const style = document.createElement('style');
    style.id = 'crack-summary-update-display-v2-style';
    style.textContent = `
      [data-crack-summary-update-toggle] .csmu-switch {
        margin-left: auto;
        width: 34px;
        height: 18px;
        padding: 2px;
        border-radius: 999px;
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        background: rgba(255,255,255,.20);
        box-sizing: border-box;
        vertical-align: middle;
        transition: background .15s ease;
      }

      [data-theme="light"] [data-crack-summary-update-toggle] .csmu-switch {
        background: rgba(0,0,0,.20);
      }

      [data-crack-summary-update-toggle] .csmu-switch[data-on="1"] {
        background: #ff4b3e;
      }

      [data-crack-summary-update-toggle] .csmu-knob {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        transform: translateX(0);
        transition: transform .15s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,.28);
      }

      [data-crack-summary-update-toggle] .csmu-switch[data-on="1"] .csmu-knob {
        transform: translateX(16px);
      }

      #crack-summary-update-toast {
        position: fixed;
        left: 50%;
        top: 72px;
        transform: translateX(-50%);
        z-index: 2147483647;
        max-width: calc(100vw - 32px);
        padding: 10px 14px;
        border-radius: 10px;
        background: rgba(26,26,26,.94);
        color: #fff;
        font: 600 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        box-shadow: 0 6px 24px rgba(0,0,0,.24);
        pointer-events: none;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function removeNativeNBadges(control) {
    if (!control) return;

    Array.from(control.querySelectorAll('*')).forEach(element => {
      if (normalizeText(element.textContent) !== 'N') return;

      const rect = element.getBoundingClientRect?.();
      const className =
        typeof element.className === 'string'
          ? element.className
          : '';

      if (
        (rect && rect.width <= 36 && rect.height <= 36) ||
        className.includes('rounded-full') ||
        className.includes('brand')
      ) {
        element.remove();
      }
    });
  }

  function replaceSummaryLabel(control, label) {
    const textNodes = [];

    const walker = document.createTreeWalker(
      control,
      NodeFilter.SHOW_TEXT
    );

    while (walker.nextNode()) textNodes.push(walker.currentNode);

    const target = textNodes.find(node =>
      normalizeText(node.nodeValue) === '요약 메모리'
    );

    if (!target) return false;

    target.nodeValue = label;
    return true;
  }

  function getSidebarMenuItemShell(summaryButton) {
    if (!summaryButton) return null;

    let node = summaryButton.parentElement;

    for (
      let depth = 0;
      node && depth < 4;
      depth += 1, node = node.parentElement
    ) {
      if (node.dataset?.crackSummaryUpdateToggle) continue;

      const direct = node.querySelector(
        ':scope > button,:scope > [role="button"],:scope > a'
      );

      if (direct === summaryButton) return node;

      const className =
        typeof node.className === 'string'
          ? node.className
          : '';

      if (
        node.contains(summaryButton) &&
        /(?:^|\s)px-2\.5(?:\s|$)/.test(className)
      ) {
        return node;
      }
    }

    return summaryButton.parentElement;
  }

  function getToggleRowControl(row) {
    if (!row) return null;

    if (row.matches?.('button,[role="button"],a')) return row;

    return row.querySelector('button,[role="button"],a');
  }

  function makeSidebarToggleRow(
    summaryButton,
    kind,
    label,
    checked,
    onToggle
  ) {
    const sourceShell = getSidebarMenuItemShell(summaryButton);
    if (!sourceShell) return null;

    const row = sourceShell.cloneNode(true);
    row.dataset.crackSummaryUpdateToggle = kind;

    row.querySelectorAll('[id]').forEach(element => {
      element.removeAttribute('id');
    });

    const control = getToggleRowControl(row);
    if (!control) return null;

    control.removeAttribute('href');
    control.setAttribute('aria-label', label);

    if (control.tagName === 'BUTTON') {
      control.setAttribute('type', 'button');
    }

    removeNativeNBadges(control);

    if (!replaceSummaryLabel(control, label)) return null;

    const switchEl = document.createElement('span');
    switchEl.className = 'csmu-switch';
    switchEl.setAttribute('role', 'switch');
    switchEl.setAttribute('aria-label', label);
    switchEl.dataset.on = checked ? '1' : '0';
    switchEl.setAttribute('aria-checked', checked ? 'true' : 'false');
    switchEl.innerHTML = '<span class="csmu-knob"></span>';

    control.appendChild(switchEl);

    control.addEventListener(
      'click',
      event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        onToggle();
      },
      true
    );

    return row;
  }

  function injectSidebarToggle() {
    installStyles();

    const existingAuto = document.querySelector(
      '[data-crack-summary-update-toggle="auto-open"]'
    );
    const existingNotify = document.querySelector(
      '[data-crack-summary-update-toggle="notification"]'
    );

    if (existingAuto?.isConnected && existingNotify?.isConnected) {
      updateAllSwitches();
      return true;
    }

    const summaryButton = findSummaryMemoryButton();
    const shell = getSidebarMenuItemShell(summaryButton);

    if (!summaryButton || !shell?.parentElement) return false;

    existingAuto?.remove();
    existingNotify?.remove();

    const autoRow = makeSidebarToggleRow(
      summaryButton,
      'auto-open',
      LABEL_AUTO,
      state.enabled,
      () => setEnabled(!state.enabled)
    );

    const notifyRow = makeSidebarToggleRow(
      summaryButton,
      'notification',
      LABEL_NOTIFY,
      state.notificationEnabled,
      () => setNotificationEnabled(!state.notificationEnabled)
    );

    if (!autoRow || !notifyRow) return false;

    shell.insertAdjacentElement('afterend', notifyRow);
    shell.insertAdjacentElement('afterend', autoRow);

    updateAllSwitches();
    return true;
  }

  function scheduleMenuInjection() {
    clearTimeout(state.menuRetryTimer);

    const startedAt = Date.now();

    const attempt = () => {
      if (injectSidebarToggle()) return;

      if (Date.now() - startedAt < 2500) {
        state.menuRetryTimer = setTimeout(attempt, 80);
      }
    };

    state.menuRetryTimer = setTimeout(attempt, 0);
  }

  function updateAllSwitches() {
    document
      .querySelectorAll('[data-crack-summary-update-toggle]')
      .forEach(row => {
        const element = row.querySelector('.csmu-switch');
        if (!element) return;

        const on =
          row.dataset.crackSummaryUpdateToggle === 'notification'
            ? state.notificationEnabled
            : state.enabled;

        element.dataset.on = on ? '1' : '0';
        element.setAttribute(
          'aria-checked',
          on ? 'true' : 'false'
        );
      });
  }

  function showToast(message, { force = false } = {}) {
    if (!force && !state.notificationEnabled) return;
    if (!document.documentElement) return;

    installStyles();

    let toast = document.getElementById(
      'crack-summary-update-toast'
    );

    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'crack-summary-update-toast';
      document.documentElement.appendChild(toast);
    }

    toast.textContent = message;

    clearTimeout(state.toastTimer);

    state.toastTimer = setTimeout(() => {
      toast?.remove();
    }, 2600);
  }

  // ---------------------------------------------------------------------------
  // 4) SPA 세션 이동
  // ---------------------------------------------------------------------------

  function handleRouteChange(reason = 'route') {
    const href = PAGE.location.href;
    const chatId = getCurrentChatId();

    const changed =
      href !== state.routeHref ||
      chatId !== state.activeChatId;

    if (!changed) return;

    // 바꾸기 전에 현재 세션의 실제 메시지 root와 group id를 기억한다.
    // SPA 이동 직후 querySelector가 이 오래된 DOM을 다시 잡는 버그를 막기 위함.
    const oldRoot = state.chatRoot?.isConnected
      ? state.chatRoot
      : findChatMessageRoot();

    state.routeTransitionOldRoot = oldRoot || null;
    state.routeTransitionOldGroupIds = oldRoot
      ? getDirectMessageGroupIds(oldRoot)
      : '';

    state.routeHref = href;
    state.activeChatId = chatId;
    state.sessionVisit += 1;

    // 세션 방문 단위로 중복 방지 상태를 초기화한다.
    // 같은 세션 안에서는 한 번만, 다시 나갔다 돌아오면 다시 한 번 허용.
    state.seenCompletionKeys.clear();
    state.lastCompletionKey = null;
    state.lastCompletionAt = 0;

    bindChatObserver();
    scheduleMenuInjection();

    log('세션 변경', {
      chatId,
      reason,
      waitingForNewMessageDom: !!state.routeTransitionOldGroupIds
    });
  }

  function installRouteHook() {
    if (PAGE.__CrackSummaryUpdateRouteHookV2) return;
    PAGE.__CrackSummaryUpdateRouteHookV2 = true;

    const history = PAGE.history;

    for (const methodName of ['pushState', 'replaceState']) {
      const original = history?.[methodName];
      if (typeof original !== 'function') continue;

      history[methodName] = function() {
        const result = original.apply(this, arguments);

        queueMicrotask(() => {
          handleRouteChange(methodName);
        });

        return result;
      };
    }

    PAGE.addEventListener('popstate', () => {
      handleRouteChange('popstate');
    });

    // Chromium Navigation API 보조. Next 라우터 구현이 history wrapper를
    // 우회하는 경우에도 SPA 세션 변경을 잡는다.
    try {
      PAGE.navigation?.addEventListener?.('navigatesuccess', () => {
        handleRouteChange('navigation-api');
      });
    } catch (_) {}
  }

  function installMenuOpenClickHook() {
    document.addEventListener(
      'click',
      event => {
        const sideMenuButton = event.target?.closest?.(
          'button[aria-label="사이드 메뉴 열기"],button[aria-label="사이드 메뉴 닫기"]'
        );

        if (sideMenuButton) {
          // React state 변경 뒤 실제 행이 렌더된 시점에 한 번만 재주입.
          setTimeout(scheduleMenuInjection, 0);
          return;
        }

        // 세션 목록의 링크/버튼을 눌러 Next router가 이동하는 경우를 위한
        // 1회성 보조 체크. 상시 timer가 아니라 실제 클릭 때만 실행된다.
        const navigationTarget = event.target?.closest?.(
          'a[href*="/episodes/"],a[href*="/chat/"],button'
        );

        if (!navigationTarget) return;

        setTimeout(() => handleRouteChange('navigation-click'), 0);
        setTimeout(() => handleRouteChange('navigation-click-late'), 120);
      },
      true
    );
  }

  function start() {
    installStyles();
    installRouteHook();
    installMenuOpenClickHook();

    state.activeChatId = getCurrentChatId();
    state.routeHref = PAGE.location.href;
    state.sessionVisit = 1;

    bindChatObserver();
    scheduleMenuInjection();

    log('시작', {
      chatId: state.activeChatId,
      mode: 'targeted-dom-event',
      polling: false,
      apiCalls: 0
    });
  }

  // 디버깅/수동 테스트
  try {
    PAGE.CrackSummaryMemoryUpdateDisplay = {
      get enabled() {
        return state.enabled;
      },

      get notificationEnabled() {
        return state.notificationEnabled;
      },

      setEnabled,
      setNotificationEnabled,

      openNow() {
        return openSummaryMemoryDirect('manual');
      },

      scanNow: scanCurrentMarkers,
      refreshMenu: scheduleMenuInjection,
      getCurrentChatId,

      get status() {
        return {
          enabled: state.enabled,
          notificationEnabled: state.notificationEnabled,
          currentChatId: getCurrentChatId(),
          activeChatId: state.activeChatId,
          sessionVisit: state.sessionVisit,
          chatObserverBound: !!state.chatObserver,
          chatRootConnected: !!state.chatRoot?.isConnected,
          seenCompletionCount: state.seenCompletionKeys.size,
          lastCompletionKey: state.lastCompletionKey,
          currentMessageGroupIds: getDirectMessageGroupIds(state.chatRoot),
          routeTransitionOldGroupIds: state.routeTransitionOldGroupIds,
          polling: false,
          extraApiCalls: 0
        };
      }
    };
  } catch (_) {}

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, {
      once: true
    });
  }
})();
