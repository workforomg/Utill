// ==UserScript==
// @name         실시간 심박수 주입기 (V2)
// @namespace    https://github.com/workforomg/Utill
// @version      1.3
// @description  심박수 연결 및 Alt+우클릭 주입
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    console.log("HR6 심박수 스크립트 로드됨");

    let lastBpm = "--";

    // 1. 버튼 생성 함수
    function createButton() {
        if (document.getElementById('hr6-connect-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'hr6-connect-btn';
        btn.innerText = "💓 연결하기";

        // 더 눈에 띄는 디자인으로 변경
        btn.style.cssText = `
            position: fixed !important;
            bottom: 20px !important;
            right: 20px !important;
            z-index: 2147483647 !important;
            width: 120px;
            height: 40px;
            background: #ff3b30;
            color: white;
            border: 2px solid white;
            border-radius: 20px;
            cursor: pointer;
            font-weight: bold;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
            display: block;
        `;

        document.body.appendChild(btn);

        btn.addEventListener('click', async () => {
            try {
                const device = await navigator.bluetooth.requestDevice({
                    filters: [{ services: [0x180d] }]
                });
                const server = await device.gatt.connect();
                const service = await server.getPrimaryService(0x180d);
                const char = await service.getCharacteristic(0x2a37);

                await char.startNotifications();
                btn.innerText = "💓 연결됨";
                btn.style.background = "#007aff";

                char.addEventListener('characteristicvaluechanged', (e) => {
                    lastBpm = e.target.value.getUint8(1);
                    btn.innerText = `💓 ${lastBpm} BPM`;
                });
            } catch (err) {
                console.error("블루투스 오류:", err);
                alert("연결 실패: " + err.message);
            }
        });
    }

    // 2. 우클릭 주입 로직
    document.addEventListener('contextmenu', (e) => {
        if (e.altKey) {
            e.preventDefault();
            const text = `*심박수 : ${lastBpm}*`;
            const el = document.activeElement;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
                const start = el.selectionStart;
                const end = el.selectionEnd;
                el.value = el.value.slice(0, start) + text + el.value.slice(end);
            } else if (el && el.isContentEditable) {
                document.execCommand('insertText', false, text);
            }
        }
    });

    // 페이지 로드 후 버튼 생성
    createButton();
})();
