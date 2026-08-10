// ==UserScript==
// @name         한줄 설명 표시
// @namespace    https://github.com/workforomg/Utill
// @version      2.0.0
// @description  Crack의 모든 API 응답에서 simpleDescription을 자동 수집하여 작품 제목 아래에 표시
// @author       지유지요
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 페이지 실제 window
    // ============================================================

    const PAGE =
        typeof unsafeWindow !== 'undefined'
            ? unsafeWindow
            : window;


    // 중복 실행 방지
    if (PAGE.__CRACK_SIMPLE_DESCRIPTION_V2__) {
        return;
    }

    PAGE.__CRACK_SIMPLE_DESCRIPTION_V2__ = true;


    // ============================================================
    // 설정
    // ============================================================

    const CONFIG = {

        // 설명 최대 줄 수
        maxLines: 2,

        // 설명 색상
        color: '#8b8b8b',

        // 글자 크기
        fontSize: '12px',

        // 줄 높이
        lineHeight: '1.35',

        // 제목과 설명 사이 간격
        marginTop: '2px',

        // 콘솔 디버그
        debug: false
    };


    // ============================================================
    // 저장소
    //
    // key   = 작품 제목
    // value = 작품 데이터
    // ============================================================

    const storyMap = new Map();


    // ============================================================
    // 로그
    // ============================================================

    function log(...args) {

        if (!CONFIG.debug) return;

        console.log(
            '%c[Crack Description]',
            'color:#9b7cff;font-weight:bold;',
            ...args
        );
    }


    // ============================================================
    // 문자열 정규화
    //
    // 화면에서는 줄바꿈/공백 때문에 textContent가 약간 달라질 수 있으므로
    // 연속 공백만 하나로 통일
    // ============================================================

    function normalizeText(value) {

        if (typeof value !== 'string') {
            return '';
        }

        return value
            .replace(/\u00A0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }


    // ============================================================
    // 작품 하나 저장
    // ============================================================

    function saveStory(story) {

        if (!story || typeof story !== 'object') {
            return false;
        }


        const name =
            normalizeText(story.name);


        const simpleDescription =
            normalizeText(story.simpleDescription);


        if (!name || !simpleDescription) {
            return false;
        }


        const previous =
            storyMap.get(name);


        // 동일 데이터면 불필요한 갱신 안 함
        if (
            previous &&
            previous.simpleDescription === simpleDescription &&
            previous.id === (story._id ?? null)
        ) {
            return false;
        }


        storyMap.set(
            name,
            {
                id: story._id ?? null,
                name,
                simpleDescription
            }
        );


        log(
            '수집:',
            name,
            '→',
            simpleDescription
        );


        return true;
    }


    // ============================================================
    // 핵심
    //
    // JSON 구조를 전혀 가정하지 않고 전체를 순회
    //
    // 아래 전부 자동 대응:
    //
    // data.stories[]
    //
    // data.sections[].items[]
    //
    // data.xxx.yyy.items[]
    //
    // 배열 안의 배열
    //
    // 추후 API 구조가 조금 달라져도
    // name + simpleDescription만 있으면 잡음
    // ============================================================

    function scanJson(payload) {

        if (
            !payload ||
            (
                typeof payload !== 'object'
            )
        ) {
            return;
        }


        const stack = [payload];

        const visited =
            new WeakSet();

        let found = 0;

        let changed = false;


        while (stack.length > 0) {

            const current =
                stack.pop();


            if (
                !current ||
                typeof current !== 'object'
            ) {
                continue;
            }


            // 동일 객체 재방문 방지
            try {

                if (visited.has(current)) {
                    continue;
                }

                visited.add(current);

            } catch (_) {
                // 무시
            }


            // ----------------------------------------------------
            // name + simpleDescription이 있으면 작품으로 취급
            // ----------------------------------------------------

            if (
                typeof current.name === 'string' &&
                typeof current.simpleDescription === 'string'
            ) {

                if (saveStory(current)) {
                    changed = true;
                }

                found++;
            }


            // ----------------------------------------------------
            // 객체 내부를 계속 탐색
            // ----------------------------------------------------

            if (Array.isArray(current)) {

                for (
                    let i = current.length - 1;
                    i >= 0;
                    i--
                ) {

                    const value =
                        current[i];


                    if (
                        value &&
                        typeof value === 'object'
                    ) {
                        stack.push(value);
                    }
                }

            } else {

                const values =
                    Object.values(current);


                for (
                    let i = values.length - 1;
                    i >= 0;
                    i--
                ) {

                    const value =
                        values[i];


                    if (
                        value &&
                        typeof value === 'object'
                    ) {
                        stack.push(value);
                    }
                }
            }
        }


        if (found > 0) {

            log(
                `응답에서 작품 ${found}개 발견 / 누적 ${storyMap.size}개`
            );
        }


        // 새 작품이 들어왔으면 즉시 화면 반영
        if (changed) {

            scheduleApply();
        }
    }


    // ============================================================
    // fetch 감시
    // ============================================================

    function hookFetch() {

        if (
            typeof PAGE.fetch !== 'function'
        ) {
            return;
        }


        const originalFetch =
            PAGE.fetch;


        PAGE.fetch = async function (...args) {

            const response =
                await originalFetch.apply(
                    this,
                    args
                );


            try {

                // 사이트가 원본 Response를 사용해야 하므로
                // 반드시 복제본을 읽음
                const clone =
                    response.clone();


                clone
                    .json()
                    .then(data => {

                        scanJson(data);

                    })
                    .catch(() => {

                        // JSON이 아닌 fetch 응답은 무시

                    });


            } catch (error) {

                log(
                    'fetch 처리 오류',
                    error
                );

            }


            // 사이트에는 원본 그대로 전달
            return response;
        };


        log('fetch 감시 시작');
    }


    // ============================================================
    // XMLHttpRequest 감시
    //
    // 혹시 일부 목록이 XHR로 로딩될 경우까지 대응
    // ============================================================

    function hookXHR() {

        const XHR =
            PAGE.XMLHttpRequest;


        if (!XHR) {
            return;
        }


        const originalSend =
            XHR.prototype.send;


        XHR.prototype.send =
            function (...args) {


                this.addEventListener(
                    'load',
                    function () {

                        try {

                            let data = null;


                            // ------------------------------
                            // responseType = json
                            // ------------------------------

                            if (
                                this.responseType === 'json'
                            ) {

                                data =
                                    this.response;

                            }


                            // ------------------------------
                            // 일반 JSON text
                            // ------------------------------

                            else if (
                                !this.responseType ||
                                this.responseType === 'text'
                            ) {

                                const text =
                                    this.responseText;


                                if (
                                    typeof text === 'string' &&
                                    text.length > 0
                                ) {

                                    data =
                                        JSON.parse(text);

                                }
                            }


                            if (data) {

                                scanJson(data);

                            }


                        } catch (_) {

                            // JSON 아닌 응답은 무시

                        }

                    },
                    {
                        once: true
                    }
                );


                return originalSend.apply(
                    this,
                    args
                );
            };


        log('XHR 감시 시작');
    }


    // ============================================================
    // 제목 찾기
    //
    // 특정 carousel/section에 한정하지 않음.
    //
    // 화면에 나타난 작품 제목이면 전부 검사.
    // 실제 storyMap에 같은 제목이 있어야만 적용되므로
    // 다른 일반 텍스트에는 붙지 않음.
    // ============================================================

    const TITLE_SELECTOR = [
        'p.typo-text-base_leading-paragraph_semibold',

        '.typo-text-base_leading-paragraph_semibold',

        'p[class*="typo-text-base"][class*="semibold"]'
    ].join(',');


    // ============================================================
    // 설명 DOM 생성
    // ============================================================

    function createDescriptionElement() {

        const element =
            document.createElement('p');


        element.dataset.crackSimpleDescription =
            'true';


        // Crack 기존 글씨 클래스
        element.className =
            'typo-text-sm_leading-paragraph_regular text-line-gray-2';


        Object.assign(
            element.style,
            {

                display: '-webkit-box',

                WebkitBoxOrient:
                    'vertical',

                WebkitLineClamp:
                    String(CONFIG.maxLines),

                overflow:
                    'hidden',

                textOverflow:
                    'ellipsis',

                wordBreak:
                    'break-word',

                fontSize:
                    CONFIG.fontSize,

                fontWeight:
                    '400',

                lineHeight:
                    CONFIG.lineHeight,

                color:
                    CONFIG.color,

                margin:
                    '0',

                marginTop:
                    CONFIG.marginTop,

                padding:
                    '0',

                pointerEvents:
                    'none'
            }
        );


        return element;
    }


    // ============================================================
    // 제목 하나 처리
    // ============================================================

    function applyToTitle(titleElement) {

        if (
            !titleElement ||
            !titleElement.isConnected
        ) {
            return;
        }


        const title =
            normalizeText(
                titleElement.textContent
            );


        if (!title) {
            return;
        }


        // ========================================================
        // fetch에서 수집한 작품명과 화면 제목 매칭
        // ========================================================

        const story =
            storyMap.get(title);


        const parent =
            titleElement.parentElement;


        if (!parent) {
            return;
        }


        // 현재 제목 영역에 이미 삽입된 설명 탐색
        let descriptionElement = null;


        for (
            const child of parent.children
        ) {

            if (
                child.dataset?.crackSimpleDescription === 'true'
            ) {

                descriptionElement =
                    child;

                break;
            }
        }


        // ========================================================
        // 현재 DOM이 React 재활용으로 다른 작품으로 바뀌었는데
        // 해당 제목 데이터는 아직 없으면 이전 설명 제거
        // ========================================================

        if (!story) {

            if (descriptionElement) {

                descriptionElement.remove();

            }

            return;
        }


        // ========================================================
        // 설명이 아직 없으면 생성
        // ========================================================

        if (!descriptionElement) {

            descriptionElement =
                createDescriptionElement();


            titleElement.insertAdjacentElement(
                'afterend',
                descriptionElement
            );
        }


        // ========================================================
        // 데이터 적용
        // ========================================================

        if (
            descriptionElement.dataset.storyName !== story.name ||
            descriptionElement.textContent !== story.simpleDescription
        ) {

            descriptionElement.dataset.storyName =
                story.name;


            if (story.id) {

                descriptionElement.dataset.storyId =
                    story.id;

            } else {

                delete descriptionElement.dataset.storyId;

            }


            descriptionElement.textContent =
                story.simpleDescription;


            log(
                '화면 적용:',
                story.name
            );
        }
    }


    // ============================================================
    // 현재 화면 전체 적용
    // ============================================================

    function applyAll() {

        if (!document.documentElement) {
            return;
        }


        let titles;


        try {

            titles =
                document.querySelectorAll(
                    TITLE_SELECTOR
                );

        } catch (_) {

            return;

        }


        for (
            const titleElement of titles
        ) {

            applyToTitle(
                titleElement
            );

        }
    }


    // ============================================================
    // 한 프레임에 여러 번 호출되는 것 방지
    // ============================================================

    let applyScheduled =
        false;


    function scheduleApply() {

        if (applyScheduled) {
            return;
        }


        applyScheduled =
            true;


        const run = () => {

            applyScheduled =
                false;

            applyAll();

        };


        if (
            typeof PAGE.requestAnimationFrame === 'function'
        ) {

            PAGE.requestAnimationFrame(
                run
            );

        } else {

            setTimeout(
                run,
                0
            );

        }
    }


    // ============================================================
    // React / 무한 스크롤 DOM 변경 감시
    // ============================================================

    let observer =
        null;


    function startObserver() {

        if (!document.documentElement) {

            setTimeout(
                startObserver,
                10
            );

            return;
        }


        if (observer) {
            return;
        }


        observer =
            new MutationObserver(
                mutations => {

                    let relevant =
                        false;


                    for (
                        const mutation of mutations
                    ) {

                        // 우리가 설명 textContent만 바꾼 경우는
                        // childList 변경이 발생할 수도 있으나
                        // scheduleApply가 프레임 단위로 합쳐주므로 문제 없음.

                        if (
                            mutation.type === 'childList' &&
                            (
                                mutation.addedNodes.length > 0 ||
                                mutation.removedNodes.length > 0
                            )
                        ) {

                            relevant =
                                true;

                            break;
                        }
                    }


                    if (relevant) {

                        scheduleApply();

                    }
                }
            );


        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );


        log(
            'DOM 감시 시작'
        );
    }


    // ============================================================
    // SPA 페이지 이동 감지
    // ============================================================

    function hookHistory() {

        const history =
            PAGE.history;


        if (!history) {
            return;
        }


        const originalPushState =
            history.pushState;


        const originalReplaceState =
            history.replaceState;


        if (
            typeof originalPushState === 'function'
        ) {

            history.pushState =
                function (...args) {

                    const result =
                        originalPushState.apply(
                            this,
                            args
                        );


                    queueMicrotask(
                        scheduleApply
                    );


                    return result;
                };
        }


        if (
            typeof originalReplaceState === 'function'
        ) {

            history.replaceState =
                function (...args) {

                    const result =
                        originalReplaceState.apply(
                            this,
                            args
                        );


                    queueMicrotask(
                        scheduleApply
                    );


                    return result;
                };
        }


        PAGE.addEventListener(
            'popstate',
            () => {

                scheduleApply();

            }
        );
    }


    // ============================================================
    // 안전망
    //
    // React가 DOM 일부를 특이한 방식으로 재활용해서
    // MutationObserver에서 놓쳐도 주기적으로 매우 가볍게 확인
    //
    // API 재요청은 하지 않음.
    // 현재 DOM만 검사.
    // ============================================================

    function startSafetyCheck() {

        setInterval(
            () => {

                if (
                    storyMap.size > 0
                ) {

                    scheduleApply();

                }

            },
            1500
        );
    }


    // ============================================================
    // 디버그 API
    //
    // 개발자 콘솔에서:
    //
    // CrackDescription.info()
    //
    // CrackDescription.get("작품명")
    //
    // CrackDescription.apply()
    //
    // ============================================================

    PAGE.CrackDescription = {

        info() {

            console.log(
                `[Crack Description] 누적 작품: ${storyMap.size}개`
            );


            console.table(
                Array.from(
                    storyMap.values()
                )
            );
        },


        get(name) {

            return storyMap.get(
                normalizeText(name)
            );
        },


        getAll() {

            return Array.from(
                storyMap.values()
            );
        },


        apply() {

            applyAll();
        },


        size() {

            return storyMap.size;
        },


        clear() {

            storyMap.clear();


            document
                .querySelectorAll(
                    '[data-crack-simple-description="true"]'
                )
                .forEach(
                    element => {

                        element.remove();

                    }
                );
        }
    };


    // ============================================================
    // 시작
    // ============================================================

    // 최대한 빨리 API부터 가로챔
    hookFetch();

    hookXHR();

    hookHistory();


    // DOM 준비되면 감시 시작
    startObserver();

    startSafetyCheck();


    if (
        document.readyState === 'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            () => {

                scheduleApply();

            },
            {
                once: true
            }
        );

    } else {

        scheduleApply();

    }


    log(
        'Crack SimpleDescription v2.0 시작'
    );

})();
