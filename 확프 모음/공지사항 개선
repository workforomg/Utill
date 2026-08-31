// ==UserScript==
// @name         공지사항 확장
// @namespace    https://github.com/workforomg/Utill
// @version      0.5.0
// @author       지유지요
// @description  공지 전체 로드 + 카테고리/날짜 필터 + 제목/본문 검색
// @match        https://crack.wrtn.ai/announcement
// @run-at       document-idle
// @grant        unsafeWindow
// ==/UserScript==

(() => {
    'use strict';

    /********************************************************************
     * 설정
     ********************************************************************/

    const API_BASE =
        'https://crack-api.wrtn.ai/crack-api/announcements';

    const LIMIT = 10;
    const PAGE_CONCURRENCY = 4;
    const BODY_CONCURRENCY = 3;
    const BODY_REQUEST_DELAY = 100;
    const SEARCH_DEBOUNCE = 350;
    const MAX_PAGES = 200;

    const CATEGORIES = [
        '전체',
        '공지',
        '업데이트',
        '이벤트',
        '콜라보'
    ];

    const PAGE =
        typeof unsafeWindow !== 'undefined'
            ? unsafeWindow
            : window;

    const pageFetch =
        PAGE.fetch.bind(PAGE);

    const LOG_PREFIX =
        '[CrackAnnouncement]';


    /********************************************************************
     * 상태
     ********************************************************************/

    const state = {
        announcements: [],

        loaded: false,
        loading: false,

        category: '전체',
        query: '',
        fromDate: '',
        toDate: '',

        // id -> 검색용 본문
        bodyCache: new Map(),

        // id -> 진행 중인 상세 document Promise
        bodyInflight: new Map(),

        // 검색 취소용
        bodyGeneration: 0,

        bodySearching: false,
        bodyDone: 0,
        bodyTotal: 0,

        mounted: false
    };


    /********************************************************************
     * UI 참조
     ********************************************************************/

    let filterBar = null;
    let infoBar = null;
    let appRoot = null;
    let listRoot = null;

    let resultCounter = null;
    let statusText = null;

    let searchInput = null;
    let fromInput = null;
    let toInput = null;

    let searchTimer = null;
    let renderQueued = false;
    let pageCheckQueued = false;


    /********************************************************************
     * 공통
     ********************************************************************/

    function log(...args) {
        console.debug(
            LOG_PREFIX,
            ...args
        );
    }


    function normalizeText(value) {
        return String(value ?? '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }


    function sleep(ms) {
        return new Promise(
            resolve =>
                setTimeout(resolve, ms)
        );
    }


    function isAnnouncementListPage() {
        return /^\/announcement\/?$/.test(
            location.pathname
        );
    }


    /********************************************************************
     * 날짜
     ********************************************************************/

    function getKoreanDateParts(dateString) {
        const date =
            new Date(dateString);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return null;
        }

        const formatter =
            new Intl.DateTimeFormat(
                'ko-KR',
                {
                    timeZone: 'Asia/Seoul',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }
            );

        const parts =
            formatter.formatToParts(
                date
            );

        const result = {};

        for (const part of parts) {
            result[part.type] =
                part.value;
        }

        return {
            year: result.year,
            month: result.month,
            day: result.day
        };
    }


    function formatDate(dateString) {
        const parts =
            getKoreanDateParts(
                dateString
            );

        if (!parts) {
            return '';
        }

        return (
            `${parts.year}년 ` +
            `${parts.month}월 ` +
            `${parts.day}일`
        );
    }


    function getDateKey(dateString) {
        const parts =
            getKoreanDateParts(
                dateString
            );

        if (!parts) {
            return '';
        }

        return (
            `${parts.year}-` +
            `${parts.month}-` +
            `${parts.day}`
        );
    }


    /********************************************************************
     * HTTP
     ********************************************************************/

    async function fetchWithRetry(
        url,
        options = {},
        retries = 2
    ) {
        let lastError = null;

        for (
            let attempt = 0;
            attempt <= retries;
            attempt++
        ) {
            try {
                const response =
                    await pageFetch(
                        url,
                        options
                    );

                if (
                    response.status === 429 ||
                    response.status >= 500
                ) {
                    throw new Error(
                        `HTTP ${response.status}`
                    );
                }

                return response;

            } catch (error) {
                lastError = error;

                if (attempt >= retries) {
                    break;
                }

                await sleep(
                    300 *
                    (attempt + 1)
                );
            }
        }

        throw lastError ||
            new Error('fetch 실패');
    }


    /********************************************************************
     * 공지 목록 한 페이지
     ********************************************************************/

    async function requestPage(page) {
        const url =
            `${API_BASE}` +
            `?page=${page}` +
            `&limit=${LIMIT}`;

        const response =
            await fetchWithRetry(
                url,
                {
                    method: 'GET',
                    credentials: 'include'
                }
            );

        if (!response.ok) {
            throw new Error(
                `페이지 ${page}: HTTP ${response.status}`
            );
        }

        const json =
            await response.json();

        if (
            json?.result !== 'SUCCESS' ||
            !Array.isArray(json?.data)
        ) {
            throw new Error(
                `페이지 ${page}: 응답 형식 오류`
            );
        }

        return json.data;
    }


    /********************************************************************
     * 전체 공지 수집
     ********************************************************************/

    async function loadAllAnnouncements() {
        if (
            state.loading ||
            state.loaded
        ) {
            return;
        }

        state.loading = true;

        updateStatus(
            '전체 공지 불러오는 중...'
        );

        const resultMap =
            new Map();

        let startPage = 1;
        let finished = false;

        try {
            while (
                !finished &&
                startPage <= MAX_PAGES
            ) {
                const pages =
                    Array.from(
                        {
                            length:
                                PAGE_CONCURRENCY
                        },
                        (_, index) =>
                            startPage + index
                    ).filter(
                        page =>
                            page <= MAX_PAGES
                    );

                const responses =
                    await Promise.all(
                        pages.map(
                            async page => {
                                try {
                                    return {
                                        page,

                                        data:
                                            await requestPage(
                                                page
                                            ),

                                        error: null
                                    };

                                } catch (error) {
                                    return {
                                        page,
                                        data: [],
                                        error
                                    };
                                }
                            }
                        )
                    );

                responses.sort(
                    (a, b) =>
                        a.page - b.page
                );

                for (const result of responses) {
                    if (result.error) {
                        if (
                            resultMap.size > 0
                        ) {
                            finished = true;
                            break;
                        }

                        throw result.error;
                    }

                    for (
                        const item
                        of result.data
                    ) {
                        if (!item?._id) {
                            continue;
                        }

                        resultMap.set(
                            item._id,
                            item
                        );
                    }

                    updateStatus(
                        `${resultMap.size}개 불러옴`
                    );

                    /*
                     * 마지막 페이지
                     */
                    if (
                        result.data.length <
                        LIMIT
                    ) {
                        finished = true;
                        break;
                    }
                }

                startPage +=
                    PAGE_CONCURRENCY;
            }

            state.announcements =
                Array.from(
                    resultMap.values()
                );

            /*
             * 최신순
             */
            state.announcements.sort(
                (a, b) =>
                    new Date(
                        b.createdAt
                    ).getTime() -
                    new Date(
                        a.createdAt
                    ).getTime()
            );

            state.loaded = true;

            log(
                `전체 공지 ${state.announcements.length}개 로드 완료`
            );

            /*
             * 새 목록을 먼저 그린다.
             */
            render();

            /*
             * 그 다음 원본 item-list만 숨긴다.
             */
            requestAnimationFrame(
                () => {
                    hideOriginalList();
                }
            );

        } catch (error) {
            console.error(
                LOG_PREFIX,
                '전체 공지 로드 실패',
                error
            );

            updateStatus(
                `불러오기 실패: ${error.message}`
            );

        } finally {
            state.loading = false;

            render();
        }
    }


    /********************************************************************
     * 상세 document
     ********************************************************************/

    async function requestBody(item) {
        const id =
            item?._id;

        if (!id) {
            return '';
        }

        /*
         * 이미 읽음
         */
        if (
            state.bodyCache.has(id)
        ) {
            return (
                state.bodyCache.get(id) ||
                ''
            );
        }

        /*
         * 현재 다른 worker가 읽고 있음
         */
        if (
            state.bodyInflight.has(id)
        ) {
            return state.bodyInflight.get(
                id
            );
        }

        const promise =
            (async () => {
                const url =
                    `https://crack.wrtn.ai/announcement/${id}`;

                try {
                    const response =
                        await fetchWithRetry(
                            url,
                            {
                                method: 'GET',
                                credentials:
                                    'include'
                            },
                            1
                        );

                    if (!response.ok) {
                        throw new Error(
                            `HTTP ${response.status}`
                        );
                    }

                    const html =
                        await response.text();

                    const body =
                        extractAnnouncementText(
                            html,
                            item
                        );

                    /*
                     * 빈 문자열도 조회 완료로 캐시
                     */
                    state.bodyCache.set(
                        id,
                        body || ''
                    );

                    return body || '';

                } catch (error) {
                    console.debug(
                        LOG_PREFIX,
                        '상세 document 요청/분석 실패:',
                        id,
                        error
                    );

                    state.bodyCache.set(
                        id,
                        ''
                    );

                    return '';

                } finally {
                    state.bodyInflight.delete(
                        id
                    );
                }
            })();

        state.bodyInflight.set(
            id,
            promise
        );

        return promise;
    }


    /********************************************************************
     * 상세 HTML에서 제목 요소 찾기
     ********************************************************************/

    function findTitleElement(
        doc,
        item
    ) {
        const expected =
            normalizeText(
                item?.title
            );

        if (!expected) {
            return null;
        }

        const candidates =
            doc.querySelectorAll(
                [
                    'h1',
                    'h2',
                    'h3',
                    'h4',
                    'h5',
                    'p',
                    'span',
                    'div'
                ].join(',')
            );

        let fallback = null;

        for (
            const element
            of candidates
        ) {
            const text =
                normalizeText(
                    element.textContent
                );

            if (
                text !== expected
            ) {
                continue;
            }

            if (
                element.children.length <=
                1
            ) {
                return element;
            }

            if (!fallback) {
                fallback = element;
            }
        }

        return fallback;
    }


    /********************************************************************
     * 제목 기준 본문 컨테이너 탐색
     ********************************************************************/

    function findContentContainer(
        titleElement,
        titleText,
        doc
    ) {
        let current =
            titleElement;

        let best = null;

        for (
            let depth = 0;
            depth < 9;
            depth++
        ) {
            current =
                current?.parentElement;

            if (!current) {
                break;
            }

            if (
                current ===
                doc.documentElement
            ) {
                break;
            }

            const text =
                normalizeText(
                    current.textContent
                );

            const extraLength =
                Math.max(
                    0,
                    text.length -
                    titleText.length
                );

            /*
             * 제목 이외 텍스트가 어느 정도 있어야
             * 본문 컨테이너로 인정
             */
            if (
                extraLength >= 20 &&
                text.length <= 60000
            ) {
                best = current;

                /*
                 * 가장 작은 적당한 부모 사용
                 */
                if (
                    current.tagName !==
                        'MAIN' &&
                    current !== doc.body
                ) {
                    break;
                }
            }

            if (
                current === doc.body
            ) {
                break;
            }
        }

        return best;
    }


    /********************************************************************
     * 메타데이터 텍스트 제거
     ********************************************************************/

    function removeExactTextElements(
        root,
        values
    ) {
        const normalizedValues =
            new Set(
                values
                    .map(
                        value =>
                            normalizeText(
                                value
                            )
                    )
                    .filter(Boolean)
            );

        if (!normalizedValues.size) {
            return;
        }

        const elements =
            Array.from(
                root.querySelectorAll(
                    [
                        'h1',
                        'h2',
                        'h3',
                        'h4',
                        'h5',
                        'p',
                        'span',
                        'div'
                    ].join(',')
                )
            ).reverse();

        for (
            const element
            of elements
        ) {
            const text =
                normalizeText(
                    element.textContent
                );

            if (
                !normalizedValues.has(
                    text
                )
            ) {
                continue;
            }

            /*
             * 큰 wrapper 삭제 방지
             */
            if (
                element.children.length <=
                1
            ) {
                element.remove();
            }
        }
    }


    /********************************************************************
     * 상세 HTML -> 실제 본문
     *
     * script / Next hydration / body 전체는 검색하지 않음
     ********************************************************************/

    function extractAnnouncementText(
        html,
        item
    ) {
        if (
            !html ||
            !item?.title
        ) {
            return '';
        }

        const doc =
            new DOMParser()
                .parseFromString(
                    html,
                    'text/html'
                );

        if (!doc?.body) {
            return '';
        }

        /*
         * 공통 데이터/스크립트 제거
         */
        doc.querySelectorAll(
            [
                'script',
                'style',
                'noscript',
                'svg',
                'iframe',
                'nav',
                'header',
                'footer'
            ].join(',')
        ).forEach(
            element =>
                element.remove()
        );

        const titleText =
            normalizeText(
                item.title
            );

        const titleElement =
            findTitleElement(
                doc,
                item
            );

        if (!titleElement) {
            return '';
        }

        const contentContainer =
            findContentContainer(
                titleElement,
                titleText,
                doc
            );

        if (!contentContainer) {
            return '';
        }

        const clone =
            contentContainer.cloneNode(
                true
            );

        clone.querySelectorAll(
            [
                'script',
                'style',
                'noscript',
                'svg',
                'iframe',
                'nav',
                'header',
                'footer',
                'button'
            ].join(',')
        ).forEach(
            element =>
                element.remove()
        );

        /*
         * 제목/카테고리/날짜를 검색 본문에서 제거
         */
        removeExactTextElements(
            clone,
            [
                item.title,
                item.category,

                formatDate(
                    item.createdAt
                ),

                '공지사항',
                '목록',
                '목록으로'
            ]
        );

        let text =
            normalizeText(
                clone.textContent
            );

        /*
         * 제목이 여전히 맨 앞에 남은 경우
         */
        if (
            text.startsWith(
                titleText
            )
        ) {
            text =
                text
                    .slice(
                        titleText.length
                    )
                    .trim();
        }

        if (
            text.length < 10
        ) {
            return '';
        }

        return text;
    }


    /********************************************************************
     * 카테고리 + 날짜
     ********************************************************************/

    function getBaseFilteredItems() {
        return state.announcements.filter(
            item => {

                /*
                 * 카테고리
                 */
                if (
                    state.category !==
                        '전체' &&
                    item.category !==
                        state.category
                ) {
                    return false;
                }

                /*
                 * 날짜
                 */
                const dateKey =
                    getDateKey(
                        item.createdAt
                    );

                if (
                    state.fromDate &&
                    dateKey <
                        state.fromDate
                ) {
                    return false;
                }

                if (
                    state.toDate &&
                    dateKey >
                        state.toDate
                ) {
                    return false;
                }

                return true;
            }
        );
    }


    /********************************************************************
     * 최종 검색 결과
     ********************************************************************/

    function getFilteredItems() {
        const base =
            getBaseFilteredItems();

        const query =
            normalizeText(
                state.query
            );

        if (!query) {
            return base;
        }

        return base.filter(
            item => {

                /*
                 * 제목
                 */
                const title =
                    normalizeText(
                        item.title
                    );

                if (
                    title.includes(
                        query
                    )
                ) {
                    return true;
                }

                /*
                 * 본문
                 */
                const body =
                    state.bodyCache.get(
                        item._id
                    );

                return Boolean(
                    body &&
                    body.includes(
                        query
                    )
                );
            }
        );
    }


    /********************************************************************
     * 본문 검색
     ********************************************************************/

    async function startBodySearch() {
        const query =
            normalizeText(
                state.query
            );

        /*
         * 한 글자는 제목 검색만
         */
        if (
            query.length < 2
        ) {
            state.bodySearching =
                false;

            render();

            return;
        }

        const generation =
            ++state.bodyGeneration;

        const candidates =
            getBaseFilteredItems()
                .filter(
                    item => {

                        /*
                         * 제목에 이미 검색어가 있으면
                         * document까지 읽을 필요 없음
                         */
                        if (
                            normalizeText(
                                item.title
                            ).includes(
                                query
                            )
                        ) {
                            return false;
                        }

                        /*
                         * 이미 본문을 읽은 공지도 제외
                         */
                        if (
                            state.bodyCache.has(
                                item._id
                            )
                        ) {
                            return false;
                        }

                        return true;
                    }
                );

        if (!candidates.length) {
            state.bodySearching =
                false;

            render();

            return;
        }

        state.bodySearching = true;
        state.bodyDone = 0;

        state.bodyTotal =
            candidates.length;

        render();

        let cursor = 0;

        async function worker() {
            while (
                cursor <
                candidates.length
            ) {
                /*
                 * 검색어가 변경됨
                 */
                if (
                    generation !==
                    state.bodyGeneration
                ) {
                    return;
                }

                const index =
                    cursor++;

                const item =
                    candidates[index];

                await requestBody(
                    item
                );

                state.bodyDone++;

                queueRender();

                await sleep(
                    BODY_REQUEST_DELAY
                );
            }
        }

        const workerCount =
            Math.min(
                BODY_CONCURRENCY,
                candidates.length
            );

        await Promise.all(
            Array.from(
                {
                    length:
                        workerCount
                },
                () =>
                    worker()
            )
        );

        if (
            generation !==
            state.bodyGeneration
        ) {
            return;
        }

        state.bodySearching =
            false;

        render();
    }


    function scheduleBodySearch() {
        if (searchTimer) {
            clearTimeout(
                searchTimer
            );
        }

        /*
         * 기존 검색 취소
         */
        state.bodyGeneration++;

        searchTimer =
            setTimeout(
                () => {
                    startBodySearch();
                },
                SEARCH_DEBOUNCE
            );
    }


    /********************************************************************
     * 렌더 예약
     ********************************************************************/

    function queueRender() {
        if (renderQueued) {
            return;
        }

        renderQueued = true;

        requestAnimationFrame(
            () => {
                renderQueued = false;

                render();
            }
        );
    }


    /********************************************************************
     * 공지 아이템
     ********************************************************************/

    function createAnnouncementItem(
        item
    ) {
        const anchor =
            document.createElement(
                'a'
            );

        anchor.className =
            'ca-item';

        anchor.href =
            `/announcement/${item._id}`;


        /****************************************************************
         * 위쪽
         ****************************************************************/

        const meta =
            document.createElement(
                'div'
            );

        meta.className =
            'ca-meta';


        const badge =
            document.createElement(
                'span'
            );

        badge.className =
            'ca-badge';

        badge.dataset.category =
            item.category || '';

        badge.textContent =
            item.category || '기타';


        const date =
            document.createElement(
                'span'
            );

        date.className =
            'ca-item-date';

        date.textContent =
            formatDate(
                item.createdAt
            );


        meta.append(
            badge,
            date
        );


        /****************************************************************
         * 제목
         ****************************************************************/

        const title =
            document.createElement(
                'div'
            );

        title.className =
            'ca-title';

        title.textContent =
            item.title || '';


        anchor.append(
            meta,
            title
        );

        return anchor;
    }


    /********************************************************************
     * 렌더
     ********************************************************************/

    function render() {
        if (
            !listRoot ||
            !listRoot.isConnected
        ) {
            return;
        }

        const items =
            getFilteredItems();


        /****************************************************************
         * 결과 개수
         ****************************************************************/

        if (resultCounter) {
            if (!state.loaded) {
                resultCounter.textContent =
                    '';

            } else if (
                state.category ===
                    '전체' &&
                !state.query &&
                !state.fromDate &&
                !state.toDate
            ) {
                resultCounter.textContent =
                    `전체 ${state.announcements.length}개`;

            } else {
                resultCounter.textContent =
                    `${items.length}개`;
            }
        }


        updateStatus();


        const fragment =
            document.createDocumentFragment();


        /*
         * 로딩 중에는 새 목록을 비워둔다.
         * 원본 크랙 목록은 아직 살아 있음.
         */
        if (
            state.loading &&
            !state.announcements.length
        ) {
            listRoot.replaceChildren();

            return;
        }


        /****************************************************************
         * 결과 없음
         ****************************************************************/

        if (!items.length) {
            const empty =
                document.createElement(
                    'div'
                );

            empty.className =
                'ca-empty';

            empty.textContent =
                state.bodySearching
                    ? '본문까지 검색 중...'
                    : '검색 결과가 없습니다.';

            fragment.appendChild(
                empty
            );

        } else {
            for (
                const item
                of items
            ) {
                fragment.appendChild(
                    createAnnouncementItem(
                        item
                    )
                );
            }
        }


        listRoot.replaceChildren(
            fragment
        );
    }


    /********************************************************************
     * 상태
     ********************************************************************/

    function updateStatus(
        forcedText = null
    ) {
        if (!statusText) {
            return;
        }

        if (
            forcedText !== null
        ) {
            statusText.textContent =
                forcedText;

            return;
        }

        if (
            state.bodySearching
        ) {
            statusText.textContent =
                `본문 검색 ${state.bodyDone}/${state.bodyTotal}`;

            return;
        }

        if (state.loading) {
            statusText.textContent =
                '전체 공지 불러오는 중...';

            return;
        }

        statusText.textContent =
            '';
    }


    /********************************************************************
     * 제목 찾기
     ********************************************************************/

    function findTitleHost() {
        const titles =
            document.querySelectorAll(
                'p'
            );

        for (
            const title
            of titles
        ) {
            if (
                title.textContent
                    ?.trim() ===
                '공지사항'
            ) {
                return title.parentElement;
            }
        }

        return null;
    }


    /********************************************************************
     * 원본 Virtuoso
     ********************************************************************/

    function getOriginalItemList() {
        return document.querySelector(
            '[data-testid="virtuoso-item-list"]'
        );
    }


    /********************************************************************
     * 원본 목록만 숨김
     *
     * 부모 / scroller는 절대 건드리지 않음
     ********************************************************************/

    function hideOriginalList() {
        const itemList =
            getOriginalItemList();

        if (!itemList) {
            return false;
        }

        if (
            itemList.closest(
                '#crack-announcement-enhancer'
            )
        ) {
            return false;
        }

        if (
            !state.loaded ||
            !appRoot ||
            !appRoot.isConnected
        ) {
            return false;
        }

        itemList.dataset
            .caOriginalHidden =
            '1';

        itemList.style.setProperty(
            'display',
            'none',
            'important'
        );

        itemList.style.setProperty(
            'padding-top',
            '0px',
            'important'
        );

        itemList.style.setProperty(
            'padding-bottom',
            '0px',
            'important'
        );

        itemList.style.setProperty(
            'height',
            '0px',
            'important'
        );

        itemList.style.setProperty(
            'min-height',
            '0px',
            'important'
        );

        itemList.style.setProperty(
            'margin',
            '0px',
            'important'
        );

        itemList.style.setProperty(
            'overflow',
            'hidden',
            'important'
        );

        return true;
    }


    function restoreOriginalList() {
        const itemList =
            getOriginalItemList();

        if (!itemList) {
            return;
        }

        if (
            itemList.dataset
                .caOriginalHidden !==
            '1'
        ) {
            return;
        }

        delete itemList.dataset
            .caOriginalHidden;

        for (
            const property
            of [
                'display',
                'padding-top',
                'padding-bottom',
                'height',
                'min-height',
                'margin',
                'overflow'
            ]
        ) {
            itemList.style.removeProperty(
                property
            );
        }
    }


    /********************************************************************
     * UI 생성
     ********************************************************************/

    function createUI(titleHost) {
        if (
            !titleHost ||
            document.getElementById(
                'crack-announcement-enhancer'
            )
        ) {
            return false;
        }

        injectStyles();


        /****************************************************************
         * 필터 바
         ****************************************************************/

        filterBar =
            document.createElement(
                'div'
            );

        filterBar.className =
            'ca-filter-bar';


        /****************************************************************
         * 카테고리
         ****************************************************************/

        const categories =
            document.createElement(
                'div'
            );

        categories.className =
            'ca-categories';


        for (
            const category
            of CATEGORIES
        ) {
            const button =
                document.createElement(
                    'button'
                );

            button.type =
                'button';

            button.className =
                'ca-category';

            button.textContent =
                category;

            button.dataset.category =
                category;


            if (
                category ===
                state.category
            ) {
                button.classList.add(
                    'active'
                );
            }


            button.addEventListener(
                'click',
                () => {
                    state.category =
                        category;

                    for (
                        const other
                        of categories.children
                    ) {
                        other.classList.toggle(
                            'active',
                            other === button
                        );
                    }

                    state.bodyGeneration++;

                    render();

                    scheduleBodySearch();
                }
            );


            categories.appendChild(
                button
            );
        }


        /****************************************************************
         * 도구
         ****************************************************************/

        const tools =
            document.createElement(
                'div'
            );

        tools.className =
            'ca-tools';


        /****************************************************************
         * 시작 날짜
         ****************************************************************/

        fromInput =
            document.createElement(
                'input'
            );

        fromInput.type =
            'date';

        fromInput.className =
            'ca-date';

        fromInput.title =
            '시작 날짜';

        fromInput.value =
            state.fromDate;


        fromInput.addEventListener(
            'change',
            () => {
                state.fromDate =
                    fromInput.value;

                state.bodyGeneration++;

                render();

                scheduleBodySearch();
            }
        );


        /****************************************************************
         * ~
         ****************************************************************/

        const separator =
            document.createElement(
                'span'
            );

        separator.className =
            'ca-date-separator';

        separator.textContent =
            '~';


        /****************************************************************
         * 종료 날짜
         ****************************************************************/

        toInput =
            document.createElement(
                'input'
            );

        toInput.type =
            'date';

        toInput.className =
            'ca-date';

        toInput.title =
            '종료 날짜';

        toInput.value =
            state.toDate;


        toInput.addEventListener(
            'change',
            () => {
                state.toDate =
                    toInput.value;

                state.bodyGeneration++;

                render();

                scheduleBodySearch();
            }
        );


        /****************************************************************
         * 검색
         ****************************************************************/

        const searchWrap =
            document.createElement(
                'div'
            );

        searchWrap.className =
            'ca-search-wrap';


        searchInput =
            document.createElement(
                'input'
            );

        searchInput.type =
            'search';

        searchInput.className =
            'ca-search';

        searchInput.placeholder =
            '제목 · 본문 검색';

        searchInput.autocomplete =
            'off';

        searchInput.spellcheck =
            false;

        searchInput.value =
            state.query;


        searchInput.addEventListener(
            'input',
            () => {
                state.query =
                    searchInput.value;

                /*
                 * 제목/이미 캐시된 본문은 바로 검색
                 */
                render();

                /*
                 * 아직 안 읽은 본문은 디바운스
                 */
                scheduleBodySearch();
            }
        );


        searchWrap.appendChild(
            searchInput
        );


        tools.append(
            fromInput,
            separator,
            toInput,
            searchWrap
        );


        filterBar.append(
            categories,
            tools
        );


        /****************************************************************
         * 결과 정보
         ****************************************************************/

        infoBar =
            document.createElement(
                'div'
            );

        infoBar.className =
            'ca-info-bar';


        resultCounter =
            document.createElement(
                'span'
            );

        resultCounter.className =
            'ca-result-counter';


        statusText =
            document.createElement(
                'span'
            );

        statusText.className =
            'ca-status-text';


        infoBar.append(
            resultCounter,
            statusText
        );


        /****************************************************************
         * 확장 목록
         ****************************************************************/

        appRoot =
            document.createElement(
                'div'
            );

        appRoot.id =
            'crack-announcement-enhancer';


        listRoot =
            document.createElement(
                'div'
            );

        listRoot.className =
            'ca-list';


        appRoot.appendChild(
            listRoot
        );


        /****************************************************************
         * 공지사항 제목 바로 아래에 순서대로 삽입
         *
         * 제목
         * ↓
         * 필터
         * 결과정보
         * 새 목록
         ****************************************************************/

        titleHost.insertAdjacentElement(
            'afterend',
            appRoot
        );

        titleHost.insertAdjacentElement(
            'afterend',
            infoBar
        );

        titleHost.insertAdjacentElement(
            'afterend',
            filterBar
        );


        state.mounted =
            true;


        if (state.loaded) {
            render();

            requestAnimationFrame(
                () => {
                    hideOriginalList();
                }
            );

        } else {
            /*
             * 로딩 중 원본 목록은 그대로 둔다.
             */
            render();

            loadAllAnnouncements();
        }


        log(
            '공지 확장 UI 생성 완료'
        );

        return true;
    }


    /********************************************************************
     * UI 제거
     ********************************************************************/

    function unmountUI() {
        state.bodyGeneration++;

        if (searchTimer) {
            clearTimeout(
                searchTimer
            );

            searchTimer =
                null;
        }

        restoreOriginalList();

        filterBar?.remove();
        infoBar?.remove();
        appRoot?.remove();

        filterBar = null;
        infoBar = null;
        appRoot = null;
        listRoot = null;

        resultCounter = null;
        statusText = null;

        searchInput = null;
        fromInput = null;
        toInput = null;

        state.mounted =
            false;
    }


    /********************************************************************
     * CSS
     ********************************************************************/

    function injectStyles() {
        if (
            document.getElementById(
                'ca-enhancer-style'
            )
        ) {
            return;
        }

        const style =
            document.createElement(
                'style'
            );

        style.id =
            'ca-enhancer-style';

        style.textContent = `

.ca-filter-bar {
    width: 100%;
    box-sizing: border-box;

    margin-top: 20px;
    margin-bottom: 4px;

    display: flex;
    align-items: center;
    justify-content: space-between;

    gap: 14px;
}


/* =========================================================
   카테고리
   ========================================================= */

.ca-categories {
    display: flex;
    align-items: center;

    gap: 6px;

    min-width: 0;
}


.ca-category {
    appearance: none;

    height: 30px;

    padding: 0 11px;

    border:
        1px solid rgba(255,255,255,0.10);

    border-radius: 6px;

    background:
        rgba(255,255,255,0.035);

    color:
        rgba(255,255,255,0.67);

    font-family: inherit;

    font-size: 12px;
    line-height: 1;
    font-weight: 500;

    white-space: nowrap;

    cursor: pointer;

    transition:
        background 0.12s ease,
        color 0.12s ease,
        border-color 0.12s ease;
}


.ca-category:hover {
    background:
        rgba(255,255,255,0.07);

    color:
        rgba(255,255,255,0.92);
}


.ca-category.active {
    background:
        rgba(255,255,255,0.11);

    border-color:
        rgba(255,255,255,0.16);

    color:
        rgba(255,255,255,0.97);
}


/* =========================================================
   검색
   ========================================================= */

.ca-tools {
    margin-left: auto;

    display: flex;
    align-items: center;

    gap: 6px;

    min-width: 0;
}


.ca-date {
    width: 126px;
    height: 32px;

    box-sizing: border-box;

    padding: 0 8px;

    border:
        1px solid rgba(255,255,255,0.10);

    border-radius: 6px;

    outline: none;

    background:
        rgba(255,255,255,0.025);

    color:
        rgba(255,255,255,0.72);

    color-scheme: dark;

    font-family: inherit;

    font-size: 11px;
}


.ca-date:hover {
    border-color:
        rgba(255,255,255,0.18);
}


.ca-date:focus {
    border-color:
        rgba(255,255,255,0.28);
}


.ca-date-separator {
    font-size: 11px;

    color:
        rgba(255,255,255,0.32);

    user-select: none;
}


.ca-search-wrap {
    width: 220px;

    min-width: 150px;
}


.ca-search {
    width: 100%;
    height: 32px;

    box-sizing: border-box;

    padding: 0 10px;

    border:
        1px solid rgba(255,255,255,0.10);

    border-radius: 6px;

    outline: none;

    background:
        rgba(255,255,255,0.025);

    color:
        rgba(255,255,255,0.90);

    font-family: inherit;

    font-size: 12px;
}


.ca-search::placeholder {
    color:
        rgba(255,255,255,0.34);
}


.ca-search:hover {
    border-color:
        rgba(255,255,255,0.18);
}


.ca-search:focus {
    border-color:
        rgba(255,255,255,0.28);

    background:
        rgba(255,255,255,0.04);
}


/* =========================================================
   상태
   ========================================================= */

.ca-info-bar {
    width: 100%;

    box-sizing: border-box;

    min-height: 28px;

    padding: 6px 1px 7px;

    display: flex;
    align-items: center;

    font-size: 12px;

    color:
        rgba(255,255,255,0.38);
}


.ca-result-counter {
    color:
        rgba(255,255,255,0.40);
}


.ca-status-text {
    margin-left: auto;
}


/* =========================================================
   목록
   ========================================================= */

#crack-announcement-enhancer {
    width: 100%;
}


.ca-list {
    width: 100%;
}


.ca-item {
    display: block;

    width: 100%;

    box-sizing: border-box;

    padding: 18px 0 19px;

    border-bottom:
        1px solid rgba(255,255,255,0.12);

    color: inherit;

    text-decoration: none;
}


.ca-meta {
    width: 100%;

    display: flex;
    align-items: center;

    margin-bottom: 11px;
}


/* =========================================================
   배지
   ========================================================= */

.ca-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;

    height: 22px;

    box-sizing: border-box;

    padding: 0 9px;

    border-radius: 5px;

    font-size: 12px;
    line-height: 1;
    font-weight: 600;

    color:
        rgba(255,255,255,0.95);

    background:
        rgba(255,255,255,0.08);
}


.ca-badge[data-category="공지"] {
    background:
        rgba(22, 95, 39, 0.50);

    color:
        rgb(88, 215, 107);
}


.ca-badge[data-category="업데이트"] {
    background:
        rgba(0, 78, 145, 0.50);

    color:
        rgb(53, 153, 247);
}


.ca-badge[data-category="이벤트"] {
    background:
        rgba(135, 80, 0, 0.48);

    color:
        rgb(245, 167, 30);
}


.ca-badge[data-category="콜라보"] {
    background:
        rgba(95, 52, 135, 0.48);

    color:
        rgb(185, 116, 245);
}


/* =========================================================
   날짜
   ========================================================= */

.ca-item-date {
    margin-left: auto;

    font-size: 13px;
    font-weight: 400;

    color:
        rgba(255,255,255,0.46);

    white-space: nowrap;
}


/* =========================================================
   제목
   ========================================================= */

.ca-title {
    width: 100%;

    color:
        rgba(255,255,255,0.91);

    font-size: 15px;
    line-height: 1.5;
    font-weight: 500;

    transition:
        color 0.10s ease;
}


.ca-item:hover .ca-title {
    color:
        rgba(255,255,255,1);
}


/* =========================================================
   결과 없음
   ========================================================= */

.ca-empty {
    min-height: 140px;

    display: flex;
    align-items: center;
    justify-content: center;

    font-size: 13px;

    color:
        rgba(255,255,255,0.40);
}


/* =========================================================
   모바일
   ========================================================= */

@media (max-width: 820px) {

    .ca-filter-bar {
        flex-direction: column;

        align-items: flex-start;

        gap: 9px;
    }


    .ca-categories {
        width: 100%;

        overflow-x: auto;

        scrollbar-width: none;
    }


    .ca-categories::-webkit-scrollbar {
        display: none;
    }


    .ca-tools {
        width: 100%;

        margin-left: 0;

        flex-wrap: wrap;
    }


    .ca-search-wrap {
        flex: 1 1 180px;

        width: auto;
    }


    .ca-date {
        flex: 0 1 125px;
    }
}

`;

        document.head.appendChild(
            style
        );
    }


    /********************************************************************
     * SPA 대응
     ********************************************************************/

    function checkPage() {
        /*
         * 공지 목록 페이지가 아니면 제거
         */
        if (
            !isAnnouncementListPage()
        ) {
            if (state.mounted) {
                unmountUI();
            }

            return;
        }


        /*
         * React가 DOM을 갈아끼워서
         * 확장 UI가 없어졌을 경우
         */
        if (
            state.mounted &&
            (
                !appRoot ||
                !appRoot.isConnected
            )
        ) {
            state.mounted = false;

            filterBar = null;
            infoBar = null;

            appRoot = null;
            listRoot = null;

            resultCounter = null;
            statusText = null;

            searchInput = null;
            fromInput = null;
            toInput = null;
        }


        /*
         * UI가 이미 존재
         */
        if (
            appRoot &&
            appRoot.isConnected
        ) {
            /*
             * Virtuoso가 다시 만들어졌다면
             * item-list 자체만 다시 숨김
             */
            if (state.loaded) {
                const originalList =
                    getOriginalItemList();

                if (
                    originalList &&
                    originalList.dataset
                        .caOriginalHidden !==
                        '1'
                ) {
                    hideOriginalList();
                }
            }

            return;
        }


        const titleHost =
            findTitleHost();

        if (!titleHost) {
            return;
        }


        createUI(
            titleHost
        );
    }


    function schedulePageCheck() {
        if (pageCheckQueued) {
            return;
        }

        pageCheckQueued = true;

        requestAnimationFrame(
            () => {
                pageCheckQueued =
                    false;

                checkPage();
            }
        );
    }


    /********************************************************************
     * 실행
     ********************************************************************/

    function init() {
        schedulePageCheck();


        const observer =
            new MutationObserver(
                () => {
                    schedulePageCheck();
                }
            );


        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );


        log(
            '공지사항 감시 시작'
        );
    }


    if (document.body) {
        init();

    } else {
        document.addEventListener(
            'DOMContentLoaded',
            init,
            {
                once: true
            }
        );
    }

})();
