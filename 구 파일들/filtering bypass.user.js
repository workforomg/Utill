// ==UserScript==
// @name         에디터 필터링 우회 주입기 (React/Next.js 완벽 대응)
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  에디터 내부의 텍스트를 감지하여 유령 문자를 주입하고 상태를 강제 업데이트합니다.
// @author       으악갹
// @match        https://crack.wrtn.ai/builder/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    const DEFAULT_PRESET = "성관계, 자위, 강간, 자지가, 자지를, 보지가, 보지를, 변태, 성욕";
    const TARGET_SELECTOR = "#__next > div > div.css-5cve9i.e1pfv5720 > div.css-dw294k.e1pfv5720 > div > div.css-s2ouhr.e1pfv5720 > div.css-1ofqig9.e1pfv5720 > div.css-xjur5j.e1pfv5720 > div";

    GM_addStyle(`
        #filter-btn { margin-left:8px; padding:6px 14px; background:#6366f1; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px; transition:0.2s; }
        #filter-btn:hover { background:#4f46e5; }
        #filter-modal { display:none; position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:360px; background:#ffffff; border-radius:14px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); z-index:10001; padding:24px; border:1px solid #f3f4f6; }
        @media (prefers-color-scheme: dark) { #filter-modal { background:#1f2937; color:#f9fafb; border-color:#374151; } #filter-modal textarea { background:#374151; color:white; border-color:#4b5563; } }
        #filter-modal h3 { margin:0 0 12px 0; font-size:18px; }
        #filter-modal textarea { width:100%; height:110px; margin:12px 0; padding:12px; border-radius:8px; border:1px solid #d1d5db; font-size:14px; outline:none; transition:0.2s; }
        #filter-modal textarea:focus { border-color:#6366f1; }
        .btn-group { display:flex; gap:10px; }
        .btn-group button { flex:1; padding:12px; border:none; border-radius:8px; cursor:pointer; font-weight:600; font-size:14px; }
        .btn-run { background:#6366f1; color:white; }
        .btn-cls { background:#9ca3af; color:white; }
        #filter-overlay { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.3); z-index:10000; backdrop-filter:blur(4px); }
    `);

    // UI 구조 생성
    const overlay = document.createElement('div');
    overlay.id = 'filter-overlay';
    document.body.appendChild(overlay);

    const modal = document.createElement('div');
    modal.id = 'filter-modal';
    modal.innerHTML = `
        <h3>우회 단어 설정</h3>
        <p style="font-size:13px; opacity:0.7; margin:0;">에디터 내 단어 사이에 유령 문자를 넣습니다.</p>
        <textarea id="filter-input" placeholder="쉼표로 구분"></textarea>
        <div class="btn-group">
            <button class="btn-run" id="filter-go">모든 탭 적용 시작</button>
            <button class="btn-cls" id="filter-close">취소</button>
        </div>
    `;
    document.body.appendChild(modal);

    // --- 핵심 로직: 에디터 값 강제 주입 ---
    function setNativeValue(element, value) {
        const { set: valueSetter } = Object.getOwnPropertyDescriptor(element, 'value') || {};
        const prototype = Object.getPrototypeOf(element);
        const { set: prototypeValueSetter } = Object.getOwnPropertyDescriptor(prototype, 'value') || {};

        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }
        // React/Vue가 변경을 감지하도록 input 이벤트 발생
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function processEditor(keywords) {
        let count = 0;
        // 1. 일반 textarea 및 input 처리
        const inputs = document.querySelectorAll('textarea, input[type="text"]');
        inputs.forEach(el => {
            let val = el.value;
            let changed = false;
            keywords.forEach(word => {
                if (word.length > 1 && val.includes(word)) {
                    const bypass = word[0] + '\u200B' + word.slice(1);
                    if (!val.includes(bypass)) {
                        val = val.split(word).join(bypass);
                        changed = true;
                        count++;
                    }
                }
            });
            if (changed) setNativeValue(el, val);
        });

        // 2. Rich Text Editor (contenteditable) 처리
        const editables = document.querySelectorAll('[contenteditable="true"]');
        editables.forEach(el => {
            let html = el.innerHTML;
            let changed = false;
            keywords.forEach(word => {
                if (word.length > 1 && html.includes(word)) {
                    const bypass = word[0] + '\u200B' + word.slice(1);
                    if (!html.includes(bypass)) {
                        html = html.split(word).join(bypass);
                        changed = true;
                        count++;
                    }
                }
            });
            if (changed) {
                el.focus();
                el.innerHTML = html;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        return count;
    }

    // --- 실행 프로세스 ---
    async function startTask() {
        const inputVal = document.getElementById('filter-input').value;
        const keywords = inputVal.split(',').map(s => s.trim()).filter(s => s.length > 0);
        GM_setValue('keywords', inputVal);

        modal.style.display = 'none';
        overlay.style.display = 'none';

        let total = 0;

        for (let i = 1; i <= 7; i++) {
            // 동적 ID 대응 셀렉터
            const tab = document.querySelector(`button[id*="trigger-${i}"]`);
            if (tab) {
                tab.click();
                // 에디터가 로드되고 렌더링될 때까지 충분히 대기
                await new Promise(r => setTimeout(r, 1200));
                total += processEditor(keywords);
                console.log(`${i}번 탭 에디터 처리...`);
            }
        }

        alert(`✨ 우회 완료!\n총 ${total}개의 단어에 유령 문자를 삽입했습니다.`);
    }

    // 버튼 자동 삽입
    setInterval(() => {
        const container = document.querySelector(TARGET_SELECTOR);
        if (container && !document.getElementById('filter-btn')) {
            const btn = document.createElement('button');
            btn.id = 'filter-btn';
            btn.innerText = '필터 우회 주입';
            btn.onclick = () => {
                document.getElementById('filter-input').value = GM_getValue('keywords', DEFAULT_PRESET);
                modal.style.display = 'block';
                overlay.style.display = 'block';
            };
            container.appendChild(btn);
        }
    }, 1500);

    document.getElementById('filter-close').onclick = () => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
    };
    document.getElementById('filter-go').onclick = startTask;

})();
