// ==UserScript==
// @name         Story list Addon(auto edit)
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  폴더생성, 자동 이름 분류.
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 1. 설정: 리스트가 들어있는 컨테이너 클래스
    const containerSelector = '.css-ks2xqc';
    // 2. 설정: 개별 아이템(링크) 선택자
    const itemSelector = 'a[href*="/stories/"]';

    function groupEpisodes() {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        // 아직 처리 안 된 아이템 찾기
        const items = container.querySelectorAll(`${itemSelector}:not(.processed-item)`);

        items.forEach(item => {
            item.classList.add('processed-item');

            // URL에서 스토리 ID 추출
            const href = item.getAttribute('href');
            const match = href.match(/\/stories\/([a-zA-Z0-9]+)\//);
            if (!match) return;
            const storyId = match[1];

            // 텍스트 정리 (줄바꿈 제거 및 길이 제한)
            let rawText = item.innerText.trim();
            let titleText = rawText.split('\n')[0];
            if(titleText.length > 30) titleText = titleText.substring(0, 30) + "...";

            // 그룹 찾거나 생성
            let group = document.getElementById(`story-group-${storyId}`);
            let contentArea;

            if (!group) {
                // --- 그룹 생성 ---
                group = document.createElement('div');
                group.id = `story-group-${storyId}`;
                group.className = 'story-group-wrapper';

                // 헤더 버튼
                const btn = document.createElement('button');
                btn.className = 'story-group-btn';
                btn.innerHTML = `
                    <span class="btn-icon">📁</span>
                    <span class="btn-title">${titleText}</span>
                    <span class="btn-badge">1</span>
                `;

                // 내용 박스
                contentArea = document.createElement('div');
                contentArea.className = 'story-group-content';

                // 클릭 이벤트
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    btn.classList.toggle('active');
                    if (contentArea.style.maxHeight) {
                        contentArea.style.maxHeight = null;
                        contentArea.classList.remove('open');
                    } else {
                        contentArea.style.maxHeight = contentArea.scrollHeight + "px";
                        contentArea.classList.add('open');
                    }
                });

                group.appendChild(btn);
                group.appendChild(contentArea);
                item.parentNode.insertBefore(group, item);
            } else {
                contentArea = group.querySelector('.story-group-content');
            }

            // 아이템 이동
            contentArea.appendChild(item);

            // 뱃지 업데이트
            const count = contentArea.children.length;
            const badge = group.querySelector('.btn-badge');
            if (badge) badge.innerText = `${count}`;
        });
    }

    // 1초마다 감지
    setInterval(groupEpisodes, 1000);

    // --- 🎨 CSS: 색상을 고정하지 않고 '반투명'과 '상속'을 사용 ---
    GM_addStyle(`
        /* 1. 전체 박스 */
        .story-group-wrapper {
            margin-bottom: 10px;
            /* 배경: 검정색의 5% 투명도 (다크모드에선 어둡게, 라이트에선 거의 투명하게 보임) */
            /* 만약 사이트 카드 색을 흉내내고 싶다면 inherit을 사용 */
            background-color: rgba(125, 125, 125, 0.08);
            border: 1px solid rgba(125, 125, 125, 0.2);
            border-radius: 8px;
            overflow: hidden;
            /* 글자색: 사이트 기본 설정을 따라감 (자동 적응 핵심) */
            color: inherit;
        }

        /* 2. 버튼 (헤더) */
        .story-group-btn {
            width: 100%;
            padding: 12px 15px;
            /* 버튼 배경: 회색의 10% 농도 -> 어떤 테마든 자연스러운 회색빛 */
            background-color: rgba(125, 125, 125, 0.1);
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            font-size: 15px;
            font-weight: 600;
            text-align: left;
            /* 글자색 상속 */
            color: inherit;
            transition: background 0.2s;
        }

        .story-group-btn:hover {
            background-color: rgba(125, 125, 125, 0.2);
        }

        .story-group-btn.active {
            background-color: rgba(125, 125, 125, 0.25);
            border-bottom: 1px solid rgba(125, 125, 125, 0.1);
        }

        /* 제목 */
        .btn-title {
            flex: 1;
            margin-left: 8px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* 뱃지 (숫자) */
        .btn-badge {
            background-color: rgba(125, 125, 125, 0.3);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
            color: inherit; /* 뱃지 글자도 테마 따라감 */
            opacity: 0.8;
        }

        /* 3. 내용 박스 */
        .story-group-content {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease-out;
            background-color: rgba(0, 0, 0, 0.02); /* 아주 미세하게 어둡게 */
        }

        /* 내용물 링크 스타일 보정 */
        .story-group-content a {
            display: block !important;
            padding: 10px 15px !important;
            border-bottom: 1px solid rgba(125, 125, 125, 0.1) !important;
            color: inherit !important; /* 중요: 링크 색도 사이트 테마 따라가기 */
            text-decoration: none !important;
            opacity: 0.9;
        }

        .story-group-content a:hover {
            background-color: rgba(125, 125, 125, 0.15) !important;
        }

        .story-group-content a:last-child {
            border-bottom: none !important;
        }
    `);
})();
