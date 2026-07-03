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

    // 셀렉터 정의
    const BUTTON_SELECTOR = '#__next > div > div.css-swctim.e1pfv5720 > div > div > div.flex.flex-col.w-full.h-full.min-h-full.overflow-hidden.sticky.top-0 > div.flex-1.min-w-0.min-h-0.overflow-hidden.flex.flex-col > div > div > div > div:nth-child(1) > div > div.relative > div > div.flex.items-center.gap-2.h-7.pl-2 > span';
    const TARGET_SELECTOR = '#__next > div > div.css-swctim.e1pfv5720 > div > div > div.flex.flex-col.w-full.h-full.min-h-full.overflow-hidden.sticky.top-0 > div.flex-1.min-w-0.min-h-0.overflow-hidden.flex.flex-col > div > div > div > div:nth-child(1) > div > div.relative > div > div.flex.flex-col';

    // 1. 스타일 강제 주입 (요소가 새로 그려져도 마우스 커서는 유지되도록)
    const style = document.createElement('style');
    style.innerHTML = `${BUTTON_SELECTOR} { cursor: pointer !important; user-select: none; }`;
    document.head.appendChild(style);

    // 2. 이벤트 위임: document 전체에서 클릭을 감시
    document.addEventListener('click', function(e) {
        // 클릭된 요소가 우리가 원하는 버튼(span)인지 확인
        const btn = e.target.closest(BUTTON_SELECTOR);
        
        if (btn) {
            const target = document.querySelector(TARGET_SELECTOR);
            if (target) {
                // 토글 로직
                if (target.style.display === 'none') {
                    target.style.display = 'flex';
                } else {
                    target.style.display = 'none';
                }
            }
        }
    }, true); // true: 캡처링 단계에서 실행하여 다른 이벤트와 충돌 방지

    console.log('접기/펴기 스크립트가 상시 대기 중입니다.');
})();
