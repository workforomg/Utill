// ==UserScript==
// @name         프로필 검색 + 정보 표시
// @namespace    https://github.com/workforomg/Utill
// @version      0.6.0
// @author       지유지요
// @description  프로필 선택창에 이름/정보 검색 및 프로필 정보 표시
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(() => {
    'use strict';

    const PAGE =
        typeof unsafeWindow !== 'undefined'
            ? unsafeWindow
            : window;

    const LOG_PREFIX = '[ProfileSearch]';

    // 마지막으로 감지된 chatProfiles
    let chatProfiles = [];

    // 처리된 listbox
    const processedListboxes = new WeakSet();

    // option별 검색 문자열 캐시
    const optionSearchCache = new WeakMap();

    // 현재 열려 있는 listbox
    const activeListboxes = new Set();

    /********************************************************************
     * 공통
     ********************************************************************/

    function log(...args) {
        console.debug(LOG_PREFIX, ...args);
    }

    function normalizeText(value) {
        return String(value ?? '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/\s+/g, '');
    }

    function isObject(value) {
        return (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value)
        );
    }

    /********************************************************************
     * 응답 내부에서 chatProfiles 탐색
     ********************************************************************/

    function findChatProfiles(value, depth = 0) {
        if (!value || depth > 8) {
            return null;
        }

        if (Array.isArray(value)) {
            for (const child of value) {
                if (
                    child &&
                    typeof child === 'object'
                ) {
                    const found = findChatProfiles(
                        child,
                        depth + 1
                    );

                    if (found) {
                        return found;
                    }
                }
            }

            return null;
        }

        if (isObject(value)) {
            if (Array.isArray(value.chatProfiles)) {
                return value.chatProfiles;
            }

            if (
                isObject(value.data) &&
                Array.isArray(value.data.chatProfiles)
            ) {
                return value.data.chatProfiles;
            }

            for (const key of Object.keys(value)) {
                const child = value[key];

                if (
                    child &&
                    typeof child === 'object'
                ) {
                    const found = findChatProfiles(
                        child,
                        depth + 1
                    );

                    if (found) {
                        return found;
                    }
                }
            }
        }

        return null;
    }

    /********************************************************************
     * 프로필 저장
     ********************************************************************/

    function saveChatProfiles(profiles) {
        if (!Array.isArray(profiles)) {
            return;
        }

        chatProfiles = profiles.filter(
            profile =>
                profile &&
                typeof profile === 'object'
        );

        log(
            `프로필 ${chatProfiles.length}개 감지`,
            chatProfiles
        );

        refreshActiveListboxes();
    }

    /********************************************************************
     * fetch 후킹
     ********************************************************************/

    function hookFetch() {
        const originalFetch = PAGE.fetch;

        if (
            typeof originalFetch !== 'function' ||
            originalFetch.__profileSearchHooked
        ) {
            return;
        }

        async function hookedFetch(...args) {
            const response =
                await originalFetch.apply(this, args);

            try {
                const contentType =
                    response.headers?.get('content-type') || '';

                if (
                    contentType.includes('application/json') ||
                    contentType.includes('+json')
                ) {
                    response
                        .clone()
                        .json()
                        .then(json => {
                            const profiles =
                                findChatProfiles(json);

                            if (profiles) {
                                saveChatProfiles(profiles);
                            }
                        })
                        .catch(() => {});
                }
            } catch (error) {
                console.debug(
                    LOG_PREFIX,
                    'fetch 분석 실패:',
                    error
                );
            }

            return response;
        }

        hookedFetch.__profileSearchHooked = true;
        hookedFetch.__originalFetch = originalFetch;

        PAGE.fetch = hookedFetch;

        log('fetch 감시 시작');
    }

    /********************************************************************
     * XHR 후킹
     ********************************************************************/

    function hookXHR() {
        const XHR = PAGE.XMLHttpRequest;

        if (
            !XHR ||
            XHR.prototype.__profileSearchHooked
        ) {
            return;
        }

        const originalOpen = XHR.prototype.open;

        XHR.prototype.open = function (...args) {
            if (!this.__profileSearchListenerAdded) {
                this.__profileSearchListenerAdded = true;

                this.addEventListener(
                    'load',
                    function () {
                        try {
                            let json;

                            if (
                                this.responseType === 'json' &&
                                this.response
                            ) {
                                json = this.response;
                            } else {
                                if (!this.responseText) {
                                    return;
                                }

                                json = JSON.parse(
                                    this.responseText
                                );
                            }

                            const profiles =
                                findChatProfiles(json);

                            if (profiles) {
                                saveChatProfiles(profiles);
                            }
                        } catch {
                            // 무시
                        }
                    }
                );
            }

            return originalOpen.apply(
                this,
                args
            );
        };

        XHR.prototype.__profileSearchHooked = true;

        log('XHR 감시 시작');
    }

    /********************************************************************
     * listbox/option 관련
     ********************************************************************/

    function getViewport(listbox) {
        return (
            listbox.querySelector(
                ':scope > [data-radix-select-viewport]'
            ) ||
            listbox.querySelector(
                '[data-radix-select-viewport]'
            ) ||
            Array.from(
                listbox.children
            ).find(
                child =>
                    child.getAttribute('role') ===
                        'presentation' &&
                    child.querySelector(
                        '[role="option"]'
                    )
            ) ||
            listbox
        );
    }

    function getOptions(listbox) {
        return Array.from(
            listbox.querySelectorAll(
                '[role="option"]'
            )
        ).filter(
            option =>
                option.closest(
                    '[role="listbox"]'
                ) === listbox
        );
    }

    function getOptionName(option) {
        const labelledBy =
            option.getAttribute('aria-labelledby');

        if (labelledBy) {
            const label =
                document.getElementById(labelledBy);

            if (label) {
                return (
                    label.textContent?.trim() ||
                    ''
                );
            }
        }

        // 우리가 추가한 information 텍스트는 제외
        const name =
            option.querySelector(
                '[data-profile-name]'
            );

        if (name) {
            return (
                name.textContent?.trim() ||
                ''
            );
        }

        const spans =
            option.querySelectorAll(
                ':scope > span:not([data-profile-info])'
            );

        if (spans.length) {
            const last =
                spans[spans.length - 1];

            const text =
                last.textContent?.trim();

            if (text) {
                return text;
            }
        }

        return (
            option.textContent?.trim() ||
            ''
        );
    }

    /********************************************************************
     * 프로필 Select인지 판단
     ********************************************************************/

    function getControllingCombobox(
        listbox
    ) {
        const listboxId =
            listbox.id;

        if (listboxId) {
            const comboboxes =
                document.querySelectorAll(
                    '[role="combobox"][aria-controls], ' +
                    '[role="combobox"][aria-owns]'
                );

            for (const combobox of comboboxes) {
                if (
                    combobox.getAttribute(
                        'aria-controls'
                    ) === listboxId ||
                    combobox.getAttribute(
                        'aria-owns'
                    ) === listboxId
                ) {
                    return combobox;
                }
            }
        }

        /*
         * 최신 미리보기/상세 화면은 팝업 wrapper를
         * 콤보박스와 같은 필드 안에 렌더링한다.
         */
        const popupWrapper =
            listbox.closest(
                '[data-radix-popper-content-wrapper]'
            );

        const field =
            popupWrapper?.parentElement;

        return (
            field?.querySelector(
                ':scope > [role="combobox"]'
            ) ||
            null
        );
    }

    function hasProfileFieldLabel(
        combobox
    ) {
        if (!combobox) {
            return false;
        }

        const isProfileLabel = value => {
            const normalized =
                normalizeText(value);

            return (
                normalized === '대화프로필' ||
                normalized === '채팅프로필'
            );
        };

        if (
            isProfileLabel(
                combobox.getAttribute(
                    'aria-label'
                )
            )
        ) {
            return true;
        }

        const labelledBy =
            combobox.getAttribute(
                'aria-labelledby'
            );

        if (labelledBy) {
            for (
                const id
                of labelledBy.split(/\s+/)
            ) {
                if (
                    isProfileLabel(
                        document
                            .getElementById(id)
                            ?.textContent
                    )
                ) {
                    return true;
                }
            }
        }

        let sibling =
            combobox.previousElementSibling;

        while (sibling) {
            if (
                isProfileLabel(
                    sibling.textContent
                )
            ) {
                return true;
            }

            sibling =
                sibling.previousElementSibling;
        }

        return false;
    }

    function looksLikeProfileListbox(listbox) {
        if (!listbox) {
            return false;
        }

        const options =
            getOptions(listbox);

        if (!options.length) {
            return false;
        }

        /*
         * 최신 구조:
         * listbox id ↔ combobox aria-controls 연결과
         * 필드 라벨로 즉시 판별한다.
         */
        if (
            hasProfileFieldLabel(
                getControllingCombobox(
                    listbox
                )
            )
        ) {
            return true;
        }

        /*
         * 이전 구조 호환:
         * API 데이터를 알고 있다면 이름 일치율로 판단
         */
        if (chatProfiles.length) {
            const profileNames =
                new Set(
                    chatProfiles
                        .map(profile =>
                            normalizeText(
                                profile.name
                            )
                        )
                        .filter(Boolean)
                );

            let matched = 0;

            for (const option of options) {
                const name =
                    normalizeText(
                        getOptionName(option)
                    );

                if (profileNames.has(name)) {
                    matched++;
                }
            }

            return (
                matched >= 1 &&
                matched / options.length >= 0.5
            );
        }

        // API 데이터와 구조 단서가 모두 없으면 대기
        return false;
    }

    /********************************************************************
     * 이름 아래 information 표시
     ********************************************************************/

    function renderOptionInfo(
        option,
        profile
    ) {
        if (!option) {
            return;
        }

        const labelledBy =
            option.getAttribute(
                'aria-labelledby'
            );

        let nameSpan =
            labelledBy
                ? document.getElementById(
                    labelledBy
                )
                : null;

        if (!nameSpan) {
            nameSpan =
                option.querySelector(
                    '[data-profile-name]'
                );
        }

        if (!nameSpan) {
            const optionName =
                normalizeText(
                    getOptionName(option)
                );

            const children =
                Array.from(
                    option.children
                );

            nameSpan =
                children
                    .reverse()
                    .find(
                        child =>
                            !child.matches(
                                '[data-profile-info], ' +
                                '[data-profile-info-wrap]'
                            ) &&
                            normalizeText(
                                child.textContent
                            ) === optionName
                    ) ||
                null;
        }

        if (!nameSpan) {
            return;
        }

        let wrapper =
            option.querySelector(
                '[data-profile-info-wrap]'
            );

        /*
         * 최초 1회만 이름 요소를 wrapper 안으로 이동
         */
        if (!wrapper) {
            wrapper =
                document.createElement('div');

            wrapper.dataset.profileInfoWrap =
                'true';

            Object.assign(
                wrapper.style,
                {
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    flex: '1 1 auto',
                    minWidth: '0',
                    maxWidth: '100%',
                    overflow: 'hidden'
                }
            );

            nameSpan.parentNode.insertBefore(
                wrapper,
                nameSpan
            );

            wrapper.appendChild(
                nameSpan
            );

            nameSpan.dataset.profileName =
                'true';

            Object.assign(
                nameSpan.style,
                {
                    display: 'block',
                    width: '100%',
                    minWidth: '0',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    lineHeight: '18px'
                }
            );

            /*
             * option의 grow 스타일이
             * 내부 span에 잘못 적용되는 경우 방지
             */
            wrapper.style.flexGrow = '1';
        }

        let infoText =
            wrapper.querySelector(
                '[data-profile-info]'
            );

        const information =
            profile?.information
                ? String(
                    profile.information
                )
                    .replace(/\s+/g, ' ')
                    .trim()
                : '';

        if (!information) {
            if (infoText) {
                infoText.remove();
            }

            return;
        }

        if (!infoText) {
            infoText =
                document.createElement('span');

            infoText.dataset.profileInfo =
                'true';

            Object.assign(
                infoText.style,
                {
                    display: 'block',
                    width: '100%',
                    minWidth: '0',
                    maxWidth: '100%',
                    marginTop: '0px',
                    fontSize: '10px',
                    lineHeight: '12px',
                    fontWeight: '400',
                    opacity: '0.55',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none'
                }
            );

            wrapper.appendChild(
                infoText
            );
        }

        infoText.textContent =
            information;

        // 마우스를 올리면 전체 정보 표시
        infoText.title =
            information;
    }

    /********************************************************************
     * API 프로필 ↔ DOM option 매핑
     ********************************************************************/

    function mapProfilesToOptions(
        listbox
    ) {
        const options =
            getOptions(listbox);

        if (!options.length) {
            return;
        }

        /*
         * 아직 API 정보가 없으면
         * 이름만 검색 캐시에 등록
         */
        if (!chatProfiles.length) {
            for (const option of options) {
                const name =
                    getOptionName(option);

                optionSearchCache.set(
                    option,
                    normalizeText(name)
                );
            }

            return;
        }

        /*
         * 이름별 bucket
         * 동일 이름이 여러 개여도 각각 매칭
         */
        const profileBuckets =
            new Map();

        for (
            let index = 0;
            index < chatProfiles.length;
            index++
        ) {
            const profile =
                chatProfiles[index];

            const key =
                normalizeText(
                    profile.name
                );

            if (
                !profileBuckets.has(key)
            ) {
                profileBuckets.set(
                    key,
                    []
                );
            }

            profileBuckets
                .get(key)
                .push({
                    profile,
                    index,
                    used: false
                });
        }

        const usedIndexes =
            new Set();

        for (
            let index = 0;
            index < options.length;
            index++
        ) {
            const option =
                options[index];

            const optionName =
                getOptionName(option);

            const normalizedOptionName =
                normalizeText(
                    optionName
                );

            let profile = null;

            /*
             * 1순위:
             * API 순서와 DOM 순서가 같고 이름도 동일
             */
            const directProfile =
                chatProfiles[index];

            if (
                directProfile &&
                normalizeText(
                    directProfile.name
                ) === normalizedOptionName
            ) {
                profile =
                    directProfile;

                usedIndexes.add(
                    index
                );

                const bucket =
                    profileBuckets.get(
                        normalizedOptionName
                    );

                if (bucket) {
                    const matching =
                        bucket.find(
                            item =>
                                item.index ===
                                index
                        );

                    if (matching) {
                        matching.used =
                            true;
                    }
                }
            }

            /*
             * 2순위:
             * 같은 이름 중 아직 사용되지 않은 프로필
             */
            if (!profile) {
                const bucket =
                    profileBuckets.get(
                        normalizedOptionName
                    );

                if (bucket) {
                    const candidate =
                        bucket.find(
                            item =>
                                !item.used &&
                                !usedIndexes.has(
                                    item.index
                                )
                        );

                    if (candidate) {
                        candidate.used =
                            true;

                        profile =
                            candidate.profile;

                        usedIndexes.add(
                            candidate.index
                        );
                    }
                }
            }

            buildOptionSearchCache(
                option,
                profile,
                optionName
            );
        }
    }

    /********************************************************************
     * 검색 캐시 구성
     ********************************************************************/

    function buildOptionSearchCache(
        option,
        profile,
        optionName
    ) {
        const parts = [
            optionName
        ];

        if (profile) {
            if (profile.name) {
                parts.push(
                    profile.name
                );
            }

            if (profile.information) {
                parts.push(
                    profile.information
                );
            }

            if (profile._id) {
                parts.push(
                    profile._id
                );
            }

            if (
                profile.isRepresentative
            ) {
                parts.push(
                    '대표 대표프로필'
                );
            }

            option.dataset.profileId =
                profile._id || '';

            option.dataset.profileInformation =
                profile.information || '';
        }

        renderOptionInfo(
            option,
            profile
        );

        /*
         * 이름 + information + id 검색 가능
         */
        optionSearchCache.set(
            option,
            normalizeText(
                parts
                    .filter(Boolean)
                    .join(' ')
            )
        );
    }

    /********************************************************************
     * 검색
     ********************************************************************/

    function filterListbox(
        listbox,
        input
    ) {
        const keyword =
            normalizeText(
                input.value
            );

        const options =
            getOptions(listbox);

        if (!keyword) {
            for (const option of options) {
                option.hidden = false;

                option.style
                    .removeProperty(
                        'display'
                    );
            }

            updateResultCount(
                listbox,
                options.length,
                options.length
            );

            return;
        }

        let visibleCount = 0;

        for (const option of options) {
            let searchText =
                optionSearchCache.get(
                    option
                );

            if (!searchText) {
                searchText =
                    normalizeText(
                        getOptionName(
                            option
                        )
                    );

                optionSearchCache.set(
                    option,
                    searchText
                );
            }

            const matched =
                searchText.includes(
                    keyword
                );

            option.hidden =
                !matched;

            if (matched) {
                option.style
                    .removeProperty(
                        'display'
                    );

                visibleCount++;
            } else {
                option.style.setProperty(
                    'display',
                    'none',
                    'important'
                );
            }
        }

        updateResultCount(
            listbox,
            visibleCount,
            options.length
        );
    }

    /********************************************************************
     * 검색 결과 개수
     ********************************************************************/

    function updateResultCount(
        listbox,
        visible,
        total
    ) {
        const counter =
            listbox.querySelector(
                '[data-profile-search-count]'
            );

        if (!counter) {
            return;
        }

        counter.textContent =
            visible === total
                ? String(total)
                : `${visible}/${total}`;
    }

    /********************************************************************
     * 검색 UI
     ********************************************************************/

    function createSearchUI(
        listbox
    ) {
        const viewport =
            getViewport(listbox);

        if (!viewport) {
            return;
        }

        const wrapper =
            document.createElement(
                'div'
            );

        wrapper.dataset.profileSearch =
            'true';

        Object.assign(
            wrapper.style,
            {
                flex: '0 0 auto',
                padding: '7px 8px 6px',
                position: 'sticky',
                top: '0',
                zIndex: '20',
                boxSizing: 'border-box',
                background:
                    'hsl(var(--popover))',
                borderBottom:
                    '1px solid hsl(var(--border))'
            }
        );

        const row =
            document.createElement(
                'div'
            );

        Object.assign(
            row.style,
            {
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
            }
        );

        const input =
            document.createElement(
                'input'
            );

        input.type = 'search';
        input.placeholder =
            '이름 · 프로필 정보 검색';
        input.autocomplete = 'off';
        input.spellcheck = false;

        input.setAttribute(
            'aria-label',
            '프로필 검색'
        );

        Object.assign(
            input.style,
            {
                flex: '1 1 auto',
                minWidth: '0',
                width: '100%',
                height: '32px',
                padding: '0 10px',
                boxSizing: 'border-box',
                border:
                    '1px solid hsl(var(--border))',
                borderRadius: '6px',
                outline: 'none',
                background:
                    'hsl(var(--background))',
                color:
                    'hsl(var(--foreground))',
                font: 'inherit',
                fontSize: '13px'
            }
        );

        const counter =
            document.createElement(
                'span'
            );

        counter.dataset.profileSearchCount =
            'true';

        Object.assign(
            counter.style,
            {
                flex: '0 0 auto',
                minWidth: '28px',
                textAlign: 'right',
                fontSize: '10px',
                opacity: '0.5',
                userSelect: 'none'
            }
        );

        row.append(
            input,
            counter
        );

        wrapper.appendChild(
            row
        );

        /*
         * 검색창을 viewport 위에 삽입
         */
        const searchHost =
            viewport === listbox
                ? listbox
                : viewport.parentElement ||
                    listbox;

        searchHost.insertBefore(
            wrapper,
            viewport === listbox
                ? listbox.firstChild
                : viewport
        );

        /*
         * Radix가 viewport 높이를
         * trigger 높이로 제한하는 경우 대응
         */
        if (viewport !== listbox) {
            viewport.style.height =
                'auto';

            viewport.style.maxHeight =
                'calc(var(--radix-select-content-available-height, 500px) - 48px)';
        }

        mapProfilesToOptions(
            listbox
        );

        const initialCount =
            getOptions(
                listbox
            ).length;

        updateResultCount(
            listbox,
            initialCount,
            initialCount
        );

        /*
         * 검색 입력
         */
        input.addEventListener(
            'input',
            () => {
                filterListbox(
                    listbox,
                    input
                );
            },
            {
                passive: true
            }
        );

        /*
         * 키보드
         */
        input.addEventListener(
            'keydown',
            event => {
                /*
                 * 검색어가 있는 상태에서 Esc
                 * → 검색어만 지우기
                 */
                if (
                    event.key === 'Escape' &&
                    input.value
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    input.value = '';

                    filterListbox(
                        listbox,
                        input
                    );

                    return;
                }

                /*
                 * 검색어가 비어 있을 때 Esc
                 * → Radix에 전달하여 팝업 닫기
                 */
                if (
                    event.key === 'Escape'
                ) {
                    return;
                }

                /*
                 * Enter
                 * → 현재 검색 결과 첫 번째 선택
                 */
                if (
                    event.key === 'Enter'
                ) {
                    const firstVisible =
                        getOptions(
                            listbox
                        ).find(
                            option =>
                                !option.hidden &&
                                getComputedStyle(
                                    option
                                ).display !==
                                    'none'
                        );

                    if (firstVisible) {
                        event.preventDefault();
                        event.stopPropagation();

                        firstVisible.click();
                    }

                    return;
                }

                /*
                 * Radix 자체 typeahead 방지
                 */
                event.stopPropagation();
            },
            true
        );

        /*
         * 마우스 이벤트 충돌 방지
         */
        for (
            const eventName
            of [
                'pointerdown',
                'mousedown',
                'click'
            ]
        ) {
            input.addEventListener(
                eventName,
                event => {
                    event.stopPropagation();
                }
            );
        }

        /*
         * 포커스 효과
         */
        input.addEventListener(
            'focus',
            () => {
                input.style.borderColor =
                    'hsl(var(--ring))';
            }
        );

        input.addEventListener(
            'blur',
            () => {
                input.style.borderColor =
                    'hsl(var(--border))';
            }
        );

        /*
         * 팝업이 열리면 바로 검색 가능
         */
        requestAnimationFrame(
            () => {
                if (
                    input.isConnected &&
                    listbox.isConnected
                ) {
                    try {
                        input.focus({
                            preventScroll: true
                        });
                    } catch {
                        input.focus();
                    }
                }
            }
        );

        log(
            '프로필 검색창 추가'
        );
    }

    /********************************************************************
     * listbox 처리
     ********************************************************************/

    function attachSearch(
        listbox
    ) {
        if (!listbox) {
            return;
        }

        if (
            processedListboxes.has(
                listbox
            )
        ) {
            return;
        }

        if (
            listbox.querySelector(
                '[data-profile-search]'
            )
        ) {
            processedListboxes.add(
                listbox
            );

            activeListboxes.add(
                listbox
            );

            return;
        }

        if (
            !looksLikeProfileListbox(
                listbox
            )
        ) {
            return;
        }

        processedListboxes.add(
            listbox
        );

        activeListboxes.add(
            listbox
        );

        createSearchUI(
            listbox
        );
    }

    /********************************************************************
     * API 갱신 시 열린 팝업 업데이트
     ********************************************************************/

    function refreshActiveListboxes() {
        for (
            const listbox
            of activeListboxes
        ) {
            if (!listbox.isConnected) {
                activeListboxes.delete(
                    listbox
                );

                continue;
            }

            mapProfilesToOptions(
                listbox
            );

            const input =
                listbox.querySelector(
                    '[data-profile-search] input'
                );

            if (input) {
                filterListbox(
                    listbox,
                    input
                );
            }
        }

        /*
         * API가 늦게 들어왔거나
         * 이전에 옵션이 없었던 목록 재검사
         */
        document
            .querySelectorAll(
                '[role="listbox"]'
            )
            .forEach(
                listbox => {
                    attachSearch(
                        listbox
                    );
                }
            );
    }

    /********************************************************************
     * 새 DOM 검사
     ********************************************************************/

    function inspectAddedNode(
        node
    ) {
        if (
            !(node instanceof Element)
        ) {
            return;
        }

        const listboxes =
            new Set();

        if (
            node.matches(
                '[role="listbox"]'
            )
        ) {
            listboxes.add(node);
        }

        /*
         * listbox가 먼저 생성되고 option이
         * 나중에 추가되는 구조도 다시 검사
         */
        const ownerListbox =
            node.closest(
                '[role="listbox"]'
            );

        if (ownerListbox) {
            listboxes.add(
                ownerListbox
            );
        }

        node.querySelectorAll?.(
            '[role="listbox"]'
        ).forEach(
            listbox => {
                listboxes.add(
                    listbox
                );
            }
        );

        for (
            const listbox
            of listboxes
        ) {
            attachSearch(
                listbox
            );
        }
    }

    /********************************************************************
     * 제거된 팝업 정리
     ********************************************************************/

    let cleanupQueued = false;

    function cleanupDisconnected() {
        if (cleanupQueued) {
            return;
        }

        cleanupQueued = true;

        requestAnimationFrame(
            () => {
                cleanupQueued = false;

                for (
                    const listbox
                    of activeListboxes
                ) {
                    if (!listbox.isConnected) {
                        activeListboxes.delete(
                            listbox
                        );
                    }
                }
            }
        );
    }

    /********************************************************************
     * MutationObserver
     ********************************************************************/

    function startDOMObserver() {
        const start = () => {
            if (!document.body) {
                return;
            }

            /*
             * 스크립트보다 먼저 열린 목록 검사
             */
            document
                .querySelectorAll(
                    '[role="listbox"]'
                )
                .forEach(
                    listbox => {
                        attachSearch(
                            listbox
                        );
                    }
                );

            const observer =
                new MutationObserver(
                    mutations => {
                        let removed = false;

                        for (
                            const mutation
                            of mutations
                        ) {
                            for (
                                const node
                                of mutation.addedNodes
                            ) {
                                inspectAddedNode(
                                    node
                                );
                            }

                            if (
                                mutation
                                    .removedNodes
                                    .length
                            ) {
                                removed = true;
                            }
                        }

                        if (removed) {
                            cleanupDisconnected();
                        }
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
                '프로필 선택 팝업 감시 시작'
            );
        };

        if (document.body) {
            start();
        } else {
            document.addEventListener(
                'DOMContentLoaded',
                start,
                {
                    once: true
                }
            );
        }
    }

    /********************************************************************
     * 실행
     ********************************************************************/

    hookFetch();
    hookXHR();
    startDOMObserver();
})();
