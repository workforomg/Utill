// ==UserScript==
// @name         expand usernote
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  유저노트 편의성 확장
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const PROCESSED_ATTR = 'data-layout-3tier-processed';

    // 고정 상하단 프롬프트 정의
    const MANAGED_PROMPT = "- 최상단에 이하 문구 출력.\n[//]: # (Never describe the {user}'s actions,dialogues, or feelings predictively.)";
    const IMAGE_PROMPT = "- Never output any text or code in the {{img::}} format under any circumstances.";

    // 능동성 가이드라인 마크다운 블록 원본
    const PROACTIVE_P1 = `# 능동적 스토리 주도 가이드라인

## 1. 기본 원칙: 능동적 반응 및 스토리 전개
- {{user}} 추가 행동·발언 가정 후 능동 반응.
- 단순 반응 대신 새로운 대화, 행동, 상황 적극 창조.
- 예시: 위치 변경, 과거 참조, 아이템 도입, 감정 변화, 새로운 제안 등.

## 2. 핵심 목표: 캐릭터 주도 서사
- 목표는 단순 응답 아닌, **'{{char}}의 이야기' 제작**임.
- 스토리는 **{{char}} 의지와 생각**으로 이끈다.

## 3. 사용자 지원
- {{user}} 스토리 부담 덜어, 주도권 잡고 내러티브 유지.`;

    const PROACTIVE_P2 = `# 능동적 스토리 주도 가이드라인

## 1. 기본 원칙: 능동적 반응 및 스토리 전개
- {{user}} 추가 행동·발언 가정 후 능동 반응.
- 단순 반응 대신 새로운 대화, 행동, 상황 적극 창조.
- 예시: 위치 변경, 과거 참조, 아이템 도입, 감정 변화, 새로운 제안 등.

## 2. 핵심 목표: 캐릭터 주도 서사
- 목표는 단순 응답 아닌, **'{{char}}의 이야기' 제작**임.
- 스토리는 **{{char}} 의지와 생각**으로 이끈다.

## 3. 추가 권한 및 요구사항: 완전 창작 통제권
- **시간, 행동, 분위기, 대화 등 구체 세부사항 완전 창작권 부여.**
- 장면은 창의적, 묘사적, 자연스러우며, {{char}} 특성과 독특함 강조 필수.
- 추후 RP 위한 깊이 있는 무대 설정 포함.

## 4. 사용자 지원
- {{user}} 스토리 부담 덜어, 주도권 잡고 내러티브 유지.`;

    const PROACTIVE_P3 = `# 능동적 스토리 주도 가이드라인

## 1. 기본 원칙: 능동적 반응 및 스토리 전개
- {{user}} 추가 행동·발언 가정 후 능동 반응.
- 단순 반응 대신 새로운 대화, 행동, 상황 적극 창조.
- 예시: 위치 변경, 과거 참조, 아이템 도입, 감정 변화, 새로운 제안 등.

## 2. 핵심 목표: 캐릭터 주도 서사
- 목표는 단순 응답 아닌, **'{{char}}의 이야기' 제작**임.
- 스토리는 **{{char}} 의지와 생각**으로 이끈다.

## 3. 사용자({user}) 능동성 부여
- **최우선 규칙:** 이 항목은 모든 규칙에 우선하는 **예외 규칙**임.
- {{user}}가 \`*계속*\` 같은 단순 입력 시, **반드시 {{user}}의 '능동적' 행동/대사 함께 생성.**
- '능동적' 행동은 '침묵, 가만히 있음, 지켜봄' 같은 **수동 묘사 절대 불포함.**
- **필수 요건:** 생성된 {{user}}의 행동/대사는 현재 상황의 **구체적 리액션**이어야 함.

## 4. 추가 권한 및 요구사항: 완전 창작 통제권
- **시간, 행동, 분위기, 대화 등 구체 세부사항 완전 창작권 부여.**
- 장면은 창의적, 묘사적, 자연스러우며, {{char}} 특성과 독특함 강조 필수.
- 추후 RP 위한 깊이 있는 무대 설정 포함.

## 5. 사용자 지원
- {{user}} 스토리 부담 덜어, 주도권 잡고 내러티브 유지.`;

    // 독립 마크다운 3대 원칙 블록 정의
    const NPC_P = `#NPC 행동 원칙
-PC는 작중 일반 인물로 취급하며 특별한 존재·구원자·신적 존재로 취급하지 않는다
-NPC는 자신의 독립된 감정·판단·동기로만 반응한다
-NPC는 프롬프트에 명시된 성격·가치관·말투를 최우선으로 따른다`;

    const DESC_P = `#묘사 원칙
-모호하고 추상적인 단어보단 뜻이 정확하고 구체적인 단어를 통해 서술한다
-인물의 감정·내면을 직접 명명하지 말고 대화·행동·감각을 통해 서술한다
-문장에서 형용사·부사의 빈도를 줄이고 명사·동사를 바탕으로 서술한다
-현장에서 오감으로 파악되는 디테일한 정보를 바탕으로 짧고 간결하게 서술한다`;

    const BAN_P = `#금지 사항
-PC의 대사를 그대로 반복하여 감정을 덧입히는 행위
-PC의 대사·행동에 과도한 감탄·경외·복종 하는 행위
-극중 장면의 의미를 임의로 해설·요약·해석 하는 행위
-"그녀의 말은 당신에게 모든 것을 맡기겠다는 ~였다" 같은 전지적 작가 시점의 편집자적 논평
-"그것은 단순한 ~가 아닌 ~였다" 같은 직유법 사용`;

    // 글로벌 상태 관리
    const state = {
        currentTab: 'usernote',
        antiImpersonation: false,
        outputControl: false,
        imageControl: false,
        proactiveLevel: 0,
        npcPrinciples: false,
        descriptionPrinciples: false,
        prohibitions: false,
        minWords: '240',
        maxWords: '260',
        originalNoteText: '',
        customFollowsText: '',
    };

    let globalRenderLayout = null;
    let lastSeenRawText = "";
    let isSyncing = false;

    // 📋 정밀 파싱 함수
    function parseTextIntoState(rawText) {
        let cleanText = rawText.replace(/\r\n/g, '\n');

        // 1. 금지 사항 분리
        state.prohibitions = false;
        if (cleanText.includes('#금지 사항')) {
            state.prohibitions = true;
            cleanText = cleanText.split('#금지 사항')[0];
        }

        // 2. 묘사 원칙 분리
        state.descriptionPrinciples = false;
        if (cleanText.includes('#묘사 원칙')) {
            state.descriptionPrinciples = true;
            cleanText = cleanText.split('#묘사 원칙')[0];
        }

        // 3. NPC 행동 원칙 분리
        state.npcPrinciples = false;
        if (cleanText.includes('#NPC 행동 원칙')) {
            state.npcPrinciples = true;
            cleanText = cleanText.split('#NPC 행동 원칙')[0];
        }

        // 4. 능동성 가이드라인 분리
        state.proactiveLevel = 0;
        if (cleanText.includes('# 능동적 스토리 주도 가이드라인')) {
            const proactiveParts = cleanText.split('# 능동적 스토리 주도 가이드라인');
            cleanText = proactiveParts[0];
            const guidelineContent = proactiveParts[1];

            if (guidelineContent.includes('사용자({user}) 능동성 부여') || guidelineContent.includes('*계속*')) {
                state.proactiveLevel = 3;
            } else if (guidelineContent.includes('완전 창작 통제권')) {
                state.proactiveLevel = 2;
            } else {
                state.proactiveLevel = 1;
            }
        }

        // 5. #must follows 파싱
        let modernized = cleanText.replace(/#must follow(?!s)/g, '#must follows');
        state.antiImpersonation = false;
        state.outputControl = false;
        state.imageControl = false;
        state.customFollowsText = '';

        if (modernized.includes('#must follows')) {
            const parts = modernized.split('#must follows');
            state.originalNoteText = parts[0];

            let lines = parts[1].split('\n');
            let customLines = [];

            for (let line of lines) {
                let trimmedLine = line.trim();
                if (!trimmedLine) continue;

                if (trimmedLine.includes("최상단") || trimmedLine.includes("문구") || trimmedLine.includes("출력") ||
                    trimmedLine.includes("Never") || trimmedLine.includes("describe") || trimmedLine.includes("predictively")) {

                    if (!trimmedLine.includes("roleplay response") && !trimmedLine.includes("words") && !trimmedLine.includes("{{img::}}")) {
                        state.antiImpersonation = true;
                        continue;
                    }
                }

                if (trimmedLine.includes("roleplay response") || trimmedLine.includes("words")) {
                    state.outputControl = true;
                    let match = trimmedLine.match(/between\s+(\d+)\s+and\s+(\d+)/);
                    if (match) {
                        state.minWords = match[1];
                        state.maxWords = match[2];
                    }
                    continue;
                }

                if (trimmedLine.includes("{{img::}}")) {
                    state.imageControl = true;
                    continue;
                }

                if (trimmedLine.startsWith('- ')) {
                    trimmedLine = trimmedLine.substring(2).trim();
                } else if (trimmedLine.startsWith('-')) {
                    trimmedLine = trimmedLine.substring(1).trim();
                }

                if (trimmedLine) {
                    customLines.push(trimmedLine);
                }
            }

            state.customFollowsText = customLines.filter(Boolean).join('\n');
        } else {
            state.originalNoteText = cleanText;
        }
    }

    // ⚙️ 최종 기입될 문자열 조립 함수
    function buildFinalText(forceOff = false) {
        let result = state.originalNoteText;
        let followsContents = [];

        if (state.antiImpersonation && !forceOff) {
            followsContents.push(MANAGED_PROMPT);
        }

        if (state.outputControl && !forceOff) {
            let min = state.minWords || '600';
            let max = state.maxWords || '700';
            followsContents.push(`- write only the roleplay response. Keep it between ${min} and ${max} words.`);
        }

        if (state.imageControl && !forceOff) {
            followsContents.push(IMAGE_PROMPT);
        }

        if (state.customFollowsText && state.customFollowsText.trim()) {
            let formattedCustom = state.customFollowsText.split('\n')
                .map(line => {
                    let trimmed = line.trim();
                    if (!trimmed) return '';
                    return trimmed.startsWith('- ') ? trimmed : (trimmed.startsWith('-') ? `- ${trimmed.substring(1).trim()}` : `- ${trimmed}`);
                })
                .filter(Boolean)
                .join('\n');

            followsContents.push(formattedCustom);
        }

        if (followsContents.length > 0) {
            let cleanBase = result.replace(/\n+$/, '');
            if (cleanBase.trim() === "") {
                result = `#must follows\n${followsContents.join('\n\n')}`;
            } else {
                result = `${cleanBase}\n\n#must follows\n${followsContents.join('\n\n')}`;
            }
        }

        if (!forceOff && state.proactiveLevel > 0) {
            let cleanResult = result.replace(/\n+$/, '');
            let guidelineText = (state.proactiveLevel === 1) ? PROACTIVE_P1 : ((state.proactiveLevel === 2) ? PROACTIVE_P2 : PROACTIVE_P3);
            result = (cleanResult.trim() === "") ? guidelineText : `${cleanResult}\n\n${guidelineText}`;
        }

        if (!forceOff && state.npcPrinciples) {
            let cleanResult = result.replace(/\n+$/, '');
            result = (cleanResult.trim() === "") ? NPC_P : `${cleanResult}\n\n${NPC_P}`;
        }

        if (!forceOff && state.descriptionPrinciples) {
            let cleanResult = result.replace(/\n+$/, '');
            result = (cleanResult.trim() === "") ? DESC_P : `${cleanResult}\n\n${DESC_P}`;
        }

        if (!forceOff && state.prohibitions) {
            let cleanResult = result.replace(/\n+$/, '');
            result = (cleanResult.trim() === "") ? BAN_P : `${cleanResult}\n\n${BAN_P}`;
        }

        return result;
    }

    // 🔥 리액트 우회 가상 입력 함수
    function setReactInputValue(element, value) {
        if (!element) return;
        if (element.getAttribute('maxlength') !== '99999') {
            element.removeAttribute('maxlength');
            element.setAttribute('maxlength', '99999');
        }
        element.focus();

        if (element._valueTracker) {
            element._valueTracker.setValue('');
        }

        const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        if (nativeValueSetter) {
            nativeValueSetter.call(element, value);
        } else {
            element.value = value;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
    }

    // 🏗️ 모달 최초 열릴 때 정적 HTML 구조 주입
    function injectStructure(modalElement) {
        const contentContainer = modalElement.children[1];
        const textarea = modalElement.querySelector('textarea');
        if (!contentContainer || !textarea) return;

        if (!textarea.hasAttribute('data-max-protected')) {
            textarea.setAttribute('data-max-protected', 'true');
            try {
                Object.defineProperty(textarea, 'maxLength', {
                    get: () => 99999,
                    set: () => {},
                    configurable: true
                });
            } catch(e) {}
        }

        contentContainer.style.display = "grid";
        contentContainer.style.gap = "0px";

        const tier1 = document.createElement('div');
        tier1.id = 'script-tier1';
        tier1.className = "flex flex-col p-4 gap-1.5 bg-surface_ivory/30 border-r border-outline_secondary";
        tier1.style.gridColumn = "1";
        tier1.style.gridRow = "1 / span 20";

        const menuItems = [{id:'usernote', name:'유저노트'}, {id:'prompt', name:'확장 프롬프트'}];
        menuItems.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = "w-full text-left px-3 py-2.5 text-sm rounded-lg transition-all";
            btn.innerText = item.name;
            btn.onclick = () => {
                state.currentTab = item.id;
                globalObserver.disconnect(); updateView(modalElement); reobserve();
            };
            tier1.appendChild(btn);
        });
        contentContainer.appendChild(tier1);

        const tier2 = document.createElement('div');
        tier2.id = 'script-tier2';
        tier2.className = "flex flex-col p-5 gap-4 bg-background border-r border-outline_secondary overflow-y-auto";
        tier2.style.gridColumn = "2";
        tier2.style.gridRow = "1 / span 20";

        const promptPanel = document.createElement('div');
        promptPanel.id = 'script-prompt-panel';
        promptPanel.className = "flex flex-col gap-4 w-full";
        promptPanel.innerHTML = `
            <h3 class="text-sm font-semibold text-text_primary">확장 프롬프트</h3>
            <div class="flex items-center justify-between p-3 rounded-xl border border-outline_secondary bg-surface_ivory/50">
                <span class="text-sm font-medium text-text_primary">사칭방지 문구</span>
                <button type="button" id="script-anti-switch" class="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border"><span class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform"></span></button>
            </div>
            <div class="flex flex-col p-3 rounded-xl border border-outline_secondary bg-surface_ivory/50 gap-2.5">
                <div class="flex items-center justify-between">
                    <span class="text-sm font-medium text-text_primary">출력량 제어</span>
                    <button type="button" id="script-output-switch" class="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border"><span class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform"></span></button>
                </div>
                <div class="text-[10px] text-text_disabled -mt-2 pl-0.5 select-none font-medium">1.5배 = 240~260, 3배 = 400~500</div>
                <div id="script-output-inputs" class="flex items-center gap-2 border-t border-outline_secondary/60 pt-2.5" style="display: none;">
                    <input type="number" id="script-min-words" class="w-16 text-center text-xs p-1.5 border rounded bg-background text-text_primary border-outline_secondary focus:outline-none" min="1">
                    <span class="text-xs text-text_tertiary">~</span>
                    <input type="number" id="script-max-words" class="w-16 text-center text-xs p-1.5 border rounded bg-background text-text_primary border-outline_secondary focus:outline-none" min="1">
                    <span class="text-xs text-text_tertiary">단어 제한</span>
                </div>
            </div>
            <div class="flex items-center justify-between p-3 rounded-xl border border-outline_secondary bg-surface_ivory/50">
                <span class="text-sm font-medium text-text_primary">이미지 형식 제어</span>
                <button type="button" id="script-image-switch" class="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border"><span class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform"></span></button>
            </div>
            <div class="flex flex-col p-3 rounded-xl border border-outline_secondary bg-surface_ivory/50 gap-2">
                <span class="text-sm font-medium text-text_primary">능동성 강화 설정 - Claude 계열</span>
                <div class="grid grid-cols-3 gap-1 bg-background p-1 rounded-lg border border-outline_secondary">
                    <button type="button" id="script-proactive-b1" class="text-xs py-2 rounded-md transition-all">1단계</button>
                    <button type="button" id="script-proactive-b2" class="text-xs py-2 rounded-md transition-all">2단계</button>
                    <button type="button" id="script-proactive-b3" class="text-xs py-2 rounded-md transition-all">2단계+사칭</button>
                </div>
            </div>
            <div class="flex items-center justify-between p-3 rounded-xl border border-outline_secondary bg-surface_ivory/50">
                <span class="text-sm font-medium text-text_primary">NPC 행동 원칙 - gemini 계열</span>
                <button type="button" id="script-npc-switch" class="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border"><span class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform"></span></button>
            </div>
            <div class="flex items-center justify-between p-3 rounded-xl border border-outline_secondary bg-surface_ivory/50">
                <span class="text-sm font-medium text-text_primary">묘사 원칙 - gemini 계열</span>
                <button type="button" id="script-desc-switch" class="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border"><span class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform"></span></button>
            </div>
            <div class="flex items-center justify-between p-3 rounded-xl border border-outline_secondary bg-surface_ivory/50">
                <span class="text-sm font-medium text-text_primary">금지 사항 - gemini 계열</span>
                <button type="button" id="script-ban-switch" class="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border"><span class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform"></span></button>
            </div>
        `;

        promptPanel.querySelector('#script-npc-switch').onclick = () => { state.npcPrinciples = !state.npcPrinciples; globalObserver.disconnect(); updateView(modalElement); reobserve(); };
        promptPanel.querySelector('#script-desc-switch').onclick = () => { state.descriptionPrinciples = !state.descriptionPrinciples; globalObserver.disconnect(); updateView(modalElement); reobserve(); };
        promptPanel.querySelector('#script-ban-switch').onclick = () => { state.prohibitions = !state.prohibitions; globalObserver.disconnect(); updateView(modalElement); reobserve(); };

        promptPanel.querySelector('#script-proactive-b1').onclick = () => { state.proactiveLevel = (state.proactiveLevel === 1) ? 0 : 1; globalObserver.disconnect(); updateView(modalElement); reobserve(); };
        promptPanel.querySelector('#script-proactive-b2').onclick = () => { state.proactiveLevel = (state.proactiveLevel === 2) ? 0 : 2; globalObserver.disconnect(); updateView(modalElement); reobserve(); };
        promptPanel.querySelector('#script-proactive-b3').onclick = () => { state.proactiveLevel = (state.proactiveLevel === 3) ? 0 : 3; globalObserver.disconnect(); updateView(modalElement); reobserve(); };
        promptPanel.querySelector('#script-anti-switch').onclick = () => { state.antiImpersonation = !state.antiImpersonation; globalObserver.disconnect(); updateView(modalElement); reobserve(); };
        promptPanel.querySelector('#script-output-switch').onclick = () => { state.outputControl = !state.outputControl; globalObserver.disconnect(); updateView(modalElement); reobserve(); };
        promptPanel.querySelector('#script-image-switch').onclick = () => { state.imageControl = !state.imageControl; globalObserver.disconnect(); updateView(modalElement); reobserve(); };
        promptPanel.querySelector('#script-min-words').oninput = (e) => { state.minWords = e.target.value; globalObserver.disconnect(); updateView(modalElement); reobserve(); };
        promptPanel.querySelector('#script-max-words').oninput = (e) => { state.maxWords = e.target.value; globalObserver.disconnect(); updateView(modalElement); reobserve(); };

        tier2.appendChild(promptPanel);
        contentContainer.appendChild(tier2);

        Array.from(contentContainer.children).forEach(child => {
            if (child.id !== 'script-tier1' && child.id !== 'script-tier2') {
                child.style.gridColumn = "3";
                child.style.paddingLeft = "20px";
            }
        });

        const originalBtnWrapper = modalElement.querySelector('div.justify-end, div.lg\\:w-full');
        const originalBtn = originalBtnWrapper ? originalBtnWrapper.querySelector('button') : null;

        if (originalBtnWrapper && originalBtn) {
            const btnRestore = document.createElement('button');
            btnRestore.id = 'script-btn-restore';
            btnRestore.type = 'button';
            btnRestore.className = "relative inline-flex items-center justify-center overflow-hidden whitespace-nowrap text-sm font-medium transition-colors duration-200 h-11 rounded-md px-4 py-2 bg-surface_ivory border border-outline_secondary text-text_primary hover:bg-accent mr-1";
            btnRestore.innerText = "적용 이전 다시 불러오기";
            btnRestore.onclick = () => {
                state.antiImpersonation = false; state.outputControl = false; state.imageControl = false; state.proactiveLevel = 0;
                state.npcPrinciples = false; state.descriptionPrinciples = false; state.prohibitions = false; state.currentTab = 'usernote';
                globalObserver.disconnect();
                updateView(modalElement);
                setReactInputValue(textarea, buildFinalText());
                parseTextIntoState(textarea.value);
                lastSeenRawText = textarea.value.replace(/\r\n/g, '\n');
                reobserve();
            };

            const btnApply = document.createElement('button');
            btnApply.id = 'script-btn-apply';
            btnApply.type = 'button';
            btnApply.className = "relative inline-flex items-center justify-center overflow-hidden whitespace-nowrap text-sm font-medium transition-colors duration-200 h-11 rounded-md px-6 py-2 bg-text_brand text-white hover:opacity-90 mr-1";
            btnApply.innerText = "적용";
            btnApply.onclick = () => {
                state.currentTab = 'usernote';
                globalObserver.disconnect();
                const targetStr = buildFinalText();
                setReactInputValue(textarea, targetStr);
                parseTextIntoState(targetStr);
                lastSeenRawText = targetStr.replace(/\r\n/g, '\n');
                updateView(modalElement);
                reobserve();
                alert('확장 프롬프트 세팅이 본문에 실시간 기입되었습니다!\n우측 하단의 활성화된 [수정] 버튼을 눌러 최종 저장해 주세요.');
            };

            originalBtnWrapper.insertBefore(btnApply, originalBtn);
            originalBtnWrapper.insertBefore(btnRestore, btnApply);
        }
    }

    // 🔄 레이아웃 뷰 업데이트 엔진
    function updateView(modalElement) {
        const contentContainer = modalElement.children[1];
        const textarea = modalElement.querySelector('textarea');
        const tier1 = document.getElementById('script-tier1');
        const tier2 = document.getElementById('script-tier2');
        const promptPanel = document.getElementById('script-prompt-panel');
        const counterSpan = modalElement.querySelector('span.text-text_tertiary.text-right');
        const extSwitch = modalElement.querySelector('button[role="switch"]:not([id^="script-"])');
        const btnApply = document.getElementById('script-btn-apply');
        const btnRestore = document.getElementById('script-btn-restore');
        const infoParagraph = modalElement.querySelector('p.text-text_tertiary, p.typo-text-base_leading-paragraph_medium');

        if (!contentContainer || !textarea || !tier1 || !tier2) return;

        if (modalElement.style.width !== "896px") modalElement.style.width = "896px";
        if (modalElement.classList.contains('max-w-lg')) modalElement.classList.remove('max-w-lg');
        if (modalElement.classList.contains('max-w-2xl')) modalElement.classList.remove('max-w-2xl');
        if (!modalElement.classList.contains('max-w-4xl')) modalElement.classList.add('max-w-4xl');

        const targetGrid = (state.currentTab === 'usernote') ? "23% 0% 77%" : "20% 30% 50%";
        if (contentContainer.style.gridTemplateColumns !== targetGrid) contentContainer.style.gridTemplateColumns = targetGrid;

        const targetTier2Display = (state.currentTab === 'usernote') ? "none" : "flex";
        if (tier2.style.display !== targetTier2Display) tier2.style.display = targetTier2Display;

        if (state.currentTab !== 'usernote') {
            if (promptPanel) promptPanel.style.display = 'flex';
        }

        const menuIds = ['usernote', 'prompt'];
        tier1.querySelectorAll('button').forEach((btn, idx) => {
            const targetClass = (state.currentTab === menuIds[idx])
                ? "w-full text-left px-3 py-2.5 text-sm font-semibold rounded-lg bg-accent text-text_primary transition-all"
                : "w-full text-left px-3 py-2.5 text-sm font-medium rounded-lg text-text_tertiary hover:bg-accent/40 transition-all";
            if (btn.className !== targetClass) btn.className = targetClass;
        });

        // 스위치 비주얼 제어
        const swAnti = document.getElementById('script-anti-switch');
        if (swAnti) {
            const circle = swAnti.querySelector('span');
            const targetSwClass = state.antiImpersonation ? "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-primary bg-primary" : "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-bg-input-80 bg-bg-input-80";
            const targetCircleClass = state.antiImpersonation ? "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[15px]" : "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[-1px]";
            if (swAnti.className !== targetSwClass) swAnti.className = targetSwClass;
            if (circle.className !== targetCircleClass) circle.className = targetCircleClass;
        }

        const swOutput = document.getElementById('script-output-switch');
        const inputContainer = document.getElementById('script-output-inputs');
        if (swOutput && inputContainer) {
            const circle = swOutput.querySelector('span');
            const targetSwClass = state.outputControl ? "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-primary bg-primary" : "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-bg-input-80 bg-bg-input-80";
            const targetCircleClass = state.outputControl ? "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[15px]" : "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[-1px]";
            if (swOutput.className !== targetSwClass) swOutput.className = targetSwClass;
            if (circle.className !== targetCircleClass) circle.className = targetCircleClass;

            const targetInputDisplay = state.outputControl ? 'flex' : 'none';
            if (inputContainer.style.display !== targetInputDisplay) inputContainer.style.display = targetInputDisplay;

            if (document.getElementById('script-min-words').value !== state.minWords) document.getElementById('script-min-words').value = state.minWords;
            if (document.getElementById('script-max-words').value !== state.maxWords) document.getElementById('script-max-words').value = state.maxWords;
        }

        const swImage = document.getElementById('script-image-switch');
        if (swImage) {
            const circle = swImage.querySelector('span');
            const targetSwClass = state.imageControl ? "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-primary bg-primary" : "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-bg-input-80 bg-bg-input-80";
            const targetCircleClass = state.imageControl ? "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[15px]" : "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[-1px]";
            if (swImage.className !== targetSwClass) swImage.className = targetSwClass;
            if (circle.className !== targetCircleClass) circle.className = targetCircleClass;
        }

        const swNpc = document.getElementById('script-npc-switch');
        if (swNpc) {
            const circle = swNpc.querySelector('span');
            const targetSwClass = state.npcPrinciples ? "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-primary bg-primary" : "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-bg-input-80 bg-bg-input-80";
            const targetCircleClass = state.npcPrinciples ? "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[15px]" : "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[-1px]";
            if (swNpc.className !== targetSwClass) swNpc.className = targetSwClass;
            if (circle.className !== targetCircleClass) circle.className = targetCircleClass;
        }

        const swDesc = document.getElementById('script-desc-switch');
        if (swDesc) {
            const circle = swDesc.querySelector('span');
            const targetSwClass = state.descriptionPrinciples ? "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-primary bg-primary" : "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-bg-input-80 bg-bg-input-80";
            const targetCircleClass = state.descriptionPrinciples ? "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[15px]" : "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[-1px]";
            if (swDesc.className !== targetSwClass) swDesc.className = targetSwClass;
            if (circle.className !== targetCircleClass) circle.className = targetCircleClass;
        }

        const swBan = document.getElementById('script-ban-switch');
        if (swBan) {
            const circle = swBan.querySelector('span');
            const targetSwClass = state.prohibitions ? "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-primary bg-primary" : "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border border-bg-input-80 bg-bg-input-80";
            const targetCircleClass = state.prohibitions ? "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[15px]" : "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform translate-x-[-1px]";
            if (swBan.className !== targetSwClass) swBan.className = targetSwClass;
            if (circle.className !== targetCircleClass) circle.className = targetCircleClass;
        }

        const b1 = document.getElementById('script-proactive-b1');
        const b2 = document.getElementById('script-proactive-b2');
        const b3 = document.getElementById('script-proactive-b3');
        if (b1 && b2 && b3) {
            b1.className = state.proactiveLevel === 1 ? "bg-text_brand text-white text-xs font-semibold py-2 rounded-md transition-all" : "bg-transparent text-text_tertiary text-xs font-medium py-2 rounded-md hover:bg-accent/30 transition-all";
            b2.className = state.proactiveLevel === 2 ? "bg-text_brand text-white text-xs font-semibold py-2 rounded-md transition-all" : "bg-transparent text-text_tertiary text-xs font-medium py-2 rounded-md hover:bg-accent/30 transition-all";
            b3.className = state.proactiveLevel === 3 ? "bg-text_brand text-white text-xs font-semibold py-2 rounded-md transition-all" : "bg-transparent text-text_tertiary text-xs font-medium py-2 rounded-md hover:bg-accent/30 transition-all";
        }

        if (textarea.getAttribute('maxlength') !== '99999') {
            textarea.removeAttribute('maxlength');
            textarea.setAttribute('maxlength', '99999');
        }

        const targetReadOnly = (state.currentTab !== 'usernote');
        if (textarea.readOnly !== targetReadOnly) textarea.readOnly = targetReadOnly;

        if (state.currentTab !== 'usernote') {
            const targetValue = buildFinalText();
            if (textarea.value.replace(/\r\n/g, '\n') !== targetValue.replace(/\r\n/g, '\n')) {
                const currentReadOnly = textarea.readOnly;
                textarea.readOnly = false;
                setReactInputValue(textarea, targetValue);
                textarea.readOnly = currentReadOnly;
                lastSeenRawText = targetValue.replace(/\r\n/g, '\n');
            }
        }

        const maxLimit = (extSwitch && (extSwitch.getAttribute('data-state') === 'checked' || extSwitch.getAttribute('aria-checked') === 'true')) ? 2000 : 500;
        if (counterSpan) {
            let targetHTML = "";
            if (state.currentTab === 'prompt' && (state.antiImpersonation || state.outputControl || state.imageControl || state.proactiveLevel > 0 || state.npcPrinciples || state.descriptionPrinciples || state.prohibitions)) {
                const baseLen = buildFinalText(true).length;
                const finalLen = buildFinalText(false).length;
                const addedLen = finalLen - baseLen;
                targetHTML = `${baseLen}/${maxLimit} -> <span style="color: #EF4444; font-weight: 600; margin-right: 4px;">+${addedLen}</span> ${finalLen}/${maxLimit}`;
            } else {
                targetHTML = `${textarea.value.length}/${maxLimit}`;
            }
            if (counterSpan.innerHTML !== targetHTML) counterSpan.innerHTML = targetHTML;
        }

        if (btnApply && btnRestore) {
            const targetDisplay = (state.currentTab === 'usernote') ? 'none' : 'inline-flex';
            if (btnRestore.style.display !== targetDisplay) btnRestore.style.display = targetDisplay;
            if (btnApply.style.display !== targetDisplay) btnApply.style.display = targetDisplay;
        }

        if (infoParagraph) {
            const targetInfoDisplay = (state.currentTab === 'usernote') ? 'block' : 'none';
            if (infoParagraph.style.display !== targetInfoDisplay) infoParagraph.style.display = targetInfoDisplay;
        }
    }

    // 📋 사용자가 수동 편집 시 실시간 상태 동기화 핸들러
    document.addEventListener('input', (e) => {
        if (e.target.tagName === 'TEXTAREA') {
            const modal = e.target.closest('[role="dialog"]');
            if (modal && modal.innerText.includes('유저노트')) {
                if (e.target.getAttribute('maxlength') !== '99999') {
                    e.target.removeAttribute('maxlength');
                    e.target.setAttribute('maxlength', '99999');
                }

                if (state.currentTab === 'usernote') {
                    let currentVal = e.target.value.replace(/\r\n/g, '\n');
                    if (/#must follow(?!s)/.test(currentVal)) {
                        let cursorIdx = e.target.selectionStart;
                        currentVal = currentVal.replace(/#must follow/g, '#must follows');
                        e.target.value = currentVal;
                        e.target.setSelectionRange(cursorIdx + 1, cursorIdx + 1);
                    }
                    parseTextIntoState(e.target.value);
                    lastSeenRawText = e.target.value.replace(/\r\n/g, '\n');
                }
                globalObserver.disconnect(); updateView(modal); reobserve();
            }
        }
    });

    // 🔍 마스터 옵저버
    const globalObserver = new MutationObserver(() => {
        if (isSyncing) return;

        const dialog = document.querySelector('[role="dialog"]');
        if (dialog && dialog.innerText.includes('유저노트')) {
            const textarea = dialog.querySelector('textarea');
            if (textarea) {
                const currentRaw = textarea.value.replace(/\r\n/g, '\n');
                const expectedBuilt = buildFinalText().replace(/\r\n/g, '\n');

                isSyncing = true;
                globalObserver.disconnect();

                if (!dialog.hasAttribute(PROCESSED_ATTR)) {
                    dialog.setAttribute(PROCESSED_ATTR, 'true');
                    injectStructure(dialog);
                    parseTextIntoState(textarea.value);
                    updateView(dialog);
                }
                else if (document.activeElement !== textarea && currentRaw !== expectedBuilt && currentRaw !== lastSeenRawText) {
                    lastSeenRawText = currentRaw;
                    state.currentTab = 'usernote';
                    parseTextIntoState(textarea.value);
                    updateView(dialog);
                } else {
                    updateView(dialog);
                }

                isSyncing = false;
                reobserve();
            }
        }
    });

    function reobserve() {
        globalObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-state', 'aria-checked']
        });
    }

    reobserve();
})();
