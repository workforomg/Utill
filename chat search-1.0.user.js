// ==UserScript==
// @name         chat search
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  채팅방 검색
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==


(function() {
    'use strict';

    // 스타일 설정
    const style = document.createElement('style');
    style.innerHTML = `
        #custom-search-container {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background-color: transparent;
            border-bottom: 1px solid var(--border);
            gap: 8px;
        }
        #custom-search-wrapper {
            display: flex;
            align-items: center;
            width: 100%;
            background-color: rgba(128, 128, 128, 0.1);
            border-radius: 6px;
            padding: 4px 8px;
            border: 1px solid transparent;
            transition: border 0.2s;
        }
        #custom-search-wrapper:focus-within {
            border: 1px solid var(--primary, #00bbff);
        }
        #custom-search-input {
            border: none;
            background: none;
            outline: none;
            color: inherit;
            font-size: 13px;
            width: 100%;
            margin-left: 4px;
        }
        .search-icon {
            font-size: 14px;
            opacity: 0.6;
        }
    `;
    document.head.appendChild(style);

    // 텍스트에서 공백을 제거하고 소문자로 변환하는 함수
    const normalize = (text) => text.toLowerCase().replace(/\s+/g, '');

    function initSearch() {
        const banner = document.querySelector('.css-ui1qcz.eh9908w0');
        if (!banner || document.getElementById('custom-search-container')) return;

        const searchContainer = document.createElement('div');
        searchContainer.id = 'custom-search-container';
        searchContainer.innerHTML = `
            <div id="custom-search-wrapper">
                <span class="search-icon">🔍</span>
                <input type="text" id="custom-search-input" placeholder="공백 없이 검색해도 다 찾아요!">
            </div>
        `;

        banner.parentNode.insertBefore(searchContainer, banner.nextSibling);

        const searchInput = document.getElementById('custom-search-input');
        searchInput.addEventListener('input', function(e) {
            const keyword = normalize(e.target.value); // 검색어 공백 제거
            const chatItems = document.querySelectorAll('a[href*="/stories/"]');
            const folders = document.querySelectorAll('.my-folder-wrapper');

            chatItems.forEach(item => {
                const charName = item.querySelector('.chat-list-item-character-name')?.textContent || "";
                const topic = item.querySelector('.chat-list-item-topic')?.textContent || "";

                // 대상 텍스트들도 공백을 제거하고 비교
                const normalizedCharName = normalize(charName);
                const normalizedTopic = normalize(topic);

                if (normalizedCharName.includes(keyword) || normalizedTopic.includes(keyword)) {
                    item.style.setProperty('display', 'flex', 'important');
                } else {
                    item.style.setProperty('display', 'none', 'important');
                }
            });

            // 폴더 표시 여부 결정
            folders.forEach(folder => {
                const visibleItems = folder.querySelectorAll('a[href*="/stories/"]:not([style*="display: none"])');
                if (visibleItems.length === 0 && keyword !== "") {
                    folder.style.display = 'none';
                } else {
                    folder.style.display = 'block';
                }
            });
        });
    }

    const observer = new MutationObserver(() => {
        initSearch();
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();