// ==UserScript==
// @name         채팅 휴지통
// @namespace    https://github.com/workforomg/Utill
// @version      1.5.0
// @author       지유지요
// @description  채팅 휴지통 / PC 사이드바 absolute + 모바일 body fixed 전체화면 / XHR·fetch 세션목록 필터 / 원본 API 인증 헤더 재사용 / 선택 일괄 복구·삭제 / JSON 백업
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    "use strict";

    // =========================================================
    // 설정
    // =========================================================

    const API_ORIGIN = "https://crack-api.wrtn.ai";
    const API_BASE = `${API_ORIGIN}/crack-gen/v3`;

    const STORAGE_KEY = "crack-trash-sessions-v1";
    const LOG_KEY = "crack-trash-import-log-v1";

    const ID = {
        STYLE: "crack-trash-style-v210",
        OVERLAY: "crack-trash-overlay",
        HEADER: "crack-trash-header",
        CONTENT: "crack-trash-content",
        SCROLL: "crack-trash-scroll",
        COUNT: "crack-trash-count",
        TOAST: "crack-trash-toast",
        FILE_INPUT: "crack-trash-file-input",
    };

    const state = {
        currentChatContext: null,
        chatContextByTriggerId: new Map(),
        trashView: null,
        customMenu: null,

        selectionMode: null,
        selectedIds: new Set(),

        permanentlyDeletedIds: new Set(),

        serverChats: new Map(),
        serverChatsLoaded: false,
        loadingTrash: false,
        loadingText: "",

        capturedApiHeaders: new Map(),
        capturedAuthSeenAt: 0,

        editItemTemplate: null,
        deleteItemTemplate: null,
    };

    // =========================================================
    // 원본 Radix 메뉴 클래스
    // =========================================================

    const RADIX_MENU_CLASS =
        "max-h-[var(--radix-dropdown-menu-content-available-height)] " +
        "min-w-[8rem] " +
        "origin-[--radix-dropdown-menu-content-transform-origin] " +
        "overflow-y-auto overflow-x-hidden " +
        "rounded-md border bg-popover p-2 " +
        "text-popover-foreground z-dropdown " +
        "data-[state=open]:animate-in " +
        "data-[state=closed]:animate-out " +
        "data-[state=closed]:fade-out-0 " +
        "data-[state=open]:fade-in-0 " +
        "data-[side=bottom]:slide-in-from-top-2 " +
        "data-[side=left]:slide-in-from-right-2 " +
        "data-[side=right]:slide-in-from-left-2 " +
        "data-[side=top]:slide-in-from-bottom-2";

    const RADIX_ITEM_CLASS =
        "relative flex cursor-default select-none " +
        "items-center gap-2 rounded-sm " +
        "px-2 py-1.5 text-sm outline-none " +
        "transition-colors " +
        "focus:bg-accent focus:text-accent-foreground " +
        "data-[disabled]:pointer-events-none " +
        "data-[disabled]:opacity-50 " +
        "[&_svg]:pointer-events-none " +
        "[&_svg]:size-4 " +
        "[&_svg]:shrink-0";

    // =========================================================
    // 원본 네트워크 함수 보관
    // =========================================================

    const upstreamFetch = window.fetch.bind(window);
    const upstreamXhrOpen = XMLHttpRequest.prototype.open;
    const upstreamXhrSetRequestHeader =
        XMLHttpRequest.prototype.setRequestHeader;

    const xhrRequestMeta = new WeakMap();
    const internalApiXhrs = new WeakSet();
    const xhrFilterCache = new WeakMap();

    const xhrResponseTextDescriptor =
        Object.getOwnPropertyDescriptor(
            XMLHttpRequest.prototype,
            "responseText"
        );

    const xhrResponseDescriptor =
        Object.getOwnPropertyDescriptor(
            XMLHttpRequest.prototype,
            "response"
        );

    // =========================================================
    // 기본 유틸
    // =========================================================

    function textOf(element) {
        return element?.textContent?.trim() ?? "";
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function nextFrame() {
        return new Promise(resolve => requestAnimationFrame(() => resolve()));
    }

    function isValidChatId(value) {
        return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
    }

    function getRelativeDate(value) {
        if (!value) return "";

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";

        const diff = Math.max(0, Date.now() - date.getTime());
        const minute = 60 * 1000;
        const hour = minute * 60;
        const day = hour * 24;

        if (diff < minute) return "방금 전";
        if (diff < hour) return `${Math.floor(diff / minute)}분 전`;
        if (diff < day) return `${Math.floor(diff / hour)}시간 전`;

        const days = Math.floor(diff / day);
        if (days < 7) return `${days}일 전`;

        return new Intl.DateTimeFormat("ko-KR", {
            month: "numeric",
            day: "numeric",
        }).format(date);
    }

    function extractImageUrl(value) {
        if (!value) return null;
        if (typeof value === "string") return value;
        if (typeof value !== "object") return null;

        return (
            value.url ||
            value.src ||
            value.path ||
            value.original ||
            value.originalUrl ||
            value.imageUrl ||
            null
        );
    }

    // =========================================================
    // 인증 / 원본 API 헤더 추적
    //
    // 중요:
    // - access_token 쿠키를 임의로 Bearer 토큰으로 변환하지 않는다.
    // - 크랙 자체 요청이 실제로 사용하는 Authorization / X-* 헤더만
    //   가로채서 그대로 재사용한다.
    // - 별도 헤더가 없는 환경에서는 credentials:"include" 쿠키 인증만 사용한다.
    // =========================================================

    function isCrackApiUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, location.href);
            return url.hostname === "crack-api.wrtn.ai";
        } catch {
            return false;
        }
    }

    function shouldCaptureApiHeader(name) {
        const lower = String(name || "").trim().toLowerCase();

        return (
            lower === "authorization" ||
            lower.startsWith("x-")
        );
    }

    function rememberApiHeader(name, value, rawUrl = "") {
        if (!shouldCaptureApiHeader(name)) {
            return;
        }

        if (rawUrl && !isCrackApiUrl(rawUrl)) {
            return;
        }

        const key = String(name);
        const val = String(value);

        if (!key || !val) {
            return;
        }

        state.capturedApiHeaders.set(key, val);
        state.capturedAuthSeenAt = Date.now();
    }

    function getCombinedRequestHeaders(input, init) {
        const headers = new Headers();

        try {
            if (input instanceof Request) {
                for (const [key, value] of input.headers.entries()) {
                    headers.set(key, value);
                }
            }
        } catch {
            // ignore
        }

        try {
            if (init?.headers) {
                const initHeaders = new Headers(init.headers);

                for (const [key, value] of initHeaders.entries()) {
                    headers.set(key, value);
                }
            }
        } catch {
            // ignore
        }

        return headers;
    }

    function captureApiHeadersFromFetch(input, init) {
        try {
            const rawUrl =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                        ? input.toString()
                        : input?.url || "";

            if (!isCrackApiUrl(rawUrl)) {
                return;
            }

            const headers = getCombinedRequestHeaders(input, init);

            for (const [key, value] of headers.entries()) {
                rememberApiHeader(key, value, rawUrl);
            }
        } catch {
            // ignore
        }
    }

    function makeApiHeaders(original = {}) {
        const headers = new Headers(original);

        for (const [key, value] of state.capturedApiHeaders.entries()) {
            if (!headers.has(key)) {
                headers.set(key, value);
            }
        }

        return headers;
    }

    async function waitForCapturedApiHeaders(timeoutMs = 1200) {
        if (state.capturedApiHeaders.size > 0) {
            return true;
        }

        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            await sleep(50);

            if (state.capturedApiHeaders.size > 0) {
                return true;
            }
        }

        return false;
    }

    function makeXhrLikeResponse(xhr) {
        let responseText = "";

        try {
            if (
                xhr.responseType === "" ||
                xhr.responseType === "text"
            ) {
                responseText = xhr.responseText || "";
            } else if (
                xhr.responseType === "json"
            ) {
                responseText = JSON.stringify(
                    xhr.response ?? null
                );
            } else if (
                typeof xhr.response === "string"
            ) {
                responseText = xhr.response;
            }
        } catch {
            responseText = "";
        }

        return {
            ok:
                xhr.status >= 200 &&
                xhr.status < 300,

            status:
                xhr.status,

            statusText:
                xhr.statusText || "",

            url:
                xhr.responseURL || "",

            async text() {
                return responseText;
            },

            async json() {
                if (!responseText) {
                    return null;
                }

                return JSON.parse(
                    responseText
                );
            },
        };
    }

    async function apiFetch(url, options = {}) {
        /*
         * 크랙 자체 characterChat 계열 요청이 XHR 기반이므로,
         * 우리 요청도 XHR로 보내 인증/credentials 동작을 최대한 동일하게 맞춘다.
         *
         * internalApiXhrs에 넣은 요청은 세션 목록 응답 필터 대상에서 제외한다.
         * 휴지통 진입 시 전체 세션을 원본 그대로 읽어야 하기 때문이다.
         */
        await waitForCapturedApiHeaders();

        return new Promise(
            (resolve, reject) => {
                const xhr =
                    new XMLHttpRequest();

                internalApiXhrs.add(xhr);

                const method =
                    String(
                        options.method ||
                        "GET"
                    ).toUpperCase();

                xhr.open(
                    method,
                    url,
                    true
                );

                xhr.withCredentials =
                    true;

                const headers =
                    makeApiHeaders(
                        options.headers
                    );

                for (
                    const [key, value]
                    of headers.entries()
                ) {
                    try {
                        xhr.setRequestHeader(
                            key,
                            value
                        );
                    } catch (error) {
                        console.warn(
                            "[Crack Trash] API 헤더 설정 실패",
                            key,
                            error
                        );
                    }
                }

                xhr.onload =
                    () => {
                        resolve(
                            makeXhrLikeResponse(
                                xhr
                            )
                        );
                    };

                xhr.onerror =
                    () => {
                        reject(
                            new TypeError(
                                "Network request failed"
                            )
                        );
                    };

                xhr.onabort =
                    () => {
                        reject(
                            new DOMException(
                                "Request aborted",
                                "AbortError"
                            )
                        );
                    };

                try {
                    xhr.send(
                        options.body ?? null
                    );
                } catch (error) {
                    reject(error);
                }
            }
        );
    }

    // ---------------------------------------------------------
    // XHR 헤더 추적 + 세션 목록 응답 필터 준비
    // ---------------------------------------------------------

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        xhrRequestMeta.set(this, {
            method:
                String(
                    method ||
                    "GET"
                ).toUpperCase(),

            url:
                String(
                    url ||
                    ""
                ),
        });

        return upstreamXhrOpen.call(
            this,
            method,
            url,
            ...rest
        );
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        try {
            const meta =
                xhrRequestMeta.get(
                    this
                );

            if (
                !internalApiXhrs.has(
                    this
                ) &&
                meta?.url &&
                isCrackApiUrl(
                    meta.url
                )
            ) {
                rememberApiHeader(
                    name,
                    value,
                    meta.url
                );
            }
        } catch {
            // ignore
        }

        return upstreamXhrSetRequestHeader.call(
            this,
            name,
            value
        );
    };

    // =========================================================
    // LocalStorage
    // =========================================================

    function loadTrashSessions() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];

            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error("[Crack Trash] 휴지통 읽기 실패", error);
            return [];
        }
    }

    function saveTrashSessions(items) {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(items)
        );
    }

    function getTrashIdSet() {
        const ids = new Set(
            loadTrashSessions()
                .map(item => item?.chatId)
                .filter(isValidChatId)
        );

        for (const id of state.permanentlyDeletedIds) {
            if (isValidChatId(id)) {
                ids.add(id);
            }
        }

        return ids;
    }

    // =========================================================
    // 로그
    // =========================================================

    function loadLogs() {
        try {
            const parsed = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function appendLog(log) {
        const logs = loadLogs();

        logs.unshift({
            at: new Date().toISOString(),
            ...log,
        });

        localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, 50)));
    }

    // =========================================================
    // 평소 채팅 목록 필터
    //
    // 핵심:
    // - DOM/Virtualized row를 숨기지 않는다.
    // - 서버가 반환한 data.chats 배열에서 휴지통 chatId만 제거한다.
    // - 따라서 뒤 항목이 자동으로 한 칸씩 앞으로 당겨진다.
    // - nextCursor는 서버 원본 값을 그대로 유지한다.
    // - fetch와 XHR 양쪽 모두 지원한다.
    // =========================================================

    function getRequestUrl(input) {
        if (
            typeof input ===
            "string"
        ) {
            return input;
        }

        if (
            input instanceof URL
        ) {
            return input.toString();
        }

        return input?.url || "";
    }

    function isChatListUrl(rawUrl) {
        try {
            const url =
                new URL(
                    rawUrl,
                    location.href
                );

            return (
                url.hostname ===
                    "crack-api.wrtn.ai" &&
                url.pathname ===
                    "/crack-gen/v3/chats"
            );
        } catch {
            return false;
        }
    }

    function isGetRequest(input, init) {
        const method =
            String(
                init?.method ||
                (
                    input instanceof Request
                        ? input.method
                        : "GET"
                ) ||
                "GET"
            ).toUpperCase();

        return (
            method ===
            "GET"
        );
    }

    function isChatListRequest(input, init) {
        return (
            isGetRequest(
                input,
                init
            ) &&
            isChatListUrl(
                getRequestUrl(
                    input
                )
            )
        );
    }

    function filterVisibleChats(chats) {
        const trashIds =
            getTrashIdSet();

        if (
            trashIds.size ===
            0
        ) {
            return Array.isArray(chats)
                ? [...chats]
                : [];
        }

        return (
            Array.isArray(chats)
                ? chats
                : []
        ).filter(
            chat =>
                !trashIds.has(
                    chat?._id
                )
        );
    }

    function filterChatListPayload(payload) {
        if (
            !payload ||
            typeof payload !==
                "object" ||
            !Array.isArray(
                payload?.data?.chats
            )
        ) {
            return payload;
        }

        const filtered =
            filterVisibleChats(
                payload.data.chats
            );

        if (
            filtered.length ===
            payload.data.chats.length
        ) {
            return payload;
        }

        return {
            ...payload,

            data: {
                ...payload.data,

                /*
                 * 배열 자체를 축소한다.
                 * nextCursor는 원본 값 그대로 둔다.
                 */
                chats:
                    filtered,
            },
        };
    }

    function getResponseMeta(response) {
        const headers =
            new Headers(
                response.headers
            );

        headers.delete(
            "content-length"
        );

        headers.delete(
            "content-encoding"
        );

        if (
            !headers.has(
                "content-type"
            )
        ) {
            headers.set(
                "content-type",
                "application/json"
            );
        }

        return {
            status:
                response.status ||
                200,

            statusText:
                response.statusText ||
                "OK",

            headers,
        };
    }

    function makeFilteredFetchResponse(
        originalResponse,
        payload
    ) {
        const meta =
            getResponseMeta(
                originalResponse
            );

        return new Response(
            JSON.stringify(
                payload
            ),
            {
                status:
                    meta.status,

                statusText:
                    meta.statusText,

                headers:
                    meta.headers,
            }
        );
    }

    async function handleChatListFetch(
        input,
        init
    ) {
        captureApiHeadersFromFetch(
            input,
            init
        );

        const response =
            await upstreamFetch(
                input,
                init
            );

        if (
            !response.ok ||
            getTrashIdSet().size ===
                0
        ) {
            return response;
        }

        try {
            const payload =
                await response
                    .clone()
                    .json();

            const filtered =
                filterChatListPayload(
                    payload
                );

            if (
                filtered ===
                payload
            ) {
                return response;
            }

            return makeFilteredFetchResponse(
                response,
                filtered
            );

        } catch (error) {
            console.warn(
                "[Crack Trash] fetch 세션 목록 필터 실패",
                error
            );

            return response;
        }
    }

    function shouldFilterXhrChatList(xhr) {
        const meta =
            xhrRequestMeta.get(
                xhr
            );

        if (
            !meta ||
            internalApiXhrs.has(
                xhr
            )
        ) {
            return false;
        }

        return (
            meta.method ===
                "GET" &&
            isChatListUrl(
                meta.url
            ) &&
            xhr.readyState ===
                XMLHttpRequest.DONE &&
            xhr.status >=
                200 &&
            xhr.status <
                300
        );
    }

    function getFilteredXhrText(
        xhr,
        rawText
    ) {
        if (
            !shouldFilterXhrChatList(
                xhr
            ) ||
            typeof rawText !==
                "string" ||
            !rawText
        ) {
            return rawText;
        }

        const previous =
            xhrFilterCache.get(
                xhr
            );

        if (
            previous?.rawText ===
            rawText &&
            typeof previous.filteredText ===
                "string"
        ) {
            return previous.filteredText;
        }

        try {
            const payload =
                JSON.parse(
                    rawText
                );

            const filteredPayload =
                filterChatListPayload(
                    payload
                );

            if (
                filteredPayload ===
                payload
            ) {
                xhrFilterCache.set(
                    xhr,
                    {
                        rawText,

                        filteredText:
                            rawText,

                        filteredJson:
                            payload,
                    }
                );

                return rawText;
            }

            const filteredText =
                JSON.stringify(
                    filteredPayload
                );

            xhrFilterCache.set(
                xhr,
                {
                    rawText,

                    filteredText,

                    filteredJson:
                        filteredPayload,
                }
            );

            return filteredText;

        } catch (error) {
            console.warn(
                "[Crack Trash] XHR 세션 목록 JSON 필터 실패",
                error
            );

            return rawText;
        }
    }

    function getFilteredXhrJson(
        xhr,
        rawValue
    ) {
        if (
            !shouldFilterXhrChatList(
                xhr
            ) ||
            !rawValue ||
            typeof rawValue !==
                "object"
        ) {
            return rawValue;
        }

        const previous =
            xhrFilterCache.get(
                xhr
            );

        if (
            previous?.rawJson ===
            rawValue &&
            previous.filteredJson
        ) {
            return previous.filteredJson;
        }

        try {
            const filteredJson =
                filterChatListPayload(
                    rawValue
                );

            xhrFilterCache.set(
                xhr,
                {
                    ...(previous || {}),

                    rawJson:
                        rawValue,

                    filteredJson,
                }
            );

            return filteredJson;

        } catch (error) {
            console.warn(
                "[Crack Trash] XHR JSON 응답 필터 실패",
                error
            );

            return rawValue;
        }
    }

    function installXhrResponseFilter() {
        /*
         * Axios/XHR 기본 adapter는 보통 responseText를 읽은 뒤
         * JSON 변환을 수행한다. responseType="json" 환경까지 대비해
         * response getter도 함께 가로챈다.
         */
        try {
            if (
                xhrResponseTextDescriptor
                    ?.get &&
                xhrResponseTextDescriptor
                    .configurable
            ) {
                Object.defineProperty(
                    XMLHttpRequest.prototype,
                    "responseText",
                    {
                        ...xhrResponseTextDescriptor,

                        get() {
                            const raw =
                                xhrResponseTextDescriptor
                                    .get
                                    .call(this);

                            return getFilteredXhrText(
                                this,
                                raw
                            );
                        },
                    }
                );
            } else {
                console.warn(
                    "[Crack Trash] responseText getter를 패치할 수 없습니다."
                );
            }
        } catch (error) {
            console.warn(
                "[Crack Trash] responseText 필터 설치 실패",
                error
            );
        }

        try {
            if (
                xhrResponseDescriptor
                    ?.get &&
                xhrResponseDescriptor
                    .configurable
            ) {
                Object.defineProperty(
                    XMLHttpRequest.prototype,
                    "response",
                    {
                        ...xhrResponseDescriptor,

                        get() {
                            const raw =
                                xhrResponseDescriptor
                                    .get
                                    .call(this);

                            if (
                                this.responseType ===
                                "json"
                            ) {
                                return getFilteredXhrJson(
                                    this,
                                    raw
                                );
                            }

                            if (
                                this.responseType ===
                                    "" ||
                                this.responseType ===
                                    "text"
                            ) {
                                return getFilteredXhrText(
                                    this,
                                    raw
                                );
                            }

                            return raw;
                        },
                    }
                );
            }
        } catch (error) {
            console.warn(
                "[Crack Trash] response 필터 설치 실패",
                error
            );
        }
    }

    installXhrResponseFilter();

    const wrappedFetch =
        async function(
            input,
            init
        ) {
            if (
                isChatListRequest(
                    input,
                    init
                )
            ) {
                return handleChatListFetch(
                    input,
                    init
                );
            }

            captureApiHeadersFromFetch(
                input,
                init
            );

            return upstreamFetch(
                input,
                init
            );
        };

    wrappedFetch
        .__crackTrashWrapped =
        true;

    window.fetch =
        wrappedFetch;

    // =========================================================
    // 구버전에서 남긴 위험한 숨김 흔적 제거
    // =========================================================

    function cleanupOldVersion() {
        const oldStyleIds = [
            "crack-trash-hide-rules",
            "crack-trash-hide-style",
            "crack-trash-loaded-mask-v160",
            "crack-trash-style-v160",
            "crack-trash-style-v200",
            "crack-trash-style-v170",
            "crack-trash-style-v180",
            "crack-trash-style-v190",
        ];

        for (const id of oldStyleIds) {
            document.getElementById(id)?.remove();
        }

        for (
            const row
            of document.querySelectorAll('[data-crack-trash-hidden]')
        ) {
            row.style.removeProperty("display");
            row.style.removeProperty("height");
            row.style.removeProperty("min-height");
            row.style.removeProperty("max-height");
            row.style.removeProperty("visibility");
            row.style.removeProperty("opacity");
            row.style.removeProperty("pointer-events");

            row.removeAttribute("data-crack-trash-hidden");
            row.removeAttribute("data-crack-trash-old-display");
            row.removeAttribute("data-crack-trash-old-priority");
        }
    }

    // =========================================================
    // CSS
    // =========================================================

    function injectStyle() {
        if (document.getElementById(ID.STYLE)) {
            return;
        }

        const style = document.createElement("style");
        style.id = ID.STYLE;

        style.textContent = `
            #${ID.OVERLAY} {
                position: absolute;
                inset: 0;
                z-index: 999;

                display: flex;
                flex-direction: column;

                width: 100%;
                height: 100%;
                min-height: 0;

                background: var(--background);
                background-color: var(--background);
                color: inherit;

                overflow: hidden;
                isolation: isolate;
                box-sizing: border-box;
                pointer-events: auto;
            }

            #${ID.OVERLAY}[data-layout="mobile-fixed"] {
                position: fixed !important;
                inset: 0 !important;
                z-index: 2147483000 !important;

                width: 100vw !important;
                height: 100vh !important;
                height: 100dvh !important;
                max-width: none !important;
                max-height: none !important;

                margin: 0 !important;
                transform: none !important;

                overflow: hidden !important;
                overscroll-behavior: contain;
                touch-action: manipulation;
                pointer-events: auto !important;
            }

            #${ID.HEADER} {
                position: relative;

                display: flex;
                align-items: center;
                justify-content: center;

                width: 100%;
                height: 48px;
                min-height: 48px;

                flex: 0 0 48px;

                box-sizing: border-box;

                border-bottom: 1px solid var(--border);
                background: inherit;
                pointer-events: auto;
                z-index: 2;
            }

            .crack-trash-header-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;

                gap: 3px;
                height: 30px;
                padding: 0 6px;

                border: 0;
                border-radius: 6px;

                background: transparent;
                color: inherit;

                font-family: inherit;
                font-size: 11px;
                font-weight: 500;

                cursor: pointer;
                pointer-events: auto;
                touch-action: manipulation;
                -webkit-tap-highlight-color: transparent;
                position: relative;
                z-index: 3;
            }

            .crack-trash-header-button:hover {
                background: var(--hover);
            }

            .crack-trash-header-button:disabled {
                opacity: .4;
                cursor: default;
            }

            .crack-trash-header-back {
                position: absolute;
                left: 6px;
                top: 50%;
                transform: translateY(-50%);
            }

            .crack-trash-title {
                max-width: 125px;

                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;

                font-size: 13px;
                font-weight: 600;
            }

            .crack-trash-header-right {
                position: absolute;
                right: 6px;
                top: 50%;
                transform: translateY(-50%);

                display: flex;
                align-items: center;
                gap: 3px;
            }

            #${ID.COUNT} {
                font-size: 10px;
                color: var(--muted-foreground);
                white-space: nowrap;
            }

            #${ID.CONTENT} {
                display: flex;
                pointer-events: auto;
                flex-direction: column;

                flex: 1 1 auto;

                width: 100%;
                min-height: 0;

                overflow: hidden;
                background: inherit;
            }

            #${ID.SCROLL} {
                flex: 1 1 auto;
                pointer-events: auto;
                touch-action: pan-y;

                width: 100%;
                min-height: 0;

                overflow-x: hidden;
                overflow-y: auto;

                padding: 8px 0;
                box-sizing: border-box;
            }

            .crack-trash-select-box {
                display: flex;
                align-items: center;
                justify-content: center;

                flex: 0 0 18px;
                width: 18px;
                height: 18px;

                padding: 0;

                border: 1px solid var(--border);
                border-radius: 4px;

                background: transparent;
                color: var(--foreground);

                font-size: 12px;
                cursor: pointer;
            }

            .crack-trash-select-box[data-selected="true"] {
                background: var(--foreground);
                color: var(--background);
            }

            .crack-trash-empty,
            .crack-trash-loading {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;

                width: 100%;
                height: 100%;

                padding: 20px;
                box-sizing: border-box;

                gap: 7px;
                text-align: center;
            }

            .crack-trash-empty-icon {
                font-size: 34px;
                opacity: .7;
            }

            .crack-trash-empty-title,
            .crack-trash-loading-title {
                font-size: 14px;
                font-weight: 600;
            }

            .crack-trash-empty-description,
            .crack-trash-loading-description {
                max-width: 215px;
                color: var(--muted-foreground);
                font-size: 11px;
                line-height: 1.5;
            }

            #${ID.TOAST} {
                position: fixed;
                left: 50%;
                bottom: 28px;
                transform: translateX(-50%);

                z-index: 2147483647;

                max-width: 440px;
                padding: 10px 14px;

                border: 1px solid var(--border);
                border-radius: 8px;

                background: var(--popover);
                color: var(--popover-foreground);

                font-size: 13px;

                box-shadow: 0 6px 24px rgba(0,0,0,.2);

                pointer-events: none;
                opacity: 0;
                transition: opacity .15s ease;
            }

            #${ID.TOAST}.show {
                opacity: 1;
            }
        `;

        document.head.appendChild(style);
    }

    // =========================================================
    // Toast
    // =========================================================

    let toastTimer = null;

    function showToast(message) {
        let toast = document.getElementById(ID.TOAST);

        if (!toast) {
            toast = document.createElement("div");
            toast.id = ID.TOAST;
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add("show");

        clearTimeout(toastTimer);

        toastTimer = setTimeout(() => {
            toast.classList.remove("show");
        }, 2200);
    }

    // =========================================================
    // 전체 서버 채팅 목록 로드
    //
    // 휴지통 진입 또는 JSON 불러오기에서만 실행.
    // 40개씩 nextCursor 끝까지 읽는다.
    // =========================================================

    async function loadAllServerChats({ showProgress = true } = {}) {
        const chats = [];
        const seenChatIds = new Set();
        const seenCursors = new Set();

        let cursor = null;
        let page = 0;

        while (true) {
            page += 1;

            if (page > 5000) {
                throw new Error("채팅 목록 페이지 수가 비정상적으로 많습니다.");
            }

            const url = new URL(`${API_BASE}/chats`);
            url.searchParams.set("folderId", "null");
            url.searchParams.set("limit", "40");

            if (cursor) {
                url.searchParams.set("cursor", cursor);
            }

            if (showProgress && state.trashView) {
                state.loadingText = `${chats.length}개 확인 중...`;
                renderTrashList();
            }

            const response = await apiFetch(url.toString(), {
                method: "GET",
                cache: "no-store",
                headers: {
                    Accept: "application/json",
                },
            });

            if (!response.ok) {
                const text = await response.text().catch(() => "");

                console.error(
                    "[Crack Trash] 전체 채팅 목록 조회 실패",
                    response.status,
                    text
                );

                if (response.status === 401) {
                    throw new Error("인증에 실패했습니다. 원본 크랙 요청의 인증 헤더 또는 로그인 쿠키를 확인해 주세요.");
                }

                throw new Error(`채팅 목록 조회 실패 (${response.status})`);
            }

            const body = await response.json();

            if (!Array.isArray(body?.data?.chats)) {
                throw new Error("채팅 목록 응답 형식이 예상과 다릅니다.");
            }

            for (const chat of body.data.chats) {
                if (!chat?._id || seenChatIds.has(chat._id)) {
                    continue;
                }

                seenChatIds.add(chat._id);
                chats.push(chat);
            }

            const nextCursor = body?.data?.nextCursor || null;

            if (!nextCursor) {
                break;
            }

            if (seenCursors.has(nextCursor)) {
                throw new Error("채팅 목록의 nextCursor가 반복되어 전체 조회를 중단했습니다.");
            }

            seenCursors.add(nextCursor);
            cursor = nextCursor;

            await sleep(20);
        }

        return chats;
    }

    function mergeServerChatInfo(localItem, serverChat) {
        const story = serverChat?.story || null;

        const storyId =
            story?._id ||
            localItem.storyId ||
            "";

        const chatId = serverChat?._id || localItem.chatId;

        const image =
            extractImageUrl(story?.portraitImage) ||
            extractImageUrl(story?.profileImage) ||
            localItem.image ||
            null;

        const href =
            storyId && chatId
                ? `/stories/${storyId}/episodes/${chatId}`
                : localItem.href || "";

        return {
            ...localItem,
            storyId,
            chatId,
            href,
            title:
                serverChat?.title ||
                story?.name ||
                localItem.title ||
                "제목 없음",
            image,
            lastMessage:
                typeof serverChat?.lastMessage === "string"
                    ? serverChat.lastMessage
                    : localItem.lastMessage || "",
        };
    }

    async function refreshTrashFromServer() {
        if (state.loadingTrash) {
            return;
        }

        const localTrash = loadTrashSessions();

        if (localTrash.length === 0) {
            state.serverChats.clear();
            state.serverChatsLoaded = true;
            renderTrashList();
            updateTrashHeader();
            return;
        }

        state.loadingTrash = true;
        state.loadingText = "전체 채팅 목록 불러오는 중...";

        renderTrashList();
        updateTrashHeader();

        try {
            const allChats = await loadAllServerChats({ showProgress: true });
            const byId = new Map();

            for (const chat of allChats) {
                if (chat?._id) {
                    byId.set(chat._id, chat);
                }
            }

            const valid = [];
            const missing = [];

            for (const item of localTrash) {
                const serverChat = byId.get(item.chatId);

                if (!serverChat) {
                    missing.push({
                        chatId: item.chatId,
                        title: item.title || "",
                        reason: "not_in_server_chat_list",
                    });
                    continue;
                }

                valid.push(mergeServerChatInfo(item, serverChat));
            }

            state.serverChats = byId;
            state.serverChatsLoaded = true;

            saveTrashSessions(valid);

            if (missing.length) {
                appendLog({
                    type: "trash_refresh_cleanup",
                    checkedCount: localTrash.length,
                    serverChatCount: allChats.length,
                    removedCount: missing.length,
                    missing,
                });

                console.group(
                    `[Crack Trash] 서버에 없어 휴지통 기록에서 제거 ${missing.length}개`
                );
                console.table(missing);
                console.groupEnd();

                showToast(`${missing.length}개의 존재하지 않는 기록을 정리했습니다.`);
            }
        } catch (error) {
            console.error("[Crack Trash] 휴지통 전체 조회 실패", error);

            // 전체 조회 실패 시 기존 localStorage는 건드리지 않음.
            showToast(error.message || "휴지통 확인 중 오류가 발생했습니다.");
        } finally {
            state.loadingTrash = false;
            state.loadingText = "";

            renderTrashList();
            updateTrashHeader();
        }
    }

    // =========================================================
    // href / 원본 채팅 카드 컨텍스트
    // =========================================================

    function parseChatHref(href) {
        if (!href) return null;

        try {
            const url = new URL(href, location.origin);
            const match = url.pathname.match(
                /^\/stories\/([^/]+)\/episodes\/([^/]+)/
            );

            if (!match) return null;

            return {
                storyId: match[1],
                chatId: match[2],
                href: url.pathname + url.search,
            };
        } catch {
            return null;
        }
    }

    function extractChatContextFromTrigger(trigger) {
        if (!(trigger instanceof Element)) {
            return null;
        }

        const button = trigger.closest(
            'button[aria-label="채팅방 메뉴"]'
        );

        if (!button) return null;

        const anchor = button.closest('a[href*="/stories/"][href*="/episodes/"]');
        if (!anchor) return null;

        const parsed = parseChatHref(anchor.getAttribute("href"));
        if (!parsed) return null;

        const titleElement = anchor.querySelector(
            ".typo-text-sm_leading-none_medium"
        );

        const imageElement = anchor.querySelector("img");

        const smallTexts = [
            ...anchor.querySelectorAll(
                ".typo-text-xs_leading-none_regular"
            ),
        ];

        const lastMessageElement = smallTexts.find(
            element =>
                !element.classList.contains("chat-update-date-label")
        );

        const dateElement = anchor.querySelector(
            ".chat-update-date-label"
        );

        return {
            ...parsed,
            title: textOf(titleElement) || "제목 없음",
            image: imageElement?.src || null,
            lastMessage: textOf(lastMessageElement),
            originalDateLabel: textOf(dateElement),
            movedAt: null,
        };
    }

    // =========================================================
    // PC / 모바일 실제 채팅목록 DOM 바인딩
    //
    // 모바일 DOM도 개별 세션은
    // a[href="/stories/.../episodes/..."] 내부에
    // button[aria-label="채팅방 메뉴"][aria-haspopup="menu"]가 존재한다.
    // 이 버튼을 직접 바인딩해 portal 메뉴가 뜨기 전에 chatId를 고정한다.
    // =========================================================

    function rememberChatContextFromButton(button) {
        if (!(button instanceof Element)) {
            return null;
        }

        const context = extractChatContextFromTrigger(button);
        if (!context) {
            return null;
        }

        state.currentChatContext = context;

        if (button.id) {
            state.chatContextByTriggerId.set(button.id, context);
        }

        return context;
    }

    function scheduleMenuRescan() {
        /*
         * 모바일 WebView/Radix portal은 메뉴 노드 생성 시점이
         * touch/click보다 한두 프레임 늦을 수 있다.
         */
        for (const delay of [0, 24, 60, 120, 220]) {
            setTimeout(() => {
                scanMenus(document);
            }, delay);
        }
    }

    function bindChatMenuButton(button) {
        if (!(button instanceof HTMLElement)) {
            return;
        }

        if (button.dataset.crackTrashBoundChatMenu === "true") {
            return;
        }

        const anchor = button.closest(
            'a[href*="/stories/"][href*="/episodes/"]'
        );

        if (!anchor) {
            return;
        }

        button.dataset.crackTrashBoundChatMenu = "true";

        const capture = () => {
            rememberChatContextFromButton(button);
            scheduleMenuRescan();
        };

        button.addEventListener("pointerdown", capture, true);
        button.addEventListener("touchstart", capture, {
            capture: true,
            passive: true,
        });
        button.addEventListener("click", capture, true);
        button.addEventListener("focusin", capture, true);
    }

    function findChatListMenuTrigger(root = document) {
        const buttons = [];

        if (
            root instanceof Element &&
            root.matches('button[aria-haspopup="menu"]')
        ) {
            buttons.push(root);
        }

        if (root?.querySelectorAll) {
            buttons.push(
                ...root.querySelectorAll('button[aria-haspopup="menu"]')
            );
        }

        for (const button of buttons) {
            if (button.getAttribute("aria-label") === "채팅방 메뉴") {
                continue;
            }

            const row = button.parentElement;
            if (!row) {
                continue;
            }

            const hasChatListLabel = [...row.querySelectorAll("span")]
                .some(span => textOf(span) === "채팅 목록");

            if (hasChatListLabel) {
                return button;
            }
        }

        return null;
    }

    function bindChatListMenuTrigger(button) {
        if (!(button instanceof HTMLElement)) {
            return;
        }

        if (button.dataset.crackTrashBoundListMenu === "true") {
            return;
        }

        button.dataset.crackTrashBoundListMenu = "true";

        const rescan = () => {
            scheduleMenuRescan();
        };

        button.addEventListener("pointerdown", rescan, true);
        button.addEventListener("touchstart", rescan, {
            capture: true,
            passive: true,
        });
        button.addEventListener("click", rescan, true);
    }

    function scanSidebarStructure(root = document) {
        const buttons = [];

        if (
            root instanceof Element &&
            root.matches('button[aria-label="채팅방 메뉴"][aria-haspopup="menu"]')
        ) {
            buttons.push(root);
        }

        if (root?.querySelectorAll) {
            buttons.push(
                ...root.querySelectorAll(
                    'a[href*="/stories/"][href*="/episodes/"] ' +
                    'button[aria-label="채팅방 메뉴"][aria-haspopup="menu"]'
                )
            );
        }

        for (const button of new Set(buttons)) {
            bindChatMenuButton(button);
        }

        const listTrigger = findChatListMenuTrigger(root);
        if (listTrigger) {
            bindChatListMenuTrigger(listTrigger);
        }
    }

    function rememberChatMenuContext(event) {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest(
            'button[aria-label="채팅방 메뉴"][aria-haspopup="menu"]'
        );

        if (!button) {
            return;
        }

        rememberChatContextFromButton(button);
        scheduleMenuRescan();
    }

    document.addEventListener(
        "pointerdown",
        rememberChatMenuContext,
        true
    );

    document.addEventListener(
        "touchstart",
        rememberChatMenuContext,
        {
            capture: true,
            passive: true,
        }
    );

    document.addEventListener(
        "click",
        rememberChatMenuContext,
        true
    );

    document.addEventListener(
        "focusin",
        rememberChatMenuContext,
        true
    );

    function getLabelledByIds(element) {
        const ids = new Set();

        let node = element;
        let depth = 0;

        while (
            node instanceof Element &&
            node !== document.body &&
            depth < 6
        ) {
            const labelledBy = node.getAttribute(
                "aria-labelledby"
            );

            if (labelledBy) {
                for (
                    const id
                    of labelledBy
                        .split(/\s+/)
                        .filter(Boolean)
                ) {
                    ids.add(id);
                }
            }

            node = node.parentElement;
            depth += 1;
        }

        return [...ids];
    }

    function resolveChatContextFromMenu(menu) {
        for (const id of getLabelledByIds(menu)) {
            const cached =
                state.chatContextByTriggerId.get(id);

            if (cached) {
                state.currentChatContext = cached;
                return cached;
            }

            const trigger = document.getElementById(id);
            if (!trigger) continue;

            const context =
                extractChatContextFromTrigger(trigger);

            if (context) {
                state.currentChatContext = context;
                state.chatContextByTriggerId.set(
                    id,
                    context
                );
                return context;
            }
        }

        /*
         * 모바일 액션시트는 aria-labelledby가 없는 경우가 있어
         * 메뉴를 연 직전 touchstart/pointerdown에서 저장한 컨텍스트를 사용.
         */
        return state.currentChatContext;
    }

    // =========================================================
    // 에피소드 목록 재마운트
    // =========================================================

    function findEpisodeTabList() {
        for (const list of document.querySelectorAll('[role="tablist"]')) {
            const texts = [
                ...list.querySelectorAll('[role="tab"]'),
            ].map(textOf);

            if (
                texts.includes("에피소드") &&
                texts.includes("파티챗")
            ) {
                return list;
            }
        }

        return null;
    }

    function isTabActive(tab) {
        return (
            tab?.getAttribute("aria-selected") === "true" ||
            tab?.getAttribute("data-state") === "active"
        );
    }

    async function refreshEpisodeList() {
        const tabList = findEpisodeTabList();
        if (!tabList) return;

        const tabs = [...tabList.querySelectorAll('[role="tab"]')];

        const episodeTab = tabs.find(tab => textOf(tab) === "에피소드");
        const partyTab = tabs.find(tab => textOf(tab) === "파티챗");

        if (!episodeTab || !isTabActive(episodeTab)) {
            return;
        }

        if (partyTab) {
            partyTab.click();

            await nextFrame();
            await nextFrame();

            episodeTab.click();
            return;
        }

        episodeTab.click();
    }

    // =========================================================
    // 휴지통 이동 / 복구
    // =========================================================

    async function moveChatToTrash(context) {
        if (!context?.chatId || !isValidChatId(context.chatId)) {
            showToast("채팅 정보를 찾지 못했습니다.");
            return;
        }

        let items = loadTrashSessions();

        items = items.filter(item => item.chatId !== context.chatId);

        items.unshift({
            storyId: context.storyId,
            chatId: context.chatId,
            href: context.href,
            title: context.title,
            image: context.image,
            lastMessage: context.lastMessage,
            originalDateLabel: context.originalDateLabel,
            movedAt: new Date().toISOString(),
        });

        saveTrashSessions(items);

        renderTrashList();
        updateTrashHeader();

        showToast(`"${context.title}"을 휴지통으로 이동했습니다.`);

        await refreshEpisodeList();
    }

    function restoreChat(chatId) {
        const items = loadTrashSessions();
        const target = items.find(item => item.chatId === chatId);

        saveTrashSessions(
            items.filter(item => item.chatId !== chatId)
        );

        state.selectedIds.delete(chatId);

        renderTrashList();
        updateTrashHeader();

        showToast(
            target
                ? `"${target.title}"을 복원했습니다.`
                : "채팅을 복원했습니다."
        );
    }

    // =========================================================
    // 실제 서버 삭제
    // =========================================================

    async function deleteChatsFromServer(ids) {
        const chatIds = [
            ...new Set(ids.filter(isValidChatId)),
        ];

        if (!chatIds.length) {
            throw new Error("삭제할 채팅이 없습니다.");
        }

        const response = await apiFetch(`${API_BASE}/chats/delete`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                chatIds,
            }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");

            console.error(
                "[Crack Trash] 삭제 API 실패",
                response.status,
                text
            );

            if (response.status === 401) {
                throw new Error(
                    "인증에 실패했습니다. 원본 크랙 요청의 인증 헤더 또는 로그인 쿠키를 확인해 주세요."
                );
            }

            throw new Error(`삭제 실패 (${response.status})`);
        }

        return true;
    }

    async function permanentlyDeleteChat(item) {
        if (!item?.chatId || !isValidChatId(item.chatId)) {
            showToast("삭제할 채팅 정보를 찾지 못했습니다.");
            return;
        }

        const confirmed = window.confirm(
            `"${item.title || "이 채팅"}"을 완전히 삭제할까요?\n\n` +
            "서버에서도 삭제되며 되돌릴 수 없습니다."
        );

        if (!confirmed) return;

        try {
            await deleteChatsFromServer([item.chatId]);

            state.permanentlyDeletedIds.add(item.chatId);
            state.serverChats.delete(item.chatId);

            saveTrashSessions(
                loadTrashSessions().filter(
                    trash => trash.chatId !== item.chatId
                )
            );

            state.selectedIds.delete(item.chatId);

            renderTrashList();
            updateTrashHeader();

            showToast(`"${item.title}"을 완전히 삭제했습니다.`);
        } catch (error) {
            console.error("[Crack Trash] 완전 삭제 실패", error);
            showToast(error.message || "삭제 중 오류가 발생했습니다.");
        }
    }

    // =========================================================
    // 선택 일괄 처리
    // =========================================================

    function enterSelectionMode(mode) {
        closeCustomMenu();

        state.selectionMode = mode;
        state.selectedIds.clear();

        renderTrashList();
        updateTrashHeader();
    }

    function exitSelectionMode() {
        state.selectionMode = null;
        state.selectedIds.clear();

        renderTrashList();
        updateTrashHeader();
    }

    function toggleSelected(chatId) {
        if (state.selectedIds.has(chatId)) {
            state.selectedIds.delete(chatId);
        } else {
            state.selectedIds.add(chatId);
        }

        renderTrashList();
        updateTrashHeader();
    }

    function restoreSelected() {
        const ids = new Set(state.selectedIds);

        if (!ids.size) {
            showToast("복구할 채팅을 선택해주세요.");
            return;
        }

        saveTrashSessions(
            loadTrashSessions().filter(
                item => !ids.has(item.chatId)
            )
        );

        const count = ids.size;

        exitSelectionMode();
        showToast(`${count}개의 채팅을 복구했습니다.`);
    }

    async function deleteSelected() {
        const ids = [...state.selectedIds].filter(isValidChatId);

        if (!ids.length) {
            showToast("삭제할 채팅을 선택해주세요.");
            return;
        }

        const confirmed = window.confirm(
            `선택한 ${ids.length}개의 채팅을 완전히 삭제할까요?\n\n` +
            "서버에서도 삭제되며 되돌릴 수 없습니다."
        );

        if (!confirmed) return;

        try {
            await deleteChatsFromServer(ids);

            const idSet = new Set(ids);

            for (const id of ids) {
                state.permanentlyDeletedIds.add(id);
                state.serverChats.delete(id);
            }

            saveTrashSessions(
                loadTrashSessions().filter(
                    item => !idSet.has(item.chatId)
                )
            );

            const count = ids.length;

            exitSelectionMode();
            showToast(`${count}개의 채팅을 완전히 삭제했습니다.`);
        } catch (error) {
            console.error("[Crack Trash] 일괄 삭제 실패", error);
            showToast(error.message || "일괄 삭제 중 오류가 발생했습니다.");
        }
    }

    // =========================================================
    // Sidebar / 휴지통 Overlay
    //
    // 원본 Virtuoso를 display:none 하지 않는다.
    // 위에 overlay를 덮어서 Zero-sized element를 피한다.
    // =========================================================

    function findSidebarOverlayRoot(tabList) {
        if (!(tabList instanceof HTMLElement)) {
            return null;
        }

        const scrollerSelector =
            '[data-testid="virtuoso-scroller"][data-virtuoso-scroller="true"], ' +
            '[data-testid="virtuoso-scroller"]';

        const candidates = [];
        let node = tabList;

        while (node && node !== document.body) {
            if (node instanceof HTMLElement) {
                const hasScroller = !!node.querySelector(scrollerSelector);

                if (hasScroller) {
                    const rect = node.getBoundingClientRect();
                    const classList = node.classList;

                    /*
                     * PC: 기존 bg-sidebar 패널.
                     */
                    const desktopExact =
                        classList.contains("bg-sidebar");

                    /*
                     * 모바일: 사용자가 제공한 실제 DOM의 최상위 패널
                     * flex flex-col w-full h-full min-h-full overflow-hidden sticky top-0
                     */
                    const mobileExact =
                        classList.contains("flex") &&
                        classList.contains("flex-col") &&
                        classList.contains("w-full") &&
                        (
                            classList.contains("h-full") ||
                            classList.contains("min-h-full")
                        ) &&
                        classList.contains("overflow-hidden") &&
                        classList.contains("sticky") &&
                        classList.contains("top-0");

                    if (desktopExact) {
                        return node;
                    }

                    if (mobileExact) {
                        return node;
                    }

                    const viewportWidth = Math.max(
                        document.documentElement.clientWidth || 0,
                        window.innerWidth || 0
                    );

                    const maxSidebarWidth = Math.max(
                        340,
                        Math.min(520, viewportWidth + 8)
                    );

                    const sidebarSized =
                        rect.width >= 220 &&
                        rect.width <= maxSidebarWidth &&
                        rect.height >= Math.max(320, window.innerHeight * 0.55);

                    if (sidebarSized) {
                        candidates.push({
                            node,
                            area: rect.width * rect.height,
                        });
                    }
                }
            }

            node = node.parentElement;
        }

        /*
         * exact class를 찾지 못한 경우 가장 넓은 후보를 사용.
         * 모바일 전체폭(예: 390px)도 허용한다.
         */
        candidates.sort((a, b) => b.area - a.area);

        return candidates[0]?.node || null;
    }

    function getOpaqueBackgroundColor(element) {
        let node = element;

        while (node && node !== document.documentElement) {
            if (node instanceof HTMLElement) {
                const color = getComputedStyle(node).backgroundColor;

                if (
                    color &&
                    color !== "transparent" &&
                    !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(color)
                ) {
                    return color;
                }
            }

            node = node.parentElement;
        }

        return getComputedStyle(document.body).backgroundColor || "rgb(255, 255, 255)";
    }

    function createHeaderButton(label, action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "crack-trash-header-button";
        button.textContent = label;

        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            action?.();
        });

        return button;
    }

    function createTrashHeader() {
        const header = document.createElement("div");
        header.id = ID.HEADER;
        updateTrashHeaderElement(header);
        return header;
    }

    function updateTrashHeader() {
        const header = document.getElementById(ID.HEADER);
        if (header) {
            updateTrashHeaderElement(header);
        }
    }

    function updateTrashHeaderElement(header) {
        header.replaceChildren();

        if (state.selectionMode) {
            const cancel = createHeaderButton("취소", exitSelectionMode);
            cancel.classList.add("crack-trash-header-back");

            const title = document.createElement("div");
            title.className = "crack-trash-title";
            title.textContent = `${state.selectedIds.size}개 선택`;

            const right = document.createElement("div");
            right.className = "crack-trash-header-right";

            const action = createHeaderButton(
                state.selectionMode === "restore" ? "복구" : "삭제",
                state.selectionMode === "restore"
                    ? restoreSelected
                    : deleteSelected
            );

            action.disabled = state.selectedIds.size === 0;

            right.appendChild(action);
            header.append(cancel, title, right);
            return;
        }

        const back = createHeaderButton("← 이전", exitTrashMode);
        back.classList.add("crack-trash-header-back");

        const title = document.createElement("div");
        title.className = "crack-trash-title";
        title.textContent = "🗑️ 휴지통 🗑️";

        const right = document.createElement("div");
        right.className = "crack-trash-header-right";

        const count = document.createElement("span");
        count.id = ID.COUNT;
        count.textContent = state.loadingTrash
            ? "확인 중"
            : `${loadTrashSessions().length}개`;

        const file = createHeaderButton("파일 ▼", () => {
            openFileMenu(file);
        });

        file.disabled = state.loadingTrash;

        right.append(count, file);
        header.append(back, title, right);
    }

    function createTrashContent() {
        const content = document.createElement("div");
        content.id = ID.CONTENT;

        const scroll = document.createElement("div");
        scroll.id = ID.SCROLL;

        content.appendChild(scroll);
        return content;
    }

    function isMobileTrashLayout() {
        const viewportWidth = Math.max(
            0,
            document.documentElement?.clientWidth || 0,
            window.innerWidth || 0
        );

        return (
            viewportWidth <= 768 ||
            window.matchMedia?.("(max-width: 768px)")?.matches === true
        );
    }

    function createTrashOverlay(backgroundSource, layoutMode) {
        const overlay = document.createElement("div");
        overlay.id = ID.OVERLAY;
        overlay.dataset.crackTrashOwned = "true";
        overlay.dataset.layout = layoutMode;

        const backgroundElement =
            backgroundSource instanceof HTMLElement
                ? backgroundSource
                : document.body;

        overlay.style.backgroundColor =
            getOpaqueBackgroundColor(backgroundElement);

        overlay.append(
            createTrashHeader(),
            createTrashContent()
        );

        return overlay;
    }

    function mountTrashOverlay(tabList) {
        const mobile = isMobileTrashLayout();

        /*
         * 모바일: 부모 sticky/overflow/transform/드로어 stacking context의
         * 영향을 받지 않도록 body 바로 아래 fixed 전체화면으로 띄운다.
         * 사이드바 루트 탐색에 실패해도 모바일 휴지통은 열 수 있다.
         */
        if (mobile) {
            const backgroundSource =
                findSidebarOverlayRoot(tabList) ||
                tabList.closest(
                    ".flex.flex-col.w-full.h-full, " +
                    ".flex.flex-col.w-full.min-h-full"
                ) ||
                tabList.parentElement ||
                document.body;

            const overlay = createTrashOverlay(
                backgroundSource,
                "mobile-fixed"
            );

            const body = document.body;
            const oldBodyOverflow =
                body.style.getPropertyValue("overflow");
            const oldBodyOverflowPriority =
                body.style.getPropertyPriority("overflow");

            body.style.setProperty("overflow", "hidden", "important");
            body.appendChild(overlay);

            return {
                mode: "mobile-fixed",
                root: body,
                overlay,
                oldBodyOverflow,
                oldBodyOverflowPriority,
            };
        }

        /*
         * PC: 기존처럼 왼쪽 사이드바 내부를 absolute overlay로 덮는다.
         * Virtuoso 자체는 display:none/height:0으로 만들지 않는다.
         */
        const sidebarRoot = findSidebarOverlayRoot(tabList);

        if (!sidebarRoot) {
            return null;
        }

        const oldPosition =
            sidebarRoot.style.getPropertyValue("position");
        const oldPositionPriority =
            sidebarRoot.style.getPropertyPriority("position");
        const oldOverflow =
            sidebarRoot.style.getPropertyValue("overflow");
        const oldOverflowPriority =
            sidebarRoot.style.getPropertyPriority("overflow");

        if (getComputedStyle(sidebarRoot).position === "static") {
            sidebarRoot.style.setProperty("position", "relative");
        }

        sidebarRoot.style.setProperty("overflow", "hidden");

        const overlay = createTrashOverlay(
            sidebarRoot,
            "desktop-absolute"
        );

        sidebarRoot.appendChild(overlay);

        return {
            mode: "desktop-absolute",
            root: sidebarRoot,
            overlay,
            oldPosition,
            oldPositionPriority,
            oldOverflow,
            oldOverflowPriority,
        };
    }

    function unmountTrashOverlay(view) {
        view?.overlay?.remove();

        if (!view) {
            return;
        }

        if (view.mode === "mobile-fixed") {
            const body = document.body;

            if (body) {
                body.style.removeProperty("overflow");

                if (view.oldBodyOverflow) {
                    body.style.setProperty(
                        "overflow",
                        view.oldBodyOverflow,
                        view.oldBodyOverflowPriority
                    );
                }
            }

            return;
        }

        if (view.mode === "desktop-absolute" && view.root?.isConnected) {
            view.root.style.removeProperty("position");
            view.root.style.removeProperty("overflow");

            if (view.oldPosition) {
                view.root.style.setProperty(
                    "position",
                    view.oldPosition,
                    view.oldPositionPriority
                );
            }

            if (view.oldOverflow) {
                view.root.style.setProperty(
                    "overflow",
                    view.oldOverflow,
                    view.oldOverflowPriority
                );
            }
        }
    }

    async function enterTrashMode() {
        if (
            state.trashView &&
            document.getElementById(ID.OVERLAY)
        ) {
            await refreshTrashFromServer();
            return;
        }

        const tabList = findEpisodeTabList();

        if (!tabList) {
            showToast("에피소드/파티챗 영역을 찾지 못했습니다.");
            return;
        }

        const view = mountTrashOverlay(tabList);

        if (!view) {
            showToast("왼쪽 사이드바 전체 영역을 찾지 못했습니다.");
            return;
        }

        state.trashView = view;

        renderTrashList();
        updateTrashHeader();

        /*
         * 화면은 서버 전체조회보다 먼저 띄운다.
         * 따라서 인증/네트워크 확인이 실패해도 휴지통 UI 자체는 열린다.
         */
        await refreshTrashFromServer();
    }

    function exitTrashMode() {
        closeCustomMenu();

        state.selectionMode = null;
        state.selectedIds.clear();

        const view = state.trashView;
        unmountTrashOverlay(view);

        /* 혹시 state가 유실된 경우의 안전 정리 */
        document.getElementById(ID.OVERLAY)?.remove();

        state.trashView = null;

        setTimeout(() => {
            refreshEpisodeList().catch(() => {});
        }, 0);
    }

    // =========================================================
    // 휴지통 카드
    // =========================================================

    function createTrashCard(item, index) {
        const wrapper = document.createElement("div");

        wrapper.dataset.index = String(index);
        wrapper.dataset.itemIndex = String(index);
        wrapper.dataset.knownSize = "64";
        wrapper.style.overflowAnchor = "none";

        const card = document.createElement("div");
        card.className =
            "group flex items-center gap-2 px-2 py-2 rounded-sm " +
            "hover:bg-surface_ivory " +
            "[&:hover_.chat-update-date-label]:block " +
            "w-[240px]";

        if (state.selectionMode) {
            const selected = state.selectedIds.has(item.chatId);

            const checkbox = document.createElement("button");
            checkbox.type = "button";
            checkbox.className = "crack-trash-select-box";
            checkbox.dataset.selected = selected ? "true" : "false";
            checkbox.textContent = selected ? "✓" : "";

            checkbox.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                toggleSelected(item.chatId);
            });

            card.appendChild(checkbox);
            card.style.cursor = "pointer";

            card.addEventListener("click", () => {
                toggleSelected(item.chatId);
            });
        }

        const avatar = document.createElement("span");
        avatar.className =
            "relative flex shrink-0 overflow-hidden rounded-full " +
            "h-12 w-12 border border-border";

        if (item.image) {
            const image = document.createElement("img");
            image.className = "aspect-square h-full w-full object-cover";
            image.src = item.image;
            image.alt = "";
            image.loading = "lazy";

            image.addEventListener(
                "error",
                () => {
                    image.remove();
                    avatar.style.alignItems = "center";
                    avatar.style.justifyContent = "center";
                    avatar.textContent = "🗑️";
                },
                { once: true }
            );

            avatar.appendChild(image);
        } else {
            avatar.style.alignItems = "center";
            avatar.style.justifyContent = "center";
            avatar.textContent = "🗑️";
        }

        const content = document.createElement("div");
        content.className =
            "flex flex-col gap-1.5 flex-1 min-w-0 overflow-hidden";

        const top = document.createElement("div");
        top.className = "flex items-center gap-0.5 w-full";

        const titleWrap = document.createElement("div");
        titleWrap.className =
            "flex flex-1 items-center gap-1 min-w-0";

        const title = document.createElement("span");
        title.className =
            "typo-text-sm_leading-none_medium " +
            "text-popover-foreground " +
            "overflow-hidden whitespace-nowrap " +
            "text-ellipsis shrink min-w-0";
        title.textContent = item.title || "제목 없음";

        titleWrap.appendChild(title);
        top.appendChild(titleWrap);

        if (!state.selectionMode) {
            const menuButton = document.createElement("button");
            menuButton.type = "button";
            menuButton.setAttribute("aria-label", "휴지통 채팅방 메뉴");
            menuButton.setAttribute("data-state", "closed");

            menuButton.className =
                "size-4 shrink-0 " +
                "[&_svg]:size-4 " +
                "text-icon_tertiary rounded " +
                "data-[state=open]:bg-hover";

            menuButton.style.pointerEvents = "auto";
            menuButton.style.touchAction = "manipulation";

            menuButton.innerHTML = `
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="var(--icon_primary)"
                    viewBox="0 0 24 24"
                    width="24"
                    height="24"
                >
                    <path d="M10.75 7.02V4.48h2.54v2.54zm0 3.73v2.54h2.54v-2.54zm0 6.23v2.54h2.54v-2.54z"></path>
                </svg>
            `;

            menuButton.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                openTrashItemMenu(menuButton, item);
            });

            top.appendChild(menuButton);
        }

        const bottom = document.createElement("div");
        bottom.className =
            "flex items-center justify-between w-full gap-1.5";

        const message = document.createElement("span");
        message.className =
            "typo-text-xs_leading-none_regular " +
            "text-muted-foreground " +
            "overflow-hidden whitespace-nowrap " +
            "text-ellipsis flex-1 min-w-0";
        message.textContent = item.lastMessage || "마지막 메시지 없음";

        const date = document.createElement("span");
        date.className =
            "chat-update-date-label " +
            "typo-text-xs_leading-none_regular " +
            "overflow-hidden line-clamp-1 hidden " +
            "select-none whitespace-nowrap " +
            "text-muted-foreground";
        date.textContent = getRelativeDate(item.movedAt);

        bottom.append(message, date);
        content.append(top, bottom);
        card.append(avatar, content);
        wrapper.appendChild(card);

        return wrapper;
    }

    function renderTrashList() {
        const scroll = document.getElementById(ID.SCROLL);
        if (!scroll) return;

        scroll.replaceChildren();

        if (state.loadingTrash) {
            const loading = document.createElement("div");
            loading.className = "crack-trash-loading";
            loading.innerHTML = `
                <div class="crack-trash-loading-title">
                    휴지통 확인 중
                </div>

                <div class="crack-trash-loading-description">
                    ${state.loadingText || "전체 채팅 목록을 불러오고 있습니다..."}
                </div>
            `;

            scroll.appendChild(loading);
            return;
        }

        const items = [...loadTrashSessions()].sort(
            (a, b) =>
                new Date(b.movedAt || 0).getTime() -
                new Date(a.movedAt || 0).getTime()
        );

        if (!items.length) {
            const empty = document.createElement("div");
            empty.className = "crack-trash-empty";
            empty.innerHTML = `
                <div class="crack-trash-empty-icon">🗑️</div>

                <div class="crack-trash-empty-title">
                    휴지통이 비어 있어요
                </div>

                <div class="crack-trash-empty-description">
                    채팅방 메뉴에서 '휴지통으로 이동'을 누르면 여기에 보관됩니다.
                </div>
            `;

            scroll.appendChild(empty);
            return;
        }

        for (let i = 0; i < items.length; i++) {
            scroll.appendChild(createTrashCard(items[i], i));
        }
    }

    // =========================================================
    // 아이콘
    // =========================================================

    function iconTrash() {
        return `
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="var(--icon_secondary)"
                viewBox="0 0 24 25"
                width="20"
                height="20"
            >
                <path d="M15.44 4.34H8.56v-1.6h6.88zm-6 12v-5.6h1.6v5.6zm3.53-5.6v5.6h1.6v-5.6z"></path>
                <path
                    fill-rule="evenodd"
                    d="M2.6 5.43v1.6h1.57v13.9c0 .78.63 1.4 1.4 1.4h12.86c.77 0 1.4-.62 1.4-1.4V7.04h1.57v-1.6zm15.63 1.6H5.77v13.7h12.46z"
                    clip-rule="evenodd"
                ></path>
            </svg>
        `;
    }

    function iconRestore() {
        return `
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="var(--icon_secondary)"
                viewBox="0 0 24 24"
                width="20"
                height="20"
            >
                <path d="M7.6 7.2H4.5V4H2.9v5.9h5.9V8.3H6.4A7.5 7.5 0 1 1 4.7 15h1.7A5.9 5.9 0 1 0 7.6 7.2z"></path>
            </svg>
        `;
    }

    function iconExport() {
        return `
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="var(--icon_secondary)"
                viewBox="0 0 24 24"
                width="20"
                height="20"
            >
                <path d="M11.2 3h1.6v10.1l3-3 1.1 1.1-4.9 4.9-4.9-4.9 1.1-1.1 3 3z"></path>
                <path d="M4 17h1.6v2.4h12.8V17H20v4H4z"></path>
            </svg>
        `;
    }

    function iconImport() {
        return `
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="var(--icon_secondary)"
                viewBox="0 0 24 24"
                width="20"
                height="20"
            >
                <path d="M11.2 16.1h1.6V6l3 3 1.1-1.1L12 3 7.1 7.9 8.2 9l3-3z"></path>
                <path d="M4 17h1.6v2.4h12.8V17H20v4H4z"></path>
            </svg>
        `;
    }

    // =========================================================
    // 원본형 Radix 커스텀 메뉴
    // =========================================================

    function closeCustomMenu() {
        if (!state.customMenu) return;

        state.customMenu.wrapper?.remove();
        state.customMenu.anchor?.setAttribute("data-state", "closed");

        state.customMenu = null;

        document.removeEventListener(
            "pointerdown",
            customMenuOutside,
            true
        );
    }

    function customMenuOutside(event) {
        const current = state.customMenu;
        if (!current) return;

        if (
            current.wrapper.contains(event.target) ||
            current.anchor?.contains(event.target)
        ) {
            return;
        }

        closeCustomMenu();
    }

    function replaceItemContent(item, text, fallbackIcon = "") {
        const originalSvg = item.querySelector(":scope > svg");

        item.replaceChildren();

        if (originalSvg) {
            item.appendChild(originalSvg);
        } else if (fallbackIcon) {
            item.insertAdjacentHTML("beforeend", fallbackIcon);
        }

        item.appendChild(document.createTextNode(text));
    }

    function createRadixItem({
        text,
        icon = "",
        template = null,
        onClick,
    }) {
        let templateNode = null;

        if (template === "edit") {
            templateNode = state.editItemTemplate;
        } else if (template === "delete") {
            templateNode = state.deleteItemTemplate;
        }

        let item;

        if (templateNode) {
            item = templateNode.cloneNode(true);
            replaceItemContent(item, text, icon);
        } else {
            item = document.createElement("div");
            item.className = RADIX_ITEM_CLASS;

            if (icon) {
                item.insertAdjacentHTML("beforeend", icon);
            }

            item.appendChild(document.createTextNode(text));
        }

        item.setAttribute("role", "menuitem");
        item.setAttribute("tabindex", "-1");
        item.setAttribute("data-orientation", "vertical");
        item.setAttribute("data-radix-collection-item", "");

        item.removeAttribute("data-crack-trash-global-menu");
        item.removeAttribute("data-crack-trash-move-menu");

        item.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();

            closeCustomMenu();
            onClick?.();
        });

        return item;
    }

    function createSeparator() {
        const separator = document.createElement("div");
        separator.setAttribute("role", "separator");
        separator.className = "-mx-1 my-1 h-px bg-muted";
        return separator;
    }

    function openRadixLikeMenu(anchor, configs) {
        closeCustomMenu();

        anchor.setAttribute("data-state", "open");

        const rect = anchor.getBoundingClientRect();

        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-radix-popper-content-wrapper", "");
        wrapper.setAttribute("data-crack-trash-custom-menu", "true");
        wrapper.setAttribute("dir", "ltr");

        wrapper.style.position = "fixed";
        wrapper.style.left = "0px";
        wrapper.style.top = "0px";
        wrapper.style.minWidth = "max-content";

        // 모바일 fixed 휴지통은 body 최상단 레이어이므로
        // 커스텀 메뉴도 반드시 그 위에 있어야 한다.
        const trashOverlay = document.getElementById(ID.OVERLAY);
        const isMobileFixedTrash =
            trashOverlay?.dataset?.layout === "mobile-fixed";

        wrapper.style.zIndex = isMobileFixedTrash
            ? "2147483600"
            : "1000";
        wrapper.style.pointerEvents = "auto";
        wrapper.style.touchAction = "manipulation";

        wrapper.style.setProperty(
            "--radix-popper-anchor-width",
            `${rect.width}px`
        );
        wrapper.style.setProperty(
            "--radix-popper-anchor-height",
            `${rect.height}px`
        );
        wrapper.style.setProperty(
            "--radix-popper-available-width",
            `${Math.max(0, window.innerWidth - 16)}px`
        );
        wrapper.style.setProperty(
            "--radix-popper-available-height",
            `${Math.max(0, window.innerHeight - 16)}px`
        );
        wrapper.style.setProperty(
            "--radix-popper-transform-origin",
            "100% 0px"
        );

        const menu = document.createElement("div");
        menu.setAttribute("data-side", "bottom");
        menu.setAttribute("data-align", "end");
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-orientation", "vertical");
        menu.setAttribute("data-state", "open");
        menu.setAttribute("data-radix-menu-content", "");
        menu.setAttribute("dir", "ltr");
        menu.setAttribute("tabindex", "-1");
        menu.setAttribute("data-orientation", "vertical");

        menu.className = RADIX_MENU_CLASS;
        menu.style.outline = "none";
        menu.style.pointerEvents = "auto";
        menu.style.setProperty(
            "--radix-dropdown-menu-content-transform-origin",
            "var(--radix-popper-transform-origin)"
        );
        menu.style.setProperty(
            "--radix-dropdown-menu-content-available-width",
            "var(--radix-popper-available-width)"
        );
        menu.style.setProperty(
            "--radix-dropdown-menu-content-available-height",
            "var(--radix-popper-available-height)"
        );
        menu.style.setProperty(
            "--radix-dropdown-menu-trigger-width",
            "var(--radix-popper-anchor-width)"
        );
        menu.style.setProperty(
            "--radix-dropdown-menu-trigger-height",
            "var(--radix-popper-anchor-height)"
        );

        for (const config of configs) {
            if (config === "separator") {
                menu.appendChild(createSeparator());
            } else {
                menu.appendChild(createRadixItem(config));
            }
        }

        wrapper.appendChild(menu);
        document.body.appendChild(wrapper);

        const menuRect = menu.getBoundingClientRect();

        let left = rect.right - menuRect.width;
        let top = rect.bottom + 4;

        if (left < 8) left = 8;

        if (left + menuRect.width > window.innerWidth - 8) {
            left = window.innerWidth - menuRect.width - 8;
        }

        if (top + menuRect.height > window.innerHeight - 8) {
            top = rect.top - menuRect.height - 4;
            menu.setAttribute("data-side", "top");
            wrapper.style.setProperty(
                "--radix-popper-transform-origin",
                "100% 100%"
            );
        }

        wrapper.style.transform = `translate(${left}px, ${top}px)`;

        state.customMenu = {
            wrapper,
            menu,
            anchor,
        };

        setTimeout(() => {
            document.addEventListener(
                "pointerdown",
                customMenuOutside,
                true
            );
        }, 0);
    }

    function openTrashItemMenu(button, item) {
        openRadixLikeMenu(button, [
            {
                text: "복원하기",
                icon: iconRestore(),
                onClick: () => {
                    restoreChat(item.chatId);
                },
            },
            {
                text: "삭제하기",
                icon: iconTrash(),
                template: "delete",
                onClick: () => {
                    permanentlyDeleteChat(item);
                },
            },
        ]);
    }

    // =========================================================
    // JSON 내보내기 / 불러오기
    // =========================================================

    function exportTrashJson() {
        const items = loadTrashSessions();

        const backup = {
            format: "crack-trash-backup",
            version: 1,
            exportedAt: new Date().toISOString(),
            items,
        };

        const blob = new Blob(
            [JSON.stringify(backup, null, 2)],
            {
                type: "application/json;charset=utf-8",
            }
        );

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");

        anchor.href = url;
        anchor.download =
            "crack-trash-" +
            new Date()
                .toISOString()
                .replace(/[:.]/g, "-") +
            ".json";

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);

        showToast(`${items.length}개의 휴지통 기록을 내보냈습니다.`);
    }

    function normalizeImportedTrash(data) {
        let source = data?.items;

        if (!Array.isArray(source) && Array.isArray(data)) {
            source = data;
        }

        if (!Array.isArray(source)) {
            throw new Error("올바른 휴지통 JSON 파일이 아닙니다.");
        }

        const items = [];
        const invalid = [];
        const seen = new Set();

        for (const raw of source) {
            if (
                !raw ||
                typeof raw !== "object" ||
                !isValidChatId(raw.chatId)
            ) {
                invalid.push({
                    reason: "invalid_data",
                    data: raw,
                });
                continue;
            }

            if (seen.has(raw.chatId)) {
                continue;
            }

            seen.add(raw.chatId);

            items.push({
                storyId:
                    typeof raw.storyId === "string"
                        ? raw.storyId
                        : "",
                chatId: raw.chatId,
                href:
                    typeof raw.href === "string"
                        ? raw.href
                        : "",
                title:
                    typeof raw.title === "string"
                        ? raw.title
                        : "제목 없음",
                image:
                    typeof raw.image === "string"
                        ? raw.image
                        : null,
                lastMessage:
                    typeof raw.lastMessage === "string"
                        ? raw.lastMessage
                        : "",
                originalDateLabel:
                    typeof raw.originalDateLabel === "string"
                        ? raw.originalDateLabel
                        : "",
                movedAt:
                    typeof raw.movedAt === "string"
                        ? raw.movedAt
                        : new Date().toISOString(),
            });
        }

        return {
            items,
            invalid,
        };
    }

    async function importTrashJsonFile(file) {
        if (!file) return;

        let parsed;

        try {
            parsed = JSON.parse(await file.text());
        } catch {
            showToast("JSON 파일을 읽을 수 없습니다.");
            return;
        }

        let normalized;

        try {
            normalized = normalizeImportedTrash(parsed);
        } catch (error) {
            showToast(error.message || "올바른 휴지통 JSON이 아닙니다.");
            return;
        }

        state.loadingTrash = true;
        state.loadingText = "JSON 채팅 ID 확인 중...";

        renderTrashList();
        updateTrashHeader();

        try {
            const serverChats = await loadAllServerChats({ showProgress: true });
            const byId = new Map();

            for (const chat of serverChats) {
                if (chat?._id) {
                    byId.set(chat._id, chat);
                }
            }

            const validImported = [];
            const missingImported = [];

            for (const item of normalized.items) {
                const serverChat = byId.get(item.chatId);

                if (!serverChat) {
                    missingImported.push({
                        chatId: item.chatId,
                        title: item.title || "",
                        reason: "not_in_server_chat_list",
                    });
                    continue;
                }

                validImported.push(
                    mergeServerChatInfo(item, serverChat)
                );
            }

            const merged = new Map();
            const removedExisting = [];

            for (const item of loadTrashSessions()) {
                const serverChat = byId.get(item.chatId);

                if (!serverChat) {
                    removedExisting.push({
                        chatId: item.chatId,
                        title: item.title || "",
                        reason: "not_in_server_chat_list",
                    });
                    continue;
                }

                merged.set(
                    item.chatId,
                    mergeServerChatInfo(item, serverChat)
                );
            }

            for (const item of validImported) {
                merged.set(item.chatId, item);
            }

            const finalItems = [...merged.values()].sort(
                (a, b) =>
                    new Date(b.movedAt || 0).getTime() -
                    new Date(a.movedAt || 0).getTime()
            );

            state.serverChats = byId;
            state.serverChatsLoaded = true;

            saveTrashSessions(finalItems);

            appendLog({
                type: "json_import",
                fileName: file.name,
                sourceCount:
                    normalized.items.length +
                    normalized.invalid.length,
                importedCount: validImported.length,
                missingImportedCount: missingImported.length,
                removedExistingCount: removedExisting.length,
                invalidCount: normalized.invalid.length,
                missingImported,
                removedExisting,
                invalid: normalized.invalid,
            });

            const removedCount =
                missingImported.length +
                removedExisting.length +
                normalized.invalid.length;

            if (missingImported.length || removedExisting.length) {
                console.group(
                    `[Crack Trash] JSON 불러오기 중 서버에 없어 제외된 기록 ${
                        missingImported.length + removedExisting.length
                    }개`
                );
                console.table([
                    ...missingImported,
                    ...removedExisting,
                ]);
                console.groupEnd();
            }

            showToast(
                removedCount
                    ? `${validImported.length}개 불러옴 · ${removedCount}개 제외`
                    : `${validImported.length}개의 기록을 불러왔습니다.`
            );
        } catch (error) {
            console.error("[Crack Trash] JSON 불러오기 실패", error);
            showToast(error.message || "JSON 불러오기 중 오류가 발생했습니다.");
        } finally {
            state.loadingTrash = false;
            state.loadingText = "";

            renderTrashList();
            updateTrashHeader();
        }
    }

    function ensureFileInput() {
        let input = document.getElementById(ID.FILE_INPUT);

        if (input) {
            return input;
        }

        input = document.createElement("input");
        input.id = ID.FILE_INPUT;
        input.type = "file";
        input.accept = ".json,application/json";
        input.style.display = "none";

        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            input.value = "";

            if (file) {
                await importTrashJsonFile(file);
            }
        });

        document.body.appendChild(input);
        return input;
    }

    function openFileMenu(button) {
        openRadixLikeMenu(button, [
            {
                text: "일괄 복구하기",
                template: "edit",
                onClick: () => {
                    enterSelectionMode("restore");
                },
            },
            {
                text: "일괄 삭제",
                template: "edit",
                onClick: () => {
                    enterSelectionMode("delete");
                },
            },
            "separator",
            {
                text: "JSON으로 내보내기",
                icon: iconExport(),
                onClick: exportTrashJson,
            },
            {
                text: "JSON 불러오기",
                icon: iconImport(),
                onClick: () => {
                    ensureFileInput().click();
                },
            },
        ]);
    }

    // =========================================================
    // 원본 Radix 메뉴 패치
    // =========================================================

    const MENU_ACTION_SELECTOR =
        '[role="menuitem"], [data-radix-collection-item], button';

    function getMenuItems(menu) {
        if (!(menu instanceof Element)) {
            return [];
        }

        const direct = [
            ...menu.querySelectorAll(
                ':scope > [role="menuitem"], ' +
                ':scope > [data-radix-collection-item]'
            ),
        ];

        if (direct.length) {
            return [...new Set(direct)];
        }

        /*
         * 모바일에서는 동일 액션이 role=menu가 아닌
         * action-sheet/dialog 내부 button으로 렌더될 수 있다.
         */
        return [
            ...new Set(
                [...menu.querySelectorAll(MENU_ACTION_SELECTOR)]
                    .filter(element => {
                        const text = textOf(element);

                        return [
                            "자동 정리",
                            "편집",
                            "휴지통",
                            "고정하기",
                            "고정 해제하기",
                            "이름 변경하기",
                            "보관함으로 이동",
                            "삭제하기",
                            "휴지통으로 이동",
                        ].includes(text);
                    })
            ),
        ];
    }

    function hasMenuItemText(container, text) {
        return getMenuItems(container)
            .some(item => textOf(item) === text);
    }

    function isGlobalChatMenu(menu) {
        if (!(menu instanceof HTMLElement)) {
            return false;
        }

        return (
            hasMenuItemText(menu, "자동 정리") &&
            (
                hasMenuItemText(menu, "편집") ||
                hasMenuItemText(menu, "휴지통")
            )
        );
    }

    function injectTrashIntoGlobalMenu(menu) {
        if (!isGlobalChatMenu(menu)) {
            return;
        }

        const items = getMenuItems(menu);

        const edit = items.find(
            item => textOf(item) === "편집"
        );

        const auto = items.find(
            item => textOf(item) === "자동 정리"
        );

        if (edit && !state.editItemTemplate) {
            state.editItemTemplate =
                edit.cloneNode(true);
        }

        const source = edit || auto;

        edit?.remove();

        if (
            menu.querySelector(
                '[data-crack-trash-global-menu="true"]'
            )
        ) {
            return;
        }

        if (!source) {
            return;
        }

        const trash = source.cloneNode(true);

        trash.setAttribute(
            "data-crack-trash-global-menu",
            "true"
        );

        replaceItemContent(
            trash,
            "휴지통",
            iconTrash()
        );

        trash.addEventListener(
            "click",
            event => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                closeRadixMenu(menu);

                setTimeout(() => {
                    enterTrashMode().catch(error => {
                        console.error(
                            "[Crack Trash] 휴지통 진입 실패",
                            error
                        );
                    });
                }, 0);
            },
            true
        );

        menu.appendChild(trash);
    }

    function isIndividualChatMenu(menu) {
        if (!(menu instanceof HTMLElement)) {
            return false;
        }

        return (
            hasMenuItemText(menu, "이름 변경하기") &&
            hasMenuItemText(menu, "보관함으로 이동") &&
            (
                hasMenuItemText(menu, "삭제하기") ||
                hasMenuItemText(menu, "휴지통으로 이동")
            )
        );
    }

    function replaceDeleteWithTrashMove(menu) {
        if (!isIndividualChatMenu(menu)) {
            return;
        }

        if (
            menu.querySelector(
                '[data-crack-trash-move-menu="true"]'
            )
        ) {
            return;
        }

        const originalDelete =
            getMenuItems(menu).find(
                item => textOf(item) === "삭제하기"
            );

        if (!originalDelete) {
            return;
        }

        if (!state.deleteItemTemplate) {
            state.deleteItemTemplate =
                originalDelete.cloneNode(true);
        }

        /*
         * 모바일에서는 메뉴가 portal에 붙은 뒤 trigger와 연결 정보가
         * 사라질 수 있으므로 패치되는 순간 컨텍스트도 고정해 둔다.
         */
        const boundContext =
            resolveChatContextFromMenu(menu) ||
            state.currentChatContext;

        const trash = originalDelete.cloneNode(true);

        trash.setAttribute(
            "data-crack-trash-move-menu",
            "true"
        );

        replaceItemContent(
            trash,
            "휴지통으로 이동"
        );

        let activated = false;
        let lastTouchAt = 0;

        const activate = async event => {
            if (activated) {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                return;
            }

            activated = true;

            event?.preventDefault?.();
            event?.stopPropagation?.();
            event?.stopImmediatePropagation?.();

            const context =
                boundContext ||
                resolveChatContextFromMenu(menu) ||
                state.currentChatContext;

            if (!context) {
                showToast(
                    "채팅 정보를 찾지 못했습니다."
                );

                closeRadixMenu(menu);
                activated = false;
                return;
            }

            closeRadixMenu(menu);

            try {
                await moveChatToTrash(context);
            } finally {
                setTimeout(() => {
                    activated = false;
                }, 400);
            }
        };

        /*
         * 일반 브라우저/PC.
         */
        trash.addEventListener(
            "click",
            event => {
                /* touchend 뒤 생성되는 synthetic click 중복 방지 */
                if (
                    Date.now() - lastTouchAt < 700
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    return;
                }

                activate(event).catch(error => {
                    console.error(
                        "[Crack Trash] 휴지통 이동 실패",
                        error
                    );
                });
            },
            true
        );

        /*
         * iOS/모바일 WebView fallback.
         */
        trash.addEventListener(
            "touchend",
            event => {
                lastTouchAt = Date.now();

                activate(event).catch(error => {
                    console.error(
                        "[Crack Trash] 모바일 휴지통 이동 실패",
                        error
                    );
                });
            },
            {
                capture: true,
                passive: false,
            }
        );

        trash.addEventListener(
            "keydown",
            event => {
                if (
                    event.key === "Enter" ||
                    event.key === " "
                ) {
                    activate(event).catch(error => {
                        console.error(
                            "[Crack Trash] 휴지통 이동 실패",
                            error
                        );
                    });
                }
            },
            true
        );

        originalDelete.replaceWith(trash);
    }

    function closeRadixMenu(menu) {
        try {
            const escapeEvent =
                new KeyboardEvent(
                    "keydown",
                    {
                        key: "Escape",
                        code: "Escape",
                        bubbles: true,
                        cancelable: true,
                    }
                );

            menu?.dispatchEvent(escapeEvent);

            /* 모바일 action-sheet/dialog fallback */
            document.dispatchEvent(
                new KeyboardEvent(
                    "keydown",
                    {
                        key: "Escape",
                        code: "Escape",
                        bubbles: true,
                        cancelable: true,
                    }
                )
            );
        } catch {
            // ignore
        }
    }

    function findActionContainer(start, predicate) {
        let node = start;
        let depth = 0;

        while (
            node instanceof HTMLElement &&
            node !== document.body &&
            depth < 10
        ) {
            if (predicate(node)) {
                return node;
            }

            node = node.parentElement;
            depth += 1;
        }

        return null;
    }

    function collectMenuCandidates(root = document) {
        const menus = new Set();

        const addObvious = element => {
            if (!(element instanceof HTMLElement)) {
                return;
            }

            if (
                element.matches(
                    '[role="menu"], ' +
                    '[data-radix-menu-content], ' +
                    '[role="dialog"]'
                )
            ) {
                menus.add(element);
            }
        };

        if (root instanceof HTMLElement) {
            addObvious(root);
        }

        if (root?.querySelectorAll) {
            for (
                const element
                of root.querySelectorAll(
                    '[role="menu"], ' +
                    '[data-radix-menu-content], ' +
                    '[role="dialog"]'
                )
            ) {
                menus.add(element);
            }

            /*
             * 모바일 액션시트가 role=menu/dialog를 안 쓰는 경우:
             * 삭제/편집 액션 자체에서 가장 가까운 액션 묶음을 역탐색한다.
             */
            const actionElements = [
                ...root.querySelectorAll(
                    MENU_ACTION_SELECTOR
                ),
            ].filter(element =>
                [
                    "삭제하기",
                    "편집",
                    "자동 정리",
                ].includes(textOf(element))
            );

            for (const action of actionElements) {
                const container =
                    findActionContainer(
                        action.parentElement,
                        candidate =>
                            isIndividualChatMenu(candidate) ||
                            isGlobalChatMenu(candidate)
                    );

                if (container) {
                    menus.add(container);
                }
            }
        }

        return menus;
    }

    function scanMenus(root = document) {
        for (
            const menu
            of collectMenuCandidates(root)
        ) {
            if (
                menu.closest(
                    '[data-crack-trash-custom-menu="true"]'
                )
            ) {
                continue;
            }

            injectTrashIntoGlobalMenu(menu);
            replaceDeleteWithTrashMove(menu);
        }
    }

    // =========================================================
    // MutationObserver
    // =========================================================

    const observer = new MutationObserver(mutations => {
        if (
            state.trashView &&
            (
                !state.trashView.root?.isConnected ||
                !state.trashView.overlay?.isConnected
            )
        ) {
            closeCustomMenu();

            state.trashView = null;
            state.selectionMode = null;
            state.selectedIds.clear();
        }

        for (const mutation of mutations) {
            if (mutation.type !== "childList") {
                continue;
            }

            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) {
                    continue;
                }

                scanMenus(node);
                scanSidebarStructure(node);
            }
        }
    });

    // =========================================================
    // 다른 탭 localStorage 동기화
    // =========================================================

    window.addEventListener("storage", event => {
        if (event.key !== STORAGE_KEY) {
            return;
        }

        renderTrashList();
        updateTrashHeader();

        if (!state.trashView) {
            refreshEpisodeList().catch(() => {});
        }
    });

    // =========================================================
    // 초기화
    // =========================================================

    function init() {
        cleanupOldVersion();
        injectStyle();

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        scanMenus(document);
        scanSidebarStructure(document);

        console.log("[Crack Trash] v2.0.0 PC·모바일 통합 로드 완료", {
            capturedApiHeaders: [
                ...state.capturedApiHeaders.keys(),
            ],
            authMode:
                state.capturedApiHeaders.size > 0
                    ? "원본 API 헤더 재사용"
                    : "쿠키 인증 대기",
        });
    }

    function waitForBody() {
        if (document.body && document.head) {
            init();
            return;
        }

        const ready = new MutationObserver(() => {
            if (!document.body || !document.head) {
                return;
            }

            ready.disconnect();
            init();
        });

        ready.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    waitForBody();
})();
