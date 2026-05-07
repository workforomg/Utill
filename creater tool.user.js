// ==UserScript==
// @name         작자 프롬프트 크게보기
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  전송 실수 방지,
// @author       으악갹
// @match        https://crack.wrtn.ai/stories/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const style = document.createElement('style');
    style.innerHTML = `
        /* 1. 요청하신 특정 요소 삭제 (채팅 미리보기 하단부 등) */
        /* 셀렉터 내 특수문자(*, :, [, ], (, ), %)를 CSS 규격에 맞게 이스케이프 처리 */
        #__next > div > div.css-5cve9i.e1pfv5720 > div.css-tk9qev.e1pfv5720 > div > div.stick-to-bottom\.\*\:scrollbar\.h-\[calc\(100\%-48px\)\] > div > div > div.css-ypg27u.e1pfv5720 > div > div {
            display: none !important;
        }

        /* 2. 패널 및 레이아웃 전환 애니메이션 */
        .css-tk9qev,
        #__next > div > div.css-5cve9i.e1pfv5720 > div.css-dw294k.e1pfv5720 {
            transition: all 0.4s ease-in-out !important;
        }

        /* 3. 오른쪽 패널 숨김 상태 */
        .wrtn-full-mode .css-tk9qev {
            width: 0px !important;
            min-width: 0px !important;
            flex: 0 0 0px !important;
            transform: translateX(100%);
            opacity: 0;
            overflow: hidden !important;
        }

        /* 4. 왼쪽 패널 전체 확장 */
        .wrtn-full-mode #__next > div > div.css-5cve9i.e1pfv5720 > div.css-dw294k.e1pfv5720 {
            width: 100% !important;
            max-width: 100% !important;
            flex: 1 1 100% !important;
        }

        /* 5. 입력창 영역 자동 크기 조절 */
        .wrtn-full-mode #__next > div > div.css-5cve9i.e1pfv5720 > div.css-dw294k.e1pfv5720 div.gap-2.css-j7qwjs.e1pfv5720 > div.flex.w-full.flex-col.rounded-lg {
            height: auto !important;
            min-height: 60vh !important; /* 화면 높이의 60% 사용 */
        }

        .wrtn-full-mode #__next > div > div.css-5cve9i.e1pfv5720 > div.css-dw294k.e1pfv5720 textarea {
            height: 55vh !important;
            min-height: 400px !important;
            max-height: none !important;
        }

        /* 6. 토글 버튼 (화면 우측 중앙 고정) */
        #custom-wrtn-toggle {
            position: fixed !important;
            right: 0 !important;
            top: 50% !important;
            transform: translateY(-50%) !important;
            z-index: 999999 !important;
            width: 20px;
            height: 80px;
            background-color: #ff4d4d !important;
            color: white !important;
            border-radius: 10px 0 0 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            box-shadow: -2px 0 12px rgba(0,0,0,0.3);
        }
    `;
    document.head.appendChild(style);

    function createToggle() {
        if (document.getElementById('custom-wrtn-toggle')) return;
        if (!document.querySelector('.css-tk9qev')) return;

        const btn = document.createElement('div');
        btn.id = 'custom-wrtn-toggle';
        btn.innerHTML = '◀';
        document.body.appendChild(btn);

        btn.addEventListener('click', () => {
            const isActive = document.body.classList.toggle('wrtn-full-mode');
            btn.innerHTML = isActive ? '▶' : '◀';
            btn.style.backgroundColor = isActive ? '#333' : '#ff4d4d';
            window.dispatchEvent(new Event('resize'));
        });
    }

    const observer = new MutationObserver(() => {
        createToggle();
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
