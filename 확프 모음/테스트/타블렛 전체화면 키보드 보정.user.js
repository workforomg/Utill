// ==UserScript==
// @name         Crack Android Keyboard Viewport Fix
// @namespace    local.crack.keyboard.viewport.fix
// @version      1.0.0
// @description  Firefox Android + 삼성 키보드에서 Crack 가상스크롤/입력창 잘림 보정
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
    'use strict';

    const CONFIG = {
        // visualViewport가 이 이상 실제로 줄어들면
        // Firefox가 키보드 높이를 정상 인식한 것으로 판단
        MIN_REAL_KEYBOARD_SHRINK: 100,

        // 전체화면 등에서 Firefox가 키보드를 못 잡을 때
        // 화면 높이의 몇 %를 키보드라고 가정할지
        AUTO_FALLBACK_RATIO: 0.36,

        MIN_FALLBACK_PX: 240,
        MAX_FALLBACK_PX: 650,

        // 입력창이 키보드와 너무 딱 붙지 않도록 여유
        BOTTOM_GAP: 6,

        DEBUG_DEFAULT: false
    };

    const STORAGE = {
        enabled: 'crackKbFix.enabled',
        fallbackPx: 'crackKbFix.fallbackPx',
        debug: 'crackKbFix.debug'
    };

    let enabled = GM_getValue(STORAGE.enabled, true);
    let debug = GM_getValue(STORAGE.debug, CONFIG.DEBUG_DEFAULT);

    let baseHeight = 0;
    let keyboardActive = false;
    let usingFallback = false;

    let rootElement = null;
    let scrollElement = null;
    let fixedComposer = null;

    let styleElement = null;
    let debugElement = null;

    let updateTimer = null;


    /* --------------------------------------------------
     * 기본 유틸
     * -------------------------------------------------- */

    function clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    }

    function getViewportHeight() {
        if (window.visualViewport) {
            return Math.round(window.visualViewport.height);
        }

        return Math.round(window.innerHeight);
    }

    function getViewportWidth() {
        if (window.visualViewport) {
            return Math.round(window.visualViewport.width);
        }

        return Math.round(window.innerWidth);
    }

    function isEditable(el) {
        if (!el || el === document.body || el === document.documentElement) {
            return false;
        }

        if (el instanceof HTMLTextAreaElement) {
            return !el.disabled && !el.readOnly;
        }

        if (el instanceof HTMLInputElement) {
            const type = (el.type || 'text').toLowerCase();

            const excluded = [
                'button',
                'checkbox',
                'radio',
                'submit',
                'reset',
                'file',
                'image',
                'range',
                'color',
                'hidden'
            ];

            return !excluded.includes(type) &&
                   !el.disabled &&
                   !el.readOnly;
        }

        return el.isContentEditable ||
               el.getAttribute?.('contenteditable') === 'true';
    }

    function getActiveEditor() {
        const el = document.activeElement;
        return isEditable(el) ? el : null;
    }


    /* --------------------------------------------------
     * fallback 키보드 높이
     * -------------------------------------------------- */

    function getFallbackHeight() {
        const manual = Number(
            GM_getValue(STORAGE.fallbackPx, 0)
        );

        if (manual > 0) {
            return manual;
        }

        const reference =
            baseHeight ||
            getViewportHeight() ||
            window.screen.height;

        return clamp(
            Math.round(
                reference *
                CONFIG.AUTO_FALLBACK_RATIO
            ),
            CONFIG.MIN_FALLBACK_PX,
            CONFIG.MAX_FALLBACK_PX
        );
    }


    /* --------------------------------------------------
     * CSS
     * -------------------------------------------------- */

    function installStyle() {
        if (styleElement || !document.documentElement) {
            return;
        }

        styleElement = document.createElement('style');

        styleElement.textContent = `

            /*
             * 키보드가 열렸을 때만 적용
             */

            html.tm-crack-kb-active {
                height: var(--tm-crack-visible-height) !important;
                max-height: var(--tm-crack-visible-height) !important;
                min-height: 0 !important;
                overflow: hidden !important;
            }

            html.tm-crack-kb-active body {
                height: 100% !important;
                max-height: 100% !important;
                min-height: 0 !important;

                overflow: hidden !important;
            }


            /*
             * React / Next 루트
             */

            html.tm-crack-kb-active
            [data-tm-crack-kb-root="1"] {
                height: 100% !important;
                max-height: 100% !important;
                min-height: 0 !important;

                overflow: hidden !important;
            }


            /*
             * flex/grid 부모가 자식의 축소를 막는 문제 해결
             */

            html.tm-crack-kb-active
            [data-tm-crack-kb-chain="1"] {
                min-height: 0 !important;
                max-height: 100% !important;
            }


            /*
             * Crack 실제/가상 스크롤 영역
             */

            html.tm-crack-kb-active
            [data-tm-crack-kb-scroll="1"] {
                min-height: 0 !important;
                max-height: 100% !important;

                overscroll-behavior-y: contain !important;
            }


            /*
             * Firefox 전체화면에서 viewport 자체가
             * 키보드 높이만큼 줄지 않는 경우.
             *
             * fixed 입력창이면 bottom을 강제로 올린다.
             */

            html.tm-crack-kb-fallback
            [data-tm-crack-kb-fixed-composer="1"] {
                bottom:
                    calc(
                        var(--tm-crack-keyboard-overlay)
                        + ${CONFIG.BOTTOM_GAP}px
                    )
                    !important;
            }

        `;

        document.documentElement.appendChild(styleElement);
    }


    /* --------------------------------------------------
     * viewport meta
     * -------------------------------------------------- */

    function patchViewportMeta() {
        const meta =
            document.querySelector(
                'meta[name="viewport"]'
            );

        if (!meta) {
            return;
        }

        const value = meta.getAttribute('content') || '';

        if (
            !value.includes('interactive-widget=')
        ) {
            meta.setAttribute(
                'content',
                value.replace(/,\s*$/, '') +
                ', interactive-widget=resizes-content'
            );
        }
    }


    /* --------------------------------------------------
     * Crack 루트 탐지
     * -------------------------------------------------- */

    function findRoot() {
        const predefined = [
            '#root',
            '#__next',
            '#app',
            '[data-reactroot]'
        ];

        for (const selector of predefined) {
            const el = document.querySelector(selector);

            if (el) {
                return el;
            }
        }

        if (!document.body) {
            return null;
        }

        const viewportW = getViewportWidth();
        const viewportH =
            baseHeight || getViewportHeight();

        let best = null;
        let bestScore = 0;

        for (const el of document.body.children) {
            if (
                el.tagName === 'SCRIPT' ||
                el.tagName === 'STYLE' ||
                el.tagName === 'LINK'
            ) {
                continue;
            }

            const rect =
                el.getBoundingClientRect();

            if (
                rect.width < viewportW * 0.55 ||
                rect.height < viewportH * 0.45
            ) {
                continue;
            }

            const score =
                rect.width * rect.height;

            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        }

        return best;
    }


    /* --------------------------------------------------
     * 입력창 → 부모 체인
     * -------------------------------------------------- */

    function markAncestorChain(editor) {
        document
            .querySelectorAll(
                '[data-tm-crack-kb-chain]'
            )
            .forEach(el => {
                el.removeAttribute(
                    'data-tm-crack-kb-chain'
                );
            });

        if (!editor) {
            return;
        }

        let el = editor.parentElement;
        let count = 0;

        while (
            el &&
            el !== document.body &&
            count < 12
        ) {
            el.setAttribute(
                'data-tm-crack-kb-chain',
                '1'
            );

            if (el === rootElement) {
                break;
            }

            el = el.parentElement;
            count++;
        }
    }


    /* --------------------------------------------------
     * 스크롤 영역 탐지
     * -------------------------------------------------- */

    function findScrollContainer() {
        if (!document.body) {
            return null;
        }

        let best = null;
        let bestScore = 0;

        const viewportW =
            getViewportWidth();

        const viewportH =
            baseHeight || getViewportHeight();

        const elements =
            document.querySelectorAll(
                'main, section, article, div'
            );

        // 너무 많은 DOM 검사 방지
        const limit =
            Math.min(elements.length, 3000);

        for (let i = 0; i < limit; i++) {
            const el = elements[i];

            const rect =
                el.getBoundingClientRect();

            if (
                rect.width < viewportW * 0.45 ||
                rect.height < 120
            ) {
                continue;
            }

            if (
                rect.bottom < 0 ||
                rect.top > viewportH
            ) {
                continue;
            }

            const cs =
                getComputedStyle(el);

            const overflowY =
                cs.overflowY;

            const scrollable =
                overflowY === 'auto' ||
                overflowY === 'scroll';

            const hasScrollRange =
                el.scrollHeight >
                el.clientHeight + 20;

            if (!scrollable && !hasScrollRange) {
                continue;
            }

            let score =
                rect.width *
                rect.height;

            if (hasScrollRange) {
                score *= 1.5;
            }

            if (scrollable) {
                score *= 1.3;
            }

            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        }

        return best;
    }


    /* --------------------------------------------------
     * fixed 입력창 탐지
     * -------------------------------------------------- */

    function findFixedComposer(editor) {
        if (!editor) {
            return null;
        }

        let el = editor;
        let depth = 0;

        while (
            el &&
            el !== document.body &&
            depth < 10
        ) {
            const cs =
                getComputedStyle(el);

            if (cs.position === 'fixed') {
                return el;
            }

            el = el.parentElement;
            depth++;
        }

        return null;
    }


    /* --------------------------------------------------
     * 요소 갱신
     * -------------------------------------------------- */

    function refreshElements() {
        rootElement = findRoot();

        if (rootElement) {
            rootElement.setAttribute(
                'data-tm-crack-kb-root',
                '1'
            );
        }

        const editor =
            getActiveEditor();

        markAncestorChain(editor);

        const newScroll =
            findScrollContainer();

        if (
            scrollElement &&
            scrollElement !== newScroll
        ) {
            scrollElement.removeAttribute(
                'data-tm-crack-kb-scroll'
            );
        }

        scrollElement = newScroll;

        if (scrollElement) {
            scrollElement.setAttribute(
                'data-tm-crack-kb-scroll',
                '1'
            );
        }

        const newComposer =
            findFixedComposer(editor);

        if (
            fixedComposer &&
            fixedComposer !== newComposer
        ) {
            fixedComposer.removeAttribute(
                'data-tm-crack-kb-fixed-composer'
            );
        }

        fixedComposer = newComposer;

        if (fixedComposer) {
            fixedComposer.setAttribute(
                'data-tm-crack-kb-fixed-composer',
                '1'
            );
        }
    }


    /* --------------------------------------------------
     * Debug
     * -------------------------------------------------- */

    function updateDebug(data) {
        if (!debug) {
            debugElement?.remove();
            debugElement = null;
            return;
        }

        if (!debugElement) {
            debugElement =
                document.createElement('div');

            Object.assign(
                debugElement.style,
                {
                    position: 'fixed',
                    top: '6px',
                    left: '6px',
                    zIndex: '2147483647',
                    padding: '5px 8px',
                    background:
                        'rgba(0,0,0,.78)',
                    color: '#fff',
                    fontSize: '11px',
                    lineHeight: '1.4',
                    borderRadius: '6px',
                    pointerEvents: 'none',
                    whiteSpace: 'pre'
                }
            );

            document.documentElement
                .appendChild(debugElement);
        }

        debugElement.textContent =
            `KB FIX\n` +
            `base: ${data.base}\n` +
            `visual: ${data.visual}\n` +
            `target: ${data.target}\n` +
            `overlay: ${data.overlay}\n` +
            `mode: ${
                data.fallback
                    ? 'FALLBACK'
                    : 'VISUAL'
            }`;
    }


    /* --------------------------------------------------
     * 핵심 높이 계산
     * -------------------------------------------------- */

    function updateViewport() {
        if (
            !enabled ||
            !document.documentElement
        ) {
            return;
        }

        installStyle();

        const editor =
            getActiveEditor();

        const visualHeight =
            getViewportHeight();

        /*
         * 키보드가 닫힌 상태에서
         * 기준 높이 계속 갱신
         */
        if (!editor) {
            keyboardActive = false;
            usingFallback = false;

            if (
                visualHeight >
                baseHeight - 30
            ) {
                baseHeight =
                    Math.max(
                        baseHeight,
                        visualHeight
                    );
            }

            restoreNormal();

            updateDebug({
                base: baseHeight,
                visual: visualHeight,
                target: visualHeight,
                overlay: 0,
                fallback: false
            });

            return;
        }

        /*
         * focus 순간 아직 키보드가
         * 열리기 전일 수 있음
         */
        if (!baseHeight) {
            baseHeight =
                visualHeight;
        }

        keyboardActive = true;

        const realShrink =
            baseHeight -
            visualHeight;

        let targetHeight;
        let overlay;


        /*
         * Firefox가 키보드 크기를
         * 정상적으로 알려주는 경우
         */
        if (
            realShrink >=
            CONFIG.MIN_REAL_KEYBOARD_SHRINK
        ) {
            usingFallback = false;

            targetHeight =
                visualHeight;

            overlay = 0;
        }


        /*
         * fullscreen Firefox 등:
         * visualViewport가 안 줄어듦
         */
        else {
            usingFallback = true;

            overlay =
                getFallbackHeight();

            targetHeight =
                baseHeight -
                overlay;
        }

        targetHeight =
            Math.max(
                250,
                Math.round(targetHeight)
            );

        refreshElements();

        document.documentElement
            .style.setProperty(
                '--tm-crack-visible-height',
                `${targetHeight}px`
            );

        document.documentElement
            .style.setProperty(
                '--tm-crack-keyboard-overlay',
                `${overlay}px`
            );

        document.documentElement
            .classList.add(
                'tm-crack-kb-active'
            );

        document.documentElement
            .classList.toggle(
                'tm-crack-kb-fallback',
                usingFallback
            );


        /*
         * 레이아웃 계산 후 입력창을
         * 다시 화면 안쪽으로 보냄
         */
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                keepEditorVisible(
                    editor,
                    targetHeight
                );
            });
        });

        updateDebug({
            base: baseHeight,
            visual: visualHeight,
            target: targetHeight,
            overlay,
            fallback: usingFallback
        });
    }


    function keepEditorVisible(
        editor,
        targetHeight
    ) {
        if (!editor?.isConnected) {
            return;
        }

        const rect =
            editor.getBoundingClientRect();

        if (
            rect.bottom >
            targetHeight -
            CONFIG.BOTTOM_GAP
        ) {
            try {
                editor.scrollIntoView({
                    behavior: 'auto',
                    block: 'nearest',
                    inline: 'nearest'
                });
            } catch (_) {}
        }
    }


    /* --------------------------------------------------
     * 원복
     * -------------------------------------------------- */

    function restoreNormal() {
        if (!document.documentElement) {
            return;
        }

        document.documentElement
            .classList.remove(
                'tm-crack-kb-active',
                'tm-crack-kb-fallback'
            );

        document.documentElement
            .style.removeProperty(
                '--tm-crack-visible-height'
            );

        document.documentElement
            .style.removeProperty(
                '--tm-crack-keyboard-overlay'
            );
    }


    /* --------------------------------------------------
     * 업데이트 예약
     * -------------------------------------------------- */

    function scheduleUpdate(delay = 0) {
        clearTimeout(updateTimer);

        updateTimer =
            setTimeout(
                updateViewport,
                delay
            );
    }


    /* --------------------------------------------------
     * 이벤트
     * -------------------------------------------------- */

    function installEvents() {

        document.addEventListener(
            'focusin',
            event => {
                if (!isEditable(event.target)) {
                    return;
                }

                /*
                 * focus 시점에는 아직
                 * 키보드 resize가 안 왔을 수 있어서
                 * 여러 차례 재계산
                 */
                scheduleUpdate(20);

                setTimeout(
                    updateViewport,
                    120
                );

                setTimeout(
                    updateViewport,
                    300
                );

                setTimeout(
                    updateViewport,
                    600
                );
            },
            true
        );


        document.addEventListener(
            'focusout',
            () => {
                setTimeout(() => {
                    if (!getActiveEditor()) {
                        restoreNormal();

                        baseHeight =
                            getViewportHeight();
                    } else {
                        updateViewport();
                    }
                }, 200);
            },
            true
        );


        window.addEventListener(
            'resize',
            () => scheduleUpdate(20),
            { passive: true }
        );


        if (window.visualViewport) {

            window.visualViewport
                .addEventListener(
                    'resize',
                    () =>
                        scheduleUpdate(10),
                    { passive: true }
                );

            window.visualViewport
                .addEventListener(
                    'scroll',
                    () =>
                        scheduleUpdate(10),
                    { passive: true }
                );
        }


        window.addEventListener(
            'orientationchange',
            () => {

                baseHeight = 0;

                setTimeout(() => {
                    if (!getActiveEditor()) {
                        baseHeight =
                            getViewportHeight();
                    }

                    updateViewport();

                }, 500);
            }
        );


        document.addEventListener(
            'fullscreenchange',
            () => {

                /*
                 * 전체화면 전환 직후
                 * 새 기준 높이 취득
                 */
                if (!getActiveEditor()) {

                    setTimeout(() => {
                        baseHeight =
                            getViewportHeight();

                        updateViewport();
                    }, 250);

                } else {

                    setTimeout(
                        updateViewport,
                        250
                    );
                }
            }
        );
    }


    /* --------------------------------------------------
     * Tampermonkey 메뉴
     * -------------------------------------------------- */

    GM_registerMenuCommand(
        enabled
            ? '✅ 키보드 화면 보정 켜짐'
            : '❌ 키보드 화면 보정 꺼짐',
        () => {
            enabled = !enabled;

            GM_setValue(
                STORAGE.enabled,
                enabled
            );

            location.reload();
        }
    );


    GM_registerMenuCommand(
        '⌨ 키보드 높이 직접 설정',
        () => {

            const current =
                GM_getValue(
                    STORAGE.fallbackPx,
                    0
                );

            const auto =
                getFallbackHeight();

            const value = prompt(
                'Firefox 전체화면에서 사용할 키보드 높이(px)\n\n' +
                '0 = 자동 계산\n' +
                `현재 자동값 ≈ ${auto}px`,
                current
            );

            if (value === null) {
                return;
            }

            const n =
                Number(value);

            if (
                Number.isFinite(n) &&
                n >= 0
            ) {
                GM_setValue(
                    STORAGE.fallbackPx,
                    Math.round(n)
                );

                updateViewport();
            }
        }
    );


    GM_registerMenuCommand(
        '↺ 키보드 높이 자동 계산으로 초기화',
        () => {

            GM_setValue(
                STORAGE.fallbackPx,
                0
            );

            updateViewport();
        }
    );


    GM_registerMenuCommand(
        debug
            ? '🐞 디버그 표시 끄기'
            : '🐞 디버그 표시 켜기',
        () => {

            debug = !debug;

            GM_setValue(
                STORAGE.debug,
                debug
            );

            location.reload();
        }
    );


    /* --------------------------------------------------
     * 시작
     * -------------------------------------------------- */

    function init() {

        installStyle();

        patchViewportMeta();

        installEvents();

        /*
         * Crack React 렌더 후 기준 높이
         */
        setTimeout(() => {

            if (!getActiveEditor()) {
                baseHeight =
                    getViewportHeight();
            }

            refreshElements();

        }, 500);
    }


    if (
        document.readyState === 'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            init,
            { once: true }
        );
    } else {
        init();
    }

})();
