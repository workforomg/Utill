// ==UserScript==
// @name         like list search
// @namespace    https://github.com/workforomg/Util
// @version      1.0
// @description  제목, @제작자, #태그(#언세이프, #세이프, #내부이미지) 필터링
// @author       으악갹
// @match        https://crack.wrtn.ai/liked
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    GM_addStyle(`
        .custom-search-container {
            padding: 10px 0;
            width: 100%;
        }
        .custom-search-input {
            width: 100%;
            padding: 12px 15px;
            border-radius: 10px;
            border: 1px solid var(--outline_tertiary, #e0e0e0);
            background-color: var(--bg_secondary, transparent);
            color: var(--text_primary, #000);
            font-size: 14px;
            outline: none;
            transition: all 0.2s ease;
        }
        .custom-search-input:focus {
            border-color: var(--button_primary_default, #fb475d);
            box-shadow: 0 0 0 1px var(--button_primary_default, #fb475d);
        }
    `);

    const PATH_UNSAFE = "m20.7 4.47-8.3-2.68c-.26-.08-.54-.08-.8 0L3.3 4.47c-.54.18-.9.68-.9 1.24v4.12c0 5.74 3.69 10.81 9.18 12.61.13.05.28.07.42.07s.28-.02.42-.07c5.49-1.8 9.18-6.87 9.18-12.61V5.71c0-.56-.36-1.06-.9-1.24M12 6.28c1.83 0 3.31 1.48 3.31 3.31S13.83 12.9 12 12.9s-3.31-1.49-3.31-3.31S10.17 6.28 12 6.28m4.35 12a9 9 0 0 1-.58.51c-.03.03-.07.06-.11.08-.06.06-.13.12-.2.16-.06.06-.13.11-.2.15 0 .01-.01.01-.02.02l-.1.07c-.94.69-2 1.23-3.14 1.62-1.66-.55-3.12-1.45-4.34-2.61a9.3 9.3 0 0 1-1.09-1.17c1.42-1.34 3.67-1.83 5.41-1.83s4.02.49 5.44 1.83c-.32.41-.68.81-1.07 1.17";
    const PATH_INTERNAL_IMAGE = "M8.41 18.7c-1.71 0-3.1-1.39-3.1-3.1V6.71h-1.4c-.94 0-1.7.76-1.7 1.7V20.1c0 .94.76 1.7 1.7 1.7H15.6c.94 0 1.7-.76 1.7-1.7v-1.4z";

    function initSearch() {
        const titleElement = document.querySelector('.css-1247dq3');
        if (!titleElement || document.getElementById('wrtn-search-input')) return;

        const searchContainer = document.createElement('div');
        searchContainer.className = 'custom-search-container';

        const searchInput = document.createElement('input');
        searchInput.id = 'wrtn-search-input';
        searchInput.className = 'custom-search-input';
        searchInput.placeholder = '제목, @제작자, #언세이프, #세이프, #내부이미지...';

        searchContainer.appendChild(searchInput);
        titleElement.after(searchContainer);

        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const storyCards = document.querySelectorAll('.css-543uqt');

            storyCards.forEach(card => {
                const titleText = card.querySelector('.css-17mvpg1')?.textContent.toLowerCase() || "";
                const authorText = card.querySelector('.css-fo3pet')?.textContent.toLowerCase() || "";

                const paths = Array.from(card.querySelectorAll('svg path')).map(p => p.getAttribute('d'));
                const hasUnsafe = paths.some(d => d && d.includes(PATH_UNSAFE));
                const hasInternalImage = paths.some(d => d && d.includes(PATH_INTERNAL_IMAGE));

                let isMatch = false;

                if (query.startsWith('#')) {
                    if (query === '#언세이프') {
                        isMatch = hasUnsafe;
                    } else if (query === '#세이프') {
                        // 언세이프 아이콘이 없을 때만 매칭
                        isMatch = !hasUnsafe;
                    } else if (query === '#내부이미지') {
                        isMatch = hasInternalImage;
                    }
                } else if (query.startsWith('@')) {
                    const authorQuery = query.substring(1);
                    isMatch = authorText.includes(authorQuery);
                } else {
                    isMatch = titleText.includes(query);
                }

                card.style.display = isMatch ? 'flex' : 'none';
            });
        });
    }

    const observer = new MutationObserver(() => {
        initSearch();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
