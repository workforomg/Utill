// ==UserScript==
// @name         피드 Markdown 분할 미리보기
// @namespace    https://github.com/workforomg/Utill
// @version      0.3.0
// @author       지유지요
// @description  글쓰기 모달 내부를 1:1로 분할하여 Markdown 미리보기를 표시합니다.
// @match        https://crack.wrtn.ai/profile/*
// @require      https://cdn.jsdelivr.net/npm/marked/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    /* =========================================================
     * 설정
     * ======================================================= */

    const TEXTAREA_SELECTOR =
        'textarea[name="content"][placeholder="피드에 올라갈 내용을 작성해주세요."]';

    const PREVIEW_CLASS = '__crack_markdown_preview_pane';
    const STYLE_ID = '__crack_markdown_split_style';

    let currentTextarea = null;
    let currentDialog = null;
    let currentForm = null;
    let currentPreview = null;

    /* 원본 스타일 복구용 */
    let originalDialogStyle = null;
    let originalFormStyle = null;


    /* =========================================================
     * Marked 설정
     * ======================================================= */

    marked.setOptions({
        gfm: true,
        breaks: true
    });


    /* =========================================================
     * Markdown 렌더링
     * ======================================================= */

    function renderMarkdown() {
        if (!currentTextarea || !currentPreview) return;

        const body =
            currentPreview.querySelector('.__md_preview_body');

        if (!body) return;

        const text = currentTextarea.value || '';

        if (!text.trim()) {
            body.innerHTML = `
                <div class="__md_empty">
                    Markdown 미리보기가 여기에 표시됩니다.
                </div>
            `;

            return;
        }

        try {
            const parsed = marked.parse(text);

            body.innerHTML =
                DOMPurify.sanitize(parsed);
        } catch (error) {
            console.error(
                '[Crack Markdown] 렌더링 오류:',
                error
            );
        }
    }


    /* =========================================================
     * 원본 스타일 기억
     * ======================================================= */

    function saveOriginalStyles(dialog, form) {
        originalDialogStyle = {
            width: dialog.style.width,
            maxWidth: dialog.style.maxWidth,
            minWidth: dialog.style.minWidth
        };

        originalFormStyle = {
            display: form.style.display,
            gridTemplateColumns:
                form.style.gridTemplateColumns,
            minHeight: form.style.minHeight,
            overflow: form.style.overflow
        };
    }


    /* =========================================================
     * Dialog 확대
     * ======================================================= */

    function expandDialog(dialog) {
        /*
         * 기존 max-w-[600px] 제한을 무시.
         *
         * 600px × 2 = 약 1200px
         *
         * 화면 자체가 좁으면 viewport 안으로 자동 축소.
         */
        dialog.style.setProperty(
            'width',
            'min(1200px, calc(100vw - 48px))',
            'important'
        );

        dialog.style.setProperty(
            'max-width',
            'none',
            'important'
        );

        dialog.style.setProperty(
            'min-width',
            '0',
            'important'
        );
    }


    /* =========================================================
     * 미리보기 Pane 생성
     * ======================================================= */

    function createPreviewPane() {
        const pane = document.createElement('section');

        pane.className = PREVIEW_CLASS;

        pane.innerHTML = `
            <div class="__md_preview_header">
                피드 미리보기
            </div>

            <div class="__md_preview_body">
                <div class="__md_empty">
                    피드 미리보기가 여기에 표시됩니다.
                </div>
            </div>
        `;

        return pane;
    }


    /* =========================================================
     * 글쓰기 Form을 정확히 1:1 분할
     * ======================================================= */

    function splitForm(form) {
        /*
         * 기존:
         *
         * form
         * └─ 기존 글쓰기 UI
         *
         *
         * 변경:
         *
         * form
         * ├─ Markdown Preview
         * └─ 기존 글쓰기 UI
         *
         * React가 관리하는 기존 노드는 건드리지 않는다.
         */

        form.style.setProperty(
            'display',
            'grid',
            'important'
        );

        /*
         * 정확한 반반.
         */
        form.style.setProperty(
            'grid-template-columns',
            'minmax(0, 1fr) minmax(0, 1fr)',
            'important'
        );

        form.style.setProperty(
            'min-height',
            '0',
            'important'
        );

        form.style.setProperty(
            'overflow',
            'hidden',
            'important'
        );
    }


    /* =========================================================
     * 적용
     * ======================================================= */

    function activate(textarea) {
        const dialog =
            textarea.closest('[role="dialog"]');

        if (!dialog) return;

        const form =
            textarea.closest('form');

        if (!form) return;


        /*
         * 이미 현재 모달에 적용되어 있으면 종료
         */
        if (
            currentTextarea === textarea &&
            currentPreview?.isConnected
        ) {
            return;
        }


        /*
         * 이전 모달 정리
         */
        cleanup();


        currentTextarea = textarea;
        currentDialog = dialog;
        currentForm = form;


        saveOriginalStyles(
            dialog,
            form
        );


        /*
         * 원본 하나의 Dialog 자체를 확대
         */
        expandDialog(dialog);


        /*
         * Form 반반 분할
         */
        splitForm(form);


        /*
         * Preview 생성
         */
        const preview =
            createPreviewPane();

        currentPreview = preview;


        /*
         * 기존 글쓰기 UI보다 앞쪽에 삽입.
         *
         * Preview | Original
         */
        form.insertBefore(
            preview,
            form.firstElementChild
        );


        /*
         * 입력 감지
         */
        textarea.addEventListener(
            'input',
            renderMarkdown
        );


        /*
         * 이미 작성되어 있는 내용도 즉시 렌더
         */
        renderMarkdown();
    }


    /* =========================================================
     * 원상복구
     * ======================================================= */

    function cleanup() {
        if (currentTextarea) {
            currentTextarea.removeEventListener(
                'input',
                renderMarkdown
            );
        }


        if (currentPreview) {
            currentPreview.remove();
        }


        /*
         * 모달이 아직 DOM에 있는 경우만 복원
         */
        if (
            currentDialog &&
            currentDialog.isConnected &&
            originalDialogStyle
        ) {
            currentDialog.style.width =
                originalDialogStyle.width;

            currentDialog.style.maxWidth =
                originalDialogStyle.maxWidth;

            currentDialog.style.minWidth =
                originalDialogStyle.minWidth;
        }


        if (
            currentForm &&
            currentForm.isConnected &&
            originalFormStyle
        ) {
            currentForm.style.display =
                originalFormStyle.display;

            currentForm.style.gridTemplateColumns =
                originalFormStyle.gridTemplateColumns;

            currentForm.style.minHeight =
                originalFormStyle.minHeight;

            currentForm.style.overflow =
                originalFormStyle.overflow;
        }


        currentTextarea = null;
        currentDialog = null;
        currentForm = null;
        currentPreview = null;

        originalDialogStyle = null;
        originalFormStyle = null;
    }


    /* =========================================================
     * CSS
     * ======================================================= */

    function injectStyle() {
        if (
            document.getElementById(STYLE_ID)
        ) {
            return;
        }


        const style =
            document.createElement('style');

        style.id = STYLE_ID;


        style.textContent = `

            /* ==================================================
             * Preview 영역
             * ================================================== */

            .${PREVIEW_CLASS} {
                /*
                 * Grid의 정확한 왼쪽 50%
                 */
                width: 100%;
                min-width: 0;
                min-height: 0;

                box-sizing: border-box;

                display: flex;
                flex-direction: column;

                /*
                 * 원본 Dialog 배경/글자색 그대로 상속
                 */
                color: inherit;
                background: inherit;

                /*
                 * 가운데 구분선
                 */
                border-right:
                    1px solid
                    var(
                        --border,
                        rgba(127, 127, 127, 0.25)
                    );

                overflow: hidden;
            }


            /* ==================================================
             * Preview 상단 제목
             * ================================================== */

            .${PREVIEW_CLASS}
            .__md_preview_header {

                flex-shrink: 0;

                padding:
                    4px
                    20px
                    16px
                    20px;

                box-sizing: border-box;

                font-size: 14px;
                font-weight: 600;

                line-height: 1.4;

                opacity: 0.7;
            }


            /* ==================================================
             * Preview Body
             * ================================================== */

            .${PREVIEW_CLASS}
            .__md_preview_body {

                flex: 1;

                min-height: 0;
                min-width: 0;

                padding:
                    0
                    20px
                    24px
                    20px;

                box-sizing: border-box;

                overflow-y: auto;
                overflow-x: hidden;

                font-size: 16px;
                line-height: 1.65;

                overflow-wrap: anywhere;
                word-break: break-word;
            }


            .${PREVIEW_CLASS}
            .__md_empty {

                opacity: 0.5;

                font-size: 14px;
                line-height: 1.6;

                user-select: none;
            }


            /* ==================================================
             * 첫/마지막 Markdown 요소 여백
             * ================================================== */

            .${PREVIEW_CLASS}
            .__md_preview_body > :first-child {

                margin-top: 0;
            }


            .${PREVIEW_CLASS}
            .__md_preview_body > :last-child {

                margin-bottom: 0;
            }


            /* ==================================================
             * Heading
             * ================================================== */

            .${PREVIEW_CLASS} h1 {

                margin:
                    0
                    0
                    0.65em;

                font-size: 2em;
                font-weight: 700;
                line-height: 1.25;
            }


            .${PREVIEW_CLASS} h2 {

                margin:
                    1em
                    0
                    0.55em;

                font-size: 1.5em;
                font-weight: 700;
                line-height: 1.3;
            }


            .${PREVIEW_CLASS} h3 {

                margin:
                    1em
                    0
                    0.5em;

                font-size: 1.25em;
                font-weight: 700;
                line-height: 1.35;
            }


            .${PREVIEW_CLASS} h4,
            .${PREVIEW_CLASS} h5,
            .${PREVIEW_CLASS} h6 {

                margin:
                    1em
                    0
                    0.5em;

                font-weight: 700;
            }


            /* ==================================================
             * Paragraph
             * ================================================== */

            .${PREVIEW_CLASS} p {

                margin:
                    0
                    0
                    0.9em;
            }


            .${PREVIEW_CLASS} strong {

                font-weight: 700;
            }


            .${PREVIEW_CLASS} em {

                font-style: italic;
            }


            .${PREVIEW_CLASS} del {

                opacity: 0.65;
            }


            /* ==================================================
             * List
             * ================================================== */

            .${PREVIEW_CLASS} ul,
            .${PREVIEW_CLASS} ol {

                margin:
                    0.75em
                    0;

                padding-left:
                    2em;
            }


            .${PREVIEW_CLASS} ul {

                list-style:
                    disc;
            }


            .${PREVIEW_CLASS} ol {

                list-style:
                    decimal;
            }


            .${PREVIEW_CLASS} li {

                margin:
                    0.2em
                    0;
            }


            /* ==================================================
             * Quote
             * ================================================== */

            .${PREVIEW_CLASS} blockquote {

                margin:
                    1em
                    0;

                padding:
                    0.25em
                    1em;

                border-left:
                    4px solid
                    rgba(127, 127, 127, 0.45);

                opacity:
                    0.8;
            }


            /* ==================================================
             * Inline Code
             * ================================================== */

            .${PREVIEW_CLASS} code {

                padding:
                    2px
                    5px;

                border-radius:
                    5px;

                background:
                    rgba(127, 127, 127, 0.15);

                font-family:
                    ui-monospace,
                    SFMono-Regular,
                    Menlo,
                    Monaco,
                    Consolas,
                    monospace;

                font-size:
                    0.9em;
            }


            /* ==================================================
             * Code Block
             * ================================================== */

            .${PREVIEW_CLASS} pre {

                margin:
                    1em
                    0;

                padding:
                    14px;

                overflow-x:
                    auto;

                border-radius:
                    8px;

                background:
                    rgba(127, 127, 127, 0.15);
            }


            .${PREVIEW_CLASS} pre code {

                padding:
                    0;

                background:
                    transparent;
            }


            /* ==================================================
             * HR
             * ================================================== */

            .${PREVIEW_CLASS} hr {

                margin:
                    1.5em
                    0;

                border:
                    0;

                border-top:
                    1px solid
                    rgba(127, 127, 127, 0.3);
            }


            /* ==================================================
             * Link
             * ================================================== */

            .${PREVIEW_CLASS} a {

                color:
                    inherit;

                text-decoration:
                    underline;

                text-underline-offset:
                    2px;
            }


            /* ==================================================
             * Image
             * ================================================== */

            .${PREVIEW_CLASS} img {

                display:
                    block;

                max-width:
                    100%;

                height:
                    auto;

                margin:
                    0.75em
                    0;

                border-radius:
                    8px;
            }


            /* ==================================================
             * Table
             * ================================================== */

            .${PREVIEW_CLASS} table {

                width:
                    100%;

                margin:
                    1em
                    0;

                border-collapse:
                    collapse;
            }


            .${PREVIEW_CLASS} th,
            .${PREVIEW_CLASS} td {

                padding:
                    8px
                    10px;

                border:
                    1px solid
                    rgba(127, 127, 127, 0.3);

                text-align:
                    left;
            }


            .${PREVIEW_CLASS} th {

                font-weight:
                    700;

                background:
                    rgba(127, 127, 127, 0.08);
            }


            /* ==================================================
             * 가운데 오른쪽 기존 글쓰기 영역
             *
             * form의 두 번째 direct child.
             * 정확히 오른쪽 50%.
             * ================================================== */

            form:has(
                textarea[
                    name="content"
                ][
                    placeholder="피드에 올라갈 내용을 작성해주세요."
                ]
            )
            > .${PREVIEW_CLASS}
            + * {

                width:
                    100%;

                min-width:
                    0;

                min-height:
                    0;
            }

        `;


        document.head.appendChild(style);
    }


    /* =========================================================
     * 모달 탐색
     * ======================================================= */

    function detectComposer() {
        const textarea =
            document.querySelector(
                TEXTAREA_SELECTOR
            );


        /*
         * 글쓰기 창 닫힘
         */
        if (!textarea) {

            if (
                currentTextarea ||
                currentPreview
            ) {
                cleanup();
            }

            return;
        }


        /*
         * 이미 현재 textarea에 적용됨
         */
        if (
            textarea === currentTextarea &&
            currentPreview?.isConnected
        ) {
            return;
        }


        activate(textarea);
    }


    /* =========================================================
     * 초기화
     * ======================================================= */

    injectStyle();


    /*
     * Radix Dialog가 DOM에 생성/제거되는 것을 감지
     */
    const observer =
        new MutationObserver(() => {
            detectComposer();
        });


    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );


    detectComposer();

})();
