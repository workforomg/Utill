// ==UserScript==
// @name         Crack Fullscreen
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const btn = document.createElement('button');

    btn.textContent = '⛶';

    Object.assign(btn.style, {
        position: 'fixed',
        right: '12px',
        bottom: '80px',
        zIndex: '999999',
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        border: 'none',
        fontSize: '22px',
        background: 'rgba(0,0,0,.65)',
        color: '#fff'
    });

    btn.addEventListener('click', async () => {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            } else {
                await document.exitFullscreen();
            }
        } catch (e) {
            console.error('Fullscreen 실패:', e);
        }
    });

    document.documentElement.appendChild(btn);
})();
