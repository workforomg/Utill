// ==UserScript==
// @name         VFX Addon
// @namespace    https://github.com/workforomg/Utill
// @version      1.1
// @description  VFX 기능 구현 (버그 수정판)
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================
    // [0. 데이터 및 설정]
    // ============================================================

    const DEFAULT_EFFECTS = {
        explosion: { id: 'explosion', type: 'default', name: '💥 폭발', keywords: '콰광, 폭발, 굉음, 화염, 펑', context: '', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/explode.mp3', image: '' },
        shatter: { id: 'shatter', type: 'default', name: '🔨 유리 깨짐', keywords: '와장창, 쨍그랑, 유리, 파편, 산산조각', context: '', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/glass-breaking-sound-effect_wLZSIYn.mp3', image: 'https://pngimg.com/uploads/broken_glass/broken_glass_PNG36.png' },
        metal: { id: 'metal', type: 'default', name: '⚔️ 금속/방어', keywords: '깡, 챙, 카앙, 금속, 도끼, 튕겨', context: '', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/clang-sound-effect.mp3', image: '' },
        blunt: { id: 'blunt', type: 'default', name: '🪨 둔기 타격', keywords: '쿵, 퍼억, 강타, 타격, 주먹', context: '', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/punch-sound-effect.mp3', image: '' },

        slash_flesh: { id: 'slash_flesh', type: 'default', name: '🩸 베기 (생체)', keywords: '서걱, 베어, 참수, 절단, 삭둑, 도려', context: '살, 피, 목, 팔, 다리, 복부, 심장, 혈관, 고기, 비명, 몸통', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/gta-sa-knife-sound.mp3', image: '' },
        slash_object: { id: 'slash_object', type: 'default', name: '⚔️ 베기 (사물)', keywords: '서걱, 베어, 절단, 삭둑, 도려', context: '옷, 천, 종이, 머리카락, 허공, 바람, 깃털, 망토, 소매', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/sword-slash-sound-effect_S7JO22b.mp3', image: '' },
        bone: { id: 'bone', type: 'default', name: '🦴 뼈 파괴', keywords: '우드득, 뚝, 으스러, 골절, 부러', context: '뼈, 갈비, 두개골, 척추, 발목, 손가락, 팔, 다리', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/minecraft-damage-sound-effect.mp3', image: '' },
        wood: { id: 'wood', type: 'default', name: '🪵 나무 파괴', keywords: '우드득, 쩍, 부서, 박살, 부러', context: '나무, 문, 의자, 책상, 탁자, 판자, 기둥, 마루, 숲', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/wood-break.mp3', image: '' },

        ghost: { id: 'ghost', type: 'default', name: '👻 유령/공포', keywords: '유령, 귀신, 오싹, 소름', context: '', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/creepy-noise.mp3', image: 'https://pngimg.com/uploads/ghost/ghost_PNG2.png' },
        heal: { id: 'heal', type: 'default', name: '💚 회복/힐', keywords: '체력 회복, 힐, 치유', context: '', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/pokemon-center-healing.mp3', image: '' },
        mana: { id: 'mana', type: 'default', name: '💙 마나/마법', keywords: '마나 회복, MP 회복, 마력', context: '', volume: 50, enabled: true, active: true, sound: 'https://www.myinstants.com/media/sounds/fairy-dust-sound-effect.mp3', image: '' }
    };

    const STORAGE_KEY = 'vfx_config_v9_0';

    let config = loadConfig();
    let isMasterEnabled = true;
    let panelElement = null;
    let modalElement = null;
    let isAdvancedMode = false;
    let currentEditingId = null;

    const TARGET_CLASS_SELECTOR = '.wrtn-markdown';
    const AI_GENERATING_INDICATOR = '.css-194ns6b';
    const processedNodes = new WeakMap();
    let textObserver = null;
    let uiObserver = null;

    function loadConfig() {
        const saved = localStorage.getItem(STORAGE_KEY);
        let loaded = {
            isMasterOn: true,
            effects: JSON.parse(JSON.stringify(DEFAULT_EFFECTS)),
            userPresets: [],
            savedState: null
        };

        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                const mergedEffects = { ...DEFAULT_EFFECTS };
                Object.keys(parsed.effects).forEach(key => {
                    if (mergedEffects[key]) {
                        mergedEffects[key] = { ...DEFAULT_EFFECTS[key], ...parsed.effects[key] };
                    }
                });
                const mergedPresets = (parsed.userPresets || []).map(p => ({ active: true, ...p }));
                loaded = { ...loaded, ...parsed, effects: mergedEffects, userPresets: mergedPresets };
            } catch (e) {}
        }
        return loaded;
    }

    function saveConfig() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        applyUserStyles();
    }

    // ============================================================
    // [1. CSS 스타일]
    // ============================================================
    const css = `
        /* Main Button & Floating */
        .vfx-injector-btn { margin-right: 10px; background-color: transparent; color: #28a745; border: 1px solid #28a745; border-radius: 4px; font-weight: bold; cursor: pointer; padding: 4px 12px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 13px; transition: all 0.2s; z-index: 10000; }
        .vfx-injector-btn:hover { background-color: rgba(40, 167, 69, 0.1); }
        .vfx-floating-btn { position: fixed; bottom: 20px; right: 20px; background-color: #202020; color: #28a745; border: 2px solid #28a745; border-radius: 50px; padding: 10px 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 2147483647; cursor: pointer; font-weight: bold; }

        /* Quick Panel */
        .vfx-quick-panel { position: fixed; z-index: 10005; background-color: rgba(20, 20, 20, 0.95); padding: 12px; border-radius: 12px; display: none; flex-direction: column; gap: 8px; backdrop-filter: blur(10px); box-shadow: 0 8px 32px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); min-width: 180px; }
        .vfx-panel-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 4px; }
        .vfx-panel-title { color: #fff; font-size: 13px; font-weight: bold; }
        .vfx-settings-btn { cursor: pointer; font-size: 16px; color: #aaa; transition: 0.2s; }
        .vfx-settings-btn:hover { color: #fff; transform: rotate(90deg); }
        .vfx-toggle-row { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
        .vfx-toggle-label { color: #ccc; font-size: 12px; }
        .vfx-indicator { width: 8px; height: 8px; border-radius: 50%; background: #444; transition: 0.2s; }
        .vfx-indicator.on { background: #28a745; box-shadow: 0 0 5px #28a745; }

        /* Modal & Tabs */
        .vfx-modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.7); z-index: 20000; display: flex; justify-content: center; align-items: center; opacity: 0; pointer-events: none; transition: opacity 0.2s; }
        .vfx-modal-overlay.open { opacity: 1; pointer-events: auto; }
        .vfx-modal { background: #1a1a1a; width: 700px; max-height: 85vh; border-radius: 12px; border: 1px solid #333; box-shadow: 0 10px 40px rgba(0,0,0,0.8); display: flex; flex-direction: column; overflow: hidden; color: #eee; font-family: sans-serif; }
        .vfx-modal-header { padding: 15px; background: #222; border-bottom: 1px solid #333; display: flex; justify-content: space-between; }
        .vfx-tabs { display: flex; background: #1f1f1f; }
        .vfx-tab { flex: 1; padding: 12px 5px; text-align: center; cursor: pointer; color: #777; transition: 0.2s; font-size:12px; font-weight:bold; border-bottom: 2px solid transparent; }
        .vfx-tab:hover { background: #252525; color: #aaa; }
        .vfx-tab.active { color: #fff; background: #252525; border-bottom: 2px solid #00ff88; }
        .vfx-content { padding: 0; overflow-y: auto; flex: 1; background: #151515; }
        .vfx-tab-pane { display: none; padding: 20px; }
        .vfx-tab-pane.active { display: block; }

        /* Accordion Item Styles */
        .effect-item { border: 1px solid #444; background: #222; color: white; margin-bottom: 10px; border-radius: 8px; overflow: hidden; }
        .effect-header { display: flex; align-items: center; padding: 10px; background: #2d2d2d; gap: 8px; }
        .effect-header h4 { margin: 0; min-width: 80px; font-size: 13px; color: #00ff88; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

        /* Quick Inputs in Header */
        .quick-input { background: #111; border: 1px solid #555; color: #ccc; padding: 5px 8px; border-radius: 4px; flex: 1; font-size: 12px; transition: 0.2s; }
        .quick-input:focus { border-color: #00ff88; outline:none; background: #000; color: #fff; }

        /* Accordion Body */
        .effect-body { padding: 0 15px; background: #1a1a1a; border-top: 0px solid transparent; max-height: 0; overflow: hidden; transition: all 0.3s ease-in-out; opacity: 0; }
        .effect-body.active { padding: 15px; border-top: 1px solid #444; max-height: 500px; opacity: 1; }

        /* Common Elements */
        .vfx-label-main { display: block; font-size: 11px; color: #888; margin-bottom: 4px; font-weight: bold; margin-top: 8px; }
        .vfx-input { background: #111; border: 1px solid #444; color: #ccc; padding: 8px; border-radius: 4px; font-size: 12px; width: 100%; box-sizing: border-box; }
        .vfx-input:focus { border-color: #00ff88; outline: none; }

        /* Buttons */
        .btn { cursor: pointer; padding: 5px 10px; border: none; border-radius: 4px; color: white; font-size: 11px; font-weight: bold; transition:0.2s; }
        .btn-edit { background: #007bff; margin-left: 5px; }
        .btn-edit:hover { background: #0056b3; }
        .btn-toggle { background: transparent; color: #aaa; font-size: 14px; width: 30px; text-align:center; }
        .btn-toggle:hover { color: #fff; background: rgba(255,255,255,0.1); }
        .btn-del { background: #d32f2f; }
        .vfx-btn-primary { background: #00ff88; color: #000; width: 100%; padding: 12px; margin-top: 15px; }

        /* GUI Builder & Advanced */
        .vfx-gui-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .vfx-gui-section { background: #222; padding: 12px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #333; }
        .vfx-gui-title { font-size: 12px; color: #aaa; margin-bottom: 8px; font-weight: bold; border-bottom: 1px solid #444; padding-bottom: 4px; }
        .vfx-switch { position: relative; display: inline-block; width: 34px; height: 18px; }
        .vfx-switch input { opacity: 0; width: 0; height: 0; }
        .vfx-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #555; transition: .4s; border-radius: 34px; }
        .vfx-slider:before { position: absolute; content: ""; height: 12px; width: 12px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .vfx-slider { background-color: #00ff88; }
        input:checked + .vfx-slider:before { transform: translateX(16px); }

        /* Animation Keyframes */
        @keyframes vfx-shake-hard { 0% { transform: translate(0,0); } 10% { transform: translate(-10px,-10px) rotate(-5deg); } 20% { transform: translate(10px,10px) rotate(5deg); } 100% { transform: translate(0,0); } }
        .vfx-anim-explosion { animation: vfx-shake-hard 0.6s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes vfx-shake-vertical { 0%, 100% { transform: translateY(0); } 25% { transform: translateY(8px); } 75% { transform: translateY(-4px); } }
        .vfx-anim-blunt { animation: vfx-shake-vertical 0.2s ease-in-out; }
        @keyframes vfx-slash { 0% { transform: translate(0,0); } 50% { transform: translate(-5px, 5px); } 100% { transform: translate(0,0); } }
        .vfx-anim-slash { animation: vfx-slash 0.2s ease-out; }
        .metal-flash { position: fixed; inset: 0; pointer-events: none; z-index: 9999; animation: flash-white 0.15s ease-out; mix-blend-mode: screen; }
        .blood-flash { position: fixed; inset: 0; pointer-events: none; z-index: 9999; animation: flash-red 0.4s ease-out; box-shadow: inset 0 0 100px rgba(100,0,0,0.8); mix-blend-mode: multiply; }
        @keyframes flash-white { 0% { opacity: 0; } 20% { opacity: 0.8; background: white; } 100% { opacity: 0; } }
        @keyframes flash-red { 0% { opacity: 0; } 10% { opacity: 0.5; background: red; } 100% { opacity: 0; } }
        .shatter-overlay-element { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-size: cover; background-position: center; background-repeat: no-repeat; z-index: 9998; pointer-events: none; animation: shatter-fade-in 3s ease-out forwards; mix-blend-mode: multiply; }
        .ghost-vfx-element { position: fixed; z-index: 9999; pointer-events: none; width: 150px; opacity: 0; transition: all 0.8s; filter: drop-shadow(0 0 10px rgba(255,255,255,0.5)); }
        @keyframes shatter-fade-in { 0% { opacity: 0; transform: scale(1.05); } 10% { opacity: 1; transform: scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }
        .vfx-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 9999; mix-blend-mode: normal; }
    `;
    GM_addStyle(css);

    // ============================================================
    // [2. UI 생성 & 로직]
    // ============================================================

function injectBannerButton() {
        // 중괄호 유지 (ESLint 대응)
        if (document.querySelector(".vfx-injector-btn") || document.querySelector(".vfx-floating-btn")) {
            return;
        }

        const buttonCloned = document.createElement("button");
        buttonCloned.className = "vfx-injector-btn";
        buttonCloned.innerHTML = "✨ VFX";
        buttonCloned.style.height = "32px";
        buttonCloned.style.fontSize = "12px";

        // 검색할 키워드 목록을 배열로 만듭니다. (원하는 텍스트를 이곳에 추가하세요)
        const targetKeywords = ["챗"];

        let targetContainer = document.querySelector("div.flex.gap-3.items-center");

        if (targetContainer) {
            // 키워드 배열 중 하나라도 포함된 요소를 찾습니다.
            const targetWrapper = Array.from(targetContainer.children).find((el) => {
                return targetKeywords.some((keyword) => {
                    return el.textContent.includes(keyword);
                });
            });

            if (targetWrapper) {
                targetContainer.insertBefore(buttonCloned, targetWrapper);
            } else {
                targetContainer.prepend(buttonCloned);
            }
        } else {
            buttonCloned.className = "vfx-floating-btn";
            document.body.appendChild(buttonCloned);
        }

        buttonCloned.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!panelElement) {
                createQuickPanel();
            }
            if (panelElement.style.display === 'none') {
                const rect = buttonCloned.getBoundingClientRect();
                panelElement.style.top = `${rect.bottom + 8}px`;
                panelElement.style.left = `${rect.left - 50}px`;
                panelElement.style.display = 'flex';
                refreshQuickPanelItems();
            } else {
                panelElement.style.display = 'none';
            }
        });
    }

    function createQuickPanel() {
        const panel = document.createElement('div');
        panel.className = 'vfx-quick-panel';
        panel.innerHTML = `
            <div class="vfx-panel-header">
                <span class="vfx-panel-title">VFX Controls</span>
                <span class="vfx-settings-btn" title="고급 설정">⚙️</span>
            </div>
            <div id="vfx-quick-content"></div>
        `;
        panel.querySelector('.vfx-settings-btn').onclick = (e) => {
            e.stopPropagation();
            if(!modalElement) createAdvancedModal();
            currentEditingId = null; // 초기화
            switchModalTab('activation');
            modalElement.classList.add('open');
            panel.style.display = 'none';
        };
        document.body.appendChild(panel);
        panelElement = panel;
        refreshQuickPanelItems();
        return panel;
    }

    function refreshQuickPanelItems() {
        if (!panelElement) {
            return;
        }
        const container = panelElement.querySelector('#vfx-quick-content');
        container.innerHTML = '';

        const createRow = (label, isOn, onClick) => {
            const row = document.createElement('div');
            row.className = 'vfx-toggle-row';
            row.innerHTML = `<span class="vfx-toggle-label">${label}</span><div class="vfx-indicator ${isOn ? 'on' : ''}"></div>`;
            row.onclick = (e) => {
                e.stopPropagation();
                onClick();
            };
            if(!isOn) {
                row.querySelector('.vfx-toggle-label').style.opacity = '0.5';
            }
            return row;
        };

        container.appendChild(createRow('전체 효과 토글', config.isMasterOn, () => {
            config.isMasterOn = !config.isMasterOn;
            if (!config.isMasterOn) {
                config.savedState = {
                    effects: Object.values(config.effects).filter(ef => ef.enabled).map(ef => ef.id),
                    presets: config.userPresets.map((p, idx) => p.enabled ? idx : null).filter(idx => idx !== null)
                };
                Object.values(config.effects).forEach(ef => { ef.enabled = false; });
                config.userPresets.forEach(p => { p.enabled = false; });
            } else {
                if (config.savedState) {
                    config.savedState.effects.forEach(id => {
                        if (config.effects[id]) { config.effects[id].enabled = true; }
                    });
                    config.savedState.presets.forEach(idx => {
                        if (config.userPresets[idx]) { config.userPresets[idx].enabled = true; }
                    });
                }
                config.savedState = null;
            }
            saveConfig();
            refreshQuickPanelItems();
        }));

        const hr = document.createElement('div');
        hr.style.cssText = "height:1px; background:rgba(255,255,255,0.1); margin:4px 0;";
        container.appendChild(hr);

        Object.values(config.effects).forEach(ef => {
            if (ef.active) {
                container.appendChild(createRow(ef.name, ef.enabled, () => {
                    config.effects[ef.id].enabled = !config.effects[ef.id].enabled;
                    saveConfig();
                    refreshQuickPanelItems();
                }));
            }
        });

        config.userPresets.forEach((pre, idx) => {
            if (pre.active) {
                container.appendChild(createRow(`[U] ${pre.name}`, pre.enabled, () => {
                    config.userPresets[idx].enabled = !config.userPresets[idx].enabled;
                    saveConfig();
                    refreshQuickPanelItems();
                }));
            }
        });
    }

    // ============================================================
    // [3. 고급 설정 모달 & 탭 구조]
    // ============================================================
    function createAdvancedModal() {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'vfx-modal-overlay';
        modalOverlay.innerHTML = `
            <div class="vfx-modal">
                <div class="vfx-modal-header">
                    <span style="font-size:16px; font-weight:bold; color:#00ff88;">VFX Studio</span>
                    <span class="vfx-close-btn" style="cursor:pointer; font-size:20px;">×</span>
                </div>
                <div class="vfx-tabs">
                    <div class="vfx-tab active" data-tab="activation">리스트 활성화</div>
                    <div class="vfx-tab" data-tab="default">기본 효과</div>
                    <div class="vfx-tab" data-tab="user">사용자 효과</div>
                    <div class="vfx-tab" data-tab="add">✨ 생성/수정</div>
                </div>
                <div class="vfx-content">
                    <div id="tab-activation" class="vfx-tab-pane active"></div>

                    <div id="tab-default" class="vfx-tab-pane"></div>
                    <div id="tab-user" class="vfx-tab-pane"></div>

                    <div id="tab-add" class="vfx-tab-pane">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; background:#222; padding:10px; border-radius:6px;">
                            <span style="font-size:13px; font-weight:bold; color:#fff;" id="edit-mode-title">새 효과 만들기</span>
                            <label class="vfx-switch">
                                <input type="checkbox" id="adv-mode-toggle">
                                <span class="vfx-slider"></span>
                            </label>
                        </div>
                        <div style="display:flex; justify-content:flex-end; margin-bottom:10px; font-size:11px; color:#666;">
                            <span>고급 사용자 모드 (CSS 확인)</span>
                        </div>

                        <div style="display:flex; flex-direction:column; gap:12px;">
                            <div><span class="vfx-label-main">이름</span><input type="text" class="vfx-input" id="new-name" placeholder="예: 번개 마법"></div>

                            <div class="vfx-gui-grid">
                                <div><span class="vfx-label-main">트리거 (발동어)</span><input type="text" class="vfx-input" id="new-keywords" placeholder="콤마 구분"></div>
                                <div><span class="vfx-label-main">조건 (문맥, 선택)</span><input type="text" class="vfx-input" id="new-context" placeholder="선택사항"></div>
                            </div>

                            <div style="display:flex; gap:10px;">
                                <div style="flex:1;"><span class="vfx-label-main">볼륨</span><input type="number" class="vfx-input" id="new-volume" value="50" min="0" max="100"></div>
                                <div style="flex:3;"><span class="vfx-label-main">사운드 URL</span><input type="text" class="vfx-input" id="new-sound" placeholder="https://..."></div>
                            </div>

                            <div><span class="vfx-label-main">이미지 URL (선택)</span><input type="text" class="vfx-input" id="new-image" placeholder="https://..."></div>

                            <div id="gui-builder-area">
                                <div class="vfx-gui-section">
                                    <div class="vfx-gui-title">이미지 표시 효과</div>
                                    <div class="vfx-gui-grid">
                                        <select class="vfx-input" id="gui-img-anim">
                                            <option value="blink">점멸 (깜빡임)</option>
                                            <option value="fade">등장 (나왔다 사라짐)</option>
                                            <option value="up">아래에서 위로</option>
                                            <option value="down">위에서 아래로</option>
                                            <option value="left">오른쪽에서 왼쪽</option>
                                            <option value="right">왼쪽에서 오른쪽</option>
                                        </select>
                                        <input type="number" class="vfx-input" id="gui-img-dur" value="0.2" step="0.1" placeholder="시간(초)">
                                    </div>
                                </div>
                                <div class="vfx-gui-section">
                                    <div class="vfx-gui-title">화면 색상 섬광</div>
                                    <div style="display:flex; gap:5px; align-items:center;">
                                        <input type="color" class="vfx-input" id="gui-color-1" value="#ffffff" style="height:30px; padding:0;">
                                        <span>→</span>
                                        <input type="color" class="vfx-input" id="gui-color-2" value="#ffff00" style="height:30px; padding:0;">
                                        <input type="number" class="vfx-input" id="gui-color-dur" value="0.2" step="0.1" placeholder="시간(초)" style="width:60px;">
                                    </div>
                                </div>
                                <div class="vfx-gui-section">
                                    <div class="vfx-gui-title">화면 흔들림 (X, Y)</div>
                                    <div class="vfx-gui-grid">
                                        <input type="number" class="vfx-input" id="gui-shake-y" value="0" placeholder="Y축">
                                        <input type="number" class="vfx-input" id="gui-shake-x" value="0" placeholder="X축">
                                    </div>
                                </div>
                            </div>

                            <div id="adv-builder-area" style="display:none;">
                                <span class="vfx-label-main">Live CSS Preview (Read-Only in GUI Mode)</span>
                                <textarea class="vfx-input" id="new-css" style="height:120px; font-family:monospace;" placeholder="CSS Code..."></textarea>
                            </div>

                            <button class="vfx-btn vfx-btn-primary" id="btn-save-preset">추가하기</button>
                            <button class="vfx-btn" id="btn-cancel-edit" style="background:#444; width:100%; display:none; margin-top:5px;">취소하고 신규 생성 모드로</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modalOverlay);
        modalElement = modalOverlay;

        // 닫기 및 탭 전환 이벤트
        modalOverlay.querySelector('.vfx-close-btn').onclick = () => modalOverlay.classList.remove('open');
        modalOverlay.querySelectorAll('.vfx-tab').forEach(tab => {
            tab.onclick = () => switchModalTab(tab.dataset.tab);
        });

        // 고급 모드 토글
        const advToggle = document.getElementById('adv-mode-toggle');
        advToggle.onchange = (e) => {
            isAdvancedMode = e.target.checked;
            document.getElementById('gui-builder-area').style.display = isAdvancedMode ? 'none' : 'block';
            document.getElementById('adv-builder-area').style.display = isAdvancedMode ? 'block' : 'none';
            if(isAdvancedMode) updateCSSFromGUI(); // 켜는 순간 동기화
        };

        // 입력 폼 변경 시 실시간 CSS 업데이트
        const inputs = modalOverlay.querySelectorAll('#tab-add input, #tab-add select');
        inputs.forEach(inp => {
            inp.addEventListener('input', () => { if(isAdvancedMode) updateCSSFromGUI(); });
            inp.addEventListener('change', () => { if(isAdvancedMode) updateCSSFromGUI(); });
        });

        document.getElementById('btn-save-preset').addEventListener('click', saveCurrentForm);
        document.getElementById('btn-cancel-edit').addEventListener('click', () => {
            currentEditingId = null;
            resetForm();
            switchModalTab('add');
        });
    }

    // 탭 전환 유틸
    function switchModalTab(tabName) {
        if(!modalElement) return;
        modalElement.querySelectorAll('.vfx-tab').forEach(t => t.classList.remove('active'));
        modalElement.querySelectorAll('.vfx-tab-pane').forEach(p => p.classList.remove('active'));

        const targetTabBtn = modalElement.querySelector(`.vfx-tab[data-tab="${tabName}"]`);
        if(targetTabBtn) targetTabBtn.classList.add('active');
        document.getElementById(`tab-${tabName}`).classList.add('active');

        refreshTabs();
    }

    // [버그 수정됨] innerHTML += 사용 금지 (이벤트 리스너 보존을 위해 appendChild 사용)
    function refreshTabs() {
        // 1. 활성화 탭 (체크박스)
        const activeTab = document.getElementById('tab-activation');
        activeTab.innerHTML = '';
        const actList = document.createElement('div');

        // 기본 효과 타이틀
        const defTitle = document.createElement('div');
        defTitle.className = 'vfx-gui-title';
        defTitle.innerText = '기본 효과';
        actList.appendChild(defTitle);

        Object.values(config.effects).forEach(ef => actList.appendChild(createCheckItem(ef, false)));

        if(config.userPresets.length > 0) {
            // 사용자 효과 타이틀 (createElement 사용)
            const userTitle = document.createElement('div');
            userTitle.className = 'vfx-gui-title';
            userTitle.style.marginTop = '15px';
            userTitle.innerText = '사용자 효과';
            actList.appendChild(userTitle);

            config.userPresets.forEach((pre, idx) => actList.appendChild(createCheckItem(pre, true, idx)));
        }
        activeTab.appendChild(actList);

        // 2. 기본 효과 (아코디언)
        const defTab = document.getElementById('tab-default');
        defTab.innerHTML = '';
        Object.values(config.effects).forEach(ef => defTab.appendChild(renderAccordionItem(ef, false)));

        // 3. 사용자 효과 (아코디언)
        const userTab = document.getElementById('tab-user');
        userTab.innerHTML = '';
        if(config.userPresets.length === 0) userTab.innerHTML = '<div style="color:#666; text-align:center; padding:20px;">프리셋이 없습니다.</div>';
        else config.userPresets.forEach((pre, idx) => userTab.appendChild(renderAccordionItem(pre, true, idx)));
    }

    // [활성화 탭] 체크박스 아이템
    function createCheckItem(data, isUser, index) {
        const item = document.createElement('div');
        item.style.padding = '8px 12px'; item.style.display = 'flex'; item.style.alignItems = 'center'; item.style.borderBottom = '1px solid #333';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = data.active;
        cb.style.marginRight = '10px';
        cb.onchange = (e) => {
            if(isUser) config.userPresets[index].active = e.target.checked;
            else config.effects[data.id].active = e.target.checked;
            saveConfig(); refreshQuickPanelItems();
        };
        const lb = document.createElement('span'); lb.innerText = data.name;
        item.appendChild(cb); item.appendChild(lb);
        return item;
    }

    // [아코디언 렌더링 함수] - 핵심
    function renderAccordionItem(data, isUser, index) {
        const item = document.createElement('div');
        item.className = 'effect-item';

        // Header
        const header = document.createElement('div');
        header.className = 'effect-header';

        const title = document.createElement('h4');
        title.innerText = data.name;
        header.appendChild(title);

        // 간편 수정 Input (트리거)
        const trigInput = document.createElement('input');
        trigInput.className = 'quick-input';
        trigInput.value = data.keywords;
        trigInput.placeholder = '트리거';
        trigInput.title = '발동 키워드 (콤마 구분)';
        trigInput.onchange = (e) => {
            if(isUser) config.userPresets[index].keywords = e.target.value;
            else config.effects[data.id].keywords = e.target.value;
            saveConfig();
        };
        header.appendChild(trigInput);

        // 간편 수정 Input (조건)
        const condInput = document.createElement('input');
        condInput.className = 'quick-input';
        condInput.value = data.context || '';
        condInput.placeholder = '조건';
        condInput.style.maxWidth = '80px';
        condInput.title = '문맥 조건 (선택사항)';
        condInput.onchange = (e) => {
            if(isUser) config.userPresets[index].context = e.target.value;
            else config.effects[data.id].context = e.target.value;
            saveConfig();
        };
        header.appendChild(condInput);

        // 상세 수정 버튼 (탭 이동)
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-edit';
        editBtn.innerText = '상세';
        editBtn.onclick = () => loadIntoForm(data, isUser, index);
        header.appendChild(editBtn);

        // 접기/펼치기 버튼
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn btn-toggle';
        toggleBtn.innerText = '▼';
        toggleBtn.onclick = () => {
            const body = item.querySelector('.effect-body');
            if(body.classList.contains('active')) {
                body.classList.remove('active');
                toggleBtn.innerText = '▼';
            } else {
                body.classList.add('active');
                toggleBtn.innerText = '▲';
            }
        };
        header.appendChild(toggleBtn);

        item.appendChild(header);

        // Body (Hidden Details)
        const body = document.createElement('div');
        body.className = 'effect-body';

        const createDetailRow = (lbl, key, type='text') => {
            const row = document.createElement('div');
            row.style.marginBottom = '8px';
            row.innerHTML = `<span style="color:#888; font-size:11px; margin-right:5px;">${lbl}:</span>`;
            const inp = document.createElement('input');
            inp.className = 'quick-input';
            inp.style.background = '#222';
            inp.type = type;
            inp.value = data[key];
            if(type==='number') { inp.min=0; inp.max=100; inp.style.width='50px'; }
            else { inp.style.width = '70%'; }

            inp.onchange = (e) => {
                const val = type==='number'? parseInt(e.target.value) : e.target.value;
                if(isUser) config.userPresets[index][key] = val;
                else config.effects[data.id][key] = val;
                saveConfig();
            };
            row.appendChild(inp);
            return row;
        };

        body.appendChild(createDetailRow('볼륨', 'volume', 'number'));
        body.appendChild(createDetailRow('사운드', 'sound'));
        body.appendChild(createDetailRow('이미지', 'image'));

        if(isUser) {
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-del';
            delBtn.innerText = '삭제하기';
            delBtn.style.marginTop = '10px';
            delBtn.style.width = '100%';
            delBtn.onclick = () => {
                if(confirm('이 효과를 삭제하시겠습니까?')) {
                    config.userPresets.splice(index, 1);
                    saveConfig(); refreshTabs(); refreshQuickPanelItems();
                }
            };
            body.appendChild(delBtn);
        }

        item.appendChild(body);
        return item;
    }

    // [상세 수정] 버튼 클릭 시 -> 폼 채우기 & 탭 이동
    function loadIntoForm(data, isUser, index) {
        currentEditingId = isUser ? data.id : data.id; // 식별자

        document.getElementById('edit-mode-title').innerText = `[수정 중] ${data.name}`;
        document.getElementById('btn-save-preset').innerText = '수정사항 저장';
        document.getElementById('btn-cancel-edit').style.display = 'block';

        document.getElementById('new-name').value = data.name;
        document.getElementById('new-keywords').value = data.keywords;
        document.getElementById('new-context').value = data.context || '';
        document.getElementById('new-volume').value = data.volume;
        document.getElementById('new-sound').value = data.sound || '';
        document.getElementById('new-image').value = data.image || '';

        // 기본 효과는 이름을 못 바꾸게 막음 (ID 꼬임 방지)
        document.getElementById('new-name').disabled = !isUser;

        // CSS 로드 (유저 프리셋인 경우만)
        if(isUser && data.css) {
             document.getElementById('new-css').value = data.css;
        } else {
             // 기본 효과거나 CSS가 없으면 새로 생성
             updateCSSFromGUI();
        }

        switchModalTab('add');
    }

    function resetForm() {
        document.getElementById('edit-mode-title').innerText = '새 효과 만들기';
        document.getElementById('btn-save-preset').innerText = '추가하기';
        document.getElementById('btn-cancel-edit').style.display = 'none';
        document.getElementById('new-name').disabled = false;

        const inputs = document.querySelectorAll('#tab-add input, #tab-add textarea');
        inputs.forEach(i => {
            if(i.type !== 'checkbox' && i.type !== 'range') i.value = '';
        });
        document.getElementById('new-volume').value = 50;
        document.getElementById('gui-color-1').value = '#ffffff';
        document.getElementById('gui-color-2').value = '#ffff00';
    }

    function updateCSSFromGUI() {
        const imgUrl = document.getElementById('new-image').value;
        const imgAnim = document.getElementById('gui-img-anim').value;
        const imgDur = document.getElementById('gui-img-dur').value || 0.2;
        const col1 = document.getElementById('gui-color-1').value;
        const col2 = document.getElementById('gui-color-2').value;
        const colDur = document.getElementById('gui-color-dur').value || 0.2;
        const shakeX = document.getElementById('gui-shake-x').value || 0;
        const shakeY = document.getElementById('gui-shake-y').value || 0;

        let animName = `anim-custom-${Date.now()}`;
        let css = `.vfx-custom-ID { position: fixed; inset: 0; pointer-events: none; z-index: 9999; animation: ${animName} ${Math.max(imgDur, colDur)}s ease-out; mix-blend-mode: screen; `;
        if (imgUrl) css += `background-image: url('${imgUrl}'); background-size: cover; background-position: center; `;
        css += `}\n`;
        css += `@keyframes ${animName} { \n`;
        css += `  0% { opacity: 0; transform: translate(0,0); background-color: ${col1}; }\n`;

        let trStart = '';
        if (imgAnim === 'up') trStart = 'translateY(100%)';
        if (imgAnim === 'down') trStart = 'translateY(-100%)';
        if (imgAnim === 'left') trStart = 'translateX(100%)';
        if (imgAnim === 'right') trStart = 'translateX(-100%)';

        css += `  20% { opacity: 0.8; background-color: ${col2}; transform: translate(${shakeX}px, ${shakeY}px) ${trStart}; }\n`;
        css += `  50% { opacity: 0.8; transform: translate(-${shakeX}px, -${shakeY}px); }\n`;
        css += `  100% { opacity: 0; background-color: transparent; transform: translate(0,0); }\n`;
        css += `}\n`;

        document.getElementById('new-css').value = css;
    }

    function saveCurrentForm() {
        const name = document.getElementById('new-name').value;
        const keywords = document.getElementById('new-keywords').value;
        if(!name || !keywords) return alert('이름과 트리거는 필수입니다.');

        const formData = {
            name, keywords,
            context: document.getElementById('new-context').value,
            volume: parseInt(document.getElementById('new-volume').value)||50,
            sound: document.getElementById('new-sound').value,
            image: document.getElementById('new-image').value,
            css: isAdvancedMode ? document.getElementById('new-css').value : document.getElementById('new-css').value // GUI에서 만들어진 CSS도 저장
        };

        // 수정 모드
        if (currentEditingId) {
            // 기본 효과인지 확인
            if (DEFAULT_EFFECTS[currentEditingId]) {
                // 기본 효과는 일부 필드만 업데이트 (CSS 등은 로직이 다를 수 있으나, 일단 sound/img 위주)
                Object.assign(config.effects[currentEditingId], formData);
            } else {
                // 유저 프리셋 찾기
                const idx = config.userPresets.findIndex(p => p.id === currentEditingId);
                if (idx !== -1) {
                    Object.assign(config.userPresets[idx], formData);
                }
            }
            alert('수정되었습니다.');
        }
        // 신규 생성 모드
        else {
            config.userPresets.push({
                id: 'custom_' + Date.now(),
                type: 'user', enabled: true, active: true,
                ...formData
            });
            alert('추가되었습니다.');
        }

        saveConfig();
        resetForm();
        currentEditingId = null;
        switchModalTab('activation');
    }

    function applyUserStyles() {
        let styleTag = document.getElementById('vfx-user-styles');
        if (!styleTag) { styleTag = document.createElement('style'); styleTag.id = 'vfx-user-styles'; document.head.appendChild(styleTag); }
        let content = '';
        config.userPresets.forEach(p => { if(p.css) content += p.css.replace(/ID/g, p.id) + '\n'; });
        styleTag.textContent = content;
    }

    // ============================================================
    // [4. 실행 로직]
    // ============================================================
    function playSound(url, vol) {
        if (!config.isMasterOn || !url) return;
        const a = new Audio(url);
        a.volume = (vol/100);
        a.play().catch(()=>{});
    }

    function triggerEffect(data) {
        if (!config.isMasterOn || !data.enabled || !data.active) return;
        if (data.sound) playSound(data.sound, data.volume);

        if (data.type === 'default') {
            const map = { explosion: 'vfx-anim-explosion', shatter: 'vfx-anim-explosion', wood: 'vfx-anim-blunt', blunt: 'vfx-anim-blunt', slash_object: 'vfx-anim-slash' };
            if(map[data.id]) {
                document.body.classList.remove(map[data.id]);
                void document.body.offsetWidth; document.body.classList.add(map[data.id]);
                setTimeout(()=>document.body.classList.remove(map[data.id]), 500);
            }
            if(data.id==='metal') createFlash('white', 150);
            if(data.id==='slash_flesh'||data.id==='bone') createFlash('red', 400);
            if(data.image) createOverlay(data.image, data.id === 'ghost');
        } else {
            // 유저 효과
            const cls = `vfx-custom-${data.id}`;
            const div = document.createElement('div');
            div.className = `vfx-overlay ${cls}`;
            document.body.appendChild(div);
            setTimeout(()=>div.remove(), 3000);
        }
    }

    function createFlash(c, d) {
        const f = document.createElement('div'); f.className = c==='white'?'metal-flash':'blood-flash';
        document.body.appendChild(f); setTimeout(()=>f.remove(), d);
    }

    function createOverlay(src, isGhost) {
        const img = document.createElement('img'); img.src = src;
        img.className = isGhost ? 'ghost-vfx-element' : 'shatter-overlay-element';
        if(!isGhost) {
            img.style.top='0'; img.style.left='0'; img.style.width='100vw'; img.style.height='100vh';
            img.style.backgroundImage = 'none';
        } else {
            img.style.left = Math.random()*window.innerWidth+'px';
            img.style.top = Math.random()*window.innerHeight+'px';
        }
        img.style.position='fixed'; img.style.zIndex='9998'; img.style.pointerEvents='none';
        document.body.appendChild(img); setTimeout(()=>img.remove(), 3000);
    }

    function processNode(node) {
        if (!config.isMasterOn) return;
        if (node.isContentEditable || node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') return;
        const messageNode = node.closest(TARGET_CLASS_SELECTOR);
        if (!messageNode) return;
        const text = messageNode.textContent;
        if (!processedNodes.has(messageNode)) processedNodes.set(messageNode, new Set());
        const triggered = processedNodes.get(messageNode);

        const allEffects = [...Object.values(config.effects), ...config.userPresets];
        allEffects.forEach(effect => {
            if(!effect.enabled || !effect.active) return;
            if(triggered.has(effect.id)) return;
            const triggerKeys = effect.keywords.split(',').map(s => s.trim()).filter(s => s);
            if (triggerKeys.some(k => text.includes(k))) {
                let isValid = true;
                if (effect.context && effect.context.trim() !== '') {
                    const contextKeys = effect.context.split(',').map(s => s.trim()).filter(s => s);
                    isValid = contextKeys.some(c => text.includes(c));
                }
                if (isValid) {
                    console.log(`[VFX] Effect: ${effect.name}`);
                    triggerEffect(effect);
                    triggered.add(effect.id);
                }
            }
        });
    }

    function startObserver() {
        injectBannerButton();
        applyUserStyles();
        if(uiObserver) uiObserver.disconnect();
        uiObserver = new MutationObserver(() => injectBannerButton());
        uiObserver.observe(document.body, { childList: true, subtree: true });

        if(textObserver) textObserver.disconnect();
        textObserver = new MutationObserver((muts) => {
            if (!document.querySelector(AI_GENERATING_INDICATOR)) return;
            muts.forEach((m) => {
                let t = m.target;
                if(t.nodeType===3) t=t.parentElement;
                if(t && t.nodeType===1) processNode(t);
            });
        });
        textObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
        console.log("✅ VFX v9.0 (Accordion UI + Adv Sync) Loaded");
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver);
    else startObserver();
})();
