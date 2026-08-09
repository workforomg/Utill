// ==UserScript==
// @name         댓글 필터
// @author       지유다요
// @namespace    https://github.com/workforomg/Utill
// @version      0.3.0
// @description  댓글을 감지하여 작성자별 표시/가리기/숨기기, 필터링 목록, 사용자 메모를 제공합니다.
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
    'use strict';

    const PAGE = unsafeWindow;

    // ============================================================
    // 저장 키 / 상태
    // ============================================================

    const OLD_RULES_KEY = 'crack-comment-filter-rules-v1';
    const RULES_KEY = 'crack-comment-filter-rules-v2';
    const NOTES_KEY = 'crack-comment-filter-notes-v1';
    const PROFILES_KEY = 'crack-comment-filter-profiles-v1';
    const COLLAPSED_KEY = 'crack-comment-filter-collapsed-v1';

    const oldRules = GM_getValue(OLD_RULES_KEY, {}) || {};
    let rules = GM_getValue(RULES_KEY, oldRules) || {};
    let notes = GM_getValue(NOTES_KEY, {}) || {};
    let savedProfiles = GM_getValue(PROFILES_KEY, {}) || {};
    let collapsed = !!GM_getValue(COLLAPSED_KEY, false);

    // 기존 v1 규칙이 있으면 v2 저장소로 자동 이관
    if (Object.keys(rules).length && !Object.keys(GM_getValue(RULES_KEY, {}) || {}).length) {
        GM_setValue(RULES_KEY, rules);
    }

    // 현재 UI 상태
    let activeTab = 'current'; // current | filtered | memo
    let searchQuery = '';

    // 현재 화면/스토리에서 감지된 정보
    let activeStoryId = null;
    const commentCache = new Map();
    const currentWriterKeys = new Set();

    // 런타임 작성자 인덱스
    const writerByKey = new Map();
    const writerByWrtnUid = new Map();
    const writerByUserId = new Map();

    // ============================================================
    // 저장 유틸
    // ============================================================

    function saveRules() {
        GM_setValue(RULES_KEY, rules);
    }

    function saveNotes() {
        GM_setValue(NOTES_KEY, notes);
    }

    function saveProfiles() {
        GM_setValue(PROFILES_KEY, savedProfiles);
    }

    function normalizeText(value) {
        return String(value ?? '').replace(/\r\n/g, '\n').trim();
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function getWriterKey(writer) {
        return (
            writer?.userId ||
            writer?.wrtnUid ||
            writer?._id ||
            null
        );
    }

    function normalizeWriter(writer) {
        if (!writer || typeof writer !== 'object') return null;

        const profile = {
            _id: writer._id ?? null,
            userId: writer.userId ?? null,
            wrtnUid: writer.wrtnUid ?? null,
            nickname: writer.nickname ?? '',
            profileImage:
                writer.profileImage?.w200 ||
                writer.profileImage?.origin ||
                writer.profileImage ||
                '',
            badge: writer.badge ?? null
        };

        profile.key = getWriterKey(profile);
        return profile.key ? profile : null;
    }

    function indexWriter(writer) {
        const profile = normalizeWriter(writer);
        if (!profile) return null;

        writerByKey.set(profile.key, profile);

        if (profile.wrtnUid) {
            writerByWrtnUid.set(profile.wrtnUid, profile);
        }

        if (profile.userId) {
            writerByUserId.set(profile.userId, profile);
        }

        // 이미 필터/메모로 저장 중인 사용자는 최신 닉네임/이미지로 갱신
        if (rules[profile.key] || notes[profile.key] || savedProfiles[profile.key]) {
            savedProfiles[profile.key] = {
                _id: profile._id,
                userId: profile.userId,
                wrtnUid: profile.wrtnUid,
                nickname: profile.nickname,
                profileImage: profile.profileImage
            };
        }

        return profile;
    }

    function persistProfileForKey(key) {
        const profile = writerByKey.get(key) || savedProfiles[key];
        if (!profile) return;

        savedProfiles[key] = {
            _id: profile._id ?? null,
            userId: profile.userId ?? null,
            wrtnUid: profile.wrtnUid ?? null,
            nickname: profile.nickname ?? '',
            profileImage: profile.profileImage ?? ''
        };

        saveProfiles();
    }

    function cleanupProfileIfUnused(key) {
        if (rules[key] || notes[key]) return;
        if (!savedProfiles[key]) return;

        delete savedProfiles[key];
        saveProfiles();
    }

    function hydrateSavedProfiles() {
        for (const [key, raw] of Object.entries(savedProfiles)) {
            const profile = {
                key,
                _id: raw?._id ?? null,
                userId: raw?.userId ?? null,
                wrtnUid: raw?.wrtnUid ?? null,
                nickname: raw?.nickname ?? '',
                profileImage: raw?.profileImage ?? '',
                badge: raw?.badge ?? null
            };

            writerByKey.set(key, profile);

            if (profile.wrtnUid) {
                writerByWrtnUid.set(profile.wrtnUid, profile);
            }

            if (profile.userId) {
                writerByUserId.set(profile.userId, profile);
            }
        }
    }

    hydrateSavedProfiles();

    // ============================================================
    // 댓글 API 데이터 저장
    // ============================================================

    function saveComment(comment) {
        if (!comment || typeof comment !== 'object') return;
        if (!comment._id || !comment.writer) return;

        const writer = indexWriter(comment.writer);
        if (!writer) return;

        const data = {
            commentId: comment._id,
            storyId: comment.storyId ?? null,
            content: comment.content ?? '',
            likeCount: comment.likeCount ?? 0,
            replyCount: comment.replyCount ?? 0,
            status: comment.status ?? null,
            isCreator: !!comment.isCreator,
            isMaker: !!comment.isMaker,
            isOwner: !!comment.isOwner,
            isLiked: !!comment.isLiked,
            isBlind: !!comment.isBlind,
            createdAt: comment.createdAt ?? null,
            updatedAt: comment.updatedAt ?? null,
            writer
        };

        commentCache.set(data.commentId, data);
        currentWriterKeys.add(writer.key);
    }

    function collectComments(value, depth = 0) {
        if (depth > 8) return;

        if (Array.isArray(value)) {
            for (const item of value) {
                collectComments(item, depth + 1);
            }
            return;
        }

        if (!value || typeof value !== 'object') return;

        if (
            value._id &&
            value.writer &&
            typeof value.writer === 'object' &&
            typeof value.content === 'string'
        ) {
            saveComment(value);
        }

        for (const child of Object.values(value)) {
            if (child && typeof child === 'object') {
                collectComments(child, depth + 1);
            }
        }
    }

    // ============================================================
    // 댓글 API 감지
    // ============================================================

    function isCommentApi(urlString) {
        if (!urlString) return false;

        try {
            const url = new URL(String(urlString), location.href);

            return (
                url.hostname === 'crack-api.wrtn.ai' &&
                /\/crack-api\/stories\/[^/]+\/comments\/?$/.test(url.pathname)
            );
        } catch {
            return false;
        }
    }

    function getStoryIdFromApiUrl(urlString) {
        try {
            const url = new URL(String(urlString), location.href);
            return url.pathname.match(/\/stories\/([^/]+)\/comments\/?$/)?.[1] || null;
        } catch {
            return null;
        }
    }

    function handleCommentResponse(url, json, type) {
        try {
            const storyId = getStoryIdFromApiUrl(url);

            if (storyId && activeStoryId && storyId !== activeStoryId) {
                commentCache.clear();
                currentWriterKeys.clear();
            }

            if (storyId) {
                activeStoryId = storyId;
            }

            const before = commentCache.size;
            collectComments(json);
            const after = commentCache.size;

            // 저장 대상(필터/메모 사용자)의 최신 프로필 반영
            for (const key of new Set([...Object.keys(rules), ...Object.keys(notes)])) {
                if (writerByKey.has(key)) {
                    persistProfileForKey(key);
                }
            }

            console.log(
                `%c[Crack 댓글 필터] ${type} 댓글 API 감지`,
                'color:#00d26a;font-weight:bold;',
                url,
                `댓글 ${before} → ${after}, 작성자 ${currentWriterKeys.size}`
            );

            scheduleFilterUpdate();
            scheduleUIRender();
        } catch (error) {
            console.error('[Crack 댓글 필터] 응답 처리 실패', error);
        }
    }

    // ============================================================
    // fetch 후킹
    // ============================================================

    const nativeFetch = PAGE.fetch;

    if (typeof nativeFetch === 'function') {
        PAGE.fetch = function (...args) {
            let url = '';

            try {
                const input = args[0];
                url = typeof input === 'string' ? input : (input?.url || '');
            } catch {}

            const promise = Reflect.apply(nativeFetch, this, args);

            if (!isCommentApi(url)) {
                return promise;
            }

            promise
                .then(response => {
                    try {
                        const clone = response.clone();
                        clone.json()
                            .then(json => handleCommentResponse(url, json, 'fetch'))
                            .catch(error => {
                                console.warn('[Crack 댓글 필터] fetch JSON 분석 실패', error);
                            });
                    } catch (error) {
                        console.warn('[Crack 댓글 필터] fetch clone 실패', error);
                    }

                    return response;
                })
                .catch(() => {});

            return promise;
        };

        console.log('[Crack 댓글 필터] fetch hook 설치 완료');
    }

    // ============================================================
    // XMLHttpRequest 후킹
    // ============================================================

    const NativeXHR = PAGE.XMLHttpRequest;

    if (NativeXHR) {
        const nativeOpen = NativeXHR.prototype.open;
        const nativeSend = NativeXHR.prototype.send;

        NativeXHR.prototype.open = function (method, url, ...rest) {
            this.__crackFilterURL = String(url);
            this.__crackFilterMethod = method;
            return nativeOpen.call(this, method, url, ...rest);
        };

        NativeXHR.prototype.send = function (...args) {
            if (isCommentApi(this.__crackFilterURL)) {
                this.addEventListener(
                    'load',
                    () => {
                        try {
                            let json;

                            if (this.responseType === 'json') {
                                json = this.response;
                            } else {
                                json = JSON.parse(this.responseText);
                            }

                            handleCommentResponse(
                                this.__crackFilterURL,
                                json,
                                'XHR'
                            );
                        } catch (error) {
                            console.warn('[Crack 댓글 필터] XHR 분석 실패', error);
                        }
                    },
                    { once: true }
                );
            }

            return nativeSend.apply(this, args);
        };

        console.log('[Crack 댓글 필터] XHR hook 설치 완료');
    }

    // ============================================================
    // DOM 필터 엔진 - wrtnUid 직접 매칭
    // ============================================================

    function getCommentCards() {
        const result = new Set();

        document
            .querySelectorAll('span.whitespace-pre-line.break-all')
            .forEach(content => {
                const card = content.closest(
                    'div.border-b.border-outline_tertiary'
                );

                if (card) {
                    result.add(card);
                }
            });

        return [...result];
    }

    function getWrtnUidFromCard(card) {
        const img = card?.querySelector('img.aspect-square[alt][src]');
        if (!img?.src) return null;

        try {
            const url = new URL(img.src, location.href);
            const parts = url.pathname.split('/').filter(Boolean);
            return parts[0] || null;
        } catch {
            return null;
        }
    }

    function getWriterKeyByWrtnUid(wrtnUid) {
        if (!wrtnUid) return null;

        const writer = writerByWrtnUid.get(wrtnUid);
        if (writer) {
            return getWriterKey(writer);
        }

        // 예전 데이터가 wrtnUid 자체를 key로 저장했을 가능성 대응
        if (rules[wrtnUid] || notes[wrtnUid] || savedProfiles[wrtnUid]) {
            return wrtnUid;
        }

        return null;
    }

    function applyFilterToCard(card) {
        if (!card) return;

        card.classList.remove(
            'tm-crack-comment-blur',
            'tm-crack-comment-hide'
        );

        const wrtnUid = getWrtnUidFromCard(card);
        if (!wrtnUid) return;

        card.dataset.tmWrtnUid = wrtnUid;

        const key = getWriterKeyByWrtnUid(wrtnUid);
        if (!key) return;

        card.dataset.tmWriterKey = key;

        if (!currentWriterKeys.has(key)) {
            currentWriterKeys.add(key);
            scheduleUIRender();
        }

        const mode = rules[key] || 'show';

        if (mode === 'blur') {
            card.classList.add('tm-crack-comment-blur');
        } else if (mode === 'hide') {
            card.classList.add('tm-crack-comment-hide');
        }
    }

    function applyFilters() {
        if (!document.body) return;
        injectPageStyle();

        for (const card of getCommentCards()) {
            applyFilterToCard(card);
        }
    }

    function applyWriterImmediately(key, mode) {
        const targetWriter = writerByKey.get(key) || savedProfiles[key];
        const targetWrtnUid = targetWriter?.wrtnUid;

        if (!targetWrtnUid) {
            applyFilters();
            return;
        }

        for (const card of getCommentCards()) {
            const cardUid = getWrtnUidFromCard(card);
            if (cardUid !== targetWrtnUid) continue;

            card.classList.remove(
                'tm-crack-comment-blur',
                'tm-crack-comment-hide'
            );

            card.dataset.tmWrtnUid = targetWrtnUid;
            card.dataset.tmWriterKey = key;

            if (mode === 'blur') {
                card.classList.add('tm-crack-comment-blur');
            } else if (mode === 'hide') {
                card.classList.add('tm-crack-comment-hide');
            }
        }
    }

    // ============================================================
    // 페이지 스타일
    // ============================================================

    function injectPageStyle() {
        if (document.getElementById('tm-crack-comment-filter-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'tm-crack-comment-filter-style';

        style.textContent = `
            .tm-crack-comment-blur {
                position: relative !important;
                min-height: 60px;
            }

            .tm-crack-comment-blur > div {
                filter: blur(7px) !important;
                opacity: 0.25 !important;
                pointer-events: none !important;
                user-select: none !important;
            }

            .tm-crack-comment-blur::after {
                content: "가려진 댓글";
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                z-index: 999;
                padding: 4px 8px;
                border-radius: 7px;
                background: rgba(20, 20, 22, .78);
                color: rgba(255, 255, 255, .92);
                font-size: 12px;
                font-weight: 600;
                pointer-events: none;
                white-space: nowrap;
            }

            .tm-crack-comment-hide {
                display: none !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    // ============================================================
    // UI 데이터
    // ============================================================

    function getProfileForKey(key) {
        const profile = writerByKey.get(key) || savedProfiles[key];

        if (profile) {
            return {
                key,
                _id: profile._id ?? null,
                userId: profile.userId ?? null,
                wrtnUid: profile.wrtnUid ?? null,
                nickname: profile.nickname ?? '',
                profileImage: profile.profileImage ?? ''
            };
        }

        return {
            key,
            _id: null,
            userId: key,
            wrtnUid: null,
            nickname: '알 수 없는 사용자',
            profileImage: ''
        };
    }

    function getTabKeys() {
        if (activeTab === 'filtered') {
            return Object.keys(rules).filter(key => {
                const mode = rules[key];
                return mode === 'blur' || mode === 'hide';
            });
        }

        if (activeTab === 'memo') {
            return Object.keys(notes).filter(key => normalizeText(notes[key]));
        }

        return [...currentWriterKeys];
    }

    function compareWriterKeys(a, b) {
        const aMode = rules[a] || 'show';
        const bMode = rules[b] || 'show';

        const aFiltered = aMode === 'show' ? 0 : 1;
        const bFiltered = bMode === 'show' ? 0 : 1;

        if (aFiltered !== bFiltered) {
            return bFiltered - aFiltered;
        }

        const aName = getProfileForKey(a).nickname || '';
        const bName = getProfileForKey(b).nickname || '';

        return aName.localeCompare(bName, 'ko');
    }

    function getFilteredCount() {
        return Object.values(rules).filter(
            mode => mode === 'blur' || mode === 'hide'
        ).length;
    }

    function getMemoCount() {
        return Object.values(notes).filter(value => normalizeText(value)).length;
    }

    // ============================================================
    // UI
    // ============================================================

    let uiHost = null;
    let uiRoot = null;

    function createUI() {
        if (!document.body || uiHost) return;

        uiHost = document.createElement('div');
        uiHost.id = 'tm-crack-comment-filter-ui';

        uiRoot = uiHost.attachShadow({ mode: 'open' });
        document.body.appendChild(uiHost);

        renderUI();
    }

    function renderUI() {
        if (!uiRoot) return;

        const filteredCount = getFilteredCount();
        const memoCount = getMemoCount();

        if (collapsed) {
            uiRoot.innerHTML = `
                <style>
                    * { box-sizing: border-box; }
                    button {
                        font-family: Pretendard, Arial, sans-serif;
                    }
                    #open {
                        position: fixed;
                        left: 14px;
                        bottom: 14px;
                        z-index: 2147483647;
                        min-width: 72px;
                        height: 38px;
                        padding: 0 13px;
                        border: 1px solid rgba(128,128,128,.35);
                        border-radius: 12px;
                        background: rgba(25,25,28,.95);
                        color: white;
                        box-shadow: 0 5px 20px rgba(0,0,0,.25);
                        cursor: pointer;
                        font-size: 12px;
                        font-weight: 700;
                    }
                </style>

                <button id="open">
                    댓글 필터${filteredCount ? ` ${filteredCount}` : ''}
                </button>
            `;

            uiRoot.getElementById('open')?.addEventListener('click', () => {
                collapsed = false;
                GM_setValue(COLLAPSED_KEY, false);
                renderUI();
            });

            return;
        }

        const keys = getTabKeys().sort(compareWriterKeys);

        const rows = keys.map(key => {
            const writer = getProfileForKey(key);
            const mode = rules[key] || 'show';
            const note = notes[key] || '';
            const nickname = writer.nickname || '(닉네임 없음)';
            const uidText = writer.userId || writer.wrtnUid || key;
            const profile = writer.profileImage || '';

            let stateText = '표시';
            if (mode === 'blur') stateText = '가리기';
            if (mode === 'hide') stateText = '숨김';

            const searchText = [
                nickname,
                uidText,
                writer.wrtnUid || '',
                note,
                stateText
            ].join(' ').toLowerCase();

            return `
                <div
                    class="writer"
                    data-writer-key="${escapeHtml(key)}"
                    data-search="${escapeHtml(searchText)}"
                >
                    <div class="writer-main">
                        ${
                            profile
                                ? `<img class="avatar" src="${escapeHtml(profile)}" alt="">`
                                : `<div class="avatar avatar-empty"></div>`
                        }

                        <div class="writer-info">
                            <div class="writer-topline">
                                <div class="nickname" title="${escapeHtml(nickname)}">
                                    ${escapeHtml(nickname)}
                                </div>

                                ${
                                    mode !== 'show'
                                        ? `<span class="state ${mode}">${stateText}</span>`
                                        : ''
                                }

                                ${
                                    note
                                        ? `<span class="memo-dot" title="메모 있음">M</span>`
                                        : ''
                                }
                            </div>

                            <div class="uid" title="${escapeHtml(uidText)}">
                                ${escapeHtml(uidText)}
                            </div>

                            ${
                                note
                                    ? `<div class="note-preview" title="${escapeHtml(note)}">${escapeHtml(note)}</div>`
                                    : ''
                            }
                        </div>

                        <select class="mode" data-key="${escapeHtml(key)}">
                            <option value="show" ${mode === 'show' ? 'selected' : ''}>표시</option>
                            <option value="blur" ${mode === 'blur' ? 'selected' : ''}>가리기</option>
                            <option value="hide" ${mode === 'hide' ? 'selected' : ''}>숨기기</option>
                        </select>

                        <button
                            class="memo-toggle ${note ? 'has-note' : ''}"
                            data-key="${escapeHtml(key)}"
                            type="button"
                        >
                            메모
                        </button>
                    </div>

                    <div class="memo-editor" data-key="${escapeHtml(key)}">
                        <textarea
                            class="memo-textarea"
                            maxlength="500"
                            placeholder="이 사용자에 대한 메모를 입력하세요."
                        >${escapeHtml(note)}</textarea>

                        <div class="memo-actions">
                            <span class="memo-hint">브라우저에만 저장됩니다.</span>
                            <button class="memo-clear" data-key="${escapeHtml(key)}" type="button">삭제</button>
                            <button class="memo-cancel" data-key="${escapeHtml(key)}" type="button">닫기</button>
                            <button class="memo-save" data-key="${escapeHtml(key)}" type="button">저장</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const emptyText =
            activeTab === 'filtered'
                ? '현재 필터링 중인 사용자가 없습니다.'
                : activeTab === 'memo'
                    ? '저장된 사용자 메모가 없습니다.'
                    : '아직 현재 댓글 작성자가 감지되지 않았습니다.';

        uiRoot.innerHTML = `
            <style>
                * { box-sizing: border-box; }

                button, input, textarea, select {
                    font-family: Pretendard, Arial, sans-serif;
                }

                #panel {
                    position: fixed;
                    left: 14px;
                    bottom: 14px;
                    z-index: 2147483647;
                    width: 390px;
                    max-height: min(650px, calc(100vh - 28px));
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    border: 1px solid rgba(128,128,128,.30);
                    border-radius: 14px;
                    background: rgba(25,25,28,.97);
                    color: #f5f5f5;
                    box-shadow: 0 8px 30px rgba(0,0,0,.30);
                    backdrop-filter: blur(14px);
                }

                #header {
                    height: 46px;
                    padding: 0 12px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    border-bottom: 1px solid rgba(255,255,255,.08);
                    flex-shrink: 0;
                }

                #title {
                    font-size: 13px;
                    font-weight: 700;
                }

                #collapse {
                    width: 28px;
                    height: 28px;
                    border: 0;
                    border-radius: 8px;
                    background: rgba(255,255,255,.08);
                    color: white;
                    cursor: pointer;
                }

                #stats {
                    padding: 8px 12px;
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                    font-size: 11px;
                    color: rgba(255,255,255,.60);
                    border-bottom: 1px solid rgba(255,255,255,.07);
                    flex-shrink: 0;
                }

                #tabs {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 5px;
                    padding: 8px 8px 0;
                    flex-shrink: 0;
                }

                .tab {
                    height: 31px;
                    border: 1px solid rgba(255,255,255,.08);
                    border-radius: 8px;
                    background: rgba(255,255,255,.04);
                    color: rgba(255,255,255,.60);
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: 600;
                }

                .tab.active {
                    background: rgba(255,255,255,.12);
                    color: #fff;
                    border-color: rgba(255,255,255,.16);
                }

                #controls {
                    padding: 8px;
                    flex-shrink: 0;
                }

                #search {
                    width: 100%;
                    height: 34px;
                    padding: 0 10px;
                    outline: none;
                    border: 1px solid rgba(255,255,255,.10);
                    border-radius: 8px;
                    background: rgba(255,255,255,.06);
                    color: white;
                }

                #search::placeholder {
                    color: rgba(255,255,255,.35);
                }

                #list {
                    overflow-y: auto;
                    min-height: 44px;
                    padding: 0 8px 8px;
                    overscroll-behavior: contain;
                }

                .writer {
                    padding: 7px 4px;
                    border-bottom: 1px solid rgba(255,255,255,.06);
                }

                .writer.hidden-by-search {
                    display: none;
                }

                .writer-main {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-height: 46px;
                }

                .avatar {
                    width: 32px;
                    height: 32px;
                    flex-shrink: 0;
                    border-radius: 50%;
                    object-fit: cover;
                    background: rgba(255,255,255,.08);
                }

                .avatar-empty {
                    border: 1px solid rgba(255,255,255,.08);
                }

                .writer-info {
                    flex: 1;
                    min-width: 0;
                }

                .writer-topline {
                    display: flex;
                    align-items: center;
                    min-width: 0;
                    gap: 5px;
                }

                .nickname {
                    min-width: 0;
                    overflow: hidden;
                    font-size: 12px;
                    font-weight: 650;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                }

                .uid {
                    margin-top: 2px;
                    overflow: hidden;
                    font-size: 9px;
                    color: rgba(255,255,255,.35);
                    white-space: nowrap;
                    text-overflow: ellipsis;
                }

                .state,
                .memo-dot {
                    flex-shrink: 0;
                    border-radius: 5px;
                    padding: 2px 5px;
                    font-size: 9px;
                    font-weight: 700;
                }

                .state.blur {
                    background: rgba(255,193,7,.15);
                    color: rgba(255,215,100,.95);
                }

                .state.hide {
                    background: rgba(255,87,87,.15);
                    color: rgba(255,130,130,.95);
                }

                .memo-dot {
                    padding: 2px 4px;
                    background: rgba(120,150,255,.16);
                    color: rgba(165,185,255,.95);
                }

                .note-preview {
                    margin-top: 4px;
                    max-width: 100%;
                    overflow: hidden;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                    font-size: 10px;
                    color: rgba(255,255,255,.58);
                }

                .mode {
                    width: 68px;
                    height: 29px;
                    flex-shrink: 0;
                    padding: 0 4px;
                    outline: none;
                    border: 1px solid rgba(255,255,255,.10);
                    border-radius: 7px;
                    background: rgb(42,42,46);
                    color: white;
                    font-size: 11px;
                }

                .memo-toggle {
                    height: 29px;
                    flex-shrink: 0;
                    padding: 0 8px;
                    border: 1px solid rgba(255,255,255,.10);
                    border-radius: 7px;
                    background: rgba(255,255,255,.05);
                    color: rgba(255,255,255,.72);
                    cursor: pointer;
                    font-size: 10px;
                }

                .memo-toggle.has-note {
                    border-color: rgba(135,160,255,.30);
                    background: rgba(120,150,255,.10);
                    color: rgba(190,205,255,.96);
                }

                .memo-editor {
                    display: none;
                    padding: 7px 0 2px 40px;
                }

                .memo-editor.open {
                    display: block;
                }

                .memo-textarea {
                    width: 100%;
                    min-height: 72px;
                    max-height: 150px;
                    resize: vertical;
                    padding: 8px 9px;
                    outline: none;
                    border: 1px solid rgba(255,255,255,.10);
                    border-radius: 8px;
                    background: rgba(255,255,255,.05);
                    color: white;
                    font-size: 11px;
                    line-height: 1.45;
                }

                .memo-textarea::placeholder {
                    color: rgba(255,255,255,.30);
                }

                .memo-actions {
                    margin-top: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: 5px;
                }

                .memo-hint {
                    margin-right: auto;
                    font-size: 9px;
                    color: rgba(255,255,255,.30);
                }

                .memo-actions button {
                    height: 26px;
                    padding: 0 8px;
                    border: 0;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 10px;
                }

                .memo-clear,
                .memo-cancel {
                    background: rgba(255,255,255,.06);
                    color: rgba(255,255,255,.65);
                }

                .memo-save {
                    background: rgba(255,255,255,.15);
                    color: white;
                }

                #empty {
                    padding: 22px 12px;
                    text-align: center;
                    color: rgba(255,255,255,.42);
                    font-size: 11px;
                    line-height: 1.5;
                }

                #footer {
                    padding: 8px;
                    display: flex;
                    gap: 6px;
                    border-top: 1px solid rgba(255,255,255,.07);
                    flex-shrink: 0;
                }

                #reset {
                    width: 100%;
                    height: 31px;
                    border: 0;
                    border-radius: 7px;
                    background: rgba(255,255,255,.07);
                    color: rgba(255,255,255,.75);
                    cursor: pointer;
                    font-size: 11px;
                }

                @media (max-width: 520px) {
                    #panel {
                        width: calc(100vw - 28px);
                        max-height: min(620px, calc(100vh - 28px));
                    }
                }
            </style>

            <div id="panel">
                <div id="header">
                    <div id="title">댓글 필터</div>
                    <button id="collapse" type="button">‹</button>
                </div>

                <div id="stats">
                    <span>댓글 ${commentCache.size}</span>
                    <span>현재 작성자 ${currentWriterKeys.size}</span>
                    <span>필터 ${filteredCount}</span>
                    <span>메모 ${memoCount}</span>
                </div>

                <div id="tabs">
                    <button class="tab ${activeTab === 'current' ? 'active' : ''}" data-tab="current" type="button">
                        현재 댓글
                    </button>
                    <button class="tab ${activeTab === 'filtered' ? 'active' : ''}" data-tab="filtered" type="button">
                        필터링 ${filteredCount ? `(${filteredCount})` : ''}
                    </button>
                    <button class="tab ${activeTab === 'memo' ? 'active' : ''}" data-tab="memo" type="button">
                        메모 ${memoCount ? `(${memoCount})` : ''}
                    </button>
                </div>

                <div id="controls">
                    <input
                        id="search"
                        value="${escapeHtml(searchQuery)}"
                        placeholder="닉네임 · ID · 메모 검색"
                        autocomplete="off"
                    >
                </div>

                <div id="list">
                    ${rows || `<div id="empty">${emptyText}</div>`}
                </div>

                <div id="footer">
                    <button id="reset" type="button">필터 전체 해제</button>
                </div>
            </div>
        `;

        bindUIEvents();
        applySearchFilter();
    }

    function bindUIEvents() {
        if (!uiRoot) return;

        uiRoot.getElementById('collapse')?.addEventListener('click', () => {
            collapsed = true;
            GM_setValue(COLLAPSED_KEY, true);
            renderUI();
        });

        uiRoot.querySelectorAll('.tab').forEach(button => {
            button.addEventListener('click', () => {
                activeTab = button.dataset.tab || 'current';
                renderUI();
            });
        });

        const search = uiRoot.getElementById('search');

        search?.addEventListener('input', () => {
            searchQuery = search.value;
            applySearchFilter();
        });

        uiRoot.querySelectorAll('.mode').forEach(select => {
            select.addEventListener('change', event => {
                const key = event.target.dataset.key;
                const mode = event.target.value;

                if (!key) return;

                if (mode === 'show') {
                    delete rules[key];
                } else {
                    rules[key] = mode;
                    persistProfileForKey(key);
                }

                saveRules();
                cleanupProfileIfUnused(key);

                // 현재 DOM에 즉시 반영
                applyWriterImmediately(key, mode);

                requestAnimationFrame(() => {
                    applyFilters();
                    requestAnimationFrame(applyFilters);
                });

                renderUI();
            });
        });

        uiRoot.querySelectorAll('.memo-toggle').forEach(button => {
            button.addEventListener('click', () => {
                const key = button.dataset.key;
                const row = button.closest('.writer');
                const editor = row?.querySelector(`.memo-editor[data-key="${cssEscape(key)}"]`);

                // querySelector 이스케이프가 어려운 특수 key에도 대응
                const safeEditor = editor || [...row.querySelectorAll('.memo-editor')]
                    .find(item => item.dataset.key === key);

                if (!safeEditor) return;

                safeEditor.classList.toggle('open');

                if (safeEditor.classList.contains('open')) {
                    safeEditor.querySelector('.memo-textarea')?.focus();
                }
            });
        });

        uiRoot.querySelectorAll('.memo-cancel').forEach(button => {
            button.addEventListener('click', () => {
                const row = button.closest('.writer');
                row?.querySelector('.memo-editor')?.classList.remove('open');
            });
        });

        uiRoot.querySelectorAll('.memo-save').forEach(button => {
            button.addEventListener('click', () => {
                const key = button.dataset.key;
                const row = button.closest('.writer');
                const textarea = row?.querySelector('.memo-textarea');

                if (!key || !textarea) return;

                const value = normalizeText(textarea.value);

                if (value) {
                    notes[key] = value.slice(0, 500);
                    persistProfileForKey(key);
                } else {
                    delete notes[key];
                }

                saveNotes();
                cleanupProfileIfUnused(key);
                renderUI();
            });
        });

        uiRoot.querySelectorAll('.memo-clear').forEach(button => {
            button.addEventListener('click', () => {
                const key = button.dataset.key;
                if (!key) return;

                delete notes[key];
                saveNotes();
                cleanupProfileIfUnused(key);
                renderUI();
            });
        });

        uiRoot.getElementById('reset')?.addEventListener('click', () => {
            if (!Object.keys(rules).length) return;

            const ok = PAGE.confirm
                ? PAGE.confirm('모든 댓글 필터를 해제할까요? 사용자 메모는 유지됩니다.')
                : true;

            if (!ok) return;

            const previousKeys = Object.keys(rules);
            rules = {};
            saveRules();

            for (const key of previousKeys) {
                cleanupProfileIfUnused(key);
            }

            applyFilters();
            renderUI();
        });
    }

    function cssEscape(value) {
        if (PAGE.CSS?.escape) {
            return PAGE.CSS.escape(String(value ?? ''));
        }

        return String(value ?? '').replace(/["\\]/g, '\\$&');
    }

    function applySearchFilter() {
        if (!uiRoot) return;

        const query = normalizeText(searchQuery).toLowerCase();

        uiRoot.querySelectorAll('.writer').forEach(row => {
            const text = row.dataset.search || '';
            row.classList.toggle(
                'hidden-by-search',
                !!query && !text.includes(query)
            );
        });
    }

    // ============================================================
    // 업데이트 스케줄러
    // ============================================================

    let filterUpdateQueued = false;
    let uiRenderTimer = null;

    function scheduleFilterUpdate() {
        if (filterUpdateQueued) return;

        filterUpdateQueued = true;

        requestAnimationFrame(() => {
            filterUpdateQueued = false;
            applyFilters();
        });
    }

    function scheduleUIRender() {
        if (uiRenderTimer) {
            clearTimeout(uiRenderTimer);
        }

        uiRenderTimer = setTimeout(() => {
            uiRenderTimer = null;
            if (!document.body) return;

            createUI();
            renderUI();
        }, 100);
    }

    // ============================================================
    // React DOM 변경 실시간 감지
    // ============================================================

    function startObserver() {
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (
                    mutation.type === 'childList' ||
                    mutation.type === 'attributes'
                ) {
                    scheduleFilterUpdate();
                    return;
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src']
        });

        console.log('[Crack 댓글 필터] DOM 실시간 감시 시작');
    }

    // React가 기존 노드를 재사용하는 경우를 위한 가벼운 보정
    function startFallbackSync() {
        setInterval(() => {
            if (!document.hidden) {
                applyFilters();
            }
        }, 1000);
    }

    // ============================================================
    // SPA 이동 보정
    // ============================================================

    function startRouteWatcher() {
        let lastHref = location.href;

        setInterval(() => {
            if (location.href === lastHref) return;

            lastHref = location.href;
            activeStoryId = null;
            commentCache.clear();
            currentWriterKeys.clear();

            scheduleFilterUpdate();
            scheduleUIRender();
        }, 700);
    }

    // ============================================================
    // 초기 실행
    // ============================================================

    function init() {
        injectPageStyle();
        createUI();
        applyFilters();
        startObserver();
        startFallbackSync();
        startRouteWatcher();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
