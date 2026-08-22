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


    // =========================================================
    // 설정
    // =========================================================

    const PANEL_ID =
        'nai-split-base-prompt-panel';

    const STYLE_ID =
        'nai-split-base-prompt-style';

    const STORAGE_COMMON =
        'nai_split_base_common_prompt';

    const STORAGE_COLLAPSED =
        'nai_split_base_native_collapsed';

    const SEPARATOR = ', ';


    let commonPrompt =
        GM_getValue(
            STORAGE_COMMON,
            ''
        );

    let nativeCollapsed =
        GM_getValue(
            STORAGE_COLLAPSED,
            true
        );


    let nativeEditor = null;
    let nativeEditorContainer = null;

    let mainTextarea = null;
    let commonTextarea = null;

    let syncTimer = null;
    let mountScheduled = false;

    let internalWrite = false;


    // =========================================================
    // 마지막으로 실제 입력한 Prompt
    // =========================================================

    let lastEditedPromptTarget = null;

    const cursorState =
        new WeakMap();

    let interceptedSuggestion = null;


    // =========================================================
    // Prompt 정리
    // =========================================================

    function flattenPrompt(text) {

        return String(text || '')

            .replace(
                /\u00a0/g,
                ' '
            )

            .replace(
                /\r\n?/g,
                '\n'
            )

            .replace(
                /\n+/g,
                ' '
            )

            .replace(
                /[ \t]+/g,
                ' '
            )

            .trim();
    }


    // =========================================================
    // 메인 + 공통 병합
    //
    // 메인 뒤에 ", " 자동 추가
    // =========================================================

    function mergePrompt(
        main,
        common
    ) {

        let a =
            flattenPrompt(main);

        const b =
            flattenPrompt(common);


        /*
         * 메인 마지막에 사용자가 직접
         * 쉼표를 넣었더라도 중복 방지
         */
        a =
            a.replace(
                /,\s*$/,
                ''
            );


        if (!a) {
            return b;
        }

        if (!b) {
            return a;
        }


        return (
            a +
            SEPARATOR +
            b
        );
    }


    // =========================================================
    // 최초 로딩 시 기존 원본에서 저장된 공통 분리
    // =========================================================

    function stripCommonOnce(
        nativeText,
        common
    ) {

        const native =
            flattenPrompt(
                nativeText
            );

        const shared =
            flattenPrompt(
                common
            );


        if (!shared) {
            return native;
        }


        if (
            native === shared
        ) {
            return '';
        }


        const suffix =
            SEPARATOR +
            shared;


        if (
            native.endsWith(
                suffix
            )
        ) {

            return native

                .slice(
                    0,
                    -suffix.length
                )

                .trim()

                .replace(
                    /,\s*$/,
                    ''
                );
        }


        return native;
    }


    // =========================================================
    // NAI 원본 Base Prompt 찾기
    // =========================================================

    function findNativeBasePrompt() {

        /*
         * 이미 잠긴 경우도 다시 찾을 수 있도록
         * data 속성도 포함
         */

        const marked =
            document.querySelector(
                '.ProseMirror[data-nai-split-native="true"]'
            );


        if (marked) {
            return marked;
        }


        const editors = [
            ...document.querySelectorAll(
                '.ProseMirror[contenteditable="true"]'
            )
        ];


        return (
            editors[0] ||
            null
        );
    }


    // =========================================================
    // 원본 Prompt 읽기
    // =========================================================

    function readNativePrompt() {

        if (
            !nativeEditor ||
            !nativeEditor.isConnected
        ) {

            nativeEditor =
                findNativeBasePrompt();
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
    // 합쳐진 Prompt → NAI 원본
    // =========================================================

    function writeNativePrompt(text) {

        if (
            !nativeEditor ||
            !nativeEditor.isConnected
        ) {

            nativeEditor =
                findNativeBasePrompt();
        }


        if (!nativeEditor) {

            console.warn(
                '[NAI Split Prompt] 원본 Base Prompt를 찾지 못함'
            );

            return false;
        }


        const finalText =
            flattenPrompt(
                text
            );


        if (
            readNativePrompt() ===
            finalText
        ) {

            return true;
        }


        internalWrite = true;


        try {

            const paragraph =
                document.createElement(
                    'p'
                );


            if (finalText) {

                paragraph.textContent =
                    finalText;

            } else {

                paragraph.appendChild(
                    document.createElement(
                        'br'
                    )
                );
            }


            /*
             * 사용자에게는 읽기 전용이지만
             * JS에서는 DOM 갱신 가능
             */
            nativeEditor.replaceChildren(
                paragraph
            );


            /*
             * NAI에 Prompt 변경 통보
             */
            nativeEditor.dispatchEvent(

                new InputEvent(
                    'input',
                    {
                        bubbles: true,
                        composed: true,

                        inputType:
                            'insertText',

                        data:
                            finalText
                    }
                )
            );


            nativeEditor.dispatchEvent(

                new Event(
                    'change',
                    {
                        bubbles: true
                    }
                )
            );


        } catch (error) {

            console.error(
                '[NAI Split Prompt] 원본 동기화 실패:',
                error
            );


            internalWrite =
                false;

            return false;
        }


        requestAnimationFrame(
            () => {

                internalWrite =
                    false;
            }
        );


        return true;
    }


    // =========================================================
    // 메인 + 공통 → 원본
    // =========================================================

    function syncToNative() {

        if (
            !mainTextarea ||
            !commonTextarea
        ) {

            return;
        }


        writeNativePrompt(

            mergePrompt(
                mainTextarea.value,
                commonTextarea.value
            )
        );
    }


    function scheduleSync() {

        clearTimeout(
            syncTimer
        );


        syncTimer =
            setTimeout(
                syncToNative,
                100
            );
    }


    // =========================================================
    // 마지막 커서 위치 기억
    // =========================================================

    function rememberCursor(
        textarea
    ) {

        if (!textarea) {
            return;
        }


        cursorState.set(
            textarea,
            {
                start:
                    textarea.selectionStart ??
                    textarea.value.length,

                end:
                    textarea.selectionEnd ??
                    textarea.value.length
            }
        );
    }


    // =========================================================
    // 마지막 실제 입력 칸 기억
    // =========================================================

    function registerPromptTextarea(
        textarea
    ) {

        if (!textarea) {
            return;
        }


        /*
         * 실제 입력이 발생한 칸을
         * 마지막 편집 대상으로 저장
         */
        textarea.addEventListener(
            'input',
            () => {

                lastEditedPromptTarget =
                    textarea;


                rememberCursor(
                    textarea
                );
            }
        );


        /*
         * 마지막 편집 칸 내부에서
         * 커서 이동 시 위치 갱신
         */
        const updateCursor =
            () => {

                if (
                    lastEditedPromptTarget ===
                    textarea
                ) {

                    rememberCursor(
                        textarea
                    );
                }
            };


        textarea.addEventListener(
            'keyup',
            updateCursor
        );

        textarea.addEventListener(
            'mouseup',
            updateCursor
        );

        textarea.addEventListener(
            'click',
            updateCursor
        );

        textarea.addEventListener(
            'select',
            updateCursor
        );
    }


    // =========================================================
    // 현재 입력 중인 태그 범위 찾기
    //
    // 예:
    //
    // artist:abc|
    //
    // 제안 선택 시 abc 부분을 교체
    // =========================================================

    function getCurrentTagRange(
        textarea,
        cursorStart,
        cursorEnd
    ) {

        const value =
            textarea.value;


        /*
         * 선택 영역이 있다면 선택 부분 교체
         */
        if (
            cursorStart !==
            cursorEnd
        ) {

            return {
                start:
                    cursorStart,

                end:
                    cursorEnd
            };
        }


        const before =
            value.slice(
                0,
                cursorStart
            );


        const lastComma =
            before.lastIndexOf(
                ','
            );


        const lastLine =
            Math.max(

                before.lastIndexOf(
                    '\n'
                ),

                before.lastIndexOf(
                    '\r'
                )
            );


        let start =
            Math.max(
                lastComma,
                lastLine
            ) +
            1;


        /*
         * 쉼표/줄바꿈 뒤 공백 제외
         */
        while (
            start <
            cursorStart &&

            /\s/.test(
                value[start]
            )
        ) {

            start++;
        }


        return {
            start,

            end:
                cursorStart
        };
    }


    // =========================================================
    // NAI 태그 제안 → 마지막 입력 Prompt
    // =========================================================

    function applySuggestionToPrompt(
        textarea,
        suggestion
    ) {

        if (
            !textarea ||
            !suggestion
        ) {

            return;
        }


        const saved =
            cursorState.get(
                textarea
            ) || {

                start:
                    textarea.value.length,

                end:
                    textarea.value.length
            };


        let cursorStart =
            saved.start;

        let cursorEnd =
            saved.end;


        cursorStart =
            Math.max(
                0,
                Math.min(
                    cursorStart,
                    textarea.value.length
                )
            );


        cursorEnd =
            Math.max(
                cursorStart,
                Math.min(
                    cursorEnd,
                    textarea.value.length
                )
            );


        const range =
            getCurrentTagRange(
                textarea,
                cursorStart,
                cursorEnd
            );


        const before =
            textarea.value.slice(
                0,
                range.start
            );


        const after =
            textarea.value.slice(
                range.end
            );


        textarea.value =
            before +
            suggestion +
            after;


        const nextPosition =
            range.start +
            suggestion.length;


        lastEditedPromptTarget =
            textarea;


        textarea.focus();


        textarea.setSelectionRange(
            nextPosition,
            nextPosition
        );


        rememberCursor(
            textarea
        );


        /*
         * 기존 저장/병합 로직 실행
         */
        textarea.dispatchEvent(

            new Event(
                'input',
                {
                    bubbles:
                        true
                }
            )
        );
    }


    // =========================================================
    // 원본 Base Prompt 완전 읽기 전용
    // =========================================================

    function protectNativeEditor() {

        if (!nativeEditor) {
            return;
        }


        nativeEditor.setAttribute(
            'data-nai-split-native',
            'true'
        );


        /*
         * 핵심:
         * 원본 Base Prompt를 실제로 편집 불가능하게 함
         */
        nativeEditor.setAttribute(
            'contenteditable',
            'false'
        );


        nativeEditor.setAttribute(
            'aria-readonly',
            'true'
        );


        nativeEditor.style.cursor =
            'text';

        nativeEditor.style.userSelect =
            'text';

        nativeEditor.style.webkitUserSelect =
            'text';


        // -----------------------------------------------------
        // NAI가 contenteditable을 다시 살리는 경우 차단
        // -----------------------------------------------------

        const readOnlyObserver =
            new MutationObserver(
                () => {

                    if (
                        !nativeEditor ||
                        !nativeEditor.isConnected
                    ) {

                        return;
                    }


                    if (
                        nativeEditor.getAttribute(
                            'contenteditable'
                        ) !== 'false'
                    ) {

                        nativeEditor.setAttribute(
                            'contenteditable',
                            'false'
                        );
                    }
                }
            );


        readOnlyObserver.observe(
            nativeEditor,
            {
                attributes:
                    true,

                attributeFilter: [
                    'contenteditable'
                ]
            }
        );


        // -----------------------------------------------------
        // 추가 방어
        // -----------------------------------------------------

        nativeEditor.addEventListener(
            'beforeinput',
            event => {

                if (internalWrite) {
                    return;
                }


                event.preventDefault();

                event.stopPropagation();

                event.stopImmediatePropagation();
            },
            true
        );


        nativeEditor.addEventListener(
            'paste',
            event => {

                if (internalWrite) {
                    return;
                }


                event.preventDefault();

                event.stopPropagation();

                event.stopImmediatePropagation();
            },
            true
        );


        nativeEditor.addEventListener(
            'cut',
            event => {

                if (internalWrite) {
                    return;
                }


                event.preventDefault();

                event.stopPropagation();

                event.stopImmediatePropagation();
            },
            true
        );


        nativeEditor.addEventListener(
            'drop',
            event => {

                if (internalWrite) {
                    return;
                }


                event.preventDefault();

                event.stopPropagation();

                event.stopImmediatePropagation();
            },
            true
        );
    }


    // =========================================================
    // NAI Suggestion 항목 찾기
    // =========================================================

    function findSuggestionItem(
        target
    ) {

        if (
            !(target instanceof Element)
        ) {

            return null;
        }


        const box =
            target.closest(
                '.image-prompt-suggestions'
            );


        if (!box) {
            return null;
        }


        /*
         * 닫기 버튼 제외
         */
        if (
            target.closest(
                '.modal-close'
            )
        ) {

            return null;
        }


        const children =
            [...box.children];


        let suggestionList =
            null;


        /*
         * 첫 번째는 Did you mean? 헤더,
         * 그 이후 children을 가진 영역이 목록
         */
        for (
            let i = 1;
            i < children.length;
            i++
        ) {

            const child =
                children[i];


            if (
                child.children &&
                child.children.length
            ) {

                suggestionList =
                    child;

                break;
            }
        }


        if (!suggestionList) {
            return null;
        }


        for (
            const item
            of suggestionList.children
        ) {

            if (
                item === target ||
                item.contains(
                    target
                )
            ) {

                return item;
            }
        }


        return null;
    }


    // =========================================================
    // 제안 텍스트 추출
    // =========================================================

    function extractSuggestionText(
        item
    ) {

        if (!item) {
            return '';
        }


        /*
         * 제공된 NAI DOM에서
         * 첫 span이 실제 태그 이름
         */
        const span =
            item.querySelector(
                'span'
            );


        if (!span) {
            return '';
        }


        return String(
            span.textContent ||
            ''
        ).trim();
    }


    // =========================================================
    // 제안 클릭 가로채기
    //
    // 원본에는 절대 직접 입력시키지 않음
    // =========================================================

    function interceptSuggestionPointer(
        event
    ) {

        const item =
            findSuggestionItem(
                event.target
            );


        if (!item) {
            return;
        }


        if (
            !lastEditedPromptTarget ||
            !lastEditedPromptTarget.isConnected
        ) {

            return;
        }


        const suggestion =
            extractSuggestionText(
                item
            );


        if (!suggestion) {
            return;
        }


        /*
         * NAI 원래 동작 차단
         */
        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();


        interceptedSuggestion = {

            item,

            time:
                performance.now()
        };


        /*
         * 마지막으로 실제 입력했던
         * 메인/공통 칸에 삽입
         */
        applySuggestionToPrompt(
            lastEditedPromptTarget,
            suggestion
        );


        console.log(

            '[NAI Split Prompt] 제안 →',

            lastEditedPromptTarget ===
                mainTextarea
                ? '메인'
                : '공통',

            suggestion
        );
    }


    // =========================================================
    // pointerdown 이후 click까지 차단
    // =========================================================

    function interceptSuggestionClick(
        event
    ) {

        if (
            !interceptedSuggestion
        ) {

            return;
        }


        if (
            performance.now() -
            interceptedSuggestion.time >
            1200
        ) {

            interceptedSuggestion =
                null;

            return;
        }


        const item =
            findSuggestionItem(
                event.target
            );


        if (!item) {
            return;
        }


        if (
            item !==
            interceptedSuggestion.item
        ) {

            return;
        }


        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();


        interceptedSuggestion =
            null;
    }


    // =========================================================
    // 원본 접기 / 펼치기
    // =========================================================

    function applyNativeCollapsedState() {

        if (
            !nativeEditorContainer
        ) {

            return;
        }


        const button =
            document.getElementById(
                'nai-split-native-toggle'
            );


        const warning =
            document.getElementById(
                'nai-split-native-warning'
            );


        if (
            nativeCollapsed
        ) {

            nativeEditorContainer
                .style
                .display =
                'none';


            if (button) {

                button.textContent =
                    '▶ 합쳐진 Base Prompt 보기';
            }


            if (warning) {

                warning.style.display =
                    'none';
            }


        } else {

            nativeEditorContainer
                .style
                .display =
                '';


            if (button) {

                button.textContent =
                    '▼ 합쳐진 Base Prompt 숨기기';
            }


            if (warning) {

                warning.style.display =
                    '';
            }
        }
    }


    function toggleNativePrompt() {

        nativeCollapsed =
            !nativeCollapsed;


        GM_setValue(
            STORAGE_COLLAPSED,
            nativeCollapsed
        );


        applyNativeCollapsedState();
    }


    // =========================================================
    // textarea 자동 높이
    // =========================================================

    function autoResize(
        textarea
    ) {

        if (!textarea) {
            return;
        }


        textarea.style.height =
            'auto';


        textarea.style.height =
            Math.min(
                Math.max(
                    textarea.scrollHeight,
                    90
                ),
                420
            ) +
            'px';
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


        const style =
            document.createElement(
                'style'
            );


        style.id =
            STYLE_ID;


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


            /* ==============================================
               원본 보기 버튼
               ============================================== */

            .nai-split-native-toggle {
                width: 100%;
                height: 31px;

                margin-bottom: 5px;
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


            /* ==============================================
               원본 읽기 전용 설명
               ============================================== */

            .nai-split-native-warning {
                margin: 0 0 8px;
                padding: 7px 9px;

                border:
                    1px solid
                    rgba(255,255,255,.08);

                border-radius: 5px;

                background:
                    rgba(255,255,255,.025);

                font-size: 10px;
                line-height: 1.45;

                opacity: .58;
            }


            /* ==============================================
               Prompt box
               ============================================== */

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
                line-height: 1.45;

                opacity: .50;
            }


            /* ==============================================
               textarea
               ============================================== */

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
                    rgba(255,255,255,.34);
            }


            .nai-split-textarea::placeholder {
                color:
                    rgba(255,255,255,.28);
            }


            /* ==============================================
               NAI 원본
               ============================================== */

            [data-nai-split-native="true"] {
                user-select: text !important;
                -webkit-user-select: text !important;

                cursor: text;

                opacity: .85;
            }

        `;


        document.head
            ?.appendChild(
                style
            );
    }


    // =========================================================
    // UI 생성
    // =========================================================

    function createPanel(
        initialMain
    ) {

        const panel =
            document.createElement(
                'div'
            );


        panel.id =
            PANEL_ID;


        panel.innerHTML = `

            <button
                type="button"
                id="nai-split-native-toggle"
                class="nai-split-native-toggle"
            >
                ▶ 합쳐진 Base Prompt 보기
            </button>


            <div
                id="nai-split-native-warning"
                class="nai-split-native-warning"
                style="display:none;"
            >
                이 영역은 메인 프롬프트와 장면 프롬프트가 합쳐진
                NAI 원본 Base Prompt입니다.
                오작동 및 프롬프트 중복을 막기 위해 직접적인 입력은 차단되어 있으며,
                내용 확인·선택·복사만 가능합니다.
            </div>


            <!-- =============================================
                 메인
                 ============================================= -->

            <div class="nai-split-box">

                <div class="nai-split-head">

                    <span class="nai-split-title">
                        메인 프롬프트
                    </span>

                    <span class="nai-split-desc">
                        먼저 전송
                    </span>

                </div>


                <textarea
                    id="nai-split-main-prompt"
                    class="nai-split-textarea"
                    spellcheck="false"
                    placeholder="화풍, 작가 태그, 품질 태그 등"
                ></textarea>


                <div class="nai-split-info">
                    메인 프롬프트 뒤의 쉼표(,)는 자동으로 추가됩니다.
                    마지막에 직접 쉼표를 입력하지 않아도 됩니다.
                </div>

            </div>


            <!-- =============================================
                 장면
                 ============================================= -->

            <div class="nai-split-box">

                <div class="nai-split-head">

                    <span class="nai-split-title">
                        장면 프롬프트
                    </span>

                    <span class="nai-split-desc">
                        메인 뒤에 자동 추가
                    </span>

                </div>


                <textarea
                    id="nai-split-common-prompt"
                    class="nai-split-textarea"
                    spellcheck="false"
                    placeholder="장면등의 프롬프트"
                ></textarea>


                <div class="nai-split-info">
                    메인 프롬프트 뒤에 자동으로 합쳐져 하나의 Base Prompt로 전송됩니다.
                </div>

            </div>

        `;


        mainTextarea =
            panel.querySelector(
                '#nai-split-main-prompt'
            );


        commonTextarea =
            panel.querySelector(
                '#nai-split-common-prompt'
            );


        mainTextarea.value =
            initialMain;


        commonTextarea.value =
            commonPrompt;


        // -----------------------------------------------------
        // 마지막 편집 Prompt 추적
        // -----------------------------------------------------

        registerPromptTextarea(
            mainTextarea
        );


        registerPromptTextarea(
            commonTextarea
        );


        // -----------------------------------------------------
        // 메인 입력
        // -----------------------------------------------------

        mainTextarea.addEventListener(
            'input',
            () => {

                autoResize(
                    mainTextarea
                );


                scheduleSync();
            }
        );


        // -----------------------------------------------------
        // 공통 입력
        // -----------------------------------------------------

        commonTextarea.addEventListener(
            'input',
            () => {

                commonPrompt =
                    commonTextarea.value;


                GM_setValue(
                    STORAGE_COMMON,
                    commonPrompt
                );


                autoResize(
                    commonTextarea
                );


                scheduleSync();
            }
        );


        // -----------------------------------------------------
        // 원본 보기 토글
        // -----------------------------------------------------

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

                autoResize(
                    mainTextarea
                );


                autoResize(
                    commonTextarea
                );

            },
            0
        );


        /*
         * 아직 아무 입력도 하지 않았을 때의
         * 기본 제안 대상은 메인
         */
        lastEditedPromptTarget =
            mainTextarea;


        cursorState.set(
            mainTextarea,
            {
                start:
                    mainTextarea.value.length,

                end:
                    mainTextarea.value.length
            }
        );


        return panel;
    }


    // =========================================================
    // 마운트
    // =========================================================

    function mount() {

        if (
            !location.pathname
                .startsWith(
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


        nativeEditor =
            findNativeBasePrompt();


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


        /*
         * 원본 완전 읽기 전용
         */
        protectNativeEditor();


        applyNativeCollapsedState();


        /*
         * 최초 병합
         */
        setTimeout(
            syncToNative,
            200
        );


        console.log(
            '[NAI Split Prompt] v3.3 활성화'
        );
    }


    // =========================================================
    // 태그 제안 전역 가로채기
    // =========================================================

    document.addEventListener(
        'pointerdown',
        interceptSuggestionPointer,
        true
    );


    document.addEventListener(
        'click',
        interceptSuggestionClick,
        true
    );


    // =========================================================
    // React 재렌더링 대응
    // =========================================================

    function scheduleMount() {

        if (mountScheduled) {
            return;
        }


        mountScheduled =
            true;


        requestAnimationFrame(
            () => {

                mountScheduled =
                    false;


                if (
                    nativeEditor &&
                    !nativeEditor.isConnected
                ) {

                    nativeEditor =
                        null;


                    nativeEditorContainer =
                        null;


                    document
                        .getElementById(
                            PANEL_ID
                        )
                        ?.remove();


                    mainTextarea =
                        null;


                    commonTextarea =
                        null;


                    lastEditedPromptTarget =
                        null;
                }


                mount();
            }
        );
    }


    const pageObserver =
        new MutationObserver(
            scheduleMount
        );


    pageObserver.observe(
        document.documentElement,
        {
            childList:
                true,

            subtree:
                true
        }
    );


    // =========================================================
    // SPA 이동 대응
    // =========================================================

    let lastUrl =
        location.href;


    setInterval(
        () => {

            if (
                lastUrl !==
                location.href
            ) {

                lastUrl =
                    location.href;


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
