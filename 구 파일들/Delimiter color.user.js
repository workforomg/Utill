// ==UserScript==
// @name         Delimiter color
// @namespace    https://github.com/workforomg/Utill
// @author       으악갹, gemini
// @version      1.0
// @description  구분자 색상
// @match        https://crack.wrtn.ai/stories/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const TEXT_CONTAINER_SELECTOR = '#__next > div > div.css-swctim.e1pfv5720 > main > div > div.flex.flex-row.flex-1.h-full.relative.min-w-0 > div.flex.flex-row.flex-1.h-full.min-w-0 > div > div > div > div > div.flex.flex-col.w-full.px-5.sm\\:px-10.items-center > div > div.flex.flex-col-reverse.w-full.gap-10';

    if (typeof CSS === 'undefined' || !CSS.highlights) return;

    // 1. 기본 색상 상태 (흰색 초기화: h=0, s=0, v=1)
    const defaultState = {
        dq: { h: 0, s: 0, v: 1 }, // 쌍따옴표
        sq: { h: 0, s: 0, v: 1 }, // 홀따옴표
        pr: { h: 0, s: 0, v: 1 }  // 소괄호()
    };

    let state = JSON.parse(GM_getValue('quote_highlighter_config_v2', JSON.stringify(defaultState)));
    let activeTab = 'dq';

    function hsvToRgb(h, s, v) {
        let r, g, b, i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
    }

    // 스타일 주입 (가운데 정렬 및 패널 UI 수정)
    const style = document.createElement('style');
    style.textContent = `
        ::highlight(double-quote) { color: var(--dq-color) !important; font-weight: bold; }
        ::highlight(single-quote) { color: var(--sq-color) !important; font-weight: bold; }
        ::highlight(parenthesis) { color: var(--pr-color) !important; font-weight: bold; }

        /* 패널 레이아웃 개선: 마진 auto로 가운데 정렬, 너비를 사이드바에 맞춤 */
        #qh-integrated-panel { display: none; flex-direction: column; gap: 14px; padding: 16px; background: rgba(0,0,0,0.03); border-radius: 8px; margin: 10px auto 0 auto; width: 95%; border: 1px solid rgba(0,0,0,0.08); font-family: inherit; box-sizing: border-box; align-items: center; }
        .qh-tabs { display: flex; gap: 4px; width: 100%; }
        .qh-tab { flex: 1; padding: 6px; border: 1px solid #ddd; background: #fff; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: bold; text-align: center; color: #555; white-space: nowrap; transition: all 0.2s; }
        .qh-tab.active { background: #222; color: #fff; border-color: #222; }
        .qh-wheel-container { position: relative; width: 120px; height: 120px; margin: 0 auto; }
        .qh-wheel { width: 100%; height: 100%; border-radius: 50%; background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red); position: relative; cursor: crosshair; }
        .qh-wheel::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%); }
        .qh-pointer { position: absolute; width: 8px; height: 8px; border: 2px solid #fff; background: #000; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; top: 50%; left: 50%; }
        .qh-slider-group { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: bold; color: #555; width: 100%; }
        .qh-slider { width: 100%; margin: 0; cursor: pointer; accent-color: #222; }
        .qh-preview { height: 24px; border-radius: 4px; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); width: 100%; }

        /* 초기화 버튼 스타일 */
        .qh-btn-group { display: flex; gap: 8px; width: 100%; margin-top: 4px; }
        .qh-btn { flex: 1; padding: 6px 0; font-size: 11px; font-weight: bold; cursor: pointer; border-radius: 6px; border: 1px solid #ddd; background: #fff; color: #444; transition: 0.2s; }
        .qh-btn:hover { background: #f0f0f0; }
    `;
    document.head.appendChild(style);

    function updateColors() {
        document.documentElement.style.setProperty('--dq-color', hsvToRgb(state.dq.h, state.dq.s, state.dq.v));
        document.documentElement.style.setProperty('--sq-color', hsvToRgb(state.sq.h, state.sq.s, state.sq.v));
        document.documentElement.style.setProperty('--pr-color', hsvToRgb(state.pr.h, state.pr.s, state.pr.v));
    }
    updateColors();

    // 메뉴 주입
    function injectSettingMenu() {
        const xpath = "//p[normalize-space(text())='전체 설정']";
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const targetLabel = result.singleNodeValue;

        if (!targetLabel) return;

        if (targetLabel.nextElementSibling && targetLabel.nextElementSibling.id === 'quote-color-setting-item') {
            return;
        }

        const oldMenu = document.getElementById('quote-color-setting-item');
        if (oldMenu) oldMenu.remove();

        const menuWrapper = document.createElement('div');
        menuWrapper.id = 'quote-color-setting-item';
        // 'h-4' 클래스를 제거할 수 있도록 기본 상태로 세팅
        menuWrapper.className = 'px-2.5 h-4 box-content py-[18px]';

        menuWrapper.innerHTML = `
            <div id="qh-trigger-btn" role="button" tabindex="0" class="w-full flex h-4 items-center justify-between typo-text-base_leading-none_medium space-x-2 [_svg]:fill-icon_tertiary ring-offset-4 ring-offset-sidebar cursor-pointer">
                <span class="flex space-x-2 items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="24" height="24" stroke="var(--icon_secondary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.01345 18.2515 5.41169 17.5759 6 17.0649C6.91404 16.273 8.09432 15.8333 9.33333 15.8333H14.6667C15.9057 15.8333 17.086 16.273 18 17.0649C18.5883 17.5759 18.9866 18.2515 19.1414 19M12 13C14.2091 13 16 11.2091 16 9C16 6.79086 14.2091 5 12 5C9.79086 5 8 6.79086 8 9C8 11.2091 9.79086 13 12 13Z"/></svg>
                    <span class="whitespace-nowrap overflow-hidden text-ellipsis typo-text-sm_leading-none_medium">문장 색상 설정</span>
                </span>
                <svg id="qh-arrow-icon" xmlns="http://www.w3.org/2000/svg" fill="var(--icon_primary)" viewBox="0 0 24 24" width="16" height="16" class="fill-line-gray-1" style="transition: transform 0.2s;"><path fill-rule="evenodd" d="M14.37 12 9.14 6.78l1.14-1.14L16.63 12l-6.35 6.36-1.14-1.14z" clip-rule="evenodd"></path></svg>
            </div>
            <div id="qh-integrated-panel">
                <div class="qh-tabs">
                    <div class="qh-tab active" data-target="dq">쌍따옴표 (")</div>
                    <div class="qh-tab" data-target="sq">홀따옴표 (')</div>
                    <div class="qh-tab" data-target="pr">소괄호 ()</div>
                </div>
                <div class="qh-wheel-container">
                    <div class="qh-wheel" id="qh-wheel"></div>
                    <div class="qh-pointer" id="qh-pointer"></div>
                </div>
                <div class="qh-slider-group">
                    <div style="display:flex; justify-content:space-between;"><span>명암도</span><span id="qh-val-text">100%</span></div>
                    <input type="range" class="qh-slider" id="qh-slider" min="0" max="1" step="0.01" value="1">
                </div>
                <div class="qh-preview" id="qh-preview">미리보기</div>
                <div class="qh-btn-group">
                    <button class="qh-btn" id="qh-btn-reset-current">각 초기화</button>
                    <button class="qh-btn" id="qh-btn-reset-all">전체 초기화</button>
                </div>
            </div>
        `;

        targetLabel.parentNode.insertBefore(menuWrapper, targetLabel.nextSibling);
        bindUiEvents();
    }

    function bindUiEvents() {
        const wrapper = document.getElementById('quote-color-setting-item');
        const trigger = document.getElementById('qh-trigger-btn');
        const panel = document.getElementById('qh-integrated-panel');
        const arrow = document.getElementById('qh-arrow-icon');
        const tabs = document.querySelectorAll('.qh-tab');
        const wheel = document.getElementById('qh-wheel');
        const pointer = document.getElementById('qh-pointer');
        const slider = document.getElementById('qh-slider');
        const valText = document.getElementById('qh-val-text');
        const preview = document.getElementById('qh-preview');
        const btnResetCurrent = document.getElementById('qh-btn-reset-current');
        const btnResetAll = document.getElementById('qh-btn-reset-all');

        // 패널 열기/닫기 처리 (높이 제한 해제 로직 포함)
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCurrentlyOpen = panel.style.display === 'flex';

            if (isCurrentlyOpen) {
                // 닫을 때: 원래 높이 제한(h-4) 복구
                panel.style.display = 'none';
                arrow.style.transform = 'rotate(0deg)';
                wrapper.classList.add('h-4');
                wrapper.style.height = '';
            } else {
                // 열 때: 높이 제한 해제하여 밀려남 방지
                panel.style.display = 'flex';
                arrow.style.transform = 'rotate(90deg)';
                wrapper.classList.remove('h-4');
                wrapper.style.height = 'auto';
                updateUiFromState();
            }
        });

        // 탭 전환
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                activeTab = tab.getAttribute('data-target');
                updateUiFromState();
            });
        });

        // "각 초기화" 버튼 (현재 탭만 흰색으로)
        btnResetCurrent.addEventListener('click', (e) => {
            e.stopPropagation();
            state[activeTab] = { h: 0, s: 0, v: 1 };
            updateUiFromState();
            GM_setValue('quote_highlighter_config_v2', JSON.stringify(state));
        });

        // "전체 초기화" 버튼 (모든 탭을 흰색으로)
        btnResetAll.addEventListener('click', (e) => {
            e.stopPropagation();
            state = {
                dq: { h: 0, s: 0, v: 1 },
                sq: { h: 0, s: 0, v: 1 },
                pr: { h: 0, s: 0, v: 1 }
            };
            updateUiFromState();
            GM_setValue('quote_highlighter_config_v2', JSON.stringify(state));
        });

        function updateUiFromState() {
            const curr = state[activeTab];
            slider.value = curr.v;
            valText.textContent = `${Math.round(curr.v * 100)}%`;

            const radius = wheel.offsetWidth / 2;
            const angle = curr.h * 2 * Math.PI;
            const dist = curr.s * radius;

            pointer.style.left = `${radius + Math.cos(angle) * dist}px`;
            pointer.style.top = `${radius + Math.sin(angle) * dist}px`;

            const rgb = hsvToRgb(curr.h, curr.s, curr.v);
            preview.style.backgroundColor = rgb;
            updateColors();
        }

        let isDragging = false;
        function handleWheelEvent(e) {
            const rect = wheel.getBoundingClientRect();
            const radius = rect.width / 2;
            const x = e.clientX - rect.left - radius;
            const y = e.clientY - rect.top - radius;

            let angle = Math.atan2(y, x);
            if (angle < 0) angle += 2 * Math.PI;
            const dist = Math.sqrt(x*x + y*y);

            state[activeTab].h = angle / (2 * Math.PI);
            state[activeTab].s = Math.min(1, dist / radius);

            updateUiFromState();
            GM_setValue('quote_highlighter_config_v2', JSON.stringify(state));
        }

        wheel.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            isDragging = true;
            handleWheelEvent(e);
            wheel.setPointerCapture(e.pointerId);
        });
        wheel.addEventListener('pointermove', (e) => {
            if (isDragging) { e.stopPropagation(); handleWheelEvent(e); }
        });
        wheel.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            isDragging = false;
            wheel.releasePointerCapture(e.pointerId);
        });

        slider.addEventListener('input', (e) => {
            state[activeTab].v = parseFloat(e.target.value);
            updateUiFromState();
            GM_setValue('quote_highlighter_config_v2', JSON.stringify(state));
        });
        slider.addEventListener('click', (e) => e.stopPropagation());
    }

    // 하이라이팅 엔진
    const doubleQuoteRanges = [];
    const singleQuoteRanges = [];
    const parenthesisRanges = [];
    let lastTextContent = "";

    function findQuoteRanges(node) {
        const parent = node.parentNode;
        if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(parent.tagName)) return;

        const text = node.nodeValue;
        const regex = /("[^"]*")|('[^']*')|(\([^)]*\))/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, regex.lastIndex);

            if (match[1]) doubleQuoteRanges.push(range);
            else if (match[2]) singleQuoteRanges.push(range);
            else if (match[3]) parenthesisRanges.push(range);
        }
    }

    function walkDOM(node) {
        let child = node.firstChild;
        while (child) {
            let next = child.nextSibling;
            if (child.nodeType === Node.TEXT_NODE) {
                findQuoteRanges(child);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                walkDOM(child);
            }
            child = next;
        }
    }

    function runHighlighter() {
        const container = document.querySelector(TEXT_CONTAINER_SELECTOR);
        if (!container) return;

        if (container.textContent === lastTextContent) return;
        lastTextContent = container.textContent;

        doubleQuoteRanges.length = 0;
        singleQuoteRanges.length = 0;
        parenthesisRanges.length = 0;

        walkDOM(container);

        CSS.highlights.set('double-quote', new Highlight(...doubleQuoteRanges));
        CSS.highlights.set('single-quote', new Highlight(...singleQuoteRanges));
        CSS.highlights.set('parenthesis', new Highlight(...parenthesisRanges));
    }

    // 스캔 주입 루프
    setInterval(() => {
        injectSettingMenu();
    }, 500);

    let debounceTimeout = null;
    const observer = new MutationObserver(() => {
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            runHighlighter();
        }, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
