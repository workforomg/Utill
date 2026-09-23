// ==UserScript==
// @name         동일한 테스트작품 에피소드 일괄 삭제
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @updateURL    https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%ED%85%8C%EC%8A%A4%ED%8A%B8%EC%9E%91%ED%92%88%EC%9D%BC%EA%B4%84%EC%82%AD%EC%A0%9C.user.js
// @downloadURL  https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%ED%85%8C%EC%8A%A4%ED%8A%B8%EC%9E%91%ED%92%88%EC%9D%BC%EA%B4%84%EC%82%AD%EC%A0%9C.user.js
// @author       지유지요
// @description  작품 ID가 같은 세션을 선택하고 원본 작품 제목을 입력한 뒤 API로 삭제합니다.
// @match        https://crack.wrtn.ai/*
// @require      https://raw.githubusercontent.com/workforomg/Utill/e3f7d7a5b33bdc26a5201a3fa54ca472828a9362/dist/index.js
// @run-at       document-idle
// @noframes
// @sandbox      DOM
// @grant        GM_info
// ==/UserScript==

(() => {
  'use strict';

  const CHAT_PATH = '/crack-gen/v3/chats';
  const PAGE_SIZE = 40;
  const BATCH_SIZE = 20;
  const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
  const idOf = value => value?._id ?? value?.id;
  const storyIdOf = chat => idOf(chat?.story) ?? chat?.storyId;
  const unwrap = value => value && Object.hasOwn(value, 'data') ? value.data : value;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function parseEpisode(href, origin = 'https://crack.wrtn.ai') {
    try {
      const url = new URL(href, origin);
      const match = url.pathname.match(/^\/stories\/([a-f\d]{24})\/episodes\/([a-f\d]{24})\/?$/i);
      return url.origin === origin && match ? { storyId: match[1], chatId: match[2] } : null;
    } catch { return null; }
  }

  // Follow nextCursor to the end; never infer completion from a short page.
  async function readPages(fetchPage, field, { signal, onPage = () => {} } = {}) {
    const records = new Map(), cursors = new Set();
    let cursor;
    for (let page = 0; page < 5000; page++) {
      signal?.throwIfAborted();
      const data = unwrap(await fetchPage({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }, signal));
      if (!Array.isArray(data?.[field])) {
        throw new Error('목록 응답 형식이 달라졌습니다. 전체 목록을 확인할 수 없어 중단했습니다.');
      }
      let added = 0;
      for (const row of data[field]) {
        const id = idOf(row);
        if (!validId(id)) throw new Error('목록의 ID를 확인할 수 없습니다.');
        if (records.has(id) && field === 'chats' && storyIdOf(records.get(id)) !== storyIdOf(row)) {
          throw new Error('조회 중 세션의 작품 정보가 변경되었습니다. 다시 불러와 주세요.');
        }
        if (!records.has(id)) added++;
        records.set(id, row);
      }
      onPage(records.size);
      const next = data.nextCursor;
      if (next == null || next === '') {
        if (data.hasNext === true) throw new Error('다음 페이지의 커서를 확인할 수 없습니다.');
        return [...records.values()];
      }
      if (typeof next !== 'string' || !next || cursors.has(next) || !added) {
        throw new Error('목록 페이지가 반복되거나 커서가 올바르지 않습니다.');
      }
      cursors.add(next); cursor = next;
      await pause(80);
    }
    throw new Error('목록 조회 한도를 넘었습니다. 삭제하지 않고 중단했습니다.');
  }

  function originalTitle(story, expectedId) {
    if (idOf(story) !== expectedId || typeof story?.name !== 'string' || !story.name.trim()) {
      throw new Error('원본 작품의 ID 또는 제목을 확인하지 못했습니다.');
    }
    return story.name;
  }

  async function loadSnapshot(api, library, context, { signal, onProgress = () => {} } = {}) {
    if (!validId(context.storyId) || !validId(context.chatId)) throw new Error('작품 또는 세션 ID가 올바르지 않습니다.');
    const selectedChat = await api.chat.get(context.chatId, { signal });
    if (idOf(selectedChat) !== context.chatId || storyIdOf(selectedChat) !== context.storyId) {
      throw new Error('메뉴의 작품 ID와 서버의 세션 정보가 다릅니다.');
    }
    const title = originalTitle(await api.story.getPublic(context.storyId, { signal }), context.storyId);
    onProgress('보관함 목록 확인 중…');
    const folders = await readPages((query, signal) => library.chatFolders({ query }, { signal }), 'folders', { signal });
    // Explicitly read unfiled episodes and each folder, matching the site's query contract.
    const scopes = [{ _id: 'null', name: '에피소드 목록' }, ...folders.map(folder => ({ ...folder, _id: idOf(folder) }))];
    const matches = new Map();
    let scanned = 0;
    for (let index = 0; index < scopes.length; index++) {
      const scope = scopes[index];
      const rows = await readPages((query, signal) => library.storyChats({ query: { ...query, folderId: scope._id } }, { signal }), 'chats', {
        signal,
        onPage: count => onProgress(`세션 ${scanned + count}개 확인 중 · 위치 ${index + 1}/${scopes.length}`),
      });
      scanned += rows.length;
      for (const chat of rows) {
        if (storyIdOf(chat) !== context.storyId) continue;
        const id = idOf(chat);
        matches.set(id, Object.freeze({
          id, storyId: context.storyId,
          title: typeof chat.title === 'string' && chat.title.trim() ? chat.title : title,
          date: chat.messagedAt || chat.updatedAt || chat.createdAt || '',
          folder: scope._id === 'null' ? '에피소드 목록' : `보관함 · ${scope.name || '이름 없음'}`,
          pinned: Boolean(chat.pinnedAt),
        }));
      }
    }
    if (!matches.has(context.chatId)) throw new Error('선택한 세션이 전체 목록에 없습니다. 목록을 새로고침해 주세요.');
    signal?.throwIfAborted();
    const rows = [...matches.values()].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    return Object.freeze({ storyId: context.storyId, title, rows: Object.freeze(rows), scanned });
  }

  function checkedRows(snapshot, selectedIds, typedTitle) {
    if (!snapshot || typedTitle !== snapshot.title) throw new Error('원본 작품 제목을 공백까지 정확히 입력해 주세요.');
    const ids = [...selectedIds];
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('삭제할 세션을 선택해 주세요.');
    const byId = new Map(snapshot.rows.map(row => [row.id, row]));
    return ids.map(id => {
      const row = byId.get(id);
      if (!validId(id) || !row || row.storyId !== snapshot.storyId) throw new Error('선택 목록에 확인되지 않은 세션이 있습니다.');
      return row;
    });
  }

  async function deleteSelection(api, snapshot, selectedIds, typedTitle, {
    guard = () => {}, shouldStop = () => false, onProgress = () => {},
  } = {}) {
    const rows = checkedRows(snapshot, selectedIds, typedTitle);
    const result = { acknowledged: [], uncertain: [], pending: rows.map(row => row.id), stopped: false, error: null };
    const stopped = () => { if (!shouldStop()) return false; result.stopped = true; return true; };
    try {
      guard();
      if (stopped()) return result;
      const currentTitle = originalTitle(await api.story.getPublic(snapshot.storyId), snapshot.storyId);
      if (currentTitle !== snapshot.title) throw new Error('원본 작품 제목이 변경되었습니다. 목록을 다시 열어 확인해 주세요.');
      // Validate every selected session before the first destructive request.
      for (let index = 0; index < rows.length; index++) {
        guard();
        if (stopped()) return result;
        onProgress(`삭제 대상 재확인 중 ${index + 1}/${rows.length}`);
        const chat = await api.chat.get(rows[index].id);
        if (idOf(chat) !== rows[index].id || storyIdOf(chat) !== snapshot.storyId) {
          throw new Error('세션의 작품 ID가 달라졌습니다. 삭제하지 않고 중단했습니다.');
        }
      }
      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        guard();
        if (stopped()) return result;
        const ids = rows.slice(offset, offset + BATCH_SIZE).map(row => row.id);
        onProgress(`삭제 요청 중 ${result.acknowledged.length}/${rows.length} · 이번 요청 ${ids.length}개`);
        try {
          const response = await api.request(`${CHAT_PATH}/delete`, { method: 'POST', body: { chatIds: ids } });
          const payload = unwrap(response);
          if (response?.success === false || payload?.success === false || response?.error || payload?.error) {
            throw new Error('서버가 삭제 요청 실패를 반환했습니다.');
          }
        } catch (error) {
          // A timeout or failed response does not prove that the server did not delete.
          result.uncertain = ids;
          result.pending = result.pending.filter(id => !ids.includes(id));
          result.error = error;
          return result;
        }
        result.acknowledged.push(...ids);
        result.pending = result.pending.filter(id => !ids.includes(id));
        if (offset + BATCH_SIZE < rows.length) await pause(160);
      }
    } catch (error) { result.error = error; }
    return result;
  }

  // Only run a bounded lookup after the user opens an episode menu. Streaming
  // messages, list reordering and route changes must not schedule background work.
  function createMenuScheduler(scan, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    let timers = [], generation = 0;
    function cancel() {
      generation++;
      for (const timer of timers) clearTimer(timer);
      timers = [];
    }
    function request(trigger) {
      cancel();
      const current = generation;
      for (const delay of [0, 60, 180, 420, 1000]) {
        timers.push(setTimer(() => {
          if (current !== generation) return;
          if (!trigger.isConnected || scan(trigger)) cancel();
        }, delay));
      }
    }
    return { request, cancel };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { parseEpisode, readPages, loadSnapshot, checkedRows, deleteSelection, createMenuScheduler };
    return;
  }
  const runtimeKey = Symbol.for('crack.episodeBulkDelete.runtime');
  if (globalThis[runtimeKey]) return;
  if (!globalThis.Crack?.createCrackAPI || !globalThis.Crack?.createLibraryAPI) {
    console.error('[에피소드 일괄 삭제] @require SDK를 불러오지 못했습니다.');
    return;
  }
  globalThis[runtimeKey] = true;

  let shadow = null;
  function ensureUI() {
  if (shadow) return;
  const host = document.createElement('div');
  host.id = 'crack-episode-bulk-delete-host';
  document.body.append(host);
  shadow = host.attachShadow({ mode: 'open' });
  const css = document.createElement('style');
  css.textContent = `
    :host { color-scheme: dark; }
    * { box-sizing: border-box; }
    dialog { color:#efeff3; background:#202024; border:1px solid #48484f; border-radius:16px; padding:0; width:min(620px,calc(100vw - 24px)); max-height:calc(100dvh - 32px); font:14px/1.55 system-ui,sans-serif; box-shadow:0 24px 90px #0009; pointer-events:auto; }
    dialog::backdrop { background:#0009; }
    .frame { display:flex; flex-direction:column; max-height:calc(100dvh - 36px); }
    header { display:flex; align-items:start; justify-content:space-between; gap:12px; padding:22px 24px 16px; }
    h2 { margin:0; font-size:20px; letter-spacing:-.5px; }
    h3 { margin:0 0 12px; font-size:16px; }
    p { margin:0 0 12px; }
    .body { overflow-y:auto; padding:0 24px 20px; min-height:0; }
    .muted { color:#b3b3bd; } .small { font-size:12px; }
    .work-title { font-size:16px; font-weight:650; margin-bottom:4px; overflow-wrap:anywhere; white-space:pre-wrap; }
    .work-id { color:#a0a0ad; font:12px/1.5 ui-monospace,monospace; overflow-wrap:anywhere; margin-bottom:16px; }
    .toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:12px 0; border-top:1px solid #3a3a42; }
    label { cursor:pointer; } input[type=checkbox] { width:18px; height:18px; flex-shrink:0; accent-color:#bca7ff; margin:0; }
    .all { display:flex; align-items:center; gap:9px; } .row { display:flex; align-items:start; gap:12px; padding:13px 10px; border:1px solid #42424b; border-radius:9px; margin-bottom:8px; background:#29292f; }
    .row:has(input:not(:checked)) { background:transparent; color:#b3b3bd; }
    .row input { margin-top:3px; } .row-copy { min-width:0; } .row-title { display:block; font-weight:600; overflow-wrap:anywhere; }
    .meta { display:block; color:#a8a8b6; font-size:12px; overflow-wrap:anywhere; margin-top:3px; }
    button { font:inherit; font-weight:600; cursor:pointer; border:1px solid #55555f; border-radius:8px; background:#303037; color:inherit; min-height:40px; padding:8px 15px; }
    button:hover:not(:disabled) { filter:brightness(1.15); } button:disabled { opacity:.38; cursor:not-allowed; }
    button:focus-visible,input:focus-visible { outline:2px solid #c2abff; outline-offset:3px; }
    .close { padding:0; min-height:30px; width:30px; border:0; background:transparent; font-size:22px; flex-shrink:0; }
    .danger { background:#c43d53; border-color:#c43d53; color:white; } .secondary { background:transparent; }
    footer { padding:16px 24px; border-top:1px solid #3a3a42; display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap; }
    .warning { color:#ffb7c2; background:#3d2930; border:1px solid #69414b; border-radius:9px; padding:12px; }
    .confirm-title { display:block; padding:12px; background:#17171c; border-radius:8px; margin:12px 0; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
    input[type=text] { display:block; width:100%; font:inherit; background:#16161b; color:#fff; border:1px solid #666674; border-radius:8px; padding:12px; margin:8px 0; }
    .status { padding:20px 0; white-space:pre-line; overflow-wrap:anywhere; }
    details { margin-top:14px; } summary { cursor:pointer; } ul { padding-left:20px; } li { overflow-wrap:anywhere; margin:6px 0; }
    @media(max-width:480px) { header { padding:18px 16px 14px; } .body { padding:0 16px 16px; } footer { padding:14px 16px; } h2 { font-size:18px; } }
  `;
  shadow.append(css);
  }
  let session = null;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, action, className = '') {
    const node = el('button', text, className); node.type = 'button'; node.onclick = action; return node;
  }
  function errorText(error) {
    if (error?.status === 401 || error?.status === 403) return '로그인 상태 또는 접근 권한을 확인한 뒤 다시 열어 주세요.';
    if (error?.status === 429) return '요청이 많아 서버가 제한했습니다. 잠시 후 목록을 다시 확인해 주세요.';
    if (error?.status) return `서버 요청에 실패했습니다 (HTTP ${error.status}).`;
    return error?.message || '요청 결과를 확인하지 못했습니다.';
  }
  function closeSession() {
    if (!session || session.busy) return;
    const old = session; session = null;
    old.controller.abort(); old.confirm?.remove(); old.dialog.close(); old.dialog.remove();
    if (old.trigger?.isConnected) old.trigger.focus();
  }
  function makeDialog(title) {
    ensureUI();
    const dialog = el('dialog');
    const frame = el('div', undefined, 'frame'), header = el('header');
    const heading = el('h2', title); heading.id = `bulk-title-${title.includes('확인') ? 'confirm' : 'list'}`;
    dialog.setAttribute('aria-labelledby', heading.id);
    const close = button('×', closeSession, 'close'); close.setAttribute('aria-label', '닫기');
    const body = el('div', undefined, 'body'), footer = el('footer');
    header.append(heading, close); frame.append(header, body, footer); dialog.append(frame); shadow.append(dialog);
    return { dialog, body, footer, close };
  }
  function refreshPage(s) {
    const current = parseEpisode(location.href, location.origin);
    const deleted = [...(s.result?.acknowledged || []), ...(s.result?.uncertain || [])];
    if (current && deleted.includes(current.chatId)) location.assign('/');
    else location.reload();
  }

  async function openSessions(context, trigger) {
    if (session) return;
    const ui = makeDialog('같은 작품 세션 일괄 삭제');
    const controller = new AbortController();
    const token = globalThis.Crack.readCookie('access_token');
    const guard = () => {
      if (globalThis.Crack.readCookie('access_token') !== token) throw new Error('로그인 상태가 변경되었습니다. 목록을 다시 열어 주세요.');
    };
    const transport = globalThis.Crack.createTransport({ timeout: 30000 });
    const request = (path, options) => { guard(); return transport(path, options); };
    const api = globalThis.Crack.createCrackAPI({ request });
    const library = globalThis.Crack.createLibraryAPI({ request });
    const s = session = { ...ui, controller, trigger, api, guard, busy: false, selected: new Set() };
    ui.dialog.addEventListener('cancel', event => { event.preventDefault(); closeSession(); });
    ui.footer.append(button('닫기', closeSession));
    const status = el('p', '원본 작품과 세션 목록 확인 중…', 'status'); status.setAttribute('role', 'status');
    ui.body.append(status); ui.dialog.showModal();
    try {
      s.snapshot = await loadSnapshot(api, library, context, { signal: controller.signal, onProgress: text => { status.textContent = text; } });
      guard();
      if (session !== s) return;
      s.selected = new Set(s.snapshot.rows.map(row => row.id));
      renderList(s);
    } catch (error) {
      if (session !== s) return;
      status.textContent = errorText(error); status.setAttribute('role', 'alert');
      ui.footer.append(button('다시 불러오기', () => { closeSession(); openSessions(context, trigger); }));
    }
  }

  function renderList(s) {
    const { snapshot, body, footer } = s;
    body.replaceChildren(); footer.replaceChildren();
    body.append(el('p', snapshot.title, 'work-title'), el('p', `작품 ID · ${snapshot.storyId}`, 'work-id'));
    body.append(el('p', '보관함을 포함한 같은 작품의 세션입니다. 남겨둘 세션은 체크를 해제하세요.', 'muted'));
    const toolbar = el('div', undefined, 'toolbar'), allLabel = el('label', undefined, 'all');
    const all = el('input'); all.type = 'checkbox';
    allLabel.append(all, el('span', '전체 선택'));
    const count = el('span', '', 'muted'); count.setAttribute('aria-live', 'polite');
    toolbar.append(allLabel, count); body.append(toolbar);
    const list = el('div'), checks = [];
    const next = button('삭제하기', () => openConfirmation(s), 'danger');
    const update = () => {
      const n = s.selected.size;
      all.checked = n === snapshot.rows.length && n > 0;
      all.indeterminate = n > 0 && n < snapshot.rows.length;
      count.textContent = `${n} / ${snapshot.rows.length}개 선택`;
      next.textContent = `선택한 ${n}개 삭제하기`; next.disabled = n === 0;
    };
    for (const row of snapshot.rows) {
      const label = el('label', undefined, 'row'), check = el('input');
      check.type = 'checkbox'; check.checked = s.selected.has(row.id);
      check.setAttribute('aria-label', `${row.title} 삭제 대상`);
      check.onchange = () => { check.checked ? s.selected.add(row.id) : s.selected.delete(row.id); update(); };
      checks.push({ check, id: row.id });
      const copy = el('span', undefined, 'row-copy');
      copy.append(el('span', row.title, 'row-title'));
      const date = new Date(row.date);
      const formatted = Number.isNaN(date.getTime()) ? '날짜 정보 없음' : date.toLocaleString('ko-KR');
      copy.append(el('span', `${row.pinned ? '고정됨 · ' : ''}${row.folder} · ${formatted}`, 'meta'), el('span', `세션 ID · ${row.id}`, 'meta'));
      label.append(check, copy); list.append(label);
    }
    all.onchange = () => {
      s.selected = new Set(all.checked ? snapshot.rows.map(row => row.id) : []);
      for (const item of checks) item.check.checked = s.selected.has(item.id);
      update();
    };
    body.append(list);
    footer.append(button('취소', closeSession, 'secondary'), next); update();
  }

  function openConfirmation(s) {
    if (session !== s || s.busy || !s.selected.size || s.confirm) return;
    // Capture this exact selection; checkboxes in the underlying modal are inert.
    const ids = Object.freeze([...s.selected]);
    const ui = makeDialog('삭제 전 원본 제목 확인'); s.confirm = ui.dialog;
    const dismiss = () => { if (s.busy) return; ui.dialog.close(); ui.dialog.remove(); s.confirm = null; };
    ui.close.onclick = dismiss;
    ui.dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    ui.body.append(el('p', `선택한 세션 ${ids.length}개를 서버에서 삭제합니다. 삭제한 대화는 되돌릴 수 없습니다.`, 'warning'));
    ui.body.append(el('p', '아래 원본 작품 제목을 공백까지 그대로 입력해 주세요.', 'muted'), el('strong', s.snapshot.title, 'confirm-title'));
    const label = el('label', '원본 작품 제목'); label.htmlFor = 'bulk-confirm-input';
    const input = el('input'); input.id = 'bulk-confirm-input'; input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false;
    const hint = el('p', '세션에서 바꾼 이름이 아닌 원본 작품 제목입니다.', 'muted small');
    hint.id = 'bulk-confirm-hint'; input.setAttribute('aria-describedby', hint.id);
    ui.body.append(label, input, hint);
    const cancel = button('돌아가기', dismiss, 'secondary');
    const confirm = button(`${ids.length}개 영구 삭제`, async () => {
      if (s.busy || input.value !== s.snapshot.title) return;
      const typedTitle = input.value;
      s.busy = true; s.stopping = false;
      confirm.disabled = true; cancel.disabled = true; ui.close.disabled = true; input.disabled = true; s.close.disabled = true;
      const status = el('p', '삭제 대상 재확인 중…', 'status'); status.setAttribute('role', 'status'); ui.body.append(status);
      const stop = button('남은 삭제 중단', () => { s.stopping = true; stop.disabled = true; stop.textContent = '현재 요청 완료 후 중단…'; });
      ui.footer.replaceChildren(stop);
      const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
      window.addEventListener('beforeunload', beforeUnload);
      try {
        s.result = await deleteSelection(s.api, s.snapshot, ids, typedTitle, { guard: s.guard, shouldStop: () => s.stopping, onProgress: text => { status.textContent = text; } });
      } catch (error) {
        s.result = { acknowledged: [], uncertain: [], pending: [...ids], error };
      } finally {
        window.removeEventListener('beforeunload', beforeUnload);
        s.busy = false; s.close.disabled = false; dismiss();
      }
      renderResult(s);
    }, 'danger');
    confirm.disabled = true;
    input.addEventListener('input', () => { confirm.disabled = input.value !== s.snapshot.title; });
    // Enter does not submit: the user explicitly presses the final delete button.
    ui.footer.append(cancel, confirm); ui.dialog.showModal(); input.focus();
  }

  function renderResult(s) {
    const result = s.result;
    s.body.replaceChildren(); s.footer.replaceChildren();
    s.body.append(el('p', s.snapshot.title, 'work-title'));
    const message = el('p', `삭제 요청 완료 ${result.acknowledged.length}개 · 결과 확인 필요 ${result.uncertain.length}개 · 미요청 ${result.pending.length}개`, 'status');
    message.setAttribute('role', 'status'); s.body.append(message);
    if (result.error) s.body.append(el('p', errorText(result.error), 'warning'));
    if (result.uncertain.length) s.body.append(el('p', '요청 결과가 불확실한 세션은 자동으로 재시도하지 않습니다. 목록을 새로고침한 뒤 남아 있는 세션을 확인하세요.', 'muted'));
    if (result.stopped) s.body.append(el('p', '남은 삭제 요청을 중단했습니다. 완료된 삭제는 유지됩니다.', 'muted'));
    const byId = new Map(s.snapshot.rows.map(row => [row.id, row]));
    for (const [title, ids] of [['삭제 요청 완료', result.acknowledged], ['결과 확인 필요', result.uncertain], ['미요청', result.pending]]) {
      if (!ids.length) continue;
      const details = el('details'), list = el('ul'); details.append(el('summary', `${title} ${ids.length}개`));
      for (const id of ids) list.append(el('li', `${byId.get(id)?.title || ''} · ${id}`));
      details.append(list); s.body.append(details);
    }
    s.footer.append(button('닫기', closeSession, 'secondary'), button('목록 새로고침', () => refreshPage(s)));
  }

  // Bind a portal menu to its own trigger, never to the current route or title text.
  function contextFromTrigger(trigger) {
    if (!(trigger instanceof Element)) return null;
    const anchor = trigger.closest('a[href]');
    if (anchor) return parseEpisode(anchor.href, location.origin);
    const row = trigger.closest('[data-index],li');
    if (!row) return null;
    const candidates = [...row.querySelectorAll('a[href]')].map(a => parseEpisode(a.href, location.origin)).filter(Boolean);
    return candidates.length === 1 ? candidates[0] : null;
  }
  let recentTrigger = null, recentAt = 0;
  const menuBindings = new WeakMap();
  const menuKeyHandlers = new WeakMap();
  const menuScheduler = createMenuScheduler(scanMenus);
  const TRIGGER = 'button[aria-haspopup="menu"],button[aria-label="채팅방 메뉴"]';
  function remember(event) {
    if (event.type === 'keydown' && !['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
    const trigger = event.target instanceof Element ? event.target.closest(TRIGGER) : null;
    if (!trigger) return;
    recentTrigger = contextFromTrigger(trigger) ? trigger : null;
    recentAt = Date.now();
    if (recentTrigger) menuScheduler.request(recentTrigger);
    else menuScheduler.cancel();
  }
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('click', remember, true);
  document.addEventListener('keydown', remember, true);

  function menuTrigger(menu) {
    const labelledBy = menu.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const trigger = document.getElementById(id);
        if (trigger?.matches(TRIGGER) && contextFromTrigger(trigger)) return trigger;
      }
      return null; // An unrelated labelled menu must never reuse the last session.
    }
    const bound = menuBindings.get(menu);
    if (bound?.isConnected && bound.getAttribute('aria-expanded') === 'true' && contextFromTrigger(bound)) return bound;
    if (recentTrigger?.isConnected && recentTrigger.getAttribute('aria-expanded') === 'true' && Date.now() - recentAt < 2500) return recentTrigger;
    return null;
  }
  function scanMenus(expectedTrigger) {
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      const trigger = menuTrigger(menu);
      if (trigger !== expectedTrigger || menu.getAttribute('data-state') === 'closed' || !menu.getClientRects().length) continue;
      const existing = menu.querySelector('[data-episode-bulk-delete]');
      const actions = [...menu.querySelectorAll('[role="menuitem"]')];
      const remove = actions.find(item => item.textContent.trim() === '삭제하기');
      const rename = actions.some(item => item.textContent.trim() === '이름 변경하기');
      if (!remove || !rename) continue;
      if (existing) return true;
      menuBindings.set(menu, trigger);
      const item = button('같은 작품 세션 일괄 삭제', async event => {
        event.preventDefault(); event.stopPropagation();
        if (session) return;
        const boundTrigger = menuTrigger(menu), context = contextFromTrigger(boundTrigger);
        if (!context) return;
        // Dismiss Radix first so its focus trap cannot steal focus from the dialog.
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        for (let i = 0; i < 25 && menu.isConnected; i++) await pause(20);
        if (menu.isConnected && boundTrigger.getAttribute('aria-expanded') === 'true') boundTrigger.click();
        for (let i = 0; i < 25 && menu.isConnected; i++) await pause(20);
        if (!menu.isConnected || boundTrigger.getAttribute('aria-expanded') !== 'true') openSessions(context, boundTrigger);
      });
      item.dataset.episodeBulkDelete = 'true'; item.setAttribute('role', 'menuitem'); item.tabIndex = 0;
      item.className = remove.className;
      item.style.cssText = 'display:flex;width:100%;align-items:center;text-align:left;white-space:nowrap;color:#ff9dab;border:0;border-top:1px solid #5555;border-radius:4px;background:transparent;padding:9px 8px;cursor:pointer;font:inherit;pointer-events:auto';
      item.addEventListener('keydown', event => {
        if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); item.click(); }
      });
      // Native Radix roving focus does not register externally inserted items.
      const onMenuKey = event => {
        if (event.key === 'ArrowDown' && event.target === remove) { event.preventDefault(); event.stopImmediatePropagation(); item.focus(); }
        else if (event.target === item && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); event.stopImmediatePropagation();
          (event.key === 'ArrowUp' ? remove : actions[0])?.focus();
        }
      };
      const previousHandler = menuKeyHandlers.get(menu);
      if (previousHandler) menu.removeEventListener('keydown', previousHandler, true);
      menu.addEventListener('keydown', onMenuKey, true);
      menuKeyHandlers.set(menu, onMenuKey);
      menu.append(item);
      return true;
    }
    return false;
  }
})();
