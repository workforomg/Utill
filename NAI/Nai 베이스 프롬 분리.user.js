// ==UserScript==
// @name         NovelAI 베이스 프롬 분리
// @namespace    https://github.com/workforomg/Utill
// @version      0.5.0
// @author       지유지요
// @description  NAI Base Prompt를 메인/공통으로 분리하고 원본 Base Prompt는 보기 전용으로 사용
// @match        https://novelai.net/image*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'nai-split-base-prompt-panel';
    const STYLE_ID = 'nai-split-base-prompt-style';

    const STORAGE_COMMON = 'nai_split_base_common_prompt';
    const STORAGE_COLLAPSED = 'nai_split_base_native_collapsed';

    const SEPARATOR = ', ';

    let commonPrompt = GM_getValue(STORAGE_COMMON, '');
    let nativeCollapsed = GM_getValue(STORAGE_COLLAPSED, true);

    let nativeEditor = null;
    let nativeEditorContainer = null;

    let mainTextarea = null;
    let commonTextarea = null;

    let syncTimer = null;
    let mountScheduled = false;
    let internalWrite = false;


    // =========================================================
    // Prompt 정리
    // =========================================================

    function flattenPrompt(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r\n?/g, '\n')
            .replace(/\n+/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .trim();
    }


    // =========================================================
    // 병합
    //
    // 메인 뒤에는 자동으로 ", "가 붙고
    // 그 다음 공통 Prompt가 들어간다.
    // =========================================================

    function mergePrompt(main, common) {
        let a = flattenPrompt(main);
        const b = flattenPrompt(common);

        /*
         * 사용자가 메인 끝에 직접 쉼표를 넣어도
         * 중복 쉼표가 생기지 않도록 제거.
         */
        a = a.replace(/,\s*$/, '');

        if (!a) return b;
        if (!b) return a;

        return a + SEPARATOR + b;
    }


    // =========================================================
    // 최초 로드 시 기존 합쳐진 원본에서
    // 저장된 공통 Prompt를 한 번만 제거
    // =========================================================

    function stripCommonOnce(nativeText, common) {
        const native = flattenPrompt(nativeText);
        const shared = flattenPrompt(common);

        if (!shared) {
            return native;
        }

        if (native === shared) {
            return '';
        }

        const suffix = SEPARATOR + shared;

        if (native.endsWith(suffix)) {
            return native
                .slice(0, -suffix.length)
                .trim()
                .replace(/,\s*$/, '');
        }

        return native;
    }


    // =========================================================
    // NAI 원본 Base Prompt 찾기
    // =========================================================

    function findNativeBasePrompt() {
        const editors = [
            ...document.querySelectorAll(
                '.ProseMirror[contenteditable="true"]'
            )
        ];

        return editors[0] || null;
    }


    // =========================================================
    // 원본 읽기
    // =========================================================

    function readNativePrompt() {
        if (
            !nativeEditor ||
            !nativeEditor.isConnected
        ) {
            nativeEditor = findNativeBasePrompt();
        }

        if (!nativeEditor) {
            return '';
        }

        return flattenPrompt(
            nativeEditor.innerText ||
            nativeEditor.textContent ||
            ''
        );
    }


    // =========================================================
    // 원본 쓰기
    // =========================================================

    function writeNativePrompt(text) {
        if (
            !nativeEditor ||
            !nativeEditor.isConnected
        ) {
            nativeEditor = findNativeBasePrompt();
        }

        if (!nativeEditor) {
            return false;
        }

        const finalText = flattenPrompt(text);
        const currentText = readNativePrompt();

        if (currentText === finalText) {
            return true;
        }

        internalWrite = true;

        try {
            const paragraph = document.createElement('p');

            if (finalText) {
                paragraph.textContent = finalText;
            } else {
                paragraph.appendChild(
                    document.createElement('br')
                );
            }

            nativeEditor.replaceChildren(paragraph);

            nativeEditor.dispatchEvent(
                new InputEvent('input', {
                    bubbles: true,
                    composed: true,
                    inputType: 'insertText',
                    data: finalText
                })
            );

            nativeEditor.dispatchEvent(
                new Event('change', {
                    bubbles: true
                })
            );

        } catch (error) {
            console.error(
                '[NAI Split Prompt] 원본 동기화 실패:',
                error
            );

            internalWrite = false;
            return false;
        }

        requestAnimationFrame(() => {
            internalWrite = false;
        });

        return true;
    }


    // =========================================================
    // 메인 + 공통 → NAI 원본
    // =========================================================

    function syncToNative() {
        if (
            !mainTextarea ||
            !commonTextarea
        ) {
            return;
        }

        const merged = mergePrompt(
            mainTextarea.value,
            commonTextarea.value
        );

        writeNativePrompt(merged);
    }


    function scheduleSync() {
        clearTimeout(syncTimer);

        syncTimer = setTimeout(
            syncToNative,
            120
        );
    }


    // =========================================================
    // 원본 Base Prompt 편집 금지
    //
    // 보기만 가능.
    // 선택/복사는 가능.
    // =========================================================

    function makeNativeReadOnly() {
        if (!nativeEditor) {
            return;
        }

        /*
         * contenteditable=false로 만들면
         * 텍스트 선택/복사는 가능하지만
         * 직접 입력은 불가능.
         */

        nativeEditor.setAttribute(
            'contenteditable',
            'false'
        );

        nativeEditor.setAttribute(
            'data-nai-split-readonly',
            'true'
        );

        nativeEditor.style.cursor = 'text';

        /*
         * 혹시 NAI React가 contenteditable을
         * 다시 true로 돌리는 경우 대비.
         */

        const observer = new MutationObserver(() => {
            if (
                nativeEditor &&
                nativeEditor.isConnected &&
                nativeEditor.getAttribute('contenteditable') !== 'false'
            ) {
                nativeEditor.setAttribute(
                    'contenteditable',
                    'false'
                );
            }
        });

        observer.observe(
            nativeEditor,
            {
                attributes: true,
                attributeFilter: [
                    'contenteditable'
                ]
            }
        );

        /*
         * 키보드 입력 방어.
         */
        nativeEditor.addEventListener(
            'beforeinput',
            event => {
                if (!internalWrite) {
                    event.preventDefault();
                }
            },
            true
        );

        nativeEditor.addEventListener(
            'paste',
            event => {
                if (!internalWrite) {
                    event.preventDefault();
                }
            },
            true
        );

        nativeEditor.addEventListener(
            'drop',
            event => {
                if (!internalWrite) {
                    event.preventDefault();
                }
            },
            true
        );
    }


    // =========================================================
    // 원본 접기 / 펼치기
    // =========================================================

    function applyNativeCollapsedState() {
        if (!nativeEditorContainer) {
            return;
        }

        const button = document.getElementById(
            'nai-split-native-toggle'
        );

        if (nativeCollapsed) {
            nativeEditorContainer.style.display = 'none';

            if (button) {
                button.textContent =
                    '▶ 합쳐진 Base Prompt 보기';
            }

        } else {
            nativeEditorContainer.style.display = '';

            if (button) {
                button.textContent =
                    '▼ 합쳐진 Base Prompt 숨기기';
            }
        }
    }


    function toggleNativePrompt() {
        nativeCollapsed = !nativeCollapsed;

        GM_setValue(
            STORAGE_COLLAPSED,
            nativeCollapsed
        );

        applyNativeCollapsedState();
    }


    // =========================================================
    // textarea 자동 높이
    // =========================================================

    function autoResize(textarea) {
        if (!textarea) {
            return;
        }

        textarea.style.height = 'auto';

        textarea.style.height =
            Math.min(
                Math.max(
                    textarea.scrollHeight,
                    90
                ),
                420
            ) + 'px';
    }


    // =========================================================
    // CSS
    // =========================================================

    function addStyle() {
        if (
            document.getElementById(
                STYLE_ID
            )
        ) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;

        style.textContent = `

            #${PANEL_ID} {
                width: 100%;
                box-sizing: border-box;
                margin: 8px 0;
                font-family: inherit;
                color: inherit;
            }

            #${PANEL_ID} * {
                box-sizing: border-box;
            }

            .nai-split-native-toggle {
                width: 100%;
                height: 31px;

                margin-bottom: 7px;
                padding: 0 10px;

                display: flex;
                align-items: center;

                border:
                    1px solid
                    rgba(255,255,255,.10);

                border-radius: 6px;

                background:
                    rgba(255,255,255,.035);

                color: inherit;

                font: inherit;
                font-size: 11px;

                cursor: pointer;
                opacity: .72;

                text-align: left;
            }

            .nai-split-native-toggle:hover {
                opacity: 1;

                background:
                    rgba(255,255,255,.06);
            }

            .nai-split-box {
                width: 100%;

                margin-bottom: 7px;
                padding: 9px;

                border:
                    1px solid
                    rgba(255,255,255,.11);

                border-radius: 7px;

                background:
                    rgba(0,0,0,.10);
            }

            .nai-split-box:last-child {
                margin-bottom: 0;
            }

            .nai-split-head {
                display: flex;
                align-items: center;
                justify-content: space-between;

                gap: 8px;

                margin-bottom: 6px;
            }

            .nai-split-title {
                font-size: 12px;
                font-weight: 700;
            }

            .nai-split-desc {
                font-size: 10px;
                opacity: .48;
            }

            .nai-split-info {
                margin-top: 6px;

                font-size: 10px;
                line-height: 1.4;

                opacity: .48;
            }

            .nai-split-textarea {
                display: block;

                width: 100%;

                min-height: 90px;
                max-height: 420px;

                padding: 9px 10px;

                resize: none;
                overflow-y: auto;

                border:
                    1px solid
                    rgba(255,255,255,.13);

                border-radius: 5px;

                outline: none;

                background:
                    rgba(0,0,0,.15);

                color: inherit;

                font: inherit;
                font-size: 13px;

                line-height: 1.45;
                white-space: pre-wrap;
            }

            .nai-split-textarea:focus {
                border-color:
                    rgba(255,255,255,.33);
            }

            .nai-split-textarea::placeholder {
                color:
                    rgba(255,255,255,.28);
            }

            [data-nai-split-readonly="true"] {
                user-select: text !important;
                -webkit-user-select: text !important;

                opacity: .82;
            }

        `;

        document.head?.appendChild(style);
    }


    // =========================================================
    // UI 생성
    // =========================================================

    function createPanel(initialMain) {
        const panel = document.createElement('div');

        panel.id = PANEL_ID;

        panel.innerHTML = `

            <button
                type="button"
                id="nai-split-native-toggle"
                class="nai-split-native-toggle"
            >
                ▶ 합쳐진 Base Prompt 보기
            </button>


            <div class="nai-split-box">

                <div class="nai-split-head">

                    <span class="nai-split-title">
                        메인 프롬프트
                    </span>

                    <span class="nai-split-desc">
                        먼저 들어감
                    </span>

                </div>

                <textarea
                    id="nai-split-main-prompt"
                    class="nai-split-textarea"
                    spellcheck="false"
                    placeholder="작가태그, 품질, 화풍 등"
                ></textarea>

                <div class="nai-split-info">
                    메인 프롬프트 뒤의 쉼표(,)는 자동으로 추가됩니다.
                    마지막에 직접 쉼표를 넣지 않아도 됩니다.
                </div>

            </div>


            <div class="nai-split-box">

                <div class="nai-split-head">

                    <span class="nai-split-title">
                        공통 프롬프트
                    </span>

                    <span class="nai-split-desc">
                        메인 뒤에 들어감
                    </span>

                </div>

                <textarea
                    id="nai-split-common-prompt"
                    class="nai-split-textarea"
                    spellcheck="false"
                    placeholder="장면설정, 공통으로 쓰일 태그 등"
                ></textarea>

            </div>

        `;


        mainTextarea = panel.querySelector(
            '#nai-split-main-prompt'
        );

        commonTextarea = panel.querySelector(
            '#nai-split-common-prompt'
        );


        mainTextarea.value = initialMain;
        commonTextarea.value = commonPrompt;


        mainTextarea.addEventListener(
            'input',
            () => {
                autoResize(mainTextarea);
                scheduleSync();
            }
        );


        commonTextarea.addEventListener(
            'input',
            () => {
                commonPrompt = commonTextarea.value;

                GM_setValue(
                    STORAGE_COMMON,
                    commonPrompt
                );

                autoResize(commonTextarea);
                scheduleSync();
            }
        );


        panel
            .querySelector(
                '#nai-split-native-toggle'
            )
            .addEventListener(
                'click',
                toggleNativePrompt
            );


        setTimeout(
            () => {
                autoResize(mainTextarea);
                autoResize(commonTextarea);
            },
            0
        );


        return panel;
    }


    // =========================================================
    // 마운트
    // =========================================================

    function mount() {
        if (
            !location.pathname.startsWith(
                '/image'
            )
        ) {
            return;
        }

        if (
            document.getElementById(
                PANEL_ID
            )
        ) {
            return;
        }


        nativeEditor = findNativeBasePrompt();

        if (!nativeEditor) {
            return;
        }


        nativeEditorContainer =
            nativeEditor.parentElement;


        if (
            !nativeEditorContainer ||
            !nativeEditorContainer.parentElement
        ) {
            return;
        }


        const nativeText =
            readNativePrompt();


        const initialMain =
            stripCommonOnce(
                nativeText,
                commonPrompt
            );


        const panel =
            createPanel(
                initialMain
            );


        nativeEditorContainer
            .insertAdjacentElement(
                'afterend',
                panel
            );


        makeNativeReadOnly();

        applyNativeCollapsedState();


        /*
         * 최초 병합
         */
        setTimeout(
            syncToNative,
            200
        );


        console.log(
            '[NAI Split Prompt] v2.1 활성화'
        );
    }


    // =========================================================
    // React 재렌더링 대응
    // =========================================================

    function scheduleMount() {
        if (mountScheduled) {
            return;
        }

        mountScheduled = true;

        requestAnimationFrame(() => {
            mountScheduled = false;

            if (
                nativeEditor &&
                !nativeEditor.isConnected
            ) {
                nativeEditor = null;
                nativeEditorContainer = null;

                document
                    .getElementById(
                        PANEL_ID
                    )
                    ?.remove();

                mainTextarea = null;
                commonTextarea = null;
            }

            mount();
        });
    }


    const pageObserver =
        new MutationObserver(
            scheduleMount
        );


    pageObserver.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );


    // =========================================================
    // SPA 이동
    // =========================================================

    let lastUrl = location.href;


    setInterval(
        () => {
            if (
                lastUrl !== location.href
            ) {
                lastUrl = location.href;
                scheduleMount();
            }
        },
        500
    );


    // =========================================================
    // 시작
    // =========================================================

    addStyle();

    scheduleMount();

})();
