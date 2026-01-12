// ==UserScript==
// @name         Profile name memo addon
// @namespace    https://github.com/workforomg/Utill
// @version      1.1
// @description  이름이 동일시, 메모가 겹치던 버그 수정.
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

    // [변경] 입력 중인 내용이 있을 경우 확인 후 제거
    const safeRemoveInputBox = () => {
        const box = document.querySelector('.memo-input-box');
        if (!box) return true;

        const input = box.querySelector('.memo-input');
        const charId = box.dataset.activeId;
        const originalMemo = getMemos()[charId] || "";

        // 원래 내용과 다르다면(수정 중이었다면) 경고창 표시
        if (input.value !== originalMemo) {
            if (!confirm("메모 작성을 취소하시겠습니까?")) {
                return false; // 취소 안 함
            }
        }
        box.remove();
        return true;
    };

    function injectToCharacterList() {
        const charRows = Array.from(document.querySelectorAll('.css-1s5md62')).filter(row => row.querySelector('p[color="text_primary"]'));

        charRows.forEach((row, index) => {
            const nameTag = row.querySelector('p[color="text_primary"]');
            if (!nameTag || nameTag.innerText === "대화 프로필" || nameTag.dataset.memoApplied === 'true') return;

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
        if (!safeRemoveInputBox()) return; // 이전 창 닫기 실패 시 중단

        const box = document.createElement('div');
        box.className = 'memo-input-box';
        box.dataset.activeId = charId; // 현재 ID 추적용

        const rect = anchor.getBoundingClientRect();
        box.style.top = `${window.scrollY + rect.top - 45}px`;
        box.style.left = `${window.scrollX + rect.left}px`;

        const input = document.createElement('input');
        input.className = 'memo-input';
        const currentMemo = getMemos()[charId] || "";
        input.value = currentMemo;

        const btn = document.createElement('button');
        btn.className = 'confirm-btn';
        btn.innerText = '저장';

        const save = () => {
            saveMemo(charId, input.value);
            callback();
            box.remove();
        };

        btn.onclick = (e) => { e.stopPropagation(); save(); };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') safeRemoveInputBox();
        };

        box.onclick = (e) => e.stopPropagation();

        box.appendChild(input);
        box.appendChild(btn);
        document.body.appendChild(box);
        input.focus();
    }

    // 외부 클릭 시 안전하게 제거 시도
    document.addEventListener('mousedown', (e) => {
        const box = document.querySelector('.memo-input-box');
        if (box && !box.contains(e.target) && !e.target.closest('.action-btn')) {
            safeRemoveInputBox();
        }
    }, true);

    // URL 변경 시 안전하게 제거 시도
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            const box = document.querySelector('.memo-input-box');
            if (box) {
                // SPA 특성상 바로 confirm을 띄우면 페이지 이동과 엉킬 수 있어 즉시 체크
                const input = box.querySelector('.memo-input');
                const charId = box.dataset.activeId;
                if (input.value !== (getMemos()[charId] || "")) {
                    if (confirm("작성 중인 메모가 있습니다. 페이지를 이동하시겠습니까?")) {
                        box.remove();
                    } else {
                        // 사용자가 취소를 눌렀을 경우 URL을 원래대로 돌리는 것은 기술적으로 복잡하므로
                        // 보통은 이동 방지보다는 "알림" 역할에 집중합니다.
                        box.remove();
                    }
                } else {
                    box.remove();
                }
            }
        }
    });
    urlObserver.observe(document.body, { childList: true, subtree: true });

    const observer = new MutationObserver(() => {
        injectToCharacterList();
        injectToDropdown();
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
