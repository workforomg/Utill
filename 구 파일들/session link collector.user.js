// ==UserScript==
// @name         session link collector
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  세션링크 수집 및 저장.
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let collectedLinks = new Map();
    let isScrolling = false;
    let scrollTimer = null;

    // 1. 수집 로직
    function scanItems() {
        const items = document.querySelectorAll('div[data-index]');
        items.forEach(item => {
            const index = item.getAttribute('data-index');
            const linkTag = item.querySelector('a');
            if (linkTag && !collectedLinks.has(index)) {
                const href = linkTag.href;
                const title = item.querySelector('.typo-text-sm_leading-none_medium')?.innerText || '제목 없음';
                collectedLinks.set(index, { index: parseInt(index), title, href });
            }
        });
    }

    function downloadResults() {
        if (collectedLinks.size === 0) return alert("수집된 데이터가 없습니다.");
        const sortedArray = Array.from(collectedLinks.values()).sort((a, b) => a.index - b.index);
        const text = sortedArray.map(item => `[${item.index}] ${item.title}: ${item.href}`).join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `links_export_${new Date().getTime()}.txt`;
        a.click();
    }

    // 2. 자동화 및 버튼 상태 제어
    function toggleCollection(btn) {
        if (isScrolling) {
            stopAndSave(btn);
        } else {
            startAutoScroll(btn);
        }
    }

    function startAutoScroll(btn) {
        collectedLinks.clear();
        isScrolling = true;
        btn.innerText = "🛑 수집 중단 및 저장";
        btn.style.backgroundColor = "#fee2e2"; // 연한 레드 (경고/중단 느낌)
        btn.style.color = "#ef4444";

        const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
        if (!scroller) return alert("스크롤러를 찾을 수 없습니다.");

        let lastScrollTop = -1;
        let lastCount = 0;
        let idleCycles = 0;

        scrollTimer = setInterval(() => {
            scanItems();
            const currentScrollTop = scroller.scrollTop;
            const currentCount = collectedLinks.size;

            scroller.scrollTop += 800;

            if (currentScrollTop === lastScrollTop || (currentCount === lastCount && currentCount > 0)) {
                idleCycles++;
            } else {
                idleCycles = 0;
            }

            lastScrollTop = currentScrollTop;
            lastCount = currentCount;

            if (idleCycles >= 6) stopAndSave(btn);
            console.log(`수집 중... ${currentCount}개 완료`);
        }, 500);
    }

    function stopAndSave(btn) {
        clearInterval(scrollTimer);
        isScrolling = false;
        btn.innerText = "🔗 모든 링크 추출 시작";
        btn.style.backgroundColor = "#f3f4f6"; // 원래 테마색으로 복구
        btn.style.color = "#374151";
        downloadResults();
    }

    // 3. 버튼 생성 및 삽입 (지정한 셀렉터 최상단)
    function injectButton() {
        const targetSelector = "#__next > div > div.css-swctim.e1pfv5720 > div > div > div.flex.flex-col.w-full.h-full.min-h-full.overflow-hidden.sticky.top-0";
        const container = document.querySelector(targetSelector);

        if (container && !document.getElementById('theme-collect-btn')) {
            const btn = document.createElement('button');
            btn.id = 'theme-collect-btn';
            btn.innerText = "🔗 모든 링크 추출 시작";

            // 페이지 테마에 맞춘 스타일링 (Tailwind 스타일 참고)
            Object.assign(btn.style, {
                width: 'calc(100% - 20px)',
                margin: '10px',
                padding: '12px',
                backgroundColor: '#f3f4f6', // 하이라이트된 ivory/gray 느낌
                color: '#374151',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.2s ease',
                display: 'block',
                flexShrink: '0' // flex 컨테이너 내부에서 찌그러지지 않게
            });

            // 호버 효과
            btn.onmouseover = () => btn.style.backgroundColor = '#e5e7eb';
            btn.onmouseout = () => {
                if(!isScrolling) btn.style.backgroundColor = '#f3f4f6';
            };

            btn.onclick = () => toggleCollection(btn);

            // 컨테이너의 최상단(첫 번째 자식)으로 삽입
            container.prepend(btn);
            console.log("추출 버튼이 테마에 맞게 삽입되었습니다.");
        }
    }

    // 페이지 로딩 및 동적 변경 대응
    const observer = new MutationObserver(injectButton);
    observer.observe(document.body, { childList: true, subtree: true });
    injectButton();

})();
