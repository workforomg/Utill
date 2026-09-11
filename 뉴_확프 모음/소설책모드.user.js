// ==UserScript==
// @name         책처럼 읽기
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @updateURL    https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EC%86%8C%EC%84%A4%EC%B1%85%EB%AA%A8%EB%93%9C.user.js
// @downloadURL  https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EC%86%8C%EC%84%A4%EC%B1%85%EB%AA%A8%EB%93%9C.user.js
// @author       지유지요
// @description  입력과 출력을 양면 책으로 읽기. Ctrl+좌우로 펼침 이동, 긴 응답 자동 페이지 분할.
// @match        https://crack.wrtn.ai/*
// @require      https://raw.githubusercontent.com/workforomg/Utill/main/dist/index.js
// @require      https://raw.githubusercontent.com/workforomg/Utill/main/dist/ui.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if (document.getElementById('crack-book-host')) return;
  const sdk = globalThis.CrackUI;
  if (!sdk?.getPrompt || !sdk?.isChatRoute) {
    console.warn('[크랙 책] dist/ui.js를 불러오지 못했습니다.');
    return;
  }
  const PREFIX = 'crack-book:v1:';
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(PREFIX + key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch {} };
  let enabled = read('enabled', false), size = Math.min(26, Math.max(14, Number(read('size', 18)) || 18));
  let theme = read('theme', 'paper') === 'night' ? 'night' : 'paper';
  let route = '', items = [], sourceList = null, scroller = null, spread = 0, pageCount = 1;
  let bookmark = null, timer = 0, resizeTimer = 0, generation = 0, loading = false, suspended = false;
  let lastSignature = '', geometry = '', rendered = false, nativeScroll = null;
  let observedScroller = null, observedPrompt = null;
  let navigationIntent = 0, statusUntil = 0;
  let immersive = false, nativeFullscreen = false, focusComposer = null;
  const focusStyles = new Map();
  const api = globalThis.Crack?.createCrackAPI?.();
  let balanceBusy = false, balanceLast = 0, balanceTimer = 0;
  let soundOn = read('sound', false) === true, audioContext = null;
  const soundSources = new Set(), modalStyles = new Map(), actionStyles = new Map();
  let nativeActions = [];
  let modalComposer = null, modalComposerInert = false;
  let inputCollapsed = false, inputLock = null, suggestionSignature = '';
  let suggestionSource = null;
  const hiddenRegions = new Map();
  const scrollbars = new Map();
  const host = document.createElement('div');
  host.id = 'crack-book-host';
  host.style.cssText = 'position:fixed;inset:0;z-index:80;pointer-events:none';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host{font:13px/1.5 system-ui,sans-serif;color:#e8e5df;color-scheme:light}
      *{box-sizing:border-box} [hidden]{display:none!important}
      button,select{font:inherit;cursor:pointer;border:1px solid #ffffff24;border-radius:7px;padding:6px 11px;color:inherit;background:#ffffff09}
      button:hover{background:#ffffff18}button:disabled{opacity:.35;cursor:default}button:focus-visible,select:focus-visible{outline:2px solid #ba995d;outline-offset:3px}
      #toggle{position:fixed;pointer-events:auto;background:#242422;color:#eee8da;box-shadow:0 3px 16px #0004;white-space:nowrap}
      #toggle[aria-checked=true]{border-color:#bca36e;color:#ecd5a3}
      #panel{position:fixed;pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;background:#232320;border:1px solid #55534a;border-radius:10px;box-shadow:0 12px 45px #0005}
      .tools{min-height:46px;display:flex;align-items:center;gap:7px;padding:7px 15px;flex-wrap:wrap}
      .brand{letter-spacing:.13em;font-size:11px;color:#c8b58d;margin-right:auto}.tools:has(#balance:not([hidden])) .brand{margin-right:0}.tools select{background:#30302b}
      #inputRestore{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);pointer-events:auto;z-index:2;background:#262823;color:#c9c7bc}
      #suggestions{--narration:#92989e;--muted:#aaa99e;--block:#2d302b;--block-rule:#484b41;--rule:#484b41;color:#f1efe8;position:fixed;pointer-events:auto;z-index:2;overflow:auto;padding:10px;background:#1e201c;border:1px solid #46483f;border-radius:10px;overscroll-behavior:contain}
      #suggestions h3{font:11px/1.5 system-ui,sans-serif;color:#aaa99e;margin:0 0 7px}.suggestionRow{display:flex;gap:5px;margin-top:5px;align-items:stretch}.suggestionRow .reply{flex:1;min-width:0;text-align:left;white-space:normal;overflow-wrap:anywhere;font-size:12px;line-height:1.6;padding:7px 9px}.suggestionRow .edit{flex:none;padding:5px;font-size:11px;color:#aaa99e}
      #balance{display:inline-flex;align-items:center;gap:7px;margin-right:auto;white-space:nowrap;font-variant-numeric:tabular-nums;color:#eee3c4;border:0;background:none;padding:3px 5px}#balance svg{flex:none;width:22px;height:22px}#balanceValue{min-width:2ch;text-align:right}
      #backdrop{position:fixed;inset:0;background:#141412;pointer-events:auto}#panel{z-index:1}
      #status{font-size:11px;color:#b9b5aa;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #paper{--paper:#f6f1e6;--ink:#25211b;--muted:#8b7a60;--narration:#777;--rule:#b7a17d66;--block:#ebe6db;--block-rule:#cfc7b6;position:relative;flex:1;min-height:0;background:var(--paper);color:var(--ink);padding:35px 42px 39px}
      #paper.night{--paper:#242622;--ink:#f1efe8;--muted:#aca991;--narration:#92989e;--rule:#b7b29644;--block:#2d302b;--block-rule:#484b41}
      #paper::before{content:'';position:absolute;top:0;bottom:0;left:50%;width:32px;transform:translateX(-50%);background:linear-gradient(90deg,transparent,#0000000b 45%,#00000017 50%,transparent);pointer-events:none}
      #viewport{height:100%;overflow:hidden;position:relative;overscroll-behavior:contain;touch-action:pan-y}
      #flow{height:100%;column-count:2;column-gap:72px;column-fill:auto;font-family:'Noto Serif KR','Nanum Myeongjo',Batang,serif;font-size:18px;line-height:1.95;overflow-wrap:anywhere;word-break:normal;transform:translateX(0);will-change:transform}
      article{margin:0 0 1.35em;display:block}article.user{break-before:column;break-after:avoid-column;color:var(--muted);font-family:system-ui,sans-serif;font-size:.9em;border-top:1px solid var(--rule);padding-top:.75em}
      article.assistant+article.assistant{break-before:column}article:first-child{break-before:auto}
      article.user::before{content:'나의 이야기';display:block;font:10px/1.7 system-ui,sans-serif;letter-spacing:.12em;margin-bottom:.7em;color:var(--muted)}
      p{margin:0 0 .85em;orphans:2;widows:2}p:last-child{margin-bottom:0}
      h1,h2,h3,h4,h5,h6{font-size:1.12em;line-height:1.6;margin:.6em 0;break-after:avoid}
      strong{font-weight:700}em,i{font-style:normal;color:var(--narration)}em *,i *{color:inherit}
      blockquote{margin:.9em 0;padding:.65em 1em;border-left:2px solid var(--muted);background:var(--block);color:var(--narration);box-decoration-break:clone;-webkit-box-decoration-break:clone}
      pre{font:.84em/1.8 ui-monospace,'D2Coding',Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:1em 0;padding:.9em 1em;background:var(--block);border:1px solid var(--block-rule);border-radius:7px;box-decoration-break:clone;-webkit-box-decoration-break:clone;tab-size:2}
      code{font-family:ui-monospace,'D2Coding',Consolas,monospace;font-size:.88em;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--block);border-radius:3px;padding:.12em .28em;box-decoration-break:clone;-webkit-box-decoration-break:clone}
      pre code{font:inherit;background:none;padding:0;border-radius:0}pre div{font:inherit}
      ul,ol{padding-left:1.3em;margin:.7em 0}li{margin:.3em 0}
      a{color:inherit;text-decoration:underline}img{display:block;max-width:100%;max-height:var(--image-height,300px);object-fit:contain;margin:.6em auto;break-inside:avoid}hr{border:0;border-top:1px solid var(--rule);margin:1em 0}
      table{width:100%;table-layout:fixed;border-collapse:collapse;margin:1em 0;font: .82em/1.65 system-ui,sans-serif;overflow-wrap:anywhere}
      th,td{border:1px solid var(--block-rule);padding:.55em .65em;text-align:left;vertical-align:top}th{background:var(--block);font-weight:600}caption{text-align:left;color:var(--narration);margin-bottom:.5em}thead{display:table-header-group}
      #empty{position:absolute;inset:20px;display:grid;place-items:center;text-align:center;font:15px/1.9 system-ui;color:var(--muted)}
      .folio{position:absolute;bottom:12px;left:25%;font:11px/1.5 system-ui;color:var(--muted)}.folio.right{left:75%}
      footer{min-height:45px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 15px}
      #counter{font-size:12px;font-variant-numeric:tabular-nums;color:#c2bcaf}.hint{font-size:10px;color:#8f8d83}
      @media(max-width:700px){.hint,.brand{display:none}.tools{gap:4px;padding:6px}button,select{padding:5px 7px}#paper{padding:22px 17px 32px}#flow{column-gap:30px}.folio{bottom:8px}#status{max-width:30%}}
    </style>
    <div id="backdrop" hidden></div>
    <button id="toggle" role="switch" aria-checked="false" aria-label="소설 모드">소설 모드 OFF</button>
    <section id="panel" aria-label="소설 읽기" hidden>
      <div class="tools"><span class="brand">CRACK / BOOK</span><button id="balance" aria-label="잔여 크래커 새로고침" title="잔여 크래커 · 클릭하여 새로고침"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="#FFA600" d="M21.17 12.01c.52-.59.83-1.36.83-2.21s-.31-1.62-.83-2.21l.17-.21q0-.01.02-.02l.14-.21q0-.02.03-.05.06-.1.1-.2l.05-.08.09-.2q.01-.05.04-.11l.06-.18q0-.08.04-.14.01-.07.04-.16l.03-.19q0-.06.02-.13v-.33a3.37 3.37 0 0 0-3.36-3.37l-.33.01q-.06 0-.12.02-.1 0-.2.03-.07 0-.15.04l-.14.04-.18.06-.11.04-.2.09-.07.04-.2.11q-.03 0-.05.03l-.21.14-.02.02-.21.17a3.4 3.4 0 0 0-4.42 0 3.3 3.3 0 0 0-2.21-.83c-.85 0-1.62.31-2.21.83l-.21-.17-.02-.02-.21-.14q-.02 0-.05-.03l-.2-.11-.08-.04-.2-.09-.11-.04-.18-.06-.14-.04-.16-.04-.2-.03-.12-.02-.33-.01a3.37 3.37 0 0 0-3.34 3.82q0 .1.03.19 0 .07.04.16 0 .08.04.14l.06.18q0 .05.04.11.03.1.09.19l.04.08.1.2q.01.02.04.05l.16.23q.07.1.17.21a3.3 3.3 0 0 0-.83 2.21c0 .85.3 1.62.83 2.21a3.3 3.3 0 0 0-.83 2.21c0 .85.3 1.62.83 2.21l-.17.21-.02.02-.14.21q0 .02-.03.05l-.11.2-.04.08-.1.2-.03.11-.06.18-.04.14-.04.16-.03.19-.02.13-.01.33A3.4 3.4 0 0 0 3.02 21c.6.61 1.45.99 2.38.99l.33-.01q.06 0 .12-.02.1 0 .19-.03.07 0 .16-.04l.14-.04.18-.06.1-.04.2-.09.08-.04.2-.11q.03 0 .05-.03l.2-.14.03-.02.2-.17a3.4 3.4 0 0 0 4.43 0 3.32 3.32 0 0 0 4.42 0 3 3 0 0 0 .44.33q.03 0 .05.03l.2.11.08.04.2.09.1.04.19.06.14.04.16.04.19.03.13.02.33.01c.92 0 1.75-.37 2.36-.97l.02-.02c.6-.61.99-1.45.99-2.38l-.01-.33q0-.06-.02-.12 0-.1-.03-.19 0-.07-.04-.16l-.04-.14-.06-.18-.04-.11-.1-.19-.03-.08-.11-.2q0-.02-.03-.05l-.14-.21-.02-.02-.17-.21c.52-.59.83-1.36.83-2.21s-.31-1.62-.83-2.21M7.5 13.5 6 12l1.5-1.5L9 12zM12 6l1.5 1.5L12 9l-1.5-1.5zm0 12-1.5-1.5L12 15l1.5 1.5zm4.5-4.5L15 12l1.5-1.5L18 12z"/></svg><span id="balanceValue">—</span></button><span id="status" role="status" aria-live="polite"></span><button id="smaller" aria-label="글자 작게">가−</button><button id="larger" aria-label="글자 크게">가+</button><select id="theme" aria-label="책 배경"><option value="paper">종이</option><option value="night">밤</option></select><button id="fullscreen" aria-pressed="false">전체 화면</button><button id="close" aria-label="소설 모드 끄기">OFF</button></div>
      <div id="paper"><div id="viewport"><div id="flow"></div></div><div id="empty">읽을 대화를 기다리고 있어요.</div><span class="folio" id="leftPage"></span><span class="folio right" id="rightPage"></span></div>
      <footer><button id="prev" aria-label="이전 펼침">← 이전</button><span id="counter" aria-live="polite"></span><span class="hint">Ctrl + ← / → · 책장 넘기기</span><button id="latest">맨 뒤</button><button id="next" aria-label="다음 펼침">다음 →</button></footer>
    </section><section id="suggestions" aria-label="추천답변" hidden><h3>추천답변</h3><div id="suggestionList"></div></section><button id="inputRestore" hidden>입력 올리기 · Ctrl + ↑</button>`;
  document.body.append(host);
  const $ = id => shadow.getElementById(id);
  const flow = $('flow'), panel = $('panel'), viewport = $('viewport');
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const maxSpread = () => Math.max(0, Math.ceil(pageCount / 2) - 1);
  const stride = () => (viewport.clientWidth + parseFloat(getComputedStyle(flow).columnGap)) / 2;
  const status = text => { if ($('status').textContent !== text) $('status').textContent = text; };
  const soundButton = document.createElement('button'); soundButton.id = 'sound';
  $('fullscreen').before(soundButton);
  function updateSoundButton() { soundButton.textContent = `넘김 소리 ${soundOn ? 'ON' : 'OFF'}`; soundButton.setAttribute('aria-pressed', String(soundOn)); }
  updateSoundButton(); $('balance').hidden = true;
  function prepareAudio() {
    try { const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return null; audioContext ||= new Audio(); if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {}); return audioContext; } catch { return null; }
  }
  function playPageSound() {
    if (!soundOn) return;
    const ctx = prepareAudio(); if (!ctx) return;
    // A short filtered noise envelope resembles a paper rustle; no external audio request.
    const duration = .19, buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate), samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) { const t = i / samples.length; samples[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * t) ** 1.5 * (.65 + .35 * Math.sin(t * 42)); }
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = buffer; filter.type = 'bandpass'; filter.frequency.value = 1800; filter.Q.value = .55; gain.gain.value = .12;
    source.connect(filter).connect(gain).connect(ctx.destination); soundSources.add(source);
    source.onended = () => { soundSources.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start();
  }
  soundButton.onclick = () => { soundOn = !soundOn; write('sound', soundOn); updateSoundButton(); if (soundOn) prepareAudio(); else for (const source of soundSources) { try { source.stop(); } catch {} } };

  function syncNativeModal() {
    const dialogs = [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].filter(d => d.getAttribute('data-state') !== 'closed' && !d.hidden && getComputedStyle(d).display !== 'none');
    if (!immersive || !dialogs.length) {
      for (const [node, style] of modalStyles) { if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style); }
      modalStyles.clear(); host.inert = false;
      if (modalComposer) modalComposer.inert = modalComposerInert;
      modalComposer = null; return;
    }
    for (const dialog of dialogs) {
      let portal = dialog; while (portal.parentElement && portal.parentElement !== document.body) portal = portal.parentElement;
      if (portal === host || portal.contains(host)) continue;
      if (!modalStyles.has(portal)) modalStyles.set(portal, portal.getAttribute('style'));
      for (const [key, value] of Object.entries({ visibility:'visible', 'pointer-events':'auto', position:'relative', 'z-index':'2147483000' })) portal.style.setProperty(key, value, 'important');
    }
    host.inert = true;
    if (focusComposer && !modalComposer) { modalComposer = focusComposer; modalComposerInert = focusComposer.inert; focusComposer.inert = true; }
  }
  function actionStyle(node, properties) {
    if (!actionStyles.has(node)) actionStyles.set(node, node.getAttribute('style'));
    for (const [key, value] of Object.entries(properties)) node.style.setProperty(key, value, 'important');
  }
  function restoreNativeActions() {
    // Restore the focus layout first; leaveFullscreen then restores the site's original styles.
    for (const [node, style] of actionStyles) { if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style); }
    actionStyles.clear(); nativeActions = [];
  }
  function syncNativeActions() {
    if (!immersive) return;
    const controls = [...document.querySelectorAll('main button,main [role="button"],[role="main"] [role="button"]')];
    const found = ['요약메모리', '유저노트'].map(label => controls.find(node =>
      !node.closest(sdk.SELECTORS.message) && node.textContent.replace(/\s/g, '') === label));
    if (found.some((node, i) => node !== nativeActions[i])) {
      restoreNativeActions(); nativeActions = found;
      for (const button of found.filter(Boolean)) {
        // Keep the exact React node, its parents, handlers and modal trigger relationship intact.
        // A closed settings sidebar still mounts these role=button elements on Crack.
        for (let parent = button.parentElement; parent && parent !== document.body && !parent.contains(focusComposer); parent = parent.parentElement) {
          const width = parent.getBoundingClientRect().width;
          actionStyle(parent, {visibility:'hidden', 'pointer-events':'none', overflow:'visible', transform:'none',
            filter:'none', perspective:'none', contain:'none', isolation:'auto', position:'static',
            'z-index':'auto', 'will-change':'auto', transition:'none', width:width + 'px'});
        }
        actionStyle(button, {position:'fixed', top:'auto', left:'auto', bottom:'16px', width:'132px',
          height:'42px', margin:'0', padding:'8px 10px', 'box-sizing':'border-box', display:'flex',
          'justify-content':'center', background:'#262823', color:'#e8e5df', border:'1px solid #56594c',
          'border-radius':'7px', 'box-shadow':'0 3px 14px #0004', transform:'none',
          'z-index':'110', visibility:'visible', 'pointer-events':'auto'});
      }
    }
    const dialogOpen = Boolean(document.querySelector('dialog[open],[role="dialog"]:not([data-state="closed"]),[role="alertdialog"]:not([data-state="closed"])'));
    nativeActions.forEach((button, i) => { if (button) actionStyle(button, {
      right:(i === 0 ? 156 : 16) + 'px', visibility:(dialogOpen || inputCollapsed) ? 'hidden' : 'visible', 'pointer-events':(dialogOpen || inputCollapsed) ? 'none' : 'auto'
    }); });
  }

  function restoreInputLock() {
    if (!inputLock) return;
    inputLock.element.inert = inputLock.inert;
    if (inputLock.aria === null) inputLock.element.removeAttribute('aria-hidden'); else inputLock.element.setAttribute('aria-hidden', inputLock.aria);
    inputLock = null;
  }
  function setInputCollapsed(value) {
    if (!immersive || !focusComposer || inputCollapsed === value) return;
    bookmark = captureAnchor(); inputCollapsed = value;
    if (value) {
      inputLock = {element:focusComposer,inert:focusComposer.inert,aria:focusComposer.getAttribute('aria-hidden')};
      if (focusComposer.contains(document.activeElement)) document.activeElement.blur();
      focusComposer.inert = true; focusComposer.setAttribute('aria-hidden', 'true');
    } else restoreInputLock();
    geometry = ''; tick(); layout();
    if (!value) sdk.getPrompt()?.focus({preventScroll:true});
  }
  $('inputRestore').onclick = () => setInputCollapsed(false);

  function syncSuggestions() {
    const pane = $('suggestions');
    if (!enabled || (immersive && inputCollapsed) || !sourceList) { pane.hidden = true; return; }
    // Crack mounts this direct-child list only while its own recommendation setting is on.
    const source = [...sourceList.children].find(node => node.classList.contains('max-w-[640px]') && node.classList.contains('items-end') && node.querySelector('button'));
    if (!source || source.hidden || getComputedStyle(source).display === 'none') { pane.hidden = true; suggestionSignature = ''; suggestionSource = null; return; }
    const replies = [...source.querySelectorAll('button')].filter(button => button.querySelector('.wrtn-markdown') && button.textContent.trim());
    if (!replies.length) { pane.hidden = true; return; }
    const signature = replies.map(button => `${button.disabled}:${button.querySelector('.wrtn-markdown').innerHTML}`).join('\n');
    if (source !== suggestionSource || signature !== suggestionSignature) {
      suggestionSource = source; suggestionSignature = signature;
      const rows = replies.map((original, index) => {
        const row = document.createElement('div'); row.className = 'suggestionRow';
        const reply = document.createElement('button'); reply.className = 'reply'; reply.disabled = original.disabled; reply.title = '이 추천답변 보내기';
        const originalText = original.textContent.trim();
        // Preserve the site's rendered Markdown using the same inert-content sanitizer as the book.
        const content = clean(original.querySelector('.wrtn-markdown')); stripBlockLabels(content);
        // The entire reply is a send button: avoid nesting interactive links inside it.
        for (const link of content.querySelectorAll('a')) {
          const label = document.createElement('span'); label.style.textDecoration = 'underline';
          label.append(...link.childNodes); link.replaceWith(label);
        }
        reply.append(content);
        const currentOriginal = () => [...(suggestionSource?.querySelectorAll('button') || [])].filter(b => b.querySelector('.wrtn-markdown') && b.textContent.trim())[index];
        reply.onclick = () => { if (!enabled || (immersive && inputCollapsed)) return; const target = currentOriginal(); if (target?.isConnected && !target.disabled && target.textContent.trim() === originalText) target.click(); };
        row.append(reply);
        const editOriginal = original.previousElementSibling;
        if (editOriginal?.matches('button')) {
          const edit = document.createElement('button'); edit.className = 'edit'; edit.textContent = '넣기'; edit.title = '입력칸에 넣고 수정'; edit.setAttribute('aria-label', `추천답변 ${index + 1} 입력칸에 넣기`);
          edit.onclick = () => { if (!enabled || (immersive && inputCollapsed)) return; const target = currentOriginal()?.previousElementSibling; if (target?.matches('button') && target.isConnected && !target.disabled) target.click(); };
          row.append(edit);
        }
        return row;
      });
      $('suggestionList').replaceChildren(...rows);
    }
    pane.hidden = false;
  }

  async function refreshBalance() {
    if (!enabled || !immersive || !route || document.hidden || balanceBusy) return;
    balanceBusy = true; balanceLast = Date.now(); $('balance').setAttribute('aria-busy', 'true');
    try {
      if (!api) throw new Error('SDK missing');
      const data = await api.account.crackers();
      const raw = data?.quantity;
      const value = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid balance');
      $('balanceValue').textContent = value.toLocaleString('ko-KR');
      $('balance').title = `잔여 크래커 ${value.toLocaleString('ko-KR')}개 · 클릭하여 새로고침`;
    } catch {
      $('balanceValue').textContent = '—';
      $('balance').title = '잔여 크래커 조회 실패 · 클릭하여 다시 확인';
    } finally { balanceBusy = false; $('balance').setAttribute('aria-busy', 'false'); }
  }
  function queueBalance() {
    if (balanceTimer) return;
    balanceTimer = setTimeout(() => { balanceTimer = 0; void refreshBalance(); }, Math.max(1200, 5000 - (Date.now() - balanceLast)));
  }
  function composerFor(prompt) {
    const width = prompt.getBoundingClientRect().width;
    let composer = prompt;
    while (composer.parentElement && composer.parentElement !== document.body) {
      const box = composer.parentElement.getBoundingClientRect();
      if (box.height > 230 || box.width > width + 180) break;
      composer = composer.parentElement;
    }
    return composer;
  }
  function focusStyle(el, properties) {
    if (!focusStyles.has(el)) focusStyles.set(el, el.getAttribute('style'));
    for (const [key, value] of Object.entries(properties)) el.style.setProperty(key, value, 'important');
  }
  function leaveFullscreen() {
    immersive = false;
    syncNativeModal(); restoreInputLock(); inputCollapsed = false;
    $('inputRestore').hidden = true; $('suggestions').hidden = true;
    syncNativeModal(); restoreNativeActions(); $('balance').hidden = true;
    for (const [el, original] of focusStyles) { if (original === null) el.removeAttribute('style'); else el.setAttribute('style', original); }
    focusStyles.clear(); focusComposer = null; $('backdrop').hidden = true;
    $('fullscreen').textContent = '전체 화면'; $('fullscreen').setAttribute('aria-pressed', 'false'); geometry = '';
    if (nativeFullscreen && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {});
    nativeFullscreen = false; schedule(); queueLayout();
  }
  function enterFullscreen() {
    const prompt = sdk.getPrompt(); if (!prompt) return;
    bookmark = captureAnchor(); inputCollapsed = false; focusComposer = composerFor(prompt); immersive = true;
    // Keep the real editor mounted in React's original tree. Only reversible layout styles change.
    const ancestors = [];
    for (let node = focusComposer.parentElement; node && node !== document.body; node = node.parentElement) ancestors.push([node, node.getBoundingClientRect()]);
    let child = focusComposer;
    for (let parent = child.parentElement; parent; child = parent, parent = parent.parentElement) {
      for (const sibling of parent.children) if (sibling !== child && sibling !== host && !sibling.contains(host)) focusStyle(sibling, { visibility: 'hidden', 'pointer-events': 'none' });
      focusStyle(parent, { transform:'none', filter:'none', perspective:'none', contain:'none', isolation:'auto', overflow:'visible', position:'static', 'z-index':'auto', 'will-change':'auto' });
      if (parent === document.body) break;
    }
    // Preserve the hidden history viewport so its native infinite loader still has a scroll boundary.
    for (const [node, rect] of ancestors) focusStyle(node, { width:rect.width + 'px', height:rect.height + 'px' });
    focusStyle(document.body, { overflow:'hidden' });
    focusStyle(focusComposer, { position:'fixed', left:'50%', bottom:'8px', top:'auto', transform:'translateX(-50%)', width:'min(960px, calc(100vw - 32px))', 'max-width':'none', 'max-height':'35vh', 'overflow-y':'auto', 'z-index':'100', visibility:'visible', 'pointer-events':'auto', background:'#141412', margin:'0' });
    $('backdrop').hidden = false; $('balance').hidden = false; $('fullscreen').textContent = '전체 화면 해제'; $('fullscreen').setAttribute('aria-pressed', 'true'); geometry = '';
    void refreshBalance();
    tick(); layout();
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().then(() => {
        if (immersive) nativeFullscreen = true; else if (document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {});
      }).catch(() => { /* Window-filling reading mode remains available when fullscreen is denied. */ });
    }
  }

  // Only semantic, inert content is copied; site scripts, styles and controls never enter the book.
  const allowed = new Set('P BR STRONG B EM I U S DEL SUP SUB MARK BLOCKQUOTE PRE CODE UL OL LI H1 H2 H3 H4 H5 H6 HR SPAN DIV A IMG TABLE THEAD TBODY TFOOT TR TD TH CAPTION'.split(' '));
  function clean(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE || node.matches('script,style,button,svg,iframe,form,input,textarea,select,[aria-hidden="true"],[hidden]')) return document.createDocumentFragment();
    if (node.tagName === 'IMG') {
      const src = node.currentSrc || node.getAttribute('src');
      if (!src) return document.createTextNode(node.getAttribute('alt') || '');
      let url; try { url = new URL(src, location.href); } catch { return document.createDocumentFragment(); }
      if (!['https:', 'http:', 'data:', 'blob:'].includes(url.protocol)) return document.createDocumentFragment();
      const image = document.createElement('img'); image.src = url.href; image.alt = node.getAttribute('alt') || '';
      image.referrerPolicy = 'no-referrer'; return image;
    }
    const out = document.createElement(allowed.has(node.tagName) ? node.tagName.toLowerCase() : 'div');
    if (['TD', 'TH'].includes(node.tagName)) {
      for (const key of ['colspan', 'rowspan']) {
        const span = Number(node.getAttribute(key));
        if (Number.isInteger(span) && span > 0 && span <= 100) out.setAttribute(key, String(span));
      }
    }
    if (node.tagName === 'OL' && node.hasAttribute('start')) {
      const start = Number(node.getAttribute('start')); if (Number.isInteger(start)) out.setAttribute('start', String(start));
    }
    if (node.tagName === 'A') {
      try { const url = new URL(node.getAttribute('href'), location.href); if (['https:', 'http:'].includes(url.protocol)) { out.href = url.href; out.target = '_blank'; out.rel = 'noopener noreferrer'; } } catch {}
    }
    for (const child of node.childNodes) out.append(clean(child));
    return out;
  }

  function locate() {
    const main = document.querySelector('main,[role="main"]') || document.body;
    const groups = [...main.querySelectorAll(sdk.SELECTORS.message)].filter(x => x.querySelector('.wrtn-markdown'));
    if (!groups.length) return null;
    // Current Crack uses direct children in a column-reverse list. Keep this adapter isolated.
    const counts = new Map();
    for (const group of groups) counts.set(group.parentElement, (counts.get(group.parentElement) || 0) + 1);
    const list = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    let scroll = list.parentElement;
    while (scroll && scroll !== document.body && !/auto|scroll/.test(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement;
    if (!scroll || scroll === document.body) scroll = main.querySelector('.stick-to-bottom')?.firstElementChild;
    return { list, scroll, groups: groups.filter(x => x.parentElement === list) };
  }

  function stripBlockLabels(root) {
    for (const label of root.querySelectorAll('p,div,span')) {
      if (label.closest('code') || label.textContent.trim().toUpperCase() !== 'INFO') continue;
      const next = label.nextElementSibling;
      if (!next) continue;
      const beforeBlock = !label.closest('pre') && (next.matches('pre') || next.querySelector('pre'));
      const insideHeader = label.parentElement?.matches('pre') && next.matches('code');
      if (beforeBlock || insideHeader) label.remove();
    }
  }

  function restoreNative() {
    for (const [el, original] of hiddenRegions) {
      el.style.visibility = original.visibility;
      if (original.aria === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', original.aria);
      el.inert = original.inert;
    }
    hiddenRegions.clear();
    for (const [el, value] of scrollbars) el.style.scrollbarWidth = value;
    scrollbars.clear();
  }
  function hideNative() {
    if (scroller && !scrollbars.has(scroller)) { scrollbars.set(scroller, scroller.style.scrollbarWidth); scroller.style.scrollbarWidth = 'none'; }
    if (!sourceList || hiddenRegions.has(sourceList)) return;
    hiddenRegions.set(sourceList, { visibility: sourceList.style.visibility, aria: sourceList.getAttribute('aria-hidden'), inert: sourceList.inert });
    sourceList.style.visibility = 'hidden'; sourceList.setAttribute('aria-hidden', 'true'); sourceList.inert = true;
  }

  function syncContent() {
    const found = locate();
    if (!found) {
      if (sourceList?.isConnected && !sourceList.querySelector('.wrtn-markdown') && items.length) {
        items = []; lastSignature = ''; flow.replaceChildren(); rendered = false; bookmark = null; return true;
      }
      return false;
    }
    if (sourceList !== found.list) { restoreNative(); sourceList = found.list; }
    scroller = found.scroll;
    if (scroller !== observedScroller) {
      if (observedScroller) resize.unobserve(observedScroller);
      observedScroller = scroller;
      if (observedScroller) resize.observe(observedScroller);
    }
    let groups = found.groups;
    if (getComputedStyle(sourceList).flexDirection === 'column-reverse') groups = groups.reverse();
    const fresh = groups.map(group => {
      const content = document.createElement('article');
      content.dataset.id = group.getAttribute('data-message-group-id');
      content.className = group.querySelector('.border-y.border-outline_tertiary') ? 'user' : 'assistant';
      for (const body of group.querySelectorAll('.wrtn-markdown')) for (const child of body.childNodes) content.append(clean(child));
      stripBlockLabels(content);
      return { id: content.dataset.id, html: content.outerHTML, element: content };
    });
    // The rendered list is authoritative, including rerolls, edits and deletions.
    const nextItems = fresh;
    const signature = nextItems.map(x => x.html).join('');
    if (signature === lastSignature) return false;
    const anchor = bookmark || captureAnchor();
    items = nextItems; lastSignature = signature;
    queueBalance();
    flow.replaceChildren(...items.map(x => x.element.cloneNode(true)));
    bookmark = anchor;
    rendered = true;
    for (const image of flow.querySelectorAll('img')) {
      image.addEventListener('load', queueLayout, { once: true });
      image.addEventListener('error', () => { image.replaceWith(document.createTextNode(image.alt || '[이미지]')); queueLayout(); }, { once: true });
    }
    return true;
  }

  function textNodes(article) {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }
  function charPage(node, offset) {
    const range = document.createRange();
    range.setStart(node, clamp(offset, 0, Math.max(0, node.length - 1)));
    range.setEnd(node, Math.min(node.length, offset + 1));
    const rect = range.getBoundingClientRect();
    return Math.max(0, Math.floor((rect.left - flow.getBoundingClientRect().left + .5) / stride()));
  }
  function captureAnchor() {
    if (!rendered || !viewport.clientWidth) return bookmark;
    const wanted = spread * 2;
    for (const article of flow.children) {
      let count = 0;
      for (const node of textNodes(article)) {
        if (node.length && charPage(node, node.length - 1) >= wanted) {
          let lo = 0, hi = node.length - 1;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (charPage(node, mid) < wanted) lo = mid + 1; else hi = mid; }
          return { id: article.dataset.id, offset: count + lo };
        }
        count += node.length;
      }
    }
    return bookmark;
  }
  function restoreAnchor(anchor) {
    if (!anchor) return;
    const article = [...flow.children].find(x => x.dataset.id === anchor.id);
    if (!article) return;
    let remaining = Math.max(0, Number(anchor.offset) || 0), last;
    for (const node of textNodes(article)) {
      last = node;
      if (remaining < node.length) { spread = Math.floor(charPage(node, remaining) / 2); return; }
      remaining -= node.length;
    }
    if (last?.length) spread = Math.floor(charPage(last, last.length - 1) / 2);
  }
  function showSpread(save = false) {
    spread = clamp(spread, 0, maxSpread());
    flow.style.transform = `translateX(${-spread * stride() * 2}px)`;
    $('leftPage').textContent = rendered ? spread * 2 + 1 : '';
    $('rightPage').textContent = rendered && spread * 2 + 2 <= pageCount ? spread * 2 + 2 : '';
    const first = spread * 2 + 1, last = Math.min(spread * 2 + 2, pageCount);
    $('counter').textContent = rendered ? `${first === last ? first : `${first}–${last}`} / ${pageCount}쪽` : '대화 대기 중';
    $('prev').disabled = loading && spread === 0; $('next').disabled = spread >= maxSpread();
    $('prev').setAttribute('aria-busy', String(loading));
    $('empty').hidden = items.length > 0;
    if (save) { bookmark = captureAnchor(); if (bookmark) write('position:' + route, bookmark); }
  }
  function layout() {
    if (!enabled || suspended || panel.hidden || !viewport.clientWidth) return;
    flow.style.fontSize = size + 'px';
    flow.style.setProperty('--image-height', Math.max(40, viewport.clientHeight - 45) + 'px');
    $('paper').classList.toggle('night', theme === 'night');
    flow.style.transform = 'translateX(0)';
    const step = stride();
    const origin = flow.getBoundingClientRect().left;
    pageCount = Math.max(1, ...[...flow.children].flatMap(article => [...article.getClientRects()].map(rect => Math.floor((rect.left - origin + .5) / step) + 1)));
    restoreAnchor(bookmark);
    showSpread();
    if (!bookmark) bookmark = captureAnchor();
    if (bookmark) write('position:' + route, bookmark);
    $('smaller').disabled = size <= 14; $('larger').disabled = size >= 26;
  }
  function queueLayout() { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 60); }
  function positionPanel() {
    const prompt = sdk.getPrompt();
    if (!prompt) { if (immersive) leaveFullscreen(); panel.hidden = true; $('toggle').hidden = true; restoreNative(); return false; }
    if (immersive && !focusComposer?.isConnected) leaveFullscreen();
    if (immersive) {
      focusComposer.style.setProperty('bottom', innerWidth >= 1600 ? '8px' : '66px', 'important');
      focusComposer.style.setProperty('transform', inputCollapsed ? 'translate(-50%, calc(100% + 120px))' : 'translateX(-50%)', 'important');
      focusComposer.style.setProperty('visibility', inputCollapsed ? 'hidden' : 'visible', 'important');
      focusComposer.style.setProperty('pointer-events', inputCollapsed ? 'none' : 'auto', 'important');
      $('inputRestore').hidden = true;
    }
    if (prompt !== observedPrompt) {
      if (observedPrompt) resize.unobserve(observedPrompt);
      observedPrompt = prompt; resize.observe(prompt);
    }
    $('toggle').hidden = false;
    const promptBox = prompt.getBoundingClientRect();
    // Prefer the history viewport; it spans the session width, unlike the narrower composer.
    let bounds = scroller?.getBoundingClientRect();
    if (!bounds || bounds.width < 200 || bounds.height < 100) bounds = document.querySelector('main')?.getBoundingClientRect();
    const left = immersive ? 8 : Math.max(8, bounds?.left ?? promptBox.left), right = immersive ? innerWidth - 8 : Math.min(innerWidth - 8, bounds?.right ?? promptBox.right);
    const composer = immersive ? focusComposer : composerFor(prompt);
    const composerRect = composer.getBoundingClientRect();
    let composerTop = composerRect.top;
    syncSuggestions();
    if (!$('suggestions').hidden) {
      const suggestions = $('suggestions');
      if (composerRect.left - left >= 260) {
        suggestions.style.left = (left + 8) + 'px'; suggestions.style.width = Math.min(440, composerRect.left - left - 16) + 'px';
        suggestions.style.height = Math.max(80, composerRect.height) + 'px'; suggestions.style.top = composerRect.top + 'px';
      } else {
        const height = Math.min(145, innerHeight * .18);
        suggestions.style.left = (left + 8) + 'px'; suggestions.style.width = Math.min(440, right - left - 16) + 'px';
        suggestions.style.height = height + 'px'; suggestions.style.top = composerRect.top - height - 8 + 'px';
        composerTop = composerRect.top - height - 8;
      }
    }
    const header = document.querySelector('main [class~="group/header"]');
    const top = immersive ? 8 : Math.max(8, bounds?.top ?? 150, header ? header.getBoundingClientRect().bottom + 6 : 0), bottom = immersive && inputCollapsed ? innerHeight - 8 : Math.min(innerHeight - 8, composerTop - 8);
    $('toggle').style.left = `${Math.max(8, right - 127)}px`;
    $('toggle').style.top = `${Math.max(8, top + 5)}px`;
    suspended = right - left < 280 || bottom - top < 230;
    panel.hidden = !enabled || suspended;
    if (panel.hidden) { $('suggestions').hidden = true; restoreNative(); return false; }
    const nextGeometry = [left, top, right - left, bottom - top].map(Math.round).join(',');
    if (geometry !== nextGeometry) {
      geometry = nextGeometry;
      panel.style.left = left + 'px'; panel.style.top = top + 'px'; panel.style.width = right - left + 'px'; panel.style.height = bottom - top + 'px';
      queueLayout();
    }
    hideNative();
    return true;
  }

  function tick() {
    timer = 0;
    syncNativeModal(); syncNativeActions();
    const current = sdk.isChatRoute() ? location.pathname : '';
    if (route !== current) {
      if (immersive) leaveFullscreen();
      generation++; navigationIntent++; loading = false; statusUntil = 0; restoreNative();
      items = []; lastSignature = ''; sourceList = scroller = null; geometry = ''; nativeScroll = null;
      route = current; bookmark = read('position:' + route, null); spread = 0; rendered = false; flow.replaceChildren();
    }
    if (!route) { $('suggestions').hidden = true; panel.hidden = true; $('toggle').hidden = true; return; }
    $('toggle').hidden = false; $('toggle').textContent = `소설 모드 ${enabled ? 'ON' : 'OFF'}`;
    $('toggle').setAttribute('aria-checked', String(enabled));
    if (!enabled) { panel.hidden = true; restoreNative(); positionPanel(); return; }
    const changed = syncContent();
    if (!balanceLast) void refreshBalance();
    if (positionPanel() && changed) layout();
    if (!loading && Date.now() >= statusUntil) status(items.length ? `불러온 메시지 ${items.length}개` : '대화를 불러오는 중');
  }
  function schedule() { if (!timer) timer = setTimeout(tick, 180); }
  function toggle(value) {
    if (enabled) { bookmark = captureAnchor(); if (bookmark) write('position:' + route, bookmark); }
    if (!value && immersive) leaveFullscreen();
    enabled = value; write('enabled', value);
    if (value) { nativeScroll = scroller ? { el: scroller, top: scroller.scrollTop } : null; }
    else { generation++; navigationIntent++; loading = false; restoreNative(); if (nativeScroll?.el.isConnected) nativeScroll.el.scrollTop = nativeScroll.top; }
    tick(); if (value) layout();
  }
  function turn(delta) {
    if (!enabled || panel.hidden) return;
    if (soundOn) prepareAudio();
    if (delta < 0 && spread === 0) {
      if (!loading) { navigationIntent++; void loadOlder(); }
      return;
    }
    navigationIntent++;
    const previous = spread;
    spread = clamp(spread + delta, 0, maxSpread()); showSpread(true);
    if (spread !== previous) playPageSound();
  }
  async function loadOlder() {
    if (loading || !scroller) {
      if (!scroller) { status('대화가 준비되면 이전으로 다시 이동해 주세요.'); statusUntil = Date.now() + 4000; }
      return;
    }
    bookmark = captureAnchor();
    loading = true; showSpread(); status('이전 대화 불러오는 중…');
    const token = generation, intent = navigationIntent, activeRoute = route;
    const original = scroller, firstId = items[0]?.id;
    const top = original.scrollTop;
    let added = false;
    // Use the site's own infinite history loader; no extra chat socket or send request.
    original.scrollTop = getComputedStyle(original).flexDirection === 'column-reverse' ? -original.scrollHeight : 0;
    original.dispatchEvent(new Event('scroll', { bubbles: true }));
    try {
      for (let n = 0; n < 60; n++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        if (token !== generation || !enabled || location.pathname !== activeRoute) return;
        const changed = syncContent(); if (changed) layout();
        // A newly streamed response at the end is not older history.
        const oldIndex = items.findIndex(item => item.id === firstId);
        if (oldIndex > 0) {
          added = true;
          // layout() restores the old reading position after prepending. Turn back from there.
          if (intent === navigationIntent) { spread = Math.max(0, spread - 1); showSpread(true); playPageSound(); }
          break;
        }
      }
    } finally {
      if (token === generation && location.pathname === activeRoute) {
        original.scrollTop = top; loading = false; showSpread();
        status(added ? '이전 대화를 이어서 읽을 수 있어요.' : '이전 대화가 없거나 응답이 지연되고 있어요. ←로 다시 시도할 수 있어요.');
        statusUntil = Date.now() + 5000;
      }
    }
  }
  $('toggle').onclick = () => toggle(!enabled); $('close').onclick = () => toggle(false);
  $('fullscreen').onclick = () => immersive ? leaveFullscreen() : enterFullscreen();
  $('balance').onclick = () => { clearTimeout(balanceTimer); balanceTimer = 0; void refreshBalance(); };
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === document.documentElement && immersive) nativeFullscreen = true;
    else if (nativeFullscreen && immersive) leaveFullscreen();
    schedule(); queueLayout();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && immersive && !document.fullscreenElement && !document.querySelector('[role="dialog"],dialog[open],[role="alertdialog"]')) { event.preventDefault(); leaveFullscreen(); }
  });
  window.addEventListener('focus', () => { if (Date.now() - balanceLast > 5000) void refreshBalance(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - balanceLast > 5000) void refreshBalance(); });
  setInterval(() => { if (Date.now() - balanceLast >= 30000) void refreshBalance(); }, 30000);
  $('prev').onclick = () => turn(-1); $('next').onclick = () => turn(1);
  $('latest').onclick = () => { navigationIntent++; const previous = spread; spread = maxSpread(); showSpread(true); if (spread !== previous) playPageSound(); };
  for (const [id, delta] of [['smaller', -1], ['larger', 1]]) $(id).onclick = () => { bookmark = captureAnchor(); size = clamp(size + delta, 14, 26); write('size', size); layout(); };
  $('theme').value = theme;
  $('theme').onchange = () => { theme = $('theme').value; write('theme', theme); layout(); };
  const nativeDialogOpen = () => Boolean(document.querySelector('dialog[open],[role="dialog"]:not([data-state="closed"]),[role="alertdialog"]:not([data-state="closed"])'));
  window.addEventListener('keydown', event => {
    if (!immersive || !enabled || nativeDialogOpen() || event.isComposing) return;
    if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      setInputCollapsed(event.key === 'ArrowDown'); return;
    }
    if (!inputCollapsed) return;
    const readingKeys = ['Escape','Tab','Shift','Control','Alt','Meta','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End'];
    const browserShortcut = (event.ctrlKey || event.metaKey) && !event.altKey && /^[acflrwtpn+\-=0]$/i.test(event.key);
    if (readingKeys.includes(event.key) || /^F\d{1,2}$/.test(event.key) || browserShortcut) return;
    // Prevent the site's recommendation-number, submit and auto-focus shortcuts while locked.
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  for (const type of ['beforeinput', 'paste', 'cut', 'drop', 'submit']) window.addEventListener(type, event => {
    if (immersive && inputCollapsed && focusComposer?.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('focusin', event => { if (immersive && inputCollapsed && focusComposer?.contains(event.target)) event.target.blur?.(); }, true);
  window.addEventListener('keydown', event => {
    if (!enabled || panel.hidden || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    // Preserve word navigation while composing and shortcuts in open site dialogs.
    if (event.composedPath().some(x => x instanceof Element && x.matches('input,textarea,select,[contenteditable="true"],[role="dialog"]')) || document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); turn(event.key === 'ArrowRight' ? 1 : -1);
  }, true);
  viewport.addEventListener('wheel', event => { event.preventDefault(); }, { passive: false });
  const observer = new MutationObserver(records => {
    if (records.some(r => !host.contains(r.target))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  const resize = new ResizeObserver(() => { schedule(); queueLayout(); }); resize.observe(document.documentElement); resize.observe(viewport);
  window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('popstate', schedule);
  setInterval(() => { if (location.pathname !== route && (route || sdk.isChatRoute())) schedule(); }, 400);
  document.fonts?.ready.then(queueLayout);
  tick();
})();
