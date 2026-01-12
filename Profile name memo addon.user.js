// ==UserScript==
// @name         Profile name memo addon
// @namespace    https://github.com/workforomg/Utill
// @version      1.1
// @description  이름이 동일시, 메모가 곂치던 버그 수정.
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

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

    const getMemos = () => JSON.parse(localStorage.getItem('char_memos_absolute') || '{}');
    const saveMemo = (id, text) => {
        const memos = getMemos();
        if (!text.trim()) delete memos[id];
        else memos[id] = text;
        localStorage.setItem('char_memos_absolute', JSON.stringify(memos));
    };

    // 현재 페이지에서 해당 요소가 몇 번째 캐릭터인지 계산
    const getAbsoluteIndex = (targetElement, selector) => {
        const allElements = Array.from(document.querySelectorAll(selector));
        return allElements.indexOf(targetElement);
    };

    function injectToCharacterList() {
        // 캐릭터를 감싸는 전체 행 선택
        const charRows = Array.from(document.querySelectorAll('.css-1s5md62')).filter(row => row.querySelector('p[color="text_primary"]'));

        charRows.forEach((row, index) => {
            const nameTag = row.querySelector('p[color="text_primary"]');
            if (!nameTag || nameTag.innerText === "대화 프로필" || nameTag.dataset.memoApplied === 'true') return;

            // 고유 ID: 이름 + 페이지 내 절대 순서
            const charName = nameTag.innerText.trim();
            const charId = `pos_${index}_${charName}`;

            nameTag.dataset.memoApplied = 'true';

            const textSpan = document.createElement('span');
            textSpan.className = 'memo-text-display';
            nameTag.appendChild(textSpan);

            const menuBtn = row.querySelector('button[aria-haspopup="menu"]');
            if (!menuBtn) return;

            const btnWrapper = document.createElement('span');
            btnWrapper.className = 'memo-btn-wrapper';
            menuBtn.before(btnWrapper);

            const updateUI = () => {
                const memo = getMemos()[charId] || "";
                textSpan.innerText = memo ? ` - ${memo}` : "";
                btnWrapper.innerHTML = '';
                const editBtn = document.createElement('button');
                editBtn.className = 'action-btn';
                editBtn.innerText = memo ? '수정' : '메모';
                editBtn.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    renderEditUI(editBtn, charId, updateUI);
                };
                btnWrapper.appendChild(editBtn);
            };
            updateUI();
        });
    }

    function injectToDropdown() {
        const options = document.querySelectorAll('div[role="option"]');
        options.forEach((option, index) => {
            if (option.dataset.memoDone === 'true') return;
            const nameSpan = option.querySelector('span[id^="radix-"]');
            if (!nameSpan) return;

            const charName = nameSpan.innerText.trim();
            // 드롭다운의 순서와 리스트의 순서가 동일하다고 가정 (pos_순서_이름)
            const charId = `pos_${index}_${charName}`;

            const memo = getMemos()[charId];
            if (memo) {
                const mSpan = document.createElement('span');
                mSpan.className = 'memo-dropdown-text';
                mSpan.innerText = `(${memo})`;
                nameSpan.after(mSpan);
            }
            option.dataset.memoDone = 'true';
        });
    }

    function renderEditUI(anchor, charId, callback) {
        const existing = document.querySelector('.memo-input-box');
        if (existing) existing.remove();
        const box = document.createElement('div');
        box.className = 'memo-input-box';
        const rect = anchor.getBoundingClientRect();
        box.style.top = `${window.scrollY + rect.top - 45}px`;
        box.style.left = `${window.scrollX + rect.left}px`;

        const input = document.createElement('input');
        input.className = 'memo-input';
        input.value = getMemos()[charId] || "";

        const btn = document.createElement('button');
        btn.className = 'confirm-btn';
        btn.innerText = '저장';

        const save = () => { saveMemo(charId, input.value); callback(); box.remove(); };
        btn.onclick = save;
        input.onkeydown = (e) => { if (e.key === 'Enter') save(); };

        box.appendChild(input);
        box.appendChild(btn);
        document.body.appendChild(box);
        input.focus();
    }

    // 뤼튼의 경우 요소가 동적으로 계속 로딩되므로 감시를 강화
    const observer = new MutationObserver(() => {
        injectToCharacterList();
        injectToDropdown();
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
