// ==UserScript==
// @name         비공개 작품 카피
// @namespace    https://github.com/workforomg/Utill
// @version      0.5
// @author       지유지요
// @description  내 스토리를 비공개 세이프/언세이프로 즉시 복제
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai';
    const MARKER = 'data-crack-private-copy';

    let authToken = null;
    let copying = false;


    console.log(
        '%c[CrackCopy] 실행됨 v1.4.0',
        'color:#00c853;font-weight:bold'
    );


    // ============================================================
    // Authorization 토큰 감지
    // ============================================================

    function captureAuthorization(value) {
        if (typeof value !== 'string') {
            return;
        }

        const match =
            value.match(/^Bearer\s+(.+)$/i);

        if (!match) {
            return;
        }

        const nextToken = match[1];

        if (authToken === nextToken) {
            return;
        }

        authToken = nextToken;

        console.log(
            '[CrackCopy] 인증 토큰 확보'
        );
    }


    // ============================================================
    // XHR Authorization 감지
    // ============================================================

    const originalSetRequestHeader =
        XMLHttpRequest.prototype.setRequestHeader;


    XMLHttpRequest.prototype.setRequestHeader =
        function (name, value) {

            if (
                String(name).toLowerCase() ===
                'authorization'
            ) {
                captureAuthorization(
                    String(value)
                );
            }

            return originalSetRequestHeader.call(
                this,
                name,
                value
            );
        };


    // ============================================================
    // fetch Authorization 감지
    // ============================================================

    const originalFetch =
        window.fetch;


    window.fetch =
        async function (...args) {

            try {
                const input = args[0];
                const init = args[1] || {};

                const headers =
                    new Headers(
                        init.headers ||
                        (
                            input instanceof Request
                                ? input.headers
                                : undefined
                        )
                    );

                const authorization =
                    headers.get('authorization');

                if (authorization) {
                    captureAuthorization(
                        authorization
                    );
                }

            } catch (error) {
                // 무시
            }

            return originalFetch.apply(
                this,
                args
            );
        };


    // ============================================================
    // Cookie
    // ============================================================

    function getCookie(name) {
        try {
            const escaped =
                name.replace(
                    /([.$?*|{}()[\]\\/+^])/g,
                    '\\$1'
                );

            const match =
                document.cookie.match(
                    new RegExp(
                        '(?:^|; )' +
                        escaped +
                        '=([^;]*)'
                    )
                );

            return match
                ? decodeURIComponent(
                    match[1]
                )
                : null;

        } catch {
            return null;
        }
    }


    // ============================================================
    // 토큰 fallback
    // ============================================================

    function getAuthToken() {
        if (authToken) {
            return authToken;
        }


        // access_token 쿠키 우선
        const cookieToken =
            getCookie('access_token');

        if (cookieToken) {
            authToken =
                cookieToken;

            return authToken;
        }


        // 일반 JWT 쿠키 탐색
        try {
            const cookies =
                document.cookie.split(';');

            for (const raw of cookies) {
                const value =
                    decodeURIComponent(
                        raw
                            .split('=')
                            .slice(1)
                            .join('=')
                    );

                if (
                    value &&
                    value.split('.').length === 3
                ) {
                    authToken =
                        value;

                    return authToken;
                }
            }
        } catch {
            // 무시
        }


        // localStorage
        try {
            for (
                let i = 0;
                i < localStorage.length;
                i++
            ) {
                const key =
                    localStorage.key(i);

                const value =
                    localStorage.getItem(key);

                if (!value) {
                    continue;
                }

                const bearer =
                    value.match(
                        /Bearer\s+([A-Za-z0-9._-]+)/i
                    );

                if (bearer) {
                    authToken =
                        bearer[1];

                    return authToken;
                }

                if (
                    value.split('.').length === 3
                ) {
                    authToken =
                        value;

                    return authToken;
                }
            }

        } catch {
            // 무시
        }


        // sessionStorage
        try {
            for (
                let i = 0;
                i < sessionStorage.length;
                i++
            ) {
                const key =
                    sessionStorage.key(i);

                const value =
                    sessionStorage.getItem(key);

                if (
                    value &&
                    value.split('.').length === 3
                ) {
                    authToken =
                        value;

                    return authToken;
                }
            }

        } catch {
            // 무시
        }


        return null;
    }


    // ============================================================
    // API
    // ============================================================

    async function authFetch(
        method,
        url,
        body
    ) {
        const token =
            getAuthToken();

        if (!token) {
            throw new Error(
                '인증 토큰을 찾지 못했습니다. 페이지 새로고침 후 다시 시도해주세요.'
            );
        }


        const options = {
            method,

            headers: {
                Authorization:
                    'Bearer ' + token,

                'Content-Type':
                    'application/json'
            }
        };


        if (body !== undefined) {
            options.body =
                typeof body === 'string'
                    ? body
                    : JSON.stringify(body);
        }


        const response =
            await originalFetch(
                url,
                options
            );


        const text =
            await response.text();


        let result = null;

        try {
            result =
                JSON.parse(text);
        } catch {
            result = text;
        }


        if (!response.ok) {
            console.error(
                '[CrackCopy] API ERROR',
                response.status,
                method,
                url,
                result
            );

            throw new Error(
                typeof result === 'string'
                    ? result
                    : JSON.stringify(result)
            );
        }


        return result;
    }


    // ============================================================
    // Toast
    // ============================================================

    function toast(
        message,
        isError = false
    ) {
        document
            .querySelector(
                '[data-crack-copy-toast]'
            )
            ?.remove();


        const element =
            document.createElement('div');


        element.setAttribute(
            'data-crack-copy-toast',
            ''
        );


        element.textContent =
            message;


        Object.assign(
            element.style,
            {
                position: 'fixed',
                right: '24px',
                bottom: '24px',
                zIndex: '2147483647',

                maxWidth: '430px',

                padding: '13px 16px',

                borderRadius: '10px',

                background:
                    isError
                        ? '#491d1d'
                        : '#222',

                color: '#fff',

                fontSize: '14px',
                fontWeight: '600',

                boxShadow:
                    '0 6px 24px rgba(0,0,0,.3)',

                whiteSpace: 'pre-wrap'
            }
        );


        function append() {
            if (!document.body) {
                setTimeout(
                    append,
                    50
                );

                return;
            }

            document.body.appendChild(
                element
            );

            setTimeout(
                () => element.remove(),
                3500
            );
        }


        append();
    }


    // ============================================================
    // React Props 작품 ID 추출
    // NeoCopy 방식
    // ============================================================

    function extractCurrentArticle(
        element
    ) {
        try {
            if (!element) {
                return null;
            }


            const reactPropertyName =
                Object.keys(element)
                    .find(
                        key =>
                            key.startsWith(
                                '__reactProps'
                            )
                    );


            if (!reactPropertyName) {
                return null;
            }


            const reactProperty =
                element[
                    reactPropertyName
                ];


            if (!reactProperty?.children) {
                return null;
            }


            const children =
                Array.isArray(
                    reactProperty.children
                )
                    ? reactProperty.children
                    : [
                        reactProperty.children
                    ];


            for (
                const child of children
            ) {
                const content =
                    child?.props?.content;

                if (
                    content?.sourceId
                ) {
                    return {
                        type:
                            content.type ?? '',

                        id:
                            content.sourceId
                    };
                }
            }


            return null;

        } catch (error) {
            console.warn(
                '[CrackCopy] React Props 오류',
                error
            );

            return null;
        }
    }


    function extractArticleFromWrapper(
        wrapper
    ) {
        if (!wrapper) {
            return null;
        }


        let article =
            extractCurrentArticle(
                wrapper.childNodes?.[0]
            );


        if (article) {
            return article;
        }


        for (
            const child of
            wrapper.childNodes
        ) {
            article =
                extractCurrentArticle(
                    child
                );

            if (article) {
                return article;
            }
        }


        return null;
    }


    function isStoryArticle(
        article
    ) {
        if (!article) {
            return false;
        }

        return (
            !article.type ||
            article.type.length <= 0 ||
            article.type === 'story'
        );
    }


    // ============================================================
    // 작품 메뉴 판별
    // ============================================================

    function isArticleMenu(
        menu
    ) {
        if (!menu) {
            return false;
        }


        const texts =
            [
                ...menu.querySelectorAll(
                    '[role="menuitem"]'
                )
            ]
            .map(
                item =>
                    item.textContent
                        ?.trim()
            );


        return (
            texts.includes(
                '수정하기'
            ) &&
            texts.includes(
                '삭제하기'
            )
        );
    }


    // ============================================================
    // 원본 작품 조회
    // ============================================================

    async function getStory(
        id
    ) {
        const result =
            await authFetch(
                'GET',

                API_BASE +
                '/crack-api/stories/me/' +
                encodeURIComponent(id)
            );


        if (
            result?.result !==
                'SUCCESS' ||
            !result.data
        ) {
            throw new Error(
                '원본 작품 데이터를 가져오지 못했습니다.'
            );
        }


        return result.data;
    }


    // ============================================================
    // 신규 Story ID 발급
    // ============================================================

    async function pullNewStoryId() {
        console.log(
            '[CrackCopy] 신규 storyId 요청'
        );


        const response =
            await authFetch(
                'POST',

                API_BASE +
                '/crack-api/temp-stories'
            );


        console.log(
            '[CrackCopy] temp-stories 응답:',
            response
        );


        /*
         * 구 SDK 기준:
         *
         * response.result = SUCCESS
         * response.data   = "24자리 ID"
         */

        let id = null;


        if (
            typeof response?.data ===
            'string'
        ) {
            id =
                response.data;
        }


        /*
         * 서버 형식이 바뀐 경우 대비
         */

        if (
            !id &&
            typeof response?.data?._id ===
            'string'
        ) {
            id =
                response.data._id;
        }


        if (
            !id &&
            typeof response?.data?.storyId ===
            'string'
        ) {
            id =
                response.data.storyId;
        }


        if (
            !id &&
            typeof response?.storyId ===
            'string'
        ) {
            id =
                response.storyId;
        }


        if (
            typeof id !== 'string' ||
            id.length === 0
        ) {
            throw new Error(
                '신규 storyId 발급에 실패했습니다.'
            );
        }


        console.log(
            '[CrackCopy] 신규 storyId:',
            id
        );


        return id;
    }


    // ============================================================
    // Situation Image
    // ============================================================

    function convertSituationImage(
        raw
    ) {
        if (
            !raw ||
            typeof raw !== 'object'
        ) {
            return raw;
        }


        return {
            situation:
                raw.situation,

            keyword:
                raw.keyword ??
                '_NOT_EXISTS',

            imageUrl:
                raw.imageUrl,

            category:
                raw.category
        };
    }


    // ============================================================
    // Keyword Book
    // ============================================================

    function convertKeywordBook(
        raw
    ) {
        if (
            !raw ||
            typeof raw !== 'object'
        ) {
            return raw;
        }


        return {
            name:
                raw.name,

            keywords:
                raw.keywords,

            prompt:
                raw.prompt
        };
    }


    // ============================================================
    // Parameter Level
    // ============================================================

    function convertParameterLevel(
        raw
    ) {
        if (
            !raw ||
            typeof raw !== 'object'
        ) {
            return raw;
        }


        return {
            name:
                raw.name,

            levelMinValue:
                raw.levelMinValue,

            levelMaxValue:
                raw.levelMaxValue,

            levelPrompt:
                raw.levelPrompt
        };
    }


    // ============================================================
    // Parameter
    // ============================================================

    function convertParameter(
        raw
    ) {
        if (
            !raw ||
            typeof raw !== 'object'
        ) {
            return raw;
        }


        const levels =
            Array.isArray(
                raw.levels
            )
                ? raw.levels
                : [];


        return {
            name:
                raw.name,

            colorHexCode:
                raw.colorHexCode,

            iconUrl:
                raw.iconUrl,

            initialValue:
                raw.initialValue,

            min:
                raw.min,

            max:
                raw.max,

            prompt:
                raw.prompt,

            unit:
                raw.unit,

            levels:
                levels.length > 0
                    ? levels.map(
                        convertParameterLevel
                    )
                    : undefined
        };
    }


    // ============================================================
    // Ending Rule
    // ============================================================

    function convertSingleCondition(
        raw
    ) {
        return {
            comparisonOperator:
                raw.comparisonOperator ??
                null,

            statName:
                raw.statName,

            type:
                raw.type,

            value:
                raw.value,

            valueType:
                raw.valueType
        };
    }


    function convertGroupedCondition(
        raw
    ) {
        return {
            type:
                raw.type,

            ruleOperator:
                raw.ruleOperator,

            rules:
                (
                    raw.rules ??
                    []
                )
                .map(
                    convertSingleCondition
                )
        };
    }


    function convertEndingRule(
        raw
    ) {
        if (
            raw?.type === 'SINGLE'
        ) {
            return convertSingleCondition(
                raw
            );
        }


        if (
            raw?.type === 'GROUP'
        ) {
            return convertGroupedCondition(
                raw
            );
        }


        /*
         * 모르는 신규 형식이면
         * 괜히 깨지지 않도록 원본 유지
         */
        return raw;
    }


    function convertEndingCondition(
        raw
    ) {
        if (!raw) {
            return undefined;
        }


        const rules =
            Array.isArray(
                raw.rules
            )
                ? raw.rules
                : [];


        return {
            turnCount:
                raw.turnCount,

            groupOperator:
                raw.groupOperator ||
                undefined,

            rules:
                rules.length > 0
                    ? rules.map(
                        convertEndingRule
                    )
                    : undefined
        };
    }


    function convertEnding(
        raw
    ) {
        return {
            baseEndingId:
                raw.baseEndingId ||
                undefined,

            name:
                raw.name,

            blurredImageUrl:
                raw.blurredImageUrl,

            imageUrl:
                raw.imageUrl,

            condition:
                convertEndingCondition(
                    raw.condition
                ),

            conditionPrompt:
                raw.conditionPrompt,

            epilogueExample:
                raw.epilogueExample ||
                undefined,

            hint:
                raw.hint ||
                undefined,

            rarity:
                raw.rarity
        };
    }


    function convertEndingContainer(
        raw
    ) {
        const endings =
            Array.isArray(
                raw?.endings
            )
                ? raw.endings
                : [];


        if (
            endings.length === 0
        ) {
            return undefined;
        }


        return {
            endings:
                endings.map(
                    convertEnding
                )
        };
    }


    // ============================================================
    // Image Matrix
    // ============================================================

    function convertImageMatrix(
        raw
    ) {
        if (!raw) {
            return undefined;
        }


        return {
            categories:
                raw.categories,

            situations:
                raw.situations
        };
    }


    // ============================================================
    // Creator Recommended Output
    // ============================================================

    function convertRecommendedOutput(
        raw
    ) {
        if (!raw) {
            return undefined;
        }


        const modelMultipliers =
            Array.isArray(
                raw.modelMultipliers
            )
                ? raw.modelMultipliers
                : [];


        const result = {
            type:
                raw.type
        };


        if (
            raw.totalMultiplier !== null &&
            raw.totalMultiplier !== undefined
        ) {
            result.totalMultiplier =
                raw.totalMultiplier;
        }


        if (
            modelMultipliers.length > 0
        ) {
            result.modelMultipliers =
                modelMultipliers.map(
                    item => ({
                        chatModelId:
                            item.chatModelId,

                        maxOutputMultiplier:
                            item.maxOutputMultiplier
                    })
                );
        }


        return result;
    }


    // ============================================================
    // StartingSet
    // ============================================================

    function convertStartingSet(
        raw
    ) {
        const situationImages =
            Array.isArray(
                raw.situationImages
            )
                ? raw.situationImages
                : [];


        const keywordBook =
            Array.isArray(
                raw.keywordBook
            )
                ? raw.keywordBook
                : [];


        const parameters =
            Array.isArray(
                raw.parameters
            )
                ? raw.parameters
                : [];


        const result = {
            /*
             * includeId=true
             *
             * baseSetId → setId
             */
            setId:
                raw.baseSetId ??
                raw.setId,

            name:
                raw.name,

            initialMessages:
                raw.initialMessages ??
                [],

            situationPrompt:
                raw.situationPrompt ??
                '',

            replySuggestions:
                raw.replySuggestions ??
                [],

            situationImages:
                situationImages.map(
                    convertSituationImage
                ),

            keywordBook:
                keywordBook.map(
                    convertKeywordBook
                ),

            parameters:
                parameters.map(
                    convertParameter
                )
        };


        const ending =
            convertEndingContainer(
                raw.ending
            );


        if (ending !== undefined) {
            result.ending =
                ending;
        }


        const imageMatrix =
            convertImageMatrix(
                raw.imageMatrix
            );


        if (
            imageMatrix !== undefined
        ) {
            result.imageMatrix =
                imageMatrix;
        }


        return result;
    }


    // ============================================================
    // 원본 → 생성 Payload
    // ============================================================

    function buildCreatePayload(
        raw,
        isAdult,
        storyId
    ) {
        let simpleDescription =
            raw.simpleDescription ??
            '';


        const description =
            raw.description ??
            '';


        const storyDetails =
            raw.storyDetails ??
            '';


        // --------------------------------------------------------
        // NeoCopy purify()
        // 원본 구현 그대로
        // --------------------------------------------------------

        if (
            simpleDescription.length === 0
        ) {
            simpleDescription =
                '여기에 간략한 설명 입력';
        }


        if (
            storyDetails.length === 0
        ) {
            simpleDescription =
                '여기에 상세 설명 입력';
        }


        if (
            description.length === 0
        ) {
            simpleDescription =
                '여기에 설명 입력';
        }


        // --------------------------------------------------------
        // promptTemplate
        // --------------------------------------------------------

        let promptTemplate =
            raw.promptTemplate;


        if (
            promptTemplate &&
            typeof promptTemplate ===
                'object'
        ) {
            promptTemplate =
                promptTemplate.template ??
                promptTemplate.templateId;
        }


        // --------------------------------------------------------
        // target
        // --------------------------------------------------------

        let target =
            raw.target;


        if (
            target &&
            typeof target ===
                'object'
        ) {
            target =
                target.type ??
                target.value ??
                target.id ??
                target.name;
        }


        // --------------------------------------------------------
        // chatType
        // --------------------------------------------------------

        let chatType =
            raw.chatType;


        if (
            chatType &&
            typeof chatType ===
                'object'
        ) {
            chatType =
                chatType.type ??
                chatType.value ??
                chatType.id ??
                chatType.name;
        }


        // --------------------------------------------------------
        // Payload
        // --------------------------------------------------------

        const payload = {
            chatExamples:
                raw.chatExamples ??
                [],

            chatModelId:
                raw.chatModelId,

            chatType:
                chatType,

            customPrompt:
                raw.customPrompt ??
                '',

            defaultCrackerModel:
                raw.defaultCrackerModel,

            description:
                description,

            detailDescription:
                raw.detailDescription ??
                '',

            genreId:
                raw.genreId ??
                raw.genre?._id,

            isCommentBlocked:
                Boolean(
                    raw.isCommentBlocked
                ),

            isMovingPortraitImage:
                Boolean(
                    raw.profileImage?.gif ??
                    raw.isMovingPortraitImage
                ),

            model:
                raw.model,

            // 제목 그대로 복사
            name:
                raw.name,

            portraitImageUrl:
                raw.portraitImage?.origin ??
                raw.profileImage?.origin ??
                'about:blank',

            promptTemplate:
                promptTemplate,

            simpleDescription:
                simpleDescription,

            startingSets:
                (
                    raw.startingSets ??
                    []
                )
                .map(
                    convertStartingSet
                ),

            storyDetails:
                storyDetails,

            tags:
                raw.tags ??
                [],

            target:
                target,

            // 항상 비공개
            visibility:
                'private',

            // 생성 시점 연령 제한
            isAdult:
                Boolean(
                    isAdult
                ),

            creatorRecommendedMaxOutput:
                convertRecommendedOutput(
                    raw.creatorRecommendedMaxOutput
                ),

            situationImageVersion:
                raw.situationImageVersion,

            // ★ 현재 Crack 생성 흐름
            storyId:
                storyId
        };


        // undefined 제거
        for (
            const key of
            Object.keys(payload)
        ) {
            if (
                payload[key] ===
                undefined
            ) {
                delete payload[key];
            }
        }


        return payload;
    }


    // ============================================================
    // 실제 작품 복사
    // ============================================================

    async function duplicateStory(
        id,
        isAdult
    ) {
        if (copying) {
            toast(
                '이미 작품을 복사하고 있습니다.'
            );

            return;
        }


        copying = true;


        try {
            toast(
                isAdult
                    ? '비공(언세이프) 복사 중...'
                    : '비공(세이프) 복사 중...'
            );


            // ----------------------------------------------------
            // 1. 원본
            // ----------------------------------------------------

            console.log(
                '[CrackCopy] 원본 ID:',
                id
            );


            const raw =
                await getStory(id);


            console.log(
                '[CrackCopy] 원본 데이터:',
                raw
            );


            // ----------------------------------------------------
            // 2. 새 작품 ID
            // ----------------------------------------------------

            const newStoryId =
                await pullNewStoryId();


            // ----------------------------------------------------
            // 3. Payload
            // ----------------------------------------------------

            const payload =
                buildCreatePayload(
                    raw,
                    isAdult,
                    newStoryId
                );


            console.log(
                '[CrackCopy] 생성 Payload:',
                payload
            );


            console.log(
                '[CrackCopy] Payload JSON:',
                JSON.stringify(
                    payload,
                    null,
                    2
                )
            );


            // ----------------------------------------------------
            // 4. 생성
            // ----------------------------------------------------

            const response =
                await authFetch(
                    'POST',

                    API_BASE +
                    '/crack-api/stories/v2',

                    payload
                );


            console.log(
                '[CrackCopy] 생성 Response:',
                response
            );


            if (
                response?.result !==
                'SUCCESS'
            ) {
                throw new Error(
                    '서버가 SUCCESS를 반환하지 않았습니다.'
                );
            }


            toast(
                isAdult
                    ? '비공(언세이프) 복사 완료'
                    : '비공(세이프) 복사 완료'
            );


            // ----------------------------------------------------
            // 5. 목록 갱신
            // ----------------------------------------------------

            history.pushState(
                null,
                '',
                location.href
            );


            dispatchEvent(
                new Event(
                    'popstate'
                )
            );

        } catch (error) {
            console.error(
                '[CrackCopy] 복사 실패:',
                error
            );


            toast(
                '작품 복사 실패\n' +
                (
                    error?.message ??
                    String(error)
                ),
                true
            );

        } finally {
            copying = false;
        }
    }


    // ============================================================
    // Radix 메뉴 Item
    // ============================================================

    function createMenuItem(
        nativeItem,
        text,
        handler
    ) {
        const item =
            nativeItem.cloneNode(
                false
            );


        item.removeAttribute(
            'id'
        );

        item.removeAttribute(
            'data-highlighted'
        );

        item.removeAttribute(
            'aria-disabled'
        );


        item.setAttribute(
            'role',
            'menuitem'
        );


        item.setAttribute(
            'tabindex',
            '-1'
        );


        item.textContent =
            text;


        item.style.cursor =
            'pointer';


        item.addEventListener(
            'pointerdown',
            event => {
                event.preventDefault();
                event.stopPropagation();
            }
        );


        item.addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                handler();
            }
        );


        return item;
    }


    // ============================================================
    // 복사 버튼 삽입
    // ============================================================

    function ensureCopyButtons(
        wrapper
    ) {
        if (
            !wrapper ||
            !wrapper.isConnected
        ) {
            return;
        }


        const menu =
            wrapper.querySelector(
                '[role="menu"][data-state="open"]'
            ) ||
            wrapper.querySelector(
                '[role="menu"]'
            );


        if (!menu) {
            return;
        }


        if (
            !isArticleMenu(
                menu
            )
        ) {
            return;
        }


        if (
            menu.querySelector(
                '[' +
                MARKER +
                '="unsafe"]'
            ) &&
            menu.querySelector(
                '[' +
                MARKER +
                '="safe"]'
            )
        ) {
            return;
        }


        const article =
            extractArticleFromWrapper(
                wrapper
            );


        if (!article) {
            return;
        }


        if (
            !isStoryArticle(
                article
            )
        ) {
            return;
        }


        console.log(
            '[CrackCopy] 스토리 메뉴 감지:',
            article
        );


        const nativeItem =
            menu.querySelector(
                '[role="menuitem"]'
            );


        if (!nativeItem) {
            return;
        }


        // 이전 커스텀 요소 제거
        menu
            .querySelectorAll(
                '[' + MARKER + ']'
            )
            .forEach(
                element =>
                    element.remove()
            );


        // --------------------------------------------------------
        // Separator
        // --------------------------------------------------------

        const separator =
            document.createElement(
                'div'
            );


        separator.setAttribute(
            MARKER,
            'separator'
        );


        separator.style.height =
            '1px';

        separator.style.width =
            'calc(100% - 12px)';

        separator.style.margin =
            '5px 6px';

        separator.style.background =
            'rgba(128,128,128,.22)';

        separator.style.pointerEvents =
            'none';


        menu.appendChild(
            separator
        );


        // --------------------------------------------------------
        // 비공(언세이프)
        // --------------------------------------------------------

        const unsafe =
            createMenuItem(
                nativeItem,

                '비공(언세이프) 복사',

                () => {
                    duplicateStory(
                        article.id,
                        true
                    );
                }
            );


        unsafe.setAttribute(
            MARKER,
            'unsafe'
        );


        menu.appendChild(
            unsafe
        );


        // --------------------------------------------------------
        // 비공(세이프)
        // --------------------------------------------------------

        const safe =
            createMenuItem(
                nativeItem,

                '비공(세이프) 복사',

                () => {
                    duplicateStory(
                        article.id,
                        false
                    );
                }
            );


        safe.setAttribute(
            MARKER,
            'safe'
        );


        menu.appendChild(
            safe
        );


        console.log(
            '[CrackCopy] 복사 메뉴 삽입 완료:',
            article.id
        );
    }


    // ============================================================
    // 메뉴 재검사
    // ============================================================

    const scheduled =
        new WeakMap();


    function scheduleEnsure(
        wrapper
    ) {
        if (!wrapper) {
            return;
        }


        const previous =
            scheduled.get(wrapper);


        if (previous) {
            for (
                const timer of previous
            ) {
                clearTimeout(timer);
            }
        }


        const timers =
            [
                0,
                16,
                40,
                80,
                160,
                300
            ]
            .map(
                delay =>
                    setTimeout(
                        () => {
                            ensureCopyButtons(
                                wrapper
                            );
                        },
                        delay
                    )
            );


        scheduled.set(
            wrapper,
            timers
        );
    }


    // ============================================================
    // 추가된 DOM 검사
    // ============================================================

    function inspectNode(
        node
    ) {
        if (
            !(node instanceof Element)
        ) {
            return;
        }


        if (
            node.matches(
                '[data-radix-popper-content-wrapper]'
            )
        ) {
            scheduleEnsure(
                node
            );
        }


        const wrappers =
            node.querySelectorAll(
                '[data-radix-popper-content-wrapper]'
            );


        for (
            const wrapper of wrappers
        ) {
            scheduleEnsure(
                wrapper
            );
        }


        const parent =
            node.closest(
                '[data-radix-popper-content-wrapper]'
            );


        if (parent) {
            scheduleEnsure(
                parent
            );
        }
    }


    // ============================================================
    // MutationObserver
    // ============================================================

    function startObserver() {
        if (
            !document.documentElement
        ) {
            setTimeout(
                startObserver,
                10
            );

            return;
        }


        const observer =
            new MutationObserver(
                mutations => {

                    if (
                        !/^\/my(?:\/.*)?$/
                            .test(
                                location.pathname
                            )
                    ) {
                        return;
                    }


                    for (
                        const mutation of
                        mutations
                    ) {
                        if (
                            mutation.type !==
                            'childList'
                        ) {
                            continue;
                        }


                        for (
                            const node of
                            mutation.addedNodes
                        ) {
                            inspectNode(
                                node
                            );
                        }


                        /*
                         * React가 커스텀 버튼을 지운 경우
                         */
                        if (
                            mutation
                                .removedNodes
                                .length > 0 &&
                            mutation.target
                                instanceof Element
                        ) {
                            const wrapper =
                                mutation.target
                                    .closest(
                                        '[data-radix-popper-content-wrapper]'
                                    );


                            if (wrapper) {
                                scheduleEnsure(
                                    wrapper
                                );
                            }
                        }
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


        document
            .querySelectorAll(
                '[data-radix-popper-content-wrapper]'
            )
            .forEach(
                wrapper =>
                    scheduleEnsure(
                        wrapper
                    )
            );


        console.log(
            '[CrackCopy] Radix 메뉴 감시 시작'
        );
    }


    startObserver();


    // ============================================================
    // Debug
    // ============================================================

    window.crackCopyDebug = {

        get tokenFound() {
            return Boolean(
                getAuthToken()
            );
        },


        getStory,


        pullNewStoryId,


        buildCreatePayload,


        duplicateStory,


        inspect() {
            return [
                ...document.querySelectorAll(
                    '[data-radix-popper-content-wrapper]'
                )
            ]
            .map(
                wrapper => ({
                    wrapper,

                    article:
                        extractArticleFromWrapper(
                            wrapper
                        ),

                    text:
                        wrapper.textContent
                })
            );
        },


        refreshMenus() {
            document
                .querySelectorAll(
                    '[data-radix-popper-content-wrapper]'
                )
                .forEach(
                    wrapper =>
                        scheduleEnsure(
                            wrapper
                        )
                );
        }
    };


    console.log(
        '[CrackCopy] 준비 완료'
    );

})();
