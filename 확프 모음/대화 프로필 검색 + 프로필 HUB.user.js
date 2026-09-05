// ==UserScript==
// @name         대화 프로필 허브 + 검색 통합
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @author       지유지요
// @description  프로필 관리·즐겨찾기·허브와 작품 상세페이지 프로필 검색·정보 표시 통합
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(() => {
    "use strict";

    const STYLE_ID = "cph-profile-style";
    const TOP_ID = "cph-top";
    const SEARCH_ID = "cph-search";
    const FAVORITE_HEADER_ID = "cph-favorite-header";
    const ALL_HEADER_ID = "cph-all-header";
    const FAVORITE_SCROLL_ID = "cph-favorite-scroll";
    const HUB_ID = "cph-hub-modal";
    const SHARE_ID = "cph-share-modal";
    const DELETE_ID = "cph-delete-modal";
    const FAVORITE_KEY = "crack_chat_profile_favorites_v7";
    const LEGACY_FAVORITE_KEY = "crack_chat_profile_favorites_v6";
    const LEGACY_FAVORITE_PREFIX = "legacy-v6:";
    const PROFILE_ORDER_KEY = "crack_chat_profile_order_v1";
    const SHARE_OWNER_KEY = "crack_profile_hub_owner_tokens_v1";
    const WORKER_BASE_URL = "https://userprofile.jiyujiyo.com";
    const SHARE_TAGS = Object.freeze(["여캐플", "남캐플", "혼성", "인외", "기타"]);
    const SHARE_PASSWORD_MIN_LENGTH = 8;
    const SHARE_PASSWORD_MAX_LENGTH = 128;

    const OWNED_SELECTOR = '[data-cph-owned="true"]';

    let favorites = loadFavorites();
    let expandedTarget = null;
    let profiles = [];
    let currentRoot = null;
    let currentContent = null;
    let currentList = null;
    let currentAddButton = null;
    let renderSignature = "";
    let observerTimer = null;
    let bodyOverflowBeforeHub = "";
    let bodyOverflowBeforeShare = "";
    let activeNativeProxyCleanup = null;
    let hubProfiles = [];
    let hubExpandedId = null;
    let hubLoadController = null;
    let hubActionBusy = false;

    function isProfileRoute() {
        const url = new URL(location.href);

        return url.pathname === "/setting/chat"
            && url.searchParams.get("menu") === "chat_profile";
    }

    function loadFavorites() {
        try {
            const current = localStorage.getItem(FAVORITE_KEY);
            if (current !== null) {
                const parsed = JSON.parse(current);
                return new Set(Array.isArray(parsed) ? parsed : []);
            }

            const legacy = JSON.parse(localStorage.getItem(LEGACY_FAVORITE_KEY) || "[]");
            return new Set(Array.isArray(legacy)
                ? legacy.map(key => `${LEGACY_FAVORITE_PREFIX}${key}`)
                : []
            );
        } catch {
            return new Set();
        }
    }

    function saveFavorites() {
        try {
            localStorage.setItem(FAVORITE_KEY, JSON.stringify([...favorites]));
        } catch (error) {
            console.warn("[ProfileHub] 즐겨찾기 저장 실패", error);
        }
    }

    function saveProfileOrderSnapshot(profileList = profiles) {
        if (!Array.isArray(profileList) || !profileList.length) return;

        try {
            localStorage.setItem(PROFILE_ORDER_KEY, JSON.stringify({
                names: profileList.map(profile => profile.name),
                favoriteIndexes: profileList.flatMap((profile, index) =>
                    favorites.has(profile.key) ? [index] : []
                )
            }));
        } catch (error) {
            console.warn("[ProfileHub] 프로필 순서 저장 실패", error);
        }
    }

    function loadProfileOrderSnapshot() {
        try {
            const parsed = JSON.parse(localStorage.getItem(PROFILE_ORDER_KEY) || "null");
            if (!parsed || !Array.isArray(parsed.names)
                || !Array.isArray(parsed.favoriteIndexes)) return null;

            return {
                names: parsed.names.map(name => String(name || "").trim()),
                favoriteIndexes: parsed.favoriteIndexes
                    .map(Number)
                    .filter(Number.isSafeInteger)
            };
        } catch {
            return null;
        }
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            @media (min-width: 768px) {
                .cph-page-wide {
                    width: 100% !important;
                    max-width: 1180px !important;
                }
            }

            #${TOP_ID} {
                display: flex;
                width: 100%;
                gap: 8px;
            }

            #${TOP_ID} > button {
                flex: 1 1 0;
                min-width: 0;
            }

            .cph-content {
                width: 100%;
                min-width: 0;
            }

            #${SEARCH_ID} {
                grid-area: search;
                width: 100%;
                height: 44px;
                box-sizing: border-box;
                padding: 0 14px;
                outline: none;
            }

            #${SEARCH_ID}::placeholder {
                color: var(--text_secondary, currentColor);
            }

            #${FAVORITE_HEADER_ID} {
                grid-area: favorite-header;
            }

            #${ALL_HEADER_ID} {
                grid-area: all-header;
            }

            .cph-section-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                min-width: 0;
                height: 28px;
                padding: 0 2px;
                box-sizing: border-box;
            }

            .cph-count {
                font-size: 12px;
                opacity: .65;
            }

            #${FAVORITE_SCROLL_ID},
            .cph-original-list {
                min-width: 0;
                overflow-y: auto;
                overflow-x: hidden;
                box-sizing: border-box;
                padding-right: 4px !important;
                overscroll-behavior: contain;
                scrollbar-width: thin;
            }

            #${FAVORITE_SCROLL_ID}::-webkit-scrollbar,
            .cph-original-list::-webkit-scrollbar {
                width: 5px;
            }

            #${FAVORITE_SCROLL_ID}::-webkit-scrollbar-track,
            .cph-original-list::-webkit-scrollbar-track {
                background: transparent;
            }

            #${FAVORITE_SCROLL_ID}::-webkit-scrollbar-thumb,
            .cph-original-list::-webkit-scrollbar-thumb {
                border-radius: 999px;
                background: rgba(128, 128, 128, .35);
            }

            #${FAVORITE_SCROLL_ID} {
                grid-area: favorites;
                display: flex;
                flex-direction: column;
                width: 100%;
                gap: 8px;
            }

            .cph-original-list {
                grid-area: all-profiles;
                display: grid !important;
                width: 100% !important;
                padding-bottom: 0 !important;
                gap: 10px !important;
                align-content: start;
                align-items: start;
            }

            .cph-profile-card,
            .cph-favorite-card {
                position: relative;
                min-width: 0;
                transition: background-color .12s ease;
            }

            .cph-profile-card > div:first-child > div:first-child {
                min-width: 0;
                padding-right: 34px;
            }

            .cph-profile-card .cph-profile-info,
            .cph-favorite-card .cph-profile-info {
                display: block;
                width: 100%;
                min-width: 0;
                margin: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap !important;
                cursor: pointer;
            }

            .cph-profile-card .cph-profile-info:hover,
            .cph-favorite-card .cph-profile-info:hover {
                text-decoration: underline;
                text-underline-offset: 2px;
            }

            .cph-profile-card.cph-expanded-profile,
            .cph-favorite-card.cph-expanded-profile {
                align-self: start;
            }

            .cph-profile-card.cph-expanded-profile .cph-profile-info,
            .cph-favorite-card.cph-expanded-profile .cph-profile-info {
                margin-top: 4px;
                padding-top: 10px;
                border-top: 1px solid rgba(128, 128, 128, .22);
                overflow: visible;
                text-overflow: clip;
                white-space: pre-wrap !important;
                overflow-wrap: anywhere;
                word-break: break-word;
                line-height: 1.55;
            }

            .cph-original-list .cph-profile-card.cph-expanded-profile {
                grid-column: 1 / -1;
            }

            .cph-star {
                position: absolute;
                top: 15px;
                right: 48px;
                z-index: 2;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                padding: 0;
                border: 0;
                border-radius: 9999px;
                background: transparent;
                color: var(--text_secondary);
                cursor: pointer;
                font-size: 20px;
                line-height: 1;
            }

            .cph-star:hover {
                background: var(--accent, rgba(128, 128, 128, .14));
            }

            .cph-star.is-favorite {
                color: #f2c94c;
            }

            [role="listbox"] [role="option"].cph-select-favorite {
                padding-left: 30px !important;
            }

            [role="listbox"] [role="option"].cph-select-favorite::before {
                content: "★";
                position: absolute;
                left: 9px;
                top: 50%;
                transform: translateY(-50%);
                color: #f2c94c;
                font-size: 14px;
                line-height: 1;
                pointer-events: none;
            }

            [role="listbox"] [role="option"].cph-select-favorite-last {
                margin-bottom: 5px;
                border-bottom: 1px solid rgba(128, 128, 128, .24);
                border-bottom-left-radius: 0;
                border-bottom-right-radius: 0;
            }

            .cph-favorite-card {
                display: flex;
                flex-direction: column;
                width: 100%;
                gap: 6px;
                padding: 12px 76px 12px 12px;
                box-sizing: border-box;
                border-radius: 8px;
                cursor: pointer;
            }

            .cph-favorite-card .cph-name-row {
                display: flex;
                align-items: center;
                min-width: 0;
                gap: 5px;
            }

            .cph-favorite-card .cph-name {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .cph-native-proxy {
                position: absolute !important;
                top: 12px !important;
                right: 8px !important;
                margin: 0 !important;
                z-index: 2;
            }

            .cph-empty {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 80px;
                padding: 12px;
                box-sizing: border-box;
                border-radius: 8px;
                text-align: center;
            }

            .cph-filter-hidden,
            .cph-original-add {
                display: none !important;
            }

            #${SHARE_ID} {
                position: fixed;
                inset: 0;
                z-index: 2147483100;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                box-sizing: border-box;
                background: rgba(0, 0, 0, .68);
            }

            #${SHARE_ID} .cph-share-panel {
                display: flex;
                flex-direction: column;
                width: min(520px, calc(100vw - 40px));
                max-height: min(760px, calc(100vh - 40px));
                overflow: hidden;
                border-radius: 16px;
            }

            #${SHARE_ID} .cph-share-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                min-height: 64px;
                padding: 0 20px;
                box-sizing: border-box;
            }

            #${SHARE_ID} .cph-hub-close {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                padding: 0;
                border: 0;
                border-radius: 9999px;
                color: inherit;
                background: transparent;
                font-size: 25px;
                line-height: 1;
                cursor: pointer;
            }

            #${SHARE_ID} .cph-share-body {
                display: flex;
                flex-direction: column;
                gap: 16px;
                padding: 20px;
                overflow-y: auto;
            }

            #${SHARE_ID} .cph-share-preview {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 14px;
                border-radius: 8px;
            }

            #${SHARE_ID} .cph-share-information {
                max-height: 150px;
                margin: 0;
                overflow-y: auto;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                line-height: 1.5;
            }

            #${SHARE_ID} .cph-share-tags {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
            }

            #${SHARE_ID} .cph-share-tag {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
                min-height: 42px;
                padding: 0 12px;
                box-sizing: border-box;
                border: 1px solid rgba(128, 128, 128, .28);
                border-radius: 8px;
                cursor: pointer;
            }

            #${SHARE_ID} .cph-share-tag:hover {
                background: var(--accent, rgba(128, 128, 128, .14));
            }

            #${SHARE_ID} .cph-share-tag input {
                width: 17px;
                height: 17px;
                margin: 0;
                accent-color: #7c5cff;
            }

            #${SHARE_ID} .cph-share-passwords {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
            }

            #${SHARE_ID} .cph-share-password-label {
                display: flex;
                flex-direction: column;
                gap: 7px;
                min-width: 0;
                font-size: 13px;
            }

            #${SHARE_ID} .cph-share-password-input {
                width: 100%;
                height: 42px;
                padding: 0 12px;
                box-sizing: border-box;
                border: 1px solid rgba(128, 128, 128, .35);
                border-radius: 8px;
                color: inherit;
                background: transparent;
                outline: none;
            }

            #${SHARE_ID} .cph-share-password-input:focus {
                border-color: var(--ring, #7c5cff);
                box-shadow: 0 0 0 2px rgba(124, 92, 255, .18);
            }

            #${SHARE_ID} .cph-share-message {
                min-height: 20px;
                margin: 0;
                font-size: 13px;
                line-height: 1.5;
            }

            #${SHARE_ID} .cph-share-message.is-error {
                color: #ef4444;
            }

            #${SHARE_ID} .cph-share-message.is-success {
                color: #22c55e;
            }

            #${SHARE_ID} .cph-share-actions {
                display: flex;
                gap: 8px;
            }

            #${SHARE_ID} .cph-share-actions > button {
                flex: 1 1 0;
                min-width: 0;
            }

            .cph-share-menu-item {
                cursor: pointer !important;
            }

            #${HUB_ID} {
                position: fixed;
                inset: 0;
                z-index: 2147483000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                box-sizing: border-box;
                background: rgba(0, 0, 0, .65);
            }

            #${HUB_ID} .cph-hub-panel {
                display: flex;
                flex-direction: column;
                width: min(1180px, calc(100vw - 40px));
                height: min(780px, calc(100vh - 40px));
                max-height: calc(100vh - 40px);
                overflow: hidden;
                border-radius: 16px;
            }

            #${HUB_ID} .cph-hub-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                min-height: 64px;
                padding: 0 20px;
                box-sizing: border-box;
            }

            #${HUB_ID} .cph-hub-body {
                display: flex;
                flex-direction: column;
                gap: 12px;
                min-height: 0;
                flex: 1 1 auto;
                padding: 18px 20px 20px;
                overflow: hidden;
            }

            #${HUB_ID} .cph-hub-close {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 34px;
                height: 34px;
                padding: 0;
                border: 0;
                border-radius: 9999px;
                background: transparent;
                cursor: pointer;
            }

            #${HUB_ID} .cph-hub-search-wrap {
                position: relative;
                flex: 0 0 auto;
            }

            #${HUB_ID} .cph-hub-search {
                width: 100%;
                height: 44px;
                padding: 0 42px 0 14px;
                box-sizing: border-box;
                border: 1px solid rgba(128, 128, 128, .35);
                border-radius: 8px;
                color: inherit;
                background: transparent;
                outline: none;
            }

            #${HUB_ID} .cph-hub-search:focus {
                border-color: var(--ring, #7c5cff);
                box-shadow: 0 0 0 2px rgba(124, 92, 255, .18);
            }

            #${HUB_ID} .cph-hub-search-icon {
                position: absolute;
                top: 50%;
                right: 14px;
                transform: translateY(-50%);
                pointer-events: none;
                opacity: .65;
            }

            #${HUB_ID} .cph-hub-meta {
                min-height: 20px;
                margin: 0;
                flex: 0 0 auto;
                font-size: 13px;
                line-height: 20px;
            }

            #${HUB_ID} .cph-hub-meta.is-error {
                color: #ef4444;
            }

            #${HUB_ID} .cph-hub-results {
                min-height: 0;
                flex: 1 1 auto;
                overflow-y: auto;
                padding-right: 2px;
            }

            #${HUB_ID} .cph-hub-grid {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                grid-auto-rows: max-content;
                align-items: start;
                gap: 12px;
            }

            #${HUB_ID} .cph-hub-card {
                display: flex;
                flex-direction: column;
                align-self: start;
                min-width: 0;
                gap: 10px;
                padding: 16px;
                box-sizing: border-box;
                border: 1px solid rgba(128, 128, 128, .22);
                border-radius: 10px;
            }

            #${HUB_ID} .cph-hub-card-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                min-width: 0;
            }

            #${HUB_ID} .cph-hub-card-name {
                display: block;
                flex: 1 1 auto;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            #${HUB_ID} .cph-hub-delete {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 auto;
                height: 30px;
                padding: 0 9px;
                border: 1px solid #ef4444;
                border-radius: 7px;
                color: #ef4444;
                background: transparent;
                font-size: 12px;
                cursor: pointer;
            }

            #${HUB_ID} .cph-hub-delete:hover {
                background: rgba(239, 68, 68, .1);
            }

            #${HUB_ID} .cph-hub-card-info {
                min-height: 22px;
                margin: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                line-height: 22px;
                cursor: pointer;
            }

            #${HUB_ID} .cph-hub-card-info.is-expanded {
                max-height: 260px;
                overflow-y: auto;
                text-overflow: clip;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
            }

            #${HUB_ID} .cph-hub-tags {
                display: flex;
                flex-wrap: wrap;
                align-content: flex-start;
                gap: 6px;
                min-height: 24px;
            }

            #${HUB_ID} .cph-hub-tag {
                display: inline-flex;
                align-items: center;
                min-height: 24px;
                padding: 2px 8px;
                box-sizing: border-box;
                border: 1px solid rgba(128, 128, 128, .3);
                border-radius: 9999px;
                font-size: 12px;
                line-height: 18px;
            }

            #${HUB_ID} .cph-hub-actions {
                display: flex;
                gap: 6px;
                margin-top: auto;
            }

            #${HUB_ID} .cph-hub-action {
                min-width: 0;
                flex: 1 1 0;
                height: 36px !important;
                padding: 0 8px !important;
                font-size: 12px !important;
            }

            #${HUB_ID} .cph-hub-action span {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: inherit;
            }

            #${HUB_ID} .cph-hub-info-toggle {
                display: none;
                border-color: #ef4444 !important;
                color: #ef4444 !important;
                background: transparent !important;
            }

            #${DELETE_ID} {
                position: fixed;
                inset: 0;
                z-index: 2147483200;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                box-sizing: border-box;
                background: rgba(0, 0, 0, .68);
            }

            #${DELETE_ID} .cph-delete-panel {
                display: flex;
                flex-direction: column;
                width: min(440px, calc(100vw - 40px));
                max-height: calc(100vh - 40px);
                overflow: hidden;
                border-radius: 16px;
            }

            #${DELETE_ID} .cph-delete-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                min-height: 64px;
                padding: 0 20px;
                box-sizing: border-box;
            }

            #${DELETE_ID} .cph-hub-close {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                padding: 0;
                border: 0;
                border-radius: 9999px;
                color: inherit;
                background: transparent;
                font-size: 25px;
                line-height: 1;
                cursor: pointer;
            }

            #${DELETE_ID} .cph-delete-body {
                display: flex;
                flex-direction: column;
                gap: 14px;
                padding: 20px;
                overflow-y: auto;
            }

            #${DELETE_ID} .cph-delete-body p {
                margin: 0;
            }

            #${DELETE_ID} .cph-delete-preview {
                padding: 12px;
                border-radius: 8px;
                overflow-wrap: anywhere;
            }

            #${DELETE_ID} .cph-delete-password-label {
                display: flex;
                flex-direction: column;
                gap: 7px;
                font-size: 13px;
            }

            #${DELETE_ID} .cph-delete-password-input {
                width: 100%;
                height: 42px;
                padding: 0 12px;
                box-sizing: border-box;
                border: 1px solid rgba(128, 128, 128, .35);
                border-radius: 8px;
                color: inherit;
                background: transparent;
                outline: none;
            }

            #${DELETE_ID} .cph-delete-password-input:focus {
                border-color: var(--ring, #7c5cff);
                box-shadow: 0 0 0 2px rgba(124, 92, 255, .18);
            }

            #${DELETE_ID} .cph-delete-message {
                min-height: 20px;
                color: #ef4444;
                font-size: 13px;
                line-height: 1.5;
            }

            #${DELETE_ID} .cph-delete-actions {
                display: flex;
                gap: 8px;
            }

            #${DELETE_ID} .cph-delete-actions > button {
                flex: 1 1 0;
                min-width: 0;
            }

            #${DELETE_ID} .cph-delete-confirm {
                border-color: #ef4444 !important;
                color: #fff !important;
                background: #ef4444 !important;
            }

            #${DELETE_ID} .cph-delete-confirm:hover {
                background: #dc2626 !important;
            }

            #${HUB_ID} .cph-hub-empty {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 180px;
                padding: 20px;
                box-sizing: border-box;
                text-align: center;
            }

            .cph-toast {
                position: fixed;
                left: 50%;
                bottom: 28px;
                z-index: 2147483640;
                max-width: min(520px, calc(100vw - 32px));
                padding: 12px 16px;
                box-sizing: border-box;
                transform: translateX(-50%);
                border-radius: 8px;
                color: #fff;
                background: rgba(24, 24, 27, .95);
                box-shadow: 0 8px 28px rgba(0, 0, 0, .3);
                font-size: 14px;
                line-height: 1.45;
                text-align: center;
            }

            .cph-toast.is-error {
                background: rgba(185, 28, 28, .96);
            }

            @media (min-width: 1000px) {
                .cph-content {
                    display: grid !important;
                    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) !important;
                    grid-template-areas:
                        "search search"
                        "favorite-header all-header"
                        "favorites all-profiles";
                    gap: 8px 14px !important;
                }

                #${FAVORITE_SCROLL_ID},
                .cph-original-list {
                    height: 440px;
                }

                .cph-original-list {
                    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
                }
            }

            @media (min-width: 768px) and (max-width: 999px) {
                .cph-content {
                    display: grid !important;
                    grid-template-columns: minmax(190px, 230px) minmax(0, 1fr) !important;
                    grid-template-areas:
                        "search search"
                        "favorite-header all-header"
                        "favorites all-profiles";
                    gap: 8px 12px !important;
                }

                #${FAVORITE_SCROLL_ID},
                .cph-original-list {
                    height: 440px;
                }

                .cph-original-list {
                    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                }

                #${HUB_ID} .cph-hub-grid {
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
            }

            @media (max-width: 767px) {
                .cph-content {
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 8px !important;
                }

                #${SEARCH_ID} { order: 0; }
                #${FAVORITE_HEADER_ID} { order: 1; }
                #${FAVORITE_SCROLL_ID} {
                    order: 2;
                    height: auto;
                    max-height: 190px;
                }
                #${ALL_HEADER_ID} { order: 3; }
                .cph-original-list {
                    order: 4;
                    height: 300px;
                    grid-template-columns: 1fr !important;
                }

                #${HUB_ID} {
                    align-items: flex-end;
                    padding: 0;
                }

                #${HUB_ID} .cph-hub-panel {
                    width: 100%;
                    height: 92vh;
                    max-height: 92vh;
                    border-radius: 16px 16px 0 0;
                }

                #${HUB_ID} .cph-hub-header {
                    min-height: 58px;
                    padding: 0 16px;
                }

                #${HUB_ID} .cph-hub-body {
                    padding: 14px 12px 16px;
                }

                #${HUB_ID} .cph-hub-grid {
                    grid-template-columns: 1fr;
                }

                #${HUB_ID} .cph-hub-info-toggle {
                    display: inline-flex;
                }

                #${HUB_ID} .cph-hub-action {
                    padding: 0 5px !important;
                    font-size: 11px !important;
                }

                #${SHARE_ID} {
                    align-items: flex-end;
                    padding: 0;
                }

                #${SHARE_ID} .cph-share-panel {
                    width: 100%;
                    max-height: 92vh;
                    border-radius: 16px 16px 0 0;
                }

                #${SHARE_ID} .cph-share-passwords {
                    grid-template-columns: 1fr;
                }

                #${DELETE_ID} {
                    align-items: flex-end;
                    padding: 0;
                }

                #${DELETE_ID} .cph-delete-panel {
                    width: 100%;
                    max-height: 92vh;
                    border-radius: 16px 16px 0 0;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function findOriginalAddButton() {
        return [...document.querySelectorAll("button")].find(button =>
            button.textContent?.trim() === "프로필 추가"
            && button.id !== "cph-add-top"
            && !button.closest(OWNED_SELECTOR)
        ) || null;
    }

    function findPageRoot(addButton) {
        let node = addButton?.parentElement;

        while (node && node !== document.body) {
            const hasTitle = [...node.querySelectorAll("span")]
                .some(element => element.textContent?.trim() === "대화 프로필");

            if (hasTitle) return node;
            node = node.parentElement;
        }

        return null;
    }

    function isOriginalCard(element) {
        if (!(element instanceof HTMLElement)) return false;
        if (element.closest(OWNED_SELECTOR)) return false;

        return Boolean(
            element.querySelector('button[aria-haspopup="menu"]')
            && element.querySelector("span.typo-text-base_leading-none_semibold")
        );
    }

    function findOriginalList(root, addButton) {
        const candidates = [...root.querySelectorAll("div")]
            .map(element => ({
                element,
                count: [...element.children].filter(isOriginalCard).length
            }))
            .filter(candidate => candidate.count > 0)
            .sort((a, b) => b.count - a.count);

        if (candidates[0]) return candidates[0].element;

        const content = addButton.parentElement;
        return [...content.children].find(element =>
            element !== addButton
            && !element.matches(OWNED_SELECTOR)
            && element.tagName === "DIV"
        ) || null;
    }

    function legacyProfileKey(name, information) {
        return `${name}::${information}`;
    }

    function profileKey(name, information, occurrence) {
        return JSON.stringify([name, information, occurrence]);
    }

    function normalizeProfileSelectText(value) {
        return String(value ?? "")
            .normalize("NFKC")
            .toLocaleLowerCase("ko-KR")
            .replace(/\s+/g, "");
    }

    function getProfileSelectViewport(listbox) {
        return listbox?.querySelector(":scope > [data-radix-select-viewport]")
            || listbox?.querySelector("[data-radix-select-viewport]")
            || [...(listbox?.children || [])].find(child =>
                child.getAttribute("role") === "presentation"
                && child.querySelector('[role="option"]')
            )
            || listbox
            || null;
    }

    function getProfileSelectOptions(listbox) {
        if (!listbox) return [];

        return [...listbox.querySelectorAll('[role="option"]')].filter(option =>
            option.closest('[role="listbox"]') === listbox
        );
    }

    function getProfileOptionName(option) {
        const labelledBy = option?.getAttribute("aria-labelledby");
        if (labelledBy) {
            const label = document.getElementById(labelledBy);
            if (label?.textContent?.trim()) return label.textContent.trim();
        }

        const markedName = option?.querySelector("[data-profile-name]");
        if (markedName?.textContent?.trim()) return markedName.textContent.trim();

        const spans = option?.querySelectorAll(
            ":scope > span:not([data-profile-info])"
        ) || [];
        const lastSpan = spans[spans.length - 1];
        if (lastSpan?.textContent?.trim()) return lastSpan.textContent.trim();

        return option?.textContent?.trim() || "";
    }

    function getProfileSelectCombobox(listbox) {
        const listboxId = listbox?.id;
        if (listboxId) {
            const comboboxes = document.querySelectorAll(
                '[role="combobox"][aria-controls], [role="combobox"][aria-owns]'
            );
            for (const combobox of comboboxes) {
                if (combobox.getAttribute("aria-controls") === listboxId
                    || combobox.getAttribute("aria-owns") === listboxId) {
                    return combobox;
                }
            }
        }

        const popupWrapper = listbox?.closest(
            "[data-radix-popper-content-wrapper]"
        );
        return popupWrapper?.parentElement?.querySelector(
            ':scope > [role="combobox"]'
        ) || null;
    }

    function hasProfileSelectLabel(combobox) {
        if (!combobox) return false;
        const isProfileLabel = value => {
            const normalized = normalizeProfileSelectText(value);
            return normalized === "대화프로필" || normalized === "채팅프로필";
        };

        if (isProfileLabel(combobox.getAttribute("aria-label"))) return true;

        const labelledBy = combobox.getAttribute("aria-labelledby");
        if (labelledBy) {
            for (const id of labelledBy.split(/\s+/)) {
                if (isProfileLabel(document.getElementById(id)?.textContent)) return true;
            }
        }

        let sibling = combobox.previousElementSibling;
        while (sibling) {
            if (isProfileLabel(sibling.textContent)) return true;
            sibling = sibling.previousElementSibling;
        }

        return false;
    }

    function isProfileSelectListbox(listbox) {
        return getProfileSelectOptions(listbox).length > 0
            && hasProfileSelectLabel(getProfileSelectCombobox(listbox));
    }

    function getOriginalProfileOptionOrder(listbox) {
        const options = getProfileSelectOptions(listbox);
        if (!options.length) return [];

        const indexes = options.map(option => Number(option.dataset.cphOriginalIndex));
        const validIndexes = indexes.every(Number.isSafeInteger)
            && new Set(indexes).size === options.length
            && Math.min(...indexes) === 0
            && Math.max(...indexes) === options.length - 1;

        if (!validIndexes) {
            options.forEach((option, index) => {
                option.dataset.cphOriginalIndex = String(index);
            });
            return options;
        }

        return options.sort((left, right) =>
            Number(left.dataset.cphOriginalIndex)
            - Number(right.dataset.cphOriginalIndex)
        );
    }

    function storedFavoriteMatches(name, information, occurrence) {
        const key = profileKey(name, information, occurrence);
        return favorites.has(key)
            || favorites.has(
                `${LEGACY_FAVORITE_PREFIX}${legacyProfileKey(name, information)}`
            );
    }

    function favoriteNamesFromStorage() {
        const counts = new Map();

        for (const storedKey of favorites) {
            if (typeof storedKey !== "string") continue;

            let name = "";
            if (storedKey.startsWith(LEGACY_FAVORITE_PREFIX)) {
                name = storedKey
                    .slice(LEGACY_FAVORITE_PREFIX.length)
                    .split("::", 1)[0];
            } else {
                try {
                    const parsed = JSON.parse(storedKey);
                    if (Array.isArray(parsed)) name = String(parsed[0] || "");
                } catch {}
            }

            const normalized = normalizeProfileSelectText(name);
            if (!normalized) continue;
            counts.set(normalized, (counts.get(normalized) || 0) + 1);
        }

        return counts;
    }

    function resolveFavoriteProfileOptions(options) {
        const favoriteOptions = new Set();
        const hasSearchProfileData = options.length > 0 && options.every(option =>
            option.hasAttribute("data-profile-information")
        );

        // 기존 '프로필 검색 + 정보 표시' 스크립트가 연결한 정보로 동명이인까지 구분한다.
        if (hasSearchProfileData) {
            const occurrences = new Map();
            for (const option of options) {
                const name = getProfileOptionName(option);
                const information = String(option.dataset.profileInformation || "").trim();
                const occurrenceKey = legacyProfileKey(name, information);
                const occurrence = (occurrences.get(occurrenceKey) || 0) + 1;
                occurrences.set(occurrenceKey, occurrence);

                if (storedFavoriteMatches(name, information, occurrence)) {
                    favoriteOptions.add(option);
                }
            }
            return favoriteOptions;
        }

        // 검색 스크립트 정보가 아직 없으면 설정 페이지에서 기록한 원래 순서를 사용한다.
        const snapshot = loadProfileOrderSnapshot();
        const snapshotMatches = snapshot
            && snapshot.names.length === options.length
            && snapshot.names.every((name, index) =>
                normalizeProfileSelectText(name)
                === normalizeProfileSelectText(getProfileOptionName(options[index]))
            );

        if (snapshotMatches) {
            for (const index of snapshot.favoriteIndexes) {
                if (index >= 0 && index < options.length) favoriteOptions.add(options[index]);
            }
            return favoriteOptions;
        }

        // 마지막 호환 경로: 이름이 하나뿐이거나 같은 이름 전부가 즐겨찾기일 때만 이동한다.
        const optionNameCounts = new Map();
        for (const option of options) {
            const name = normalizeProfileSelectText(getProfileOptionName(option));
            optionNameCounts.set(name, (optionNameCounts.get(name) || 0) + 1);
        }
        const favoriteNameCounts = favoriteNamesFromStorage();
        for (const option of options) {
            const name = normalizeProfileSelectText(getProfileOptionName(option));
            const optionCount = optionNameCounts.get(name) || 0;
            const favoriteCount = favoriteNameCounts.get(name) || 0;
            if (favoriteCount > 0 && (optionCount === 1 || favoriteCount >= optionCount)) {
                favoriteOptions.add(option);
            }
        }

        return favoriteOptions;
    }

    function prioritizeFavoriteProfileOptions() {
        document.querySelectorAll('[role="listbox"]').forEach(listbox => {
            if (!isProfileSelectListbox(listbox)) return;

            const viewport = getProfileSelectViewport(listbox);
            const originalOptions = getOriginalProfileOptionOrder(listbox);
            if (!viewport || !originalOptions.length) return;

            const searchIntegrationPresent = Boolean(
                listbox.querySelector("[data-profile-search]")
            );
            const searchProfileDataReady = originalOptions.every(option =>
                option.hasAttribute("data-profile-information")
            );
            const waitStartedAt = Number(listbox.dataset.cphFavoriteWaitStartedAt) || 0;

            // 검색 스크립트가 API 정보를 매핑하는 짧은 동안에는 원래 순서를 건드리지 않는다.
            if (searchIntegrationPresent && !searchProfileDataReady
                && (!waitStartedAt || Date.now() - waitStartedAt < 1500)) {
                if (!waitStartedAt) {
                    listbox.dataset.cphFavoriteWaitStartedAt = String(Date.now());
                }
                if (!listbox.dataset.cphFavoriteRetryPending) {
                    listbox.dataset.cphFavoriteRetryPending = "true";
                    setTimeout(() => {
                        delete listbox.dataset.cphFavoriteRetryPending;
                        if (listbox.isConnected) prioritizeFavoriteProfileOptions();
                    }, 80);
                }
                return;
            }
            delete listbox.dataset.cphFavoriteWaitStartedAt;

            const favoriteOptions = resolveFavoriteProfileOptions(originalOptions);
            const favoriteFirst = originalOptions.filter(option => favoriteOptions.has(option));
            const remaining = originalOptions.filter(option => !favoriteOptions.has(option));
            const desiredOrder = [...favoriteFirst, ...remaining];
            const currentOrder = getProfileSelectOptions(listbox);
            const signature = JSON.stringify(originalOptions.map(option => [
                getProfileOptionName(option),
                option.getAttribute("data-profile-information"),
                favoriteOptions.has(option)
            ]));
            const alreadyOrdered = desiredOrder.every(
                (option, index) => currentOrder[index] === option
            );
            const classesReady = originalOptions.every(option =>
                option.classList.contains("cph-select-favorite")
                === favoriteOptions.has(option)
            );

            if (viewport.dataset.cphFavoriteSignature === signature
                && alreadyOrdered && classesReady) return;

            for (const option of originalOptions) {
                option.classList.toggle(
                    "cph-select-favorite",
                    favoriteOptions.has(option)
                );
                option.classList.remove("cph-select-favorite-last");
            }
            favoriteFirst.at(-1)?.classList.add("cph-select-favorite-last");

            viewport.append(...desiredOrder);
            viewport.dataset.cphFavoriteSignature = signature;

            if (favoriteFirst.length) {
                requestAnimationFrame(() => {
                    if (viewport.isConnected) viewport.scrollTop = 0;
                });
            }
        });
    }

    function extractProfiles(list) {
        const occurrences = new Map();
        const cards = [...list.children].filter(isOriginalCard);

        return cards
            .map((card, index) => {
                const nameElement = card.querySelector(
                    "span.typo-text-base_leading-none_semibold"
                );
                const infoElement = card.querySelector(
                    "p.typo-text-md_leading-none_medium"
                );
                const menuButton = card.querySelector(
                    'button[aria-haspopup="menu"]'
                );
                const name = nameElement?.textContent?.trim() || "이름 없음";
                const information = infoElement?.textContent?.trim() || "";
                const legacyKey = legacyProfileKey(name, information);
                const occurrence = (occurrences.get(legacyKey) || 0) + 1;
                occurrences.set(legacyKey, occurrence);
                const representative = [...card.querySelectorAll("span")]
                    .some(span => span.textContent?.trim() === "대표");

                return {
                    key: profileKey(name, information, occurrence),
                    legacyKey,
                    occurrence,
                    name,
                    information,
                    representative,
                    originalCard: card,
                    originalMenuButton: menuButton,
                    infoElement,
                    index
                };
            });
    }

    function makeSiteButton(text, id) {
        const button = document.createElement("button");
        button.type = "button";
        if (id) button.id = id;
        button.className = currentAddButton
            ? [...currentAddButton.classList]
                .filter(className => className !== "cph-original-add")
                .join(" ")
            : [
            "relative inline-flex items-center justify-center gap-1",
            "h-11 rounded-md px-8 py-2 border border-solid border-border",
            "bg-background text-foreground hover:bg-accent active:bg-accent/80 w-full"
            ].join(" ");

        const span = document.createElement("span");
        span.className = "typo-text-base_leading-none_medium text-text_primary";
        span.textContent = text;
        button.appendChild(span);

        return button;
    }

    function createTopButtons() {
        const wrapper = document.createElement("div");
        wrapper.id = TOP_ID;
        wrapper.dataset.cphOwned = "true";

        const add = makeSiteButton("프로필 추가", "cph-add-top");
        const hub = makeSiteButton("허브", "cph-hub-top");

        add.addEventListener("click", event => {
            event.stopPropagation();
            collapseExpanded();
            if (currentAddButton?.isConnected) currentAddButton.click();
        });
        hub.addEventListener("click", event => {
            event.stopPropagation();
            collapseExpanded();
            openHub();
        });

        wrapper.append(add, hub);
        return wrapper;
    }

    function createSectionHeader(id, title) {
        const header = document.createElement("div");
        header.id = id;
        header.dataset.cphOwned = "true";
        header.className = "cph-section-header";

        const label = document.createElement("span");
        label.className = "typo-text-base_leading-none_semibold text-text_primary";
        label.textContent = title;

        const count = document.createElement("span");
        count.className = "cph-count text-text_secondary";
        count.dataset.cphCount = "true";

        header.append(label, count);
        return header;
    }

    function createSearch() {
        const input = document.createElement("input");
        input.id = SEARCH_ID;
        input.dataset.cphOwned = "true";
        input.type = "search";
        input.autocomplete = "off";
        input.placeholder = "프로필 이름 또는 정보 검색";
        input.setAttribute("aria-label", "대화 프로필 검색");
        input.className = [
            "rounded-md border border-solid border-border",
            "bg-background text-foreground",
            "typo-text-base_leading-none_medium"
        ].join(" ");
        input.addEventListener("input", applySearch);

        return input;
    }

    function ensureTopScaffold(root) {
        root.classList.add("cph-page-wide");

        const titleArea = [...root.children].find(child =>
            [...child.querySelectorAll("span")]
                .some(span => span.textContent?.trim() === "대화 프로필")
        );

        if (titleArea && !root.querySelector(`#${TOP_ID}`)) {
            titleArea.insertAdjacentElement("afterend", createTopButtons());
        }

        // 새 버튼을 만든 뒤에만 원본 하단 버튼을 숨긴다.
        currentAddButton.classList.add("cph-original-add");
    }

    function ensureProfileScaffold(content, list) {
        content.classList.add("cph-content");
        list.classList.add("cph-original-list");

        const elements = [
            document.getElementById(SEARCH_ID) || createSearch(),
            document.getElementById(FAVORITE_HEADER_ID)
                || createSectionHeader(FAVORITE_HEADER_ID, "즐겨찾기"),
            document.getElementById(ALL_HEADER_ID)
                || createSectionHeader(ALL_HEADER_ID, "전체 프로필"),
            document.getElementById(FAVORITE_SCROLL_ID)
                || Object.assign(document.createElement("div"), {
                    id: FAVORITE_SCROLL_ID,
                    className: "cph-favorite-scroll"
                })
        ];

        elements[3].dataset.cphOwned = "true";

        for (const element of elements) {
            if (element.parentElement !== content) {
                content.insertBefore(element, list);
            }
        }
    }

    function toggleFavorite(key) {
        if (favorites.has(key)) favorites.delete(key);
        else favorites.add(key);

        expandedTarget = null;
        saveFavorites();
        updateProfileVisuals();
        renderFavorites(true);
        applySearch();
        window.dispatchEvent(
            new CustomEvent(
                "cph:favorites-changed"
            )
        );
    }

    function profileTarget(section, profile) {
        return `${section}:${profile.index}:${profile.key}`;
    }

    function toggleExpanded(target) {
        expandedTarget = expandedTarget === target ? null : target;

        updateProfileVisuals();
        renderFavorites(true);
        applySearch();
    }

    function collapseExpanded() {
        if (expandedTarget === null) return;

        expandedTarget = null;
        updateProfileVisuals();
        renderFavorites(true);
        applySearch();
    }

    function updateStar(button, key) {
        const selected = favorites.has(key);
        button.textContent = selected ? "★" : "☆";
        button.classList.toggle("is-favorite", selected);
        button.setAttribute("aria-pressed", String(selected));
        button.setAttribute(
            "aria-label",
            selected ? "즐겨찾기에서 제거" : "즐겨찾기에 추가"
        );
    }

    function decorateOriginalProfile(profile) {
        const { originalCard: card, infoElement, key } = profile;
        const target = profileTarget("all", profile);
        card.classList.add("cph-profile-card");
        card.dataset.cphKey = key;
        card.dataset.cphExpandTarget = target;

        if (infoElement) {
            infoElement.classList.add("cph-profile-info");
            infoElement.removeAttribute("title");

            if (!infoElement.dataset.cphBound) {
                infoElement.dataset.cphBound = "true";
                infoElement.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleExpanded(card.dataset.cphExpandTarget);
                });
            }
        }

        if (profile.originalMenuButton && !profile.originalMenuButton.dataset.cphBound) {
            profile.originalMenuButton.dataset.cphBound = "true";
            profile.originalMenuButton.addEventListener("pointerdown", () => {
                requestAnimationFrame(collapseExpanded);
            });
        }

        let star = [...card.children].find(child =>
            child.classList?.contains("cph-star")
        );

        if (!star) {
            star = document.createElement("button");
            star.type = "button";
            star.className = "cph-star";
            star.dataset.cphOwned = "true";
            star.addEventListener("pointerdown", event => event.stopPropagation());
            star.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                toggleFavorite(card.dataset.cphKey);
            });
            card.appendChild(star);
        }

        updateStar(star, key);
        card.classList.toggle("cph-expanded-profile", expandedTarget === target);
    }

    function updateProfileVisuals() {
        for (const profile of profiles) {
            decorateOriginalProfile(profile);
        }
    }

    function makeRepresentativeBadge() {
        const badge = document.createElement("div");
        badge.className = [
            "flex flex-row px-2 h-[22px] rounded",
            "bg-surface_chat_primary items-center"
        ].join(" ");

        const text = document.createElement("span");
        text.className = "typo-text-sm_leading-none_medium text-text_ivory";
        text.textContent = "대표";
        badge.appendChild(text);

        return badge;
    }

    function createNativeProxyButton(profile) {
        const original = profile.originalMenuButton;
        if (!original) return null;

        const button = document.createElement("button");
        button.type = "button";
        button.className = `${original.className} cph-native-proxy`;
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-label", `${profile.name} 메뉴 열기`);
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg"
                 fill="var(--icon_primary)" viewBox="0 0 24 24"
                 width="24px" height="24px" aria-hidden="true">
                <path d="M7.04 10.73H4.5v2.54h2.54zm6.23 0h-2.54v2.54h2.54zm3.73 0h2.54v2.54H17z"></path>
            </svg>
        `;

        const open = event => {
            event.preventDefault();
            event.stopPropagation();
            openOriginalMenuAt(original, button);
            collapseExpanded();
        };

        button.addEventListener("pointerdown", event => {
            if (event.button === 0 && !event.ctrlKey) open(event);
        });
        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
        });
        button.addEventListener("keydown", event => {
            if (["Enter", " ", "ArrowDown"].includes(event.key)) open(event);
        });

        return button;
    }

    function openOriginalMenuAt(originalButton, visibleButton) {
        if (!originalButton?.isConnected || !visibleButton?.isConnected) return;

        if (activeNativeProxyCleanup) activeNativeProxyCleanup();

        const rect = visibleButton.getBoundingClientRect();
        const oldStyle = originalButton.getAttribute("style");
        let restored = false;
        let sawOpen = originalButton.getAttribute("aria-expanded") === "true";
        let watchTimer = null;
        let failSafeTimer = null;

        const restore = () => {
            if (restored) return;
            restored = true;
            clearInterval(watchTimer);
            clearTimeout(failSafeTimer);

            if (oldStyle === null) originalButton.removeAttribute("style");
            else originalButton.setAttribute("style", oldStyle);

            if (activeNativeProxyCleanup === restore) {
                activeNativeProxyCleanup = null;
            }
        };

        activeNativeProxyCleanup = restore;

        const fixedStyles = {
            position: "fixed",
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            margin: "0",
            opacity: "0",
            pointerEvents: "none",
            zIndex: "2147482999"
        };

        for (const [property, value] of Object.entries(fixedStyles)) {
            originalButton.style.setProperty(
                property.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`),
                value,
                "important"
            );
        }

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const PointerEventClass = window.PointerEvent || window.MouseEvent;

        originalButton.dispatchEvent(new PointerEventClass("pointerdown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: 1,
            ctrlKey: false,
            clientX: centerX,
            clientY: centerY,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true
        }));

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (originalButton.getAttribute("aria-expanded") !== "true") {
                    originalButton.dispatchEvent(new KeyboardEvent("keydown", {
                        key: "Enter",
                        code: "Enter",
                        bubbles: true,
                        cancelable: true,
                        composed: true
                    }));
                }
            });
        });

        const startedAt = Date.now();
        watchTimer = setInterval(() => {
            if (!originalButton.isConnected) {
                restore();
                return;
            }

            const isOpen = originalButton.getAttribute("aria-expanded") === "true"
                || originalButton.getAttribute("data-state") === "open";

            if (isOpen) sawOpen = true;
            if ((sawOpen && !isOpen) || (!sawOpen && Date.now() - startedAt > 1600)) {
                restore();
            }
        }, 50);

        failSafeTimer = setTimeout(restore, 120000);
    }

    function createFavoriteCard(profile) {
        const target = profileTarget("favorite", profile);
        const card = document.createElement("div");
        card.dataset.cphOwned = "true";
        card.dataset.cphFavoriteCard = "true";
        card.dataset.cphKey = profile.key;
        card.className = [
            "cph-favorite-card flex flex-col gap-2 rounded-lg",
            "bg-surface_tertiary cursor-pointer"
        ].join(" ");

        const nameRow = document.createElement("div");
        nameRow.className = "cph-name-row";
        if (profile.representative) nameRow.appendChild(makeRepresentativeBadge());

        const name = document.createElement("span");
        name.className = [
            "cph-name typo-text-base_leading-none_semibold",
            "text-text_primary"
        ].join(" ");
        name.textContent = profile.name;
        nameRow.appendChild(name);

        const info = document.createElement("p");
        info.className = [
            "cph-profile-info typo-text-md_leading-none_medium",
            "text-text_secondary"
        ].join(" ");
        info.textContent = profile.information || "정보 없음";
        info.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            toggleExpanded(target);
        });

        const star = document.createElement("button");
        star.type = "button";
        star.className = "cph-star";
        updateStar(star, profile.key);
        star.addEventListener("pointerdown", event => event.stopPropagation());
        star.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            toggleFavorite(profile.key);
        });

        card.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            collapseExpanded();
            if (profile.originalCard?.isConnected) profile.originalCard.click();
        });

        card.append(nameRow, info, star);
        const nativeMenu = createNativeProxyButton(profile);
        if (nativeMenu) card.appendChild(nativeMenu);

        card.classList.toggle(
            "cph-expanded-profile",
            expandedTarget === target
        );

        return card;
    }

    function renderFavorites(force = false) {
        const list = document.getElementById(FAVORITE_SCROLL_ID);
        if (!list) return;

        const nextSignature = profiles.map(profile => [
            profile.key,
            profile.representative,
            favorites.has(profile.key)
        ].join("|")).join("\n");

        if (!force && nextSignature === renderSignature) return;
        renderSignature = nextSignature;
        list.replaceChildren();

        const selected = profiles.filter(profile => favorites.has(profile.key));

        if (!selected.length) {
            const empty = document.createElement("div");
            empty.className = "cph-empty bg-surface_tertiary text-text_secondary";
            empty.textContent = "별을 눌러 즐겨찾기에 추가해 보세요.";
            list.appendChild(empty);
            return;
        }

        list.append(...selected.map(createFavoriteCard));
    }

    function normalizedSearchText(profile) {
        return `${profile.name}\n${profile.information}`.toLocaleLowerCase();
    }

    function applySearch() {
        const query = document.getElementById(SEARCH_ID)?.value
            ?.trim()
            .toLocaleLowerCase() || "";
        const matches = profile => !query || normalizedSearchText(profile).includes(query);

        let visibleAll = 0;
        let visibleFavorites = 0;

        for (const profile of profiles) {
            const visible = matches(profile);
            profile.originalCard.classList.toggle("cph-filter-hidden", !visible);
            if (visible) visibleAll += 1;
            if (visible && favorites.has(profile.key)) visibleFavorites += 1;
        }

        document.querySelectorAll('[data-cph-favorite-card="true"]').forEach(card => {
            const profile = profiles.find(item => item.key === card.dataset.cphKey);
            card.classList.toggle("cph-filter-hidden", !profile || !matches(profile));
        });

        const favoriteTotal = profiles.filter(profile => favorites.has(profile.key)).length;
        const allCount = document.querySelector(`#${ALL_HEADER_ID} [data-cph-count]`);
        const favoriteCount = document.querySelector(
            `#${FAVORITE_HEADER_ID} [data-cph-count]`
        );

        if (allCount) allCount.textContent = query
            ? `${visibleAll} / ${profiles.length}`
            : String(profiles.length);
        if (favoriteCount) favoriteCount.textContent = query
            ? `${visibleFavorites} / ${favoriteTotal}`
            : String(favoriteTotal);
    }

    function profilesChanged(nextProfiles) {
        if (profiles.length !== nextProfiles.length) return true;

        return profiles.some((profile, index) => {
            const next = nextProfiles[index];
            return profile.originalCard !== next.originalCard
                || profile.originalMenuButton !== next.originalMenuButton
                || profile.infoElement !== next.infoElement
                || profile.key !== next.key
                || profile.representative !== next.representative;
        });
    }

    function syncProfiles(list) {
        const nextProfiles = extractProfiles(list);
        migrateLegacyFavorites(nextProfiles);
        const changed = profilesChanged(nextProfiles);
        profiles = nextProfiles;

        if (expandedTarget && !profiles.some(profile =>
            expandedTarget === profileTarget("all", profile)
            || expandedTarget === profileTarget("favorite", profile)
        )) {
            expandedTarget = null;
        }

        updateProfileVisuals();
        renderFavorites(changed);
        applySearch();
    }

    function migrateLegacyFavorites(nextProfiles) {
        let changed = false;

        for (const storedKey of [...favorites]) {
            if (typeof storedKey !== "string"
                || !storedKey.startsWith(LEGACY_FAVORITE_PREFIX)) continue;

            const legacyKey = storedKey.slice(LEGACY_FAVORITE_PREFIX.length);
            const firstMatch = nextProfiles.find(profile => profile.legacyKey === legacyKey);
            if (!firstMatch) continue;

            favorites.delete(storedKey);
            favorites.add(firstMatch.key);
            changed = true;
        }

        if (changed) saveFavorites();
    }

    function ensureShareMenuItems() {
        document.querySelectorAll('[role="menu"][data-state="open"]').forEach(menu => {
            const triggerId = menu.getAttribute("aria-labelledby");
            const trigger = triggerId ? document.getElementById(triggerId) : null;
            const profile = profiles.find(item => item.originalMenuButton === trigger);
            if (!profile) return;

            const existing = menu.querySelector('[data-cph-share-menu-item="true"]');
            if (existing?.dataset.cphShareTrigger === triggerId) return;
            existing?.remove();

            const template = menu.querySelector('[role="menuitem"]');
            const share = document.createElement("div");
            share.dataset.cphShareMenuItem = "true";
            share.dataset.cphShareTrigger = triggerId;
            share.setAttribute("role", "menuitem");
            share.setAttribute("tabindex", "-1");
            share.className = template?.className || [
                "relative flex cursor-default select-none items-center gap-2",
                "rounded-sm px-2 py-1.5 text-sm outline-none",
                "transition-colors focus:bg-accent focus:text-accent-foreground"
            ].join(" ");
            share.classList.add("cph-share-menu-item");
            share.textContent = "공유";

            share.addEventListener("pointerdown", event => {
                event.preventDefault();
                event.stopPropagation();
            });

            const activate = event => {
                event.preventDefault();
                event.stopPropagation();
                closeNativeProfileMenu(trigger);
                queueMicrotask(() => openShareDialog(profile));
            };

            share.addEventListener("click", activate);
            share.addEventListener("keydown", event => {
                if (["Enter", " "].includes(event.key)) activate(event);
            });

            menu.appendChild(share);
        });
    }

    function closeNativeProfileMenu(trigger) {
        if (!trigger || trigger.getAttribute("aria-expanded") !== "true") return;

        const rect = trigger.getBoundingClientRect();
        const PointerEventClass = window.PointerEvent || window.MouseEvent;
        trigger.dispatchEvent(new PointerEventClass("pointerdown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: 1,
            ctrlKey: false,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true
        }));
    }

    function createShareDialog(profile) {
        const overlay = document.createElement("div");
        overlay.id = SHARE_ID;
        overlay.dataset.cphOwned = "true";

        const panel = document.createElement("div");
        panel.className = "cph-share-panel border border-border bg-background shadow-xl";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-labelledby", "cph-share-title");

        const header = document.createElement("div");
        header.className = "cph-share-header border-b border-border";

        const title = document.createElement("span");
        title.id = "cph-share-title";
        title.className = "typo-text-lg_leading-none_semibold text-text_primary";
        title.textContent = "프로필 공유";

        const close = document.createElement("button");
        close.type = "button";
        close.className = "cph-hub-close hover:bg-accent active:bg-accent/80";
        close.setAttribute("aria-label", "닫기");
        close.textContent = "×";
        close.addEventListener("click", closeShareDialog);
        header.append(title, close);

        const body = document.createElement("div");
        body.className = "cph-share-body";

        const question = document.createElement("p");
        question.className = "typo-text-base_leading-paragraph_semibold text-text_primary";
        question.textContent = "정말로 이 프로필을 허브에 공개하시겠습니까?";

        const privacy = document.createElement("p");
        privacy.className = "typo-text-sm_leading-paragraph_regular text-text_secondary whitespace-pre-line";
        privacy.textContent = [
            "프로필 이름과 정보, 선택한 태그가 공개됩니다.",
            "Crack 계정 정보와 내부 프로필 ID는 공유되지 않습니다.",
            "관리 비밀번호는 평문으로 저장되지 않으며 분실하면 복구할 수 없습니다."
        ].join("\n");

        const preview = document.createElement("div");
        preview.className = "cph-share-preview bg-surface_tertiary";

        const profileName = document.createElement("span");
        profileName.className = "typo-text-base_leading-none_semibold text-text_primary";
        profileName.textContent = profile.name;

        const information = document.createElement("p");
        information.className = "cph-share-information text-text_secondary";
        information.textContent = profile.information || "정보 없음";
        preview.append(profileName, information);

        const tagTitle = document.createElement("span");
        tagTitle.className = "typo-text-base_leading-none_semibold text-text_primary";
        tagTitle.textContent = "태그 선택 · 복수 선택 가능";

        const tags = document.createElement("div");
        tags.className = "cph-share-tags";

        for (const tag of SHARE_TAGS) {
            const label = document.createElement("label");
            label.className = "cph-share-tag bg-surface_tertiary text-text_primary";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = tag;
            checkbox.dataset.cphShareTag = "true";

            const text = document.createElement("span");
            text.textContent = tag;
            label.append(checkbox, text);
            tags.appendChild(label);
        }

        const passwordTitle = document.createElement("span");
        passwordTitle.className = "typo-text-base_leading-none_semibold text-text_primary";
        passwordTitle.textContent = "관리 비밀번호";

        const passwords = document.createElement("div");
        passwords.className = "cph-share-passwords";

        const password = createSharePasswordInput(
            "비밀번호",
            "cph-share-password",
            "새 비밀번호"
        );
        const passwordConfirm = createSharePasswordInput(
            "비밀번호 확인",
            "cph-share-password-confirm",
            "비밀번호 다시 입력"
        );
        passwords.append(password, passwordConfirm);

        const message = document.createElement("p");
        message.className = "cph-share-message text-text_secondary";
        message.setAttribute("role", "status");
        message.setAttribute("aria-live", "polite");

        const actions = document.createElement("div");
        actions.className = "cph-share-actions";

        const cancel = makeSiteButton("취소", "cph-share-cancel");
        const submit = makeSiteButton("공유하기", "cph-share-submit");
        cancel.addEventListener("click", closeShareDialog);
        submit.addEventListener("click", () => shareProfile(profile, overlay));
        actions.append(cancel, submit);

        body.append(
            question,
            privacy,
            preview,
            tagTitle,
            tags,
            passwordTitle,
            passwords,
            message,
            actions
        );
        panel.append(header, body);
        overlay.appendChild(panel);

        overlay.addEventListener("click", event => {
            if (event.target === overlay && !overlay.dataset.cphSubmitting) {
                closeShareDialog();
            }
        });

        return overlay;
    }

    function createSharePasswordInput(labelText, id, placeholder) {
        const label = document.createElement("label");
        label.className = "cph-share-password-label text-text_secondary";
        label.setAttribute("for", id);

        const text = document.createElement("span");
        text.textContent = labelText;

        const input = document.createElement("input");
        input.id = id;
        input.type = "password";
        input.className = "cph-share-password-input";
        input.placeholder = placeholder;
        input.autocomplete = "new-password";
        input.minLength = SHARE_PASSWORD_MIN_LENGTH;
        input.maxLength = SHARE_PASSWORD_MAX_LENGTH;
        input.required = true;

        label.append(text, input);
        return label;
    }

    function openShareDialog(profile) {
        if (document.getElementById(SHARE_ID)) return;

        collapseExpanded();
        bodyOverflowBeforeShare = document.body.style.overflow;
        document.body.appendChild(createShareDialog(profile));
        document.body.style.overflow = "hidden";
        document.querySelector(`#${SHARE_ID} [data-cph-share-tag]`)?.focus();
    }

    function closeShareDialog(force = false) {
        const modal = document.getElementById(SHARE_ID);
        if (!modal || (!force && modal.dataset.cphSubmitting)) return;

        modal.remove();
        document.body.style.overflow = bodyOverflowBeforeShare;
    }

    async function shareProfile(profile, modal) {
        if (!modal || modal.dataset.cphSubmitting) return;

        const selectedTags = [...modal.querySelectorAll(
            '[data-cph-share-tag="true"]:checked'
        )].map(input => input.value);
        const password = modal.querySelector("#cph-share-password")?.value || "";
        const passwordConfirm = modal.querySelector(
            "#cph-share-password-confirm"
        )?.value || "";
        const message = modal.querySelector(".cph-share-message");
        const submit = modal.querySelector("#cph-share-submit");
        const cancel = modal.querySelector("#cph-share-cancel");

        if (!selectedTags.length) {
            setShareMessage(message, "태그를 하나 이상 선택해 주세요.", "error");
            return;
        }
        if (password.length < SHARE_PASSWORD_MIN_LENGTH
            || password.length > SHARE_PASSWORD_MAX_LENGTH) {
            setShareMessage(
                message,
                `비밀번호는 ${SHARE_PASSWORD_MIN_LENGTH}~${SHARE_PASSWORD_MAX_LENGTH}자로 입력해 주세요.`,
                "error"
            );
            return;
        }
        if (password !== passwordConfirm) {
            setShareMessage(message, "비밀번호 확인이 일치하지 않습니다.", "error");
            return;
        }

        modal.dataset.cphSubmitting = "true";
        submit.disabled = true;
        cancel.disabled = true;
        modal.querySelectorAll("input").forEach(input => { input.disabled = true; });
        submit.querySelector("span").textContent = "공유 중...";
        setShareMessage(message, "허브에 프로필을 등록하고 있습니다.");

        try {
            await ensurePasswordWorker();
            const response = await fetch(`${WORKER_BASE_URL}/api/profiles`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: profile.name,
                    information: profile.information,
                    tags: selectedTags,
                    password
                })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.message || result.error || `HTTP ${response.status}`);
            }

            if (result.profile?.id && result.ownerToken) {
                saveShareOwnerToken(result.profile.id, result.ownerToken);
            }

            delete modal.dataset.cphSubmitting;
            cancel.disabled = false;
            modal.querySelectorAll("input").forEach(input => { input.disabled = true; });
            const passwordInput = modal.querySelector("#cph-share-password");
            const confirmInput = modal.querySelector("#cph-share-password-confirm");
            if (passwordInput) passwordInput.value = "";
            if (confirmInput) confirmInput.value = "";
            cancel.querySelector("span").textContent = "닫기";
            submit.remove();
            setShareMessage(message, "프로필이 허브에 공개되었습니다.", "success");
        } catch (error) {
            delete modal.dataset.cphSubmitting;
            submit.disabled = false;
            cancel.disabled = false;
            modal.querySelectorAll("input").forEach(input => { input.disabled = false; });
            submit.querySelector("span").textContent = "다시 시도";
            setShareMessage(
                message,
                `공유에 실패했습니다: ${error?.message || "알 수 없는 오류"}`,
                "error"
            );
        }
    }

    async function ensurePasswordWorker() {
        const response = await fetch(`${WORKER_BASE_URL}/`, {
            method: "GET",
            headers: { "Accept": "application/json" }
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok
            || Number(result.version) < 4
            || result.features?.passwordProtection !== true
            || result.features?.passwordHashScheme !== "pbkdf2-sha256-peppered-v1"
            || result.features?.ownerDelete !== true) {
            throw new Error("최신 Worker v4 코드를 먼저 배포해 주세요.");
        }
    }

    function setShareMessage(element, text, state = "") {
        if (!element) return;
        element.textContent = text;
        element.classList.toggle("is-error", state === "error");
        element.classList.toggle("is-success", state === "success");
    }

    function saveShareOwnerToken(shareId, ownerToken) {
        try {
            const parsed = JSON.parse(localStorage.getItem(SHARE_OWNER_KEY) || "{}");
            const records = parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed
                : {};
            records[shareId] = ownerToken;
            localStorage.setItem(SHARE_OWNER_KEY, JSON.stringify(records));
        } catch (error) {
            console.warn("[ProfileHub] 공유 프로필 소유권 키 저장 실패", error);
        }
    }

    function getShareOwnerToken(shareId) {
        try {
            const parsed = JSON.parse(localStorage.getItem(SHARE_OWNER_KEY) || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
            return typeof parsed[shareId] === "string" ? parsed[shareId] : "";
        } catch {
            return "";
        }
    }

    function removeShareOwnerToken(shareId) {
        try {
            const parsed = JSON.parse(localStorage.getItem(SHARE_OWNER_KEY) || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
            delete parsed[shareId];
            localStorage.setItem(SHARE_OWNER_KEY, JSON.stringify(parsed));
        } catch (error) {
            console.warn("[ProfileHub] 공유 프로필 소유권 키 정리 실패", error);
        }
    }

    function createDeleteDialog(profile) {
        const legacyOwnerToken = getShareOwnerToken(profile.id);
        const canDelete = profile.passwordProtected || Boolean(legacyOwnerToken);

        const overlay = document.createElement("div");
        overlay.id = DELETE_ID;
        overlay.dataset.cphOwned = "true";
        if (canDelete) overlay.dataset.cphCanDelete = "true";

        const panel = document.createElement("div");
        panel.className = [
            "cph-delete-panel border border-border bg-background shadow-xl"
        ].join(" ");
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-labelledby", "cph-delete-title");

        const header = document.createElement("div");
        header.className = "cph-delete-header border-b border-border";

        const title = document.createElement("span");
        title.id = "cph-delete-title";
        title.className = "typo-text-lg_leading-none_semibold text-text_primary";
        title.textContent = "허브 프로필 삭제";

        const close = document.createElement("button");
        close.type = "button";
        close.className = "cph-hub-close hover:bg-accent active:bg-accent/80";
        close.setAttribute("aria-label", "닫기");
        close.textContent = "×";
        close.addEventListener("click", () => closeDeleteDialog());
        header.append(title, close);

        const body = document.createElement("div");
        body.className = "cph-delete-body";

        const question = document.createElement("p");
        question.className = "typo-text-base_leading-paragraph_semibold text-text_primary";
        question.textContent = "이 허브 프로필을 삭제하시겠습니까?";

        const warning = document.createElement("p");
        warning.className = "typo-text-sm_leading-paragraph_regular text-text_secondary";
        warning.textContent = "삭제된 공개 프로필은 복구할 수 없습니다.";

        const preview = document.createElement("div");
        preview.className = "cph-delete-preview bg-surface_tertiary";
        const profileName = document.createElement("span");
        profileName.className = "typo-text-base_leading-none_semibold text-text_primary";
        profileName.textContent = profile.name;
        preview.appendChild(profileName);

        if (profile.passwordProtected) {
            const passwordLabel = document.createElement("label");
            passwordLabel.className = "cph-delete-password-label text-text_secondary";
            passwordLabel.setAttribute("for", "cph-delete-password");

            const passwordText = document.createElement("span");
            passwordText.textContent = "업로드할 때 설정한 관리 비밀번호";

            const password = document.createElement("input");
            password.id = "cph-delete-password";
            password.type = "password";
            password.className = "cph-delete-password-input";
            password.placeholder = "관리 비밀번호";
            password.autocomplete = "current-password";
            password.minLength = SHARE_PASSWORD_MIN_LENGTH;
            password.maxLength = SHARE_PASSWORD_MAX_LENGTH;
            password.required = true;
            passwordLabel.append(passwordText, password);
            body.append(question, warning, preview, passwordLabel);
        } else {
            const legacyNotice = document.createElement("p");
            legacyNotice.className = "typo-text-sm_leading-paragraph_regular text-text_secondary";
            legacyNotice.textContent = legacyOwnerToken
                ? "이전 방식으로 공유한 프로필입니다. 이 브라우저에 저장된 소유권 키로 삭제합니다."
                : "이전 방식의 프로필이며 이 브라우저에 저장된 소유권 키가 없어 삭제할 수 없습니다.";
            body.append(question, warning, preview, legacyNotice);
        }

        const message = document.createElement("p");
        message.className = "cph-delete-message";
        message.setAttribute("role", "status");
        message.setAttribute("aria-live", "polite");

        const actions = document.createElement("div");
        actions.className = "cph-delete-actions";

        const cancel = makeSiteButton("취소", "cph-delete-cancel");
        const submit = makeSiteButton("삭제", "cph-delete-submit");
        submit.classList.add("cph-delete-confirm");
        submit.disabled = !canDelete;
        cancel.addEventListener("click", () => closeDeleteDialog());
        submit.addEventListener("click", () => deleteHubProfile(profile, overlay));
        actions.append(cancel, submit);
        body.append(message, actions);
        panel.append(header, body);
        overlay.appendChild(panel);

        overlay.addEventListener("click", event => {
            if (event.target === overlay && !overlay.dataset.cphSubmitting) {
                closeDeleteDialog();
            }
        });
        overlay.querySelector("#cph-delete-password")?.addEventListener("keydown", event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            deleteHubProfile(profile, overlay);
        });

        return overlay;
    }

    function openDeleteDialog(profile) {
        if (document.getElementById(DELETE_ID)) return;

        collapseHubInformation();
        document.body.appendChild(createDeleteDialog(profile));
        const password = document.querySelector(`#${DELETE_ID} #cph-delete-password`);
        if (password) password.focus();
        else document.querySelector(`#${DELETE_ID} #cph-delete-cancel`)?.focus();
    }

    function closeDeleteDialog(force = false) {
        const modal = document.getElementById(DELETE_ID);
        if (!modal || (!force && modal.dataset.cphSubmitting)) return;
        modal.remove();
    }

    function encodePasswordHeader(password) {
        const bytes = new TextEncoder().encode(password);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/g, "");
    }

    async function deleteHubProfile(profile, modal) {
        if (!modal || modal.dataset.cphSubmitting || !modal.dataset.cphCanDelete) return;

        const password = modal.querySelector("#cph-delete-password")?.value || "";
        const message = modal.querySelector(".cph-delete-message");
        const submit = modal.querySelector("#cph-delete-submit");
        const cancel = modal.querySelector("#cph-delete-cancel");

        if (profile.passwordProtected && (
            password.length < SHARE_PASSWORD_MIN_LENGTH
            || password.length > SHARE_PASSWORD_MAX_LENGTH
        )) {
            setDeleteMessage(
                message,
                `비밀번호는 ${SHARE_PASSWORD_MIN_LENGTH}~${SHARE_PASSWORD_MAX_LENGTH}자로 입력해 주세요.`
            );
            return;
        }

        modal.dataset.cphSubmitting = "true";
        modal.querySelectorAll("button, input").forEach(control => {
            control.disabled = true;
        });
        submit.querySelector("span").textContent = "삭제 중...";
        setDeleteMessage(message, "프로필을 허브에서 삭제하고 있습니다.", false);

        try {
            await ensurePasswordWorker();
            const headers = { "Accept": "application/json" };
            if (profile.passwordProtected) {
                headers["X-Profile-Password"] = encodePasswordHeader(password);
            } else {
                headers["X-Owner-Token"] = getShareOwnerToken(profile.id);
            }

            const response = await fetch(
                `${WORKER_BASE_URL}/api/profiles/${encodeURIComponent(profile.id)}`,
                { method: "DELETE", headers }
            );
            const result = await response.json().catch(() => ({}));

            if (response.status === 404 || result.error === "profile_not_found") {
                hubProfiles = hubProfiles.filter(item => item.id !== profile.id);
                removeShareOwnerToken(profile.id);
                closeDeleteDialog(true);
                renderHubProfiles();
                showHubToast("이미 삭제된 허브 프로필입니다.");
                return;
            }
            if (!response.ok) {
                if (result.error === "invalid_management_credentials") {
                    throw new Error(profile.passwordProtected
                        ? "비밀번호가 올바르지 않습니다."
                        : "이 브라우저의 소유권 키가 올바르지 않습니다.");
                }
                throw new Error(result.message || result.error || `HTTP ${response.status}`);
            }

            hubProfiles = hubProfiles.filter(item => item.id !== profile.id);
            if (hubExpandedId === profile.id) hubExpandedId = null;
            removeShareOwnerToken(profile.id);
            closeDeleteDialog(true);
            renderHubProfiles();
            showHubToast("허브 프로필을 삭제했습니다.");
        } catch (error) {
            delete modal.dataset.cphSubmitting;
            modal.querySelectorAll("button, input").forEach(control => {
                control.disabled = false;
            });
            cancel.disabled = false;
            submit.disabled = !modal.dataset.cphCanDelete;
            submit.querySelector("span").textContent = "삭제";
            setDeleteMessage(
                message,
                `삭제에 실패했습니다: ${error?.message || "알 수 없는 오류"}`
            );
            modal.querySelector("#cph-delete-password")?.focus();
        }
    }

    function setDeleteMessage(element, text, error = true) {
        if (!element) return;
        element.textContent = text;
        element.style.color = error ? "#ef4444" : "inherit";
    }

    function createHubModal() {
        const overlay = document.createElement("div");
        overlay.id = HUB_ID;
        overlay.dataset.cphOwned = "true";

        const panel = document.createElement("div");
        panel.className = [
            "cph-hub-panel border border-border bg-background shadow-xl"
        ].join(" ");
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-labelledby", "cph-hub-title");

        const header = document.createElement("div");
        header.className = "cph-hub-header border-b border-border";

        const title = document.createElement("span");
        title.id = "cph-hub-title";
        title.className = "typo-text-lg_leading-none_semibold text-text_primary";
        title.textContent = "대화 프로필 허브";

        const close = document.createElement("button");
        close.type = "button";
        close.className = "cph-hub-close hover:bg-accent active:bg-accent/80";
        close.setAttribute("aria-label", "닫기");
        close.textContent = "×";
        close.addEventListener("click", closeHub);
        header.append(title, close);

        const body = document.createElement("div");
        body.className = "cph-hub-body";

        const searchWrap = document.createElement("div");
        searchWrap.className = "cph-hub-search-wrap";

        const search = document.createElement("input");
        search.type = "search";
        search.className = "cph-hub-search typo-text-base_leading-none_medium";
        search.placeholder = "이름·정보 검색 · 태그는 #여캐플처럼 입력";
        search.setAttribute("aria-label", "허브 프로필 검색");
        search.autocomplete = "off";

        const searchIcon = document.createElement("span");
        searchIcon.className = "cph-hub-search-icon";
        searchIcon.setAttribute("aria-hidden", "true");
        searchIcon.textContent = "⌕";
        searchWrap.append(search, searchIcon);

        const meta = document.createElement("p");
        meta.className = "cph-hub-meta text-text_secondary";
        meta.setAttribute("role", "status");
        meta.setAttribute("aria-live", "polite");
        meta.textContent = "허브 프로필을 불러오는 중...";

        const results = document.createElement("div");
        results.className = "cph-hub-results";

        const grid = document.createElement("div");
        grid.className = "cph-hub-grid";
        results.appendChild(grid);

        search.addEventListener("input", () => {
            hubExpandedId = null;
            renderHubProfiles();
        });

        body.append(searchWrap, meta, results);
        panel.append(header, body);
        overlay.appendChild(panel);

        overlay.addEventListener("click", event => {
            if (event.target === overlay) {
                closeHub();
                return;
            }

            if (!(event.target instanceof Element)) return;
            if (event.target.closest(".cph-hub-card-info, .cph-hub-info-toggle")) return;
            collapseHubInformation();
        });

        return overlay;
    }

    function openHub() {
        if (document.getElementById(HUB_ID)) return;

        hubProfiles = [];
        hubExpandedId = null;
        bodyOverflowBeforeHub = document.body.style.overflow;
        document.body.appendChild(createHubModal());
        document.body.style.overflow = "hidden";
        document.querySelector(`#${HUB_ID} .cph-hub-search`)?.focus();
        loadHubProfiles();
    }

    function closeHub() {
        closeDeleteDialog(true);
        const modal = document.getElementById(HUB_ID);
        if (!modal) return;

        hubLoadController?.abort();
        hubLoadController = null;
        modal.remove();
        document.body.style.overflow = bodyOverflowBeforeHub;
        hubProfiles = [];
        hubExpandedId = null;
    }

    async function loadHubProfiles() {
        const modal = document.getElementById(HUB_ID);
        if (!modal) return;

        hubLoadController?.abort();
        const controller = new AbortController();
        hubLoadController = controller;
        hubProfiles = [];
        setHubMeta("허브 프로필을 불러오는 중...");
        renderHubProfiles(true);

        try {
            const loaded = [];
            const seen = new Set();

            for (let page = 1; page <= 100; page += 1) {
                const url = new URL(`${WORKER_BASE_URL}/api/profiles`);
                url.searchParams.set("page", String(page));
                url.searchParams.set("limit", "50");

                const response = await fetch(url, {
                    method: "GET",
                    headers: { "Accept": "application/json" },
                    signal: controller.signal
                });
                const result = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(result.message || result.error || `HTTP ${response.status}`);
                }
                if (!Array.isArray(result.items)) {
                    throw new Error("허브 응답 형식이 올바르지 않습니다.");
                }

                for (const raw of result.items) {
                    const profile = normalizeHubProfile(raw);
                    if (!profile || seen.has(profile.id)) continue;
                    seen.add(profile.id);
                    loaded.push(profile);
                }

                if (!result.hasMore) break;
            }

            if (controller.signal.aborted || !document.getElementById(HUB_ID)) return;
            hubProfiles = loaded;
            renderHubProfiles();
        } catch (error) {
            if (error?.name === "AbortError") return;
            hubProfiles = [];
            renderHubProfiles();
            setHubMeta(
                `허브를 불러오지 못했습니다: ${error?.message || "알 수 없는 오류"}`,
                true
            );
        } finally {
            if (hubLoadController === controller) hubLoadController = null;
        }
    }

    function normalizeHubProfile(raw) {
        if (!raw || typeof raw !== "object") return null;

        const id = String(raw.id || "").trim();
        const name = String(raw.name || "").trim();
        if (!id || !name) return null;

        return {
            id,
            name,
            information: String(raw.information || ""),
            passwordProtected: raw.passwordProtected === true,
            tags: Array.isArray(raw.tags)
                ? raw.tags.map(tag => String(tag).trim()).filter(Boolean)
                : [],
            downloadCount: Number(raw.downloadCount) || 0
        };
    }

    function renderHubProfiles(loading = false) {
        const modal = document.getElementById(HUB_ID);
        const grid = modal?.querySelector(".cph-hub-grid");
        const search = modal?.querySelector(".cph-hub-search");
        if (!grid || !search) return;

        const query = search.value.trim();
        const filtered = query
            ? hubProfiles.filter(profile => matchesHubSearch(profile, query))
            : hubProfiles;

        if (hubExpandedId && !filtered.some(profile => profile.id === hubExpandedId)) {
            hubExpandedId = null;
        }

        grid.replaceChildren();
        if (loading) {
            grid.appendChild(createHubEmpty("불러오는 중..."));
            return;
        }

        setHubMeta(query
            ? `검색 결과 ${filtered.length}개 · 전체 ${hubProfiles.length}개`
            : `공개 프로필 ${hubProfiles.length}개`
        );

        if (!filtered.length) {
            grid.appendChild(createHubEmpty(
                query ? "검색 결과가 없습니다." : "아직 공개된 프로필이 없습니다."
            ));
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const profile of filtered) fragment.appendChild(createHubCard(profile));
        grid.appendChild(fragment);
    }

    function matchesHubSearch(profile, query) {
        const terms = query
            .toLocaleLowerCase("ko-KR")
            .split(/\s+/)
            .filter(Boolean);
        const text = `${profile.name}\n${profile.information}`
            .toLocaleLowerCase("ko-KR");
        const tags = profile.tags.map(tag => tag.toLocaleLowerCase("ko-KR"));

        return terms.every(term => {
            if (!term.startsWith("#")) return text.includes(term);

            const tagQuery = term.slice(1);
            return !tagQuery || tags.some(tag => tag.includes(tagQuery));
        });
    }

    function createHubEmpty(text) {
        const empty = document.createElement("div");
        empty.className = "cph-hub-empty text-text_secondary";
        empty.style.gridColumn = "1 / -1";
        empty.textContent = text;
        return empty;
    }

    function createHubCard(profile) {
        const card = document.createElement("article");
        card.className = "cph-hub-card bg-surface_tertiary";
        card.dataset.cphHubProfileId = profile.id;

        const name = document.createElement("span");
        name.className = [
            "cph-hub-card-name typo-text-base_leading-none_semibold",
            "text-text_primary"
        ].join(" ");
        name.textContent = profile.name;

        const head = document.createElement("div");
        head.className = "cph-hub-card-head";

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "cph-hub-delete";
        deleteButton.textContent = "삭제";
        deleteButton.setAttribute("aria-label", `${profile.name} 허브에서 삭제`);
        deleteButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            openDeleteDialog(profile);
        });
        head.append(name, deleteButton);

        const information = document.createElement("p");
        information.className = [
            "cph-hub-card-info typo-text-md_leading-none_medium",
            "text-text_secondary"
        ].join(" ");
        information.textContent = profile.information || "정보 없음";
        information.classList.toggle("is-expanded", hubExpandedId === profile.id);
        information.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            toggleHubInformation(profile.id);
        });

        const tags = document.createElement("div");
        tags.className = "cph-hub-tags";
        const tagList = profile.tags.length ? profile.tags : ["태그 없음"];
        for (const tag of tagList) {
            const chip = document.createElement("span");
            chip.className = "cph-hub-tag text-text_secondary";
            chip.textContent = tag;
            tags.appendChild(chip);
        }

        const actions = document.createElement("div");
        actions.className = "cph-hub-actions";

        const infoButton = makeHubActionButton(
            hubExpandedId === profile.id ? "정보 접기" : "정보보기",
            "cph-hub-info-toggle"
        );
        infoButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            toggleHubInformation(profile.id);
        });

        const addButton = makeHubActionButton("추가하기");
        addButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            addHubProfile(profile, false);
        });

        const editButton = makeHubActionButton("수정하고 추가하기");
        editButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            addHubProfile(profile, true);
        });

        actions.append(infoButton, addButton, editButton);
        card.append(head, information, tags, actions);
        return card;
    }

    function makeHubActionButton(text, extraClass = "") {
        const button = makeSiteButton(text);
        button.classList.add("cph-hub-action");
        if (extraClass) button.classList.add(extraClass);
        return button;
    }

    function toggleHubInformation(profileId) {
        hubExpandedId = hubExpandedId === profileId ? null : profileId;
        updateHubInformationState();
    }

    function collapseHubInformation() {
        if (hubExpandedId === null) return;
        hubExpandedId = null;
        updateHubInformationState();
    }

    function updateHubInformationState() {
        document.querySelectorAll(`#${HUB_ID} [data-cph-hub-profile-id]`).forEach(card => {
            const expanded = card.dataset.cphHubProfileId === hubExpandedId;
            card.querySelector(".cph-hub-card-info")?.classList.toggle("is-expanded", expanded);
            const text = card.querySelector(".cph-hub-info-toggle span");
            if (text) text.textContent = expanded ? "정보 접기" : "정보보기";
        });
    }

    function setHubMeta(text, error = false) {
        const meta = document.querySelector(`#${HUB_ID} .cph-hub-meta`);
        if (!meta) return;
        meta.textContent = text;
        meta.classList.toggle("is-error", error);
    }

    async function addHubProfile(profile, openEditAfter) {
        if (hubActionBusy) return;

        if (!currentAddButton?.isConnected || !currentList?.isConnected) {
            showHubToast("원본 프로필 목록을 찾지 못했습니다. 페이지를 새로고침해 주세요.", true);
            return;
        }
        if (!profile.name || profile.name.length > 12) {
            setHubMeta("이 프로필 이름은 Crack의 12자 제한을 초과하여 추가할 수 없습니다.", true);
            return;
        }
        if (profile.information.length > 500) {
            setHubMeta("이 프로필 정보는 Crack의 500자 제한을 초과하여 추가할 수 없습니다.", true);
            return;
        }

        hubActionBusy = true;
        const originalCards = [...currentList.children].filter(isOriginalCard);
        const beforeState = {
            cards: new Set(originalCards),
            matchingCount: originalCards.filter(card =>
                cardMatchesHubProfile(card, profile)
            ).length
        };
        document.querySelectorAll(`#${HUB_ID} .cph-hub-action`).forEach(button => {
            button.disabled = true;
        });
        setHubMeta(openEditAfter ? "추가한 뒤 수정 창을 여는 중..." : "프로필을 추가하는 중...");
        closeHub();

        try {
            await submitThroughNativeAddDialog(profile);
            const addedCard = await waitForValue(
                () => findAddedProfileCard(beforeState, profile),
                10000,
                "추가된 프로필을 찾지 못했습니다."
            );

            recordHubDownload(profile.id);

            if (openEditAfter) {
                await openNativeEditDialog(addedCard);
                showHubToast("프로필을 추가하고 원본 수정 창을 열었습니다.");
            } else {
                showHubToast("프로필을 대화 프로필에 추가했습니다.");
            }
        } catch (error) {
            showHubToast(
                `프로필 추가에 실패했습니다: ${error?.message || "알 수 없는 오류"}`,
                true
            );
        } finally {
            hubActionBusy = false;
        }
    }

    async function submitThroughNativeAddDialog(profile) {
        currentAddButton.click();

        const controls = await waitForValue(() => {
            const nameInput = document.querySelector('input[placeholder="나의 이름"]');
            const informationInput = document.querySelector(
                'textarea[placeholder="나이, 성별, 외형 등"]'
            );
            const dialog = nameInput?.closest('[role="dialog"]');
            if (!dialog || !informationInput || !dialog.contains(informationInput)) return null;

            const submit = [...dialog.querySelectorAll("button")].find(button =>
                button.type === "submit" && button.textContent?.trim() === "추가"
            );
            return submit ? { nameInput, informationInput, dialog, submit } : null;
        }, 5000, "원본 프로필 추가 창을 열지 못했습니다.");

        setNativeControlValue(controls.nameInput, profile.name);
        setNativeControlValue(controls.informationInput, profile.information);
        await nextPaint();

        if (controls.submit.disabled) {
            throw new Error("원본 추가 버튼이 비활성화되어 있습니다.");
        }
        controls.submit.click();
    }

    function setNativeControlValue(element, value) {
        const prototype = element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) throw new Error("입력창 값을 설정하지 못했습니다.");

        setter.call(element, value);
        const InputEventClass = window.InputEvent || window.Event;
        element.dispatchEvent(new InputEventClass("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: value
        }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function nextPaint() {
        return new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
    }

    function waitForValue(read, timeout, timeoutMessage) {
        return new Promise((resolve, reject) => {
            let settled = false;
            let observer;
            let timer;
            let interval;

            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                observer?.disconnect();
                clearTimeout(timer);
                clearInterval(interval);
                callback(value);
            };

            const check = () => {
                try {
                    const value = read();
                    if (value) finish(resolve, value);
                } catch (error) {
                    finish(reject, error);
                }
            };

            observer = new MutationObserver(check);
            observer.observe(document.documentElement, { childList: true, subtree: true });
            interval = setInterval(check, 50);
            timer = setTimeout(
                () => finish(reject, new Error(timeoutMessage)),
                timeout
            );
            check();
        });
    }

    function findAddedProfileCard(beforeState, profile) {
        if (!currentList?.isConnected) return null;

        const cards = [...currentList.children].filter(isOriginalCard);
        const matching = cards.filter(card => cardMatchesHubProfile(card, profile));
        if (matching.length <= beforeState.matchingCount) return null;

        return matching.find(card => !beforeState.cards.has(card))
            || matching.at(-1)
            || null;
    }

    function cardMatchesHubProfile(card, profile) {
        const name = card.querySelector(
            "span.typo-text-base_leading-none_semibold"
        )?.textContent;
        const information = card.querySelector(
            "p.typo-text-md_leading-none_medium"
        )?.textContent;
        return comparableText(name) === comparableText(profile.name)
            && comparableText(information) === comparableText(profile.information);
    }

    function comparableText(value) {
        return String(value || "").trim().replace(/\s+/g, " ");
    }

    async function openNativeEditDialog(card) {
        const trigger = card?.querySelector('button[aria-haspopup="menu"]');
        if (!trigger) throw new Error("추가한 프로필의 원본 메뉴를 찾지 못했습니다.");

        const rect = trigger.getBoundingClientRect();
        const PointerEventClass = window.PointerEvent || window.MouseEvent;
        trigger.dispatchEvent(new PointerEventClass("pointerdown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: 1,
            ctrlKey: false,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true
        }));

        const editItem = await waitForValue(() => {
            const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')]
                .find(element => element.getAttribute("aria-labelledby") === trigger.id);
            return [...(menu?.querySelectorAll('[role="menuitem"]') || [])]
                .find(item => item.textContent?.trim() === "수정하기") || null;
        }, 5000, "원본 수정 메뉴를 열지 못했습니다.");

        editItem.click();
        await waitForValue(() => {
            const input = document.querySelector('input[placeholder="나의 이름"]');
            const dialog = input?.closest('[role="dialog"]');
            const title = dialog?.querySelector("h1, h2, h3")?.textContent?.trim();
            return title === "대화 프로필 수정" ? dialog : null;
        }, 5000, "원본 수정 창을 열지 못했습니다.");
    }

    async function recordHubDownload(profileId) {
        try {
            await fetch(`${WORKER_BASE_URL}/api/profiles/${encodeURIComponent(profileId)}/download`, {
                method: "POST",
                headers: { "Accept": "application/json" }
            });
        } catch (error) {
            console.warn("[ProfileHub] 추가 횟수 기록 실패", error);
        }
    }

    function showHubToast(message, error = false) {
        document.querySelectorAll('.cph-toast[data-cph-owned="true"]')
            .forEach(toast => toast.remove());

        const toast = document.createElement("div");
        toast.className = `cph-toast${error ? " is-error" : ""}`;
        toast.dataset.cphOwned = "true";
        toast.setAttribute("role", "status");
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3600);
    }

    function teardown() {
        if (activeNativeProxyCleanup) activeNativeProxyCleanup();
        closeShareDialog(true);
        closeDeleteDialog(true);
        closeHub();

        if (currentRoot?.isConnected) {
            currentRoot.querySelectorAll(OWNED_SELECTOR).forEach(element => element.remove());
            currentRoot.classList.remove("cph-page-wide");
        }

        if (currentContent?.isConnected) currentContent.classList.remove("cph-content");
        if (currentList?.isConnected) currentList.classList.remove("cph-original-list");
        if (currentAddButton?.isConnected) currentAddButton.classList.remove("cph-original-add");

        for (const profile of profiles) {
            profile.originalCard.classList.remove(
                "cph-profile-card",
                "cph-expanded-profile",
                "cph-filter-hidden"
            );
            profile.infoElement?.classList.remove("cph-profile-info");
        }

        profiles = [];
        expandedTarget = null;
        currentRoot = null;
        currentContent = null;
        currentList = null;
        currentAddButton = null;
        renderSignature = "";
    }

    function install() {
        injectStyle();

        if (!isProfileRoute()) {
            if (currentRoot) teardown();
            return;
        }

        const addButton = findOriginalAddButton();
        if (!addButton) return;

        const root = findPageRoot(addButton);
        if (!root) return;

        const content = addButton.parentElement;
        const list = findOriginalList(root, addButton);
        const rootChanged = currentRoot && (
            currentRoot !== root
            || (currentContent && currentContent !== content)
            || (currentList && list && currentList !== list)
        );

        if (rootChanged) teardown();

        currentRoot = root;
        currentAddButton = addButton;
        ensureTopScaffold(root);

        // 목록이 아직 로딩 중이어도 상단의 프로필 추가 | 허브는 먼저 표시한다.
        if (!list) return;

        currentContent = content;
        currentList = list;

        ensureProfileScaffold(content, list);
        syncProfiles(list);
        ensureShareMenuItems();
    }

    function scheduleInstall() {
        clearTimeout(observerTimer);
        observerTimer = setTimeout(install, 100);
    }

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;

        if (document.getElementById(DELETE_ID)) {
            closeDeleteDialog();
        } else if (document.getElementById(SHARE_ID)) {
            closeShareDialog();
        } else if (document.getElementById(HUB_ID)) {
            closeHub();
        } else {
            collapseExpanded();
        }
    });

    document.addEventListener("click", event => {
        if (expandedTarget === null) return;
        if (event.target instanceof Element && event.target.closest(".cph-profile-info")) {
            return;
        }

        collapseExpanded();
    });

    window.addEventListener("storage", event => {
        if (event.key === FAVORITE_KEY) {
            favorites = loadFavorites();
            updateProfileVisuals();
            renderFavorites(true);
            applySearch();
            return;
        }
    });

    const observer = new MutationObserver(() => {
        ensureShareMenuItems();
        scheduleInstall();
    });
    function startProfileHub() {
        if (!document.documentElement) {
            setTimeout(startProfileHub, 0);
            return;
        }

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        install();
    }

    startProfileHub();
})();


/*
 * 통합 구성요소: 프로필 검색 + 정보 표시 + 즐겨찾기 우선 정렬
 */
(() => {
    'use strict';

    const PAGE =
        typeof unsafeWindow !== 'undefined'
            ? unsafeWindow
            : window;

    const LOG_PREFIX = '[ProfileSearch]';

    // 'Crack 대화 프로필 허브 + 네이티브 메뉴'와 공유하는 저장 키
    const FAVORITE_KEY =
        'crack_chat_profile_favorites_v7';

    const LEGACY_FAVORITE_KEY =
        'crack_chat_profile_favorites_v6';

    const LEGACY_FAVORITE_PREFIX =
        'legacy-v6:';

    const FAVORITE_STYLE_ID =
        'profile-search-favorite-style';

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

    /*
     * 즐겨찾기 정렬 뒤에도 API 배열과 DOM option을 원래 순서로
     * 다시 매핑할 수 있도록 최초 순서를 option 자체에 보관한다.
     */
    function getOptionsInOriginalOrder(
        listbox
    ) {
        const options =
            getOptions(listbox);

        if (!options.length) {
            return [];
        }

        const indexes =
            options.map(
                option =>
                    Number(
                        option.dataset
                            .profileSearchOriginalIndex
                    )
            );

        const indexesAreValid =
            indexes.every(Number.isSafeInteger) &&
            new Set(indexes).size ===
                options.length &&
            Math.min(...indexes) === 0 &&
            Math.max(...indexes) ===
                options.length - 1;

        if (!indexesAreValid) {
            options.forEach(
                (option, index) => {
                    option.dataset
                        .profileSearchOriginalIndex =
                        String(index);
                }
            );

            return options;
        }

        return options.sort(
            (left, right) =>
                Number(
                    left.dataset
                        .profileSearchOriginalIndex
                ) -
                Number(
                    right.dataset
                        .profileSearchOriginalIndex
                )
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
     * 허브 스크립트 즐겨찾기 연동
     ********************************************************************/

    function loadFavoriteKeys() {
        try {
            const current =
                localStorage.getItem(
                    FAVORITE_KEY
                );

            if (current !== null) {
                const parsed =
                    JSON.parse(current);

                return new Set(
                    Array.isArray(parsed)
                        ? parsed
                        : []
                );
            }

            const legacy =
                JSON.parse(
                    localStorage.getItem(
                        LEGACY_FAVORITE_KEY
                    ) || '[]'
                );

            return new Set(
                Array.isArray(legacy)
                    ? legacy.map(
                        key =>
                            `${LEGACY_FAVORITE_PREFIX}${key}`
                    )
                    : []
            );
        } catch {
            return new Set();
        }
    }

    function makeFavoriteKey(
        name,
        information,
        occurrence
    ) {
        return JSON.stringify([
            name,
            information,
            occurrence
        ]);
    }

    function makeLegacyFavoriteKey(
        name,
        information
    ) {
        return (
            `${LEGACY_FAVORITE_PREFIX}` +
            `${name}::${information}`
        );
    }

    function ensureFavoriteStyles() {
        if (
            document.getElementById(
                FAVORITE_STYLE_ID
            )
        ) {
            return;
        }

        const style =
            document.createElement('style');

        style.id =
            FAVORITE_STYLE_ID;

        style.textContent = `
            [role="listbox"] [role="option"].profile-search-favorite {
                position: relative !important;
                padding-left: 30px !important;
            }

            [role="listbox"] [role="option"].profile-search-favorite::before {
                content: "★";
                position: absolute;
                left: 9px;
                top: 50%;
                transform: translateY(-50%);
                color: #f2c94c;
                font-size: 14px;
                line-height: 1;
                pointer-events: none;
            }

            [role="listbox"] [role="option"].profile-search-favorite-last {
                margin-bottom: 5px;
                border-bottom: 1px solid rgba(128, 128, 128, .24);
                border-bottom-left-radius: 0;
                border-bottom-right-radius: 0;
            }
        `;

        (
            document.head ||
            document.documentElement
        ).appendChild(style);
    }

    function prioritizeFavoriteOptions(
        listbox
    ) {
        const viewport =
            getViewport(listbox);

        const originalOptions =
            getOptionsInOriginalOrder(
                listbox
            );

        if (
            !viewport ||
            !originalOptions.length
        ) {
            return;
        }

        /*
         * 이름만으로 판단하면 동명이인이 함께 즐겨찾기가 되므로,
         * API 매핑이 끝나 information이 붙은 뒤에만 정렬한다.
         */
        if (
            !originalOptions.every(
                option =>
                    option.hasAttribute(
                        'data-profile-information'
                    )
            )
        ) {
            return;
        }

        const favoriteKeys =
            loadFavoriteKeys();

        const occurrences =
            new Map();

        const favoriteOptions =
            new Set();

        for (const option of originalOptions) {
            const name =
                getOptionName(option).trim();

            const information =
                String(
                    option.dataset
                        .profileInformation || ''
                ).trim();

            const occurrenceBase =
                `${name}::${information}`;

            const occurrence =
                (occurrences.get(
                    occurrenceBase
                ) || 0) + 1;

            occurrences.set(
                occurrenceBase,
                occurrence
            );

            if (
                favoriteKeys.has(
                    makeFavoriteKey(
                        name,
                        information,
                        occurrence
                    )
                ) ||
                favoriteKeys.has(
                    makeLegacyFavoriteKey(
                        name,
                        information
                    )
                )
            ) {
                favoriteOptions.add(option);
            }
        }

        const favoriteFirst =
            originalOptions.filter(
                option =>
                    favoriteOptions.has(option)
            );

        const remaining =
            originalOptions.filter(
                option =>
                    !favoriteOptions.has(option)
            );

        const desiredOrder = [
            ...favoriteFirst,
            ...remaining
        ];

        for (const option of originalOptions) {
            option.classList.toggle(
                'profile-search-favorite',
                favoriteOptions.has(option)
            );

            option.classList.remove(
                'profile-search-favorite-last'
            );
        }

        favoriteFirst
            .at(-1)
            ?.classList.add(
                'profile-search-favorite-last'
            );

        const currentOrder =
            getOptions(listbox);

        const alreadyOrdered =
            desiredOrder.every(
                (option, index) =>
                    currentOrder[index] ===
                    option
            );

        if (!alreadyOrdered) {
            /*
             * 원본 Radix option 노드를 이동한다.
             * 복제하지 않으므로 사이트의 선택/클릭 이벤트가 유지된다.
             */
            viewport.append(
                ...desiredOrder
            );
        }

        ensureFavoriteStyles();

        if (favoriteFirst.length) {
            requestAnimationFrame(
                () => {
                    if (viewport.isConnected) {
                        viewport.scrollTop = 0;
                    }
                }
            );
        }
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
            getOptionsInOriginalOrder(
                listbox
            );

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

        prioritizeFavoriteOptions(
            listbox
        );
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
     * 다른 탭/허브 스크립트에서 즐겨찾기가 바뀐 경우 즉시 반영
     ********************************************************************/

    function refreshFavoriteOrder() {
        for (
            const listbox
            of activeListboxes
        ) {
            if (listbox.isConnected) {
                prioritizeFavoriteOptions(
                    listbox
                );
            }
        }
    }

    window.addEventListener(
        'storage',
        event => {
            if (
                event.key === FAVORITE_KEY ||
                event.key === LEGACY_FAVORITE_KEY
            ) {
                refreshFavoriteOrder();
            }
        }
    );

    window.addEventListener(
        'cph:favorites-changed',
        refreshFavoriteOrder
    );


    /********************************************************************
     * 실행
     ********************************************************************/

    hookFetch();
    hookXHR();
    startDOMObserver();

})();
