// ==UserScript==
// @name         대화 프로필 로컬 이미지
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @updateURL    
// @downloadURL  
// @author       지유지요
// @description  대화 프로필별 이미지를 로컬에 저장하고, 선택한 이미지를 전송된 유저 메시지 위에 표시합니다. 이미지/이름을 채팅 서버에 전송하지 않습니다.
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @connect      raw.githubusercontent.com
// ==/UserScript==

(() => {
  'use strict';

  // Only the SDK files are downloaded with GM_xmlhttpRequest.
  // No image upload, request-body modification, extra socket, or automatic message send.
  const PAGE = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
  const NS = 'crack-profile-local-images-v1';
  const OWNER = 'data-cpi-owned';
  const GROUP = '[data-message-group-id]';
  const EDITOR = 'textarea,.tiptap[contenteditable="true"],.ProseMirror[contenteditable="true"]';
  const API_ORIGIN = 'https://crack-api.wrtn.ai';
  const CONFIG = Object.freeze({
    sdkRef: 'main', // Replace with a verified commit SHA to pin the remote SDK.
    sdkCacheMs: 6 * 60 * 60 * 1000,
    maxFileBytes: 20 * 1024 * 1024,
    maxBatchFiles: 50,
    maxProfileImages: 200,
    maxPixels: 32 * 1024 * 1024,
    maxSide: 16384,
    pendingMs: 90 * 1000,
    domDelay: 100,
  });
  const nativeFetch = PAGE.fetch?.bind(PAGE);
  const state = {
    ready: false, sdk: null, ui: null, api: null, profilesAPI: null,
    route: { kind: 'other', chatId: null }, href: '', epoch: 0,
    accountId: null, profiles: new Map(), profileLists: new Map(), chats: new Map(),
    profileId: null, profileKnown: false, catalog: null, catalogKey: '', catalogListener: null,
    selected: null, selectionVersion: 0, profileVersion: new Map(),
    messages: new Map(), links: new Map(), linkListeners: new Map(),
    pending: new Map(), edits: new Map(), httpEdits: new Map(),
    composer: null, composerSignature: '', modal: null, managerRequest: 0, menuContext: null,
    settingsProfilesKey: '', settingsProfilesPromise: null,
    refreshTimer: 0, routeTimer: 0, lastHydrate: 0, mePromise: null, profilesPromise: null, hydrateKey: '', hydratePromise: null,
    headers: {}, errors: [], notices: new Set(), hooks: { fetch: false, xhr: false, websocket: false },
    counters: { sends: 0, created: 0, linked: 0, editSaved: 0, editFailed: 0 },
  };

  const id = value => typeof value === 'string' && value.length > 0 && value.length < 160 ? value : null;
  const norm = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
  const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const uuid = () => crypto.randomUUID();
  const own = element => !!element?.closest?.(`[${OWNER}]`);
  const storageKey = (...parts) => [NS, ...parts.map(v => encodeURIComponent(String(v)))].join(':');
  const profileKey = (accountId, profileId) => storageKey('profile', accountId, profileId);
  const linkKey = (accountId, chatId, messageId) => storageKey('link', accountId, chatId, messageId);
  const messageKey = (chatId, messageId) => `${chatId}/${messageId}`;
  const read = async (key, fallback = null) => await GM_getValue(key, fallback);
  const write = async (key, value) => { await GM_setValue(key, value); };
  const unwrap = data => data && Object.hasOwn(data, 'data') ? data.data : data;
  function report(error, context = '') {
    const message = `${context}: ${error?.message || String(error)}`;
    state.errors.push({ time: new Date().toISOString(), message });
    if (state.errors.length > 12) state.errors.shift();
    console.warn('[Crack:ProfileLocalImages]', message);
  }
  const guard = (fn, context = '') => (...args) => {
    try { const p = fn(...args); if (p?.catch) p.catch(e => report(e, context)); return p; }
    catch (e) { report(e, context); }
  };
  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key === 'style') node.style.cssText = value;
      else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, onClick, cls = 'cpi-button') {
    const node = el('button', { type: 'button', class: cls }, label);
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); guard(onClick, label)(event); });
    return node;
  }
  function visible(node) {
    return !!node?.isConnected && !node.closest('[hidden],[aria-hidden="true"]') && node.getClientRects().length > 0;
  }
  function notify(text, onceKey) {
    if (onceKey && state.notices.has(onceKey)) return;
    if (onceKey) state.notices.add(onceKey);
    if (!document.body) { console.info('[Crack:ProfileLocalImages]', text); return; }
    let region = document.getElementById('cpi-toast');
    if (!region) {
      region = el('div', { id: 'cpi-toast', [OWNER]: '', role: 'status', 'aria-live': 'polite' });
      document.body.append(region); bindTheme(region);
    }
    region.textContent = text;
    clearTimeout(region._cpiTimer);
    region._cpiTimer = setTimeout(() => region.remove(), 5500);
  }
  const emptyCatalog = (accountId, profileId) => ({ schema: 1, accountId, profileId, revision: '', images: [] });
  function validCatalog(value, accountId, profileId) {
    if (!value) return emptyCatalog(accountId, profileId);
    if (value.schema !== 1 || value.accountId !== accountId || value.profileId !== profileId || !Array.isArray(value.images)) {
      throw new Error('이미지 설정의 저장 형식이 다릅니다. 기존 데이터는 덮어쓰지 않았습니다.');
    }
    return value;
  }

  // ---------------------------------------------------------------------------
  // SDK loader: isolated exports; cache on success; all our API calls are GET-only.
  // ---------------------------------------------------------------------------
  function requestSDK(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, anonymous: true, timeout: 15000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) return reject(new Error(`SDK HTTP ${response.status}`));
          const source = response.responseText;
          if (typeof source !== 'string' || source.length < 100 || source.length > 1500000 || /^\s*</.test(source)) {
            return reject(new Error('SDK 응답이 JavaScript 파일이 아닙니다.'));
          }
          resolve(source);
        },
        onerror: () => reject(new Error('SDK 다운로드에 실패했습니다.')),
        ontimeout: () => reject(new Error('SDK 다운로드 시간이 초과되었습니다.')),
      });
    });
  }
  function evaluateSDK(source, exportName) {
    // The user's own repository is trusted executable code, not data.
    // Do not replace this URL with an untrusted third-party script URL.
    const scope = { document, location: PAGE.location, fetch: readOnlyFetch };
    const fn = new Function('globalThis', 'window', 'document', `${source}\nreturn globalThis[${JSON.stringify(exportName)}];`);
    const value = fn(scope, scope, document);
    if (!value || typeof value !== 'object') throw new Error(`${exportName} 내보내기를 찾지 못했습니다.`);
    return value;
  }
  async function loadSDKFile(file, exportName) {
    const key = storageKey('sdk', CONFIG.sdkRef, file);
    const cached = await read(key);
    if (cached?.source && Date.now() - cached.at < CONFIG.sdkCacheMs) {
      try { return evaluateSDK(cached.source, exportName); } catch (e) { report(e, 'SDK 캐시'); }
    }
    const url = `https://raw.githubusercontent.com/workforomg/Utill/${CONFIG.sdkRef}/dist/${file}`;
    try {
      const source = await requestSDK(url);
      const value = evaluateSDK(source, exportName);
      await write(key, { at: Date.now(), source });
      return value;
    } catch (e) {
      if (cached?.source) {
        const value = evaluateSDK(cached.source, exportName);
        notify('SDK 다운로드에 실패해 마지막으로 저장된 SDK를 사용합니다.', 'sdk-cache-fallback');
        return value;
      }
      throw e;
    }
  }
  function apiURL(value) {
    try { const u = new URL(value, PAGE.location.href); return u.origin === API_ORIGIN ? u : null; }
    catch { return null; }
  }
  function readPathAllowed(path) {
    return /^\/crack-api\/profiles(?:\/[^/]+\/chat-profiles)?\/?$/.test(path) ||
      /^\/crack-gen\/(?:v3\/chats|character-chats)\/[^/]+(?:\/messages(?:\/[^/]+)?)?\/?$/.test(path);
  }
  async function readOnlyFetch(input, init = {}) {
    const url = apiURL(typeof input === 'string' ? input : input?.url);
    if (!url || !readPathAllowed(url.pathname) || String(init.method || 'GET').toUpperCase() !== 'GET' || init.body != null) {
      throw new Error('로컬 이미지 기능에서는 조회 외 API 요청이 차단됩니다.');
    }
    return nativeFetch(url.href, { ...init, method: 'GET', credentials: 'include' });
  }
  function tokenFromCookie() {
    const part = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('access_token='));
    if (!part) return '';
    try { return decodeURIComponent(part.slice(13)); } catch { return part.slice(13); }
  }
  async function readOnlyRequest(path, options = {}) {
    if (String(options.method || 'GET').toUpperCase() !== 'GET' || options.body != null) throw new Error('GET만 허용됩니다.');
    const url = new URL(path, API_ORIGIN);
    if (url.origin !== API_ORIGIN || !readPathAllowed(url.pathname)) throw new Error('허용되지 않은 조회 경로입니다.');
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers = { Accept: 'application/json', platform: 'web', 'wrtn-locale': 'ko-KR', ...state.headers };
    const token = tokenFromCookie();
    if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15000);
    try {
      const response = await readOnlyFetch(url.href, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`프로필/메시지 조회 HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }

  // ---------------------------------------------------------------------------
  // Account/profile identity. Never substitute display names for persistent IDs.
  // ---------------------------------------------------------------------------
  function parseLocalRoute() {
    if (state.sdk?.UI?.parseRoute) return state.sdk.UI.parseRoute(PAGE.location.pathname);
    let m = /^\/(stories|characters)\/([^/]+)\/(episodes|chats)\/([^/]+)\/?$/.exec(PAGE.location.pathname);
    if (m) return { kind: m[1] === 'stories' ? 'story' : 'character', chatId: m[4], contentId: m[2] };
    m = /^\/u\/([^/]+)\/c\/([^/]+)\/?$/.exec(PAGE.location.pathname);
    return m ? { kind: 'story', chatId: m[2], contentId: m[1] } : { kind: 'other', chatId: null };
  }
  function isChat() { return ['story', 'character'].includes(state.route.kind) && !!state.route.chatId; }
  function acceptMe(payload) {
    let value = unwrap(payload);
    value = value?.profile || value;
    const accountId = id(value?._id);
    if (!accountId) return false;
    if (accountId === state.accountId) return true;
    const previousAccount = state.accountId;
    state.accountId = accountId;
    if (previousAccount) {
      state.chats.clear(); state.messages.clear();
      state.profileId = null; state.profileKnown = false;
      for (const tx of state.pending.values()) clearTimeout(tx.timer);
      state.pending.clear(); state.modal?.close(true);
    }
    state.profiles.clear();
    state.links.clear();
    detachLinkListeners();
    state.catalog = null; state.catalogKey = '';
    state.selected = null; state.selectionVersion++;
    state.edits.clear();
    state.composerSignature = '';
    if (state.profileLists.has(accountId)) acceptProfiles(accountId, state.profileLists.get(accountId));
    scheduleRefresh();
    return true;
  }
  function acceptProfiles(accountId, payload) {
    const value = unwrap(payload);
    const list = Array.isArray(value?.chatProfiles) ? value.chatProfiles : Array.isArray(value) ? value : null;
    if (!list) return;
    state.profileLists.set(accountId, payload);
    if (accountId !== state.accountId) return;
    state.profiles = new Map(list.filter(p => id(p?._id)).map(p => [p._id, { ...p, name: String(p.name || '이름 없는 프로필') }]));
    scheduleRefresh();
  }
  function acceptChat(chatId, payload, capturedVersion = null) {
    const version = state.profileVersion.get(chatId) || 0;
    if (capturedVersion !== null && capturedVersion !== version) return;
    let chat = unwrap(payload); chat = chat?.chat || chat;
    if (!chat || typeof chat !== 'object' || (chat._id && chat._id !== chatId)) return;
    let profileId, known = false;
    if (Object.hasOwn(chat, 'chatProfile')) {
      known = true; profileId = id(chat.chatProfile?._id) || id(chat.chatProfile);
    } else if (Object.hasOwn(chat, 'chatProfileId')) {
      known = true; profileId = id(chat.chatProfileId);
    }
    if (!known) return;
    if (chat.chatProfile?._id && !state.profiles.has(chat.chatProfile._id)) {
      const p = chat.chatProfile;
      state.profiles.set(p._id, { ...p, name: p.name || '대화 프로필' });
    }
    state.chats.set(chatId, { profileId: profileId || null, known: true, at: Date.now() });
    if (chatId === state.route.chatId) applyChatProfile(profileId || null, true);
  }
  function applyChatProfile(profileId, known) {
    if (state.profileId !== profileId || state.profileKnown !== known) {
      state.profileId = profileId; state.profileKnown = known;
      state.selected = null; state.selectionVersion++;
      state.catalog = null; state.catalogKey = '';
      state.composerSignature = '';
    }
    scheduleRefresh();
  }
  async function ensureMe() {
    if (state.accountId) return state.accountId;
    if (!state.mePromise) {
      state.mePromise = state.profilesAPI.me().then(result => {
        if (!acceptMe(result)) throw new Error('내 계정 프로필 ID를 확인하지 못했습니다.');
        return state.accountId;
      }).finally(() => { state.mePromise = null; });
    }
    return state.mePromise;
  }
  async function ensureProfiles(force = false) {
    if (!state.ready) throw new Error('SDK를 아직 준비 중입니다.');
    const accountId = await ensureMe();
    if (!force && state.profileLists.has(accountId)) return;
    if (!state.profilesPromise) state.profilesPromise = state.profilesAPI.chatProfiles({ profileId: accountId })
      .then(value => acceptProfiles(accountId, value)).finally(() => { state.profilesPromise = null; });
    await state.profilesPromise;
  }
  async function ensureCatalog() {
    if (!state.accountId || !state.profileId) return;
    const key = profileKey(state.accountId, state.profileId);
    if (state.catalogKey === key) return;
    state.catalogKey = key;
    const accountId = state.accountId, profileId = state.profileId;
    let value;
    try { value = validCatalog(await read(key), accountId, profileId); }
    catch (e) { if (state.catalogKey === key) state.catalogKey = ''; throw e; }
    if (state.catalogKey !== key) return;
    state.catalog = value;
    if (state.catalogListener != null && typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(state.catalogListener);
    state.catalogListener = typeof GM_addValueChangeListener === 'function' ? GM_addValueChangeListener(key, (_k, _old, next) => {
      if (state.catalogKey !== key) return;
      try {
        state.catalog = validCatalog(next, accountId, profileId);
        if (state.selected && !state.catalog.images.some(img => img.id === state.selected.id)) state.selected = null;
        state.composerSignature = ''; scheduleRefresh();
      } catch (e) { report(e, '다른 탭의 이미지 설정'); }
    }) : null;
    state.composerSignature = ''; scheduleRefresh();
  }
  function hydrateChat() {
    const key = `${state.epoch}/${state.route.kind}/${state.route.chatId}`;
    if (state.hydratePromise && state.hydrateKey === key) return state.hydratePromise;
    state.hydrateKey = key;
    const promise = hydrateChatInner().finally(() => {
      if (state.hydrateKey === key) state.hydratePromise = null;
    });
    state.hydratePromise = promise; return promise;
  }
  async function hydrateChatInner() {
    if (!state.ready || !isChat()) return;
    const epoch = state.epoch, chatId = state.route.chatId, kind = state.route.kind;
    const version = state.profileVersion.get(chatId) || 0;
    state.lastHydrate = Date.now();
    try {
      await ensureMe();
      const value = kind === 'story' ? await state.api.chat.get(chatId) :
        unwrap(await readOnlyRequest(`/crack-gen/character-chats/${encodeURIComponent(chatId)}`));
      acceptChat(chatId, value, version);
      if (epoch !== state.epoch) return;
      if (!state.profileKnown) notify('이 세션의 적용 대화 프로필을 확인하지 못했습니다. 대화 프로필 메뉴를 한 번 열어 주세요.', `profile-unknown-${epoch}`);
      await ensureProfiles();
      await ensureCatalog();
    } catch (e) {
      report(e, '세션 확인');
      if (epoch === state.epoch && !state.profileKnown) notify('대화 프로필 자동 확인에 실패했습니다. 로그인 상태와 진단 정보를 확인해 주세요.', `hydrate-${epoch}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Passive network observers. Native payloads/return values are left untouched.
  // ---------------------------------------------------------------------------
  function toPage(fn) {
    try { return typeof exportFunction === 'function' ? exportFunction(fn, PAGE) : fn; } catch { return fn; }
  }
  function classifyHTTP(method, value) {
    const url = apiURL(value); if (!url) return null;
    const path = url.pathname.replace(/\/$/, '');
    if (path === '/crack-api/profiles' && method === 'GET') return { kind: 'me', url };
    let m = /^\/crack-api\/profiles\/([^/]+)\/chat-profiles(?:\/([^/]+))?$/.exec(path);
    if (m) return { kind: m[2] ? 'profile-item' : 'profiles', accountId: decodeURIComponent(m[1]), url };
    m = /^\/crack-gen\/(?:v3\/chats|character-chats)\/([^/]+)(?:\/messages(?:\/([^/]+))?)?$/.exec(path);
    if (m) return { kind: path.includes('/messages') ? (m[2] ? 'message' : 'messages') : 'chat', chatId: m[1], messageId: m[2] || null, url };
    if (url.pathname.includes('/socket.io') && url.searchParams.get('transport') === 'polling') return { kind: 'polling', url };
    return null;
  }
  function rememberHeaders(headers, url) {
    if (!apiURL(url) || !headers) return;
    try {
      new Headers(headers).forEach((value, key) => {
        if (key.toLowerCase() === 'authorization') state.headers.Authorization = value;
        else if (/^x-wrtn-(?:platform|device-id|app-version)$/i.test(key)) state.headers[key] = value;
      });
    } catch { /* Never interfere with the site's network on invalid headers. */ }
  }
  function parseBody(body) {
    if (typeof body !== 'string' || body.length > 1000000) return null;
    try { return JSON.parse(body); } catch { return null; }
  }
  function startHTTP(method, url, body) {
    const info = classifyHTTP(method, url); if (!info) return null;
    const tx = { ...info, method, body: parseBody(body), at: Date.now(), version: state.profileVersion.get(info.chatId) || 0, edit: null };
    if (info.kind === 'polling' && method === 'POST' && typeof body === 'string') {
      for (const packet of socketPackets(body)) handleSocketOut(packet, 'polling');
    }
    if (info.kind === 'message' && method === 'PATCH') {
      const edit = state.edits.get(messageKey(info.chatId, info.messageId));
      if (edit && edit.accountId === state.accountId) {
        tx.edit = {
          key: linkKey(edit.accountId, edit.chatId, edit.messageId), accountId: edit.accountId,
          chatId: edit.chatId, messageId: edit.messageId, profileId: edit.profileId,
          image: edit.selected ? { ...edit.selected } : null, token: edit.token,
        };
        edit.inFlight++; state.httpEdits.set(tx.edit.key, tx.edit);
      }
    }
    return tx;
  }
  function successfulBody(payload) {
    if (payload == null) return true;
    return !payload.error && payload.success !== false && !['fail', 'failed', 'error'].includes(String(payload.result || '').toLowerCase());
  }
  async function finishHTTP(tx, status, payload) {
    if (!tx || tx.finished) return;
    tx.finished = true;
    if (tx.kind === 'polling') {
      if (status >= 200 && status < 300 && typeof payload === 'string') for (const packet of socketPackets(payload)) handleSocketIn(packet, 'polling');
      return;
    }
    const ok = status >= 200 && status < 300 && successfulBody(payload);
    if (tx.edit) {
      const snapshot = tx.edit;
      const edit = state.edits.get(messageKey(snapshot.chatId, snapshot.messageId));
      if (edit?.token === snapshot.token) edit.inFlight = Math.max(0, edit.inFlight - 1);
      state.httpEdits.delete(snapshot.key);
      if (ok) {
        await saveLink(snapshot.accountId, snapshot.chatId, snapshot.messageId, snapshot.profileId, snapshot.image);
        state.counters.editSaved++;
        if (edit?.token === snapshot.token) edit.committed = true;
      } else {
        state.counters.editFailed++;
        notify('메시지 수정이 실패해 기존 이미지를 유지했습니다.');
      }
      scheduleRefresh();
    }
    if (!ok) return;
    if (tx.kind === 'me') acceptMe(payload);
    if (tx.kind === 'profiles' && tx.method === 'GET') acceptProfiles(tx.accountId, payload);
    if ((tx.kind === 'profiles' || tx.kind === 'profile-item') && tx.method !== 'GET' && state.ready && tx.accountId === state.accountId) {
      ensureProfiles(true).catch(e => report(e, '프로필 목록 갱신'));
    }
    if (tx.kind === 'chat') {
      if (tx.method === 'PATCH' && tx.body && Object.hasOwn(tx.body, 'chatProfileId')) {
        state.profileVersion.set(tx.chatId, (state.profileVersion.get(tx.chatId) || 0) + 1);
        const profileId = id(tx.body.chatProfileId);
        state.chats.set(tx.chatId, { profileId, known: true, at: Date.now() });
        if (tx.chatId === state.route.chatId) applyChatProfile(profileId, true);
        acceptChat(tx.chatId, payload);
      } else acceptChat(tx.chatId, payload, tx.version);
    }
    if (tx.kind === 'message' && tx.method === 'DELETE') {
      if (state.accountId) await saveLink(state.accountId, tx.chatId, tx.messageId, null, null);
    } else if (tx.kind === 'messages' || tx.kind === 'message') {
      const data = unwrap(payload);
      const list = Array.isArray(data?.messages) ? data.messages : data?._id ? [data] : [];
      for (const message of list) observeMessage(tx.chatId, message, false);
    }
  }
  function installHooks() {
    try {
      if (PAGE.fetch) {
        const original = PAGE.fetch;
        PAGE.fetch = toPage(function(input, init) {
          let tx = null;
          try {
            const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
            const method = String(init?.method || input?.method || 'GET').toUpperCase();
            rememberHeaders(init?.headers || input?.headers, url);
            tx = startHTTP(method, url, init?.body);
            if (tx && !init?.body && input?.clone && method !== 'GET') {
              // Snapshot edit identity synchronously above; body is observation-only.
              input.clone().text().then(text => { tx.body = parseBody(text); }).catch(() => {});
            }
          } catch (e) { report(e, 'fetch 관찰'); }
          let promise;
          try { promise = Reflect.apply(original, this, arguments); }
          catch (e) { if (tx) finishHTTP(tx, 0, null).catch(() => {}); throw e; }
          if (tx) promise.then(response => {
            const size = Number(response.headers.get('content-length') || 0);
            if (size > 8000000) return;
            return response.clone().text().then(text => {
              let payload = tx.kind === 'polling' ? text : parseBody(text);
              return finishHTTP(tx, response.status, payload);
            });
          }, () => finishHTTP(tx, 0, null)).catch(e => report(e, 'fetch 응답 관찰'));
          return promise;
        });
        state.hooks.fetch = true;
      }
    } catch (e) { report(e, 'fetch 연결'); }
    try {
      const proto = PAGE.XMLHttpRequest?.prototype;
      if (proto) {
        const open = proto.open, send = proto.send, setHeader = proto.setRequestHeader;
        const records = new WeakMap();
        proto.open = toPage(function(method, url) {
          records.set(this, { method: String(method).toUpperCase(), url: String(url), headers: {} });
          return Reflect.apply(open, this, arguments);
        });
        proto.setRequestHeader = toPage(function(name, value) {
          const meta = records.get(this);
          if (meta) { meta.headers[name] = value; rememberHeaders(meta.headers, meta.url); }
          return Reflect.apply(setHeader, this, arguments);
        });
        proto.send = toPage(function(body) {
          const meta = records.get(this);
          const tx = meta ? startHTTP(meta.method, meta.url, body) : null;
          if (tx) this.addEventListener('loadend', () => {
            try {
              const payload = this.responseType === 'json' ? this.response : tx.kind === 'polling' ? this.responseText : parseBody(this.responseText);
              finishHTTP(tx, this.status, payload).catch(e => report(e, 'XHR 후처리'));
            } catch (e) { report(e, 'XHR 응답 관찰'); }
          }, { once: true });
          try { return Reflect.apply(send, this, arguments); }
          catch (e) { if (tx) finishHTTP(tx, 0, null).catch(() => {}); throw e; }
        });
        state.hooks.xhr = true;
      }
    } catch (e) { report(e, 'XHR 연결'); }
    try {
      const proto = PAGE.WebSocket?.prototype;
      if (proto) {
        const send = proto.send, watched = new WeakSet(), socketIds = new WeakMap();
        let nextSocket = 0;
        proto.send = toPage(function(data) {
          let relevant = false, socketId;
          try {
            const u = new URL(this.url);
            relevant = /(^|\.)wrtn\.ai$/i.test(u.hostname) && /socket\.io/.test(u.pathname);
            if (relevant) {
              if (!watched.has(this)) {
                watched.add(this); socketIds.set(this, `ws-${++nextSocket}`);
                this.addEventListener('message', event => {
                  if (typeof event.data !== 'string') return;
                  const text = event.data;
                  // Ignore character-by-character AI streaming before JSON parsing.
                  if (!text.startsWith('43') && !/"(?:userMessageCreated|generationError|exception)"/.test(text)) return;
                  for (const packet of socketPackets(text)) guard(handleSocketIn, '소켓 수신')(packet, socketIds.get(this));
                });
              }
              socketId = socketIds.get(this);
            }
          } catch (e) { report(e, '소켓 관찰'); }
          const captured = [];
          if (relevant && typeof data === 'string') for (const packet of socketPackets(data)) {
            const tx = guard(handleSocketOut, '소켓 전송 관찰')(packet, socketId); if (tx) captured.push(tx);
          }
          try { return Reflect.apply(send, this, arguments); }
          catch (e) { captured.forEach(tx => failPending(tx, '전송 실패: 기존 선택을 유지했습니다.')); throw e; }
        });
        state.hooks.websocket = true;
      }
    } catch (e) { report(e, 'WebSocket 연결'); }
  }
  function socketPackets(text) {
    if (typeof text !== 'string' || text.length > 2000000) return [];
    const result = [];
    for (const raw of text.split('\x1e')) {
      if (!/^4[23]/.test(raw)) continue;
      const bracket = raw.indexOf('['); if (bracket < 2) continue;
      let head = raw.slice(2, bracket), namespace = '/';
      if (head.startsWith('/')) {
        const comma = head.lastIndexOf(','); if (comma < 0) continue;
        namespace = head.slice(0, comma); head = head.slice(comma + 1);
      }
      if (!/^\d*$/.test(head)) continue;
      try {
        const data = JSON.parse(raw.slice(bracket));
        if (Array.isArray(data)) result.push({ type: raw[1], namespace, ack: head, data });
      } catch { /* Other socket packets are not ours. */ }
    }
    return result;
  }
  function handleSocketOut(packet, socketId) {
    if (packet.type !== '2' || packet.data[0] !== 'send') return null;
    const body = packet.data[1];
    if (!body || typeof body.message !== 'string' || !id(body.chatId)) return null;
    if (body.chatId !== state.route.chatId || !state.accountId || !state.profileKnown || !state.selected) return null;
    const ackKey = packet.ack ? `${socketId}/${packet.namespace}/${packet.ack}` : null;
    if (ackKey && [...state.pending.values()].some(p => p.ackKey === ackKey)) return null;
    const tx = {
      txId: uuid(), ackKey, socketId, namespace: packet.namespace,
      accountId: state.accountId, chatId: body.chatId, profileId: state.profileId,
      image: { ...state.selected }, text: norm(body.message), sentAt: Date.now(),
      selectionVersion: state.selectionVersion, committing: false,
      baselineIds: new Set(state.messages.keys()),
    };
    tx.timer = setTimeout(() => failPending(tx, '확정된 유저 메시지를 확인하지 못해 이미지를 연결하지 않았습니다. 선택은 유지됩니다.'), CONFIG.pendingMs);
    state.pending.set(tx.txId, tx); state.counters.sends++;
    return tx;
  }
  function handleSocketIn(packet, socketId) {
    if (packet.type === '3') {
      const ackKey = `${socketId}/${packet.namespace}/${packet.ack}`;
      const pending = [...state.pending.values()].find(tx => tx.ackKey === ackKey);
      if (!pending) return;
      const value = packet.data.length === 1 ? packet.data[0] : packet.data;
      if (value?.error || value?.success === false || Number(value?.statusCode) >= 400) {
        failPending(pending, '채팅 전송이 실패해 이미지 선택을 유지했습니다.');
      }
      // An ACK only means acceptance. Never treat it as a created message.
      return;
    }
    const [event, envelope] = packet.data;
    if (event === 'userMessageCreated') {
      const message = unwrap(envelope);
      if (!id(message?._id) || !id(message?.chatId) || message.role !== 'user') return;
      state.counters.created++;
      observeMessage(message.chatId, message, true, { socketId, namespace: packet.namespace });
    }
    if (event === 'generationError' || event === 'exception') {
      const value = unwrap(envelope), chatId = id(value?.chatId) || id(envelope?.chatId);
      // Without a chat ID, do not invalidate an unrelated in-flight send.
      if (chatId) for (const tx of state.pending.values()) if (tx.chatId === chatId && tx.socketId === socketId) {
        failPending(tx, '생성 오류가 발생해 미확정 이미지 연결을 취소했습니다.');
      }
    }
  }
  function failPending(tx, text) {
    if (!state.pending.has(tx.txId) || tx.committing) return;
    state.pending.delete(tx.txId); clearTimeout(tx.timer);
    if (tx.chatId === state.route.chatId && tx.accountId === state.accountId) notify(text);
  }
  function observeMessage(chatId, message, live = false, source = {}) {
    if (!id(message?._id) || message._id === 'temp' || !['user', 'assistant', 'supermode', 'system'].includes(message.role)) return;
    if (message.chatId && message.chatId !== chatId) return;
    const key = messageKey(chatId, message._id), seen = state.messages.has(key);
    state.messages.set(key, { id: message._id, chatId, role: message.role });
    if (state.messages.size > 3000) state.messages.delete(state.messages.keys().next().value);
    if (message.role !== 'user') return;
    const now = Date.now();
    const candidates = [...state.pending.values()].filter(tx => {
      if (tx.committing || tx.baselineIds.has(key) || tx.chatId !== chatId || norm(message.content) !== tx.text || now - tx.sentAt > CONFIG.pendingMs) return false;
      if (live) return (tx.socketId === source.socketId || tx.socketId === 'polling') && tx.namespace === source.namespace;
      const created = Date.parse(message.createdAt || '');
      return !seen && Number.isFinite(created) && created >= tx.sentAt - 2000 && created <= now + 10000;
    });
    // Repeated text is never mapped to an arbitrary row; ambiguous matches stay pending.
    if (candidates.length === 1) {
      const tx = candidates[0]; tx.committing = true; clearTimeout(tx.timer);
      saveLink(tx.accountId, chatId, message._id, tx.profileId, tx.image).then(() => {
        state.pending.delete(tx.txId); state.counters.linked++;
        if (state.accountId === tx.accountId && state.route.chatId === chatId && state.selectionVersion === tx.selectionVersion) {
          state.selected = null; state.selectionVersion++; state.composerSignature = '';
        }
        scheduleRefresh();
      }).catch(error => {
        tx.committing = false; state.pending.delete(tx.txId);
        report(error, '이미지 연결 저장'); notify('이미지 연결을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');
      });
    }
    scheduleRefresh();
  }

  // ---------------------------------------------------------------------------
  // Local persistence. Original image bytes are stored only in userscript storage.
  // ---------------------------------------------------------------------------
  async function saveLink(accountId, chatId, messageId, profileId, image) {
    const key = linkKey(accountId, chatId, messageId);
    const value = image ? {
      schema: 1, accountId, chatId, messageId, profileId,
      image: { ...image }, updatedAt: Date.now(),
    } : null;
    // Null is a tombstone so another open tab also removes the image.
    await write(key, value);
    if (accountId === state.accountId) state.links.set(key, value);
    scheduleRefresh();
  }
  function detachLinkListeners() {
    if (typeof GM_removeValueChangeListener === 'function') for (const listener of state.linkListeners.values()) GM_removeValueChangeListener(listener);
    state.linkListeners.clear();
  }
  async function getLink(chatId, messageId) {
    const accountId = state.accountId; if (!accountId) return null;
    const key = linkKey(accountId, chatId, messageId);
    if (!state.links.has(key)) {
      const value = await read(key);
      if (accountId !== state.accountId) return null;
      if (value && (value.accountId !== accountId || value.chatId !== chatId || value.messageId !== messageId || value.schema !== 1)) {
        report(new Error('메시지 연결 식별자가 다릅니다.'), '로컬 저장소'); state.links.set(key, null);
      } else state.links.set(key, value);
    }
    if (!state.linkListeners.has(key) && typeof GM_addValueChangeListener === 'function') {
      state.linkListeners.set(key, GM_addValueChangeListener(key, (_k, _old, next) => {
        if (state.accountId !== accountId) return;
        state.links.set(key, next); scheduleRefresh();
      }));
    }
    return state.links.get(key);
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.')); reader.readAsDataURL(file);
    });
  }
  async function makeImageDraft(file) {
    const mime = file.type.toLowerCase();
    if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(mime)) throw new Error(`${file.name}: PNG/JPG/GIF/WebP/AVIF만 지원합니다.`);
    if (file.size === 0 || file.size > CONFIG.maxFileBytes) throw new Error(`${file.name}: 이미지 한 장은 20MB 이하이어야 합니다.`);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${file.name}: 이미지 읽기 시간 초과`)), 15000);
        image.onload = () => { clearTimeout(timer); resolve(); };
        image.onerror = () => { clearTimeout(timer); reject(new Error(`${file.name}: 브라우저가 이 이미지를 읽지 못했습니다.`)); };
        image.src = url;
      });
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width * height > CONFIG.maxPixels || width > CONFIG.maxSide || height > CONFIG.maxSide) {
        throw new Error(`${file.name}: 너무 큰 이미지입니다. 크기를 줄인 뒤 불러와 주세요.`);
      }
      const scale = Math.min(1, 160 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('미리보기를 만들 수 없습니다.');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const thumb = canvas.toDataURL('image/webp', 0.78);
      image.removeAttribute('src'); canvas.width = 1; canvas.height = 1;
      return {
        id: uuid(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || '이미지',
        width, height, mime, size: file.size, thumb, createdAt: Date.now(), _file: file,
      };
    } finally { URL.revokeObjectURL(url); }
  }
  function dataURLToBlob(dataURL) {
    if (typeof dataURL !== 'string' || !/^data:image\/(png|jpeg|gif|webp|avif);base64,/.test(dataURL)) throw new Error('저장된 이미지 형식이 올바르지 않습니다.');
    const comma = dataURL.indexOf(','), type = dataURL.slice(5, dataURL.indexOf(';'));
    const raw = atob(dataURL.slice(comma + 1));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  function publicImage(image) {
    const { _file, ...meta } = image; return meta;
  }
  async function saveCatalogDraft(modal) {
    const { accountId, profileId } = modal;
    if (state.accountId !== accountId) throw new Error('로그인 계정이 바뀌어 저장을 중단했습니다.');
    const key = profileKey(accountId, profileId);
    const save = async () => {
      const current = validCatalog(await read(key), accountId, profileId);
      if (current.revision !== modal.baseRevision) throw new Error('다른 탭에서 이미지 설정이 변경되었습니다. 창을 다시 열어 확인해 주세요.');
      for (const image of modal.images) {
        if (!String(image.name).trim()) throw new Error('모든 이미지의 이름을 입력해 주세요.');
        if (image._file) {
          // No fetch, XHR, FormData, or upload endpoint is used for image files.
          const dataURL = await readFile(image._file);
          await write(storageKey('asset', accountId, image.id), { schema: 1, mime: image.mime, dataURL });
        }
      }
      // Metadata is committed last. A failed asset write never replaces the catalog.
      const next = {
        schema: 1, accountId, profileId, revision: uuid(), updatedAt: Date.now(),
        images: modal.images.map(image => ({ ...publicImage(image), name: image.name.trim().slice(0, 80) })),
      };
      await write(key, next);
      if (state.accountId === accountId && state.profileId === profileId) {
        state.catalog = next; state.catalogKey = key; state.composerSignature = '';
      }
      return next;
    };
    if (navigator.locks?.request) return navigator.locks.request(`cpi:${key}`, save);
    return save();
  }

  // ---------------------------------------------------------------------------
  // UI. Styles follow Crack's actual surface/text/outline variables.
  // ---------------------------------------------------------------------------
  const themeRoots = new Map();
  const themeTargets = new Set();
  const themeMedia = matchMedia('(prefers-color-scheme: dark)');
  let themeFrame = 0;
  const themeTokens = [
    '--bg_screen', '--bg_elevated_primary', '--bg_elevated_secondary', '--bg_dimmed',
    '--surface_elevated', '--surface_tertiary', '--surface_brand_primary',
    '--text_primary', '--text_secondary', '--text_white', '--text_brand',
    '--text_negative', '--outline_tertiary', '--state_hover',
  ];
  function currentTheme(source) {
    // The site's explicit mode takes precedence over the operating-system mode.
    for (let node = source; node; node = node.parentElement) {
      for (const key of ['data-theme', 'data-mode', 'data-color-mode']) {
        const value = node.getAttribute?.(key)?.toLowerCase();
        if (value === 'light' || value === 'dark') return value;
      }
      if (node.classList?.contains('dark') || node.classList?.contains('theme-dark')) return 'dark';
      if (node.classList?.contains('light') || node.classList?.contains('theme-light')) return 'light';
    }
    return themeMedia.matches ? 'dark' : 'light';
  }
  function syncTheme(root, source) {
    const base = source?.isConnected && !own(source) ? source : document.body || document.documentElement;
    if (!base) return;
    const mode = currentTheme(base), css = getComputedStyle(base);
    root.setAttribute('data-cpi-theme', mode);
    root.style.setProperty('--cpi-scheme', mode);
    // A native dialog may be inside a scoped theme while our <dialog> is in body.
    // Copy the resolved tokens, not the native element's text or inverse surface.
    for (const token of themeTokens) {
      const value = css.getPropertyValue(token).trim();
      if (value) root.style.setProperty(token, value);
      else root.style.removeProperty(token);
    }
    observeThemeAncestors(base);
  }
  function scheduleThemeRefresh() {
    if (themeFrame) return;
    themeFrame = requestAnimationFrame(() => {
      themeFrame = 0;
      for (const [root, source] of themeRoots) {
        if (!root.isConnected) { themeRoots.delete(root); continue; }
        syncTheme(root, source);
      }
      // Do not retain disconnected native dialogs in a long-running session.
      if ([...themeTargets].some(node => !node.isConnected)) {
        const live = [...themeTargets].filter(node => node.isConnected);
        themeObserver.disconnect(); themeTargets.clear();
        for (const node of live) observeThemeAncestors(node);
      }
    });
  }
  const themeObserver = new MutationObserver(scheduleThemeRefresh);
  function observeThemeAncestors(source) {
    for (let node = source; node; node = node.parentElement) {
      if (themeTargets.has(node) || own(node)) continue;
      themeObserver.observe(node, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-mode', 'data-color-mode'],
      });
      themeTargets.add(node);
    }
  }
  function bindTheme(root, source = null) {
    themeRoots.set(root, source);
    syncTheme(root, source);
  }
  themeMedia.addEventListener?.('change', scheduleThemeRefresh);

  function installStyles() {
    if (document.getElementById('cpi-style')) return;
    const style = el('style', { id: 'cpi-style', [OWNER]: '' });
    style.textContent = `
      [${OWNER}], [${OWNER}] * { box-sizing:border-box; }
      .cpi-panel,.cpi-strip,.cpi-message-picture,#cpi-toast { --cpi-bg:#fff;--cpi-bg2:#f4f4f2;--cpi-fg:#242421;--cpi-dim:#73736e;--cpi-line:#dddcd8;--cpi-accent:#ff6535; }
      .cpi-panel[data-cpi-theme="dark"],.cpi-strip[data-cpi-theme="dark"],.cpi-message-picture[data-cpi-theme="dark"],#cpi-toast[data-cpi-theme="dark"] { --cpi-bg:#252523;--cpi-bg2:#343430;--cpi-fg:#f7f7f2;--cpi-dim:#b3b3a9;--cpi-line:#494943; }
      .cpi-panel { color:var(--text_primary,var(--cpi-fg));background:var(--bg_elevated_primary,var(--surface_elevated,var(--cpi-bg)));font-family:inherit;color-scheme:var(--cpi-scheme,light); }
      dialog.cpi-panel { position:fixed;inset:0;margin:auto;width:min(444px,calc(100vw - 32px));max-width:444px;max-height:86vh;max-height:86dvh;padding:0;border:1px solid var(--outline_tertiary,var(--cpi-line));border-radius:20px;overflow:hidden;box-shadow:0 18px 70px #0005;pointer-events:auto;z-index:2147483646; }
      dialog.cpi-panel[open] { display:flex;flex-direction:column; }
      dialog.cpi-panel::backdrop { background:var(--bg_dimmed,rgba(0,0,0,.6)); }
      .cpi-heading { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 20px 12px;flex-shrink:0; }
      .cpi-heading h2 { font-size:18px;line-height:1.5;font-weight:700;margin:0;color:inherit; }
      .cpi-subtitle { margin:0 20px 16px;font-size:12px;line-height:1.6;color:var(--text_secondary,var(--cpi-dim));white-space:pre-line; }
      .cpi-body { overflow-y:auto;overscroll-behavior:contain;padding:0 20px 16px;min-height:0; }
      .cpi-toolbar { display:flex;gap:8px;align-items:center;margin-bottom:14px; }
      .cpi-button { display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--outline_tertiary,var(--cpi-line,#d8d8d4));border-radius:10px;padding:9px 13px;background:var(--surface_tertiary,var(--bg_elevated_secondary,var(--cpi-bg2,#f4f4f2)));color:var(--text_primary,var(--cpi-fg,#242421));font:inherit;font-size:13px;line-height:1.4;cursor:pointer;white-space:nowrap;min-height:36px; }
      .cpi-button:disabled { opacity:.5;cursor:not-allowed; }
      .cpi-button:focus-visible,.cpi-choice:focus-visible,.cpi-name:focus-visible { outline:2px solid var(--text_brand,var(--cpi-accent,#ff6535));outline-offset:2px; }
      .cpi-primary { background:var(--surface_brand_primary,var(--text_brand,#ff4432));color:var(--text_white,#fff);border-color:transparent;font-weight:600; }
      .cpi-close { min-width:34px;border:0;background:transparent;font-size:20px;padding:4px; }
      .cpi-footer { display:flex;justify-content:flex-end;gap:8px;padding:16px 20px calc(16px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--outline_tertiary,var(--cpi-line));flex-shrink:0; }
      .cpi-list { display:flex;flex-direction:column;gap:12px; }
      .cpi-image-row { display:grid;grid-template-columns:82px minmax(0,1fr);gap:12px;padding:12px;border:1px solid var(--outline_tertiary,var(--cpi-line));border-radius:12px; }
      .cpi-thumb-large { width:82px;height:82px;object-fit:contain;border-radius:8px;background:var(--surface_tertiary,var(--bg_elevated_secondary,var(--cpi-bg2))); }
      .cpi-row-fields { display:flex;flex-direction:column;align-items:flex-start;gap:7px;min-width:0; }
      .cpi-name { width:100%;min-width:0;padding:9px 10px;border-radius:8px;border:1px solid var(--outline_tertiary,var(--cpi-line));color:var(--text_primary,var(--cpi-fg));background:var(--surface_tertiary,var(--bg_elevated_secondary,var(--cpi-bg2)));font:inherit;font-size:13px; }
      .cpi-small,.cpi-empty { font-size:12px;line-height:1.6;color:var(--text_secondary,var(--cpi-dim)); }
      .cpi-empty { padding:22px 6px;text-align:center; }
      .cpi-remove { padding:2px 7px;min-height:26px;font-size:12px; }
      .cpi-error { color:var(--text_negative,#d94632);white-space:pre-line; }
      /* A fixed compact row; percentage flex-basis must NEVER be used here. */
      [data-cpi-owned].cpi-strip { display:block;flex:0 0 auto;align-self:stretch;width:100%;min-width:0;max-width:100%;height:32px;min-height:32px;max-height:32px;margin:0;padding:0;border:0;background:transparent;overflow:hidden; }
      /* Only a positively identified composer wrapper is compacted. The native
         editor/send toolbar and keyboard safe-area bottom padding are untouched. */
      [data-cpi-compact-composer] { background-color:transparent !important;background-image:none !important;padding-top:0 !important;row-gap:4px !important; }
      /* Linked USER images occupy the entire first row. The native content and
         native menu stay in their original DOM parents, on the second row only. */
      [data-cpi-picture-fill] { box-sizing:border-box !important;width:100% !important;min-width:0 !important;max-width:100% !important;flex-shrink:1 !important; }
      [data-cpi-picture-row] { display:grid !important;grid-template-columns:minmax(0,1fr) auto !important;grid-template-rows:auto auto !important;row-gap:0 !important;align-items:end !important;justify-items:stretch !important; }
      [data-cpi-picture-row] > [data-cpi-owned].cpi-message-picture { grid-column:1 / -1 !important;grid-row:1 !important;align-self:start !important;justify-self:stretch !important; }
      [data-cpi-picture-text] { grid-column:1 !important;grid-row:2 !important;min-width:0 !important;align-self:stretch !important; }
      [data-cpi-picture-menu] { grid-column:2 !important;grid-row:2 !important;align-self:end !important;justify-self:end !important;width:auto !important;min-width:0 !important;max-width:none !important; }
      [data-cpi-owned].cpi-message-picture { display:block;box-sizing:border-box;flex:0 0 auto;width:100% !important;min-width:0 !important;max-width:100% !important;height:auto !important;min-height:0 !important;max-height:none !important;margin:0 0 10px;overflow:hidden;border-radius:12px; }
      [data-cpi-owned].cpi-message-picture > img { display:block !important;box-sizing:border-box;object-fit:contain !important;width:100% !important;min-width:0 !important;max-width:100% !important;height:auto !important;min-height:0 !important;max-height:none !important;aspect-ratio:inherit;margin:0 !important;padding:0 !important;border:0 !important; }
      .cpi-native-action { width:100%;display:flex;align-items:center;gap:8px;padding:9px 12px;color:inherit;background:transparent;border:0;text-align:left;font:inherit;font-size:14px;cursor:pointer;border-radius:6px; }
      .cpi-native-action:hover { background:var(--state_hover,rgba(128,128,128,.12)); }
      #cpi-toast { position:fixed;z-index:2147483647;top:calc(24px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);width:max-content;max-width:min(460px,calc(100vw - 28px));padding:12px 16px;border-radius:12px;background:var(--bg_elevated_primary,var(--cpi-bg,#fff));color:var(--text_primary,var(--cpi-fg,#242421));border:1px solid var(--outline_tertiary,var(--cpi-line,#ddd));box-shadow:0 6px 25px #0004;font:500 13px/1.6 sans-serif;pointer-events:none;text-align:center; }
      @media (max-width:640px) { dialog.cpi-panel { inset:auto 0 0;margin:0;width:100%;max-width:none;max-height:88dvh;border-radius:20px 20px 0 0; } }
      @media (prefers-reduced-motion:reduce) { .cpi-track { scroll-behavior:auto; } }
    `;
    (document.head || document.documentElement).append(style);
  }
  function profileTitle(profileId) {
    return state.profiles.get(profileId)?.name || (profileId ? `프로필 · ${profileId.slice(-6)}` : '대화 프로필');
  }
  function localDialog(title, subtitle = '', themeSource = null) {
    if (state.modal) state.modal.close(true);
    const root = el('dialog', { class: 'cpi-panel', [OWNER]: '', 'aria-label': title });
    const header = el('div', { class: 'cpi-heading' });
    header.append(el('h2', {}, title));
    const desc = el('p', { class: 'cpi-subtitle', id: `cpi-desc-${uuid()}` }, subtitle);
    root.setAttribute('aria-describedby', desc.id);
    const body = el('div', { class: 'cpi-body' });
    const footer = el('div', { class: 'cpi-footer' });
    const modal = { root, body, footer, desc, dirty: false, busy: false, disposed: false };
    modal.close = (force = false) => {
      if (modal.busy && !force) return;
      if (!force && modal.dirty && !PAGE.confirm('저장하지 않은 이미지 설정을 닫을까요?')) return;
      modal.disposed = true; themeRoots.delete(root); root.close(); root.remove(); if (state.modal === modal) state.modal = null;
      modal.onClose?.();
    };
    const close = button('×', () => modal.close(), 'cpi-button cpi-close');
    close.setAttribute('aria-label', '닫기'); header.append(close);
    root.append(header, desc, body, footer);
    root.addEventListener('cancel', event => { event.preventDefault(); modal.close(); });
    root.addEventListener('click', event => {
      if (event.target === root) { const r = root.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) modal.close(); }
    });
    // Keep the underlying Radix dialog/menu from handling these interactions.
    for (const type of ['click', 'pointerdown', 'keydown', 'keyup', 'input', 'change']) root.addEventListener(type, event => event.stopPropagation());
    document.body.append(root); state.modal = modal; bindTheme(root, themeSource); root.showModal();
    return modal;
  }
  async function openManager(profileId, { themeSource = null } = {}) {
    // Mandatory, captured target. Never substitute the active chat's profile.
    // No intermediate profile picker exists in this version.
    profileId = id(profileId);
    if (!profileId) {
      notify('설정할 대화 프로필의 ⋮ 메뉴에서 이미지 설정을 눌러 주세요.');
      return;
    }
    const request = ++state.managerRequest, accountAtOpen = state.accountId;
    try {
      await ensureProfiles();
      if (!state.profiles.has(profileId)) await ensureProfiles(true);
      if (request !== state.managerRequest) return;
      if (accountAtOpen && state.accountId !== accountAtOpen) throw new Error('계정이 바뀌어 이미지 설정을 열지 않았습니다.');
      if (!state.profiles.has(profileId)) throw new Error('선택한 프로필을 확인하지 못했습니다. 해당 프로필의 메뉴를 다시 열어 주세요.');
      const accountId = state.accountId;
      const catalog = validCatalog(await read(profileKey(accountId, profileId)), accountId, profileId);
      if (request !== state.managerRequest || state.accountId !== accountId) return;
      const modal = localDialog('이미지 설정', `${profileTitle(profileId)}\n이 대화 프로필의 이미지를 설정합니다. 이미지와 이름은 이 브라우저에만 저장됩니다.`, themeSource);
      // The target cannot change while the modal is open (even if the session changes).
      Object.defineProperties(modal, { accountId: { value: accountId }, profileId: { value: profileId } });
      modal.root.setAttribute('data-cpi-profile-id', profileId);
      Object.assign(modal, { images: catalog.images.map(image => ({ ...image })), baseRevision: catalog.revision });
      const toolbar = el('div', { class: 'cpi-toolbar' });
      const picker = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif', multiple: '', hidden: '' });
      const count = el('span', { class: 'cpi-small' });
      const add = button('이미지 불러오기', () => picker.click());
      toolbar.append(add, count, picker);
      const list = el('div', { class: 'cpi-list' });
      const error = el('p', { class: 'cpi-small cpi-error', role: 'status' });
      modal.body.append(toolbar, list, error, el('p', { class: 'cpi-small' }, '여러 장을 한 번에 선택할 수 있습니다. 한 장 20MB 이하. 목록에서 빼도 과거 메시지에 연결된 원본은 보존합니다.'));
      const render = () => {
        count.textContent = `${modal.images.length}장`;
        list.replaceChildren();
        if (!modal.images.length) list.append(el('div', { class: 'cpi-empty' }, '이미지를 불러온 뒤 이름을 정해 주세요.'));
        for (const image of modal.images) {
          const row = el('div', { class: 'cpi-image-row' });
          row.append(el('img', { class: 'cpi-thumb-large', src: image.thumb, alt: image.name, loading: 'lazy', decoding: 'async' }));
          const fields = el('div', { class: 'cpi-row-fields' });
          const name = el('input', { class: 'cpi-name', type: 'text', maxlength: '80', 'aria-label': '이미지 이름', placeholder: '이미지 이름' });
          name.value = image.name;
          name.addEventListener('input', () => { image.name = name.value; modal.dirty = true; });
          const remove = button('목록에서 빼기', () => { if (modal.busy) return; modal.images = modal.images.filter(item => item.id !== image.id); modal.dirty = true; render(); }, 'cpi-button cpi-remove');
          fields.append(name, el('span', { class: 'cpi-small' }, `${image.width} × ${image.height} · ${(image.size / 1024 / 1024).toFixed(1)}MB`), remove);
          row.append(fields); list.append(row);
        }
      };
      picker.addEventListener('change', guard(async () => {
        const files = Array.from(picker.files || []); picker.value = ''; if (!files.length) return;
        if (files.length > CONFIG.maxBatchFiles || files.length + modal.images.length > CONFIG.maxProfileImages) {
          error.textContent = '한 번에 최대 50장, 프로필당 최대 200장까지 불러올 수 있습니다.'; return;
        }
        modal.busy = true; add.disabled = true; save.disabled = true; error.textContent = '';
        const errors = [];
        try {
          // Sequential thumbnailing avoids decoding a whole batch at once on mobile.
          for (let i = 0; i < files.length; i++) {
            count.textContent = `불러오는 중 ${i + 1}/${files.length}`;
            try { modal.images.push(await makeImageDraft(files[i])); modal.dirty = true; }
            catch (e) { errors.push(e.message); }
            if (modal.disposed) return;
          }
        } finally {
          modal.busy = false; add.disabled = false; save.disabled = false;
          if (!modal.disposed) { render(); error.textContent = errors.join('\n'); }
        }
      }, '이미지 불러오기'));
      const cancel = button('취소', () => modal.close());
      const save = button('저장하기', async () => {
        if (modal.busy) return;
        modal.busy = true; save.disabled = true; add.disabled = true; error.textContent = ''; save.textContent = '저장 중…';
        try {
          await saveCatalogDraft(modal); modal.dirty = false;
          modal.close(true); notify('이미지 설정을 저장했습니다.'); scheduleRefresh();
        } catch (e) { report(e, '이미지 설정 저장'); error.textContent = e.message; }
        finally { modal.busy = false; save.disabled = false; add.disabled = false; save.textContent = '저장하기'; }
      }, 'cpi-button cpi-primary');
      modal.footer.append(cancel, save); render();
    } catch (e) { report(e, '이미지 설정 열기'); notify(e.message); }
  }
  // Only the compact selector lives in a ShadowRoot. The native input, toolbar,
  // React nodes and the ProseMirror document are never moved. Only the outer
  // composer wrapper has its extra top padding/gap/background compacted.
  const COMPACT_STRIP_CSS = `
    :host {
      --cpi-strip-base:var(--bg_screen,var(--bg_elevated_primary,var(--surface_elevated,var(--cpi-bg,#fff))));
      --cpi-strip-fill:var(--cpi-strip-base);
      --cpi-strip-edge:var(--outline_tertiary,var(--cpi-line,#dddcd8));
      color:var(--text_primary,var(--cpi-fg,#242421));font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
    }
    /* Tint only the 32px selector, never the page or the native composer.
       A solid themed surface remains the fallback when color-mix is unavailable. */
    @supports (background:color-mix(in srgb,#000 94%,transparent)) {
      :host {
        --cpi-strip-fill:color-mix(in srgb,var(--cpi-strip-base) 94%,transparent);
        --cpi-strip-edge:color-mix(in srgb,var(--outline_tertiary,var(--cpi-line,#dddcd8)) 40%,transparent);
      }
    }
    *,*::before,*::after { box-sizing:border-box; }
    .row { display:flex;align-items:center;gap:4px;width:max-content;max-width:100%;min-width:0;height:32px;padding:0 4px;overflow:hidden; }
    .track { display:flex;align-items:center;gap:5px;flex:0 1 auto;width:max-content;min-width:0;height:32px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none;touch-action:pan-x pan-y;padding:0; }
    .track::-webkit-scrollbar { display:none; }
    button { appearance:none;position:static;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;margin:0;box-sizing:border-box;font:500 11px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text_primary,var(--cpi-fg,#242421));cursor:pointer;outline-offset:-2px;box-shadow:none;text-transform:none;letter-spacing:normal; }
    button[hidden] { display:none !important; }
    button:focus-visible { outline:2px solid var(--text_brand,#ff4432); }
    .choice { gap:5px;flex-direction:row;height:32px;min-height:32px;max-height:32px;width:auto;min-width:52px;max-width:132px;padding:3px 7px;border:1px solid var(--outline_tertiary,var(--cpi-line,#deded8));border-radius:7px;background:var(--bg_elevated_primary,var(--surface_elevated,var(--cpi-bg,#fff)));overflow:hidden;white-space:nowrap; }
    .choice:hover { background:var(--surface_tertiary,var(--cpi-bg2,#f4f4f2)); }
    .choice[aria-pressed="true"] { border-color:var(--text_brand,#ff4432);box-shadow:inset 0 0 0 1px var(--text_brand,#ff4432);background:var(--surface_tertiary,var(--cpi-bg2,#f4f4f2)); }
    .choice img { display:block;flex:0 0 24px;width:24px;height:24px;min-width:24px;max-width:24px;min-height:24px;max-height:24px;object-fit:contain;border:0;border-radius:3px;margin:0;padding:0; }
    .choice span { display:block;min-width:0;max-width:82px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .none { padding-inline:8px; }
    .arrow,.settings { flex:0 0 24px;width:24px;min-width:24px;height:32px;min-height:32px;max-height:32px;padding:0;border:0;border-radius:6px;background:transparent;font-size:20px; }
    .settings { flex-basis:28px;width:28px;min-width:28px;font-size:17px;background:var(--bg_elevated_primary,var(--surface_elevated,var(--cpi-bg,#fff))); }
    .arrow:disabled { opacity:.22;cursor:default; }
    .arrow:not(:disabled):hover,.settings:hover { background:var(--state_hover,rgba(128,128,128,.12)); }
    .empty { flex:0 0 auto;margin:0 4px;font:400 11px/1.4 system-ui,sans-serif;color:var(--text_secondary,var(--cpi-dim,#73736e));white-space:nowrap; }
    @media (max-width:480px) { .row { gap:2px; } .choice { max-width:112px;padding-inline:5px; } .choice span { max-width:66px; } }
  `;
  function disposeStrip(root) {
    if (!root) return;
    root._cpiDispose?.(); root._cpiReleaseLayout?.(); themeRoots.delete(root); root.remove();
  }
  function buildStrip({ label, images, selected, onSelect, onSettings, extraClass = '', themeSource = null }) {
    const root = el('div', { class: `cpi-strip ${extraClass}`, [OWNER]: '', 'aria-label': label, role: 'group', title: label });
    // all:initial excludes custom properties. Theme tokens still inherit/copy.
    // Inline !important also defeats site rules such as .editor > div:first-child.
    for (const [property, value] of Object.entries({
      all: 'initial', display: 'block', position: 'relative', float: 'none',
      width: '100%', 'min-width': '0', 'max-width': '100%',
      height: '32px', 'min-height': '32px', 'max-height': '32px',
      flex: '0 0 auto', 'align-self': 'stretch', 'box-sizing': 'border-box',
      margin: '0', padding: '0', border: '0', 'border-radius': '8px',
      background: 'var(--cpi-strip-fill,var(--bg_elevated_primary,var(--cpi-bg,#fff)))',
      'box-shadow': 'inset 0 0 0 1px var(--cpi-strip-edge,var(--cpi-line,#dddcd8))',
      // Do not use opacity on the host: labels and thumbnails must stay opaque.
      // Blur is confined to this small row; the large native wrapper stays clear.
      'backdrop-filter': 'blur(6px)', '-webkit-backdrop-filter': 'blur(6px)',
      isolation: 'isolate',
      overflow: 'hidden', contain: 'inline-size', 'pointer-events': 'auto',
    })) root.style.setProperty(property, value, 'important');
    const shadow = root.attachShadow({ mode: 'open' });
    const style = el('style'); style.textContent = COMPACT_STRIP_CSS;
    const row = el('div', { class: 'row' });
    const track = el('div', { class: 'track', role: 'group', 'aria-label': '유저 메시지 이미지 선택' });
    const choices = [];
    let currentId = selected?.id || null;
    const setPressed = target => {
      currentId = target?.id || null;
      for (const [node, image] of choices) {
        const pressed = String((image?.id || null) === currentId);
        if (node.getAttribute('aria-pressed') !== pressed) node.setAttribute('aria-pressed', pressed);
      }
    };
    const addChoice = image => {
      const tile = button('', () => { onSelect(image); setPressed(image); }, image ? 'choice' : 'choice none');
      tile.title = image?.name || '이미지 없이 전송';
      tile.setAttribute('aria-label', tile.title);
      if (image) tile.append(el('img', { src: image.thumb, alt: '', width: '24', height: '24', loading: 'lazy', decoding: 'async', draggable: 'false' }));
      tile.append(el('span', {}, image?.name || '선택 안 함'));
      choices.push([tile, image]); track.append(tile);
    };
    addChoice(null);
    const all = [...images];
    if (selected && !all.some(image => image.id === selected.id)) all.unshift(selected);
    all.forEach(addChoice); setPressed(selected);
    if (!all.length) track.append(el('span', { class: 'empty' }, '등록된 이미지 없음'));
    const scroll = direction => track.scrollBy({
      left: direction * Math.max(100, track.clientWidth * .75),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    const prev = button('‹', () => scroll(-1), 'arrow'); prev.setAttribute('aria-label', '이전 이미지');
    const next = button('›', () => scroll(1), 'arrow'); next.setAttribute('aria-label', '다음 이미지');
    const updateArrows = () => {
      prev.disabled = track.scrollLeft <= 1;
      next.disabled = track.scrollWidth <= track.clientWidth + track.scrollLeft + 1;
    };
    // With only a few images, neither arrows nor a full-width empty track are
    // needed. Keep the settings button directly beside the actual choices.
    prev.hidden = true; next.hidden = true;
    row.append(prev, track, next);
    let settings = null;
    if (onSettings) {
      settings = button('⚙', onSettings, 'settings');
      settings.setAttribute('aria-label', '이미지 설정'); settings.title = `${label} · 이미지 설정`;
      row.append(settings);
    }
    shadow.append(style, row);
    // Never let image choices submit the native form or enter its shortcut path.
    for (const type of ['click', 'keydown', 'keyup', 'input', 'change']) shadow.addEventListener(type, event => event.stopPropagation());
    shadow.addEventListener('mousedown', event => { if (event.target.closest?.('button')) event.preventDefault(); });
    track.addEventListener('scroll', updateArrows, { passive: true });
    let geometryFrame = 0;
    const refreshGeometry = () => {
      geometryFrame = 0;
      if (!root.isConnected) return;
      // Decide using the space WITHOUT arrows. Testing only scrollWidth after
      // arrows were added would leave them visible unnecessarily after a resize.
      const items = [...track.children];
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      const naturalWidth = items.reduce((sum, node) => {
        const css = getComputedStyle(node);
        return sum + node.offsetWidth + (parseFloat(css.marginLeft) || 0) + (parseFloat(css.marginRight) || 0);
      }, 0) + Math.max(0, items.length - 1) * gap;
      const rowStyle = getComputedStyle(row);
      const rowGap = parseFloat(rowStyle.columnGap) || 0;
      const horizontalPadding = (parseFloat(rowStyle.paddingLeft) || 0) + (parseFloat(rowStyle.paddingRight) || 0);
      const available = Math.max(0, root.clientWidth - horizontalPadding - (settings ? settings.offsetWidth + rowGap : 0));
      const overflow = naturalWidth > available + 1;
      if (prev.hidden === overflow) { prev.hidden = !overflow; next.hidden = !overflow; }
      updateArrows();
    };
    const scheduleGeometry = () => {
      if (!geometryFrame) geometryFrame = requestAnimationFrame(refreshGeometry);
    };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleGeometry) : null;
    resize?.observe(root); resize?.observe(track);
    if (!resize) PAGE.addEventListener('resize', scheduleGeometry, { passive: true });
    scheduleGeometry();
    root._cpiSetSelected = setPressed;
    root._cpiDispose = () => {
      resize?.disconnect(); cancelAnimationFrame(geometryFrame);
      if (!resize) PAGE.removeEventListener('resize', scheduleGeometry);
    };
    bindTheme(root, themeSource);
    return root;
  }
  function validPrompt(node) {
    return !!node?.matches?.(EDITOR) && !own(node) && visible(node) &&
      !node.closest(`${GROUP},[role="dialog"],dialog,[role="menu"],aside`);
  }
  function promptElement() {
    const fromSDK = state.sdk?.UI?.getPrompt?.(document);
    if (validPrompt(fromSDK)) return fromSDK;
    const editors = [...document.querySelectorAll(EDITOR)].filter(validPrompt);
    return editors.find(node => node.getAttribute('placeholder') === '메시지 보내기' ||
      node.querySelector('[data-placeholder="메시지 보내기"]')) || (editors.length === 1 ? editors[0] : null);
  }
  function inputMountAnchor(input, editing = false) {
    // Skip the whole EditorContent wrapper, not just the contenteditable element.
    // Most importantly, the image row must be OUTSIDE the input shell containing
    // both EditorContent and the original send/formatting toolbar.
    const boundary = editing ? input.closest(GROUP) : null;
    const isBoundary = node => !node || node === boundary || node.matches('body,html,main,[role="main"],[role="dialog"],dialog') ||
      (!editing && !!node.querySelector(GROUP));
    const containsOtherEditor = node => [...node.querySelectorAll(EDITOR)].some(other => other !== input && !own(other) && visible(other));
    let anchor = input;
    if (input.matches('[contenteditable="true"]')) {
      const wrapper = input.parentElement;
      if (!isBoundary(wrapper) && !containsOtherEditor(wrapper)) anchor = wrapper;
    }
    let cursor = anchor;
    for (let depth = 0; cursor && depth < 7; depth++, cursor = cursor.parentElement) {
      if (isBoundary(cursor) || containsOtherEditor(cursor)) break;
      const controls = [...cursor.querySelectorAll('button,[role="button"],input[type="submit"]')]
        .filter(node => !own(node) && !input.contains(node) && !node.closest('[role="dialog"],dialog,[role="menu"]'));
      if (controls.length) { anchor = cursor; break; }
      // Do not climb into the scrollable app layout while looking for a toolbar.
      const css = getComputedStyle(cursor);
      if (cursor !== input.parentElement && (css.position === 'fixed' || css.position === 'sticky' ||
          (cursor.clientHeight > innerHeight * .65 && /auto|scroll/.test(css.overflowY)))) break;
    }
    // A full-width sibling in an unwrapped flex row would squeeze the input.
    // Climb out of that row/grid rather than changing the site's flex styles.
    for (let depth = 0; depth < 7; depth++) {
      const parent = anchor.parentElement;
      if (isBoundary(parent) || containsOtherEditor(parent)) break;
      const css = getComputedStyle(parent);
      if ((css.display.includes('flex') && css.flexDirection.startsWith('row')) || css.display.includes('grid') || css.display === 'contents') {
        anchor = parent; continue;
      }
      break;
    }
    return anchor?.isConnected && !anchor.closest('[contenteditable="true"]') && anchor.parentElement ? anchor : null;
  }
  function mountComposerStrip(root, anchor, input) {
    const parent = anchor?.parentElement;
    if (!root || !parent) return;
    if (root.nextElementSibling !== anchor) anchor.before(root);
    const css = getComputedStyle(parent);
    const margin = /flex|grid/.test(css.display) ? '0px' : '4px';
    if (root.style.getPropertyValue('margin-bottom') !== margin) root.style.setProperty('margin-bottom', margin, 'important');
    if (root._cpiCompactParent === parent) return;
    root._cpiReleaseLayout?.();
    // Do not turn a whole page, message list, dialog, or a second editor
    // transparent. Only the small direct parent of this particular input shell.
    if (parent.matches('html,body,main,article,[role="main"],[role="dialog"],dialog') ||
        parent.closest(GROUP) || parent.querySelector(GROUP) || own(parent) ||
        [...parent.querySelectorAll(EDITOR)].some(other => other !== input && !own(other) && visible(other))) return;
    const attribute = 'data-cpi-compact-composer';
    const previous = parent.getAttribute(attribute), token = uuid();
    parent.setAttribute(attribute, token);
    root._cpiCompactParent = parent;
    root._cpiReleaseLayout = () => {
      // Restore only our marker, never overwrite current native/other-script
      // inline styles. Removing the marker restores responsive site styles.
      if (parent.getAttribute(attribute) === token) {
        if (previous === null) parent.removeAttribute(attribute);
        else parent.setAttribute(attribute, previous);
      }
      root._cpiCompactParent = null; root._cpiReleaseLayout = null;
    };
  }
  function renderComposer() {
    const input = isChat() ? promptElement() : null;
    const anchor = input ? inputMountAnchor(input) : null;
    if (!input || !anchor) { disposeStrip(state.composer); state.composer = null; state.composerSignature = ''; return; }
    const signature = JSON.stringify([state.accountId, state.profileId, state.profileKnown, state.catalog?.revision, state.ready]);
    if (state.composer?.isConnected && signature === state.composerSignature) {
      mountComposerStrip(state.composer, anchor, input);
      state.composer._cpiSetSelected?.(state.selected);
      return;
    }
    const previousScroll = state.composerSignature === signature ? state.composer?.shadowRoot?.querySelector('.track')?.scrollLeft || 0 : 0;
    disposeStrip(state.composer); state.composerSignature = signature;
    let label;
    if (!state.ready) label = '이미지 도구를 불러오는 중…';
    else if (!state.accountId || !state.profileKnown) label = '적용 대화 프로필 확인 중';
    else if (!state.profileId) label = '세션에 적용된 대화 프로필이 없습니다';
    else label = `${profileTitle(state.profileId)} · 로컬 이미지`;
    state.composer = buildStrip({
      label, images: state.catalog?.images || [], selected: state.selected,
      extraClass: 'cpi-composer-slot',
      onSelect: image => { state.selected = image; state.selectionVersion++; },
      onSettings: state.profileId ? () => openManager(state.profileId, { themeSource: input.parentElement }) : null,
      themeSource: input.parentElement,
    });
    mountComposerStrip(state.composer, anchor, input);
    if (previousScroll) state.composer.shadowRoot.querySelector('.track').scrollLeft = previousScroll;
  }

  // ---------------------------------------------------------------------------
  // Native profile menu integration, with explicit ambiguity handling.
  // ---------------------------------------------------------------------------
  function nativeProfileDialog(node) {
    if (!node || own(node)) return null;
    const root = node.closest?.('[role="dialog"],dialog') || (node.matches?.('[role="dialog"],dialog') ? node : null);
    if (!root || own(root)) return null;
    const headings = [...root.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(h => !own(h));
    return headings.some(h => /^대화 프로필(?:\s*(?:추가|수정|설정))?$/.test(compact(h.textContent))) ? root : null;
  }
  function isProfileSettingsPage() {
    // An independent settings page is not a chat route and has no dialog root.
    // URLSearchParams handles both direct links and client-side tab navigation.
    try {
      const url = new URL(PAGE.location.href);
      if (url.pathname.replace(/\/$/, '') !== '/setting/chat') return false;
      const menu = url.searchParams.get('menu');
      return !menu || menu === 'chat_profile';
    } catch (_) { return false; }
  }
  function prepareSettingsProfiles() {
    if (!state.ready || !isProfileSettingsPage() || state.settingsProfilesPromise) return;
    const key = `${state.epoch}/${state.accountId || ''}`;
    if (state.settingsProfilesKey === key) return;
    state.settingsProfilesKey = key;
    // One on-entry read (cached when possible), not polling. A cold settings
    // page must work without entering a chat first or waiting for native GETs.
    state.settingsProfilesPromise = ensureProfiles()
      .catch(error => report(error, '설정 페이지 대화 프로필 조회'))
      .finally(() => { state.settingsProfilesPromise = null; scheduleRefresh(); });
  }
  function nativeProfileScope(node) {
    if (!node || own(node) || node.closest?.(GROUP)) return null;
    const dialog = nativeProfileDialog(node);
    if (dialog) return { root: dialog, kind: 'dialog' };
    // A different modal (user notes, account edits, etc.) is never a settings
    // profile list merely because the page underneath has the same URL.
    if (!isProfileSettingsPage() || node.closest?.('[role="dialog"],dialog,[role="menu"],nav,header,[role="navigation"]')) return null;
    const root = node.closest?.('main,[role="main"]') || document.getElementById('__next') || document.body;
    if (!root?.contains(node)) return null;
    return { root, kind: 'settings' };
  }
  function profileMenuTrigger(node) {
    if (!(node instanceof Element) || own(node)) return null;
    // Prefer the actual Radix trigger over an inner button/icon so aria-controls
    // and aria-labelledby still point to the same node for portal menus.
    const trigger = node.closest('[aria-haspopup="menu"]') ||
      node.closest('.dropdown-button') || null;
    return trigger && !trigger.closest('[role="menu"]') ? trigger : null;
  }
  function profileMenuContext(trigger) {
    const scope = nativeProfileScope(trigger);
    if (!scope) return null;
    const profileId = profileAtTrigger(trigger, scope.root);
    // A page can have unrelated menus. Only a positively identified profile
    // row qualifies; a visible name elsewhere on the page is not a target.
    if (scope.kind === 'settings' && !profileId) return null;
    return { trigger, scope: scope.root, kind: scope.kind, profileId,
      accountId: state.accountId, href: PAGE.location.href, at: Date.now() };
  }
  function knownProfile(value) {
    if (!value || typeof value !== 'object') return null;
    const profileId = id(value._id || value.chatProfileId);
    if (!profileId) return null;
    if (state.profiles.has(profileId)) return profileId;
    // Freshly created native row: only accept the actual chat-profile shape
    // owned by this account; never a generic user/story/message object.
    if (state.accountId && value.profileId === state.accountId && typeof value.name === 'string' &&
        typeof value.information === 'string' && !value.role) {
      state.profiles.set(profileId, { ...value });
      return profileId;
    }
    return null;
  }
  function profileFromProps(props) {
    if (!props || typeof props !== 'object') return null;
    const values = [props.chatProfile, props.profile, props.item, props.data, props];
    const ids = new Set(values.map(knownProfile).filter(Boolean));
    const explicit = id(props.chatProfileId);
    if (explicit && state.profiles.has(explicit)) ids.add(explicit);
    // Do NOT read selectedProfileId: on a list it means the active profile,
    // not necessarily the row whose ellipsis menu was clicked.
    return ids.size === 1 ? [...ids][0] : null;
  }
  function reactProfileAtNode(node, dialog) {
    try {
      const keys = Object.keys(node);
      const propsKey = keys.find(key => key.startsWith('__reactProps$'));
      const direct = propsKey && profileFromProps(node[propsKey]);
      if (direct) return direct;
      const fiberKey = keys.find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
      let fiber = fiberKey && node[fiberKey];
      for (let depth = 0; fiber && depth < 18; depth++, fiber = fiber.return) {
        if (fiber.stateNode === dialog) break;
        const props = fiber.memoizedProps;
        if (!props || typeof props !== 'object') continue;
        // Stop before a shared list ancestor or provider; do not search its children.
        if (Array.isArray(props.chatProfiles) || Array.isArray(props.profiles) ||
            typeof props.onSelectProfile === 'function' && Object.hasOwn(props, 'selectedProfileId')) break;
        const profileId = profileFromProps(props);
        if (profileId) return profileId;
        const keyId = id(fiber.key);
        if (keyId && state.profiles.has(keyId)) return keyId;
      }
    } catch (_) { /* React internals are optional; explicit DOM IDs work without them. */ }
    return null;
  }
  function profileAtTrigger(trigger, dialog) {
    if (!trigger || !dialog || !dialog.contains(trigger)) return null;
    // Exact identifiers/row props precede text matching, including duplicate names.
    for (let node = trigger, depth = 0; node && node !== dialog && depth < 9; depth++, node = node.parentElement) {
      const direct = id(node.getAttribute('data-chat-profile-id'));
      if (direct) return direct;
      const legacy = id(node.getAttribute('data-profile-id'));
      if (legacy && state.profiles.has(legacy)) return legacy;
      const fromReact = reactProfileAtNode(node, dialog);
      if (fromReact) return fromReact;
      // Never walk into a common container holding multiple profile menu buttons.
      if (node.querySelectorAll('[aria-haspopup="menu"]').length > 1) break;
    }
    for (let node = trigger, depth = 0; node && node !== dialog && depth < 9; depth++, node = node.parentElement) {
      if (node.querySelectorAll('[aria-haspopup="menu"]').length > 1) break;
      const leaves = [...node.querySelectorAll('span,p,strong,h3,h4,div')]
        .filter(n => !own(n) && !n.children.length && !n.closest('[role="menu"]'));
      const texts = new Set(leaves.map(n => compact(n.textContent)));
      const matches = [...state.profiles.values()].filter(profile => texts.has(compact(profile.name)));
      if (matches.length === 1) return matches[0]._id;
      if (matches.length > 1) {
        const infos = matches.filter(p => p.information && texts.has(compact(p.information)));
        return infos.length === 1 ? infos[0]._id : null;
      }
    }
    return null;
  }
  function recordMenuContext(event) {
    const trigger = profileMenuTrigger(event.target);
    if (!trigger) return;
    const scope = nativeProfileScope(trigger);
    if (!scope) { state.menuContext = null; return; }
    state.menuContext = profileMenuContext(trigger);
    // A menu opened before the SDK/profile list is ready is retried after
    // hydration. Keep its exact trigger, never guess using the active profile.
    if (!state.menuContext) state.menuContext = { trigger, scope: scope.root,
      kind: scope.kind, profileId: null, accountId: state.accountId,
      href: PAGE.location.href, at: Date.now() };
    if (state.ready && !state.profileLists.has(state.accountId)) ensureProfiles().catch(e => report(e, '프로필 메뉴 조회'));
    scheduleRefresh();
  }
  function contextForMenu(menu) {
    // Resolve portal menus from their actual owner, not whichever profile was
    // selected in the chat or whichever settings row happened to be first.
    const labelIds = (menu.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
    for (const labelId of labelIds) {
      const trigger = document.getElementById(labelId);
      if (!trigger) continue;
      const controlled = trigger.getAttribute('aria-controls');
      if (controlled && menu.id && controlled !== menu.id) continue;
      const context = profileMenuContext(trigger);
      if (context) return context;
    }
    // Some menu renderers expose aria-controls only; keyboard/programmatic
    // opening still works without requiring an earlier pointer event.
    if (!labelIds.length && menu.id) {
      const triggers = [...document.querySelectorAll('[aria-haspopup="menu"][aria-controls],.dropdown-button[aria-controls]')]
        .filter(trigger => trigger.getAttribute('aria-controls') === menu.id);
      if (triggers.length === 1) {
        const context = profileMenuContext(triggers[0]);
        if (context) return context;
      }
    }
    const previous = state.menuContext;
    if (!previous || previous.href !== PAGE.location.href || !previous.scope.isConnected ||
        !previous.trigger.isConnected || Date.now() - previous.at > 15000 ||
        previous.accountId && previous.accountId !== state.accountId) return null;
    if (labelIds.length && !labelIds.some(labelId => previous.trigger.id === labelId ||
        previous.trigger.contains(document.getElementById(labelId)))) return null;
    const controlled = previous.trigger.getAttribute('aria-controls');
    if (controlled && menu.id && controlled !== menu.id) return null;
    const context = profileMenuContext(previous.trigger);
    return context && context.scope === previous.scope && context.kind === previous.kind ? context : null;
  }
  function integrateProfileMenus() {
    // Both native chat-profile dialogs and /setting/chat?menu=chat_profile.
    // No header-level button, duplicate picker, or change to native profile selection.
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (!visible(menu) || own(menu)) continue;
      const context = contextForMenu(menu), existing = menu.querySelector('[data-cpi-menu-item]');
      if (!context) { existing?.remove(); continue; }
      const entries = [...menu.querySelectorAll('[role="menuitem"]')].filter(item => !own(item)).map(item => compact(item.textContent));
      if (!entries.some(text => /^(?:수정|수정하기|삭제|삭제하기|프로필 수정|프로필 삭제)$/.test(text))) { existing?.remove(); continue; }
      const profileId = profileAtTrigger(context.trigger, context.scope) || context.profileId;
      const signature = `${state.accountId || ''}/${profileId || ''}/${context.kind}/${context.trigger.id || ''}`;
      if (existing?.getAttribute('data-cpi-menu-target') === signature &&
          existing._cpiMenuTrigger === context.trigger && existing._cpiMenuScope === context.scope) continue;
      existing?.remove();
      const accountId = state.accountId;
      const action = button('이미지 설정', () => {
        if (accountId && state.accountId !== accountId) { notify('계정이 바뀌었습니다. 프로필 메뉴를 다시 열어 주세요.'); return; }
        // Revalidate before the portal closes. React may reuse an open menu's
        // DOM for a different row. Never use an ID from a stale event closure.
        const live = contextForMenu(menu);
        if (!live || live.trigger !== context.trigger || live.scope !== context.scope) {
          notify('프로필 메뉴가 변경되었습니다. 설정할 프로필의 메뉴를 다시 열어 주세요.'); return;
        }
        const targetId = profileAtTrigger(live.trigger, live.scope) || live.profileId;
        if (!targetId) {
          notify('이 프로필을 식별하지 못했습니다. 해당 프로필의 ⋮ 메뉴를 다시 열어 주세요.');
          return;
        }
        const themeSource = live.trigger.parentElement || live.scope;
        const href = PAGE.location.href;
        try {
          menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        } catch (_) {}
        requestAnimationFrame(() => {
          if (PAGE.location.href === href && (!accountId || accountId === state.accountId))
            openManager(targetId, { themeSource });
        });
      }, 'cpi-native-action');
      action._cpiMenuTrigger = context.trigger; action._cpiMenuScope = context.scope;
      action.setAttribute(OWNER, ''); action.setAttribute('data-cpi-menu-item', '');
      action.setAttribute('data-cpi-menu-target', signature);
      action.setAttribute('data-cpi-profile-id', profileId || '');
      action.setAttribute('data-cpi-menu-surface', context.kind);
      action.setAttribute('role', 'menuitem'); action.setAttribute('tabindex', '0');
      // Native Radix menus use roving tabindex; handle a focused custom item too.
      action.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation(); action.click();
        }
      });
      menu.append(action);
    }
  }

  // ---------------------------------------------------------------------------
  // Lazy display: no full image decode for off-screen messages.
  // ---------------------------------------------------------------------------
  const pictures = new Map();
  const imageObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const record = pictures.get(entry.target);
      if (record) entry.isIntersecting ? loadPicture(record) : unloadPicture(record);
    }
  }, { rootMargin: '240px 0px' }) : null;
  async function loadPicture(record) {
    if (record.loading || record.url || !record.host.isConnected) return;
    const generation = ++record.generation; record.loading = true;
    try {
      const asset = await read(storageKey('asset', record.accountId, record.image.id));
      if (generation !== record.generation || !record.host.isConnected) return;
      if (!asset?.dataURL) { record.host.title = '이 브라우저에서 원본 이미지를 찾을 수 없습니다.'; return; }
      const url = URL.createObjectURL(dataURLToBlob(asset.dataURL));
      if (generation !== record.generation || !record.host.isConnected) { URL.revokeObjectURL(url); return; }
      record.url = url; record.img.src = url;
    } catch (e) { report(e, '이미지 표시'); }
    finally { if (generation === record.generation) record.loading = false; }
  }
  function unloadPicture(record) {
    record.generation++; record.loading = false;
    record.img.removeAttribute('src');
    if (record.url) URL.revokeObjectURL(record.url); record.url = null;
  }
  function removePicture(host) {
    host._cpiReleasePictureLayout?.();
    const record = pictures.get(host); if (!record) { host.remove(); return; }
    imageObserver?.unobserve(host); unloadPicture(record); pictures.delete(host); themeRoots.delete(host); host.remove();
  }
  function directPictureBranch(parent, descendant) {
    if (!parent || !descendant || parent === descendant || !parent.contains(descendant)) return null;
    let branch = descendant;
    while (branch.parentElement && branch.parentElement !== parent) branch = branch.parentElement;
    return branch.parentElement === parent ? branch : null;
  }
  function pictureMessageRow(group, target) {
    // Find the lowest common row of the native text column and its OWN menu.
    // Do not use text/name matching, flatten native wrappers with display:contents,
    // move React-owned elements, or reserve a menu-sized gutter beside the image.
    if (!group || !target || target === group) return null;
    const triggers = group.querySelectorAll(
      '[aria-label="메시지 옵션"],.dropdown-button,[aria-haspopup="menu"]'
    );
    for (const trigger of triggers) {
      if (own(trigger) || target.contains(trigger) || trigger.closest(GROUP) !== group ||
          trigger.closest('[role="menu"],[role="dialog"],dialog,[contenteditable="true"]')) continue;
      for (let row = target.parentElement; row && group.contains(row); row = row.parentElement) {
        if (!row.contains(trigger)) continue;
        const textBranch = directPictureBranch(row, target);
        const menuBranch = directPictureBranch(row, trigger);
        if (!textBranch || !menuBranch || textBranch === menuBranch) continue;
        if (menuBranch.querySelector(`${EDITOR},${GROUP},.break-all`) || menuBranch.matches(EDITOR)) break;
        // Never turn a header, a separate message, or a complex unknown layout
        // into a two-column grid. Unknown structures keep the normal insertion.
        const peers = [...row.children].filter(node => !own(node) &&
          !node.matches('script,style,template,[hidden],[role="menu"],[data-radix-popper-content-wrapper]'));
        if (peers.length === 2 && peers.includes(textBranch) && peers.includes(menuBranch)) {
          return { row, textBranch, menuBranch };
        }
        break;
      }
    }
    return null;
  }
  function fitPictureContainer(host, group, target) {
    const split = pictureMessageRow(group, target);
    const mount = split?.row || target;
    // Only our injected image is moved. The original text, edit input and menu
    // keep their DOM nodes/parents and their existing React event handlers.
    if (host.parentElement !== mount || mount.firstElementChild !== host) mount.prepend(host);
    const entries = [];
    for (let node = target; node && node !== group && group.contains(node); node = node.parentElement) {
      if (own(node) || node.matches('[contenteditable="true"],textarea')) break;
      entries.push([node, 'data-cpi-picture-fill']);
    }
    if (split) {
      if (split.row === group) entries.push([group, 'data-cpi-picture-fill']);
      entries.push([split.row, 'data-cpi-picture-row'],
        [split.textBranch, 'data-cpi-picture-text'], [split.menuBranch, 'data-cpi-picture-menu']);
    }
    const previousEntries = host._cpiPictureLayoutEntries || [];
    if (entries.length === previousEntries.length && entries.every(([node, attribute], i) =>
        node === previousEntries[i][0] && attribute === previousEntries[i][1] &&
        node.getAttribute(attribute) === host._cpiPictureLayoutToken)) return;
    host._cpiReleasePictureLayout?.();
    const token = uuid();
    const previous = entries.map(([node, attribute]) => [node, attribute, node.getAttribute(attribute)]);
    for (const [node, attribute] of entries) node.setAttribute(attribute, token);
    host._cpiPictureLayoutEntries = entries; host._cpiPictureLayoutToken = token;
    host._cpiReleasePictureLayout = () => {
      // Revert only markers we still own, including after editing, removal,
      // a layout-mode switch, or unmounting a virtualized message row.
      for (const [node, attribute, value] of previous) {
        if (node.getAttribute(attribute) !== token) continue;
        if (value === null) node.removeAttribute(attribute);
        else node.setAttribute(attribute, value);
      }
      host._cpiPictureLayoutEntries = []; host._cpiPictureLayoutToken = null;
      host._cpiReleasePictureLayout = null;
    };
  }
  function pictureContainer(group) {
    const bubble = group.querySelector('div.break-all.bg-surface_chat_secondary');
    if (bubble) return bubble;
    return [...group.querySelectorAll('div.break-all')].find(node => !own(node) && !node.closest('[contenteditable="true"]')) || group;
  }
  function displayPicture(group, link) {
    let host = group.querySelector('[data-cpi-picture]');
    if (!link?.image) { if (host) removePicture(host); return; }
    const signature = `${link.accountId}/${link.image.id}`;
    if (host && host.dataset.cpiPicture !== signature) { removePicture(host); host = null; }
    const target = pictureContainer(group);
    if (host) {
      fitPictureContainer(host, group, target);
      return;
    }
    const meta = link.image;
    const imageWidth = Number.isFinite(meta.width) && meta.width > 0 ? meta.width : 1;
    const imageHeight = Number.isFinite(meta.height) && meta.height > 0 ? meta.height : 1;
    host = el('div', {
      class: 'cpi-message-picture', [OWNER]: '', 'data-cpi-picture': signature,
      // Reserve full proportional height even while the off-screen src is freed.
      // The old 360px width and 480px height caps are intentionally removed.
      style: `width:100%;aspect-ratio:${imageWidth}/${imageHeight};max-width:100%;`,
      title: meta.name,
    });
    const img = el('img', { alt: meta.name, width: imageWidth, height: imageHeight, decoding: 'async' });
    host.append(img);
    const record = { host, img, accountId: link.accountId, image: meta, generation: 0, loading: false, url: null };
    pictures.set(host, record);
    fitPictureContainer(host, group, target); bindTheme(host, target);
    if (imageObserver) imageObserver.observe(host); else loadPicture(record);
  }
  function sweepPictures() {
    for (const [host, record] of pictures) if (!host.isConnected || record.accountId !== state.accountId) removePicture(host);
  }

  // ---------------------------------------------------------------------------
  // Native inline editing. Save only after the original PATCH succeeds.
  // ---------------------------------------------------------------------------
  const roleRequests = new Map();
  async function ensureMessageRole(chatId, messageId) {
    const key = messageKey(chatId, messageId);
    if (state.messages.has(key)) return state.messages.get(key).role;
    if (!state.ready) return null;
    if (!roleRequests.has(key)) {
      const kind = state.route.kind;
      const promise = (kind === 'story' ? state.api.chat.getMessage(chatId, messageId) :
        readOnlyRequest(`/crack-gen/character-chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`).then(unwrap))
        .then(message => { observeMessage(chatId, message); return message?.role || null; })
        .catch(e => { report(e, '수정 대상 확인'); return null; });
      roleRequests.set(key, promise);
    }
    return roleRequests.get(key);
  }
  async function refreshGroup(group, epoch) {
    if (!group.isConnected || !state.accountId || !state.route.chatId) return;
    const messageId = group.getAttribute('data-message-group-id');
    if (!id(messageId) || messageId === 'temp') return;
    const chatId = state.route.chatId, key = messageKey(chatId, messageId);
    const link = await getLink(chatId, messageId);
    if (!group.isConnected || epoch !== state.epoch) return;
    const editor = [...group.querySelectorAll(EDITOR)].find(node => !own(node) && visible(node));
    if (editor) {
      let role = link ? 'user' : state.messages.get(key)?.role;
      if (!role) role = await ensureMessageRole(chatId, messageId);
      if (role !== 'user' || !editor.isConnected || epoch !== state.epoch) return;
      let edit = state.edits.get(key);
      if (!edit || edit.committed) {
        edit = {
          token: uuid(), accountId: state.accountId, chatId, messageId,
          profileId: state.profileId || link?.profileId || null,
          selected: link?.image ? { ...link.image } : null, inFlight: 0, committed: false, root: null,
        };
        state.edits.set(key, edit);
      }
      const editSignature = `${edit.profileId}/${edit.profileId === state.profileId ? state.catalog?.revision : ''}`;
      if (!edit.root?.isConnected || edit.signature !== editSignature) {
        const images = edit.profileId === state.profileId ? (state.catalog?.images || []) :
          validCatalog(await read(profileKey(edit.accountId, edit.profileId)), edit.accountId, edit.profileId).images;
        if (epoch !== state.epoch || !editor.isConnected) return;
        disposeStrip(edit.root); edit.signature = editSignature;
        edit.root = buildStrip({
          label: `${profileTitle(edit.profileId)} · 수정할 이미지`, images, selected: edit.selected,
          extraClass: 'cpi-edit-strip', onSelect: image => { edit.selected = image; },
          onSettings: edit.profileId ? () => openManager(edit.profileId, { themeSource: editor.parentElement }) : null,
          themeSource: editor.parentElement,
        });
        const anchor = inputMountAnchor(editor, true);
        if (anchor) anchor.before(edit.root);
        else { disposeStrip(edit.root); edit.root = null; }
      }
      // Existing image stays intact while a selection is merely being edited.
      displayPicture(group, link);
    } else {
      const edit = state.edits.get(key);
      if (edit && !edit.inFlight) { disposeStrip(edit.root); state.edits.delete(key); }
      displayPicture(group, link);
    }
  }
  function cleanEdits() {
    for (const [key, edit] of state.edits) if (edit.chatId !== state.route.chatId && !edit.inFlight) { disposeStrip(edit.root); state.edits.delete(key); }
  }

  // ---------------------------------------------------------------------------
  // Event-driven DOM updates: no text/stream observer or continuous API polling.
  // ---------------------------------------------------------------------------
  function changeRoute(route) {
    state.route = route; state.epoch++;
    state.profileId = null; state.profileKnown = false; state.catalog = null; state.catalogKey = '';
    state.selected = null; state.selectionVersion++; state.composerSignature = '';
    state.links.clear(); detachLinkListeners(); state.menuContext = null;
    roleRequests.clear(); cleanEdits();
    for (const host of pictures.keys()) removePicture(host);
    const cached = state.chats.get(route.chatId);
    if (cached && Date.now() - cached.at < 30000) applyChatProfile(cached.profileId, true);
    if (isChat() && state.ready) hydrateChat();
  }
  let refreshRunning = false, refreshAgain = false;
  function scheduleRefresh() {
    if (state.refreshTimer) return;
    state.refreshTimer = setTimeout(() => { state.refreshTimer = 0; guard(refreshDOM, '화면 갱신')(); }, CONFIG.domDelay);
  }
  async function refreshDOM() {
    if (!document.body) return;
    if (refreshRunning) { refreshAgain = true; return; }
    refreshRunning = true;
    try {
      const route = parseLocalRoute();
      if (PAGE.location.href !== state.href) { state.href = PAGE.location.href; changeRoute(route); }
      installStyles(); prepareSettingsProfiles(); integrateProfileMenus();
      if (state.accountId && state.profileId) await ensureCatalog();
      renderComposer(); sweepPictures();
      const epoch = state.epoch;
      // Only mounted message rows are visited, never the entire message history.
      if (isChat() && state.accountId) {
        const groups = [...document.querySelectorAll(GROUP)];
        const mountedKeys = new Set(groups.map(group => linkKey(state.accountId, state.route.chatId, group.getAttribute('data-message-group-id'))));
        for (const [key, listener] of state.linkListeners) if (!mountedKeys.has(key)) {
          if (typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(listener);
          state.linkListeners.delete(key); state.links.delete(key);
        }
        for (const group of groups) {
          if (epoch !== state.epoch) break;
          await refreshGroup(group, epoch);
        }
      }
      sweepPictures();
    } finally {
      refreshRunning = false;
      if (refreshAgain) { refreshAgain = false; scheduleRefresh(); }
    }
  }
  function isOwnMutationNode(node) {
    return node.nodeType === 1 ? own(node) || node.hasAttribute?.(OWNER) : own(node.parentElement);
  }
  function interestingNode(node) {
    if (node.nodeType !== 1 || own(node)) return false;
    const selector = `${GROUP},${EDITOR},[role="dialog"],[role="menu"],main`;
    return node.matches(selector) || !!node.querySelector(selector);
  }
  function observeDOM() {
    const observer = new MutationObserver(records => {
      for (const mutation of records) {
        if (own(mutation.target)) continue;
        if (mutation.type === 'attributes') { scheduleRefresh(); return; }
        const styleChange = mutation.target.nodeType === 1 && mutation.target.matches?.('style') ||
          [...mutation.addedNodes, ...mutation.removedNodes].some(node => node.nodeType === 1 && node.matches?.('style,link[rel="stylesheet"]'));
        if (styleChange) scheduleThemeRefresh();
        const changed = [...mutation.addedNodes, ...mutation.removedNodes];
        if (changed.length && changed.every(isOwnMutationNode)) continue;
        if (changed.some(interestingNode)) { scheduleRefresh(); return; }
        const parent = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        if (parent?.closest?.('[role="menu"],[role="dialog"]')) { scheduleRefresh(); return; }
        const group = parent?.closest?.(GROUP);
        if (group && changed.some(node => node.nodeType === 1)) {
          const key = linkKey(state.accountId, state.route.chatId, group.getAttribute('data-message-group-id'));
          if (state.links.get(key)) { scheduleRefresh(); return; }
        }
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-message-group-id', 'contenteditable', 'data-state'] });
    // Theme roots only: body[data-theme] as well as html/classes/scoped ancestors.
    observeThemeAncestors(document.body || document.documentElement);
    document.addEventListener('load', event => { if (event.target?.matches?.('link[rel="stylesheet"]')) scheduleThemeRefresh(); }, true);
    document.addEventListener('pointerdown', recordMenuContext, true);
    document.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') recordMenuContext(event); }, true);
    document.addEventListener('click', event => {
      if (!own(event.target)) { recordMenuContext(event); scheduleRefresh(); }
    }, true);
    for (const type of ['focusin', 'focusout']) document.addEventListener(type, event => {
      if (state.modal?.root.contains(event.target)) event.stopImmediatePropagation();
    }, true);
    document.addEventListener('keydown', event => {
      if (state.modal?.root.contains(event.target) && event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); state.modal.close();
      }
    }, true);
    PAGE.addEventListener('popstate', scheduleRefresh);
    // This timer compares one URL string only. It does not scan DOM or call an API.
    state.routeTimer = setInterval(() => { if (PAGE.location.href !== state.href) scheduleRefresh(); }, 600);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRefresh(); });
    document.addEventListener('DOMContentLoaded', scheduleRefresh, { once: true });
    scheduleRefresh();
  }
  function diagnostics() {
    return {
      version: '1.0.7', sdkReady: state.ready, hooks: state.hooks,
      theme: currentTheme(document.body), modalProfileId: state.modal?.profileId || null,
      menuProfileId: state.menuContext?.profileId || null,
      profileSettingsPage: isProfileSettingsPage(), menuSurface: state.menuContext?.kind || null,
      settingsProfileLoading: !!state.settingsProfilesPromise,
      routeKind: state.route.kind, chatDetected: !!state.route.chatId,
      accountDetected: !!state.accountId, profileDetected: state.profileKnown,
      profileId: state.profileId, profileCount: state.profiles.size,
      imageCount: state.catalog?.images.length || 0,
      mountedGroups: document.querySelectorAll(GROUP).length,
      fullWidthImageRows: document.querySelectorAll('[data-cpi-picture-row]').length,
      nativeEditorDetected: !!promptElement(), pendingImageLinks: state.pending.size,
      selectorLayout: state.composer?.isConnected ? {
        height: Math.round(state.composer.getBoundingClientRect().height),
        width: Math.round(state.composer.getBoundingClientRect().width),
        shadowIsolated: !!state.composer.shadowRoot,
        insideEditor: !!state.composer.closest('[contenteditable="true"]'),
        parentDisplay: getComputedStyle(state.composer.parentElement).display,
        parentDirection: getComputedStyle(state.composer.parentElement).flexDirection,
        compactWrapper: !!state.composer._cpiCompactParent,
        wrapperTopPadding: getComputedStyle(state.composer.parentElement).paddingTop,
        wrapperGap: getComputedStyle(state.composer.parentElement).rowGap,
      } : null,
      counters: { ...state.counters }, errors: state.errors,
    };
  }

  // Install before remote SDK downloads so initial native requests are not missed.
  installHooks();
  observeDOM();
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('🖼 현재 대화 프로필 이미지 설정', () => openManager(state.profileId));
    GM_registerMenuCommand('🔎 이미지 기능 진단 정보 복사', () => {
      const info = JSON.stringify(diagnostics(), null, 2);
      if (typeof GM_setClipboard === 'function') GM_setClipboard(info, 'text');
      console.info('[Crack:ProfileLocalImages]', info);
      notify('진단 정보를 복사했습니다. 이미지·대화 본문·인증 토큰은 포함하지 않습니다.');
    });
    GM_registerMenuCommand('↻ 대화 프로필 다시 확인', () => guard(async () => {
      roleRequests.clear(); state.catalogKey = '';
      await ensureProfiles(true); await hydrateChat(); scheduleRefresh();
    }, '수동 프로필 확인')());
  }
  Promise.all([loadSDKFile('index.js', 'Crack'), loadSDKFile('ui.js', 'CrackUI')]).then(([Core, UI]) => {
    if (typeof Core.createCrackAPI !== 'function' || typeof Core.createProfilesAPI !== 'function' || typeof UI.getPrompt !== 'function') {
      throw new Error('Utill dist SDK 인터페이스가 변경되었습니다.');
    }
    state.sdk = { Core, UI }; state.api = Core.createCrackAPI({ request: readOnlyRequest });
    state.profilesAPI = Core.createProfilesAPI({ request: readOnlyRequest });
    state.ready = true;
    const route = parseLocalRoute();
    if (PAGE.location.href !== state.href) { state.href = PAGE.location.href; changeRoute(route); }
    else { state.route = route; if (isChat()) hydrateChat(); }
    scheduleRefresh();
  }).catch(error => {
    report(error, 'SDK 초기화');
    notify('이미지 기능의 SDK를 불러오지 못했습니다. Tampermonkey의 진단 정보 메뉴를 확인해 주세요.');
  });
})();
