// ==UserScript==
// @name         Chat Last Input Saver
// @namespace    https://github.com/workforomg/Utill
// @version      1.1
// @description  전송 버튼 바로 왼쪽에 밀착 배치 및 입력값 보호
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'chat_last_message_content';

    const RESTORE_ICON_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="18px" height="18px">
        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"></path>
    </svg>`;

    function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else {
            valueSetter.call(element, value);
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.focus();
    }

    function createButton() {
        const btn = document.createElement('button');
        btn.id = 'last-input-restore-btn';

        // UI 스타일 적용
        btn.className = "relative inline-flex items-center justify-center rounded-full border border-border bg-card text-gray-1 hover:bg-secondary transition-colors size-7 p-0";
        btn.type = "button";

        // ★ 위치 핵심: 왼쪽 요소들을 모두 밀어내고 오른쪽 끝으로 붙임
        btn.style.marginLeft = "auto";
        btn.style.marginRight = "8px"; // 전송 버튼과의 간격

        btn.innerHTML = RESTORE_ICON_SVG;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const textarea = document.querySelector('textarea.__chat_input_textarea');
            const lastMsg = localStorage.getItem(STORAGE_KEY);

            if (!textarea) return;

            // [실수 방지] 입력창에 이미 내용이 있으면 절대 불러오지 않음
            if (textarea.value.trim().length > 0) {
                return;
            }

            if (lastMsg) {
                setNativeValue(textarea, lastMsg);
            }
        });

        return btn;
    }

    function attachButton() {
        // 전송 버튼 찾기 (이미지상의 노란색/주황색 원형 버튼)
        const sendBtn = document.querySelector('button.bg-primary.rounded-full');
        if (!sendBtn) return;

        const container = sendBtn.parentElement;
        if (!container || container.querySelector('#last-input-restore-btn')) return;

        // 전송 버튼 바로 앞에 삽입
        container.insertBefore(createButton(), sendBtn);
    }

    // 감시 로직
    const observer = new MutationObserver(() => {
        if (!document.getElementById('last-input-restore-btn')) {
            attachButton();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 저장 로직 (엔터)
    document.body.addEventListener('keydown', (e) => {
        if (e.target.matches('textarea.__chat_input_textarea') && e.key === 'Enter' && !e.shiftKey) {
            const msg = e.target.value.trim();
            if (msg) localStorage.setItem(STORAGE_KEY, msg);
        }
    }, true);

    // 저장 로직 (클릭)
    document.body.addEventListener('mousedown', (e) => {
        const clickedBtn = e.target.closest('button.bg-primary.rounded-full');
        if (clickedBtn) {
            const textarea = document.querySelector('textarea.__chat_input_textarea');
            if (textarea && textarea.value.trim() !== '') {
                localStorage.setItem(STORAGE_KEY, textarea.value);
            }
        }
    }, true);

})();
