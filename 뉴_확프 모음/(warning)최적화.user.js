// ==UserScript==
// @name         최적화
// @namespace    https://github.com/workforomg/Utill
// @version      0.1.0
// @updateURL    https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/(warning)%EC%B5%9C%EC%A0%81%ED%99%94.user.js
// @downloadURL  https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/(warning)%EC%B5%9C%EC%A0%81%ED%99%94.user.js
// @author       지유지요
// @description  저사양 모드·데이터 API 이미지 사전 최적화·긴 이미지 분할·움짤 정지·작품 카드 렌더링·화면 효과를 설정 메뉴에서 관리합니다.
// @match        https://crack.wrtn.ai/*
// @require      https://raw.githubusercontent.com/workforomg/Utill/c12614f0cd498fe2457b1ff2622b879753248a00/dist/index.js
// @require      https://raw.githubusercontent.com/workforomg/Utill/c12614f0cd498fe2457b1ff2622b879753248a00/dist/ui.js
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      crack.static.wrtn.ai
// @run-at       document-start
// @noframes
// ==/UserScript==

/* The original is NEVER decoded here to create tiles. CDN output headers are
 * checked before any bitmap/HTMLImageElement sees them (the CDN can pass through
 * oversized animations). Tampermonkey cannot guarantee interception of parser
 * preloads or of requests made before this script starts. See README.md. */
(function () {
  'use strict';
  const DEFAULT_SETTINGS = Object.freeze({lowPower:false,reduceEffects:false,deferCards:false,apiImages:true,longImages:true,freezeAnimations:false,resizeThumbnails:true,resizeSessionIcons:true,offscreenImages:true,hiddenTab:true,showStatus:true,safeStartup:true,deferMessages:false,deferCodeBlocks:false});
  const LOW_POWER_OVERRIDES = Object.freeze({freezeAnimations:true,resizeThumbnails:true,offscreenImages:true,hiddenTab:true,reduceEffects:true,deferCards:true,showStatus:false});
  const SETTING_ITEMS = [
    ['lowPower','저사양 모드','긴 이미지의 동시 요청을 1개로 줄이고 조각 처리 예산을 16MiB로 제한합니다. 썸네일은 화면 배율 1배로 요청하며 움짤 정지·화면 밖 이미지 해제·작품 카드 렌더링 생략·화면 효과 축소를 적용하고 상태 표시를 숨깁니다. 끄면 기존 개별 설정으로 돌아갑니다.','갤럭시 탭 어드밴스드 2 같은 기기의 순간적인 이미지 처리와 스크롤 부담을 줄입니다. 16MiB는 전체 탭 메모리 제한이 아니며 이미지가 약간 흐려지거나 늦게 나타날 수 있습니다. 대화 목록 설정은 변경하지 않습니다.'],
    ['reduceEffects','화면 효과 줄이기','CSS 애니메이션·전환 시간을 줄이고 배경 흐림 효과와 부드러운 자동 스크롤을 끕니다. 이미지와 글꼴은 유지합니다.','화면 이동과 스크롤 중 불필요한 그리기·합성 작업을 줄입니다.'],
    ['deferCards','화면 밖 작품 카드 렌더링 생략','이미지가 있는 작품 상세 링크의 크기를 유지하며 화면 밖 배치·그리기를 생략합니다. 대화 목록·탐색 메뉴·모달은 제외합니다.','메인·검색 작품 카드의 화면 밖 렌더링 부담을 줄입니다. DOM과 API 데이터를 삭제하는 기능은 아니며 지원 브라우저에서만 적용됩니다.'],
    ['apiImages','데이터 API 이미지 사전 최적화','작품·검색·세션 목록의 이미지 주소를 화면에 전달하기 전에 바꿉니다. 아래 썸네일·세션 아이콘·움짤 설정을 따릅니다.','큰 원본·움짤 요청이 먼저 나가고 나중에 교체되는 낭비를 줄입니다. 스크립트 시작 전 요청과 초기 HTML 이미지는 보장하지 않습니다.'],
    ['safeStartup','렌더링 최적화 지연 시작','작품 카드·본문·코드 렌더링 생략을 켠 경우 해당 기능을 3~15초 늦게 시작합니다. 이미지 요청 처리는 기다리지 않습니다.','렌더링 기능이 초기 화면 구성에 끼어드는 위험을 줄입니다. 이미지 후킹의 초기 충돌을 방지하는 기능은 아닙니다.'],
    ['deferMessages','화면 밖 채팅 본문 렌더링 생략','오래된 메시지의 높이와 원본 내용을 유지하며 화면 밖 렌더링을 생략합니다. 응답이 작성되는 동안에는 바로 표시합니다.','긴 대화를 스크롤할 때 화면 밖 텍스트까지 배치·그리는 비용을 줄입니다. 대화 데이터 자체를 메모리에서 지우지는 않습니다.'],
    ['deferCodeBlocks','코드 블록 지연 표시','화면에서 먼 코드 블록의 렌더링을 생략합니다. 가까워지면 원래 구문 강조·복사 기능을 그대로 표시합니다.','코드 블록의 많은 span 요소를 화면 밖에서도 그리는 비용을 줄입니다. 사이트의 최초 파싱 작업을 막는 기능은 아닙니다.'],
    ['longImages','긴 이미지 분할 표시','대화 이미지를 서버에서 구간별로 받아 화면 주변만 표시합니다. 분할 움짤 재생 기능이 없는 브라우저에서는 정지 조각을 요청합니다. 변환을 지원하지 않으면 오류와 원본 링크를 표시합니다.','긴 원본 전체를 한 번에 디코딩할 때 생기는 메모리 급증을 줄입니다.'],
    ['freezeAnimations','움짤 이미지 정지 표시','서버에서 첫 프레임만 받아 정지 이미지로 표시합니다. 공개 이미지에 적용하며 변환 불가 시 원래 표시가 유지될 수 있습니다.','움짤의 프레임 디코딩·재생에 드는 메모리와 CPU 사용을 줄입니다.'],
    ['resizeThumbnails','썸네일 이미지 사이즈 조절','작품 카드와 일반 프로필을 표시 크기·화면 배율에 맞춰 축소 요청합니다. 화면에서 보이는 크기는 바꾸지 않습니다.','작은 영역에 필요 이상으로 큰 이미지가 올라가는 낭비를 줄입니다.'],
    ['resizeSessionIcons','세션 목록 작품 아이콘 조절','세션 목록의 작품 아이콘만 표시 크기에 맞춰 축소 요청합니다. 일반 썸네일 설정과 별개로 동작합니다.','목록에 반복되는 작은 아이콘의 디코딩 메모리를 줄입니다.'],
    ['offscreenImages','화면 밖 일반 이미지 해제','일반 이미지는 화면에서 멀어진 뒤 해제하고 가까워지면 다시 불러옵니다. 세로·가로 목록에 적용됩니다.','보지 않는 썸네일이 메모리를 계속 차지하는 것을 줄입니다. 다시 볼 때 로딩이 생길 수 있습니다.'],
    ['hiddenTab','다른 탭으로 이동하면 이미지 해제','크랙 탭이 숨겨지면 관리 중인 이미지와 분할 조각을 해제합니다. 돌아오면 다시 표시합니다.','다른 탭을 보는 동안 크랙 이미지의 메모리·재생 비용을 줄입니다.'],
    ['showStatus','최적화 상태 표시','화면 왼쪽 아래에 표시 중인 조각 수와 해제한 이미지 수를 보여줍니다.','기능의 작동 상태를 확인하는 용도이며 이 표시 자체가 메모리를 줄이지는 않습니다.']
  ];
  function normalizeSettings(value) {
    const out={...DEFAULT_SETTINGS};
    if(value&&typeof value==='object')for(const key of Object.keys(out))if(typeof value[key]==='boolean')out[key]=value[key];
    return out;
  }
  function effectiveSettings(value) {
    const settings=normalizeSettings(value);
    return settings.lowPower?{...settings,...LOW_POWER_OVERRIDES}:settings;
  }
  function resourcePolicy(settings) {
    return settings.lowPower
      ? {concurrency:1,tileRows:512,maxTileBytes:2*1024*1024,maxLiveBytes:16*1024*1024,maxLiveTiles:8,margin:150,scanDelay:80,layoutDelay:32}
      : {concurrency:3,tileRows:TILE,maxTileBytes:MAX_TILE_BYTES,maxLiveBytes:MAX_LIVE_BYTES,maxLiveTiles:MAX_LIVE_TILES,margin:350,scanDelay:16,layoutDelay:0};
  }
  function thumbnailDpr(settings,dpr,session=false){return settings.lowPower&&!session?1:dpr;}
  async function shouldFreezeTile(requested,Decoder,type) {
    if(requested||typeof Decoder!=='function')return true;
    try{return !(await Decoder.isTypeSupported(type));}catch{return true;}
  }
  async function fetchTileData({source,meta,top,rows,freeze,Decoder,request,signal,maxBytes=MAX_TILE_BYTES}) {
    let staticOnly=freeze||typeof Decoder!=='function';
    for(let attempt=0;attempt<2;attempt++){
      if(signal.aborted)throw new DOMException('Cancelled','AbortError');
      const info={...describe(source,{...meta,top,rows,freeze:staticOnly}),maxBytes};
      const buffer=await request(info,signal);
      if(signal.aborted)throw new DOMException('Cancelled','AbortError');
      const header=validateTile(buffer,info);
      if(staticOnly&&header.animated)throw new Error('서버가 움짤을 정지 이미지로 변환하지 못했습니다.');
      if(header.animated&&await shouldFreezeTile(false,Decoder,header.type)){staticOnly=true;continue;}
      return {buffer,header,staticOnly};
    }
    throw new Error('이 브라우저에서 이미지 조각을 표시하지 못했습니다.');
  }
  function migrateSettings(value) {
    const out=normalizeSettings(value);
    // 0.4.0 enabled rendering experiments without validating total tab memory.
    // Reset only these two once; subsequent explicit saves preserve user choice.
    if(value?._memoryPolicy!==1){out.deferMessages=false;out.deferCodeBlocks=false;}
    return out;
  }
  function nativeImagePlan(raw,{resize=false,freeze=false,width=0,height=0,ratio=0,fit='cover',dpr=1}={}) {
    if(typeof raw!=='string'||!raw)return raw;
    raw=apiImageSource(raw);
    let source=raw,options=[];
    if(raw.startsWith(CDN)){
      const tail=raw.slice(CDN.length),split=tail.indexOf('/http');
      if(split<0)return raw;
      options=tail.slice(0,split).split(',');source=tail.slice(split+1);
    }
    try{source=sourceURL(source);}catch{return raw;}
    if(/\.svg$/i.test(new URL(source).pathname))return raw;
    // Only resize Crack-hosted thumbnails. Freezing public external images is explicit opt-in.
    const host=new URL(source).hostname;
    resize=resize&&width>0&&height>0&&(host==='d394jeh9729epj.cloudfront.net'||host==='crack.static.wrtn.ai');
    if(!resize&&!freeze)return raw;
    if(resize&&width>0&&height>0){
      let wanted=width;
      if(ratio>0){if(fit==='cover')wanted=Math.max(width,height*ratio);else if(fit==='contain'||fit==='scale-down')wanted=Math.min(width,height*ratio);}
      let target=Math.max(32,Math.ceil(wanted*Math.max(1,dpr)/32)*32);
      const oldWidth=options.find(v=>/^width=\d+$/.test(v));
      if(oldWidth)target=Math.min(target,Number(oldWidth.split('=')[1]));
      options=options.filter(v=>!/^(width|height|fit)=/.test(v));
      options.push(`width=${target}`,'fit=scale-down');
    }
    if(freeze){options=options.filter(v=>!/^anim=/.test(v));options.push('anim=false');}
    if(!options.some(v=>/^format=/.test(v)))options.push('format=auto');
    if(!options.some(v=>/^quality=/.test(v)))options.push('quality=85');
    return CDN+options.join(',')+'/'+source;
  }
  function createThumbnailVirtualizer({doc,win,setAttribute,placeholder,exclude,settings,onDirty,isSuppressed=()=>false,onChange=()=>{}}) {
    const entries=new Map(),parked=new WeakMap();let destroyed=false;
    const attr=(el,key,value)=>{if(value==null)el.removeAttribute(key);else setAttribute(el,key,value);};
    const relevant=img=>img.tagName==='IMG'&&!img.matches(exclude)&&!img.closest('[data-cit-owned],picture')&&!/\.svg(?:[?#]|$)/i.test(entries.get(img)?.src||parked.get(img)?.src||img.getAttribute('src')||'');
    const sessionIcon=img=>Boolean(img.closest('a[href*="/episodes/"], a[href^="/chat/"], a[href^="/chats/"]'));
    const hidden=()=>settings.hiddenTab&&doc.hidden;
    function report(){let asleep=0,transformed=0;for(const s of entries.values()){if(s.asleep)asleep++;if(s.applied&&s.applied!==s.src&&s.applied!==placeholder)transformed++;}onChange({tracked:entries.size,asleep,transformed});}
    function bindDimensions(s){
      if(s.bound)return;
      s.width=s.img.getAttribute('width');s.height=s.img.getAttribute('height');
      if(s.width===null&&s.height===null&&s.img.naturalWidth&&s.img.naturalHeight){attr(s.img,'width',s.img.naturalWidth);attr(s.img,'height',s.img.naturalHeight);s.bound=true;}
    }
    function unbindDimensions(s){if(!s.bound)return;attr(s.img,'width',s.width);attr(s.img,'height',s.height);s.bound=false;}
    function show(s){
      clearTimeout(s.timer);s.timer=null;
      if(destroyed||!s.img.isConnected)return;
      if(isSuppressed(s.img))return;
      const r=s.img.getBoundingClientRect();
      const resize=!s.img.matches(SELECTOR)&&(sessionIcon(s.img)?settings.resizeSessionIcons:settings.resizeThumbnails);
      let target=nativeImagePlan(s.src,{resize,freeze:settings.freezeAnimations,width:r.width,height:r.height,ratio:s.ratio,fit:win.getComputedStyle(s.img).objectFit,dpr:thumbnailDpr(settings,win.devicePixelRatio,sessionIcon(s.img))});
      if(s.failed.has(target))target=apiImageSource(s.src);
      const targetSet=target===s.src?s.srcset:null;
      s.asleep=false;s.img.removeAttribute('data-cit-suspended');
      if(target!==s.applied||targetSet!==s.appliedSet){
        bindDimensions(s);s.applied=target;s.appliedSet=targetSet;
        attr(s.img,'srcset',targetSet);attr(s.img,'src',target);
      }
      if(s.img.complete&&s.img.naturalWidth)unbindDimensions(s);
    }
    function sleep(s){
      clearTimeout(s.timer);s.timer=null;
      if(destroyed||s.asleep||!s.img.isConnected||(!hidden()&&!isSuppressed(s.img)&&(!settings.offscreenImages||s.near)))return;
      bindDimensions(s);s.asleep=true;s.applied=placeholder;s.appliedSet=null;
      s.img.setAttribute('data-cit-suspended','');attr(s.img,'srcset',null);attr(s.img,'src',placeholder);report();
    }
    function reconcile(s){
      if(hidden()||isSuppressed(s.img)){sleep(s);return;}
      if(s.near||!settings.offscreenImages)show(s);
      else if(!s.asleep&&!s.timer)s.timer=setTimeout(()=>sleep(s),400);
    }
    const io=new win.IntersectionObserver(records=>{for(const r of records){const s=entries.get(r.target);if(s){s.near=r.isIntersecting;reconcile(s);}}report();},{rootMargin:settings.lowPower?'80px':'150px'});
    const ro=new win.ResizeObserver(()=>onDirty());
    function forget(s,restore){
      clearTimeout(s.timer);io.unobserve(s.img);ro.unobserve(s.img);s.img.removeEventListener('load',s.load);s.img.removeEventListener('error',s.error);
      if(restore){attr(s.img,'srcset',s.srcset);attr(s.img,'src',s.src);unbindDimensions(s);}
      s.img.removeAttribute('data-cit-suspended');entries.delete(s.img);
    }
    function attach(s){
      s.load=()=>{if(s.asleep)return;if(s.img.naturalWidth&&s.img.naturalHeight)s.ratio=s.img.naturalWidth/s.img.naturalHeight;unbindDimensions(s);onDirty();};
      s.error=()=>{if(!s.asleep&&s.applied!==s.src){s.failed.add(s.applied);show(s);report();}};
      s.img.addEventListener('load',s.load);s.img.addEventListener('error',s.error);entries.set(s.img,s);io.observe(s.img);ro.observe(s.img);
    }
    function scan(){
      if(destroyed)return;
      for(const s of entries.values()){
        if(!s.img.isConnected){parked.set(s.img,s);forget(s,false);continue;}
        if(!relevant(s.img)){forget(s,!s.img.matches(exclude));continue;}
        const current=s.img.getAttribute('src'),currentSet=s.img.getAttribute('srcset');
        if(current===null&&s.applied!==null){unbindDimensions(s);forget(s,false);continue;}
        if(current&&current!==s.applied&&current!==placeholder){s.src=current;s.applied=current;s.ratio=0;s.failed.clear();}
        if(currentSet!==s.appliedSet){s.srcset=currentSet;s.appliedSet=currentSet;}
        reconcile(s);
      }
      for(const img of doc.images){
        if(entries.has(img)||!relevant(img))continue;
        const old=parked.get(img),raw=old?.src||img.getAttribute('src');
        if(!raw||raw===placeholder)continue;
        try{if(!/^https?:$/.test(new URL(raw,doc.baseURI).protocol))continue;}catch{continue;}
        const s=old||{img,src:raw,srcset:img.getAttribute('srcset'),applied:raw,appliedSet:img.getAttribute('srcset'),asleep:false,near:false,timer:null,ratio:img.naturalWidth/img.naturalHeight||0,failed:new Set()};
        parked.delete(img);s.near=false;if(s.asleep)img.setAttribute('data-cit-suspended','');attach(s);
      }
      report();
    }
    const visibility=()=>{for(const s of entries.values())reconcile(s);report();};doc.addEventListener('visibilitychange',visibility);
    return {scan,
      intercept(img,key,value){const s=entries.get(img)||parked.get(img);if(!s)return false;if(key==='src'){s.src=String(value);s.ratio=0;s.failed.clear();}else if(key==='srcset')s.srcset=String(value);else return false;onDirty();return true;},
      getSource:img=>(entries.get(img)||parked.get(img))?.src,
      getSrcset:img=>(entries.get(img)||parked.get(img))?.srcset,
      takeSource(img){const s=entries.get(img)||parked.get(img);if(!s)return null;const src=s.src;forget(s,false);parked.delete(img);return src;},
      destroy(){destroyed=true;io.disconnect();ro.disconnect();doc.removeEventListener('visibilitychange',visibility);for(const s of [...entries.values()])forget(s,true);report();}
    };
  }

  function createChatRenderer({doc,win,settings,onChange=()=>{},onVisibility=()=>{}}){
    const entries=new Map(),skipped=new WeakSet(),pending=new Set();
    let timer=0,dead=false,prune=false;
    const selector=[settings.deferMessages?'[data-message-group-id]':'',settings.deferCodeBlocks?'[data-message-group-id] pre':'',settings.deferCards?'a[href^="/detail/"]':''].filter(Boolean).join(',');
    if(!selector||!win.CSS?.supports('content-visibility','auto'))return {scan(){},isSkipped(){return false;},destroy(){}};
    function write(s,key,value){if(!s.original.has(key))s.original.set(key,{value:s.el.style.getPropertyValue(key),priority:s.el.style.getPropertyPriority(key)});s.el.style.setProperty(key,value);s.applied.set(key,value);}
    function report(){let hidden=0;for(const s of entries.values())if(skipped.has(s.el))hidden++;onChange({tracked:entries.size,skipped:hidden});}
    function restore(s){
      ro.unobserve(s.el);s.el.removeEventListener('contentvisibilityautostatechange',s.visibility);skipped.delete(s.el);
      for(const [key,old]of s.original)if(s.el.style.getPropertyValue(key)===s.applied.get(key)){if(old.value)s.el.style.setProperty(key,old.value,old.priority);else s.el.style.removeProperty(key);}
      entries.delete(s.el);
    }
    function schedule(){if(!timer&&!dead)timer=win.setTimeout(flush,120);}
    function isAncestorSkipped(el){for(let p=el?.parentElement;p;p=p.parentElement)if(skipped.has(p))return true;return false;}
    function mark(s){s.changed=win.performance.now();if(s.active)return;s.active=true;skipped.delete(s.el);write(s,'content-visibility','visible');schedule();}
    function enroll(el){
      if(entries.has(el)||el.closest('[data-cit-owned]'))return;
      if(el.matches('a[href^="/detail/"]')&&(!el.querySelector('img')||el.closest('nav,aside,dialog,[role=dialog],[data-message-group-id]')))return;
      const s={el,original:new Map(),applied:new Map(),changed:win.performance.now(),active:true,width:0};
      s.visibility=e=>{if(e.target!==el)return;if(e.skipped)skipped.add(el);else skipped.delete(el);report();onVisibility();schedule();};
      entries.set(el,s);el.addEventListener('contentvisibilityautostatechange',s.visibility);ro.observe(el);
    }
    function scan(root=doc){
      if(dead)return;
      if(settings.deferCards&&root.nodeType===1){const card=root.closest('a[href^="/detail/"]');if(card)enroll(card);}
      if(root.nodeType===1&&root.matches(selector))enroll(root);
      for(const el of root.querySelectorAll?.(selector)||[])enroll(el);
      schedule();
    }
    function flush(){
      timer=0;if(dead)return;
      if(prune){for(const s of entries.values())if(!s.el.isConnected)restore(s);prune=false;}
      for(const root of pending)if(root.isConnected)scan(root);pending.clear();
      const now=win.performance.now(),measure=[];let waiting=false;
      for(const s of entries.values())if(s.active&&s.el.isConnected){
        // Measuring descendants of skipped messages would force their layout.
        if(isAncestorSkipped(s.el))continue;
        if(now-s.changed<600){waiting=true;continue;}
        // Read every size before writing containment to avoid layout thrashing.
        const r=s.el.getBoundingClientRect(),cs=win.getComputedStyle(s.el);
        const height=Math.max(0,r.height-parseFloat(cs.paddingTop||0)-parseFloat(cs.paddingBottom||0)-parseFloat(cs.borderTopWidth||0)-parseFloat(cs.borderBottomWidth||0));
        measure.push({s,height});
      }
      for(const {s,height}of measure){write(s,'contain-intrinsic-block-size',`auto ${height}px`);write(s,'content-visibility','auto');s.active=false;}
      report();if(waiting)schedule();
    }
    const ro=new win.ResizeObserver(records=>{
      for(const r of records){const s=entries.get(r.target);if(!s)continue;
        if(s.width&&Math.abs(s.width-r.contentRect.width)>1)mark(s);
        s.width=r.contentRect.width;
      }
    });
    const observer=new win.MutationObserver(records=>{
      for(const r of records){
        const target=r.target.nodeType===1?r.target:r.target.parentElement;
        if(!target||target.closest('[data-cit-owned]'))continue;
        // Streaming text stays fully rendered until it has stopped changing.
        for(let el=target;el;el=el.parentElement){const s=entries.get(el);if(s)mark(s);}
        if(r.type==='childList'){
          if(r.removedNodes.length)prune=true;
          for(const n of r.addedNodes)if(n.nodeType===1&&!n.closest('[data-cit-owned]'))pending.add(n);
        }
      }
      schedule();
    });
    observer.observe(doc,{subtree:true,childList:true,characterData:Boolean(settings.deferMessages||settings.deferCodeBlocks)});
    const focus=e=>{for(let el=e.target;el;el=el.parentElement){const s=entries.get(el);if(s)mark(s);}};
    doc.addEventListener('focusin',focus);
    scan();
    return {scan,isSkipped:isAncestorSkipped,
      destroy(){dead=true;win.clearTimeout(timer);observer.disconnect();ro.disconnect();doc.removeEventListener('focusin',focus);for(const s of [...entries.values()])restore(s);pending.clear();report();}};
  }

  const CDN = 'https://crack.static.wrtn.ai/cdn-cgi/image/';
  const SELECTOR = 'img[node], [data-message-group-id] img, img.block.w-full.cursor-pointer';
  const TILE = 1024;
  const MAX_TILE_BYTES = 8 * 1024 * 1024;
  const MAX_LIVE_BYTES = 32 * 1024 * 1024; // encoded bytes + frame pixel estimates; not a browser RSS limit
  const MAX_LIVE_TILES = 12;
  const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

  function sourceURL(raw, base = 'https://crack.wrtn.ai/') {
    const u = new URL(raw, base);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('공개 HTTP(S) 이미지 주소만 분할할 수 있습니다.');
    // Do not relay private-network URLs or signed/query URLs to a transform host.
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') || host.includes(':') ||
        /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || u.search) {
      throw new Error('내부망·인증 쿼리 주소는 자동 변환하지 않습니다.');
    }
    u.hash = '';
    return u.href;
  }
  function describe(raw, options = {}) {
    const source = sourceURL(raw);
    const {width, height, top, rows} = options;
    if (top === undefined) return {method: 'GET', url: CDN + 'format=json/' + source, responseType: 'arraybuffer', maxBytes: 65536};
    if (![width, height, top, rows].every(Number.isSafeInteger) || width < 1 || height < 1 || top < 0 || rows < 1 || top + rows > height) throw new Error('잘못된 분할 좌표');
    // Always retain animation, including when metadata omits a frame count.
    // The service can negotiate a different output; validate the bytes below.
    return {method: 'GET', url: CDN + `trim=${top};0;${height-top-rows};0,format=webp,quality=100,anim=${options.freeze ? 'false' : 'true'}/` + source,
      responseType: 'arraybuffer', maxBytes: MAX_TILE_BYTES, expectedWidth: width, expectedHeight: rows};
  }
  function parseHeader(buffer) {
    const b = new Uint8Array(buffer), v = new DataView(buffer);
    const ascii = (offset, length) => String.fromCharCode(...b.subarray(offset, offset + length));
    const need = n => { if (b.length < n) throw new Error('잘린 이미지 응답'); };
    need(12);
    if (b[0] === 137 && ascii(1, 3) === 'PNG') {
      need(33);
      let animated = false, ended = false;
      for (let p = 8; p + 12 <= b.length;) {
        const n = v.getUint32(p), type = ascii(p + 4, 4);
        if (n > b.length - p - 12) throw new Error('손상된 PNG 청크');
        if (type === 'acTL') animated = true;
        if (type === 'IEND') ended = true;
        p += n + 12;
      }
      if (!ended) throw new Error('잘린 PNG 응답');
      return {width: v.getUint32(16), height: v.getUint32(20), type: 'image/png', animated};
    }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      const u24 = p => b[p] + b[p+1] * 256 + b[p+2] * 65536;
      for (let p = 12; p + 8 <= b.length;) {
        const n = v.getUint32(p + 4, true), type = ascii(p, 4), d = p + 8;
        if (n > b.length - d) throw new Error('손상된 WebP 청크');
        if (type === 'VP8X') { need(d + 10); return {width: u24(d+4)+1, height: u24(d+7)+1, type:'image/webp', animated: Boolean(b[d]&2)}; }
        if (type === 'VP8 ') { need(d+10); return {width:v.getUint16(d+6,true)&16383,height:v.getUint16(d+8,true)&16383,type:'image/webp',animated:false}; }
        if (type === 'VP8L') { need(d+5); const bits=v.getUint32(d+1,true); return {width:(bits&16383)+1,height:((bits>>>14)&16383)+1,type:'image/webp',animated:false}; }
        p = d + n + (n & 1);
      }
    }
    if (ascii(0,3) === 'GIF') return {width:v.getUint16(6,true),height:v.getUint16(8,true),type:'image/gif',animated:true};
    if (b[0] === 255 && b[1] === 216) {
      for (let p = 2; p < b.length;) {
        if (b[p++] !== 255) throw new Error('잘못된 JPEG 응답');
        while (b[p] === 255) p++;
        const marker = b[p++];
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        need(p + 2); const n = v.getUint16(p);
        if (n < 2 || p + n > b.length) throw new Error('잘린 JPEG 응답');
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
          need(p+7); return {height:v.getUint16(p+3),width:v.getUint16(p+5),type:'image/jpeg',animated:false};
        }
        p += n;
      }
    }
    throw new Error('변환 서버가 검증 가능한 이미지 조각을 반환하지 않았습니다.');
  }
  function validateTile(buffer, request) {
    if (Object.prototype.toString.call(buffer) !== '[object ArrayBuffer]' || buffer.byteLength > request.maxBytes) throw new Error('이미지 조각의 용량 제한을 초과했습니다.');
    const h = parseHeader(buffer);
    if (h.width !== request.expectedWidth || h.height !== request.expectedHeight) throw new Error('서버가 분할하지 않은 이미지를 반환해 로딩을 중단했습니다.');
    if (h.width * h.height > 4 * 1024 * 1024) throw new Error('조각의 픽셀 제한을 초과했습니다.');
    return h;
  }
  function metadata(buffer) {
    const m = JSON.parse(new TextDecoder().decode(buffer));
    const width = m.width, height = m.height;
    if (![width,height].every(Number.isSafeInteger) || width < 1 || height < 1 || width > 32768 || height > 1000000) throw new Error('이미지 크기를 확인하지 못했습니다.');
    const type = m.original?.format || '';
    // Do not treat SVG passthrough as a raster tile, and do not silently freeze APNG/AVIF animation.
    if (!['image/png','image/jpeg','image/webp','image/gif','image/avif','image/heic','image/heif'].includes(type)) throw new Error('이 형식은 변환 서버의 분할 지원을 확인할 수 없습니다.');
    const frames=m.frames ?? m.original?.frames ?? 1;
    if(!Number.isSafeInteger(frames)||frames<1||frames>500)throw new Error('애니메이션 프레임 수가 처리 한도를 초과했습니다.');
    return {width,height,type,frames,animated:type === 'image/gif' || type === 'image/webp' || frames > 1};
  }
  class Queue {
    constructor(limit) { this.limit=limit; this.active=0; this.jobs=[]; }
    run(fn, signal) {
      return new Promise((resolve,reject) => {
        if (signal?.aborted) { reject(new DOMException('Cancelled','AbortError')); return; }
        const job={fn,signal,resolve,reject};
        job.abort=()=>{const i=this.jobs.indexOf(job);if(i>=0){this.jobs.splice(i,1);reject(new DOMException('Cancelled','AbortError'));}};
        signal?.addEventListener('abort',job.abort,{once:true});
        this.jobs.push(job);this.drain();
      });
    }
    drain() {
      while(this.active<this.limit && this.jobs.length) {
        const j=this.jobs.shift(); j.signal?.removeEventListener('abort',j.abort);
        if(j.signal?.aborted){j.reject(new DOMException('Cancelled','AbortError'));continue;}
        this.active++;
        Promise.resolve().then(j.fn).then(j.resolve,j.reject).finally(()=>{this.active--;this.drain();});
      }
    }
  }
  // SDK metadata supplies read-only list routes; the SDK does not intercept site traffic.
  function apiImageRules(sdk) {
    const specs=[['DISCOVERY_ENDPOINTS',['page','search','contents','series','profiles'],'thumbnail'],['LIBRARY_ENDPOINTS',['stories','storyRanking','characters','likedStories','ownContent','subscribedSeries','collections'],'thumbnail'],['LIBRARY_ENDPOINTS',['storyChats','characterChats'],'session']];
    const rules=[];
    for(const [group,names,kind] of specs)for(const name of names){
      const def=sdk?.[group]?.[name];
      if(def?.method!=='GET'||def.effect!=='read'||typeof def.path!=='string')continue;
      const pattern=def.path.split('/').map(part=>part.startsWith(':')?'[^/]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/');
      rules.push({path:new RegExp('^'+pattern+'/?$'),kind});
    }
    return rules;
  }
  function apiRequestKind(input,method,rules,base='https://crack.wrtn.ai/') {
    if(String(method||'GET').toUpperCase()!=='GET')return null;
    try{const u=new URL(input,base);if(u.origin!=='https://crack-api.wrtn.ai')return null;return rules.find(r=>r.path.test(u.pathname))?.kind||null;}catch{return null;}
  }
  function apiImageSource(raw) {
    if(typeof raw!=='string'||!raw.startsWith(CDN)||!raw.endsWith('#cit-api-v1'))return raw;
    const split=raw.indexOf('/http',CDN.length);
    if(split<0)return raw;
    try{return sourceURL(raw.slice(split+1));}catch{return raw;}
  }
  function rewriteAPIImages(data,kind,settings,dpr=1) {
    const resize=kind==='session'?settings.resizeSessionIcons:settings.resizeThumbnails;
    if(!kind||!settings.apiImages||(!resize&&!settings.freezeAnimations))return 0;
    let changed=0;
    const convert=raw=>{
      // Only the verified public asset host. Never relay chat text, signed URLs or arbitrary hosts.
      if(typeof raw!=='string')return raw;
      try{if(new URL(raw).hostname!=='d394jeh9729epj.cloudfront.net')return raw;}catch{return raw;}
      const size=kind==='session'?48:256;
      const next=nativeImagePlan(raw,{resize,freeze:settings.freezeAnimations,width:size,height:size,dpr:thumbnailDpr(settings,dpr,kind==='session')});
      if(next===raw)return raw;
      changed++;return next+'#cit-api-v1';
    };
    const variants=['origin','w200','w600','gif','gif600'];
    const skip=new Set(['messages','message','lastMessage','prompt','startingSets']);
    const walk=(obj,depth)=>{
      if(!obj||typeof obj!=='object'||depth>16)return;
      for(const key of Object.keys(obj)){
        if(skip.has(key))continue;
        const value=obj[key];
        if(key==='profileImage'||key==='portraitImage'){
          if(typeof value==='string')obj[key]=convert(value);
          else if(value&&typeof value==='object'&&!Array.isArray(value))for(const v of variants)if(Object.hasOwn(value,v))value[v]=convert(value[v]);
        }else if(value&&typeof value==='object')walk(value,depth+1);
      }
    };
    walk(data,0);return changed;
  }
  function installAPIImageInterceptor({win,sdk,settings,onChange=()=>{}}) {
    const rules=apiImageRules(sdk),responses=new WeakMap(),requests=new WeakMap(),undo=[];
    const stats={routes:rules.length,fetch:false,xhr:false,responses:0,urls:0,errors:0};
    let active=true;
    const report=()=>{try{onChange({...stats});}catch{}};
    const classify=(input,method)=>apiRequestKind(input,method,rules,win.location.href);
    const transform=(value,kind)=>{
      if(!active||!kind)return value;
      try{const n=rewriteAPIImages(value,kind,settings,win.devicePixelRatio||1);stats.responses++;stats.urls+=n;if(n)report();}catch{stats.errors++;report();}
      return value;
    };
    const textTransform=(value,kind)=>{
      // Only completed JSON bodies; no stream tee, automatic response clone or extra request.
      if(!active||!kind||typeof value!=='string'||value.length>4*1024*1024)return value;
      try{const parsed=JSON.parse(value),before=stats.urls;transform(parsed,kind);return stats.urls===before?value:JSON.stringify(parsed);}catch{return value;}
    };
    const replace=(obj,key,descriptor)=>{
      const old=Object.getOwnPropertyDescriptor(obj,key);if(!old||!old.configurable)return false;
      Object.defineProperty(obj,key,{...old,...descriptor});
      undo.push(()=>{const now=Object.getOwnPropertyDescriptor(obj,key);if((descriptor.value&&now?.value===descriptor.value)||(descriptor.get&&now?.get===descriptor.get))Object.defineProperty(obj,key,old);});return true;
    };
    const fetchKind=response=>{
      const kind=responses.get(response);
      return kind&&response.ok&&classify(response.url,'GET')===kind&&/\bjson\b/i.test(response.headers.get('content-type')||'')?kind:null;
    };
    if(settings.apiImages&&rules.length){
      try{
        const proto=win.Response?.prototype,fetch=win.fetch,json=proto?.json,text=proto?.text,clone=proto?.clone;
        if(proto&&typeof fetch==='function'){
          replace(proto,'json',{value:async function(){const value=await json.call(this);return transform(value,fetchKind(this));}});
          replace(proto,'text',{value:async function(){const value=await text.call(this);return textTransform(value,fetchKind(this));}});
          replace(proto,'clone',{value:function(){const copy=clone.call(this);const kind=responses.get(this);if(kind)responses.set(copy,kind);return copy;}});
          stats.fetch=replace(win,'fetch',{value:function(input,init){
            let kind=null;try{kind=classify(typeof input==='string'||input instanceof win.URL?String(input):input?.url,init?.method||input?.method||'GET');}catch{}
            const result=fetch.apply(this,arguments);
            return !active||!kind?result:result.then(response=>{responses.set(response,kind);return response;});
          }});
        }
      }catch{stats.errors++;}
      try{
        const proto=win.XMLHttpRequest?.prototype,open=proto?.open;
        const rt=Object.getOwnPropertyDescriptor(proto||{},'responseText'),resp=Object.getOwnPropertyDescriptor(proto||{},'response');
        if(open&&rt?.get&&resp?.get){
          replace(proto,'open',{value:function(method,url){const result=open.apply(this,arguments);requests.set(this,{kind:classify(url,method),done:false,value:undefined});return result;}});
          const valueFor=(xhr,value)=>{
            const state=requests.get(xhr);
            if(!active||!state?.kind||xhr.readyState!==4||xhr.status<200||xhr.status>=300||classify(xhr.responseURL,'GET')!==state.kind||!/\bjson\b/i.test(xhr.getResponseHeader('content-type')||''))return value;
            if(!state.done){state.done=true;state.value=typeof value==='string'?textTransform(value,state.kind):transform(value,state.kind);}
            return state.value;
          };
          replace(proto,'responseText',{get:function(){return valueFor(this,rt.get.call(this));}});
          stats.xhr=replace(proto,'response',{get:function(){const value=resp.get.call(this);return this.responseType===''||this.responseType==='text'||this.responseType==='json'?valueFor(this,value):value;}});
        }
      }catch{stats.errors++;}
    }
    report();return {stats,destroy(){active=false;for(const restore of undo.reverse())restore();}};
  }

  // Exports enable deterministic Node tests without loading a DOM or contacting Crack.
  if (typeof module !== 'undefined' && module.exports) { module.exports={sourceURL,describe,parseHeader,validateTile,metadata,Queue,nativeImagePlan,normalizeSettings,DEFAULT_SETTINGS,createChatRenderer,migrateSettings,apiImageRules,apiRequestKind,apiImageSource,rewriteAPIImages,installAPIImageInterceptor,effectiveSettings,resourcePolicy,thumbnailDpr,shouldFreezeTile,fetchTileData}; return; }
  if (typeof document === 'undefined' || location.hostname !== 'crack.wrtn.ai') return;
  let settings;try{settings=migrateSettings(typeof GM_getValue==='function'?GM_getValue('crackOptimizer.settings.v1',{}):{});}catch{settings=normalizeSettings({});}
  const preferences=settings;settings=effectiveSettings(preferences);
  const policy=resourcePolicy(settings);
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const apiImages=installAPIImageInterceptor({win:page,sdk:typeof Crack!=='undefined'?Crack:null,settings});
  const seen = new WeakMap(), states = new Map(), metaCache = new Map();
  const queue = new Queue(policy.concurrency);
  const counters = {early:0,late:0,loaded:0,released:0,errors:0};
  const thumbStats={tracked:0,asleep:0};let thumbManager,scanTimer,animationRAF=0;
  const originalSet = page.Element.prototype.setAttribute;
  const originalGet = page.Element.prototype.getAttribute;
  const srcDescriptor = Object.getOwnPropertyDescriptor(page.HTMLImageElement.prototype,'src');
  const srcsetDescriptor = Object.getOwnPropertyDescriptor(page.HTMLImageElement.prototype,'srcset');
  const set = (el,key,value) => originalSet.call(el,key,value);
  const get = (el,key) => originalGet.call(el,key);
  let scheduled=false, panel, raf, running=true,chatManager,layoutTimer=0;
  const chatStats={tracked:0,skipped:0};

  function request(info, signal) {
    return queue.run(()=>new Promise((resolve,reject)=>{
      if(signal.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
      let handle, done=false;
      const finish=(error,result)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);error?reject(error):resolve(result);};
      const abort=()=>{handle?.abort();finish(new DOMException('Cancelled','AbortError'));};
      signal.addEventListener('abort',abort,{once:true});
      handle=GM_xmlhttpRequest({method:'GET',url:info.url,anonymous:true,responseType:'arraybuffer',timeout:25000,
        onprogress:e=>{if(e.loaded>info.maxBytes){handle?.abort();finish(new Error('응답 용량 제한 초과'));}},
        onload:r=>{if(r.status!==200){finish(new Error(`변환 서버 응답 ${r.status}`));return;}
          if(!r.response || r.response.byteLength>info.maxBytes){finish(new Error('응답 용량 제한 초과'));return;}
          finish(null,r.response);},
        onerror:()=>finish(new Error('이미지 요청 실패')),ontimeout:()=>finish(new Error('이미지 요청 시간 초과')),
        onabort:()=>finish(new DOMException('Cancelled','AbortError'))});
    }),signal);
  }
  function schedule(){if(!scheduled&&running){scheduled=true;scanTimer=setTimeout(()=>{scheduled=false;scan();},policy.scanDelay);}}
  function eligible(img){return settings.longImages && img?.tagName==='IMG' && !img.hasAttribute('data-cit-owned') && (seen.has(img)||img.matches(SELECTOR));}
  function intercept(img, value) {
    if(!eligible(img)) return img?.tagName==='IMG' && Boolean(thumbManager?.intercept(img,'src',value));
    const raw=String(value);
    if(raw===TRANSPARENT) return false;
    seen.set(img,{raw,early:true});
    img.removeAttribute('srcset');
    set(img,'src',TRANSPARENT);
    schedule(); return true;
  }
  // These hooks run synchronously before React's usual src assignment.
  // Parser-created/preloaded elements are handled later and reported as late.
  try {
    page.Element.prototype.setAttribute=function(name,value){
      const key=String(name).toLowerCase();
      if(key==='src'&&intercept(this,value))return;
      if(key==='srcset'&&eligible(this)){this.removeAttribute('srcset');return;}
      if(key==='srcset'&&thumbManager?.intercept(this,key,value))return;
      return originalSet.call(this,name,value);
    };
    Object.defineProperty(page.HTMLImageElement.prototype,'src',{...srcDescriptor,
      get(){const raw=seen.get(this)?.raw||thumbManager?.getSource(this);if(raw){try{return new URL(raw,document.baseURI).href;}catch{return raw;}}return srcDescriptor.get.call(this);},
      set(value){if(!intercept(this,value))srcDescriptor.set.call(this,value);}});
    Object.defineProperty(page.HTMLImageElement.prototype,'srcset',{...srcsetDescriptor,
      get(){return thumbManager?.getSrcset(this)??srcsetDescriptor.get.call(this);},
      set(value){if(eligible(this)){this.removeAttribute('srcset');return;}if(!thumbManager?.intercept(this,'srcset',value))srcsetDescriptor.set.call(this,value);}});
  } catch(error) { console.warn('크랙 이미지: 사전 가로채기 실패. 이미 시작된 요청은 취소 보장 불가.',error.message); }

  function release(t) {
    t.controller?.abort();t.controller=null;
    if(t.blobURL){URL.revokeObjectURL(t.blobURL);t.blobURL=null;}
    if(t.decoder){t.decoder.close();t.decoder=null;}
    if(t.canvas){t.canvas.width=0;t.canvas.height=0;t.canvas.remove();t.canvas=null;}
    if(t.image){t.image.removeAttribute('src');t.image.remove();t.image=null;}
    if(t.live)counters.released++;
    t.live=false;t.bytes=0;t.loading=false;t.frameTimes=null;t.frameCount=0;t.drawing=false;t.lastFrame=-1;
    t.slot.textContent='';
  }
  function errorState(s, message) {
    if(s.dead)return;
    counters.errors++;s.error=message;if(s.key)metaCache.delete(s.key);
    for(const t of s.tiles)release(t);
    s.tiles=[];s.viewer.style.height='auto';s.viewer.style.minHeight='90px';
    s.viewer.replaceChildren();
    const box=document.createElement('div');box.className='cit-error';
    const text=document.createElement('span');text.textContent=message+' 원본은 자동으로 불러오지 않았습니다.';
    const retry=document.createElement('button');retry.textContent='다시 시도';retry.onclick=()=>{dispose(s);schedule();};
    const link=document.createElement('a');link.textContent='원본 새 탭';
    try {const u=new URL(s.raw,document.baseURI);if(['http:','https:'].includes(u.protocol)){link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';}}catch{}
    link.title='원본 전체를 로딩하므로 메모리 사용이 증가할 수 있습니다.';
    box.append(text,retry,link);s.viewer.append(box);updatePanel();
  }
  function dispose(s) {
    s.dead=true;s.controller.abort();for(const t of s.tiles)release(t);
    resizeObserver.unobserve(s.viewer);s.viewer.remove();s.img.style.display=s.display;states.delete(s.img);
  }
  function clippedViewport(el) {
    let top=0,bottom=innerHeight,left=0,right=innerWidth;
    for(let p=el.parentElement;p;p=p.parentElement){
      const cs=getComputedStyle(p);
      if(cs.display==='none'||cs.visibility==='hidden'||p.hidden)return null;
      if(/auto|scroll|hidden|clip/.test(cs.overflowY)){const r=p.getBoundingClientRect();top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);}
      if(/auto|scroll|hidden|clip/.test(cs.overflowX)){const r=p.getBoundingClientRect();left=Math.max(left,r.left);right=Math.min(right,r.right);}
    }
    return bottom>top&&right>left?{top,bottom,left,right}:null;
  }
  async function prepare(s) {
    try {
      const key=sourceURL(s.raw,document.baseURI);s.key=key;
      let m=metaCache.get(key);
      if(!m){m=metadata(await request(describe(key),s.controller.signal));metaCache.set(key,m);if(metaCache.size>100)metaCache.delete(metaCache.keys().next().value);}
      if(s.dead)return;
      s.freeze=await shouldFreezeTile(settings.freezeAnimations,typeof ImageDecoder==='undefined'?null:ImageDecoder,m.type);
      if(s.dead)return;
      if(s.freeze)m={...m,frames:1};
      s.meta=m;
      // Bound one tile by area as well as height for unusually wide images.
      s.tileRows=Math.min(policy.tileRows,Math.max(1,Math.floor(2*1024*1024/m.width)));
      if(m.width*s.tileRows*4*m.frames+policy.maxTileBytes>policy.maxLiveBytes)throw new Error('이 애니메이션은 현재 조각 처리 예산을 초과합니다.');
      s.viewer.replaceChildren();s.viewer.style.minHeight='0';s.viewer.style.aspectRatio=`${m.width} / ${m.height}`;
      s.viewer.style.position='relative';s.viewer.style.overflow='hidden';s.viewer.style.width='100%';
      s.viewer.setAttribute('aria-label',s.img.alt||'분할 이미지');
      s.ready=true;requestLayout();
    }catch(e){if(e.name!=='AbortError')errorState(s,e.message);}
  }
  function mount(img, info) {
    const old=states.get(img);if(old?.raw===info.raw)return;if(old)dispose(old);
    const viewer=document.createElement('div');viewer.className='cit-viewer';viewer.dataset.citOwned='';
    viewer.style.cssText='display:block;width:100%;min-height:90px;border-radius:12px;background:#8881;';
    viewer.textContent='이미지 크기 확인 중…';
    const s={img,raw:info.raw,viewer,display:img.style.display,controller:new AbortController(),tiles:[],ready:false,dead:false,error:null,epoch:performance.now()};
    states.set(img,s);
    if(info.early)counters.early++;else counters.late++;
    img.removeAttribute('srcset');set(img,'src',TRANSPARENT);
    img.style.setProperty('display','none');img.after(viewer);resizeObserver.observe(viewer);
    prepare(s);updatePanel();
  }
  function scan() {
    if(!document.documentElement)return;
    for(const [img,s] of states)if(!img.isConnected)dispose(s);
    if(settings.longImages)for(const img of document.querySelectorAll(SELECTOR)){
      if(img.hasAttribute('data-cit-owned'))continue;
      let info=seen.get(img);
      const thumbnailSource=thumbManager?.takeSource(img);
      if(!info&&thumbnailSource){info={raw:thumbnailSource,early:false};seen.set(img,info);}
      const physical=get(img,'src');
      if(physical&&physical!==TRANSPARENT&&physical!==info?.raw){info={raw:physical,early:false};seen.set(img,info);}
      if(!info&&physical&&physical!==TRANSPARENT){info={raw:physical,early:false};seen.set(img,info);}
      if(info)mount(img,info);
    }
    thumbManager?.scan();
    requestLayout();
  }
  function requestLayout(){if(!raf&&!layoutTimer&&running){
    const next=()=>{layoutTimer=0;if(running)raf=requestAnimationFrame(()=>{raf=0;layout();});};
    if(policy.layoutDelay)layoutTimer=setTimeout(next,policy.layoutDelay);else next();
  }}
  function layout() {
    const desired=[];
    for(const s of states.values()){
      if(!s.ready||s.error||s.dead)continue;
      if(chatManager?.isSkipped(s.viewer)){for(const t of s.tiles)release(t);continue;}
      const r=s.viewer.getBoundingClientRect(),clip=clippedViewport(s.viewer);
      if((settings.hiddenTab&&document.hidden)||!clip||r.width<=0||r.right<=clip.left||r.left>=clip.right){for(const t of s.tiles)release(t);continue;}
      const scale=r.width/s.meta.width;
      const margin=policy.margin;
      const from=Math.max(0,Math.floor((clip.top-margin-r.top)/scale/s.tileRows));
      const to=Math.min(Math.ceil(s.meta.height/s.tileRows)-1,Math.floor((clip.bottom+margin-r.top)/scale/s.tileRows));
      const wanted=new Set();
      for(let i=from;i<=to;i++){
        wanted.add(i);
        let t=s.tiles.find(t=>t.index===i);
        if(!t){const slot=document.createElement('div');slot.className='cit-tile';slot.style.cssText=`position:absolute;left:0;width:100%;top:${i*s.tileRows/s.meta.height*100}%;height:${Math.min(s.tileRows,s.meta.height-i*s.tileRows)/s.meta.height*100}%;`;
          s.viewer.append(slot);t={index:i,slot,s,top:i*s.tileRows,rows:Math.min(s.tileRows,s.meta.height-i*s.tileRows),bytes:0};s.tiles.push(t);}
        const y=r.top+(t.top+t.rows/2)*scale;
        desired.push({t,distance:Math.abs(y-(clip.top+clip.bottom)/2),visible:y+t.rows*scale/2>clip.top&&y-t.rows*scale/2<clip.bottom});
      }
      for(const t of s.tiles)if(!wanted.has(t.index)){release(t);t.slot.remove();}
      s.tiles=s.tiles.filter(t=>wanted.has(t.index));
    }
    desired.sort((a,b)=>Number(b.visible)-Number(a.visible)||a.distance-b.distance);
    let budget=0,count=0;
    const selected=new Set();
    for(const {t} of desired){const cost=t.bytes||t.s.meta.width*t.rows*4*t.s.meta.frames+policy.maxTileBytes;
      if(count<policy.maxLiveTiles&&budget+cost<=policy.maxLiveBytes){selected.add(t);count++;budget+=cost;}}
    for(const s of states.values())for(const t of s.tiles)if(!selected.has(t))release(t);
    for(const t of selected)if(!t.live&&!t.loading)loadTile(t);
    updatePanel();
  }
  async function loadTile(t) {
    t.loading=true;t.bytes=t.s.meta.width*t.rows*4*t.s.meta.frames+policy.maxTileBytes;
    const controller=new AbortController();t.controller=controller;
    try {
      const s=t.s;
      const {buffer,header:h}=await fetchTileData({source:s.key,meta:s.meta,top:t.top,rows:t.rows,freeze:s.freeze,
        Decoder:typeof ImageDecoder==='undefined'?null:ImageDecoder,request,signal:controller.signal,maxBytes:policy.maxTileBytes});
      if(controller.signal.aborted||s.dead)return;
      t.bytes=buffer.byteLength+h.width*h.height*4;
      if(h.animated){
        if(typeof ImageDecoder==='undefined'||!(await ImageDecoder.isTypeSupported(h.type)))throw new Error('이 브라우저는 분할 애니메이션 재생을 지원하지 않습니다.');
        if(controller.signal.aborted||s.dead)return;
        t.decoder=new ImageDecoder({data:buffer,type:h.type});
        await Promise.all([t.decoder.tracks.ready,t.decoder.completed]);
        if(controller.signal.aborted||s.dead)return;
        t.frameCount=t.decoder.tracks.selectedTrack.frameCount;
        t.bytes=buffer.byteLength+h.width*h.height*4*t.frameCount;
        let reserved=0;for(const state of states.values())for(const tile of state.tiles)reserved+=tile.bytes||0;
        if(reserved>policy.maxLiveBytes)throw new Error('애니메이션 처리량이 메모리 예산을 초과했습니다.');
        // Build the timeline one decoded tile-frame at a time; close frames immediately.
        // The browser decoder's internal caches are not controlled by this estimate.
        if(t.frameCount>500)throw new Error('애니메이션 프레임 수가 처리 한도를 초과했습니다.');
        t.frameTimes=[];let elapsed=0;
        for(let i=0;i<t.frameCount;i++){
          if(controller.signal.aborted||s.dead)return;
          const {image}=await t.decoder.decode({frameIndex:i});
          try{t.frameTimes.push(elapsed);elapsed+=Math.max(10,(image.duration||100000)/1000);}finally{image.close();}
        }
        t.duration=elapsed;t.repetitions=t.decoder.tracks.selectedTrack.repetitionCount;
        t.canvas=document.createElement('canvas');t.canvas.width=h.width;t.canvas.height=h.height;t.canvas.style.cssText='display:block;width:100%;height:100%;';t.slot.append(t.canvas);
      }else{
        const img=document.createElement('img');img.dataset.citOwned='';img.alt='';img.decoding='async';img.style.cssText='display:block;width:100%;height:100%;max-width:none;border-radius:0;';
        t.blobURL=URL.createObjectURL(new Blob([buffer],{type:h.type}));
        await new Promise((resolve,reject)=>{
          const abort=()=>{img.removeAttribute('src');reject(new DOMException('Cancelled','AbortError'));};
          controller.signal.addEventListener('abort',abort,{once:true});
          img.onload=()=>{controller.signal.removeEventListener('abort',abort);resolve();};
          img.onerror=()=>{controller.signal.removeEventListener('abort',abort);reject(new Error('조각 표시 실패'));};
          set(img,'src',t.blobURL);
        });
        if(controller.signal.aborted||s.dead)return;
        t.image=img;t.slot.append(img);
      }
      t.live=true;counters.loaded++;if(t.decoder)wakeAnimation();
    }catch(e){if(!controller.signal.aborted&&e.name!=='AbortError')errorState(t.s,e.message);}
    finally{if(t.controller===controller){t.loading=false;requestLayout();}}
  }
  async function drawFrame(t, now) {
    if(t.drawing||!t.decoder||!t.canvas||!t.frameTimes?.length)return;
    const decoder=t.decoder,canvas=t.canvas;
    const elapsed=Math.max(0,now-t.s.epoch);
    const ended=Number.isFinite(t.repetitions)&&elapsed>=t.duration*(t.repetitions+1);
    const time=ended?t.duration-0.001:elapsed%t.duration;
    let index=t.frameTimes.length-1;while(index>0&&t.frameTimes[index]>time)index--;
    if(index===t.lastFrame)return;
    t.drawing=true;
    try{const {image}=await decoder.decode({frameIndex:index});try{if(t.decoder===decoder&&t.canvas===canvas){canvas.getContext('2d').drawImage(image,0,0);canvas.dataset.citFrame=String(index);t.lastFrame=index;}}finally{image.close();}}
    catch(e){if(t.decoder===decoder)errorState(t.s,'애니메이션 프레임을 표시하지 못했습니다.');}
    finally{if(t.decoder===decoder)t.drawing=false;}
  }
  function animate(now){animationRAF=0;if(document.hidden||!running)return;let active=false;for(const s of states.values())for(const t of s.tiles)if(t.live&&t.decoder){active=true;drawFrame(t,now);}if(active)animationRAF=requestAnimationFrame(animate);}
  function wakeAnimation(){if(!animationRAF&&!document.hidden&&running)animationRAF=requestAnimationFrame(animate);}
  function updatePanel(){if(panel){let live=0,bytes=0;for(const s of states.values())for(const t of s.tiles)if(t.live||t.loading){live++;bytes+=t.bytes||0;}
    const label=`이미지 분할 · ${live}조각 · ${(bytes/1048576).toFixed(1)}MiB* · 화면밖 해제 ${thumbStats.asleep} · 변환 ${thumbStats.transformed||0} · 본문 생략 ${chatStats.skipped} · 사전 ${counters.early} / 뒤늦음 ${counters.late}`;
    if(panel.textContent!==label)panel.textContent=label;
    panel.title='*압축 조각+픽셀 버퍼 예산 추정치(애니메이션은 프레임 수 반영). 브라우저 전체 메모리 측정값이 아닙니다. 뒤늦음: 원본 요청이 이미 시작됐을 수 있습니다.';}}
  const observer=new MutationObserver(records=>{
    if(records.some(r=>r.type==='attributes'?r.target.tagName==='IMG':Array.from(r.addedNodes).concat(Array.from(r.removedNodes)).some(n=>n.nodeType===1&&!n.closest?.('[data-cit-owned]'))))schedule();
  });
  observer.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','node','class']});
  addEventListener('scroll',requestLayout,true);addEventListener('resize',requestLayout);document.addEventListener('visibilitychange',requestLayout);
  // ResizeObserver handles nested panes and chat sidebars whose width changes without a window resize.
  const resizeObserver=new ResizeObserver(requestLayout);

  let settingsDialog;
  function openSettings(){
    if(settingsDialog?.isConnected){settingsDialog.focus();return;}
    const draft={...preferences};
    const dialog=document.createElement('dialog');settingsDialog=dialog;dialog.dataset.citOwned='';dialog.className='cit-settings';dialog.setAttribute('aria-labelledby','cit-settings-title');
    const style=document.createElement('style');style.textContent=`
      .cit-settings{box-sizing:border-box;width:min(640px,calc(100vw - 24px));max-height:88vh;padding:0;border:1px solid #454553;border-radius:18px;background:#18181f;color:#f4f4f7;font:14px/1.55 system-ui;box-shadow:0 20px 90px #0009}
      .cit-settings::backdrop{background:#0009}.cit-settings *{box-sizing:border-box}.cit-settings header{padding:24px 24px 16px}.cit-settings h2{font:700 22px/1.3 system-ui;margin:0 0 8px}.cit-settings header p{margin:0;color:#b6b6c7}
      .cit-settings-list{padding:0 24px}.cit-setting{padding:18px 0;border-top:1px solid #35353f}.cit-setting label{display:flex;align-items:center;justify-content:space-between;gap:20px;cursor:pointer;font-weight:650;font-size:15px}.cit-setting input{appearance:none;flex:none;position:relative;width:42px;height:24px;background:#555564;border-radius:99px;cursor:pointer;margin:0}.cit-setting input:checked{background:#9280ff}.cit-setting input:after{content:'';position:absolute;width:18px;height:18px;top:3px;left:3px;background:white;border-radius:50%;transition:transform .12s}.cit-setting input:checked:after{transform:translateX(18px)}.cit-settings :focus-visible{outline:2px solid #c1b6ff;outline-offset:4px}
      .cit-setting p{margin:8px 0 0;color:#c0c0ce;font-size:13px}.cit-setting .cit-reason{color:#9e9eb2}.cit-settings footer{position:sticky;bottom:0;padding:18px 24px;background:#202029;border-top:1px solid #3a3a46}.cit-settings footer p{margin:0 0 12px;font-size:13px}.cit-settings-actions{display:flex;flex-wrap:wrap;gap:8px}.cit-settings button{border:1px solid #525262;border-radius:9px;padding:9px 14px;color:inherit;background:#30303c;font:inherit;cursor:pointer}.cit-settings button[type=submit]{margin-left:auto;background:#8d78ff;border-color:#8d78ff;color:#fff;font-weight:650}.cit-settings button:disabled{opacity:.5;cursor:wait}.cit-settings-error{color:#ffb4b4!important}.cit-settings small{display:block;margin-top:12px;color:#a8a8ba}
    `;
    const form=document.createElement('form'),header=document.createElement('header'),title=document.createElement('h2'),intro=document.createElement('p');
    title.id='cit-settings-title';title.textContent='크랙 최적화 설정';intro.textContent='저사양 모드는 개별 설정을 보관한 채 일부 항목을 우선 적용합니다. 끄면 이전 선택이 복원됩니다. API 사전 최적화는 아래 이미지 설정을 따릅니다. 본문·코드 지연 표시는 기본으로 꺼져 있으며 필요하면 켤 수 있습니다.';header.append(title,intro);form.append(header);
    const list=document.createElement('div');list.className='cit-settings-list';
    for(const [key,name,description,reason]of SETTING_ITEMS){
      const row=document.createElement('section');row.className='cit-setting';const label=document.createElement('label'),text=document.createElement('span'),input=document.createElement('input');text.textContent=name;input.type='checkbox';input.name=key;input.checked=draft[key];input.onchange=()=>{draft[key]=input.checked;syncMode();};input.setAttribute('role','switch');input.setAttribute('aria-describedby',`cit-description-${key} cit-reason-${key}`);label.append(text,input);
      const desc=document.createElement('p');desc.id=`cit-description-${key}`;desc.textContent=description;const why=document.createElement('p');why.id=`cit-reason-${key}`;why.className='cit-reason';why.textContent='최적화 이유 · '+reason;row.append(label,desc,why);list.append(row);
    }
    form.append(list);const footer=document.createElement('footer'),notice=document.createElement('p'),actions=document.createElement('div'),defaults=document.createElement('button'),cancel=document.createElement('button'),save=document.createElement('button'),error=document.createElement('p'),note=document.createElement('small');
    notice.textContent='저장하면 자동으로 새로고침되어 적용됩니다. 작성 중인 내용이 있다면 먼저 마무리해 주세요.';actions.className='cit-settings-actions';defaults.type=cancel.type='button';save.type='submit';defaults.textContent='기본값';cancel.textContent='취소';save.textContent='저장 및 새로고침';error.className='cit-settings-error';error.setAttribute('role','alert');note.textContent='항상 적용: DOM 탐색 묶음 처리 · 활성 움짤이 있을 때만 프레임 처리. 지연 시작은 작품 카드·본문·코드 렌더링에 적용합니다. 이미지 요청 처리는 즉시 시작하며 파서 선행 요청까지 막는 것은 아닙니다. 변환 실패, 인증 주소, picture 등은 일부 기능이 적용되지 않을 수 있습니다.';
    actions.append(defaults,cancel,save);footer.append(notice,actions,error,note);form.append(footer);dialog.append(style,form);document.body.append(dialog);
    const syncMode=()=>{
      for(const key of Object.keys(DEFAULT_SETTINGS)){
        const input=form.elements.namedItem(key),locked=draft.lowPower&&Object.hasOwn(LOW_POWER_OVERRIDES,key);
        input.disabled=locked;input.checked=locked?LOW_POWER_OVERRIDES[key]:draft[key];
        input.title=locked?'저사양 모드가 우선 적용합니다. 모드를 끄면 이전 선택으로 돌아갑니다.':'';
        input.closest('section').style.opacity=locked?'.7':'1';
      }
    };syncMode();
    const previous=document.activeElement;const close=()=>{dialog.close();dialog.remove();form.onsubmit=null;cancel.onclick=defaults.onclick=null;for(const input of form.querySelectorAll('input'))input.onchange=null;form.replaceChildren();dialog.replaceChildren();settingsDialog=null;previous?.focus?.();};cancel.onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    defaults.onclick=()=>{Object.assign(draft,DEFAULT_SETTINGS);syncMode();};
    form.onsubmit=async e=>{e.preventDefault();error.textContent='';const next=normalizeSettings(draft);save.disabled=true;cancel.disabled=true;defaults.disabled=true;
      try{if(typeof GM_setValue!=='function')throw new Error('Tampermonkey 저장 권한을 확인하세요.');next._memoryPolicy=1;await GM_setValue('crackOptimizer.settings.v1',next);location.reload();}
      catch(err){error.textContent='설정을 저장하지 못했습니다. 새로고침하지 않았습니다. '+err.message;save.disabled=false;cancel.disabled=false;defaults.disabled=false;}
    };
    dialog.showModal();
  }

  const startOptimization=()=>{
    if(!running||chatManager)return;
    chatManager=createChatRenderer({doc:document,win:window,settings,onChange:stats=>{Object.assign(chatStats,stats);updatePanel();},onVisibility:()=>{requestLayout();schedule();}});
    scan();
  };
  let startupObserver,startupTimer,startupMaxTimer;
  const queueStartup=()=>{
    if(!settings.deferMessages&&!settings.deferCodeBlocks&&!settings.deferCards)return;
    if(!settings.safeStartup){startOptimization();return;}
    const begin=()=>{
      let earliest=performance.now()+3000,lastChange=performance.now();
      const finish=()=>{startupObserver?.disconnect();clearTimeout(startupTimer);clearTimeout(startupMaxTimer);startOptimization();};
      const check=()=>{const now=performance.now();if(now>=earliest&&now-lastChange>=750)finish();else startupTimer=setTimeout(check,250);};
      startupObserver=new MutationObserver(rs=>{if(rs.some(r=>!r.target.closest?.('[data-cit-owned]')))lastChange=performance.now();});
      startupObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
      startupTimer=setTimeout(check,3000);startupMaxTimer=setTimeout(finish,15000);
    };
    // bootstrap runs after DOMContentLoaded; do not wait on slow image downloads.
    begin();
  };
  const bootstrap=()=>{
    const style=document.createElement('style');style.textContent='.cit-viewer{box-sizing:border-box}.cit-error{padding:14px;font:13px/1.6 system-ui;display:flex;gap:10px;flex-wrap:wrap}.cit-error span{flex-basis:100%}.cit-error button,.cit-error a{font:inherit;color:inherit;text-decoration:underline;cursor:pointer}.cit-status{position:fixed;left:10px;bottom:10px;z-index:2147482000;font:11px/1.5 system-ui;color:#eee;background:#222e;padding:6px 10px;border-radius:8px;pointer-events:none}';document.head.append(style);
    if(settings.reduceEffects){const effects=document.createElement('style');effects.dataset.citOwned='';effects.textContent=`
      *,*::before,*::after{animation-duration:.01ms!important;animation-delay:0ms!important;animation-iteration-count:1!important;transition-duration:0ms!important;transition-delay:0ms!important;scroll-behavior:auto!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    `;document.head.append(effects);}
    if(settings.showStatus){panel=document.createElement('div');panel.dataset.citOwned='';panel.className='cit-status';document.body.append(panel);}
    resizeObserver.observe(document.body);
    if(typeof GM_registerMenuCommand==='function')GM_registerMenuCommand('크랙 최적화 · 설정',openSettings);
    // The @require UI SDK is used only for the diagnostic menu.
    // Image interception and the image manager never wait on SDK setup.
    if(typeof GM_registerMenuCommand==='function'){
      let diagnosticUI;
      GM_registerMenuCommand('이미지 분할: SDK 진단',()=>{
        if(typeof CrackUI==='undefined'){alert('UI SDK를 불러오지 못했습니다. @require 경로를 확인하세요.');return;}
        if(!diagnosticUI){diagnosticUI=CrackUI.createPageUI();diagnosticUI.configure('media.longImages',{kind:'collection',tiers:[{css:SELECTOR}]});}
        alert(JSON.stringify(diagnosticUI.inspect('media.longImages'),null,2)+'\n숨긴 원본은 SDK에서 missing으로 표시될 수 있습니다.');
      });
    }
    if(typeof GM_registerMenuCommand==='function')GM_registerMenuCommand('크랙 최적화: API 상태',()=>alert(JSON.stringify(apiImages.stats,null,2)+'\nSDK 조회 경로에 한해 기존 응답의 이미지 주소를 바꿉니다. 별도 API 요청은 보내지 않습니다.'));
    if(typeof GM_registerMenuCommand==='function')GM_registerMenuCommand('이미지 분할: 상태',()=>alert(JSON.stringify(counters,null,2)+'\n전 형식 보장판이 아닙니다. 오류가 난 원본은 자동 로딩하지 않습니다.'));
    thumbManager=createThumbnailVirtualizer({doc:document,win:window,setAttribute:set,placeholder:TRANSPARENT,exclude:settings.longImages?SELECTOR:':not(*)',settings,onDirty:schedule,isSuppressed:el=>Boolean(chatManager?.isSkipped(el)),onChange:stats=>{Object.assign(thumbStats,stats);updatePanel();}});
    scan();
    queueStartup();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootstrap,{once:true});else bootstrap();
  addEventListener('pagehide',e=>{cancelAnimationFrame(animationRAF);animationRAF=0;if(!e.persisted){apiImages.destroy();running=false;observer.disconnect();resizeObserver.disconnect();clearTimeout(scanTimer);clearTimeout(layoutTimer);cancelAnimationFrame(raf);clearTimeout(startupTimer);clearTimeout(startupMaxTimer);startupObserver?.disconnect();thumbManager?.destroy();chatManager?.destroy();for(const s of [...states.values()])dispose(s);}else for(const s of states.values())for(const t of s.tiles)release(t);});
  addEventListener('pageshow',requestLayout);

})();
