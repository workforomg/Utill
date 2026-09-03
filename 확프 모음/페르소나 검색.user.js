// ==UserScript==
// @name         프로필 검색 + 정보 표시
// @namespace    https://github.com/workforomg/Utill
// @version      0.7.1
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
     * Radix option 관련
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

    function constrainListboxLayout(
        listbox,
        viewport
    ) {
        const combobox =
            getControllingCombobox(
                listbox
            );
        const triggerWidth =
            combobox
                ?.getBoundingClientRect()
                .width || 0;
        const width =
            triggerWidth > 0
                ? `${Math.round(triggerWidth)}px`
                : 'var(--radix-select-trigger-width, 320px)';
        const popperWrapper =
            listbox.closest(
                '[data-radix-popper-content-wrapper]'
            );

        /*
         * 최신 구조의 popper wrapper는 min-width가
         * max-content라 긴 information만큼 가로로 늘어난다.
         * 트리거 너비를 기준으로 고정하고 내부만 말줄임한다.
         */
        for (
            const element
            of [popperWrapper, listbox]
        ) {
            if (!element) {
                continue;
            }

            element.style.setProperty(
                'width',
                width,
                'important'
            );
            element.style.setProperty(
                'min-width',
                '0',
                'important'
            );
            element.style.setProperty(
                'max-width',
                'calc(100vw - 16px)',
                'important'
            );
            element.style.setProperty(
                'box-sizing',
                'border-box',
                'important'
            );
            element.style.setProperty(
                'overflow-x',
                'hidden',
                'important'
            );
        }

        if (viewport) {
            Object.assign(
                viewport.style,
                {
                    width: '100%',
                    minWidth: '0',
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    overflowX: 'hidden'
                }
            );
        }

        for (
            const option
            of getOptions(listbox)
        ) {
            Object.assign(
                option.style,
                {
                    width: '100%',
                    minWidth: '0',
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    overflow: 'hidden'
                }
            );
        }
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

        /* API 데이터와 구조 단서가 모두 없으면 대기 */
        return false;
    }

    /********************************************************************
     * 이름 아래 information 표시
     ********************************************************************/

    function setOptionInfoExpanded(
        option,
        expanded
    ) {
        const wrapper =
            option.querySelector(
                '[data-profile-info-wrap]'
            );
        const infoText =
            option.querySelector(
                '[data-profile-info]'
            );

        if (!wrapper || !infoText) {
            return;
        }

        Object.assign(
            infoText.style,
            expanded
                ? {
                    whiteSpace: 'normal',
                    overflow: 'visible',
                    textOverflow: 'clip',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere'
                }
                : {
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    wordBreak: 'normal',
                    overflowWrap: 'normal'
                }
        );

        wrapper.style.overflow =
            expanded
                ? 'visible'
                : 'hidden';

        option.style.overflow =
            expanded
                ? 'visible'
                : 'hidden';
    }

    function bindOptionInfoHover(option) {
        if (
            typeof PAGE.matchMedia === 'function' &&
            !PAGE.matchMedia(
                '(hover: hover) and (pointer: fine)'
            ).matches
        ) {
            return;
        }

        if (
            option.dataset
                .profileInfoHoverBound ===
            'true'
        ) {
            return;
        }

        option.dataset.profileInfoHoverBound =
            'true';

        option.addEventListener(
            'mouseenter',
            () => {
                setOptionInfoExpanded(
                    option,
                    true
                );
            }
        );

        option.addEventListener(
            'mouseleave',
            () => {
                setOptionInfoExpanded(
                    option,
                    false
                );
            }
        );
    }

    let activeProfileModal = null;

    function clickProfileOption(option) {
        if (!option) {
            return;
        }

        option.dataset
            .profileAllowSelection =
            'true';

        option.click();
    }

    function selectProfileFromModal(
        sourceOption,
        profileId,
        profileName,
        optionIndex,
        combobox
    ) {
        if (sourceOption.isConnected) {
            clickProfileOption(
                sourceOption
            );

            return;
        }

        if (!combobox?.isConnected) {
            return;
        }

        combobox.click();

        let attempts = 0;

        const selectWhenReady = () => {
            attempts++;

            const listboxId =
                combobox.getAttribute(
                    'aria-controls'
                ) ||
                combobox.getAttribute(
                    'aria-owns'
                );
            const listbox =
                listboxId
                    ? document.getElementById(
                        listboxId
                    )
                    : null;

            if (listbox) {
                mapProfilesToOptions(
                    listbox
                );

                const options =
                    getOptions(listbox);
                let target =
                    profileId
                        ? options.find(
                            option =>
                                option.dataset
                                    .profileId ===
                                profileId
                        )
                        : null;

                if (!target) {
                    const indexedOption =
                        options[optionIndex];

                    if (
                        indexedOption &&
                        normalizeText(
                            getOptionName(
                                indexedOption
                            )
                        ) ===
                        normalizeText(
                            profileName
                        )
                    ) {
                        target =
                            indexedOption;
                    }
                }

                if (!target && !profileId) {
                    target =
                        options.find(
                            option =>
                                normalizeText(
                                    getOptionName(
                                        option
                                    )
                                ) ===
                                normalizeText(
                                    profileName
                                )
                        );
                }

                if (target) {
                    clickProfileOption(
                        target
                    );

                    return;
                }
            }

            if (attempts < 10) {
                setTimeout(
                    selectWhenReady,
                    40
                );
            }
        };

        setTimeout(
            selectWhenReady,
            0
        );
    }

    function openProfileDetailModal(option) {
        activeProfileModal?.close();

        const listbox =
            option.closest(
                '[role="listbox"]'
            );
        const combobox =
            listbox
                ? getControllingCombobox(
                    listbox
                )
                : null;
        const options =
            listbox
                ? getOptions(listbox)
                : [];
        const optionIndex =
            options.indexOf(option);
        const profileName =
            getOptionName(option) ||
            '이름 없는 프로필';
        const profileId =
            option.dataset.profileId ||
            '';
        const information =
            option.dataset
                .profileInformation ||
            option.querySelector(
                '[data-profile-info]'
            )?.textContent?.trim() ||
            '상세 정보가 없습니다.';

        const overlay =
            document.createElement('div');
        const dialog =
            document.createElement('div');
        const heading =
            document.createElement('div');
        const name =
            document.createElement('div');
        const description =
            document.createElement('div');
        const actions =
            document.createElement('div');
        const cancelButton =
            document.createElement('button');
        const useButton =
            document.createElement('button');
        const headingId =
            'profile-search-detail-title';

        overlay.dataset.profileDetailModal =
            'true';

        Object.assign(
            overlay.style,
            {
                position: 'fixed',
                inset: '0',
                zIndex: '2147483647',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                boxSizing: 'border-box',
                background: 'rgba(0, 0, 0, 0.58)',
                backdropFilter: 'blur(2px)'
            }
        );

        dialog.setAttribute(
            'role',
            'dialog'
        );
        dialog.setAttribute(
            'aria-modal',
            'true'
        );
        dialog.setAttribute(
            'aria-labelledby',
            headingId
        );

        Object.assign(
            dialog.style,
            {
                display: 'flex',
                flexDirection: 'column',
                width: 'min(420px, 100%)',
                maxHeight: 'calc(100dvh - 32px)',
                overflow: 'hidden',
                boxSizing: 'border-box',
                border: '1px solid hsl(var(--border, 0 0% 85%))',
                borderRadius: '14px',
                background: 'hsl(var(--background, 0 0% 100%))',
                color: 'hsl(var(--foreground, 0 0% 10%))',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
            }
        );

        heading.id =
            headingId;
        heading.textContent =
            '프로필 상세정보';

        Object.assign(
            heading.style,
            {
                padding: '18px 20px 8px',
                fontSize: '13px',
                fontWeight: '600',
                opacity: '0.6'
            }
        );

        name.textContent =
            profileName;

        Object.assign(
            name.style,
            {
                padding: '0 20px 14px',
                fontSize: '20px',
                lineHeight: '28px',
                fontWeight: '700',
                overflowWrap: 'anywhere'
            }
        );

        description.textContent =
            information;

        Object.assign(
            description.style,
            {
                flex: '1 1 auto',
                minHeight: '0',
                maxHeight: '55dvh',
                overflowY: 'auto',
                padding: '16px 20px',
                borderTop: '1px solid hsl(var(--border, 0 0% 90%))',
                borderBottom: '1px solid hsl(var(--border, 0 0% 90%))',
                fontSize: '14px',
                lineHeight: '21px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere'
            }
        );

        Object.assign(
            actions.style,
            {
                display: 'flex',
                gap: '8px',
                padding: '14px 16px 16px'
            }
        );

        cancelButton.type =
            'button';
        cancelButton.textContent =
            '취소';
        useButton.type =
            'button';
        useButton.textContent =
            '해당 프로필 사용';

        for (
            const button
            of [cancelButton, useButton]
        ) {
            Object.assign(
                button.style,
                {
                    minHeight: '44px',
                    borderRadius: '9px',
                    font: 'inherit',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer'
                }
            );
        }

        Object.assign(
            cancelButton.style,
            {
                flex: '0 0 92px',
                border: '1px solid hsl(var(--border, 0 0% 82%))',
                background: 'transparent',
                color: 'inherit'
            }
        );

        Object.assign(
            useButton.style,
            {
                flex: '1 1 auto',
                border: '1px solid transparent',
                background: 'hsl(var(--primary, 262 83% 58%))',
                color: 'hsl(var(--primary-foreground, 0 0% 100%))'
            }
        );

        actions.append(
            cancelButton,
            useButton
        );
        dialog.append(
            heading,
            name,
            description,
            actions
        );
        overlay.appendChild(
            dialog
        );

        const stopModalEvent = event => {
            event.stopPropagation();
        };

        for (
            const eventName
            of [
                'pointerdown',
                'mousedown',
                'click'
            ]
        ) {
            overlay.addEventListener(
                eventName,
                stopModalEvent
            );
        }

        let closed = false;

        const close = () => {
            if (closed) {
                return;
            }

            closed = true;
            overlay.remove();
            document.removeEventListener(
                'keydown',
                onKeyDown,
                true
            );

            if (
                activeProfileModal?.overlay ===
                overlay
            ) {
                activeProfileModal =
                    null;
            }
        };

        const onKeyDown = event => {
            if (event.key !== 'Escape') {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            close();
        };

        cancelButton.addEventListener(
            'click',
            event => {
                event.preventDefault();
                close();
            }
        );

        useButton.addEventListener(
            'click',
            event => {
                event.preventDefault();
                close();

                setTimeout(
                    () => {
                        selectProfileFromModal(
                            option,
                            profileId,
                            profileName,
                            optionIndex,
                            combobox
                        );
                    },
                    0
                );
            }
        );

        document.addEventListener(
            'keydown',
            onKeyDown,
            true
        );
        document.body.appendChild(
            overlay
        );

        activeProfileModal = {
            overlay,
            close
        };
    }

    function bindOptionLongPress(option) {
        if (
            option.dataset
                .profileLongPressBound ===
            'true'
        ) {
            return;
        }

        option.dataset.profileLongPressBound =
            'true';

        let timer = null;
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let longPressTriggered = false;
        let suppressClickUntil = 0;
        let lastTouchStartedAt = 0;

        const clearTimer = () => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        };

        option.addEventListener(
            'pointerdown',
            event => {
                if (event.pointerType !== 'touch') {
                    return;
                }

                clearTimer();

                pointerId =
                    event.pointerId;
                startX =
                    event.clientX;
                startY =
                    event.clientY;
                longPressTriggered =
                    false;
                lastTouchStartedAt =
                    Date.now();

                timer = setTimeout(
                    () => {
                        timer = null;

                        if (!option.isConnected) {
                            return;
                        }

                        longPressTriggered =
                            true;
                        suppressClickUntil =
                            Date.now() + 1000;

                        openProfileDetailModal(
                            option
                        );
                    },
                    550
                );
            },
            true
        );

        option.addEventListener(
            'pointermove',
            event => {
                if (
                    event.pointerId !== pointerId
                ) {
                    return;
                }

                const moved =
                    Math.hypot(
                        event.clientX - startX,
                        event.clientY - startY
                    );

                if (moved > 12) {
                    clearTimer();
                }
            },
            true
        );

        option.addEventListener(
            'pointerup',
            event => {
                if (
                    event.pointerId !== pointerId
                ) {
                    return;
                }

                clearTimer();
                pointerId = null;

                if (!longPressTriggered) {
                    return;
                }

                longPressTriggered =
                    false;
                event.preventDefault();
                event.stopImmediatePropagation();
            },
            true
        );

        for (
            const eventName
            of ['pointercancel', 'pointerleave']
        ) {
            option.addEventListener(
                eventName,
                event => {
                    if (
                        event.pointerId !== pointerId
                    ) {
                        return;
                    }

                    clearTimer();
                    pointerId = null;
                },
                true
            );
        }

        option.addEventListener(
            'click',
            event => {
                if (
                    option.dataset
                        .profileAllowSelection ===
                    'true'
                ) {
                    delete option.dataset
                        .profileAllowSelection;

                    return;
                }

                if (
                    Date.now() >=
                    suppressClickUntil
                ) {
                    return;
                }

                event.preventDefault();
                event.stopImmediatePropagation();
            },
            true
        );

        option.addEventListener(
            'contextmenu',
            event => {
                if (
                    Date.now() -
                        lastTouchStartedAt >
                    2000
                ) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
            },
            true
        );
    }

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
         * 최초 1회만 이름 span을 wrapper 안으로 이동
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
                    width: '100%',
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
             * 원래 option의 "*" grow 스타일이
             * 내부 span들에 이상하게 적용되는 경우 방지
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

        /*
         * 정보 없는 프로필
         */
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

        /*
         * 평소에는 한 줄 말줄임,
         * 마우스를 올리면 목록 내부에서 여러 줄로 펼침
         */
        infoText.removeAttribute(
            'title'
        );

        setOptionInfoExpanded(
            option,
            false
        );

        bindOptionInfoHover(
            option
        );
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
         *
         * 동일 이름이 여러 개 있어도
         * 각 프로필을 따로 매칭하기 위함
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
             * API 순서와 DOM 순서가 같고
             * 이름까지 동일
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
             * 동일 이름 중 아직 사용되지 않은 프로필
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

        /*
         * 이름 아래 information 출력
         */
        renderOptionInfo(
            option,
            profile
        );

        if (profile) {
            bindOptionLongPress(
                option
            );
        }

        /*
         * 이름 + information + id
         * 모두 검색 가능
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
            for (
                const option
                of options
            ) {
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

        for (
            const option
            of options
        ) {
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

        constrainListboxLayout(
            listbox,
            viewport
        );

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
                width: '100%',
                minWidth: '0',
                maxWidth: '100%',
                overflow: 'hidden',

                padding: '7px 8px 6px',

                position: 'sticky',
                top: '0',
                zIndex: '20',

                boxSizing: 'border-box',
                background: 'hsl(var(--popover))',
                borderBottom: '1px solid hsl(var(--border))'
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
                gap: '6px',

                width: '100%',
                minWidth: '0',
                maxWidth: '100%',

                boxSizing: 'border-box',
                overflow: 'hidden'
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
                // width: 100%를 사용하지 않고 남는 공간만 차지
                flex: '1 1 auto',
                minWidth: '0',
                maxWidth: '90%',

                height: '32px',
                padding: '0 10px',
                boxSizing: 'border-box',

                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                outline: 'none',

                background: 'hsl(var(--background))',
                color: 'hsl(var(--foreground))',

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
                flex: '0 0 32px',
                width: '32px',
                minWidth: '32px',
                maxWidth: '32px',

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
         * trigger 높이로 제한해놓는 경우 대응
         */
        if (viewport !== listbox) {
            viewport.style.height =
                'auto';

            viewport.style.maxHeight =
                'calc(var(--radix-select-content-available-height, 500px) - 48px)';
        }

        /*
         * 프로필 정보 매핑
         */
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


        /****************************************************************
         * input 이벤트
         ****************************************************************/

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


        /****************************************************************
         * 키보드
         ****************************************************************/

        input.addEventListener(
            'keydown',
            event => {

                /*
                 * 검색어가 있는 상태에서 Esc
                 * → 검색어만 지우기
                 */
                if (
                    event.key ===
                        'Escape' &&
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
                 * → Radix에 전달해서 팝업 닫힘
                 */
                if (
                    event.key ===
                    'Escape'
                ) {
                    return;
                }

                /*
                 * Enter
                 * → 현재 검색 결과 첫 번째 선택
                 */
                if (
                    event.key ===
                    'Enter'
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

                    if (
                        firstVisible
                    ) {
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


        /****************************************************************
         * 마우스 이벤트 충돌 방지
         ****************************************************************/

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


        /****************************************************************
         * 포커스 효과
         ****************************************************************/

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
         * 팝업 열리면 바로 검색 가능
         */
        requestAnimationFrame(
            () => {
                if (
                    input.isConnected &&
                    listbox.isConnected
                ) {
                    try {
                        input.focus({
                            preventScroll:
                                true
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
        /*
         * 이미 열린 검색창 갱신
         */
        for (
            const listbox
            of activeListboxes
        ) {
            if (
                !listbox.isConnected
            ) {
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
         * API가 늦게 들어와서
         * 이전에는 프로필 Select인지
         * 판단하지 못한 팝업 재검사
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
     * 새 DOM만 검사
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
         * listbox가 먼저 생기고 option이 나중에
         * 추가되는 구조도 다시 검사한다.
         */
        const ownerListbox =
            node.closest(
                '[role="listbox"]'
            );

        if (ownerListbox) {
            listboxes.add(ownerListbox);
        }

        node.querySelectorAll?.(
            '[role="listbox"]'
        ).forEach(
            listbox => {
                listboxes.add(listbox);
            }
        );

        for (const listbox of listboxes) {
            attachSearch(listbox);
        }
    }


    /********************************************************************
     * 제거된 popup 정리
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
                    if (
                        !listbox.isConnected
                    ) {
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
             * 스크립트보다 먼저 열린 popup
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
