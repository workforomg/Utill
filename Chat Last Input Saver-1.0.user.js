// ==UserScript==
// @name         Chat Last Input Saver
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  전송 버튼 바로 왼쪽에 '마지막 입력 복구' 아이콘 버튼을 생성합니다.
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'chat_last_message_content';

    // 되감기(복구) 아이콘 SVG
    const RESTORE_ICON_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="var(--icon_primary)" viewBox="0 0 24 24" width="22px" height="22px">
        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"></path>
    </svg>`;

    // React 입력값 인식용 함수
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

    // 버튼 생성 함수
    function createButton() {
        const btn = document.createElement('button');
        btn.id = 'last-input-restore-btn';

        // 기존 버튼들과 동일한 기본 클래스 사용 (모양 통일)
        // 비활성 버튼 클래스(css-vwtcui) 대신 활성 상태일 때의 모양이나 일반적인 버튼 스타일을 따름
        btn.className = 'css-8oz482 eh9908w0';

        // 스타일 덮어쓰기
        btn.style.cursor = 'pointer';
        btn.style.width = '32px';
        btn.style.height = '32px';
        btn.style.display = 'flex';
        btn.style.justifyContent = 'center'; // 아이콘 중앙 정렬
        btn.style.alignItems = 'center';
        btn.style.backgroundColor = 'transparent'; // 배경 투명 (필요 시 조정)
        btn.style.border = 'none'; // 테두리 제거

        // ★ 위치 핵심 설정
        btn.style.marginLeft = 'auto'; // 왼쪽 요소들을 다 밀어내고 오른쪽 끝으로 이동
        btn.style.marginRight = '8px'; // 전송 버튼과의 간격

        // 내용: 글씨 없이 아이콘만
        btn.innerHTML = RESTORE_ICON_SVG;

        // 클릭 이벤트
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const lastMsg = localStorage.getItem(STORAGE_KEY);
            const textarea = document.querySelector('textarea.__chat_input_textarea');
            if (lastMsg && textarea) {
                setNativeValue(textarea, lastMsg);
            } else if (!lastMsg) {
                alert('저장된 내용이 없습니다.');
            }
        });

        return btn;
    }

    // 버튼 부착 함수
    function attachButton() {
        // 1. 버튼들이 모여있는 컨테이너 (css-119a4dj) 찾기
        const container = document.querySelector('.css-119a4dj');
        if (!container) return;

        // 2. 이미 내 버튼이 있으면 패스
        if (container.querySelector('#last-input-restore-btn')) return;

        // 3. 기준점: 전송 버튼 찾기
        // 전송 버튼은 컨테이너의 '마지막 자식 요소'인 경우가 99%입니다.
        // 클래스 이름(css-vwtcui / css-8oz482)이 바뀌어도 '마지막 버튼'이라는 위치는 변하지 않습니다.
        const sendBtn = container.lastElementChild;

        // 4. 버튼 생성 및 삽입
        const myBtn = createButton();

        // 전송 버튼 앞에 삽입
        if (sendBtn) {
            container.insertBefore(myBtn, sendBtn);
        } else {
            // 만약 전송버튼을 못찾으면 그냥 맨 뒤에 추가
            container.appendChild(myBtn);
        }
    }

    // 실행 및 감시
    attachButton();

    const observer = new MutationObserver(() => {
        if (!document.getElementById('last-input-restore-btn')) {
            attachButton();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 저장 로직 (Enter & 전송버튼 클릭)
    document.body.addEventListener('keydown', (e) => {
        if (e.target.matches('textarea.__chat_input_textarea') && e.key === 'Enter' && !e.shiftKey) {
            const msg = e.target.value.trim();
            if (msg) localStorage.setItem(STORAGE_KEY, msg);
        }
    }, true);

    document.body.addEventListener('mousedown', (e) => {
        // 클릭한 요소가 버튼이거나 버튼 내부라면
        const clickedBtn = e.target.closest('button');
        if (!clickedBtn) return;

        // 전송 버튼인지 확인 (전송 버튼 클래스들 중 하나라도 포함하는지)
        // css-8oz482 (활성), css-vwtcui (비활성 - 보통 비활성은 클릭 안되지만 혹시 모르니)
        if (clickedBtn.classList.contains('css-8oz482') || clickedBtn.classList.contains('css-vwtcui')) {
            const textarea = document.querySelector('textarea.__chat_input_textarea');
            if (textarea && textarea.value.trim() !== '') {
                localStorage.setItem(STORAGE_KEY, textarea.value);
            }
        }
    }, true);

})();