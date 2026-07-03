// ==UserScript==
// @name         Command online preset
// @namespace    https://github.com/workforomg/Utill
// @version      1.2
// @description  단축어 온라인 프리셋
// @match        https://crack.wrtn.ai/setting/chat
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @updateURL    https://github.com/workforomg/Utill/raw/refs/heads/main/Command%20online%20preset.user.js
// @downloadURL  https://github.com/workforomg/Utill/raw/refs/heads/main/Command%20online%20preset.user.js
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    let presetData = [];
    let isMaleFilterActive = false;
    let isFemaleFilterActive = false;

    function setNativeValue(element, value) {
        if (!element) return;
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else {
            valueSetter.call(element, value);
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function renderList() {
        const container = document.getElementById('preset-list-container');
        const searchInput = document.getElementById('preset-search-input');
        if (!container || !searchInput) return;

        const query = searchInput.value.trim().toLowerCase();
        container.innerHTML = '';

        if (presetData.length === 0) {
            container.innerHTML = '<p class="text-sm text-muted-foreground p-2">등록된 프리셋이 없습니다.</p>';
            return;
        }

        let filtered = presetData;
        if (isMaleFilterActive) filtered = filtered.filter(item => item.tags && item.tags.some(t => t === '#남성향'));
        if (isFemaleFilterActive) filtered = filtered.filter(item => item.tags && item.tags.some(t => t === '#여성향'));

        if (query) {
            if (query.startsWith('@')) {
                const authorQuery = query.substring(1).trim();
                filtered = filtered.filter(item => item.author && item.author.toLowerCase().includes(authorQuery));
            } else if (query.startsWith('#')) {
                // 💡 [핵심 변경] 쉼표로 쪼개서 다중 태그(AND) 검색 적용
                const tagQueries = query.split(',').map(q => q.trim()).filter(q => q !== '');
                
                filtered = filtered.filter(item => {
                    if (!item.tags || !Array.isArray(item.tags)) return false;
                    // 검색된 모든 태그가 아이템의 태그 배열 안에 하나라도 포함되어 있어야 함
                    return tagQueries.every(tQuery => 
                        item.tags.some(t => t.toLowerCase().includes(tQuery))
                    );
                });
            } else {
                filtered = filtered.filter(item => item.name && item.name.toLowerCase().includes(query));
            }
        }

        if (filtered.length === 0) {
            container.innerHTML = '<p class="text-sm text-muted-foreground p-2">조건에 맞는 프리셋이 없습니다.</p>';
            return;
        }

        filtered.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'p-3 mb-2 rounded-lg border border-transparent hover:border-border hover:bg-accent/50 cursor-pointer transition-colors';
            let tagsHtml = '';
            if (item.tags && Array.isArray(item.tags) && item.tags.length > 0) {
                tagsHtml = `<div class="flex flex-wrap gap-1 mt-2">` +
                    item.tags.map(t => `<span class="px-1.5 py-0.5 bg-accent text-muted-foreground rounded text-[10px] font-medium">${t}</span>`).join('') +
                `</div>`;
            }
            itemDiv.innerHTML = `
                <div class="flex justify-between items-start gap-2">
                    <div class="font-semibold text-sm text-foreground break-all">${item.name}</div>
                    <div class="text-[10px] text-muted-foreground shrink-0 mt-0.5">@${item.author || '익명'}</div>
                </div>
                <div class="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">${item.description}</div>
                ${tagsHtml}
            `;
            itemDiv.addEventListener('click', () => {
                const form = document.querySelector('form');
                if (!form) return;
                const nameInput = form.querySelector('div:nth-child(1) > span > input');
                const descInput = form.querySelector('div:nth-child(2) > span > input');
                const promptTextarea = form.querySelector('div:nth-child(3) > div > textarea');
                const isNameFilled = nameInput && nameInput.value.trim() !== '';
                const isDescFilled = descInput && descInput.value.trim() !== '';
                const isPromptFilled = promptTextarea && promptTextarea.value.trim() !== '';
                if (isNameFilled || isDescFilled || isPromptFilled) {
                    const wantToOverwrite = confirm('이미 작성된 내용이 있습니다. 덮어씌우시겠습니까?\n(기존에 작성한 내용은 모두 사라집니다)');
                    if (!wantToOverwrite) return; 
                }
                if (nameInput) setNativeValue(nameInput, item.name || '');
                if (descInput) setNativeValue(descInput, item.description || '');
                if (promptTextarea) setNativeValue(promptTextarea, item.prompt || '');
            });
            container.appendChild(itemDiv);
        });
    }

    function loadPresets() {
        const timestamp = new Date().getTime();
        const url = `https://api.github.com/repos/workforomg/Utill/contents/command%20list/total.json?t=${timestamp}`;
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            headers: { "Accept": "application/vnd.github.v3+json", "Cache-Control": "no-cache" },
            onload: function(response) {
                const container = document.getElementById('preset-list-container');
                if (!container) return;
                if (response.status === 200) {
                    try {
                        const apiData = JSON.parse(response.responseText);
                        const base64Str = apiData.content.replace(/\n/g, '');
                        const decodedStr = decodeURIComponent(atob(base64Str).split('').map(function(c) {
                            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                        }).join(''));
                        let data = JSON.parse(decodedStr);
                        if (!Array.isArray(data)) data = [data];
                        presetData = data;
                        renderList();
                    } catch (e) {
                        container.innerHTML = `<p class="text-sm text-red-500 p-2">데이터 분석 에러</p>`;
                    }
                } else {
                    container.innerHTML = `<p class="text-sm text-muted-foreground p-2">데이터를 불러오지 못했습니다.</p>`;
                }
            }
        });
    }

    function injectSideMenu() {
        const forms = document.querySelectorAll('form');
        let targetForm = null;
        for (const f of forms) {
            const text = f.textContent.replace(/\s+/g, '');
            if (text.includes('단축어이름') && text.includes('프롬프트본문')) {
                targetForm = f;
                break;
            }
        }
        if (!targetForm) return;
        if (document.getElementById('shortcut-side-menu')) return;

        let modalContainer = targetForm.closest('[role="dialog"]');
        if (!modalContainer) {
            let curr = targetForm;
            while (curr && curr.tagName !== 'BODY') {
                const style = window.getComputedStyle(curr);
                if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent' && style.borderRadius !== '0px') {
                    modalContainer = curr;
                }
                curr = curr.parentElement;
            }
        }
        if (!modalContainer) modalContainer = targetForm;
        modalContainer.style.overflow = 'visible';
        if (window.getComputedStyle(modalContainer).position === 'static') {
            modalContainer.style.position = 'relative';
        }

        const sideMenu = document.createElement('div');
        sideMenu.id = 'shortcut-side-menu';
        sideMenu.className = 'flex flex-col bg-background border border-border rounded-xl shadow-lg absolute top-0 z-[9999] overflow-hidden';
        sideMenu.style.left = 'calc(100% + 16px)';
        sideMenu.style.width = '280px';
        sideMenu.style.height = '100%';

        sideMenu.innerHTML = `
            <div class="px-4 py-4 border-b border-border flex flex-col gap-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <span class="font-semibold text-base text-foreground leading-snug">
                            프리셋 목록
                        </span>
                        <button id="btn-refresh-presets" class="w-5 h-5 flex items-center justify-center rounded border border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors cursor-pointer" title="새로고침">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 2v6h-6"></path>
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                            </svg>
                        </button>
                    </div>
                    <a href="https://docs.google.com/forms/d/e/1FAIpQLSdfeYMQvDdBJycqVQjmzghXeFV-IsAdPJcidojMH22wWTM_xg/viewform?usp=header" target="_blank" rel="noopener noreferrer" class="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-accent/50 transition-colors cursor-pointer flex items-center justify-center">
                        단축어 공유하기 ↗
                    </a>
                </div>
                <div class="flex gap-2">
                    <button id="btn-filter-male" class="flex-1 py-1.5 text-xs font-medium rounded border border-border text-muted-foreground transition-colors hover:bg-accent/50">남성향</button>
                    <button id="btn-filter-female" class="flex-1 py-1.5 text-xs font-medium rounded border border-border text-muted-foreground transition-colors hover:bg-accent/50">여성향</button>
                </div>
                <input type="text" id="preset-search-input" placeholder="@작성자, #태그, 제목 검색" class="w-full px-3 py-2 text-xs rounded border focus:outline-none transition-colors" style="color: #111827 !important; background-color: #f9fafb !important; border-color: #d1d5db !important; box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);">
            </div>
            <div class="p-3 flex-1 overflow-y-auto" id="preset-list-container">
                <p class="text-sm text-muted-foreground p-2">데이터를 불러오는 중입니다...</p>
            </div>
        `;
        modalContainer.appendChild(sideMenu);

        const btnRefresh = document.getElementById('btn-refresh-presets');
        const btnMale = document.getElementById('btn-filter-male');
        const btnFemale = document.getElementById('btn-filter-female');
        const searchInput = document.getElementById('preset-search-input');

        btnRefresh.addEventListener('click', () => {
            const container = document.getElementById('preset-list-container');
            if (container) {
                container.innerHTML = '<p class="text-sm text-muted-foreground p-2">데이터를 다시 불러오는 중입니다...</p>';
            }
            loadPresets();
        });

        btnMale.addEventListener('click', () => {
            isMaleFilterActive = !isMaleFilterActive;
            btnMale.className = isMaleFilterActive ? 'flex-1 py-1.5 text-xs font-medium rounded border border-foreground bg-foreground text-background transition-colors' : 'flex-1 py-1.5 text-xs font-medium rounded border border-border text-muted-foreground transition-colors hover:bg-accent/50';
            renderList();
        });

        btnFemale.addEventListener('click', () => {
            isFemaleFilterActive = !isFemaleFilterActive;
            btnFemale.className = isFemaleFilterActive ? 'flex-1 py-1.5 text-xs font-medium rounded border border-foreground bg-foreground text-background transition-colors' : 'flex-1 py-1.5 text-xs font-medium rounded border border-border text-muted-foreground transition-colors hover:bg-accent/50';
            renderList();
        });

        searchInput.addEventListener('input', renderList);
        loadPresets();
    }

    setInterval(injectSideMenu, 500);
})();
