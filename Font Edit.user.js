// ==UserScript==
// @name         Font Edit
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  폰트 및 사이즈 변경
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    const fontList = [
        { name: "사이트 기본", value: "" },
        { name: "맑은 고딕", value: "'Malgun Gothic', 'Apple SD Gothic Neo'" },
        { name: "나눔고딕", value: "'NanumGothic', 'Nanum Gothic'" },
        { name: "나눔스퀘어", value: "'NanumSquare', 'Nanum Square'" },
        { name: "본고딕 (Noto Sans)", value: "'Source Han Sans KR', 'Noto Sans KR'" },
        { name: "함초롬바탕", value: "'Hamchorom Batang', 'Hahmlet'" },
        { name: "굴림", value: "Gulim, dotum" },
        { name: "돋움", value: "Dotum, sans-serif" },
        { name: "바탕", value: "Batang, serif" },
        { name: "궁서", value: "Gungsuh, cursive" }
    ];

    let savedFont = GM_getValue('customFont', '');
    let savedSize = GM_getValue('customSize', '100');

    const applyGlobalStyles = () => {
        let styleTag = document.getElementById('tm-font-style-block');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'tm-font-style-block';
            document.head.appendChild(styleTag);
        }

        let css = '';
        const currentSize = Math.max(50, Math.min(parseInt(savedSize) || 100, 110));
        const ratio = currentSize / 100;

        // 1. 폰트 적용 (설정 모달은 제외)
        if (savedFont !== "") {
            css += `body *:not(#font-setting-modal *):not(.f-container *) { font-family: ${savedFont}, "Pretendard", sans-serif !important; }`;
        }

        // 2. 글씨 크기 적용 (모달 제외 및 레이아웃 붕괴 방지)
        if (currentSize !== 100) {
            css += `
                /* 본문 핵심 변수 조절 */
                :root { --wrtn-markdown-font-size: ${16 * ratio}px !important; }

                /* 텍스트 요소들만 골라 확대 (모달 내부 제외) */
                body *:not(#font-setting-modal *):not(.f-container *) {
                    /* typo- 클래스 및 주요 텍스트 클래스 대응 */
                    &[class*='typo-'], &[class*='text-primary'], &[class*='text-secondary'],
                    &[class*='text-gray-'], &.white-space-nowrap {
                        font-size: ${currentSize}% !important;
                    }
                }

                /* 태그 기반 확대 (중첩 방지를 위해 span은 inherit 처리) */
                p, textarea, input, label, em, strong, li, a {
                    &:not(#font-setting-modal *) { font-size: ${currentSize}% !important; }
                }

                span:not([class*='typo-']):not(#font-setting-modal *) { font-size: inherit; }

                /* [버그 수정] 상단 쏠림 및 텍스트 겹침 방지 */
                /* 구조적 div의 height는 건드리지 않고 텍스트 관련 div만 유연하게 설정 */
                .css-rfcrl5, .css-1fy19s2, .css-b6k6hx, .css-1821gv5, .css-v3ezgq {
                    font-size: ${currentSize}% !important;
                    line-height: 1.5 !important;
                    height: auto !important;
                }
            `;
        }
        styleTag.innerHTML = css;
    };

    applyGlobalStyles();

    // 버튼 주입 로직 (이미지 65b18d.png 위치)
    const injectButton = () => {
        if (document.getElementById('font-setting-item')) return;
        const settingsLink = document.querySelector('a[href="/setting"]');
        if (!settingsLink) return;

        const fontBtn = document.createElement('div');
        fontBtn.id = 'font-setting-item';
        fontBtn.style.cursor = 'pointer';
        fontBtn.innerHTML = `
            <div display="flex" width="100%" height="52px" class="css-fh8ctk eh9908w0">
                <div width="24px" height="24px" display="flex" class="css-3obab5 eh9908w0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--icon_secondary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
                </div>
                <span class="typo-text-base_leading-none_medium text-primary white-space-nowrap">글씨 설정</span>
                <div display="flex" class="css-13pmxen eh9908w0"></div>
                <svg xmlns="http://www.w3.org/2000/svg" fill="var(--icon_primary)" viewBox="0 0 24 24" width="16" height="16" class="fill-gray-1"><path fill-rule="evenodd" d="M14.368 12 9.144 6.776l1.131-1.132L16.631 12l-6.356 6.356-1.131-1.132z" clip-rule="evenodd"></path></svg>
            </div>
        `;
        fontBtn.onclick = (e) => { e.preventDefault(); showModal(); };
        settingsLink.parentNode.insertBefore(fontBtn, settingsLink.nextSibling);
    };

    // 모달 UI (설정 영향을 받지 않도록 별도 스타일 지정)
    const showModal = () => {
        if (document.getElementById('font-setting-modal')) return;
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'font-setting-modal';

        GM_addStyle(`
            #font-setting-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 999999; display: flex; justify-content: center; align-items: center; }
            .f-container {
                background: var(--bg_elevated_primary, #1e1e1e); border: 1px solid var(--divider_secondary, #333);
                padding: 24px; border-radius: 16px; width: 340px; color: var(--text_primary, #fff) !important;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: sans-serif !important; font-size: 14px !important;
            }
            .f-header { font-size: 18px !important; font-weight: bold !important; margin-bottom: 20px; text-align: center; font-family: sans-serif !important; }
            .f-group { margin-bottom: 18px; }
            .f-label { display: block; font-size: 13px !important; color: var(--text_secondary, #aaa) !important; margin-bottom: 8px; }
            .f-select, .f-input { width: 100%; background: var(--bg_screen, #121212); border: 1px solid var(--outline_secondary, #444); color: #fff !important; padding: 10px; border-radius: 8px; box-sizing: border-box; font-size: 14px !important; font-family: sans-serif !important; }
            .f-footer { display: flex; gap: 10px; margin-top: 20px; }
            .f-btn { flex: 1; padding: 12px; border-radius: 8px; cursor: pointer; border: none; font-weight: bold !important; font-size: 14px !important; }
            .f-btn-save { background: var(--surface_brand_primary, #ff4432); color: #fff !important; }
            .f-btn-cancel { background: var(--surface_secondary, #333); color: #fff !important; }
            .f-info { font-size: 11px !important; color: var(--text_tertiary, #888) !important; margin-top: 8px; line-height: 1.4 !important; }
        `);

        modalOverlay.innerHTML = `
            <div class="f-container">
                <div class="f-header">글씨 설정</div>
                <div class="f-group">
                    <label class="f-label">폰트 선택</label>
                    <select id="sel-font" class="f-select"></select>
                </div>
                <div class="f-group">
                    <label class="f-label">글씨 크기 (%)</label>
                    <input type="number" id="inp-size" class="f-input" value="${savedSize}" min="50" max="110">
                    <div class="f-info">
                        • 사이트 기본값: 100%<br>
                        • 설정 범위: 50% ~ 110%
                    </div>
                </div>
                <div class="f-footer">
                    <button id="btn-cancel" class="f-btn f-btn-cancel">취소</button>
                    <button id="btn-save" class="f-btn f-btn-save">저장</button>
                </div>
            </div>
        `;
        document.body.appendChild(modalOverlay);

        const fontSelect = document.getElementById('sel-font');
        fontList.forEach(font => {
            const opt = document.createElement('option');
            opt.value = font.value;
            opt.textContent = font.name;
            if (font.value === savedFont) opt.selected = true;
            fontSelect.appendChild(opt);
        });

        document.getElementById('btn-save').onclick = () => {
            savedFont = fontSelect.value;
            let val = parseInt(document.getElementById('inp-size').value);
            savedSize = Math.max(50, Math.min(val, 110));
            GM_setValue('customFont', savedFont);
            GM_setValue('customSize', savedSize);
            applyGlobalStyles();
            modalOverlay.remove();
        };
        document.getElementById('btn-cancel').onclick = () => modalOverlay.remove();
    };

    setInterval(injectButton, 1000);
})();