// ==UserScript==
// @name         모델 자동 카테고리 분류
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @author       지유지요
// @description  모델 선택창을 파워/프로/슈퍼/하이퍼/페이블 카테고리로 나눕니다.
// @match        https://crack.wrtn.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const CATEGORY_DEFS = [
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

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      [role="menu"].crack-model-category-menu {
        width: min(560px, calc(100vw - 24px)) !important;
        min-width: 0 !important;
        max-width: calc(100vw - 24px) !important;
        max-height: 450px !important;
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

      .crack-model-category-content > [role="menuitem"] {
        width: 100%;
      }

      .crack-model-category-content > [role="menuitem"][hidden] {
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

    if (imageName) {
      return imageName;
    }

    const nameNode = item.querySelector(
      'span.text-text_primary, span[class*="text-text_primary"]'
    );

    return nameNode?.textContent?.trim() || '';
  }

  function getCategoryId(item) {
    const name = getModelName(item);

    return (
      CATEGORY_DEFS.find(category => category.matches(name))?.id || null
    );
  }

  function isSelectedModel(item) {
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
    menu.dataset.crackActiveCategory = categoryId;

    menu
      .querySelectorAll('.crack-model-category-button')
      .forEach(button => {
        const active = button.dataset.category === categoryId;

        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });

    menu
      .querySelectorAll(
        '.crack-model-category-content > [role="menuitem"]'
      )
      .forEach(item => {
        item.hidden =
          item.dataset.crackModelCategory !== categoryId;
      });

    const content = menu.querySelector(
      '.crack-model-category-content'
    );

    if (content) {
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
          '.crack-model-category-button'
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
      menu.querySelectorAll('[role="menuitem"]')
    );

    const modelItems = allItems.filter(item =>
      getCategoryId(item)
    );

    /*
     * 다른 드롭다운이 실수로 바뀌지 않도록
     * 모델 항목이 여러 개 있는 메뉴만 처리합니다.
     */
    if (modelItems.length < 2) return;

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

      content = document.createElement('div');
      content.className =
        'crack-model-category-content';
      content.setAttribute('role', 'presentation');

      CATEGORY_DEFS.forEach(category => {
        sidebar.appendChild(
          createCategoryButton(menu, category)
        );
      });

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

    /*
     * 복제하지 않고 원래 모델 버튼을 옮깁니다.
     * 따라서 기존 클릭 기능과 체크 표시가 유지됩니다.
     */
    modelItems.forEach(item => {
      const categoryId = getCategoryId(item);

      item.dataset.crackModelCategory = categoryId;

      if (item.parentElement !== content) {
        content.appendChild(item);
      }
    });

    const selectedItem =
      modelItems.find(isSelectedModel);

    const selectedCategory =
      selectedItem?.dataset.crackModelCategory;

    const currentCategory =
      menu.dataset.crackActiveCategory;

    const currentStillExists = modelItems.some(
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

    document
      .querySelectorAll('[role="menu"]')
      .forEach(categorizeMenu);
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

  scheduleProcess();
})();
