// ==UserScript==
// @name         모델 선택 카테고리 분리 및 서버 점수
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @updateURL    
// @downloadURL  
// @author       지유지요
// @description  모델 카테고리 분리 및 모델 표시 설정 및 서버 상태
// @match        https://crack.wrtn.ai/*
// @require      https://raw.githubusercontent.com/workforomg/Utill/main/dist/ui.js
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      rs.igx.kr
// ==/UserScript==

(() => {
  'use strict';

  const sdk = globalThis.CrackUI;
  if (!sdk?.createPageUI) {
    console.error('[모델 카테고리] Crack SDK 로드 실패: @require 주소를 확인하세요.');
    return;
  }
  const ui = sdk.createPageUI({ map: {} });
  ui.configure('modelCategory.menus', {
    kind: 'collection',
    effect: 'local',
    tiers: [{ css: '[role="menu"], [role="dialog"][data-state="open"]' }],
  });

  const CATEGORY_DEFS = [
    { id: 'favorites', title: '★ 즐겨찾기', subtitle: '', matches: () => false },
    {
      id: 'power',
      title: '파워',
      subtitle: '알 수 없음',
      matches: name => name.startsWith('파워챗'),
    },
    {
      id: 'pro',
      title: '프로',
      subtitle: 'Gemini',
      matches: name => name.startsWith('프로챗'),
    },
    {
      id: 'super',
      title: '슈퍼',
      subtitle: 'Sonnet',
      matches: name => name.startsWith('슈퍼챗'),
    },
    {
      id: 'hyper',
      title: '하이퍼',
      subtitle: 'Opus',
      matches: name => name.startsWith('하이퍼챗'),
    },
    {
      id: 'fable',
      title: '페이블',
      subtitle: 'Fable',
      matches: name => name.startsWith('페이블챗'),
    },
  ];

  const STYLE_ID = 'crack-model-category-style';
  const LAYOUT_CLASS = 'crack-model-category-layout';

  let scheduled = false;
  const savedHidden = GM_getValue('crack-hidden-models-v2', []);
  const hiddenModels = new Set(Array.isArray(savedHidden) ? savedHidden.filter(name => typeof name === 'string') : []);
  const savedFavorites = GM_getValue('crack-favorite-models', []);
  const favoriteModels = new Set(Array.isArray(savedFavorites) ? savedFavorites.filter(name => typeof name === 'string') : []);
  const knownModels = new Set();
  let settingsPanel = null;

  function updateFavoriteStar(item) {
    const name = getModelName(item);
    let star = item.querySelector('.crack-model-favorite');
    if (!star) {
      star = document.createElement('span');
      star.className = 'crack-model-favorite';
      star.setAttribute('role', 'button');
      star.tabIndex = 0;
      ['pointerdown', 'mousedown', 'keyup'].forEach(type => star.addEventListener(type, stopCategoryEvent));
      const toggle = event => {
        stopCategoryEvent(event);
        const currentName = getModelName(item);
        if (favoriteModels.has(currentName)) favoriteModels.delete(currentName);
        else favoriteModels.add(currentName);
        GM_setValue('crack-favorite-models', [...favoriteModels]);
        updateFavoriteStar(item);
        scheduleProcess();
      };
      star.addEventListener('click', toggle);
      star.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') toggle(event);
        else event.stopPropagation();
      });
      const nameNode = item.querySelector('span.text-text_primary, span[class*="text-text_primary"]');
      const icon = item.querySelector('img');
      if (icon) icon.before(star);
      else if (nameNode) nameNode.before(star);
      else item.prepend(star);
    }
    const favorite = favoriteModels.has(name);
    const glyph = favorite ? '★' : '☆';
    if (star.textContent !== glyph) star.textContent = glyph;
    star.classList.toggle('is-favorite', favorite);
    star.setAttribute('aria-pressed', String(favorite));
    star.setAttribute('aria-label', `${name} 즐겨찾기 ${favorite ? '해제' : '추가'}`);
    star.title = favorite ? '즐겨찾기 해제' : '즐겨찾기 추가';
  }

  const SCORE_URL = 'https://rs.igx.kr/';
  const SCORE_INTERVAL = 60_000;
  const SCORE_MAX_AGE = 5 * 60_000;
  const savedMode = GM_getValue('crack-score-mode', 'list');
  let scoreMode = ['off', 'list', 'input', 'both'].includes(savedMode) ? savedMode : 'list';
  const storedMapping = GM_getValue('crack-score-mapping', {});
  const scoreMapping = Object.assign(Object.create(null), storedMapping && typeof storedMapping === 'object' && !Array.isArray(storedMapping) ? storedMapping : {});
  let scoreEntries = [];
  let scoreUpdatedAt = 0;
  let scoreError = '';
  let scoreLoading = false;
  let scoreLastAttempt = 0;
  let scoreRequest = null;
  let scoreGeneration = 0;
  let currentModel = '';
  let currentModelRoute = location.pathname;
  let currentPrompt = null;
  let inputBadge = null;
  let inputBlock = null;
  const modelIds = new Map();
  const modelDescriptions = new Map();
  const savedCatalog = GM_getValue('crack-model-catalog', []);
  if (Array.isArray(savedCatalog)) for (const model of savedCatalog.slice(0, 200)) {
    if (!model || typeof model.name !== 'string') continue;
    knownModels.add(model.name);
    if (typeof model.id === 'string') modelIds.set(model.name, model.id);
    if (typeof model.description === 'string') modelDescriptions.set(model.name, model.description);
  }
  const listScoresEnabled = () => scoreMode === 'list' || scoreMode === 'both';
  const inputScoresEnabled = () => scoreMode === 'input' || scoreMode === 'both';
  const validEntry = entry => entry && typeof entry.id === 'string' && typeof entry.name === 'string'
    && typeof entry.score === 'number' && Number.isFinite(entry.score) && entry.score >= 0 && entry.score <= 100;
  const cache = GM_getValue('crack-score-cache', null);
  if (cache && Array.isArray(cache.entries) && Number.isFinite(cache.time) && cache.time <= Date.now()) {
    scoreEntries = cache.entries.filter(validEntry);
    scoreUpdatedAt = cache.time;
  }

  function parseScores(html) {
    // Parse inert HTML only; never insert third-party HTML or run its scripts.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const entries = new Map();
    for (const card of doc.querySelectorAll('.card[id]')) {
      const id = card.querySelector('.card-title-model-id')?.textContent?.trim();
      const name = card.querySelector('.card-title-name')?.textContent?.trim();
      const raw = card.querySelector('.card-score-data')?.textContent?.trim();
      if (!id || !name || !raw || !/^\d+(?:\.\d+)?$/.test(raw)) continue;
      const entry = { id, name, score: Number(raw) };
      if (validEntry(entry)) entries.set(id, entry);
    }
    if (!entries.size) throw new Error('점수 데이터 형식이 변경되었거나 데이터가 없습니다.');
    return [...entries.values()];
  }

  function refreshScores(force = false) {
    if (scoreMode === 'off' || scoreLoading || document.hidden) return;
    if (!force && Date.now() - scoreLastAttempt < SCORE_INTERVAL) return;
    scoreLastAttempt = Date.now();
    scoreLoading = true;
    const generation = ++scoreGeneration;
    updateScoreSettings();
    function finish(error, entries) {
      if (generation !== scoreGeneration) return;
      scoreLoading = false;
      scoreRequest = null;
      scoreError = error || '';
      if (entries) {
        scoreEntries = entries;
        scoreUpdatedAt = Date.now();
        GM_setValue('crack-score-cache', { entries, time: scoreUpdatedAt });
      }
      updateScoreSettings();
      scheduleProcess();
    }
    try {
      scoreRequest = GM_xmlhttpRequest({
        method: 'GET', url: SCORE_URL, anonymous: true, timeout: 15000,
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        onload(response) {
          try {
            if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
            if (typeof response.responseText !== 'string' || response.responseText.length > 2_000_000) throw new Error('잘못된 응답');
            finish('', parseScores(response.responseText));
          } catch (error) { finish(error.message); }
        },
        onerror: () => finish('네트워크 연결 실패'),
        ontimeout: () => finish('요청 시간 초과'),
        onabort: () => finish('요청 취소'),
      });
    } catch (error) { finish(error.message); }
  }

  function normalizeModel(value) {
    return String(value).toLowerCase().replace(/chatgpt/g, 'gpt').replace(/[^a-z0-9.]/g, '');
  }

  function backendSignature(value, allowPreviewAlias = false) {
    let text = String(value).toLowerCase().replace(/chatgpt/g, 'gpt').replace(/^\s*claude[\s-]*/, '');
    if (allowPreviewAlias) text = text.replace(/\bpreview\b/g, '');
    return text.replace(/[^a-z0-9.]/g, '');
  }

  function matchScore(name) {
    const manual = scoreMapping[name];
    if (manual === 'none') return null;
    if (typeof manual === 'string' && manual) return scoreEntries.find(entry => entry.id === manual) || null;
    const explicitId = modelIds.get(name);
    if (explicitId) {
      const exact = scoreEntries.find(entry => entry.id === explicitId);
      if (exact) return exact;
    }
    const normalized = normalizeModel(name);
    const exact = scoreEntries.filter(entry => normalizeModel(entry.id) === normalized || normalizeModel(entry.name) === normalized);
    if (exact.length === 1) return exact[0];
    // Read the site's explicit backend model description, not its Korean brand version.
    const description = modelDescriptions.get(name) || '';
    // Extract Latin model names from the Korean description. No version table:
    // a newly published provider/model/version participates on the next refresh.
    const phrases = description.match(/[a-zA-Z][a-zA-Z0-9.() _-]*/g) || [];
    const candidatesFor = allowPreviewAlias => {
      const signatures = new Set(phrases.map(phrase => backendSignature(phrase, allowPreviewAlias)).filter(Boolean));
      return scoreEntries.filter(entry => [entry.id, entry.name].some(value => signatures.has(backendSignature(value, allowPreviewAlias))));
    };
    const precise = candidatesFor(false);
    if (precise.length) return precise.length === 1 ? precise[0] : null;
    const preview = candidatesFor(true);
    return preview.length === 1 ? preview[0] : null;
  }

  function renderScore(badge, name) {
    const entry = matchScore(name);
    const fresh = !scoreError && scoreUpdatedAt > 0 && Date.now() - scoreUpdatedAt <= SCORE_MAX_AGE;
    const score = fresh ? entry?.score : undefined;
    const text = score === undefined ? '—' : String(Math.round(score));
    if (badge.textContent !== text) badge.textContent = text;
    const tone = score === undefined ? 'unknown' : score >= 75 ? 'good' : score >= 50 ? 'fair' : score >= 25 ? 'poor' : 'bad';
    if (badge.dataset.tone !== tone) badge.dataset.tone = tone;
    let title;
    if (!name) title = '현재 모델 확인 불가: 모델 선택창을 열어주세요.';
    else if (!entry) title = `${name}: 설정에서 점수 모델을 연결해주세요.`;
    else if (!fresh) title = `${name}: ${scoreError || '점수 갱신 대기 중'}`;
    else title = `${name} · ${entry.name}: ${text}/100 · Radiosonde · ${new Date(scoreUpdatedAt).toLocaleTimeString()}`;
    if (badge.title !== title) badge.title = title;
    if (badge.getAttribute('aria-label') !== title) badge.setAttribute('aria-label', title);
  }

  function updateItemScore(item) {
    let badge = item.querySelector('.crack-model-score');
    if (!listScoresEnabled()) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'crack-model-score';
      const nameNode = item.querySelector('span.text-text_primary, span[class*="text-text_primary"]');
      // A sibling preserves the original name text and selection handlers.
      if (nameNode) nameNode.after(badge);
      else item.append(badge);
    }
    renderScore(badge, getModelName(item));
  }

  function getComposerModel(prompt) {
    let scope = prompt?.parentElement;
    for (let depth = 0; scope && depth < 5 && scope !== document.body; depth++, scope = scope.parentElement) {
      const names = new Set();
      for (const trigger of scope.querySelectorAll('button[aria-haspopup="menu"], button[aria-haspopup="dialog"], [role="button"][aria-haspopup="menu"]')) {
        if (trigger.closest('[role="menu"], dialog') || !trigger.getClientRects().length) continue;
        const imageName = getModelName(trigger);
        const text = trigger.textContent.trim();
        const name = knownModels.has(imageName) || CATEGORY_DEFS.some(category => category.matches(imageName)) ? imageName : knownModels.has(text) ? text : '';
        if (name) names.add(name);
      }
      if (names.size === 1) return [...names][0];
      if (names.size > 1) return '';
    }
    // Current site places the model selector in the chat header, away from the composer.
    const headerNames = [...document.querySelectorAll('main button[aria-haspopup="dialog"]')]
      .filter(button => !button.closest('[role="dialog"]') && button.getClientRects().length)
      .map(getModelName).filter(name => CATEGORY_DEFS.some(category => category.matches(name)));
    return new Set(headerNames).size === 1 ? headerNames[0] : '';
  }

  function updateInputScore() {
    const prompt = sdk.getPrompt();
    if (currentModelRoute !== location.pathname || currentPrompt !== prompt) {
      currentModel = '';
      currentModelRoute = location.pathname;
      currentPrompt?.classList.remove('crack-score-input-padding');
      currentPrompt = prompt;
    }
    const triggerModel = getComposerModel(prompt);
    if (triggerModel) currentModel = triggerModel;
    if (!inputScoresEnabled() || !prompt || !prompt.getClientRects().length) {
      inputBadge?.remove(); inputBadge = null;
      inputBlock?.classList.remove('crack-score-above-space');
      inputBlock = null;
      prompt?.classList.remove('crack-score-input-padding');
      return;
    }
    if (!inputBadge) {
      inputBadge = document.createElement('div');
      inputBadge.className = 'crack-current-model-panel';
      const name = document.createElement('div');
      name.className = 'crack-current-model-name';
      const line = document.createElement('div');
      line.className = 'crack-current-model-line';
      const label = document.createElement('span');
      label.textContent = '현재 점수';
      const score = document.createElement('span');
      score.className = 'crack-model-score crack-current-model-score';
      line.append(label, score);
      inputBadge.append(name, line);
      document.body.append(inputBadge);
    }
    prompt.classList.remove('crack-score-input-padding');
    const block = prompt.closest('.rounded-lg.border.bg-background') || prompt;
    if (inputBlock !== block) inputBlock?.classList.remove('crack-score-above-space');
    inputBlock = block;
    const name = inputBadge.querySelector('.crack-current-model-name');
    if (name.textContent !== (currentModel || '모델 확인 중')) name.textContent = currentModel || '모델 확인 중';
    renderScore(inputBadge.querySelector('.crack-current-model-score'), currentModel);
    positionInputScore();
  }

  function positionInputScore() {
    if (!inputBadge || !inputBlock) return;
    let rect = inputBlock.getBoundingClientRect();
    const above = rect.left < 124;
    inputBlock.classList.toggle('crack-score-above-space', above);
    rect = inputBlock.getBoundingClientRect();
    inputBadge.style.left = `${above ? Math.max(8, rect.left) : rect.left - 116}px`;
    inputBadge.style.top = `${above ? rect.top - 52 : rect.top + 4}px`;
    inputBadge.hidden = rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > innerHeight || Boolean(settingsPanel);
  }

  function updateScoreSettings() {
    if (!settingsPanel) return;
    const status = settingsPanel.querySelector('.crack-score-status');
    if (status) status.textContent = scoreMode === 'off' ? '점수 숨김 · 자동 갱신 중지'
      : scoreLoading ? '점수를 불러오는 중…' : scoreError ? `점수 갱신 실패: ${scoreError}`
      : scoreUpdatedAt ? `최근 갱신 ${new Date(scoreUpdatedAt).toLocaleTimeString()} · 60초마다 갱신` : '점수 데이터 없음';
    for (const select of settingsPanel.querySelectorAll('.crack-score-mapping')) {
      const signature = JSON.stringify(scoreEntries.map(entry => [entry.id, entry.name]));
      if (select.dataset.signature === signature) continue;
      select.dataset.signature = signature;
      select.replaceChildren(new Option('자동 연결 (정확한 이름/ID)', ''), new Option('연결 안 함', 'none'));
      scoreEntries.forEach(entry => select.add(new Option(entry.name, entry.id)));
      const saved = scoreMapping[select.dataset.model] || '';
      if (saved && saved !== 'none' && !scoreEntries.some(entry => entry.id === saved)) select.add(new Option(`${saved} (데이터 없음)`, saved));
      select.value = saved;
    }
  }

  function createScoreSettings() {
    const section = document.createElement('section');
    section.className = 'crack-score-settings';
    const heading = document.createElement('h3');
    heading.textContent = '모델 점수';
    const mode = document.createElement('select');
    mode.className = 'crack-score-mode';
    mode.setAttribute('aria-label', '점수 표시 위치');
    for (const [value, label] of [['off', '숨김'], ['list', '모델 목록만'], ['input', '입력칸 왼쪽만'], ['both', '모델 목록 + 입력칸 왼쪽']]) mode.add(new Option(label, value));
    mode.value = scoreMode;
    mode.addEventListener('change', () => {
      scoreMode = mode.value;
      GM_setValue('crack-score-mode', scoreMode);
      if (scoreMode === 'off') {
        ++scoreGeneration;
        scoreRequest?.abort(); scoreRequest = null; scoreLoading = false;
      } else refreshScores();
      updateScoreSettings(); scheduleProcess();
    });
    const status = document.createElement('p');
    status.className = 'crack-score-status';
    status.setAttribute('role', 'status');
    const refresh = document.createElement('button');
    refresh.type = 'button'; refresh.textContent = '점수 새로고침';
    refresh.addEventListener('click', () => refreshScores(true));
    const help = document.createElement('p');
    help.textContent = '75 이상 초록 · 50 이상 노랑 · 25 이상 주황 · 25 미만 빨강. 메뉴 설명의 기반 모델로 자동 연결합니다. 미측정/미연결/갱신 실패는 —로 표시하며, 아래에서 직접 연결할 수도 있습니다.';
    const link = document.createElement('a');
    link.href = SCORE_URL; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '점수 출처: IGX Radiosonde';
    section.append(heading, mode, status, refresh, help, link);
    return section;
  }

  function openSettings() {
    if (settingsPanel) { settingsPanel.focus(); return; }
    const dialog = document.createElement('dialog');
    settingsPanel = dialog;
    dialog.className = 'crack-model-settings';
    dialog.setAttribute('aria-label', '모델 표시 설정');
    ['pointerdown', 'mousedown', 'click', 'keydown'].forEach(type => {
      dialog.addEventListener(type, event => event.stopPropagation());
    });
    const title = document.createElement('h2');
    title.textContent = '모델 표시 설정';
    const hint = document.createElement('p');
    hint.textContent = '체크한 모델만 표시됩니다. 변경 사항은 즉시 저장됩니다.';
    const list = document.createElement('div');
    list.className = 'crack-model-settings-list';
    const names = [...new Set([...knownModels, ...hiddenModels])];
    if (!names.length) {
      list.textContent = '모델 선택창을 한 번 연 뒤 설정을 다시 열어주세요.';
    }
    function save() {
      GM_setValue('crack-hidden-models-v2', [...hiddenModels]);
      scheduleProcess();
    }
    for (const name of names) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !hiddenModels.has(name);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) hiddenModels.delete(name);
        else hiddenModels.add(name);
        save();
      });
      label.append(checkbox, document.createTextNode(name));
      const row = document.createElement('div');
      row.className = 'crack-model-settings-row';
      const mapping = document.createElement('select');
      mapping.className = 'crack-score-mapping';
      mapping.dataset.model = name;
      mapping.setAttribute('aria-label', `${name}의 점수 모델 연결`);
      mapping.addEventListener('change', () => {
        if (mapping.value) scoreMapping[name] = mapping.value;
        else delete scoreMapping[name];
        GM_setValue('crack-score-mapping', { ...scoreMapping });
        scheduleProcess();
      });
      row.append(label, mapping);
      list.append(row);
    }
    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.textContent = '모두 표시';
    showAll.addEventListener('click', () => {
      hiddenModels.clear();
      list.querySelectorAll('input').forEach(input => { input.checked = true; });
      save();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '닫기';
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { settingsPanel = null; dialog.remove(); });
    dialog.append(title, createScoreSettings(), hint, list, showAll, close);
    // 메뉴의 포커스 트랩과 aria-hidden 처리가 설정창을 막지 않도록
    // 열린 모델 메뉴 내부에 두고, 네이티브 dialog의 최상위 레이어로 표시합니다.
    const host = ui.resolve('modelCategory.menus').elements.find(menu => menu.classList.contains('crack-model-category-menu'));
    (host || document.body).append(dialog);
    updateScoreSettings();
    dialog.showModal();
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      .crack-model-favorite {
        display: inline-flex; align-items: center; justify-content: center;
        width: 24px; min-height: 24px; flex-shrink: 0; margin-inline-end: 3px;
        color: #888; font: 20px/1 system-ui, sans-serif; cursor: pointer;
      }
      .crack-model-favorite.is-favorite { color: #e6ab20; }
      .crack-model-favorite:focus-visible { outline: 2px solid #e6ab20; border-radius: 4px; }
      .crack-model-category-button:disabled { opacity: .4; cursor: default; }
      .crack-model-category-button:disabled:hover { background: transparent; }
      .crack-model-score {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 28px; padding: 2px 6px; margin-inline-start: 6px;
        border-radius: 6px; font: 700 12px/18px system-ui, sans-serif;
        font-variant-numeric: tabular-nums; flex-shrink: 0; vertical-align: middle;
      }
      .crack-model-score[data-tone="good"] { color: #065f46; background: #d1fae5; }
      .crack-model-score[data-tone="fair"] { color: #713f12; background: #fef3c7; }
      .crack-model-score[data-tone="poor"] { color: #9a3412; background: #ffedd5; }
      .crack-model-score[data-tone="bad"] { color: #991b1b; background: #fee2e2; }
      .crack-model-score[data-tone="unknown"] { color: #475569; background: #e2e8f0; }
      .crack-current-model-panel { position: fixed; width: 104px; z-index: 50; pointer-events: none; color: var(--text_primary, #888); font: 12px/18px system-ui, sans-serif; }
      .crack-current-model-panel[hidden] { display: none !important; }
      .crack-current-model-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; margin-bottom: 4px; }
      .crack-current-model-line { display: flex; align-items: center; gap: 4px; }
      .crack-current-model-score { margin: 0; min-width: 24px; padding: 1px 4px; }
      .crack-score-above-space { margin-top: 54px !important; }
      .crack-score-settings { border-block: 1px solid #8885; padding: 8px 0 14px; margin: 12px 0; }
      .crack-score-settings h3 { margin: 0 0 8px; font-size: 15px; }
      .crack-model-settings select { width: 100%; border: 1px solid #8886; border-radius: 6px; padding: 7px; background: Canvas; color: CanvasText; font: inherit; }
      .crack-model-settings-row { display: grid; gap: 6px; }
      .crack-score-status { font-size: 12px; }
      .crack-model-settings {
        width: min(440px, calc(100vw - 40px));
        max-height: 80vh;
        overflow: auto;
        padding: 20px;
        border: 1px solid #8886;
        border-radius: 12px;
        background: Canvas;
        color: CanvasText;
        color-scheme: light dark;
        font: 14px/1.5 system-ui, sans-serif;
      }
      .crack-model-settings::backdrop { background: #0008; }
      .crack-model-settings h2 { font-size: 18px; margin: 0 0 8px; }
      .crack-model-settings-list { display: grid; gap: 10px; margin: 16px 0; }
      .crack-model-settings-list label { display: flex; gap: 10px; align-items: center; cursor: pointer; }
      .crack-model-settings button, .crack-model-settings-open {
        padding: 8px 12px; border: 1px solid #8886; border-radius: 7px;
        background: transparent; color: inherit; font: inherit; cursor: pointer;
      }
      .crack-model-settings button + button { margin-left: 8px; }
      .crack-model-settings-open { margin-top: auto; }
      .crack-model-empty { padding: 12px; font-size: 13px; }
      .crack-model-empty[hidden] { display: none !important; }
      .crack-model-category-menu {
        width: min(560px, calc(100vw - 24px)) !important;
        min-width: 0 !important;
        max-width: calc(100vw - 24px) !important;
        max-height: 450px !important;
        height: auto !important;
        padding: 0 !important;
        overflow: hidden !important;
      }

      .${LAYOUT_CLASS} {
        display: grid;
        grid-template-columns: 116px minmax(0, 1fr);
        width: 100%;
        min-height: 220px;
        max-height: 450px;
      }

      .crack-model-category-sidebar {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 8px;
        overflow-y: auto;
        border-right: 1px solid rgba(127, 127, 127, 0.22);
        border-right-color: hsl(var(--border));
        background: rgba(127, 127, 127, 0.035);
      }

      .crack-model-category-button {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: 100%;
        min-height: 52px;
        padding: 8px 9px 8px 11px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          background-color 120ms ease,
          color 120ms ease;
      }

      .crack-model-category-button[hidden] { display: none !important; }

      .crack-model-category-button:hover,
      .crack-model-category-button:focus-visible {
        outline: none;
        background: rgba(127, 127, 127, 0.12);
        background: hsl(var(--accent));
      }

      .crack-model-category-button.is-active {
        background: rgba(127, 127, 127, 0.16);
        background: hsl(var(--accent));
        color: inherit;
        color: hsl(var(--accent-foreground));
      }

      .crack-model-category-button.is-active::before {
        content: '';
        position: absolute;
        top: 9px;
        bottom: 9px;
        left: 3px;
        width: 3px;
        border-radius: 999px;
        background: #ff6b83;
        background: hsl(var(--brand));
      }

      .crack-model-category-title {
        font-size: 14px;
        line-height: 19px;
        font-weight: 600;
      }

      .crack-model-category-subtitle {
        margin-top: 2px;
        font-size: 10px;
        line-height: 14px;
        font-weight: 400;
        color: var(--text_secondary, #888);
        white-space: nowrap;
      }

      .crack-model-category-content {
        min-width: 0;
        padding: 8px;
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      .crack-model-category-content > .crack-model-item {
        width: 100%;
      }

      .crack-model-category-content > .crack-model-item[hidden] {
        display: none !important;
      }

      @media (max-width: 520px) {
        .${LAYOUT_CLASS} {
          grid-template-columns: 94px minmax(0, 1fr);
        }

        .crack-model-category-sidebar {
          padding: 6px;
        }

        .crack-model-category-button {
          min-height: 49px;
          padding-left: 9px;
          padding-right: 6px;
        }

        .crack-model-category-title {
          font-size: 13px;
        }

        .crack-model-category-subtitle {
          font-size: 9px;
        }

        .crack-model-category-content {
          padding: 6px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function getModelName(item) {
    const imageName = item.querySelector('img[alt]')?.alt?.trim();

    if (imageName && CATEGORY_DEFS.some(category => category.matches(imageName))) {
      return imageName;
    }

    const nameNode = item.querySelector(
      'span.text-text_primary, span[class*="text-text_primary"]'
    );

    const named = nameNode?.textContent?.trim();
    if (named) return named;
    // Header uses a plain truncated span; menu icons now have empty alt text.
    const span = [...item.querySelectorAll('span')].find(node =>
      /^[가-힣A-Za-z]+챗(?:\s+\d+(?:\.\d+)?)?$/.test(node.textContent.trim()));
    return span?.textContent.trim() || '';
  }

  function getCategoryId(item) {
    const name = getModelName(item);

    const existing = CATEGORY_DEFS.find(category => category.matches(name));
    if (existing) return existing.id;
    const brand = name.match(/^([가-힣A-Za-z]+)챗(?:\s|$)/)?.[1];
    if (!brand) return null;
    const id = `custom-${brand}`;
    CATEGORY_DEFS.push({ id, title: brand, subtitle: '새 모델', matches: value => value.startsWith(`${brand}챗`) });
    return id;
  }

  function isSelectedModel(item) {
    if (item.hasAttribute('aria-current')) return item.getAttribute('aria-current') === 'true';
    if (item.hasAttribute('aria-checked')) return item.getAttribute('aria-checked') === 'true';
    const directCheck = Array.from(item.children).find(child => {
      if (!(child instanceof SVGElement)) return false;

      const classes = child.getAttribute('class') || '';

      return (
        classes.includes('fill-brand') &&
        classes.includes('size-5')
      );
    });

    return Boolean(
      directCheck &&
      !directCheck.classList.contains('invisible')
    );
  }

  function stopCategoryEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function activateCategory(menu, categoryId) {
    const items = [...menu.querySelectorAll('.crack-model-category-content > .crack-model-item')];
    const available = new Set(items.filter(item => !hiddenModels.has(getModelName(item)))
      .map(item => item.dataset.crackModelCategory));
    if (items.some(item => favoriteModels.has(getModelName(item)) && !hiddenModels.has(getModelName(item)))) available.add('favorites');
    const buttons = [...menu.querySelectorAll('.crack-model-category-button')];
    const focusedButton = buttons.find(button => button === document.activeElement);
    for (const button of buttons) {
      const favorites = button.dataset.category === 'favorites';
      button.hidden = !available.has(button.dataset.category);
      button.disabled = favorites && !available.has('favorites');
    }
    if (!available.has(categoryId)) {
      categoryId = buttons.find(button => !button.hidden && !button.disabled)?.dataset.category || '';
    }
    const changed = menu.dataset.crackActiveCategory !== categoryId;
    menu.dataset.crackActiveCategory = categoryId;

    menu
      .querySelectorAll('.crack-model-category-button')
      .forEach(button => {
        const active = button.dataset.category === categoryId;

        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
    if (focusedButton && (focusedButton.hidden || focusedButton.disabled)) {
      (buttons.find(button => !button.hidden && !button.disabled && button.dataset.category === categoryId)
        || menu.querySelector('.crack-model-settings-open'))?.focus();
    }

    menu
      .querySelectorAll(
        '.crack-model-category-content > .crack-model-item'
      )
      .forEach(item => {
        item.hidden =
          (categoryId === 'favorites' ? !favoriteModels.has(getModelName(item)) : item.dataset.crackModelCategory !== categoryId)
          || hiddenModels.has(getModelName(item));
      });

    const empty = menu.querySelector('.crack-model-empty');
    if (empty) {
      empty.hidden = Boolean(menu.querySelector('.crack-model-category-content > .crack-model-item:not([hidden])'));
    }

    const content = menu.querySelector(
      '.crack-model-category-content'
    );

    if (content && changed) {
      content.scrollTop = 0;
    }
  }

  function createCategoryButton(menu, category) {
    const button = document.createElement('button');

    button.type = 'button';
    button.className = 'crack-model-category-button';
    button.dataset.category = category.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');

    button.innerHTML = `
      <span class="crack-model-category-title">
        ${category.title}
      </span>
      <span class="crack-model-category-subtitle">
        ${category.subtitle}
      </span>
    `;

    button.addEventListener(
      'pointerdown',
      stopCategoryEvent
    );

    button.addEventListener(
      'mousedown',
      stopCategoryEvent
    );

    button.addEventListener('click', event => {
      stopCategoryEvent(event);
      activateCategory(menu, category.id);
    });

    button.addEventListener('keydown', event => {
      const buttons = Array.from(
        menu.querySelectorAll(
          '.crack-model-category-button:not([hidden]):not(:disabled)'
        )
      );

      const index = buttons.indexOf(button);
      let nextIndex = -1;

      if (event.key === 'ArrowDown') {
        nextIndex = (index + 1) % buttons.length;
      }

      if (event.key === 'ArrowUp') {
        nextIndex =
          (index - 1 + buttons.length) % buttons.length;
      }

      if (event.key === 'Home') {
        nextIndex = 0;
      }

      if (event.key === 'End') {
        nextIndex = buttons.length - 1;
      }

      if (nextIndex >= 0) {
        stopCategoryEvent(event);

        const nextButton = buttons[nextIndex];

        activateCategory(
          menu,
          nextButton.dataset.category
        );

        nextButton.focus();
      }
    });

    return button;
  }

  function categorizeMenu(menu) {
    const allItems = Array.from(
      menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button[aria-current]')
    );

    const modelItems = allItems.filter(item =>
      getCategoryId(item)
    );

    /*
     * 다른 드롭다운이 실수로 바뀌지 않도록
     * 모델 항목이 여러 개 있는 메뉴만 처리합니다.
     */
    if (modelItems.length < 2 && !menu.classList.contains('crack-model-category-menu')) return;
    modelItems.forEach(item => knownModels.add(getModelName(item)));
    let catalogChanged = false;
    modelItems.forEach(item => {
      item.classList.add('crack-model-item');
      const name = getModelName(item);
      const explicitId = item.getAttribute('data-model-id');
      const description = item.querySelector('span.text-text_secondary')?.textContent.trim() || '';
      if (modelDescriptions.get(name) !== description || (explicitId && modelIds.get(name) !== explicitId)) catalogChanged = true;
      modelDescriptions.set(name, description);
      if (explicitId) modelIds.set(name, explicitId);
      updateFavoriteStar(item);
      updateItemScore(item);
    });
    if (catalogChanged) GM_setValue('crack-model-catalog', [...knownModels].map(name => ({ name, id: modelIds.get(name) || '', description: modelDescriptions.get(name) || '' })));

    let layout = Array.from(menu.children).find(child =>
      child.classList?.contains(LAYOUT_CLASS)
    );

    let sidebar;
    let content;

    if (!layout) {
      menu.classList.add(
        'crack-model-category-menu'
      );

      layout = document.createElement('div');
      layout.className = LAYOUT_CLASS;
      layout.setAttribute('role', 'presentation');

      sidebar = document.createElement('div');
      sidebar.className =
        'crack-model-category-sidebar';
      sidebar.setAttribute('role', 'tablist');
      sidebar.setAttribute(
        'aria-label',
        '모델 카테고리'
      );

      // Preserve the site's existing list and all original button parents.
      const nativeList = modelItems[0]?.parentElement;
      content = nativeList && nativeList !== menu && modelItems.every(item => item.parentElement === nativeList)
        ? nativeList : document.createElement('div');
      content.classList.add('crack-model-category-content');
      content.setAttribute('role', 'presentation');

      CATEGORY_DEFS.forEach(category => {
        sidebar.appendChild(
          createCategoryButton(menu, category)
        );
      });

      const settingsButton = document.createElement('button');
      settingsButton.type = 'button';
      settingsButton.className = 'crack-model-settings-open';
      settingsButton.textContent = '⚙ 설정';
      settingsButton.addEventListener('pointerdown', stopCategoryEvent);
      settingsButton.addEventListener('mousedown', stopCategoryEvent);
      settingsButton.addEventListener('click', event => {
        stopCategoryEvent(event);
        openSettings();
      });
      sidebar.append(settingsButton);
      const empty = document.createElement('p');
      empty.className = 'crack-model-empty';
      empty.textContent = '표시할 모델이 없습니다. 설정에서 모델을 표시할 수 있습니다.';
      empty.hidden = true;
      content.append(empty);

      layout.append(sidebar, content);
      menu.appendChild(layout);
    } else {
      sidebar = layout.querySelector(
        '.crack-model-category-sidebar'
      );

      content = layout.querySelector(
        '.crack-model-category-content'
      );

      if (!sidebar || !content) return;
    }

    for (const category of CATEGORY_DEFS) {
      if (![...sidebar.querySelectorAll('.crack-model-category-button')].some(button => button.dataset.category === category.id)) {
        sidebar.insertBefore(createCategoryButton(menu, category), sidebar.querySelector('.crack-model-settings-open'));
      }
    }

    /*
     * 복제하지 않고 원래 모델 버튼을 옮깁니다.
     * 따라서 기존 클릭 기능과 체크 표시가 유지됩니다.
     */
    modelItems.forEach(item => {
      const categoryId = getCategoryId(item);

      item.dataset.crackModelCategory = categoryId;

      if (item.parentElement !== content) {
        content.insertBefore(item, content.querySelector('.crack-model-empty'));
      }
    });

    const selectedItem =
      modelItems.find(isSelectedModel);
    if (selectedItem) currentModel = getModelName(selectedItem);

    const selectedCategory =
      selectedItem?.dataset.crackModelCategory;

    const currentCategory =
      menu.dataset.crackActiveCategory;

    const currentStillExists = currentCategory === 'favorites'
      ? modelItems.some(item => favoriteModels.has(getModelName(item)) && !hiddenModels.has(getModelName(item)))
      : modelItems.some(
      item =>
        item.dataset.crackModelCategory ===
        currentCategory
    );

    const firstAvailable = CATEGORY_DEFS.find(
      category =>
        modelItems.some(
          item =>
            item.dataset.crackModelCategory ===
            category.id
        )
    )?.id;

    activateCategory(
      menu,
      currentStillExists
        ? currentCategory
        : selectedCategory ||
          firstAvailable ||
          'power'
    );
  }

  function processMenus() {
    scheduled = false;

    injectStyle();
    // Reset route/editor state before reading the selected menu item.
    updateInputScore();

    if (settingsPanel && !settingsPanel.isConnected) settingsPanel = null;
    ui.resolve('modelCategory.menus').elements.forEach(categorizeMenu);
    updateInputScore();
  }

  function scheduleProcess() {
    if (scheduled) return;

    scheduled = true;
    requestAnimationFrame(processMenus);
  }

  const observer = new MutationObserver(
    scheduleProcess
  );

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  GM_registerMenuCommand('모델 표시 설정', openSettings);
  window.addEventListener('resize', positionInputScore);
  window.addEventListener('scroll', positionInputScore, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshScores(); scheduleProcess(); } });
  window.addEventListener('popstate', scheduleProcess);
  // Also catches SPA route changes and selected-model attributes without observing our own styles.
  setInterval(() => { if (!document.hidden) scheduleProcess(); }, 1000);
  setInterval(() => refreshScores(true), SCORE_INTERVAL);
  scheduleProcess();
  refreshScores();
})();
