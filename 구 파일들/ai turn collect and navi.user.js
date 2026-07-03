// ==UserScript==
// @name         ai turn collect and navi
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  ai출력 턴 수집 및 네비게이터
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const CHAT_CONTAINER_SELECTOR = '.flex.flex-col-reverse.w-full.gap-10';
    let isAutoLoading = false;

    // AI 출력 턴만 정밀 필터링 (구조 기준)
    function getAITurns() {
        const chatContainer = document.querySelector(CHAT_CONTAINER_SELECTOR);
        if (!chatContainer) return [];

        return Array.from(chatContainer.children).filter(child => {
            const hasUserBorder = child.querySelector('.border-y');
            const hasUserWidth = child.querySelector('.w-auto');
            if (hasUserBorder || hasUserWidth) return false;

            return child.querySelector('.rounded-none, .px-0');
        });
    }

    // 최하단 스크롤 복귀 함수
    function scrollToBottom() {
        const chatContainer = document.querySelector(CHAT_CONTAINER_SELECTOR);
        if (!chatContainer) return;
        window.scrollTo(0, document.body.scrollHeight);
        let parent = chatContainer.parentElement;
        while (parent && parent !== document.body) {
            if (parent.scrollHeight > parent.clientHeight) {
                parent.scrollTop = parent.scrollHeight;
            }
            parent = parent.parentElement;
        }
    }

    // 특정 턴 수로 스크롤 점프하는 내비게이션 로직
    function jumpToTurn(turnNum) {
        const aiTurns = getAITurns();
        if (aiTurns.length === 0) {
            alert('감지된 AI 대화 내역이 없습니다.');
            return;
        }

        // 1. 시스템 로그 블록에 표기된 고유 번호 [X] 검색
        let target = aiTurns.find(el => el.innerText.includes(`[${turnNum}]`));

        // 2. 상태창이 없는 일반 턴일 경우, 과거부터 쌓인 순서(1번부터 시작) 기준으로 추적
        if (!target) {
            const chronological = [...aiTurns].reverse();
            target = chronological[turnNum - 1];
        }

        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // 일시적 하이라이트 효과 부여 (위치 인지용)
            const originalBg = target.style.backgroundColor;
            target.style.transition = 'background-color 0.3s';
            target.style.backgroundColor = 'rgba(255, 99, 1, 0.15)';
            setTimeout(() => { target.style.backgroundColor = originalBg; }, 1200);
        } else {
            alert(`[${turnNum}] 턴을 찾을 수 없습니다. '과거 로딩'을 실행하여 내역을 더 확장해 보세요.`);
        }
    }

    // 중앙에 삽입될 UI 컴포넌트 생성
    function createNavPanel() {
        const panel = document.createElement('div');
        panel.id = 'wrtn-nav-panel';
        panel.style = `
            display: flex;
            align-items: center;
            gap: 6px;
            background-color: var(--surface_tertiary, #24292e);
            padding: 2px 10px;
            border-radius: 14px;
            border: 1px solid var(--border, #333333);
            font-family: sans-serif;
            font-size: 11px;
            color: var(--text_primary, #ffffff);
            margin: 0 auto;
            pointer-events: auto;
        `;

        // 턴수 배지
        const badge = document.createElement('span');
        badge.id = 'wrtn-nav-count';
        badge.innerText = 'AI: - 턴';
        badge.style.color = '#ffab70';
        badge.style.fontWeight = 'bold';

        // 자동 상단 로더 버튼
        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.innerText = '과거 로딩';
        loadBtn.style = `
            background-color: #ff4432;
            color: white;
            border: none;
            padding: 2px 6px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            font-size: 10px;
        `;

        loadBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const chatContainer = document.querySelector(CHAT_CONTAINER_SELECTOR);
            if (!chatContainer) return;

            if (isAutoLoading) {
                isAutoLoading = false;
                scrollToBottom();
                return;
            }

            isAutoLoading = true;
            loadBtn.innerText = '중지';
            loadBtn.style.backgroundColor = '#555555';

            let unchangedStreak = 0;
            let lastTotalCount = chatContainer.children.length;

            while (isAutoLoading) {
                const currentContainer = document.querySelector(CHAT_CONTAINER_SELECTOR);
                if (!currentContainer) break;

                window.scrollTo(0, 0);
                let parent = currentContainer.parentElement;
                while (parent && parent !== document.body) {
                    if (parent.scrollHeight > parent.clientHeight) parent.scrollTop = 0;
                    parent = parent.parentElement;
                }

                await new Promise(resolve => setTimeout(resolve, 900));
                const currentTotalCount = currentContainer.children.length;

                if (currentTotalCount === lastTotalCount) {
                    unchangedStreak++;
                    if (unchangedStreak >= 3) break;
                } else {
                    unchangedStreak = 0;
                    lastTotalCount = currentTotalCount;
                }
            }

            isAutoLoading = false;
            loadBtn.innerText = '과거 로딩';
            loadBtn.style.backgroundColor = '#ff4432';
            scrollToBottom();
        });

        // 이동 입력 폼
        const input = document.createElement('input');
        input.type = 'number';
        input.placeholder = '번호';
        input.min = '1';
        input.style = `
            width: 40px;
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid #555;
            border-radius: 4px;
            color: white;
            text-align: center;
            font-size: 10px;
            padding: 1px 0;
            outline: none;
        `;

        const goBtn = document.createElement('button');
        goBtn.type = 'button';
        goBtn.innerText = '이동';
        goBtn.style = `
            background-color: rgb(255, 99, 1);
            color: white;
            border: none;
            padding: 2px 6px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            font-size: 10px;
        `;
        goBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (input.value) {
                jumpToTurn(parseInt(input.value, 10));
            }
        });

        panel.appendChild(badge);
        panel.appendChild(loadBtn);
        panel.appendChild(input);
        panel.appendChild(goBtn);

        return panel;
    }

    // SPA 하단 바 갱신 지속 감시 루프
    setInterval(() => {
        // '추천답변' 컴포넌트가 담겨 있는 내부 컨트롤 행 타깃팅
        const targetRow = Array.from(document.querySelectorAll('.flex.items-center.justify-between'))
                               .find(el => el.querySelector('button') && el.innerText.includes('추천답변'));

        if (targetRow) {
            let panel = targetRow.querySelector('#wrtn-nav-panel');

            // 페이지 초기화, 새로고침 등으로 유저 UI가 증발한 경우 한가운데 위치로 강제 재구축
            if (!panel) {
                panel = createNavPanel();
                if (targetRow.children.length >= 2) {
                    targetRow.insertBefore(panel, targetRow.children[1]); // 추천답변과 우측 전송 아이콘 정중앙 사이에 안착
                } else {
                    targetRow.appendChild(panel);
                }
            }

            // 카운트 정보 실시간 리프레시
            const badge = panel.querySelector('#wrtn-nav-count');
            if (badge) {
                badge.innerText = `AI: ${getAITurns().length} 턴`;
            }
        }
    }, 750);

})();
