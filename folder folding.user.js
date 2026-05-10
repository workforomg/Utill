// ==UserScript==
// @name         folder folding
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  보관함 클릭 시 내부 요소 폴딩
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1. 셀렉터 정의 (제시해주신 경로)
    const BUTTON_SELECTOR = '#__next > div > div.css-swctim.e1pfv5720 > div > div > div.flex.flex-col.w-full.h-full.min-h-full.overflow-hidden.sticky.top-0 > div.flex-1.min-w-0.min-h-0.overflow-hidden.flex.flex-col > div > div > div > div:nth-child(1) > div > div.relative > div > div.flex.items-center.gap-2.h-7.pl-2 > span';
    const TARGET_SELECTOR = '#__next > div > div.css-swctim.e1pfv5720 > div > div > div.flex.flex-col.w-full.h-full.min-h-full.overflow-hidden.sticky.top-0 > div.flex-1.min-w-0.min-h-0.overflow-hidden.flex.flex-col > div > div > div > div:nth-child(1) > div > div.relative > div > div.flex.flex-col';

    // 2. 요소가 로드될 때까지 기다렸다가 실행하는 함수
    const initToggle = () => {
        const btn = document.querySelector(BUTTON_SELECTOR);
        const target = document.querySelector(TARGET_SELECTOR);

        if (btn && target) {
            // 클릭하기 편하게 커서 모양 변경 및 스타일 수정
            btn.style.cursor = 'pointer';
            btn.style.userSelect = 'none';
            btn.title = '클릭하여 접기/펴기';

            // 클릭 이벤트 리스너 추가
            btn.onclick = (e) => {
                e.preventDefault();
                if (target.style.display === 'none') {
                    target.style.display = 'flex'; // 원래 flex였으므로 flex로 복구
                } else {
                    target.style.display = 'none';
                }
            };

            console.log('접기/펴기 버튼 활성화 완료!');
        }
    };

    // 페이지가 동적으로 로드될 수 있으므로 감시 로직 추가 (MutationObserver)
    const observer = new MutationObserver(() => {
        if (document.querySelector(BUTTON_SELECTOR)) {
            initToggle();
            observer.disconnect(); // 요소를 찾으면 감시 중단
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
