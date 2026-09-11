// ==UserScript==
// @name         세션 AI 출력 횟수
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.1
// @updateURL    
// @downloadURL  
// @auther       지유지요
// @description  세션 제목 위에 실제 AI 출력 횟수 표시. 전체 집계, 증분 동기화, 재출력 포함 설정.
// @match        https://crack.wrtn.ai/*
// @require      https://raw.githubusercontent.com/workforomg/Utill/5f3fe67071b29ed447dc178f15b0f34a3c0a6128/dist/index.js
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addValueChangeListener
// ==/UserScript==

(() => {
  'use strict';
  const PREFIX = 'crack-output-count-v1';
  const SCHEMA = 2;
  const completed = status => status === 'end' || status === 'success';
  const BASES = { story: '/crack-gen/v3/chats', character: '/crack-gen/character-chats' };
  const idOf = row => typeof row?._id === 'string' ? row._id : typeof row?.id === 'string' ? row.id : '';
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value) && !/^(temp|error-message|init_message|initial_message)/i.test(value);
  function parseRoute(url) {
    try {
      const path = new URL(url, 'https://crack.wrtn.ai').pathname;
      const match = path.match(/^\/(stories|characters)\/([^/]+)\/(episodes|chats)\/([^/]+)\/?$/);
      if (!match || !validId(match[4])) return null;
      if (match[1] === 'stories' && match[3] !== 'episodes' || match[1] === 'characters' && match[3] !== 'chats') return null;
      return { kind: match[1] === 'stories' ? 'story' : 'character', id: match[4] };
    } catch { return null; }
  }
  function classify(message, kind) {
    const id = idOf(message);
    if (!validId(id)) return null;
    const groupId = kind === 'story' ? message.parentTurnId : message.parentMessageId;
    const group = validId(groupId) ? groupId : null;
    const text = typeof message.content === 'string' ? message.content.trim() : '';
    // Exact system-notice shapes only: never reject a story merely for mentioning an error.
    const notice = /^(?:일시적(?:인)? 오류가 발생했(?:어요|습니다)[.!]?\s*(?:잠시 후 다시 시도해\s?(?:주세요|보세요)[.!]?)?|(?:크래커(?:가|는)?\s*)?(?:차감되지 않(?:았|아)|차감 안\s?됨)[\s\S]{0,60})$/.test(text);
    const invalid = message.role !== 'assistant' || !text || notice ||
      Boolean(message.error) || message.isRefunded === true || message.refunded === true || message.isCharged === false ||
      message.isInitial === true || message.isInitialMessage === true || message.isPrologue === true;
    // Initial scripted greetings have no parent generation group. Unknown groups
    // are kept as unclassified instead of inventing a reroll relationship.
    const terminal = completed(message.status);
    const recognized = terminal || ['start', 'loading', 'generating', 'pending', 'error', 'failed'].includes(message.status);
    const eligible = !invalid && terminal && Boolean(group);
    return { id, group, ok: eligible, unknown: !invalid && (!recognized || terminal && !group && Boolean(message.chatModelId)), reroll: message.reroll === true };
  }
  function mergeRecords(previous = {}, messages, kind) {
    const records = { ...previous };
    for (const message of messages) {
      const record = classify(message, kind);
      if (record) records[record.id] = record;
    }
    return records;
  }
  function counts(records = {}) {
    const groups = new Set();
    let all = 0, unknown = 0;
    for (const record of Object.values(records)) {
      if (record.unknown) unknown++;
      if (!record.ok) continue;
      all++;
      if (!record.reroll) groups.add(record.group);
    }
    return { all, original: groups.size, rerolls: all - groups.size, unknown };
  }
  function samePage(records, rows, kind) {
    return rows.length > 0 && rows.every(row => {
      const record = classify(row, kind);
      return record && JSON.stringify(records[record.id]) === JSON.stringify(record);
    });
  }
  const unwrap = response => response && Object.hasOwn(response, 'data') ? response.data : response;
  async function readMessages(request, session, previous, full, signal, onPage = () => {}) {
    let cursor;
    const cursors = new Set();
    let records = { ...previous.records };
    // v1 classified all actual `end` messages as invalid. Never reuse its
    // completion flag to stop an incremental repair before older pages.
    let complete = previous.schema === SCHEMA && previous.complete === true;
    for (let page = 0; page < 10000; page++) {
      signal?.throwIfAborted();
      const data = unwrap(await request(`${BASES[session.kind]}/${encodeURIComponent(session.id)}/messages`, {
        query: { limit: 100, sortOrder: 'desc', ...(cursor ? { cursor } : {}) }, signal,
      }));
      if (!Array.isArray(data?.messages)) throw new Error('메시지 응답 형식이 변경되었습니다.');
      const familiar = samePage(previous.records || {}, data.messages, session.kind);
      records = mergeRecords(records, data.messages, session.kind);
      const next = data.nextCursor;
      // No early stop before a successful full baseline exists. Two first pages
      // overlap to capture recent rerolls/updates around a cursor boundary.
      if (next == null || next === '') { complete = true; return { records, complete }; }
      if (!data.messages.length || typeof next !== 'string' || cursors.has(next)) throw new Error('메시지 페이지가 반복되거나 비어 있습니다.');
      if (!full && complete && familiar && page >= 1) return { records, complete };
      cursors.add(next); cursor = next;
      onPage(page + 1);
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    throw new Error('메시지 조회 한도를 초과했습니다.');
  }
  async function listSessions(request, kind, signal) {
    const result = new Map();
    const cursors = new Set();
    let cursor;
    for (let page = 0; page < 10000; page++) {
      const data = unwrap(await request(BASES[kind], { query: { limit: 40, ...(cursor ? { cursor } : {}) }, signal }));
      if (!Array.isArray(data?.chats)) throw new Error('세션 목록 응답 형식이 변경되었습니다.');
      for (const row of data.chats) {
        const id = idOf(row);
        if (!validId(id)) throw new Error('세션 식별자를 확인할 수 없습니다.');
        result.set(id, { kind, id });
      }
      const next = data.nextCursor;
      if (next == null || next === '') return [...result.values()];
      if (!data.chats.length || typeof next !== 'string' || cursors.has(next)) throw new Error('세션 목록 페이지가 반복됩니다.');
      cursors.add(next); cursor = next;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    throw new Error('세션 조회 한도를 초과했습니다.');
  }
  function socketPacket(frame) {
    if (typeof frame !== 'string' || !/^42/.test(frame)) return null;
    const start = frame.indexOf('[');
    if (start < 0) return null;
    try {
      const packet = JSON.parse(frame.slice(start));
      if (!Array.isArray(packet) || packet[0] !== 'characterMessageGenerated' || packet[1]?.error) return null;
      return packet[1]?.data ?? packet[1];
    } catch { return null; }
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { classify, counts, mergeRecords, readMessages, listSessions, parseRoute, socketPacket };
    return;
  }

  let includeRerolls = GM_getValue(`${PREFIX}:include`, true);
  let account = '';
  let epoch = 0;
  let currentToken = '';
  let identityPending = false;
  let menus = [];
  let scanController;
  let scanRunning = false;
  let renderTimer;
  let mutationObserver;
  let lastActive = '';
  let lastListSync = 0;
  let liveHook = false;
  const cache = new Map();
  const inFlight = new Map();
  const lastSync = new Map();
  const watchers = new Set();
  const api = globalThis.Crack.createCrackAPI({ timeout: 20000 });
  const keyOf = session => `${session.kind}:${session.id}`;
  const storageKey = (session, owner = account) => `${PREFIX}:${owner}:${keyOf(session)}`;
  const authorized = (owner, version) => account === owner && epoch === version && token() === currentToken;
  const token = () => globalThis.Crack.readCookie('access_token') || '';
  function summary(message) {
    if (!document.body) return;
    let panel = document.getElementById('crack-output-progress');
    if (!panel) {
      panel = document.createElement('div'); panel.id = 'crack-output-progress';
      panel.style.cssText = 'position:fixed;right:16px;bottom:20px;max-width:360px;padding:14px 18px;border:1px solid #555;border-radius:12px;background:#202127;color:#eee;font:14px/1.6 system-ui;z-index:2147483647;cursor:pointer;white-space:pre-line';
      panel.setAttribute('role', 'status'); panel.title = '클릭하여 닫기';
      panel.onclick = () => panel.remove(); document.body.append(panel);
    }
    panel.textContent = message;
  }
  function load(session) {
    const key = storageKey(session);
    if (!cache.has(key)) cache.set(key, GM_getValue(key, { records: {}, complete: false }));
    if (!watchers.has(key)) {
      watchers.add(key);
      GM_addValueChangeListener(key, (_name, _old, value) => { cache.set(key, value); scheduleRender(); });
    }
    return cache.get(key);
  }
  async function save(session, snapshot, owner, version) {
    if (!authorized(owner, version)) return;
    const key = storageKey(session, owner);
    const commit = () => {
      if (!authorized(owner, version)) return;
      const latest = GM_getValue(key, { records: {}, complete: false });
      const incoming = { ...snapshot.records };
      // Preserve outputs arriving while an HTTP snapshot was being downloaded.
      if (snapshot.baseRecords) for (const [id, record] of Object.entries(latest.records)) {
        if (JSON.stringify(record) !== JSON.stringify(snapshot.baseRecords[id])) incoming[id] = record;
      }
      const records = { ...latest.records, ...incoming };
      const value = { schema: SCHEMA, records, totals: counts(records), complete: (latest.schema === SCHEMA && latest.complete) || snapshot.complete, updatedAt: Date.now() };
      GM_setValue(key, value); cache.set(key, value); scheduleRender();
    };
    if (navigator.locks) await navigator.locks.request(key, commit); else commit();
  }
  async function sync(session, full = false, signal) {
    if (!account) return;
    const key = storageKey(session);
    if (inFlight.has(key)) {
      await inFlight.get(key);
      if (!full) return;
    }
    const owner = account, version = epoch;
    const work = (async () => {
      const previous = load(session);
      const result = await readMessages(api.request, session, previous, full, signal);
      await save(session, { ...result, baseRecords: previous.records }, owner, version);
      if (authorized(owner, version)) lastSync.set(key, Date.now());
    })();
    inFlight.set(key, work);
    try { await work; } finally { if (inFlight.get(key) === work) inFlight.delete(key); }
  }
  function quietSync(session, force = false) {
    if (!account || !session || !GM_getValue(`${PREFIX}:${account}:started`, false)) return;
    const key = storageKey(session);
    if (!force && Date.now() - (lastSync.get(key) || 0) < 15000 || inFlight.has(key)) return;
    // A failed request backs off as well; manual retry remains available.
    lastSync.set(key, Date.now());
    sync(session).catch(() => { console.warn('[세션 출력 횟수] 동기화 실패. 저장된 집계를 유지합니다.'); });
  }
  async function fullScan() {
    if (scanRunning) { scanController.abort(); return; }
    await identify();
    if (!account) { summary('크랙 로그인 후 전체 로드를 실행해 주세요.'); return; }
    scanRunning = true; scanController = new AbortController(); registerMenus();
    const owner = account, version = epoch, signal = scanController.signal;
    GM_setValue(`${PREFIX}:${owner}:started`, true);
    let done = 0, failed = 0, total = 0;
    try {
      for (const kind of ['story', 'character']) {
        summary(`${kind === 'story' ? '스토리' : '캐릭터'} 세션 목록을 읽는 중…`);
        let sessions;
        try { sessions = await listSessions(api.request, kind, signal); }
        catch (error) { signal.throwIfAborted(); failed++; summary('일부 세션 목록 조회 실패. 다른 종류의 세션을 계속 확인합니다.'); continue; }
        total += sessions.length;
        for (const session of sessions) {
          signal.throwIfAborted();
          if (!authorized(owner, version)) throw new Error('계정 변경');
          summary(`AI 출력 전체 로드 ${done}/${total} · 실패 ${failed}\n실제 답변과 재출력 이력을 확인하는 중…`);
          try { await sync(session, true, signal); done++; }
          catch { signal.throwIfAborted(); failed++; }
        }
      }
      summary(`전체 로드 종료 · 완료 ${done}개 · 실패 ${failed}건\n${failed ? '실패 항목은 전체 로드를 다시 실행해 확인할 수 있습니다.' : '이후 세션 목록과 플레이 중 출력이 자동 반영됩니다.'}`);
    } catch { summary(`전체 로드 중단 · 완료 ${done}개\n완료한 세션 기록은 보관했습니다.`); }
    finally { scanRunning = false; registerMenus(); scheduleRender(); }
  }
  function registerMenus() {
    menus.forEach(id => GM_unregisterMenuCommand(id)); menus = [];
    const add = (title, fn) => menus.push(GM_registerMenuCommand(title, fn));
    add(scanRunning ? '전체 로드 중지 (완료 기록 유지)' : '세션 출력 횟수: 처음 전체 로드 / 전체 재확인', fullScan);
    add(`재출력 포함: ${includeRerolls ? 'O' : 'X'} (전환)`, () => {
      includeRerolls = !includeRerolls; GM_setValue(`${PREFIX}:include`, includeRerolls); registerMenus(); scheduleRender();
    });
    add('현재 세션 다시 확인', async () => {
      const session = parseRoute(location.href);
      if (!session) return summary('플레이 중인 세션에서 실행해 주세요.');
      try { await identify(); if (!account) throw new Error(); await sync(session, true); summary('현재 세션 집계를 갱신했습니다.'); }
      catch { summary('조회하지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요.'); }
    });
  }
  function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; render(); }, 100); }
  function render() {
    if (!document.body) return;
    const sessions = new Map();
    document.querySelectorAll('a[href*="/episodes/"], a[href*="/chats/"]').forEach(anchor => {
      const session = parseRoute(anchor.href);
      if (!session) return;
      // Confirmed session-card title; avoid chat body links and unrelated headings.
      const title = anchor.querySelector('.typo-text-sm_leading-none_medium');
      if (!title) return;
      sessions.set(keyOf(session), session);
      let badge = anchor.querySelector('[data-crack-output-count]');
      if (!badge) {
        badge = document.createElement('div'); badge.dataset.crackOutputCount = '';
      }
      badge.style.cssText = 'display:flex!important;flex-direction:row!important;align-items:center!important;align-self:stretch!important;flex:0 0 auto!important;box-sizing:border-box!important;width:100%!important;min-height:22px!important;padding:3px 7px!important;margin:0 0 4px!important;border-radius:6px!important;background:rgba(169,145,235,.10)!important;font:600 11px/1.5 system-ui!important;color:#a991eb!important;pointer-events:none';
      // The live card has two nested horizontal title rows. Insert into the
      // enclosing vertical column, above the ENTIRE title/menu row.
      let titleRow = title;
      let column = title.parentElement;
      while (column && column !== anchor) {
        const layout = getComputedStyle(column);
        if (layout.display === 'flex' && layout.flexDirection === 'column') break;
        titleRow = column; column = column.parentElement;
      }
      if (column && column !== anchor) {
        if (badge.parentElement !== column || badge.nextElementSibling !== titleRow) column.insertBefore(badge, titleRow);
      } else {
        let wrapper = title.parentElement;
        if (!wrapper.hasAttribute('data-crack-output-title')) {
          wrapper = document.createElement('div'); wrapper.dataset.crackOutputTitle = '';
          wrapper.style.cssText = 'display:flex!important;flex-direction:column!important;flex:1 1 auto!important;min-width:0!important';
          title.before(wrapper); wrapper.append(title);
        }
        if (badge.parentElement !== wrapper || badge.nextElementSibling !== title) wrapper.insertBefore(badge, title);
      }
      const snapshot = account ? load(session) : null;
      const count = snapshot?.totals ?? counts(snapshot?.records);
      const legacy = snapshot?.complete && snapshot.schema !== SCHEMA;
      const known = snapshot?.schema === SCHEMA && snapshot.complete;
      const text = !account ? '출력 횟수 · 로그인 필요' : legacy ? '출력 횟수 · 다시 집계 중' : !known ? `출력 ${count.all ? `${includeRerolls ? count.all : count.original}회 · 일부 집계` : '미집계'}` : count.unknown && !count.all ? '출력 횟수 · 확인 필요' : `출력 ${(includeRerolls ? count.all : count.original).toLocaleString('ko-KR')}회${count.unknown ? ' · 확인 필요' : ''}`;
      if (badge.textContent !== text) badge.textContent = text;
      badge.title = known ? `재출력 제외 ${count.original}회 / 포함 ${count.all}회 / 재출력 ${count.rerolls}회${count.unknown ? ` / 분류 불가 ${count.unknown}건` : ''}` : '템퍼몽키 메뉴에서 처음 전체 로드를 실행하세요.';
    });
    if (Date.now() - lastListSync > 60000) { lastListSync = Date.now(); sessions.forEach(session => quietSync(session)); }
  }
  async function identify() {
    const value = token();
    if (value === currentToken && account || identityPending) return;
    identityPending = true;
    try {
      // Clear previous-account badges before any asynchronous account lookup.
      currentToken = value; account = ''; epoch++; scanController?.abort(); cache.clear(); lastSync.clear();
      const version = epoch; scheduleRender();
      if (!value) return;
      // Stable profile ID also handles opaque/rotating access tokens.
      const profile = await globalThis.Crack.createProfilesAPI().me();
      const id = idOf(profile) || idOf(profile?.profile);
      if (!validId(id) || token() !== value || version !== epoch) return;
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
      account = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      lastListSync = 0; scheduleRender();
    } catch { /* No account identity: do not mix caches. */ }
    finally { identityPending = false; }
  }
  async function generated(frame) {
    const message = socketPacket(frame);
    if (!message || !account) return;
    const id = message.chatId || message.characterChatId;
    if (!validId(id)) return;
    const active = parseRoute(location.href);
    let session = active?.id === id ? active : null;
    if (!session) {
      for (const kind of ['story', 'character']) if (GM_getValue(storageKey({ kind, id }), null)) { session = { kind, id }; break; }
    }
    if (!session || !GM_getValue(`${PREFIX}:${account}:started`, false)) return;
    const owner = account, version = epoch;
    // Persist only server-confirmed success. Loading/generating/error events never enter this path.
    if (completed(message.status)) await save(session, { records: mergeRecords({}, [message], session.kind), complete: false }, owner, version);
    quietSync(session, true);
    setTimeout(() => { if (authorized(owner, version)) quietSync(session, true); }, 1500);
  }
  function installSocketObserver() {
    try {
      const Original = unsafeWindow.WebSocket;
      unsafeWindow.WebSocket = new Proxy(Original, {
        construct(Target, args, NewTarget) {
          const socket = Reflect.construct(Target, args, NewTarget);
          // Observe incoming frames only; never send, close, or alter site messages.
          socket.addEventListener('message', event => {
            if (typeof event.data === 'string') generated(event.data).catch(() => {});
          });
          return socket;
        },
      });
      liveHook = true;
    } catch { liveHook = false; }
  }
  installSocketObserver();
  GM_addValueChangeListener(`${PREFIX}:include`, (_key, _old, value) => { includeRerolls = Boolean(value); registerMenus(); scheduleRender(); });
  registerMenus();
  function start() {
    if (!document.body) return;
    mutationObserver = new MutationObserver(records => {
      if (records.some(record => !record.target.closest?.('[data-crack-output-count], #crack-output-progress'))) scheduleRender();
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    identify(); scheduleRender();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  setInterval(() => {
    if (document.hidden) return;
    if (token() !== currentToken || !account) { identify(); return; }
    const active = parseRoute(location.href);
    const key = active ? keyOf(active) : '';
    if (key !== lastActive) { lastActive = key; quietSync(active, true); scheduleRender(); }
    // Fallback also covers sockets opened before @require loaded and HTTP polling transports.
    if (active) quietSync(active, !liveHook && Date.now() - (lastSync.get(storageKey(active)) || 0) > 5000);
  }, 2000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { identify(); quietSync(parseRoute(location.href), true); scheduleRender(); } });
})();
