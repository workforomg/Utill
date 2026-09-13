// ==UserScript==
// @name         떠 있는 마크다운 UI
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @updateURL    https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EB%A7%88%ED%81%AC%EB%8B%A4%EC%9A%B4UI.user.js
// @downloadURL  https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EB%A7%88%ED%81%AC%EB%8B%A4%EC%9A%B4UI.user.js
// @author       지유지요
// @description  최신 코드 블록 동기화, 이동·크기 조절, 다섯 가지 테마와 사용자 배경
// @match        https://crack.wrtn.ai/*
// @require      https://raw.githubusercontent.com/workforomg/Utill/main/dist/ui.js
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if (document.getElementById('crack-floating-markdown')) return;
  if (typeof CrackUI === 'undefined') { console.error('크랙 마크다운: @require SDK를 불러오지 못했습니다.'); return; }
  const ui = CrackUI.createPageUI();
  const SKINS = {"mobile":{"width":1024,"height":1536,"src":"https://raw.githubusercontent.com/workforomg/Utill/main/etc.asset/%EB%A7%88%EC%BB%A4%EB%8B%A4%EC%9A%B4%20%ED%85%8C%EB%A7%88/mobile.png"},"cyber":{"width":1024,"height":1536,"src":"https://raw.githubusercontent.com/workforomg/Utill/main/etc.asset/%EB%A7%88%EC%BB%A4%EB%8B%A4%EC%9A%B4%20%ED%85%8C%EB%A7%88/cyber.png"},"paper":{"width":1024,"height":1536,"src":"https://raw.githubusercontent.com/workforomg/Utill/main/etc.asset/%EB%A7%88%EC%BB%A4%EB%8B%A4%EC%9A%B4%20%ED%85%8C%EB%A7%88/paper.png"},"note":{"width":1024,"height":1536,"src":"https://raw.githubusercontent.com/workforomg/Utill/main/etc.asset/%EB%A7%88%EC%BB%A4%EB%8B%A4%EC%9A%B4%20%ED%85%8C%EB%A7%88/note.png"}};
  const KEY = 'crack-floating-markdown-v1';
  const defaults = { theme: 'markdown', color: '', image: '', x: null, y: 90, width: 360, height: 390, open: true, folded: false, hide: true, label: 'INFO', imageFit: 'contain', backgrounds: {} };
  let saved = {};
  try { saved = typeof GM_getValue === 'function' ? GM_getValue(KEY, {}) : JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  const prefs = { ...defaults, ...saved };
  const save = () => { try { if (typeof GM_setValue === 'function') GM_setValue(KEY, prefs); else localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { status.textContent = '설정을 저장하지 못했어요'; } };
  const host = document.createElement('div');
  host.id = 'crack-floating-markdown';
  host.style.cssText = 'position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483000!important;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; font: 14px/1.6 system-ui, sans-serif; color-scheme: dark; }
      * { box-sizing: border-box; } [hidden] { display:none!important; }
      .panel { --bg:#24292e; --fg:#e1e4e8; --edge:#47515c; --accent:#86baff; --bar:#1c2127;
        position:fixed; display:flex; flex-direction:column; min-width:260px; min-height:160px;
        background:var(--bg); color:var(--fg); border:1px solid var(--edge); border-radius:12px;
        box-shadow:0 16px 52px #0007; overflow:hidden; }
      .panel[data-theme="mobile"] { --bg:#f1f3f8; --fg:#202636; --edge:#d6dce8; --accent:#2563eb; --bar:#fff; border-radius:26px; color-scheme:light; }
      .panel[data-theme="cyber"] { --bg:#0b0a1c; --fg:#85fff1; --edge:#00e6ce; --accent:#ff64d5; --bar:#17112b; border-radius:2px; box-shadow:0 0 18px #00e6ce44,0 12px 48px #0009; }
      .panel[data-theme="paper"] { --bg:#e9d8b5; --fg:#402c1e; --edge:#9f8059; --accent:#9e2d23; --bar:#ddc69c; border-radius:3px; color-scheme:light; }
      .panel[data-theme="note"] { --bg:#fffdf1; --fg:#293952; --edge:#c5c6b7; --accent:#3a6290; --bar:#f4efd9; border-radius:6px; color-scheme:light; }
      header { flex:none; display:flex; align-items:center; gap:5px; padding:9px 10px; background:var(--bar); border-bottom:1px solid var(--edge); cursor:grab; touch-action:none; user-select:none; }
      header strong { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
      button,select,input { font:inherit; }
      button { color:inherit; background:transparent; border:1px solid var(--edge); border-radius:6px; padding:3px 8px; cursor:pointer; }
      button:hover { background:color-mix(in srgb,var(--accent) 15%,transparent); }
      button:focus-visible,select:focus-visible,input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
      .body { flex:1; min-height:0; display:flex; flex-direction:column; }
      .settings { flex:none; max-height:55%; overflow:auto; padding:12px; background:var(--bar); border-bottom:1px solid var(--edge); }
      label { display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:12px; }
      label span { min-width:55px; } select { min-width:0; width:100%; padding:5px; background:var(--bg); color:var(--fg); border:1px solid var(--edge); border-radius:5px; }
      input[type=file] { width:100%; min-width:0; font-size:11px; } input[type=color] { width:48px; height:28px; padding:0; }
      .content { flex:1; min-height:0; overflow:auto; padding:16px; background-color:var(--custom-bg,var(--bg)); background-image:var(--custom-image,none); background-size:cover; background-position:center; }
      pre { margin:0; font:13px/1.8 ui-monospace,Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; tab-size:4; }
      [data-theme=mobile] pre { font-family:system-ui,sans-serif; padding:14px; border-radius:16px; background:#ffffffba; box-shadow:0 3px 12px #2026360d; }
      [data-theme=cyber] .content { background-image:var(--custom-image,repeating-linear-gradient(0deg,transparent 0 3px,#00e6ce08 3px 4px)); }
      [data-theme=paper] .content { background-image:var(--custom-image,radial-gradient(ellipse at top left,#fff4 0,transparent 65%),repeating-linear-gradient(95deg,#75451b06 0 1px,transparent 1px 4px)); }
      [data-theme=paper] pre { font-family:Batang,'Noto Serif KR',serif; font-size:15px; line-height:1.9; }
      [data-theme=note] .content { background-image:var(--custom-image,repeating-linear-gradient(transparent 0 27px,#668ac533 27px 28px)); background-attachment:local; }
      [data-theme=note] pre { font-family:system-ui,sans-serif; line-height:28px; border-left:2px solid #d9797977; padding-left:12px; }
      footer { flex:none; display:flex; align-items:center; gap:8px; padding:6px 18px 6px 10px; background:var(--bar); font-size:11px; }
      .status { flex:1; opacity:.8; } .resize { position:absolute; bottom:0; right:0; width:20px; height:20px; touch-action:none; cursor:nwse-resize; }
      .resize:after { content:'◢'; position:absolute; right:3px; bottom:0; opacity:.6; }
      .panel.folded { min-height:0; height:auto!important; } .folded .body,.folded .resize { display:none; }
      .launcher { position:fixed; bottom:24px; right:24px; background:#24292e; color:#fff; padding:10px 15px; border:1px solid #6b7b90; border-radius:24px; box-shadow:0 5px 20px #0005; }
      .help { margin:4px 0; font-size:11px; opacity:.75; }

      .skin { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; pointer-events:none; user-select:none; z-index:0; }
      .panel.skinned { padding:var(--skin-pad); background:transparent; border:0; border-radius:0; box-shadow:none; filter:drop-shadow(0 12px 22px #0005); overflow:visible; }
      .panel.skinned:not(.skin-ready) { background:var(--bg); border-radius:12px; }
      .skinned header,.skinned .body { position:relative; z-index:1; }
      .skinned header { background:transparent; padding:6px 0; border-bottom:1px solid color-mix(in srgb,var(--fg) 18%,transparent); }
      .skinned header strong { font-size:12px; }
      .skinned header button { padding:2px 6px; font-size:12px; background:color-mix(in srgb,var(--bg) 70%,transparent); }
      .skinned .body { position:relative; }
      .skinned .content { padding:12px 0; background:var(--custom-bg,transparent); background-image:var(--custom-image,none); background-size:var(--image-fit,contain); background-repeat:no-repeat; background-position:center; }
      .skinned pre { padding:0; margin:0; border:0; border-radius:0; background:none; box-shadow:none; font-size:clamp(12px,calc(var(--skin-width) / 28),17px); }
      .skinned footer { padding:6px 0; background:transparent; border-top:1px solid color-mix(in srgb,var(--fg) 15%,transparent); font-size:10px; }
      .skinned .settings { position:absolute; inset:0; z-index:3; max-height:none; padding:10px; border:1px solid var(--edge); border-radius:8px; box-shadow:0 8px 22px #0003; }
      .skinned .resize { z-index:4; bottom:5%; right:5%; width:25px; height:25px; color:var(--fg); }
      .panel.skinned[data-theme=mobile] { --fg:#25303c; --edge:#819099; --bar:#f5f4ed; --bg:#f5f4ed; }
      .panel.skinned[data-theme=paper] { --fg:#39261a; --edge:#a08762; --bar:#eee0bf; --bg:#eee0bf; }
      .panel.skinned[data-theme=note] { --fg:#263642; --edge:#99a69e; --bar:#faf8ec; --bg:#faf8ec; }
      .panel.skinned[data-theme=cyber] { --fg:#aefff0; --edge:#299d9c; --bar:#111b23; --bg:#111b23; }
      .skinned[data-theme=paper] pre { font-family:Batang,'Noto Serif KR',serif; line-height:1.9; }
      .skinned[data-theme=note] pre { line-height:1.85; }
      .skinned[data-theme=cyber] pre { text-shadow:0 0 6px #4fffd333; }
      .panel.skinned.folded { padding:8px 12px; background:var(--bar); border:1px solid var(--edge); border-radius:10px; }
      .skinned.folded .skin { display:none; }
    </style>
    <section class="panel" role="region" aria-label="떠 있는 마크다운">
      <img class="skin" alt="" draggable="false" hidden>
      <header><strong>마크다운 · INFO</strong><button class="settings-toggle" aria-label="테마 및 배경 설정" aria-expanded="false">⚙</button><button class="fold" aria-label="접기">−</button><button class="close" aria-label="닫기">×</button></header>
      <div class="body">
        <div class="settings" hidden>
          <label><span>블록</span><select class="blocks" aria-label="동기화할 블록"></select></label>
          <label><span>테마</span><select class="themes" aria-label="테마"><option value="markdown">1. 기본 마크다운</option><option value="mobile">2. 모바일 UI</option><option value="cyber">3. 사이버펑크</option><option value="paper">4. 무협 종이</option><option value="note">5. 노트</option></select></label>
          <label><span>배경색</span><input type="color" aria-label="배경색"><button class="reset-bg">배경 초기화</button></label>
          <label><span>배경 사진</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="배경 사진"></label>
          <label><span>사진 배치</span><select class="image-fit" aria-label="배경 사진 배치"><option value="contain">전체 보이기 · 비율 유지</option><option value="cover">영역 채우기 · 일부 잘림</option></select></label>
          <p class="help skin-help"></p>
          <label><input class="hide-original" type="checkbox">본문의 같은 종류 블록 숨기기</label>
          <p class="help">같은 이름의 마지막 블록을 따라갑니다. 배경 사진은 2MB 이하, 이 브라우저에만 저장됩니다.</p>
        </div>
        <div class="content"><pre></pre></div>
        <footer><span class="status" role="status">블록을 찾는 중…</span><button class="copy">복사</button></footer>
      </div>
      <div class="resize" role="separator" aria-label="창 크기 조절" tabindex="0"></div>
    </section><button class="launcher" hidden>마크다운 열기</button>`;
  document.body.append(host);
  const $ = selector => root.querySelector(selector);
  const panel = $('.panel'), status = $('.status'), pre = $('pre'), blocks = $('.blocks');
  const hiddenStyle = document.createElement('style');
  hiddenStyle.textContent = '[data-crack-float-hidden="yes"]{display:none!important}';
  document.head.append(hiddenStyle);
  let hidden = new Set(), lastSignature = '', currentText = '', route = location.href, timer;
  const labelOf = el => el.firstElementChild?.textContent.trim() || '이름 없는 블록';
  function restore() { hidden.forEach(el => el.removeAttribute('data-crack-float-hidden')); hidden.clear(); }
  function geometry() {
    const skin = SKINS[prefs.theme];
    const vw = Math.max(1, innerWidth - 12), vh = Math.max(1, innerHeight - 12);
    let width, height;
    if (skin) {
      const ratio = skin.height / skin.width;
      // Native pixels and device density bound enlargement. Keep the original aspect ratio.
      const maxW = Math.max(1, Math.min(520, skin.width / Math.max(1, devicePixelRatio), vw, prefs.folded ? vw : vh / ratio));
      const minW = Math.min(280, maxW);
      width = Math.max(minW, Math.min(Number(prefs.width) || 360, maxW));
      height = width * ratio;
    } else {
      width = Math.max(Math.min(260,vw), Math.min(Number(prefs.width)||360,960,vw));
      height = Math.max(Math.min(160,vh), Math.min(Number(prefs.height)||390,1000,vh));
    }
    const x = Math.max(6, Math.min(prefs.x === null ? innerWidth-width-24 : Number(prefs.x)||6, innerWidth-width-6));
    const y = Math.max(6, Math.min(Number(prefs.y)||6, innerHeight-(prefs.folded ? 58 : height)-6));
    Object.assign(panel.style, {minWidth:'0',minHeight:'0',width:width+'px',height:height+'px',left:x+'px',top:y+'px'});
    panel.style.setProperty('--skin-width',width+'px');
    // Text lives inside the physical frame. Percentages refer to the image dimensions.
    const pads = {mobile:[.09,.19,.07,.19],cyber:[.09,.13,.11,.13],paper:[.08,.14,.18,.14],note:[.055,.07,.08,.20]};
    const pad = pads[prefs.theme];
    if(pad) panel.style.setProperty('--skin-pad', [height*pad[0],width*pad[1],height*pad[2],width*pad[3]].map(n=>n+'px').join(' '));
  }
  function appearance() {
    panel.dataset.theme = prefs.theme;
    const skin = SKINS[prefs.theme];
    panel.classList.toggle('skinned', Boolean(skin));
    const skinImage = $('.skin');
    skinImage.hidden = !skin;
    if(skin && skinImage.dataset.theme !== prefs.theme) {
      panel.classList.remove('skin-ready');
      skinImage.referrerPolicy='no-referrer';
      skinImage.onload=()=>{panel.classList.add('skin-ready');skinImage.hidden=false;};
      skinImage.onerror=()=>{panel.classList.remove('skin-ready');skinImage.hidden=true;status.textContent='테마 이미지를 불러오지 못했어요. 테마를 다시 선택해 주세요.';delete skinImage.dataset.theme;};
      skinImage.src=skin.src; skinImage.dataset.theme=prefs.theme;
    }
    $('.image-fit').value = prefs.imageFit;
    $('.content').style.setProperty('--image-fit', prefs.imageFit === 'cover' ? 'cover' : 'contain');
    $('.content').style.backgroundSize = prefs.imageFit === 'cover' ? 'cover' : 'contain';
    $('.content').style.backgroundRepeat = 'no-repeat';
    $('.skin-help').textContent = skin ? '원본 비율 고정 · 폭 280–520px. 작은 화면과 고밀도 화면에서는 자동으로 더 작게 맞춥니다.' : '자유 크기 조절';
    panel.hidden = !prefs.open; $('.launcher').hidden = prefs.open;
    panel.classList.toggle('folded', prefs.folded);
    $('.fold').textContent = prefs.folded ? '+' : '−';
    $('.fold').setAttribute('aria-label', prefs.folded ? '펼치기' : '접기');
    $('.themes').value = prefs.theme; $('.hide-original').checked = prefs.hide;
    $('.content').style.setProperty('--custom-image', prefs.image ? `url("${prefs.image}")` : '');
    $('.content').style.setProperty('--custom-bg', prefs.color || '');
    $('input[type=color]').value = prefs.color || ({markdown:'#24292e',mobile:'#f1f3f8',cyber:'#0b0a1c',paper:'#e9d8b5',note:'#fffdf1'}[prefs.theme] || '#24292e');
    geometry();
  }
  function sync() {
    if (route !== location.href) { route = location.href; restore(); currentText = ''; pre.textContent = ''; lastSignature = ''; }
    const main = ui.resolve('layout.main');
    const candidates = CrackUI.isChatRoute(CrackUI.parseRoute()) && main.status === 'found' && main.elements.length === 1
      ? Array.from(main.elements[0].querySelectorAll('.wrtn-codeblock')).filter(el => el.querySelector('pre code')) : [];
    const labels = [...new Set(candidates.map(labelOf))];
    const options = [...new Set([prefs.label, ...labels])];
    const signature = JSON.stringify(options);
    if (lastSignature !== signature) {
      blocks.replaceChildren(...options.map(label => { const option = document.createElement('option'); option.value = label; option.textContent = label; return option; }));
      lastSignature = signature;
    }
    blocks.value = prefs.label;
    const matches = candidates.filter(el => labelOf(el) === prefs.label);
    const latest = matches.at(-1);
    const nextHidden = new Set(prefs.open && prefs.hide ? matches : []);
    hidden.forEach(el => { if (!nextHidden.has(el)) el.removeAttribute('data-crack-float-hidden'); });
    nextHidden.forEach(el => { if (!hidden.has(el)) el.setAttribute('data-crack-float-hidden','yes'); });
    hidden = nextHidden;
    $('header strong').textContent = `마크다운 · ${prefs.label}`;
    const nextText = latest?.querySelector('pre code')?.textContent || '';
    if (!latest) { pre.textContent = `${prefs.label} 블록이 아직 없습니다. 설정에서 다른 블록을 선택할 수 있어요.`; currentText = ''; delete pre.dataset.ready; status.textContent = '새 블록 대기 중'; }
    else if (currentText !== nextText || !pre.dataset.ready) {
      const content = $('.content'); const atBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 32;
      currentText = nextText; pre.textContent = nextText; pre.dataset.ready = 'true';
      if (atBottom) content.scrollTop = content.scrollHeight;
      status.textContent = `동기화됨 · ${new Date().toLocaleTimeString('ko-KR')}`;
    }
  }
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = null; sync(); }, 100); };
  // SDK가 DOM 교체·속성 변경·SPA 전환을 담당한다.
  // watchDOM은 characterData를 관찰하지 않으므로 텍스트 노드 스트리밍만 보완한다.
  const stopWatching = CrackUI.watchDOM(schedule, { delay:80 });
  const textObserver = new MutationObserver(schedule);
  textObserver.observe(document.body, { subtree:true, characterData:true });
  window.addEventListener('pagehide', event => { if (!event.persisted) { stopWatching(); textObserver.disconnect(); clearTimeout(timer); } });
  $('.settings-toggle').onclick = () => { const settings = $('.settings'); settings.hidden = !settings.hidden; $('.settings-toggle').setAttribute('aria-expanded', String(!settings.hidden)); if (!settings.hidden && prefs.folded) { prefs.folded = false; appearance(); save(); } };
  $('.fold').onclick = () => { prefs.folded = !prefs.folded; appearance(); save(); };
  $('.close').onclick = () => { prefs.open = false; appearance(); restore(); save(); };
  $('.launcher').onclick = () => { prefs.open = true; appearance(); sync(); save(); };
  $('.themes').onchange = event => { prefs.backgrounds[prefs.theme] = {color:prefs.color,image:prefs.image}; prefs.theme = event.target.value; const bg=prefs.backgrounds[prefs.theme] || {}; prefs.color = bg.color || ''; prefs.image = bg.image || ''; $('input[type=file]').value = ''; appearance(); save(); };
  $('.image-fit').onchange = event => { prefs.imageFit = event.target.value; appearance(); save(); };
  blocks.onchange = event => { prefs.label = event.target.value; currentText = ''; sync(); save(); };
  $('.hide-original').onchange = event => { prefs.hide = event.target.checked; sync(); save(); };
  $('input[type=color]').oninput = event => { prefs.color = event.target.value; appearance(); save(); };
  $('.reset-bg').onclick = () => { prefs.color = ''; prefs.image = ''; $('input[type=file]').value = ''; appearance(); save(); };
  $('input[type=file]').onchange = event => {
    const file = event.target.files[0]; if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 2 * 1024 * 1024) { status.textContent = '2MB 이하 PNG·JPG·WebP·GIF를 선택하세요'; return; }
    const reader = new FileReader(); reader.onload = () => { prefs.image = reader.result; appearance(); save(); }; reader.onerror = () => { status.textContent = '사진을 읽지 못했어요'; }; reader.readAsDataURL(file);
  };
  $('.copy').onclick = async () => { try { await navigator.clipboard.writeText(currentText); status.textContent = '복사했어요'; } catch { status.textContent = '복사 권한이 없어요. 내용을 선택해 복사하세요'; } };
  function pointerControl(handle, resize) {
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault(); handle.setPointerCapture(event.pointerId);
      const rect = panel.getBoundingClientRect();
      const start = { x:event.clientX, y:event.clientY, left:rect.x, top:rect.y, w:rect.width, h:rect.height };
      const move = ev => { if (ev.pointerId !== event.pointerId) return; const dx = ev.clientX-start.x, dy = ev.clientY-start.y; if (resize) { const skin=SKINS[prefs.theme]; if(skin) { const ratio=skin.height/skin.width; prefs.width=start.w+(Math.abs(dx)>Math.abs(dy/ratio)?dx:dy/ratio); prefs.height=prefs.width*ratio; } else { prefs.width=start.w+dx; prefs.height=start.h+dy; } } else { prefs.x = start.left+dx; prefs.y = start.top+dy; } geometry(); };
      const end = ev => { if (ev.pointerId !== event.pointerId) return; handle.removeEventListener('pointermove',move); handle.removeEventListener('pointerup',end); handle.removeEventListener('pointercancel',end); handle.removeEventListener('lostpointercapture',end); const finalRect=panel.getBoundingClientRect(); prefs.x=finalRect.x; prefs.y=finalRect.y; if(resize){prefs.width=finalRect.width;prefs.height=finalRect.height;} save(); };
      handle.addEventListener('pointermove',move); handle.addEventListener('pointerup',end); handle.addEventListener('pointercancel',end); handle.addEventListener('lostpointercapture',end);
    });
  }
  pointerControl($('header'), false); pointerControl($('.resize'), true);
  $('.resize').onkeydown = event => {
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const rect=panel.getBoundingClientRect(), skin=SKINS[prefs.theme];
    const step=['ArrowRight','ArrowDown'].includes(event.key)?10:-10;
    if(skin) { prefs.width=rect.width+step; prefs.height=prefs.width*skin.height/skin.width; }
    else { prefs.width=rect.width+(['ArrowLeft','ArrowRight'].includes(event.key)?step:0); prefs.height=rect.height+(['ArrowUp','ArrowDown'].includes(event.key)?step:0); }
    geometry(); save();
  };
  window.addEventListener('resize', () => { geometry(); save(); });
  appearance(); sync();
})();
