// ==UserScript==
// @name         Story 수집기 - 제스처 메뉴 연동
// @namespace    https://github.com/workforomg/Utill
// @version      2.6.0
// @description  fetch/xhr 없이 Virtuoso DOM의 data-index 항목을 순회하며 story ID를 수집하고, TMGestureMenu API에 유틸 메뉴로 등록
// @match        https://crack.wrtn.ai/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  /******************************************************************
   * 네가 준 리스트 내부 셀렉터.
   * 단, 이 셀렉터 하나만 믿지 않고 실제 scroller 내부도 같이 훑음.
   ******************************************************************/
  const STORY_LIST_ROOT_SELECTOR = String.raw`#__next > div > div.relative.flex.h-full > div.hidden.h-full.shrink-0.overflow-hidden.bg-surface_tertiary.md\:block.transition-\[width\].duration-300.ease-\[cubic-bezier\(0\.25\,0\.1\,0\.25\,1\)\].w-\[260px\] > div > div > div.flex.flex-col.w-full.h-full.min-h-full.overflow-hidden.sticky.top-0 > div.relative.flex-1.min-h-0.flex.flex-col > div > div > div > div > div:nth-child(2) > div:nth-child(1)`;

  const SCROLLER_SELECTOR =
    '[data-testid="virtuoso-scroller"][data-virtuoso-scroller="true"], [data-virtuoso-scroller="true"], [data-testid="virtuoso-scroller"]';

  /******************************************************************
   * 설정
   ******************************************************************/
  const STORAGE_KEY_IDS = 'CRACK_DOM_STORY_IDS_INDEX_SCAN_V1';
  const STORAGE_KEY_RECORDS = 'CRACK_DOM_STORY_INDEX_RECORDS_V1';
  const STORAGE_KEY_SCROLL_STEP = 'CRACK_DOM_STORY_SCROLL_STEP_PX_V1';
  const STORAGE_KEY_SCROLL_SPEED = 'CRACK_DOM_STORY_SCROLL_SPEED_V1';

  const RESET_TO_TOP_BEFORE_COLLECT = true;

  /*
   * 스크롤 범위: 한 번에 이동하는 px 값.
   * 작을수록 느리지만 누락 위험이 줄고, 클수록 빠르지만 누락 위험이 늘 수 있음.
   */
  const DEFAULT_SCROLL_STEP_PX = 512;
  const MIN_SCROLL_STEP_PX = 64;
  const MAX_SCROLL_STEP_PX = 1600;
  const SCROLL_STEP_INCREMENT_PX = 32;

  /*
   * 스크롤 속도: 1은 가장 느림, 10은 가장 빠름.
   * 내부적으로는 스크롤 후 대기시간(ms)으로 변환해서 사용함.
   */
  const DEFAULT_SCROLL_SPEED = 8;
  const MIN_SCROLL_SPEED = 1;
  const MAX_SCROLL_SPEED = 10;
  const SLOWEST_SCROLL_WAIT_MS = 500;
  const FASTEST_SCROLL_WAIT_MS = 80;

  const COLLECT_PASSES_PER_POSITION = 4;
  const COLLECT_PASS_INTERVAL_MS = 80;

  const STOP_AFTER_NO_CHANGE_ROUNDS = 3;
  const MAX_SCROLL_ROUNDS = 5000;

  const STORY_ID_PATTERN = /^[a-f0-9]{24}$/i;
  const STORY_ID_FROM_HREF_REGEX = /\/stories\/([a-f0-9]{24})(?:\/|$|\?)/i;

  let collectedIds = new Set(loadSavedIds());
  let recordsByIndex = new Map(loadSavedRecords().map((record) => [record.indexKey, record]));

  /*
   * 기존 저장된 인덱스 기록에서도 고유 ID 복원.
   */
  for (const record of recordsByIndex.values()) {
    if (record && STORY_ID_PATTERN.test(record.storyId)) {
      collectedIds.add(record.storyId);
    }
  }

  let collecting = false;
  let observer = null;

  let lastVisibleItemCount = 0;
  let lastVisibleLinkCount = 0;
  let lastVisibleIdCount = 0;

  let scrollStepPx = loadNumberSetting(
    STORAGE_KEY_SCROLL_STEP,
    DEFAULT_SCROLL_STEP_PX,
    MIN_SCROLL_STEP_PX,
    MAX_SCROLL_STEP_PX,
    SCROLL_STEP_INCREMENT_PX
  );

  let scrollSpeed = loadNumberSetting(
    STORAGE_KEY_SCROLL_SPEED,
    DEFAULT_SCROLL_SPEED,
    MIN_SCROLL_SPEED,
    MAX_SCROLL_SPEED,
    1
  );

  /******************************************************************
   * 저장 / 로드
   ******************************************************************/
  function loadNumberSetting(key, fallback, min, max, step) {
    const raw = Number(GM_getValue(key, fallback));

    if (!Number.isFinite(raw)) return fallback;

    return clampAndSnapNumber(raw, min, max, step);
  }

  function clampAndSnapNumber(value, min, max, step) {
    const raw = Number(value);

    if (!Number.isFinite(raw)) return min;

    const clamped = Math.max(min, Math.min(max, raw));
    const snapped = Math.round((clamped - min) / step) * step + min;

    return Math.max(min, Math.min(max, snapped));
  }

  function getScrollStepPx() {
    return clampAndSnapNumber(
      scrollStepPx,
      MIN_SCROLL_STEP_PX,
      MAX_SCROLL_STEP_PX,
      SCROLL_STEP_INCREMENT_PX
    );
  }

  function getScrollSpeed() {
    return clampAndSnapNumber(scrollSpeed, MIN_SCROLL_SPEED, MAX_SCROLL_SPEED, 1);
  }

  function getScrollWaitMs() {
    const speed = getScrollSpeed();
    const ratio = (speed - MIN_SCROLL_SPEED) / (MAX_SCROLL_SPEED - MIN_SCROLL_SPEED);

    return Math.round(SLOWEST_SCROLL_WAIT_MS - ratio * (SLOWEST_SCROLL_WAIT_MS - FASTEST_SCROLL_WAIT_MS));
  }

  function saveCollectorSettings() {
    GM_setValue(STORAGE_KEY_SCROLL_STEP, getScrollStepPx());
    GM_setValue(STORAGE_KEY_SCROLL_SPEED, getScrollSpeed());
    updateButtons();
    updateSettingsPanelValues();
  }

  function setScrollStepPx(value) {
    scrollStepPx = clampAndSnapNumber(
      value,
      MIN_SCROLL_STEP_PX,
      MAX_SCROLL_STEP_PX,
      SCROLL_STEP_INCREMENT_PX
    );
    saveCollectorSettings();
  }

  function setScrollSpeed(value) {
    scrollSpeed = clampAndSnapNumber(value, MIN_SCROLL_SPEED, MAX_SCROLL_SPEED, 1);
    saveCollectorSettings();
  }

  function getSettingsSummaryText() {
    return `스크롤 범위 ${getScrollStepPx()}px / 스크롤 속도 ${getScrollSpeed()}단계 / 대기 ${getScrollWaitMs()}ms`;
  }

  function loadSavedIds() {
    const saved = GM_getValue(STORAGE_KEY_IDS, []);

    if (!Array.isArray(saved)) return [];

    return saved.filter((id) => {
      return typeof id === 'string' && STORY_ID_PATTERN.test(id);
    });
  }

  function loadSavedRecords() {
    const saved = GM_getValue(STORAGE_KEY_RECORDS, []);

    if (!Array.isArray(saved)) return [];

    return saved.filter((record) => {
      return (
        record &&
        typeof record.indexKey === 'string' &&
        typeof record.storyId === 'string' &&
        STORY_ID_PATTERN.test(record.storyId)
      );
    });
  }

  function saveIds() {
    GM_setValue(STORAGE_KEY_IDS, [...collectedIds]);
  }

  function saveRecords() {
    GM_setValue(STORAGE_KEY_RECORDS, [...recordsByIndex.values()]);
  }

  function saveAll() {
    saveIds();
    saveRecords();
    updateButtons();
  }

  function addId(id) {
    if (typeof id !== 'string') return false;
    if (!STORY_ID_PATTERN.test(id)) return false;
    if (collectedIds.has(id)) return false;

    collectedIds.add(id);
    return true;
  }

  function addRecord(record) {
    if (!record) return false;
    if (!record.indexKey) return false;
    if (!STORY_ID_PATTERN.test(record.storyId)) return false;

    const old = recordsByIndex.get(record.indexKey);

    const changed =
      !old ||
      old.storyId !== record.storyId ||
      old.href !== record.href ||
      old.dataIndex !== record.dataIndex ||
      old.dataItemIndex !== record.dataItemIndex;

    if (!changed) return false;

    recordsByIndex.set(record.indexKey, record);
    return true;
  }

  function addIdsAndRecords(ids, records) {
    let addedIds = 0;
    let addedRecords = 0;

    for (const id of ids) {
      if (addId(id)) {
        addedIds++;
      }
    }

    for (const record of records) {
      if (addRecord(record)) {
        addedRecords++;
      }

      if (record && record.storyId) {
        addId(record.storyId);
      }
    }

    if (addedIds > 0 || addedRecords > 0) {
      saveAll();
    }

    return {
      addedIds,
      addedRecords,
    };
  }

  /******************************************************************
   * 통계
   ******************************************************************/
  function getMetrics() {
    const records = [...recordsByIndex.values()];

    const indexedCount = records.length;
    const idsFromIndexedRecords = new Set();

    const numericIndices = [];

    for (const record of records) {
      if (record && STORY_ID_PATTERN.test(record.storyId)) {
        idsFromIndexedRecords.add(record.storyId);
      }

      const n = Number(record.dataIndex || record.dataItemIndex);

      if (Number.isInteger(n) && n >= 0) {
        numericIndices.push(n);
      }
    }

    const uniqueFromIndexedCount = idsFromIndexedRecords.size;
    const mergedDuplicateCount = Math.max(0, indexedCount - uniqueFromIndexedCount);

    let minIndex = null;
    let maxIndex = null;
    let expectedIndexCount = null;
    let missingIndexCount = null;

    if (numericIndices.length > 0) {
      minIndex = Math.min(...numericIndices);
      maxIndex = Math.max(...numericIndices);

      if (minIndex === 0) {
        expectedIndexCount = maxIndex + 1;
        missingIndexCount = Math.max(0, expectedIndexCount - indexedCount);
      }
    }

    return {
      indexedCount,
      uniqueTotalCount: collectedIds.size,
      uniqueFromIndexedCount,
      mergedDuplicateCount,
      minIndex,
      maxIndex,
      expectedIndexCount,
      missingIndexCount,
    };
  }

  function getShortMetricsText() {
    const m = getMetrics();

    const rangeText =
      m.minIndex !== null && m.maxIndex !== null
        ? `0~${m.maxIndex} 기준 `
        : '';

    const missingText =
      m.missingIndexCount && m.missingIndexCount > 0
        ? ` / 미확인 인덱스 ${m.missingIndexCount}개`
        : '';

    return `${rangeText}인덱스 ${m.indexedCount}개 / 고유 ID ${m.uniqueTotalCount}개 / 중복 병합 ${m.mergedDuplicateCount}개${missingText}`;
  }

  /******************************************************************
   * ID 추출
   ******************************************************************/
  function extractStoryIdFromHref(href) {
    if (typeof href !== 'string') return '';

    const match = href.match(STORY_ID_FROM_HREF_REGEX);

    if (!match) return '';

    return match[1];
  }

  function isUsableStoryHref(href) {
    if (typeof href !== 'string') return false;

    return STORY_ID_FROM_HREF_REGEX.test(href);
  }

  /******************************************************************
   * root 확보
   ******************************************************************/
  function getExactListRoots() {
    try {
      return [...document.querySelectorAll(STORY_LIST_ROOT_SELECTOR)];
    } catch (_) {
      return [];
    }
  }

  function getCollectRoots(scroller) {
    const roots = new Set();

    for (const root of getExactListRoots()) {
      roots.add(root);
    }

    if (scroller) {
      roots.add(scroller);
    }

    if (roots.size === 0) {
      roots.add(document);
    }

    return [...roots].filter(Boolean);
  }

  /******************************************************************
   * 현재 DOM의 모든 data-index 항목 순회
   ******************************************************************/
  function collectIdsFromRoot(root) {
    const ids = new Set();
    const records = [];
    const seenAnchors = new Set();

    let itemCount = 0;
    let linkCount = 0;

    const items = root.querySelectorAll('[data-index], [data-item-index]');

    itemCount += items.length;

    for (const item of items) {
      const dataIndex = item.getAttribute('data-index') || '';
      const dataItemIndex = item.getAttribute('data-item-index') || '';
      const indexKey = dataIndex || dataItemIndex;

      const anchors = item.querySelectorAll('a[href*="/stories/"]');

      for (const a of anchors) {
        const href = a.getAttribute('href') || '';

        if (!isUsableStoryHref(href)) continue;

        const uniqueAnchorKey = `${indexKey}::${href}`;

        if (seenAnchors.has(uniqueAnchorKey)) continue;

        seenAnchors.add(uniqueAnchorKey);
        linkCount++;

        const storyId = extractStoryIdFromHref(href);

        if (!storyId) continue;

        ids.add(storyId);

        if (indexKey) {
          records.push({
            indexKey,
            dataIndex,
            dataItemIndex,
            storyId,
            href,
            title: getItemTitle(item),
            updatedAt: Date.now(),
          });
        }
      }
    }

    /*
     * 혹시 data-index 밖에 a가 있는 구조도 대비.
     * 이 경우에는 indexKey가 없으므로 고유 ID에는 넣되, 인덱스 통계에는 넣지 않음.
     */
    const looseAnchors = root.querySelectorAll('a[href*="/stories/"]');

    for (const a of looseAnchors) {
      const href = a.getAttribute('href') || '';

      if (!isUsableStoryHref(href)) continue;
      if (seenAnchors.has(`loose::${href}`)) continue;

      seenAnchors.add(`loose::${href}`);
      linkCount++;

      const storyId = extractStoryIdFromHref(href);

      if (storyId) {
        ids.add(storyId);
      }
    }

    return {
      ids: [...ids],
      records,
      itemCount,
      linkCount,
      idCount: ids.size,
    };
  }

  function getItemTitle(item) {
    try {
      const titleEl =
        item.querySelector('.typo-text-sm_leading-none_medium') ||
        item.querySelector('span');

      return (titleEl && titleEl.textContent ? titleEl.textContent.trim() : '').slice(0, 120);
    } catch (_) {
      return '';
    }
  }

  function collectVisibleIds(scroller) {
    const allIds = new Set();
    const allRecords = [];

    let totalItems = 0;
    let totalLinks = 0;

    const roots = getCollectRoots(scroller);

    for (const root of roots) {
      const result = collectIdsFromRoot(root);

      totalItems += result.itemCount;
      totalLinks += result.linkCount;

      for (const id of result.ids) {
        allIds.add(id);
      }

      for (const record of result.records) {
        allRecords.push(record);
      }
    }

    lastVisibleItemCount = totalItems;
    lastVisibleLinkCount = totalLinks;
    lastVisibleIdCount = allIds.size;

    const added = addIdsAndRecords([...allIds], allRecords);

    updateStatusByVisible(added);

    if (added.addedIds > 0 || added.addedRecords > 0) {
      console.log(
        `[Crack DOM ID Collector] visibleItems=${totalItems}, visibleLinks=${totalLinks}, visibleIds=${allIds.size}, addedIds=${added.addedIds}, addedRecords=${added.addedRecords}, ${getShortMetricsText()}`
      );
    }

    return {
      addedIds: added.addedIds,
      addedRecords: added.addedRecords,
      visibleItems: totalItems,
      visibleLinks: totalLinks,
      visibleIds: allIds.size,
    };
  }

  function updateStatusByVisible(added = { addedIds: 0, addedRecords: 0 }) {
    const addedText =
      added.addedIds || added.addedRecords
        ? ` / +ID ${added.addedIds}, +인덱스 ${added.addedRecords}`
        : '';

    setStatus(
      `보임 item ${lastVisibleItemCount} / link ${lastVisibleLinkCount} / visible ID ${lastVisibleIdCount} / ${getShortMetricsText()}${addedText}`
    );
  }

  /******************************************************************
   * MutationObserver
   ******************************************************************/
  function startObserver(scroller) {
    if (observer) return;

    const target = scroller || document.body;

    if (!target) return;

    observer = new MutationObserver(() => {
      collectVisibleIds(scroller);
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'data-index', 'data-item-index'],
    });
  }

  function stopObserver() {
    if (!observer) return;

    observer.disconnect();
    observer = null;
  }

  /******************************************************************
   * 스크롤러 찾기
   ******************************************************************/
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;

    const rect = el.getBoundingClientRect();

    return rect.width > 0 && rect.height > 0;
  }

  function scoreScroller(el) {
    if (!el || !isVisible(el)) return -9999;

    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);

    let score = 0;

    if (el.matches('[data-testid="virtuoso-scroller"]')) score += 100;
    if (el.matches('[data-virtuoso-scroller="true"]')) score += 100;

    if (rect.width <= 360) score += 80;
    if (rect.left < window.innerWidth * 0.5) score += 60;

    if (el.querySelector('a[href*="/stories/"]')) score += 200;

    const dataIndexCount = el.querySelectorAll('[data-index], [data-item-index]').length;
    score += Math.min(dataIndexCount, 40);

    if (el.scrollHeight > el.clientHeight) score += 80;

    if (
      style.overflowY === 'auto' ||
      style.overflowY === 'scroll' ||
      style.overflowY === 'overlay'
    ) {
      score += 60;
    }

    return score;
  }

  function findBestScroller() {
    const candidates = [...document.querySelectorAll(SCROLLER_SELECTOR)]
      .filter(isVisible)
      .sort((a, b) => scoreScroller(b) - scoreScroller(a));

    return candidates[0] || null;
  }

  async function waitForScroller(timeoutMs = 15000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const scroller = findBestScroller();

      if (scroller) return scroller;

      await sleep(250);
    }

    return null;
  }

  function getScrollInfo(scroller) {
    return {
      top: Math.round(scroller.scrollTop || 0),
      height: Math.round(scroller.scrollHeight || 0),
      client: Math.round(scroller.clientHeight || 0),
    };
  }

  function sameScrollInfo(a, b) {
    return (
      Math.abs(a.top - b.top) <= 1 &&
      Math.abs(a.height - b.height) <= 1 &&
      Math.abs(a.client - b.client) <= 1
    );
  }

  function getRenderedSignature(scroller) {
    const roots = getCollectRoots(scroller);
    const parts = [];

    for (const root of roots) {
      const items = root.querySelectorAll('[data-index], [data-item-index]');

      for (const item of items) {
        if (parts.length >= 200) break;

        const dataIndex = item.getAttribute('data-index') || '';
        const dataItemIndex = item.getAttribute('data-item-index') || '';
        const hrefs = [...item.querySelectorAll('a[href*="/stories/"]')]
          .map((a) => a.getAttribute('href') || '')
          .join(',');

        parts.push(`${dataIndex}|${dataItemIndex}|${hrefs}`);
      }
    }

    return parts.join('§');
  }

  async function collectSeveralPasses(scroller) {
    let totalAddedIds = 0;
    let totalAddedRecords = 0;

    for (let i = 0; i < COLLECT_PASSES_PER_POSITION; i++) {
      if (!collecting && i > 0) break;

      const result = collectVisibleIds(scroller);

      totalAddedIds += result.addedIds;
      totalAddedRecords += result.addedRecords;

      if (!collecting) break;

      await sleep(COLLECT_PASS_INTERVAL_MS);
    }

    return {
      addedIds: totalAddedIds,
      addedRecords: totalAddedRecords,
    };
  }

  async function scrollOnce(scroller) {
    const before = getScrollInfo(scroller);
    const beforeSig = getRenderedSignature(scroller);
    const beforeIdCount = collectedIds.size;
    const beforeIndexCount = recordsByIndex.size;

    await collectSeveralPasses(scroller);

    if (!collecting) {
      const after = getScrollInfo(scroller);

      return {
        before,
        after,
        movedDown: false,
        heightChanged: false,
        scrollChanged: !sameScrollInfo(before, after),
        domChanged: beforeSig !== getRenderedSignature(scroller),
        idAdded: collectedIds.size > beforeIdCount,
        indexAdded: recordsByIndex.size > beforeIndexCount,
        addedIds: collectedIds.size - beforeIdCount,
        addedIndexes: recordsByIndex.size - beforeIndexCount,
      };
    }

    const scrollStep = getScrollStepPx();
    const scrollWait = getScrollWaitMs();

    try {
      scroller.focus({ preventScroll: true });
    } catch (_) {}

    try {
      scroller.scrollBy({
        top: scrollStep,
        left: 0,
        behavior: 'auto',
      });
    } catch (_) {
      try {
        scroller.scrollTop = before.top + scrollStep;
      } catch (_) {}
    }

    await sleep(80);

    const mid = getScrollInfo(scroller);

    if (mid.top === before.top) {
      try {
        scroller.scrollTop = before.top + scrollStep;
      } catch (_) {}
    }

    try {
      scroller.dispatchEvent(
        new Event('scroll', {
          bubbles: true,
          cancelable: false,
        })
      );
    } catch (_) {}

    await sleep(scrollWait);

    await collectSeveralPasses(scroller);

    const after = getScrollInfo(scroller);
    const afterSig = getRenderedSignature(scroller);
    const afterIdCount = collectedIds.size;
    const afterIndexCount = recordsByIndex.size;

    return {
      before,
      after,
      movedDown: after.top > before.top + 1,
      heightChanged: Math.abs(after.height - before.height) > 1,
      scrollChanged: !sameScrollInfo(before, after),
      domChanged: beforeSig !== afterSig,
      idAdded: afterIdCount > beforeIdCount,
      indexAdded: afterIndexCount > beforeIndexCount,
      addedIds: afterIdCount - beforeIdCount,
      addedIndexes: afterIndexCount - beforeIndexCount,
    };
  }

  async function resetScrollerToTop(scroller) {
    try {
      scroller.scrollTop = 0;
    } catch (_) {}

    try {
      scroller.dispatchEvent(
        new Event('scroll', {
          bubbles: true,
          cancelable: false,
        })
      );
    } catch (_) {}

    await sleep(700);
  }

  /******************************************************************
   * 수집 시작 / 취소
   ******************************************************************/
  function stopCollecting() {
    if (!collecting) return;

    collecting = false;
    stopObserver();
    updateButtons();
    setStatus('수집 취소됨');
  }

  async function startCollecting() {
    if (collecting) return;

    collecting = true;
    updateButtons();

    setStatus('스크롤러 찾는 중');

    const scroller = await waitForScroller();

    if (!collecting) {
      stopObserver();
      updateButtons();
      setStatus('수집 취소됨');
      return;
    }

    if (!scroller) {
      collecting = false;
      updateButtons();
      setStatus('스크롤러 못 찾음');
      return;
    }

    startObserver(scroller);

    if (RESET_TO_TOP_BEFORE_COLLECT) {
      setStatus('맨 위로 이동 중');
      await resetScrollerToTop(scroller);
    }

    if (!collecting) {
      stopObserver();
      updateButtons();
      setStatus('수집 취소됨');
      return;
    }

    const startIdCount = collectedIds.size;
    const startIndexCount = recordsByIndex.size;

    let noChangeRounds = 0;

    setStatus('인덱스 전체 수집 시작');

    await collectSeveralPasses(scroller);

    for (let round = 1; round <= MAX_SCROLL_ROUNDS && collecting; round++) {
      const result = await scrollOnce(scroller);

      if (!collecting) break;

      const changed =
        result.movedDown ||
        result.heightChanged ||
        result.scrollChanged ||
        result.domChanged ||
        result.idAdded ||
        result.indexAdded;

      if (changed) {
        noChangeRounds = 0;
      } else {
        noChangeRounds++;
      }

      setStatus(
        `수집 중 / ${getShortMetricsText()} / ${getSettingsSummaryText()} / 보임 item ${lastVisibleItemCount}, link ${lastVisibleLinkCount}, visible ID ${lastVisibleIdCount} / scroll ${result.after.top}/${result.after.height}`
      );

      console.log(
        `[Crack DOM ID Collector] round=${round}, addedIds=${result.addedIds}, addedIndexes=${result.addedIndexes}, ${getShortMetricsText()}, ${getSettingsSummaryText()}, moved=${result.movedDown}, domChanged=${result.domChanged}, noChange=${noChangeRounds}, top=${result.after.top}, height=${result.after.height}`
      );

      if (noChangeRounds >= STOP_AFTER_NO_CHANGE_ROUNDS) {
        break;
      }
    }

    if (collecting) {
      await collectSeveralPasses(scroller);
    }

    const addedIdsTotal = collectedIds.size - startIdCount;
    const addedIndexesTotal = recordsByIndex.size - startIndexCount;

    stopObserver();

    if (!collecting) {
      updateButtons();
      setStatus('수집 취소됨');
      return;
    }

    collecting = false;
    updateButtons();

    setStatus(
      `완료: +고유 ID ${addedIdsTotal}개 / +인덱스 ${addedIndexesTotal}개 / ${getShortMetricsText()}`
    );
  }

  /******************************************************************
   * TMGestureMenu 0.7 API 연동 UI
   * - 메뉴 DOM을 직접 수정하지 않음.
   * - unsafeWindow.TMGestureMenu.registerItem/registerAction만 사용.
   ******************************************************************/
  const MENU_CATEGORY = '유틸';
  const MENU_ITEM_ID = 'crack-total-played-chat';

  const ACTION_STATUS = 'crack-collector-status';
  const ACTION_TOGGLE = 'crack-collector-toggle';
  const ACTION_CLEAR = 'crack-collector-clear';
  const ACTION_SETTINGS = 'crack-collector-settings';

  const EXTERNAL_ROOT =
    typeof unsafeWindow !== 'undefined'
      ? unsafeWindow
      : window;

  let statusText = '대기 중';
  let menuRegistered = false;
  let menuReadyListenerAdded = false;
  let menuRefreshQueued = false;
  let settingsPanelEl = null;
  let styleInjected = false;
  let backButtonGuardInstalled = false;
  let lastBlockedBackAt = 0;

  function ensureUi() {
    injectCollectorUiStyle();
    installMenuBackButtonGuard();
    registerCollectorMenu();
    updateButtons();
  }

  function getGestureMenuApi() {
    return EXTERNAL_ROOT && EXTERNAL_ROOT.TMGestureMenu
      ? EXTERNAL_ROOT.TMGestureMenu
      : null;
  }

  function registerCollectorMenu() {
    const api = getGestureMenuApi();

    if (!api || typeof api.registerItem !== 'function' || typeof api.registerAction !== 'function') {
      if (!menuReadyListenerAdded) {
        menuReadyListenerAdded = true;
        document.addEventListener('TMGestureMenuReady', registerCollectorMenu, { once: true });
      }
      return false;
    }

    api.registerAction(ACTION_STATUS, function () {
      // 상태 표시용 버튼. 기능 없음.
    });

    api.registerAction(ACTION_TOGGLE, function () {
      if (collecting) {
        stopCollecting();
      } else {
        startCollecting();
      }
    });

    api.registerAction(ACTION_CLEAR, function () {
      if (collecting) {
        setStatus('수집 중에는 기록 초기화를 막았습니다. 취소 후 초기화하세요.');
        return;
      }

      clearCollectedRecords();
    });

    api.registerAction(ACTION_SETTINGS, function () {
      toggleSettingsPanel();
    });

    menuRegistered = true;
    syncCollectorMenuItem();
    return true;
  }

  function scheduleMenuSync() {
    if (menuRefreshQueued) return;

    menuRefreshQueued = true;

    window.requestAnimationFrame(() => {
      menuRefreshQueued = false;
      syncCollectorMenuItem();
    });
  }

  function syncCollectorMenuItem() {
    const api = getGestureMenuApi();

    if (!api || typeof api.registerItem !== 'function') {
      registerCollectorMenu();
      return;
    }

    const m = getMetrics();
    const totalSessions = m.indexedCount;
    const duplicateSessions = m.mergedDuplicateCount;
    const playedWorks = m.uniqueFromIndexedCount || m.uniqueTotalCount;

    api.registerItem(MENU_CATEGORY, {
      id: MENU_ITEM_ID,
      title: '총 플레이 한 채팅',
      desc: '현재 화면에 렌더링되는 스토리 링크만 수집합니다. 수집 중에는 이전 메뉴 버튼이 잠기며, 크랙 자체 보관함에만 있는 항목은 기록되지 않습니다.',
      content: [
        `총 수집된 세션 수 : ${totalSessions}`,
        `중복세션 : ${duplicateSessions}`,
        `플레이 한 작품 수 : ${playedWorks}`,
        '',
        `현재 설정 : ${getSettingsSummaryText()}`,
        '설명 : 스크롤 범위는 한 번에 이동하는 거리입니다. 작게 하면 느리지만 누락 위험이 줄고, 크게 하면 빠르지만 누락 위험이 늘 수 있습니다.',
        '설명 : 스크롤 속도는 1이 가장 느림, 10이 가장 빠름입니다. 빠르게 할수록 렌더링이 늦는 항목을 놓칠 수 있습니다.',
        '주의 : 크랙 자체 보관함에만 있고 현재 좌측 목록 DOM에 렌더링되지 않는 항목은 기록되지 않습니다.',
        collecting ? '잠금 : 수집 중에는 이전/뒤로 메뉴 버튼을 누를 수 없습니다. 취소 후 이동하세요.' : '수집 전 설정 열기에서 슬라이더를 조절하세요.'
      ].join('\n'),
      buttons: [
        {
          label: getPublicStatusText(),
          action: ACTION_STATUS
        },
        {
          label: collecting ? '취소' : '수집하기',
          action: ACTION_TOGGLE
        },
        {
          label: '설정 열기',
          action: ACTION_SETTINGS
        },
        {
          label: collecting ? '초기화 잠김' : '기록 초기화',
          action: ACTION_CLEAR
        }
      ]
    });
  }

  function injectCollectorUiStyle() {
    if (styleInjected) return;

    styleInjected = true;

    const style = document.createElement('style');
    style.id = 'crackCollectorStyle';
    style.textContent = `
      #crackCollectorSettingsPanel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: min(360px, calc(100vw - 32px));
        box-sizing: border-box;
        padding: 14px;
        border-radius: 16px;
        background: rgba(20, 20, 24, 0.96);
        color: #fff;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        line-height: 1.45;
      }

      #crackCollectorSettingsPanel * {
        box-sizing: border-box;
      }

      #crackCollectorSettingsPanel .ccsp-title {
        font-weight: 700;
        font-size: 15px;
        margin-bottom: 8px;
      }

      #crackCollectorSettingsPanel .ccsp-desc {
        opacity: 0.82;
        white-space: pre-line;
        margin-bottom: 12px;
      }

      #crackCollectorSettingsPanel .ccsp-row {
        margin: 12px 0;
      }

      #crackCollectorSettingsPanel label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 6px;
        font-weight: 600;
      }

      #crackCollectorSettingsPanel input[type='range'] {
        width: 100%;
      }

      #crackCollectorSettingsPanel .ccsp-help {
        margin-top: 4px;
        font-size: 12px;
        opacity: 0.72;
      }

      #crackCollectorSettingsPanel .ccsp-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 12px;
      }

      #crackCollectorSettingsPanel button {
        border: 0;
        border-radius: 999px;
        padding: 8px 12px;
        cursor: pointer;
        color: #111;
        background: #fff;
        font-weight: 700;
      }

      #crackCollectorSettingsPanel button[data-variant='ghost'] {
        color: #fff;
        background: rgba(255, 255, 255, 0.14);
      }
    `;

    document.documentElement.appendChild(style);
  }

  function toggleSettingsPanel() {
    if (settingsPanelEl && settingsPanelEl.isConnected) {
      settingsPanelEl.remove();
      settingsPanelEl = null;
      return;
    }

    openSettingsPanel();
  }

  function openSettingsPanel() {
    injectCollectorUiStyle();

    if (settingsPanelEl && settingsPanelEl.isConnected) {
      updateSettingsPanelValues();
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'crackCollectorSettingsPanel';
    panel.innerHTML = `
      <div class="ccsp-title">수집기 스크롤 설정</div>
      <div class="ccsp-desc">수집 전에 조절하는 것을 권장합니다.
수집 중에도 값은 반영되지만, 너무 빠르게 하면 누락될 수 있습니다.
크랙 자체 보관함에만 있는 항목은 기록되지 않습니다.</div>

      <div class="ccsp-row">
        <label for="ccspScrollStep">
          <span>스크롤 범위</span>
          <strong data-role="step-value"></strong>
        </label>
        <input id="ccspScrollStep" type="range">
        <div class="ccsp-help">한 번에 움직이는 거리입니다. 작게 = 안전/느림, 크게 = 빠름/누락 위험.</div>
      </div>

      <div class="ccsp-row">
        <label for="ccspScrollSpeed">
          <span>스크롤 속도</span>
          <strong data-role="speed-value"></strong>
        </label>
        <input id="ccspScrollSpeed" type="range">
        <div class="ccsp-help">1 = 가장 느림, 10 = 가장 빠름. 빠를수록 렌더링 대기시간이 짧아집니다.</div>
      </div>

      <div class="ccsp-actions">
        <button type="button" data-action="preset-safe" data-variant="ghost">안전값</button>
        <button type="button" data-action="preset-fast" data-variant="ghost">빠른값</button>
        <button type="button" data-action="close">닫기</button>
      </div>
    `;

    const stepInput = panel.querySelector('#ccspScrollStep');
    const speedInput = panel.querySelector('#ccspScrollSpeed');

    stepInput.min = String(MIN_SCROLL_STEP_PX);
    stepInput.max = String(MAX_SCROLL_STEP_PX);
    stepInput.step = String(SCROLL_STEP_INCREMENT_PX);

    speedInput.min = String(MIN_SCROLL_SPEED);
    speedInput.max = String(MAX_SCROLL_SPEED);
    speedInput.step = '1';

    stepInput.addEventListener('input', () => {
      setScrollStepPx(stepInput.value);
    });

    speedInput.addEventListener('input', () => {
      setScrollSpeed(speedInput.value);
    });

    panel.addEventListener('click', (event) => {
      const button = event.target && event.target.closest
        ? event.target.closest('button[data-action]')
        : null;

      if (!button) return;

      const action = button.getAttribute('data-action');

      if (action === 'close') {
        panel.remove();
        settingsPanelEl = null;
        return;
      }

      if (action === 'preset-safe') {
        scrollStepPx = 256;
        scrollSpeed = 5;
        saveCollectorSettings();
        setStatus('안전값 적용됨');
        return;
      }

      if (action === 'preset-fast') {
        scrollStepPx = 768;
        scrollSpeed = 9;
        saveCollectorSettings();
        setStatus('빠른값 적용됨');
      }
    });

    settingsPanelEl = panel;
    document.documentElement.appendChild(panel);
    updateSettingsPanelValues();
  }

  function updateSettingsPanelValues() {
    if (!settingsPanelEl || !settingsPanelEl.isConnected) return;

    const stepInput = settingsPanelEl.querySelector('#ccspScrollStep');
    const speedInput = settingsPanelEl.querySelector('#ccspScrollSpeed');
    const stepValue = settingsPanelEl.querySelector('[data-role="step-value"]');
    const speedValue = settingsPanelEl.querySelector('[data-role="speed-value"]');

    if (stepInput) stepInput.value = String(getScrollStepPx());
    if (speedInput) speedInput.value = String(getScrollSpeed());
    if (stepValue) stepValue.textContent = `${getScrollStepPx()}px`;
    if (speedValue) speedValue.textContent = `${getScrollSpeed()}단계 / ${getScrollWaitMs()}ms`;
  }

  function installMenuBackButtonGuard() {
    if (backButtonGuardInstalled) return;

    backButtonGuardInstalled = true;

    document.addEventListener('click', blockMenuBackButtonWhileCollecting, true);
    document.addEventListener('pointerdown', blockMenuBackButtonWhileCollecting, true);
    document.addEventListener('touchstart', blockMenuBackButtonWhileCollecting, true);
  }

  function blockMenuBackButtonWhileCollecting(event) {
    if (!collecting) return;

    const target = event.target && event.target.closest
      ? event.target.closest('button, [role="button"], a, [data-action], [aria-label], [title]')
      : null;

    if (!target) return;
    if (!isLikelyGestureMenuElement(target)) return;
    if (!isLikelyBackMenuButton(target)) return;

    event.preventDefault();
    event.stopPropagation();

    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    const now = Date.now();

    if (now - lastBlockedBackAt > 800) {
      lastBlockedBackAt = now;
      setStatus('수집 중에는 이전 메뉴로 이동할 수 없습니다. 취소 후 이동하세요.');
    }
  }

  function isLikelyGestureMenuElement(el) {
    if (!el || !el.closest) return false;

    return Boolean(
      el.closest('#tmGestureMenuOverlay') ||
      el.closest('[id*="GestureMenu"]') ||
      el.closest('[id*="gestureMenu"]') ||
      el.closest('[class*="GestureMenu"]') ||
      el.closest('[class*="gestureMenu"]')
    );
  }

  function isLikelyBackMenuButton(el) {
    const text = normalizeMenuText(el.textContent || '');
    const aria = normalizeMenuText(el.getAttribute('aria-label') || '');
    const title = normalizeMenuText(el.getAttribute('title') || '');
    const action = normalizeMenuText(el.getAttribute('data-action') || '');
    const testId = normalizeMenuText(el.getAttribute('data-testid') || '');
    const id = normalizeMenuText(el.id || '');
    const cls = normalizeMenuText(el.className || '');

    const joined = [text, aria, title, action, testId, id, cls].join(' ');

    if (/collector|수집|취소|기록|초기화|설정|status/.test(joined)) return false;

    return (
      text === '이전' ||
      text === '뒤로' ||
      text === '←' ||
      text === '‹' ||
      text === '〈' ||
      text.includes('이전으로') ||
      text.includes('뒤로가기') ||
      aria.includes('이전') ||
      aria.includes('뒤로') ||
      title.includes('이전') ||
      title.includes('뒤로') ||
      action.includes('back') ||
      action.includes('prev') ||
      testId.includes('back') ||
      testId.includes('prev') ||
      id.includes('back') ||
      id.includes('prev') ||
      cls.includes('back') ||
      cls.includes('prev')
    );
  }

  function normalizeMenuText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function getPublicStatusText() {
    if (collecting) return '수집중..';
    if (statusText.includes('완료')) return '완료';
    if (statusText.includes('취소')) return '수집 취소됨';
    if (statusText.includes('초기화')) return '초기화됨';
    if (statusText.includes('스크롤러 못 찾음')) return '스크롤러 못 찾음';
    if (statusText.includes('맨 위')) return '맨 위로 이동 중';
    if (statusText.includes('스크롤러 찾는 중')) return '스크롤러 찾는 중';
    if (statusText.includes('인덱스 전체 수집 시작')) return '수집중..';

    return statusText || '대기 중';
  }

  function updateButtons() {
    scheduleMenuSync();
  }

  function setStatus(text) {
    statusText = String(text || '');
    scheduleMenuSync();
  }

  function clearCollectedRecords() {
    const ok = confirm('저장된 수집 기록을 전부 지울까요?');

    if (!ok) return;

    if (collecting) {
      stopCollecting();
    }

    collectedIds = new Set();
    recordsByIndex = new Map();

    saveAll();
    setStatus('초기화됨');
  }

  /******************************************************************
   * 시작
   ******************************************************************/
  const bootTimer = setInterval(() => {
    if (!document.body) return;

    clearInterval(bootTimer);
    ensureUi();

    setTimeout(() => {
      const scroller = findBestScroller();
      collectVisibleIds(scroller);
      updateButtons();
    }, 800);
  }, 200);

})();
