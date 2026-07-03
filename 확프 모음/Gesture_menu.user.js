// ==UserScript==
// @name         Gesture Menu
// @namespace    https://github.com/workforomg/Utill
// @version      0.7
// @description  제스처 메뉴 베이스 + 외부 스크립트 등록 API
// @match        https://crack.wrtn.ai/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  /***********************
   * 설정
   ***********************/
  const DOUBLE_CLICK_MAX_INTERVAL = 350;

  const TWO_FINGER_SWIPE_MIN_DISTANCE = 80;
  const TWO_FINGER_SWIPE_MAX_SIDE_DISTANCE = 90;
  const TWO_FINGER_MAX_START_GAP = 220;

  const DETAIL_BACK_SWIPE_MIN_DISTANCE = 70;
  const DETAIL_BACK_SWIPE_MAX_VERTICAL = 80;

  const EXTERNAL_ROOT =
    typeof unsafeWindow !== 'undefined'
      ? unsafeWindow
      : window;

  let lastClickTime = 0;
  let twoFingerGesture = null;
  let detailBackSwipe = null;

  let selectedCategoryId = 'user';
  let selectedItemId = null;
  let detailOpen = false;

  const externalActionHandlers = new Map();

  /***********************
   * 카테고리 별칭
   ***********************/
  const CATEGORY_ALIAS = {
    user: 'user',
    '유저': 'user',

    create: 'create',
    production: 'create',
    '제작': 'create',

    chat: 'chat',
    '채팅': 'chat',

    etc: 'etc',
    other: 'etc',
    '기타': 'etc',

    settings: 'settings',
    setting: 'settings',
    config: 'settings',
    '설정': 'settings'
  };

  function normalizeCategoryId(categoryId) {
    const key = String(categoryId || '').trim();
    return CATEGORY_ALIAS[key] || key || 'etc';
  }

  /***********************
   * 메뉴 데이터
   ***********************/
  const MENU_DATA = [
    {
      id: 'user',
      name: '유저',
      items: [
        {
          id: 'user-profile',
          title: '유저 정보',
          desc: '현재 유저 관련 기능을 모아두는 영역입니다.',
          content: '프로필, 닉네임, 활동 정보, 개인 UI 기능 등을 여기에 연결하면 됩니다.',
          buttons: [
            { label: '유저 정보 확인', action: 'user-profile' }
          ]
        },
        {
          id: 'user-library',
          title: '보관함',
          desc: '보관함 관련 기능을 넣는 영역입니다.',
          content: '보관함 접기, 검색, 정렬, 숨김 처리 같은 기능을 연결하기 좋습니다.',
          buttons: [
            { label: '보관함 기능 실행', action: 'user-library' }
          ]
        }
      ]
    },
    {
      id: 'create',
      name: '제작',
      items: [
        {
          id: 'create-tools',
          title: '제작 도구',
          desc: '작품 제작 보조 기능입니다.',
          content: '프롬프트 보조, 이미지 치환, 작품 편집 보조 기능 등을 연결할 수 있습니다.',
          buttons: [
            { label: '제작 도구 실행', action: 'create-tools' }
          ]
        },
        {
          id: 'create-image',
          title: '이미지 관리',
          desc: '이미지 관련 기능입니다.',
          content: '내부 이미지 정리, 이미지 ID 복사, 폴더 기반 이미지 호출 기능 등을 넣기 좋습니다.',
          buttons: [
            { label: '이미지 기능 실행', action: 'create-image' }
          ]
        }
      ]
    },
    {
      id: 'chat',
      name: '채팅',
      items: [
        {
          id: 'chat-scroll',
          title: '스크롤 보조',
          desc: '채팅 스크롤 관련 기능입니다.',
          content: '자동 스크롤, 특정 응답 위치 이동, 누락 감지 같은 기능을 여기에 연결할 수 있습니다.',
          buttons: [
            { label: '스크롤 기능 실행', action: 'chat-scroll' }
          ]
        },
        {
          id: 'chat-input',
          title: '입력창 보조',
          desc: '채팅 입력창 관련 기능입니다.',
          content: '프롬프트 삽입, 템플릿 호출, 입력창 확장 같은 기능을 넣을 수 있습니다.',
          buttons: [
            { label: '입력창 기능 실행', action: 'chat-input' }
          ]
        }
      ]
    },
    {
      id: 'etc',
      name: '기타',
      items: [
        {
          id: 'etc-temp',
          title: '임시 기능',
          desc: '테스트용 기능 영역입니다.',
          content: '아직 분류가 정해지지 않은 기능을 임시로 넣어두면 됩니다.',
          buttons: [
            { label: '임시 기능 실행', action: 'etc-temp' }
          ]
        },
        {
          id: 'etc-help',
          title: '도움말',
          desc: '메뉴 사용법입니다.',
          content: 'PC는 빈 공간 더블클릭, 모바일은 두 손가락 위/아래 슬라이드로 메뉴를 열 수 있습니다.',
          buttons: [
            { label: '도움말 확인', action: 'etc-help' }
          ]
        }
      ]
    },
    {
      id: 'settings',
      name: '설정',
      items: [
        {
          id: 'settings-gesture',
          title: '제스처 설정',
          desc: '제스처 민감도 관련 영역입니다.',
          content: '더블클릭 간격, 두 손가락 슬라이드 거리, 복귀 스와이프 거리 등을 코드 상단 설정값에서 조정할 수 있습니다.',
          buttons: [
            { label: '설정 확인', action: 'settings-gesture' }
          ]
        },
        {
          id: 'settings-about',
          title: '메뉴 정보',
          desc: '스크립트 정보입니다.',
          content: 'Gesture Menu 0.7 / 외부 스크립트 등록 API가 포함된 카테고리형 메뉴입니다.',
          buttons: [
            { label: '버전 확인', action: 'settings-about' }
          ]
        }
      ]
    }
  ];

  /***********************
   * 스타일
   ***********************/
  GM_addStyle(`
    #tmGestureMenuOverlay {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: none;
      align-items: center;
      justify-content: center;
      background:
        radial-gradient(circle at top, rgba(255,255,255,0.08), transparent 36%),
        rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    #tmGestureMenu {
      --tm-bg: rgba(18, 18, 22, 0.96);
      --tm-bg-2: rgba(28, 28, 34, 0.96);
      --tm-bg-3: rgba(38, 38, 46, 0.92);
      --tm-line: rgba(255, 255, 255, 0.09);
      --tm-line-strong: rgba(255, 255, 255, 0.15);
      --tm-text: rgba(255, 255, 255, 0.94);
      --tm-muted: rgba(255, 255, 255, 0.56);
      --tm-muted-2: rgba(255, 255, 255, 0.38);
      --tm-accent: #8f7cff;
      --tm-accent-2: rgba(143, 124, 255, 0.18);

      position: relative;
      width: min(980px, calc(100vw - 26px));
      height: min(680px, calc(100dvh - 32px));
      overflow: hidden;
      display: flex;
      flex-direction: column;
      color: var(--tm-text);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.045), transparent 24%),
        var(--tm-bg);
      border: 1px solid var(--tm-line);
      border-radius: 22px;
      box-shadow:
        0 24px 90px rgba(0, 0, 0, 0.56),
        inset 0 1px 0 rgba(255,255,255,0.06);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .tmGestureHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 15px 16px 13px;
      border-bottom: 1px solid var(--tm-line);
      background: rgba(255,255,255,0.025);
    }

    .tmGestureHeaderTitle {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .tmGestureHeaderTitle strong {
      font-size: 15px;
      font-weight: 750;
      letter-spacing: -0.02em;
    }

    .tmGestureHeaderTitle span {
      font-size: 12px;
      color: var(--tm-muted);
    }

    .tmGestureTopActions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tmGestureIconBtn {
      width: 34px;
      height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--tm-line);
      border-radius: 12px;
      color: var(--tm-text);
      background: rgba(255,255,255,0.055);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      transition:
        background 180ms ease,
        border-color 180ms ease,
        transform 180ms ease;
    }

    .tmGestureIconBtn:hover {
      background: rgba(255,255,255,0.1);
      border-color: var(--tm-line-strong);
    }

    .tmGestureIconBtn:active {
      transform: scale(0.96);
    }

    .tmGestureBody {
      position: relative;
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 170px minmax(230px, 280px) 0fr;
      transition: grid-template-columns 260ms cubic-bezier(0.25, 0.1, 0.25, 1);
    }

    #tmGestureMenu.tmDetailOpen .tmGestureBody {
      grid-template-columns: 0px minmax(230px, 280px) 1fr;
    }

    .tmGestureCategoryPanel,
    .tmGestureListPanel,
    .tmGestureContentPanel {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .tmGestureCategoryPanel {
      border-right: 1px solid var(--tm-line);
      background: rgba(255,255,255,0.018);
      transition:
        opacity 220ms ease,
        transform 260ms cubic-bezier(0.25, 0.1, 0.25, 1);
    }

    #tmGestureMenu.tmDetailOpen .tmGestureCategoryPanel {
      opacity: 0;
      transform: translateX(-24px);
      pointer-events: none;
    }

    .tmGestureCategoryInner,
    .tmGestureListInner,
    .tmGestureContentInner {
      height: 100%;
      overflow: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.24) transparent;
    }

    .tmGestureCategoryInner::-webkit-scrollbar,
    .tmGestureListInner::-webkit-scrollbar,
    .tmGestureContentInner::-webkit-scrollbar {
      width: 8px;
    }

    .tmGestureCategoryInner::-webkit-scrollbar-thumb,
    .tmGestureListInner::-webkit-scrollbar-thumb,
    .tmGestureContentInner::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.2);
      border-radius: 999px;
    }

    .tmGestureSectionLabel {
      padding: 14px 14px 8px;
      font-size: 11px;
      font-weight: 700;
      color: var(--tm-muted-2);
      letter-spacing: 0.04em;
    }

    .tmGestureCategoryList,
    .tmGestureItemList {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 0 10px 12px;
    }

    .tmGestureCategoryBtn,
    .tmGestureItemBtn {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 14px;
      color: var(--tm-text);
      background: transparent;
      cursor: pointer;
      text-align: left;
      transition:
        background 170ms ease,
        border-color 170ms ease,
        transform 170ms ease;
    }

    .tmGestureCategoryBtn {
      padding: 12px 12px;
      font-size: 14px;
      font-weight: 700;
    }

    .tmGestureCategoryBtn:hover,
    .tmGestureItemBtn:hover {
      background: rgba(255,255,255,0.055);
    }

    .tmGestureCategoryBtn.tmActive {
      background: var(--tm-accent-2);
      border-color: rgba(143,124,255,0.32);
      color: #fff;
    }

    .tmGestureItemBtn {
      padding: 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .tmGestureItemBtn strong {
      display: block;
      font-size: 14px;
      font-weight: 750;
      letter-spacing: -0.015em;
    }

    .tmGestureItemBtn span {
      display: -webkit-box;
      overflow: hidden;
      color: var(--tm-muted);
      font-size: 12px;
      line-height: 1.38;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .tmGestureItemBtn.tmActive {
      background: rgba(255,255,255,0.07);
      border-color: var(--tm-line-strong);
    }

    .tmGestureListPanel {
      border-right: 1px solid var(--tm-line);
      background: rgba(0,0,0,0.08);
    }

    .tmGestureContentPanel {
      position: relative;
      opacity: 0;
      pointer-events: none;
      background:
        linear-gradient(135deg, rgba(143,124,255,0.09), transparent 36%),
        rgba(255,255,255,0.012);
      transition: opacity 220ms ease;
    }

    #tmGestureMenu.tmDetailOpen .tmGestureContentPanel {
      opacity: 1;
      pointer-events: auto;
    }

    .tmGestureContentInner {
      padding: 22px 24px 24px 54px;
    }

    .tmGestureContentCard {
      min-height: 100%;
      border: 1px solid var(--tm-line);
      border-radius: 18px;
      background: rgba(255,255,255,0.035);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
      overflow: hidden;
    }

    .tmGestureContentHero {
      padding: 20px 20px 16px;
      border-bottom: 1px solid var(--tm-line);
      background:
        radial-gradient(circle at top left, rgba(143,124,255,0.18), transparent 34%),
        rgba(255,255,255,0.025);
    }

    .tmGestureContentHero small {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      padding: 5px 9px;
      margin-bottom: 10px;
      border: 1px solid rgba(143,124,255,0.34);
      border-radius: 999px;
      background: rgba(143,124,255,0.14);
      color: rgba(255,255,255,0.76);
      font-size: 11px;
      font-weight: 700;
    }

    .tmGestureContentHero h3 {
      margin: 0;
      font-size: 22px;
      line-height: 1.22;
      letter-spacing: -0.035em;
    }

    .tmGestureContentHero p {
      margin: 8px 0 0;
      color: var(--tm-muted);
      font-size: 13px;
      line-height: 1.55;
    }

    .tmGestureContentMain {
      padding: 18px 20px 20px;
    }

    .tmGestureContentText {
      margin: 0;
      color: rgba(255,255,255,0.78);
      font-size: 14px;
      line-height: 1.7;
      white-space: pre-line;
    }

    .tmGestureActionArea {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      margin-top: 18px;
    }

    .tmGestureActionBtn {
      border: 1px solid var(--tm-line-strong);
      border-radius: 12px;
      padding: 10px 12px;
      color: var(--tm-text);
      background: rgba(255,255,255,0.065);
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
      transition:
        background 170ms ease,
        transform 170ms ease,
        border-color 170ms ease;
    }

    .tmGestureActionBtn:hover {
      background: rgba(255,255,255,0.11);
      border-color: rgba(255,255,255,0.22);
    }

    .tmGestureActionBtn:active {
      transform: scale(0.97);
    }

    #tmGestureBackBtn {
      position: absolute;
      left: 12px;
      top: 50%;
      z-index: 3;
      width: 34px;
      height: 58px;
      display: none;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--tm-line-strong);
      border-radius: 999px;
      color: var(--tm-text);
      background: rgba(20,20,24,0.78);
      box-shadow: 0 8px 28px rgba(0,0,0,0.35);
      cursor: pointer;
      font-size: 26px;
      line-height: 1;
      transform: translateY(-50%);
      transition:
        background 170ms ease,
        transform 170ms ease,
        opacity 170ms ease;
    }

    #tmGestureMenu.tmDetailOpen #tmGestureBackBtn {
      display: flex;
    }

    #tmGestureBackBtn:hover {
      background: rgba(44,44,52,0.92);
    }

    #tmGestureBackBtn:active {
      transform: translateY(-50%) scale(0.95);
    }

    .tmGestureEmpty {
      height: 100%;
      min-height: 240px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: var(--tm-muted);
      text-align: center;
      font-size: 13px;
      line-height: 1.6;
    }

    .tmGestureToast {
      position: absolute;
      left: 50%;
      bottom: 18px;
      z-index: 5;
      max-width: min(420px, calc(100% - 32px));
      padding: 10px 13px;
      border: 1px solid var(--tm-line);
      border-radius: 999px;
      color: var(--tm-text);
      background: rgba(18,18,22,0.92);
      box-shadow: 0 10px 35px rgba(0,0,0,0.35);
      font-size: 12px;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, 10px);
      transition:
        opacity 180ms ease,
        transform 180ms ease;
    }

    .tmGestureToast.tmShow {
      opacity: 1;
      transform: translate(-50%, 0);
    }

    @media (max-width: 720px) {
      #tmGestureMenu {
        width: calc(100vw - 14px);
        height: calc(100dvh - 20px);
        border-radius: 18px;
      }

      .tmGestureHeader {
        padding: 13px 13px 11px;
      }

      .tmGestureHeaderTitle strong {
        font-size: 14px;
      }

      .tmGestureHeaderTitle span {
        font-size: 11px;
      }

      .tmGestureBody {
        grid-template-columns: 112px minmax(0, 1fr) 0fr;
      }

      #tmGestureMenu.tmDetailOpen .tmGestureBody {
        grid-template-columns: 0px minmax(126px, 42vw) 1fr;
      }

      .tmGestureCategoryList,
      .tmGestureItemList {
        padding-left: 7px;
        padding-right: 7px;
      }

      .tmGestureCategoryBtn {
        padding: 11px 9px;
        font-size: 13px;
      }

      .tmGestureItemBtn {
        padding: 11px 9px;
      }

      .tmGestureItemBtn strong {
        font-size: 13px;
      }

      .tmGestureItemBtn span {
        font-size: 11px;
      }

      .tmGestureContentInner {
        padding: 16px 13px 18px 46px;
      }

      .tmGestureContentHero {
        padding: 16px 15px 13px;
      }

      .tmGestureContentHero h3 {
        font-size: 19px;
      }

      .tmGestureContentMain {
        padding: 15px;
      }

      #tmGestureBackBtn {
        left: 8px;
        width: 30px;
        height: 52px;
        font-size: 24px;
      }
    }
  `);

  /***********************
   * DOM 생성
   ***********************/
  const overlay = document.createElement('div');
  overlay.id = 'tmGestureMenuOverlay';

  overlay.innerHTML = `
    <div id="tmGestureMenu" aria-modal="true" role="dialog">
      <div class="tmGestureHeader">
        <div class="tmGestureHeaderTitle">
          <strong>제스처 메뉴</strong>
          <span>카테고리를 고르고 제목을 누르면 상세 메뉴가 열립니다.</span>
        </div>

        <div class="tmGestureTopActions">
          <button class="tmGestureIconBtn" id="tmGestureMenuClose" type="button" title="닫기">×</button>
        </div>
      </div>

      <button id="tmGestureBackBtn" type="button" title="이전">‹</button>

      <div class="tmGestureBody">
        <section class="tmGestureCategoryPanel">
          <div class="tmGestureCategoryInner">
            <div class="tmGestureSectionLabel">CATEGORY</div>
            <div class="tmGestureCategoryList" id="tmGestureCategoryList"></div>
          </div>
        </section>

        <section class="tmGestureListPanel">
          <div class="tmGestureListInner">
            <div class="tmGestureSectionLabel">TITLE</div>
            <div class="tmGestureItemList" id="tmGestureItemList"></div>
          </div>
        </section>

        <section class="tmGestureContentPanel">
          <div class="tmGestureContentInner" id="tmGestureContentInner">
            <div class="tmGestureEmpty">
              왼쪽 제목을 선택하면 내용이 표시됩니다.
            </div>
          </div>
        </section>
      </div>

      <div class="tmGestureToast" id="tmGestureToast"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  const menu = overlay.querySelector('#tmGestureMenu');
  const categoryList = overlay.querySelector('#tmGestureCategoryList');
  const itemList = overlay.querySelector('#tmGestureItemList');
  const contentInner = overlay.querySelector('#tmGestureContentInner');
  const toast = overlay.querySelector('#tmGestureToast');

  /***********************
   * 유틸
   ***********************/
  function getCategoryById(categoryId) {
    return MENU_DATA.find(category => category.id === categoryId) || MENU_DATA[0];
  }

  function getItemById(category, itemId) {
    if (!category || !category.items) return null;
    return category.items.find(item => item.id === itemId) || null;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('tmShow');

    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => {
      toast.classList.remove('tmShow');
    }, 1600);
  }

  function refreshMenuIfNeeded() {
    renderAll();
  }

  /***********************
   * 외부 등록용 정리 함수
   ***********************/
  function normalizeExternalItem(rawItem) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};

    const id = String(item.id || item.action || makeId('external-item'));
    const title = String(item.title || item.name || '외부 기능');
    const desc = String(item.desc || item.description || '');
    const content = String(item.content || item.body || desc || title);

    let buttons = [];

    if (Array.isArray(item.buttons)) {
      buttons = item.buttons.map(button => ({
        label: String(button.label || button.title || '실행'),
        action: String(button.action || id)
      }));
    } else {
      buttons = [
        {
          label: String(item.buttonLabel || '실행'),
          action: String(item.action || id)
        }
      ];
    }

    return {
      id,
      title,
      desc,
      content,
      buttons,
      source: String(item.source || 'external')
    };
  }

  function upsertCategory(categoryInput) {
    const raw = categoryInput && typeof categoryInput === 'object'
      ? categoryInput
      : { id: categoryInput };

    const id = normalizeCategoryId(raw.id || raw.name || 'etc');
    const name = String(raw.name || raw.title || id);

    let category = MENU_DATA.find(item => item.id === id);

    if (!category) {
      category = {
        id,
        name,
        items: []
      };
      MENU_DATA.push(category);
    } else if (raw.name || raw.title) {
      category.name = name;
    }

    return category;
  }

  function registerItem(categoryId, rawItem) {
    const normalizedCategoryId = normalizeCategoryId(categoryId);
    const category = upsertCategory({
      id: normalizedCategoryId,
      name: getCategoryDisplayName(normalizedCategoryId)
    });

    const item = normalizeExternalItem(rawItem);
    const existingIndex = category.items.findIndex(oldItem => oldItem.id === item.id);

    if (existingIndex >= 0) {
      category.items[existingIndex] = {
        ...category.items[existingIndex],
        ...item
      };
    } else {
      category.items.push(item);
    }

    refreshMenuIfNeeded();
    return item.id;
  }

  function registerCategory(categoryInput) {
    const category = upsertCategory(categoryInput);
    refreshMenuIfNeeded();
    return category.id;
  }

  function registerAction(action, handler) {
    if (!action || typeof handler !== 'function') {
      return false;
    }

    externalActionHandlers.set(String(action), handler);
    return true;
  }

  function getCategoryDisplayName(categoryId) {
    switch (categoryId) {
      case 'user':
        return '유저';
      case 'create':
        return '제작';
      case 'chat':
        return '채팅';
      case 'etc':
        return '기타';
      case 'settings':
        return '설정';
      default:
        return categoryId;
    }
  }

  /***********************
   * 렌더링
   ***********************/
  function renderCategories() {
    categoryList.innerHTML = MENU_DATA.map(category => {
      const activeClass = category.id === selectedCategoryId ? 'tmActive' : '';

      return `
        <button
          class="tmGestureCategoryBtn ${activeClass}"
          type="button"
          data-category-id="${escapeHtml(category.id)}"
        >
          ${escapeHtml(category.name)}
        </button>
      `;
    }).join('');
  }

  function renderItems() {
    const category = getCategoryById(selectedCategoryId);

    itemList.innerHTML = category.items.map(item => {
      const activeClass = item.id === selectedItemId ? 'tmActive' : '';

      return `
        <button
          class="tmGestureItemBtn ${activeClass}"
          type="button"
          data-item-id="${escapeHtml(item.id)}"
        >
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.desc || '')}</span>
        </button>
      `;
    }).join('');
  }

  function renderContent() {
    const category = getCategoryById(selectedCategoryId);
    const item = getItemById(category, selectedItemId);

    if (!item) {
      contentInner.innerHTML = `
        <div class="tmGestureEmpty">
          왼쪽 제목을 선택하면 내용이 표시됩니다.
        </div>
      `;
      return;
    }

    const buttons = Array.isArray(item.buttons) ? item.buttons : [];

    contentInner.innerHTML = `
      <div class="tmGestureContentCard">
        <div class="tmGestureContentHero">
          <small>${escapeHtml(category.name)}</small>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.desc || '')}</p>
        </div>

        <div class="tmGestureContentMain">
          <p class="tmGestureContentText">${escapeHtml(item.content || '')}</p>

          ${
            buttons.length
              ? `
                <div class="tmGestureActionArea">
                  ${buttons.map(button => `
                    <button
                      class="tmGestureActionBtn"
                      type="button"
                      data-action="${escapeHtml(button.action)}"
                    >
                      ${escapeHtml(button.label)}
                    </button>
                  `).join('')}
                </div>
              `
              : ''
          }
        </div>
      </div>
    `;
  }

  function renderAll() {
    renderCategories();
    renderItems();
    renderContent();
    menu.classList.toggle('tmDetailOpen', detailOpen);
  }

  /***********************
   * 메뉴 열기/닫기/상태 전환
   ***********************/
  function openMenu() {
    overlay.style.display = 'flex';

    if (!selectedCategoryId) {
      selectedCategoryId = MENU_DATA[0].id;
    }

    renderAll();
  }

  function closeMenu() {
    overlay.style.display = 'none';
    closeDetail();
  }

  function openDetail(itemId) {
    selectedItemId = itemId;
    detailOpen = true;
    renderAll();
  }

  function closeDetail() {
    detailOpen = false;
    selectedItemId = null;
    detailBackSwipe = null;
    renderAll();
  }

  /***********************
   * 실제 기능 연결부
   ***********************/
  function runMenuAction(action) {
    const actionName = String(action || '');

    switch (actionName) {
      case 'user-profile':
        showToast('유저 정보 기능 연결 위치');
        return;

      case 'user-library':
        showToast('보관함 기능 연결 위치');
        return;

      case 'create-tools':
        showToast('제작 도구 기능 연결 위치');
        return;

      case 'create-image':
        showToast('이미지 관리 기능 연결 위치');
        return;

      case 'chat-scroll':
        showToast('스크롤 보조 기능 연결 위치');
        return;

      case 'chat-input':
        showToast('입력창 보조 기능 연결 위치');
        return;

      case 'etc-temp':
        showToast('임시 기능 연결 위치');
        return;

      case 'etc-help':
        showToast('PC: 빈 공간 더블클릭 / 모바일: 두 손가락 위아래 슬라이드');
        return;

      case 'settings-gesture':
        showToast('상단 설정값에서 제스처 민감도를 조정할 수 있음');
        return;

      case 'settings-about':
        showToast('Gesture Menu 0.7');
        return;

      default:
        break;
    }

    const handler = externalActionHandlers.get(actionName);

    if (handler) {
      try {
        handler({
          action: actionName,
          categoryId: selectedCategoryId,
          itemId: selectedItemId
        });
      } catch (error) {
        console.error('[Gesture Menu] external action error:', error);
        showToast('외부 기능 실행 중 오류 발생');
      }
      return;
    }

    document.dispatchEvent(new CustomEvent('TMGestureMenuAction', {
      detail: {
        action: actionName,
        categoryId: selectedCategoryId,
        itemId: selectedItemId
      }
    }));

    showToast(`외부 액션 호출: ${actionName}`);
  }

  /***********************
   * 메뉴 이벤트
   ***********************/
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) {
      closeMenu();
      return;
    }

    if (!(e.target instanceof Element)) return;

    const close = e.target.closest('#tmGestureMenuClose');
    if (close) {
      closeMenu();
      return;
    }

    const back = e.target.closest('#tmGestureBackBtn');
    if (back) {
      closeDetail();
      return;
    }

    const categoryButton = e.target.closest('.tmGestureCategoryBtn');
    if (categoryButton) {
      selectedCategoryId = categoryButton.dataset.categoryId;
      selectedItemId = null;
      detailOpen = false;
      renderAll();
      return;
    }

    const itemButton = e.target.closest('.tmGestureItemBtn');
    if (itemButton) {
      openDetail(itemButton.dataset.itemId);
      return;
    }

    const actionButton = e.target.closest('.tmGestureActionBtn');
    if (actionButton) {
      runMenuAction(actionButton.dataset.action);
    }
  });

  /***********************
   * 상세 화면 모바일 복귀 스와이프
   ***********************/
  menu.addEventListener('touchstart', function (e) {
    if (!detailOpen) return;
    if (!e.touches || e.touches.length !== 1) return;

    const t = e.touches[0];

    detailBackSwipe = {
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY
    };
  }, { passive: true, capture: true });

  menu.addEventListener('touchmove', function (e) {
    if (!detailBackSwipe) return;
    if (!e.touches || e.touches.length !== 1) return;

    const t = e.touches[0];

    detailBackSwipe.lastX = t.clientX;
    detailBackSwipe.lastY = t.clientY;
  }, { passive: true, capture: true });

  menu.addEventListener('touchend', function () {
    if (!detailBackSwipe) return;

    const diffX = detailBackSwipe.lastX - detailBackSwipe.startX;
    const diffY = detailBackSwipe.lastY - detailBackSwipe.startY;

    const isRightSwipe = diffX >= DETAIL_BACK_SWIPE_MIN_DISTANCE;
    const isMostlyHorizontal = Math.abs(diffY) <= DETAIL_BACK_SWIPE_MAX_VERTICAL;

    if (isRightSwipe && isMostlyHorizontal) {
      closeDetail();
    }

    detailBackSwipe = null;
  }, { passive: true, capture: true });

  menu.addEventListener('touchcancel', function () {
    detailBackSwipe = null;
  }, { passive: true, capture: true });

  /***********************
   * 제스처 허용 영역 판정
   ***********************/
  function isGestureBlockedArea(target) {
    if (!target || !(target instanceof Element)) {
      return false;
    }

    if (target.closest('#tmGestureMenuOverlay')) {
      return true;
    }

    const blockedSelector = [
      'button',
      'a',
      'input',
      'textarea',
      'select',
      'option',
      'label',
      'summary',
      'details',

      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[role="tab"]',
      '[role="combobox"]',
      '[role="listbox"]',
      '[role="option"]',

      '[aria-expanded]',
      '[aria-controls]',
      '[data-expanded]',
      '[data-state="open"]',
      '[data-state="closed"]',
      '[data-headlessui-state]',
      '[data-radix-collection-item]',
      '[data-accordion]',
      '[data-collapsible]',

      '[onclick]',
      '[contenteditable="true"]'
    ].join(',');

    if (target.closest(blockedSelector)) {
      return true;
    }

    const className = String(target.className || '').toLowerCase();
    const parentClassName = String(target.parentElement?.className || '').toLowerCase();

    const expandableWords = [
      'accordion',
      'collapse',
      'collapsible',
      'dropdown',
      'fold',
      'expand',
      'toggle',
      'menu',
      'select'
    ];

    if (expandableWords.some(word => className.includes(word) || parentClassName.includes(word))) {
      return true;
    }

    return false;
  }

  function isGestureAllowedArea(target) {
    return !isGestureBlockedArea(target);
  }

  function getDistance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /***********************
   * PC: 버튼/펼침요소가 아닌 곳 더블클릭
   ***********************/
  document.addEventListener('click', function (e) {
    const now = Date.now();

    if (!isGestureAllowedArea(e.target)) {
      lastClickTime = 0;
      return;
    }

    if (now - lastClickTime <= DOUBLE_CLICK_MAX_INTERVAL) {
      openMenu();
      lastClickTime = 0;
      return;
    }

    lastClickTime = now;
  }, true);

  /***********************
   * 모바일: 두 손가락 위/아래 슬라이드
   ***********************/
  document.addEventListener('touchstart', function (e) {
    if (!e.touches || e.touches.length !== 2) {
      twoFingerGesture = null;
      return;
    }

    if (!isGestureAllowedArea(e.target)) {
      twoFingerGesture = null;
      return;
    }

    const t1 = e.touches[0];
    const t2 = e.touches[1];

    const startGap = getDistance(
      t1.clientX,
      t1.clientY,
      t2.clientX,
      t2.clientY
    );

    if (startGap > TWO_FINGER_MAX_START_GAP) {
      twoFingerGesture = null;
      return;
    }

    twoFingerGesture = {
      target: e.target,

      start1X: t1.clientX,
      start1Y: t1.clientY,
      start2X: t2.clientX,
      start2Y: t2.clientY,

      last1X: t1.clientX,
      last1Y: t1.clientY,
      last2X: t2.clientX,
      last2Y: t2.clientY
    };
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', function (e) {
    if (!twoFingerGesture) return;
    if (!e.touches || e.touches.length !== 2) return;

    const t1 = e.touches[0];
    const t2 = e.touches[1];

    twoFingerGesture.last1X = t1.clientX;
    twoFingerGesture.last1Y = t1.clientY;
    twoFingerGesture.last2X = t2.clientX;
    twoFingerGesture.last2Y = t2.clientY;
  }, { passive: true, capture: true });

  document.addEventListener('touchend', function () {
    if (!twoFingerGesture) return;

    const diffX1 = twoFingerGesture.last1X - twoFingerGesture.start1X;
    const diffY1 = twoFingerGesture.last1Y - twoFingerGesture.start1Y;

    const diffX2 = twoFingerGesture.last2X - twoFingerGesture.start2X;
    const diffY2 = twoFingerGesture.last2Y - twoFingerGesture.start2Y;

    const absX1 = Math.abs(diffX1);
    const absY1 = Math.abs(diffY1);

    const absX2 = Math.abs(diffX2);
    const absY2 = Math.abs(diffY2);

    const sameDirection =
      Math.sign(diffY1) === Math.sign(diffY2);

    const finger1Vertical =
      absY1 >= TWO_FINGER_SWIPE_MIN_DISTANCE &&
      absX1 <= TWO_FINGER_SWIPE_MAX_SIDE_DISTANCE;

    const finger2Vertical =
      absY2 >= TWO_FINGER_SWIPE_MIN_DISTANCE &&
      absX2 <= TWO_FINGER_SWIPE_MAX_SIDE_DISTANCE;

    if (sameDirection && finger1Vertical && finger2Vertical) {
      openMenu();
    }

    twoFingerGesture = null;
  }, { passive: true, capture: true });

  document.addEventListener('touchcancel', function () {
    twoFingerGesture = null;
  }, { passive: true, capture: true });

  /***********************
   * 외부 API 공개
   ***********************/
  EXTERNAL_ROOT.TMGestureMenu = {
    version: '0.7',

    open: openMenu,
    close: closeMenu,
    closeDetail,

    registerCategory,
    registerItem,
    registerAction,

    getData() {
      return MENU_DATA;
    },

    refresh() {
      renderAll();
    }
  };

  document.dispatchEvent(new CustomEvent('TMGestureMenuReady', {
    detail: {
      version: '0.7'
    }
  }));

  renderAll();

})();