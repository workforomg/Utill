// ==UserScript==
// @name         크랙 메인 UX 정리
// @namespace    local.crack.home.ux
// @version      0.1.0
// @description  크랙 메인의 설치 배너를 숨기고 카테고리, 프로모션, 반응형 카드 배치를 정리합니다.
// @author       Local
// @match        https://crack.wrtn.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_ID = 'crx-home-ux';
  const STYLE_ID = `${SCRIPT_ID}-style`;
  const PANEL_ID = `${SCRIPT_ID}-panel`;
  const DRAWER_ID = `${SCRIPT_ID}-drawer`;
  const HOME_PATH = '/';

  const DISCOVERY = [
    '성인',
    '추천',
    '취향저격',
    '신규 랭킹',
    '전체 랭킹',
    '오늘 신작',
    '남성 인기',
    '여성 인기',
  ];

  const GENRES = [
    'SF/판타지',
    '일상/현대',
    '시뮬레이션',
    '로맨스',
    'GL',
    'BL',
    '1:1 롤플레잉',
    '로판',
    '무협',
    '시대',
    '2차 창작',
    '유틸리티',
    '기타',
    'QWER',
  ];

  const ALL_CATEGORY_LABELS = new Set([...DISCOVERY, ...GENRES]);
  const FEATURE_NAMES = {
    banner: '배너',
    notice: '공지',
    promotion: '프로모션',
  };

  let refreshTimer = 0;
  let observer = null;
  let currentPath = location.pathname;
  let openFeature = null;

  const css = `
    :root {
      --crx-bg: #171716;
      --crx-surface: #252523;
      --crx-surface-2: #30302d;
      --crx-border: rgba(255, 255, 255, 0.12);
      --crx-text: #f4f4f2;
      --crx-muted: #aaa9a4;
      --crx-brand: #ff4f48;
      --crx-focus: #ffffff;
    }

    .crx-install-banner-hidden,
    .crx-feature-source-hidden,
    .crx-original-category-hidden {
      display: none !important;
    }

    html.crx-drawer-lock,
    html.crx-drawer-lock body {
      overflow: hidden !important;
    }

    #${PANEL_ID} {
      box-sizing: border-box;
      width: 100%;
      color: var(--crx-text);
      background: var(--crx-bg);
      border: 1px solid var(--crx-border);
      border-radius: 14px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 11px;
    }

    #${PANEL_ID} *,
    #${DRAWER_ID} * {
      box-sizing: border-box;
    }

    .crx-quick-menu,
    .crx-category-line {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-width: 0;
    }

    .crx-menu-label {
      flex: 0 0 52px;
      padding-top: 9px;
      color: var(--crx-muted);
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: -0.02em;
    }

    .crx-menu-items {
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }

    .crx-category-button,
    .crx-feature-button {
      min-height: 36px;
      border: 1px solid var(--crx-border);
      border-radius: 999px;
      padding: 8px 12px;
      color: var(--crx-text);
      background: var(--crx-surface);
      font: inherit;
      font-size: 13px;
      font-weight: 650;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      transition: border-color 150ms ease, background-color 150ms ease, transform 150ms ease;
      -webkit-tap-highlight-color: transparent;
    }

    .crx-category-button:hover,
    .crx-feature-button:hover {
      border-color: rgba(255, 255, 255, 0.3);
      background: var(--crx-surface-2);
    }

    .crx-category-button:focus-visible,
    .crx-feature-button:focus-visible,
    .crx-drawer-close:focus-visible {
      outline: 2px solid var(--crx-focus);
      outline-offset: 2px;
    }

    .crx-category-button[aria-current='page'] {
      border-color: var(--crx-brand);
      color: #fff;
      background: var(--crx-brand);
    }

    .crx-feature-button {
      min-width: 76px;
      border-radius: 10px;
    }

    .crx-feature-button[disabled] {
      color: #6f6f6a;
      background: #222220;
      cursor: default;
      opacity: 0.6;
    }

    #${DRAWER_ID}[hidden] {
      display: none !important;
    }

    #${DRAWER_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483600;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(6px);
    }

    .crx-drawer-shell {
      width: min(920px, 100%);
      max-height: min(780px, calc(100vh - 48px));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: var(--crx-text);
      background: var(--crx-bg);
      border: 1px solid var(--crx-border);
      border-radius: 18px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.52);
    }

    .crx-drawer-header {
      min-height: 60px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 16px 12px 20px;
      border-bottom: 1px solid var(--crx-border);
    }

    .crx-drawer-title {
      margin: 0;
      color: var(--crx-text);
      font-size: 18px;
      font-weight: 750;
    }

    .crx-drawer-close {
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 10px;
      color: var(--crx-text);
      background: var(--crx-surface);
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
    }

    .crx-drawer-content {
      padding: 18px;
      overflow: auto;
      overscroll-behavior: contain;
    }

    .crx-feature-clone {
      display: block !important;
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .crx-empty-feature {
      min-height: 180px;
      display: grid;
      place-items: center;
      color: var(--crx-muted);
      text-align: center;
    }

    .crx-card-viewport {
      overscroll-behavior-inline: contain;
      scrollbar-width: thin;
    }

    .crx-card-slide img {
      content-visibility: auto;
    }

    .crx-render-section {
      content-visibility: auto;
      contain-intrinsic-size: auto 560px;
    }

    @media (max-width: 1024px) and (orientation: portrait) {
      .crx-nav-host {
        position: relative !important;
        top: auto !important;
        z-index: 1 !important;
        padding-top: 10px !important;
      }

      #${PANEL_ID} {
        width: calc(100% - 32px);
        margin-inline: 16px;
        padding: 12px;
      }

      .crx-quick-menu,
      .crx-category-line {
        flex-direction: column;
        gap: 7px;
      }

      .crx-menu-label {
        flex-basis: auto;
        padding-top: 0;
      }

      .crx-menu-items {
        width: 100%;
      }

      .crx-category-button,
      .crx-feature-button {
        min-height: 40px;
        padding: 9px 12px;
        font-size: 13px;
      }

      .crx-card-region,
      .crx-card-viewport {
        overflow: visible !important;
      }

      .crx-card-track {
        width: 100% !important;
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 22px 12px !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: none !important;
        transition: none !important;
      }

      .crx-card-slide {
        width: auto !important;
        min-width: 0 !important;
        max-width: none !important;
        flex: none !important;
        padding: 0 !important;
      }

      .crx-card-region > button,
      .crx-card-region > [role='button'][aria-label*='다음'],
      .crx-card-region > [role='button'][aria-label*='이전'] {
        display: none !important;
      }

      #${DRAWER_ID} {
        align-items: end;
        padding: 0;
      }

      .crx-drawer-shell {
        width: 100%;
        max-height: 88vh;
        border-radius: 18px 18px 0 0;
      }
    }

    @media (min-width: 600px) and (max-width: 1024px) and (orientation: portrait) {
      .crx-card-track {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        gap: 24px 14px !important;
      }
    }

    @media (max-width: 1366px) and (orientation: landscape) {
      .crx-card-viewport {
        overflow-x: auto !important;
        scroll-snap-type: x proximity;
        -webkit-overflow-scrolling: touch;
      }

      .crx-card-track {
        width: max-content !important;
        display: flex !important;
        gap: 12px !important;
        margin: 0 !important;
        padding: 0 2px 8px !important;
        transform: none !important;
        transition: none !important;
      }

      .crx-card-slide {
        width: clamp(132px, 18vw, 188px) !important;
        min-width: clamp(132px, 18vw, 188px) !important;
        max-width: clamp(132px, 18vw, 188px) !important;
        flex: 0 0 clamp(132px, 18vw, 188px) !important;
        padding: 0 !important;
        scroll-snap-align: start;
      }

      .crx-card-region > button {
        display: none !important;
      }
    }

    @media (max-width: 480px) {
      #${PANEL_ID} {
        width: calc(100% - 24px);
        margin-inline: 12px;
      }

      .crx-menu-items {
        gap: 6px;
      }

      .crx-category-button {
        flex: 1 0 auto;
        min-width: calc(25% - 6px);
        padding-inline: 9px;
      }

      .crx-feature-button {
        flex: 1 1 0;
      }

      .crx-drawer-content {
        padding: 14px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #${PANEL_ID} *,
      #${DRAWER_ID} * {
        scroll-behavior: auto !important;
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;

  function isHome() {
    const isFixture = document.documentElement.dataset.crxFixture === 'true';
    return isFixture || (location.hostname === 'crack.wrtn.ai' && location.pathname === HOME_PATH);
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function exactText(element, text) {
    return element?.textContent?.trim() === text;
  }

  function allElementsWithExactText(text, root = document) {
    return [...root.querySelectorAll('button, a, p, span')].filter((element) =>
      exactText(element, text),
    );
  }

  function findCategorySource() {
    const candidates = [...document.querySelectorAll('[role="region"]')]
      .map((region) => {
        const buttons = [...region.querySelectorAll('button')];
        const score = buttons.reduce(
          (total, button) => total + Number(ALL_CATEGORY_LABELS.has(button.textContent.trim())),
          0,
        );
        return { region, score };
      })
      .filter(({ score }) => score >= 5)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.region ?? null;
  }

  function isSourceButtonActive(button) {
    const classes = button.className?.toString() ?? '';
    return (
      button.getAttribute('aria-current') === 'page' ||
      button.getAttribute('aria-pressed') === 'true' ||
      /(^|\s)bg-brand(\s|$)/.test(classes) ||
      /border-brand/.test(classes)
    );
  }

  function currentSourceButton(label) {
    const source = findCategorySource();
    if (!source) return null;
    return [...source.querySelectorAll('button')].find((button) =>
      exactText(button, label),
    ) ?? null;
  }

  function categoryButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'crx-category-button';
    button.textContent = label;
    button.dataset.crxCategory = label;
    const sourceButton = currentSourceButton(label);
    if (sourceButton && isSourceButtonActive(sourceButton)) {
      button.setAttribute('aria-current', 'page');
    }
    button.addEventListener('click', () => {
      const current = currentSourceButton(label);
      if (!current) return;
      current.click();
      window.setTimeout(scheduleRefresh, 80);
    });
    return button;
  }

  function menuLine(label, labels) {
    const line = document.createElement('div');
    line.className = 'crx-category-line';

    const title = document.createElement('div');
    title.className = 'crx-menu-label';
    title.textContent = label;

    const items = document.createElement('div');
    items.className = 'crx-menu-items';
    for (const itemLabel of labels) {
      if (currentSourceButton(itemLabel)) items.appendChild(categoryButton(itemLabel));
    }

    line.append(title, items);
    return line;
  }

  function featureButton(kind) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'crx-feature-button';
    button.dataset.crxFeature = kind;
    button.textContent = FEATURE_NAMES[kind];
    button.disabled = !findFeatureSource(kind);
    button.addEventListener('click', () => openDrawer(kind));
    return button;
  }

  function quickMenu() {
    const line = document.createElement('div');
    line.className = 'crx-quick-menu';

    const title = document.createElement('div');
    title.className = 'crx-menu-label';
    title.textContent = '바로가기';

    const items = document.createElement('div');
    items.className = 'crx-menu-items';
    items.append(featureButton('banner'), featureButton('notice'), featureButton('promotion'));

    line.append(title, items);
    return line;
  }

  function buildCategoryPanel(source) {
    document.getElementById(PANEL_ID)?.remove();

    const panel = document.createElement('nav');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', '크랙 메인 빠른 메뉴와 카테고리');
    panel.append(quickMenu(), menuLine('탐색', DISCOVERY), menuLine('장르', GENRES));

    source.parentElement?.insertBefore(panel, source);
    source.classList.add('crx-original-category-hidden');
    source.parentElement?.parentElement?.classList.add('crx-nav-host');
  }

  function findInstallBanner() {
    const textNodes = allElementsWithExactText('앱에서 더 편하게 몰입해 보세요');
    for (const textNode of textNodes) {
      let node = textNode.parentElement;
      for (let level = 0; node && level < 6; level += 1, node = node.parentElement) {
        const hasDownload = [...node.querySelectorAll('button, a')].some((element) =>
          exactText(element, '다운로드'),
        );
        const height = node.getBoundingClientRect().height;
        if (hasDownload && height > 30 && height < 160) return node;
      }
    }
    return null;
  }

  function findBannerSource() {
    const control = document.querySelector(
      'button[aria-label="이전 배너"], button[aria-label="다음 배너"]',
    );
    if (!control) return null;

    let node = control.parentElement;
    for (let level = 0; node && level < 8; level += 1, node = node.parentElement) {
      const hasControls = Boolean(
        node.querySelector(
          'button[aria-label="이전 배너"], button[aria-label="다음 배너"]',
        ),
      );
      const rect = node.getBoundingClientRect();
      if (hasControls && rect.height >= 180 && rect.height <= 520) return node;
    }
    return null;
  }

  function findNoticeSource() {
    const link = [...document.querySelectorAll('a[href*="/announcement/"]')].find(
      (anchor) => anchor.textContent.trim().length > 0,
    );
    if (!link) return null;
    return link.closest('[data-wrtn-imp-id]') ?? link;
  }

  function findPromotionSource() {
    const headings = [...document.querySelectorAll('p')].filter((element) => {
      const text = element.textContent.trim();
      return text.length <= 50 && (/광고.*작품/i.test(text) || /프로모션.*작품/i.test(text));
    });

    for (const heading of headings) {
      let node = heading.parentElement;
      for (let level = 0; node && level < 7; level += 1, node = node.parentElement) {
        const cardCount = node.querySelectorAll(
          '[aria-roledescription="slide"], [role="button"]',
        ).length;
        const rect = node.getBoundingClientRect();
        if (cardCount >= 1 && rect.height > 120 && rect.height < 800) return node;
      }
    }
    return null;
  }

  function findFeatureSource(kind) {
    const marked = document.querySelector(`[data-crx-feature-source="${kind}"]`);
    if (marked && !marked.closest(`#${DRAWER_ID}`)) return marked;
    if (kind === 'banner') return findBannerSource();
    if (kind === 'notice') return findNoticeSource();
    if (kind === 'promotion') return findPromotionSource();
    return null;
  }

  function markFeatureSources() {
    for (const kind of Object.keys(FEATURE_NAMES)) {
      const source = findFeatureSource(kind);
      if (!source || source.closest(`#${DRAWER_ID}`)) continue;
      source.classList.add('crx-feature-source-hidden');
      source.dataset.crxFeatureSource = kind;
    }
  }

  function removeDuplicateIds(root) {
    if (root.id) root.removeAttribute('id');
    for (const element of root.querySelectorAll('[id]')) element.removeAttribute('id');
  }

  function cloneFeature(source) {
    const clickables = [
      ...source.querySelectorAll('a, button, [role="button"]'),
    ];
    clickables.forEach((element, index) => {
      element.dataset.crxProxyIndex = String(index);
    });

    const clone = source.cloneNode(true);
    clone.classList.remove('crx-feature-source-hidden');
    clone.classList.add('crx-feature-clone');
    clone.removeAttribute('data-crx-feature-source');
    removeDuplicateIds(clone);

    clone.addEventListener('click', (event) => {
      const target = event.target.closest('[data-crx-proxy-index]');
      if (!target) return;
      const sourceTarget = source.querySelector(
        `[data-crx-proxy-index="${CSS.escape(target.dataset.crxProxyIndex)}"]`,
      );
      if (!sourceTarget) return;

      closeDrawer();
      if (target.tagName === 'A' && target.href) return;
      event.preventDefault();
      event.stopPropagation();
      sourceTarget.click();
    });

    return clone;
  }

  function ensureDrawer() {
    let drawer = document.getElementById(DRAWER_ID);
    if (drawer) return drawer;

    drawer = document.createElement('div');
    drawer.id = DRAWER_ID;
    drawer.hidden = true;
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.innerHTML = `
      <section class="crx-drawer-shell">
        <header class="crx-drawer-header">
          <h2 class="crx-drawer-title"></h2>
          <button class="crx-drawer-close" type="button" aria-label="닫기">×</button>
        </header>
        <div class="crx-drawer-content"></div>
      </section>
    `;

    drawer.querySelector('.crx-drawer-close').addEventListener('click', closeDrawer);
    drawer.addEventListener('click', (event) => {
      if (event.target === drawer) closeDrawer();
    });
    document.body.appendChild(drawer);
    return drawer;
  }

  function openDrawer(kind) {
    const source = findFeatureSource(kind);
    if (!source) return;

    const drawer = ensureDrawer();
    const title = drawer.querySelector('.crx-drawer-title');
    const content = drawer.querySelector('.crx-drawer-content');
    title.textContent = FEATURE_NAMES[kind];
    content.replaceChildren(cloneFeature(source));
    drawer.hidden = false;
    document.documentElement.classList.add('crx-drawer-lock');
    openFeature = kind;
    drawer.querySelector('.crx-drawer-close').focus({ preventScroll: true });
  }

  function closeDrawer() {
    const drawer = document.getElementById(DRAWER_ID);
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    drawer.querySelector('.crx-drawer-content')?.replaceChildren();
    document.documentElement.classList.remove('crx-drawer-lock');
    const trigger = document.querySelector(
      `#${PANEL_ID} [data-crx-feature="${openFeature}"]`,
    );
    openFeature = null;
    trigger?.focus({ preventScroll: true });
  }

  function candidateCardItems(region) {
    const slides = [...region.querySelectorAll('[aria-roledescription="slide"]')];
    if (slides.length >= 2) return slides;

    const directCards = [...region.children].filter((element) =>
      element.matches('a, button, [role="button"]'),
    );
    return directCards.length >= 2 ? directCards : [];
  }

  function markCardRegions() {
    const categorySource = findCategorySource();
    const featureSources = new Set(
      Object.keys(FEATURE_NAMES).map(findFeatureSource).filter(Boolean),
    );

    for (const region of document.querySelectorAll('[role="region"]')) {
      if (region === categorySource) continue;
      if ([...featureSources].some((source) => source === region || source.contains(region))) continue;

      const items = candidateCardItems(region);
      if (items.length < 2) continue;
      const imageCount = items.reduce(
        (total, item) => total + Number(Boolean(item.querySelector('img'))),
        0,
      );
      if (imageCount < 2) continue;

      const track = items[0].parentElement;
      if (!track || !items.every((item) => item.parentElement === track)) continue;

      region.classList.add('crx-card-region');
      track.classList.add('crx-card-track');
      for (const item of items) item.classList.add('crx-card-slide');

      if (track !== region && track.parentElement) {
        track.parentElement.classList.add('crx-card-viewport');
      }

      const section = region.parentElement;
      if (section && !section.closest('[data-crx-feature-source]')) {
        section.classList.add('crx-render-section');
      }
    }
  }

  function optimizeImages() {
    const viewportHeight = window.innerHeight;
    for (const image of document.images) {
      if (image.closest(`#${DRAWER_ID}`)) continue;
      image.decoding = 'async';
      const rect = image.getBoundingClientRect();
      if (rect.top > viewportHeight * 1.25) {
        image.loading = 'lazy';
        image.fetchPriority = 'low';
      }
    }
  }

  function syncFeatureButtons() {
    for (const button of document.querySelectorAll(`#${PANEL_ID} [data-crx-feature]`)) {
      button.disabled = !findFeatureSource(button.dataset.crxFeature);
    }
  }

  function syncCategoryButtons() {
    for (const button of document.querySelectorAll(`#${PANEL_ID} [data-crx-category]`)) {
      const sourceButton = currentSourceButton(button.dataset.crxCategory);
      if (sourceButton && isSourceButtonActive(sourceButton)) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    }
  }

  function removeEnhancements() {
    closeDrawer();
    document.getElementById(PANEL_ID)?.remove();
    for (const element of document.querySelectorAll(
      '.crx-install-banner-hidden, .crx-feature-source-hidden, .crx-original-category-hidden',
    )) {
      element.classList.remove(
        'crx-install-banner-hidden',
        'crx-feature-source-hidden',
        'crx-original-category-hidden',
      );
    }
    for (const element of document.querySelectorAll(
      '.crx-nav-host, .crx-card-region, .crx-card-viewport, .crx-card-track, .crx-card-slide, .crx-render-section',
    )) {
      element.classList.remove(
        'crx-nav-host',
        'crx-card-region',
        'crx-card-viewport',
        'crx-card-track',
        'crx-card-slide',
        'crx-render-section',
      );
    }
  }

  function refresh() {
    refreshTimer = 0;
    if (!isHome()) {
      removeEnhancements();
      return;
    }

    addStyle();
    findInstallBanner()?.classList.add('crx-install-banner-hidden');
    markFeatureSources();

    const categorySource = findCategorySource();
    if (categorySource) {
      const panel = document.getElementById(PANEL_ID);
      if (!panel || !panel.isConnected) buildCategoryPanel(categorySource);
      categorySource.classList.add('crx-original-category-hidden');
    }

    markCardRegions();
    optimizeImages();
    syncCategoryButtons();
    syncFeatureButtons();
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = window.setTimeout(refresh, 90);
  }

  function watchRoute() {
    const check = () => {
      if (location.pathname === currentPath) return;
      currentPath = location.pathname;
      scheduleRefresh();
    };

    window.addEventListener('popstate', check);
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      check();
      return result;
    };
    history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      check();
      return result;
    };
  }

  function start() {
    addStyle();
    ensureDrawer();
    watchRoute();
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDrawer();
    });
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleRefresh, { passive: true });
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
