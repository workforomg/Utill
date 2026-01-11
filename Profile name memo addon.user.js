// ==UserScript==
// @name         Profile name memo addon
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  프로필 메모 애드온
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1. 스타일 설정 (어두운 배경 팝업 디자인)
    const style = document.createElement('style');
    style.innerHTML = `
        .memo-text-display { color: #ffa500 !important; font-size: 12px !important; margin-left: 8px !important; font-weight: 500 !important; }
        .memo-dropdown-text { color: #ffa500 !important; font-size: 11px !important; margin-left: 6px !important; font-weight: bold !important; pointer-events: none; }
        .memo-btn-wrapper { display: inline-flex !important; align-items: center !important; margin-right: 6px !important; flex-shrink: 0; }
        .action-btn {
            padding: 0 10px !important; height: 22px !important; font-size: 11px !important; cursor: pointer !important;
            border-radius: 12px !important; border: none !important;
            background: #ababab !important; color: #ffffff !important; font-weight: 600 !important;
        }
        .memo-input-box {
            position: absolute; z-index: 9999; background: #444 !important; border: 1px solid #222 !important;
            padding: 8px !important; border-radius: 8px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
            display: flex !important; gap: 6px !important; align-items: center !important;
        }
        .memo-input { border: 1px solid #666 !important; border-radius: 4px !important; padding: 4px 8px !important; background: #fff !important; color: #000 !important; width: 130px !important; outline: none !important; }
        .confirm-btn { padding: 4px 10px !important; font-size: 12px !important; background: #eee !important; color: #333 !important; border: none !important; border-radius: 4px !important; cursor: pointer !important; font-weight: bold !important; }
    `;
    document.head.appendChild(style);

    const getMemos = () => JSON.parse(localStorage.getItem('char_memos') || '{}');
    const saveMemo = (name, text) => {
        const memos = getMemos();
        if (!text.trim()) delete memos[name];
        else memos[name] = text;
        localStorage.setItem('char_memos', JSON.stringify(memos));
    };

    const isTargetPage = () => {
        const url = window.location.href;
        return url.includes('chat?menu=chat_profile') || url.includes('/stories/');
    };

    // 캐릭터 리스트 내부 주입 (설정 페이지 전용)
    function injectToCharacterList() {
        if (!isTargetPage()) return;

        // .css-1dvnp5e 내부의 캐릭터 이름들만 선택
        const charContainers = document.querySelectorAll('.css-1dvnp5e p[color="text_primary"]');

        charContainers.forEach(nameTag => {
            // "대화 프로필" 같은 제목 제외 (텍스트로 필터링)
            if (nameTag.innerText === "대화 프로필" || nameTag.dataset.memoApplied === 'true') return;

            const charName = nameTag.innerText.trim();
            nameTag.dataset.memoApplied = 'true';

            // 1. 이름 옆 메모 텍스트 표시
            const textSpan = document.createElement('span');
            textSpan.className = 'memo-text-display';
            nameTag.appendChild(textSpan);

            // 2. 우측 점 세 개 버튼 왼쪽에 수정 버튼 삽입
            const parentRow = nameTag.closest('.css-1s5md62'); // 이름과 버튼을 감싸는 행
            if (!parentRow) return;

            const menuBtn = parentRow.querySelector('button[aria-haspopup="menu"]');
            if (!menuBtn) return;

            const btnWrapper = document.createElement('span');
            btnWrapper.className = 'memo-btn-wrapper';
            menuBtn.before(btnWrapper);

            const updateUI = () => {
                const memo = getMemos()[charName] || "";
                textSpan.innerText = memo ? ` - ${memo}` : "";
                btnWrapper.innerHTML = '';
                const editBtn = document.createElement('button');
                editBtn.className = 'action-btn';
                editBtn.innerText = memo ? '수정' : '메모';
                editBtn.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    renderEditUI(editBtn, charName, updateUI);
                };
                btnWrapper.appendChild(editBtn);
            };
            updateUI();
        });
    }

    // 드롭다운 메모 표시 (상시)
    function injectToDropdown() {
        document.querySelectorAll('div[role="option"]').forEach(option => {
            if (option.dataset.memoDone === 'true') return;
            const nameSpan = option.querySelector('span[id^="radix-"]');
            if (!nameSpan) return;

            const charName = nameSpan.innerText.trim();
            const memo = getMemos()[charName];
            if (memo) {
                const mSpan = document.createElement('span');
                mSpan.className = 'memo-dropdown-text';
                mSpan.innerText = `(${memo})`;
                nameSpan.after(mSpan);
            }
            option.dataset.memoDone = 'true';
        });
    }

    function renderEditUI(anchor, charName, callback) {
        const existing = document.querySelector('.memo-input-box');
        if (existing) existing.remove();
        const box = document.createElement('div');
        box.className = 'memo-input-box';
        const rect = anchor.getBoundingClientRect();
        box.style.top = `${window.scrollY + rect.top - 45}px`;
        box.style.left = `${window.scrollX + rect.left}px`;

        const input = document.createElement('input');
        input.className = 'memo-input';
        input.value = getMemos()[charName] || "";

        const btn = document.createElement('button');
        btn.className = 'confirm-btn';
        btn.innerText = '저장';

        const save = () => { saveMemo(charName, input.value); callback(); box.remove(); };
        btn.onclick = save;
        input.onkeydown = (e) => { if (e.key === 'Enter') save(); };

        box.appendChild(input);
        box.appendChild(btn);
        document.body.appendChild(box);
        input.focus();
    }

    const observer = new MutationObserver(() => {
        injectToCharacterList();
        injectToDropdown();
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();