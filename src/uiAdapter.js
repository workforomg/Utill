import { UI_MAP } from "./uiMap.js";

export function identifyPage(url = globalThis.location?.href ?? 'https://crack.wrtn.ai/') {
  const p=new URL(url,'https://crack.wrtn.ai').pathname;
  if(/^\/stories\/[^/]+\/episodes\//.test(p))return 'story-chat';
  if(/^\/characters\/[^/]+\/chats\//.test(p))return 'character-chat';
  if(p.startsWith('/builder'))return 'builder';
  if(p==='/profile/assignment')return 'badges';
  if(/^\/profile\/[^/]+\/follow$/.test(p))return 'follow';
  if(p.startsWith('/profile/'))return 'profile';
  if(p.startsWith('/announcement/'))return 'announcement';
  return ({'/':'home','/characters':'characters','/my':'works','/search':'search','/announcement':'announcements','/block-center':'blocks','/setting':'settings','/setting/personalized':'personalized','/series/subscribed':'subscriptions','/liked':'likes','/image/generate':'images'})[p]??'other';
}

export class UIResolutionError extends Error {
  constructor(report){super(`UI ${report.key}: ${report.status}`);this.name='UIResolutionError';this.report=report;}
}

/** Every action resolves fresh DOM. Configuration is local and instance-scoped. */
export function createPageUI({root=globalThis.document, map=UI_MAP, overrides={}, page, allowEffects=['navigate','local']}={}) {
  if(!root?.querySelectorAll)throw new TypeError('A DOM root is required');
  const doc=root.ownerDocument??root, win=doc.defaultView;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const rules=clone({...map,...overrides});
  const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
  const pageName=()=>typeof page==='function'?page():page??identifyPage(win.location.href);
  const visible=el=>{
    if(!el.isConnected)return false;
    for(let p=el;p;p=p.parentElement){
      if(p.hidden || p.hasAttribute('inert') || p.getAttribute('aria-hidden')==='true')return false;
      const s=win.getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse')return false;
    }
    return el.getClientRects().length>0;
  };
  const name=el=>{
    const labelled=el.getAttribute('aria-labelledby');
    if(labelled){const text=labelled.split(/\s+/).map(id=>doc.getElementById(id)?.textContent??'').join(' ');if(norm(text))return norm(text);}
    return norm(el.getAttribute('aria-label')??el.getAttribute('alt')??el.textContent);
  };
  function locate(key,trail=[]) {
    const d=rules[key],currentPage=pageName();
    const result=(status,elements=[],extra={})=>({key,status,elements,page:currentPage,kind:d?.kind,effect:d?.effect,...extra});
    if(!d)return result('unknown');
    if(trail.includes(key))return result('invalid-config',[],{reason:'scope-cycle'});
    if(d.pages&&!d.pages.includes(currentPage))return result('wrong-page');
    let scope=root;
    if(d.scope){const parent=locate(d.scope,[...trail,key]);if(parent.status!=='found'||parent.elements.length!==1)return result('scope-unavailable',[],{scopeStatus:parent.status==='found'?'ambiguous':parent.status});scope=parent.elements[0];}
    if(!Array.isArray(d.tiers))return result('invalid-config');
    for(let i=0;i<d.tiers.length;i++) {
      const t=d.tiers[i];let candidates;
      try {
        candidates=[...scope.querySelectorAll(t.css)].filter(el=>{
          if(!visible(el))return false;
          if(t.names&&!t.names.map(norm).includes(name(el)))return false;
          if(t.placeholder&&!t.placeholder.map(norm).includes(norm(el.getAttribute('placeholder'))))return false;
          if(t.path){const href=el.getAttribute('href');if(!href)return false;const url=new URL(href,doc.baseURI);if(url.origin!==win.location.origin||url.pathname!==t.path)return false;}
          if(t.has&&!el.querySelector(t.has))return false;
          if(t.exclude&&el.closest(t.exclude))return false;
          if(t.contains&&!t.contains.every(s=>norm(el.textContent).includes(norm(s))))return false;
          return true;
        });
      }catch{return result('invalid-config',[],{tier:i});}
      if(!candidates.length)continue;
      if(d.kind==='collection')return result('found',candidates,{tier:i});
      if(candidates.length>1)return result('ambiguous',candidates,{tier:i});
      const el=candidates[0];
      if(el.disabled||el.getAttribute('aria-disabled')==='true'||el.matches(':disabled'))return result('disabled',[el],{tier:i});
      return result('found',[el],{tier:i});
    }
    return result('missing');
  }
  // Diagnostics intentionally omit text, IDs, input values, HTML and complete URLs.
  const summarize=r=>({key:r.key,status:r.status,page:r.page,count:r.elements.length,tier:r.tier,kind:r.kind,effect:r.effect,scopeStatus:r.scopeStatus,reason:r.reason});
  const requireOne=key=>{const r=locate(key);if(r.status!=='found'||r.elements.length!==1)throw new UIResolutionError(summarize(r));return r;};
  function click(key){
    const r=requireOne(key),el=r.elements[0];
    if(r.kind!=='control')throw new UIResolutionError({...summarize(r),status:'not-control'});
    if(!allowEffects.includes(r.effect))throw new UIResolutionError({...summarize(r),status:'effect-blocked'});
    const modal=[...doc.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')].filter(visible);
    if(modal.some(m=>!m.contains(el)&&el.getAttribute('aria-controls')!==m.id))throw new UIResolutionError({...summarize(r),status:'overlay-blocked'});
    if(!visible(el))throw new UIResolutionError({...summarize(r),status:'stale'});
    el.click();return {key,clicked:true,verified:false};
  }
  function watch(callback,{delay=100}={}){
    let timer,stopped=false,last='',href=win.location.href;
    const run=()=>{timer=undefined;if(stopped)return;const report=health();const signature=JSON.stringify(report);if(signature!==last){last=signature;callback(report);}};
    const schedule=()=>{if(!stopped&&timer===undefined)timer=win.setTimeout(run,delay);};
    const observer=new win.MutationObserver(schedule);
    observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});
    const interval=win.setInterval(()=>{if(win.location.href!==href){href=win.location.href;schedule();}},300);
    win.addEventListener('popstate',schedule);win.addEventListener('resize',schedule);schedule();
    return()=>{stopped=true;observer.disconnect();win.clearTimeout(timer);win.clearInterval(interval);win.removeEventListener('popstate',schedule);win.removeEventListener('resize',schedule);};
  }
  function health(keys=Object.keys(rules)){return keys.map(key=>summarize(locate(key)));}
  function inventory(){
    const categories={controls:'button,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="switch"],summary',inputs:'input,textarea,select,[contenteditable="true"]',containers:'main,nav,header,aside,section,form,dialog,[role="main"],[role="dialog"],[role="menu"],[role="list"],[role="listitem"],[role="tablist"],[role="tabpanel"],[data-message-group-id]'};
    return Object.fromEntries(Object.entries(categories).map(([category,css])=>[category,[...root.querySelectorAll(css)].filter(visible).map(element=>({element,tag:element.tagName.toLowerCase(),role:element.getAttribute('role'),disabled:Boolean(element.disabled)||element.getAttribute('aria-disabled')==='true'}))]));
  }
  return Object.freeze({resolve:locate,inspect:key=>summarize(locate(key)),health,click,watch,inventory,
    element:key=>requireOne(key).elements[0],
    elements:key=>{const r=locate(key);if(r.status!=='found')throw new UIResolutionError(summarize(r));return [...r.elements];},
    configure(key,definition){rules[key]=clone(definition);},
    definitions:()=>clone(rules),
  });
}
