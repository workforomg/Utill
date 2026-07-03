// ==UserScript==
// @name         크랙용 댓글 기록
// @namespace    https://github.com/workforomg/Utill
// @author       으악갹, gemini
// @version      1.0
// @description  유저 제공 풀 셀렉터 정밀 반영 + 댓글 서치 최적화 + 개별 삭제
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const DB_KEY = 'WRTN_CUSTOM_COMMENTS_DB';
    const NICK_KEY = 'WRTN_MY_SAVED_NICKNAME';
    const TARGET_TEXT_KEY = 'WRTN_TARGET_COMMENT_TEXT';
    const SCROLLER_ID = '#story-detail-scroll';

    // [수정] 제공해주신 풀 셀렉터 기반 핵심 경로
    const COMMENT_CONTAINER_SELECTOR = 'div.flex.flex-col.rounded-\\[12px\\].overflow-hidden';
    const NICK_SPAN_SELECTOR = 'span.typo-text-md_leading-none_medium.text-text_secondary.cursor-pointer';

    let foundElements = [];
    let currentIndex = -1;
    let isScanning = false;

    const getDB = () => JSON.parse(localStorage.getItem(DB_KEY)) || {};
    const getCleanTitle = () => document.title.split(/ [\|-] /)[0].trim();

    const findWorkThumb = () => {
        const img = document.querySelector('#story-detail-scroll img.object-contain.z-\\[1\\]');
        if (img && img.src) return img.src;
        const fallback = document.querySelector('#story-detail-scroll .aspect-\\[2\\/3\\] img:not(.blur-md)');
        return fallback ? fallback.src : "";
    };

    window.goToStory = function(url, text) {
        sessionStorage.setItem(TARGET_TEXT_KEY, text);
        window.location.href = url + (url.includes('?') ? '&' : '?') + "targetMode=true";
    };

    window.deleteStoryRecord = function(workName) {
        if (!confirm(`'${workName}'의 기록을 삭제할까요?`)) return;
        const nick = localStorage.getItem(NICK_KEY);
        let db = getDB();
        if (db[nick]) {
            db[nick] = db[nick].filter(item => item.work !== workName);
            localStorage.setItem(DB_KEY, JSON.stringify(db));
            location.reload();
        }
    };

    async function startManualProcess() {
        if (isScanning) return;
        const scroller = document.querySelector(SCROLLER_ID);
        const btn = document.getElementById('find-my-btn');
        const targetText = sessionStorage.getItem(TARGET_TEXT_KEY);
        if (!scroller) return;

        try {
            isScanning = true;
            btn.innerText = "스캔 중...";
            btn.disabled = true;

            let lastH = 0, noChangeCount = 0;
            for (let i = 0; i < 30; i++) {
                scroller.scrollTo(0, scroller.scrollHeight);
                await new Promise(r => setTimeout(r, 1000));
                if (scroller.scrollHeight === lastH) { if (++noChangeCount >= 2) break; }
                else { noChangeCount = 0; }
                lastH = scroller.scrollHeight;
                btn.innerText = `데이터 로드 중 (${i + 1}/30)`;
            }

            let nick = localStorage.getItem(NICK_KEY);
            const thumb = findWorkThumb();
            const work = getCleanTitle();
            const url = window.location.origin + window.location.pathname;

            // [수정] 컨테이너 내부의 모든 직계 자식(댓글 블록)을 탐색
            const containers = scroller.querySelectorAll(COMMENT_CONTAINER_SELECTOR);
            foundElements = [];

            containers.forEach(container => {
                const blocks = container.children;
                Array.from(blocks).forEach(block => {
                    const nickSpan = block.querySelector(NICK_SPAN_SELECTOR);
                    if (nickSpan) {
                        const foundNick = nickSpan.innerText.trim();
                        // 닉네임 최초 학습 및 갱신
                        if ((!nick || nick === "닉네임") && foundNick) {
                            nick = foundNick;
                            localStorage.setItem(NICK_KEY, nick);
                        }
                        if (foundNick === nick) {
                            foundElements.push(block);
                        }
                    }
                });
            });

            if (foundElements.length > 0 && nick) {
                let db = getDB();
                if (!db[nick]) db[nick] = [];
                foundElements.forEach(el => {
                    const text = el.innerText.replace(nick, "").trim();
                    const existingIdx = db[nick].findIndex(o => o.text === text && o.work === work);
                    if (existingIdx > -1) db[nick][existingIdx].thumb = thumb;
                    else db[nick].push({ text, work, url, thumb });
                });
                localStorage.setItem(DB_KEY, JSON.stringify(db));

                btn.style.display = 'none';
                document.getElementById('search-nav').style.display = 'flex';
                currentIndex = 0;
                if (targetText) {
                    const matchIdx = foundElements.findIndex(el => el.innerText.includes(targetText.trim()));
                    if (matchIdx !== -1) currentIndex = matchIdx;
                    sessionStorage.removeItem(TARGET_TEXT_KEY);
                }
                navigate(0);
            } else {
                btn.innerText = nick ? "내 댓글 없음" : "닉네임 인식 실패";
                setTimeout(resetSearchUI, 2000);
            }
        } finally { isScanning = false; }
    }

    function navigate(dir) {
        if (foundElements.length === 0) return;
        currentIndex = (currentIndex + dir + foundElements.length) % foundElements.length;
        const target = foundElements[currentIndex];
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const oldBg = target.style.backgroundColor;
        target.style.transition = "background-color 0.4s";
        target.style.backgroundColor = "rgba(59, 130, 246, 0.2)";
        target.style.borderLeft = "6px solid #3b82f6";
        setTimeout(() => { target.style.backgroundColor = oldBg; target.style.borderLeft = ""; }, 3000);
        document.getElementById('search-count').innerText = `${currentIndex + 1}/${foundElements.length}`;
    }

    function resetSearchUI() {
        isScanning = false;
        const btn = document.getElementById('find-my-btn');
        if (btn) { btn.style.display = 'block'; btn.disabled = false; btn.innerText = "내 댓글찾기"; }
        const nav = document.getElementById('search-nav');
        if (nav) nav.style.display = 'none';
    }

    function masterProcessor() {
        const url = window.location.href;

        const likedLink = document.querySelector('a[href="/liked"]');
        if (likedLink && !document.getElementById('my-comment-menu')) {
            const myBtn = likedLink.cloneNode(true);
            myBtn.id = 'my-comment-menu';
            myBtn.href = '/liked?tab=my-comments';
            const svg = myBtn.querySelector('svg');
            if (svg) svg.innerHTML = `<path fill-rule="evenodd" d="M4.8 4.5A2.3 2.3 0 0 0 2.5 6.8v9.4a2.3 2.3 0 0 0 2.3 2.3h1.2v2.7c0 .6.7.9 1.1.5l3.2-3.2h8.4a2.3 2.3 0 0 0 2.3-2.3V6.8a2.3 2.3 0 0 0-2.3-2.3H4.8zm-.7 2.3c0-.9.7-1.6 1.6-1.6h12.6c.9 0 1.6.7 1.6 1.6v9.4c0 .9-.7 1.6-1.6 1.6h-8.7a.7.7 0 0 0-.5.2l-2.3 2.3v-1.8a.7.7 0 0 0-.7-.7H4.8c-.9 0-1.6-.7-1.6-1.6V6.8z" clip-rule="evenodd"></path>`;
            myBtn.querySelector('span').innerText = '내가 단 댓글';
            likedLink.insertAdjacentElement('beforebegin', myBtn);
        }

        if (url.includes('/detail/') && !document.getElementById('comment-search-box')) {
            const box = document.createElement('div');
            box.id = 'comment-search-box';
            box.style = 'position:fixed; bottom:30px; right:30px; z-index:10000; background:#121212; border:1px solid #333; padding:12px; border-radius:30px; display:flex; align-items:center; color:white; box-shadow:0 10px 25px rgba(0,0,0,0.5);';
            box.innerHTML = `
                <button id="find-my-btn" style="background:#3b82f6; border:none; color:white; padding:8px 16px; border-radius:20px; cursor:pointer; font-weight:bold; font-size:12px;">내 댓글찾기</button>
                <div id="search-nav" style="display:none; align-items:center; gap:10px;">
                    <button id="prev-btn" style="background:none; border:none; color:#aaa; cursor:pointer; font-size:18px;">▲</button>
                    <span id="search-count" style="font-size:13px; min-width:40px; text-align:center; font-weight:bold;">0/0</span>
                    <button id="next-btn" style="background:none; border:none; color:#aaa; cursor:pointer; font-size:18px;">▼</button>
                    <button id="close-search" style="margin-left:5px; background:#444; border:none; color:white; width:20px; height:20px; border-radius:50%; cursor:pointer; font-size:10px;">X</button>
                </div>`;
            document.body.appendChild(box);
            document.getElementById('find-my-btn').onclick = startManualProcess;
            document.getElementById('prev-btn').onclick = () => navigate(-1);
            document.getElementById('next-btn').onclick = () => navigate(1);
            document.getElementById('close-search').onclick = resetSearchUI;
        }

        const main = document.querySelector('main');
        if (url.includes('tab=my-comments') && main && !document.getElementById('custom-comment-content')) {
            const nick = localStorage.getItem(NICK_KEY);
            const rawDB = getDB()[nick] || [];
            const uniqueWorks = Array.from(new Map(rawDB.map(item => [item.work, item])).values());

            main.innerHTML = `
            <div id="custom-comment-content" style="width:100%; height:100%; background:var(--bg_primary); overflow-y:auto; padding: 40px 20px;">
                <div style="max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px;">
                    <div style="display: flex; width: 100%; height: fit-content;">
                        <p class="typo-text-2xl_leading-none_bold" style="color: var(--text_primary); font-size: 24px; font-weight: 700;">내가 단 댓글</p>
                    </div>
                    <div style="display: flex; flex-direction: column;">
                        <div class="w-full grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-y-10 gap-x-2">
                            ${uniqueWorks.slice().reverse().map(c => {
                                const safeText = c.text.replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "");
                                return `
                                <div role="button" class="w-full flex flex-col gap-3 text-left cursor-pointer" style="position: relative;" onclick="goToStory('${c.url}', '${safeText}')">
                                    <div style="position: absolute; top: 8px; right: 8px; z-index: 20; background: rgba(0,0,0,0.5); width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.2);"
                                         onclick="event.stopPropagation(); deleteStoryRecord('${c.work.replace(/'/g, "\\'")}');">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                    </div>
                                    <div class="relative rounded-lg overflow-hidden">
                                        <div class="css-1j3h4g0">
                                            <div class="@container w-full h-full relative overflow-hidden rounded-[inherit] flex items-center justify-center aspect-[2/3]">
                                                <img alt="${c.work}" decoding="async" class="object-cover" src="${c.thumb}" style="position: absolute; height: 100%; width: 100%; inset: 0px; color: transparent;">
                                            </div>
                                            <div class="absolute top-0 left-0 w-full h-full rounded-[inherit] z-[2] border border-border" style="pointer-events: none;"></div>
                                        </div>
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <p class="typo-text-base_leading-paragraph_semibold text-primary break-all line-clamp-2" style="font-size: 16px; font-weight: 600;">${c.work}</p>
                                    </div>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>
                <div style="margin-top: 80px; padding: 40px 0; border-top: 1px solid var(--border); text-align: center;">
                        <p style="font-size: 12px; color: #666; margin-bottom: 8px;">본 페이지는 유저 편의를 위해 제작되었으며 뤼튼 크랙 서비스와 무관합니다.</p>
                        <p style="font-size: 12px; color: #666; margin-bottom: 24px;">문제 소지가 있을 경우 확인 후 수정 또는 삭제하겠습니다. </p>
                        <button onclick="if(confirm('모든 활동 기록을 삭제할까요?')){localStorage.removeItem('${DB_KEY}'); location.reload();}"
                                style="background: none; border: 1px solid #444; color: #555; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 11px;">
                            활동 기록 전체 초기화
                        </button>
                    </div>
            </div>`;
        }
    }

    let lastUrl = "";
    setInterval(() => {
        const curUrl = window.location.href;
        if (lastUrl !== curUrl) { lastUrl = curUrl; masterProcessor(); }
        if (!document.getElementById('my-comment-menu')) masterProcessor();
    }, 1000);
})();
