// ==UserScript==
// @name         크래커 소멸 알림
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @auther       지유지요
// @description  선입선출 잔여 크래커의 소멸일을 오른쪽 하단 팝업으로 알립니다.
// @match        https://crack.wrtn.ai/*
// @require      https://raw.githubusercontent.com/workforomg/Utill/5f3fe67071b29ed447dc178f15b0f34a3c0a6128/dist/index.js
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(() => {
  'use strict';
  const DAY = 86400000;
  const EPS = 1e-6;
  const DEFAULTS = { enabled: true, period: 'daily', days: 3, milestones: [7, 3, 1, 0], frequency: 'daily' };
  const dayNumber = time => Math.floor((time + 9 * 3600000) / DAY);
  const dayKey = time => new Date(time + 9 * 3600000).toISOString().slice(0, 10);
  function amount(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('크래커 수량 형식을 확인할 수 없습니다.');
    return value;
  }
  function readBalance(data) {
    return { free: amount(data?.free), paid: amount(data?.paid) };
  }
  function grantAmounts(row) {
    if (row.consumedType === 'free') return { free: amount(row.balance?.total), paid: 0 };
    if (row.consumedType === 'paid') return { free: 0, paid: amount(row.balance?.total) };
    if (row.consumedType === 'mix') {
      const result = readBalance(row.balance);
      if (Math.abs(result.free + result.paid - amount(row.balance?.total)) > EPS) throw new Error('내역의 수량 합계가 일치하지 않습니다.');
      return result;
    }
    throw new Error('알 수 없는 크래커 지급 유형입니다.');
  }
  // Under FIFO, the current balance consists of the newest unexpired grants.
  // Never subtract the overall balance directly from expiring grants only:
  // newer/non-expiring grants and free/paid balances must participate separately.
  function remainingGrants(history, balance, now) {
    const left = readBalance(balance);
    const result = [];
    const seen = new Set();
    const rows = history.slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const checkedTimes = new Set();
    for (const row of rows) {
      if (row.product !== 'cracker' || row.consumedType === 'unlimited') continue;
      if (typeof row.isConsumed !== 'boolean') throw new Error('내역의 사용 여부를 확인할 수 없습니다.');
      if (row.isConsumed) continue;
      const id = row.id ?? row._id;
      if (id != null) {
        if (seen.has(id)) throw new Error('중복된 내역입니다. 다시 조회해 주세요.');
        seen.add(id);
      }
      if (!Number.isFinite(Date.parse(row.date))) throw new Error('획득일 형식을 확인할 수 없습니다.');
      const expires = row.expiredAt == null ? Infinity : Date.parse(row.expiredAt);
      if (Number.isNaN(expires)) throw new Error('소멸일 형식을 확인할 수 없습니다.');
      if (expires <= now) continue;
      // An API timestamp tie cannot establish FIFO order. Do not invent which
      // differently expiring grant survives a partial consumption within the tie.
      if (!checkedTimes.has(row.date)) {
        checkedTimes.add(row.date);
        const tied = rows.filter(other => other.date === row.date && other.product === 'cracker' && other.isConsumed === false && other.consumedType !== 'unlimited' && (other.expiredAt == null || Date.parse(other.expiredAt) > now));
        for (const kind of ['free', 'paid']) {
          const relevant = tied.filter(other => grantAmounts(other)[kind] > EPS);
          const total = relevant.reduce((sum, other) => sum + grantAmounts(other)[kind], 0);
          if (left[kind] > EPS && left[kind] < total - EPS && new Set(relevant.map(other => other.expiredAt ?? null)).size > 1) throw new Error('같은 시각에 지급된 내역의 사용 순서를 확인할 수 없습니다.');
        }
      }
      const grant = grantAmounts(row);
      const free = Math.min(left.free, grant.free);
      const paid = Math.min(left.paid, grant.paid);
      left.free -= free;
      left.paid -= paid;
      if (free + paid > EPS) result.push({ expires, acquiredAt: Date.parse(row.date), free, paid, quantity: free + paid });
    }
    return { grants: result, complete: left.free <= EPS && left.paid <= EPS };
  }
  function selectAlerts(grants, settings, now) {
    const grouped = new Map();
    for (const grant of grants) {
      if (!Number.isFinite(grant.expires) || grant.expires <= now || grant.quantity <= EPS) continue;
      const days = dayNumber(grant.expires) - dayNumber(now);
      if (settings.period === 'milestones' ? !settings.milestones.includes(days) : days > settings.days) continue;
      const key = dayKey(grant.expires);
      const entry = grouped.get(key) ?? { date: key, days, quantity: 0, expires: grant.expires };
      entry.quantity += grant.quantity;
      entry.expires = Math.min(entry.expires, grant.expires);
      grouped.set(key, entry);
    }
    return [...grouped.values()].sort((a, b) => a.expires - b.expires);
  }
  const unwrap = response => response && Object.hasOwn(response, 'data') ? response.data : response;
  async function loadRemaining(api, now, signal) {
    const getBalance = async () => readBalance(unwrap(await api.request('/crack-cash/cash/balance', { signal })));
    const balance = await getBalance();
    if (balance.free + balance.paid <= EPS) return [];
    const history = [];
    const pages = new Set();
    let lastDate = Infinity;
    let firstPage;
    for (let page = 1; page <= 500; page++) {
      const rows = unwrap(await api.request('/crack-cash/cash/history', { query: { page, limit: 10, type: 'all' }, signal }));
      if (!Array.isArray(rows)) throw new Error('크래커 내역 응답 형식이 변경되었습니다.');
      const fingerprint = JSON.stringify(rows);
      if (page === 1) firstPage = fingerprint;
      if (pages.has(fingerprint)) throw new Error('내역 페이지가 반복되어 계산을 중단했습니다.');
      pages.add(fingerprint);
      for (const row of rows) {
        const date = Date.parse(row.date);
        if (!Number.isFinite(date) || date > lastDate) throw new Error('내역의 최신순 정렬을 확인할 수 없습니다.');
        lastDate = date;
      }
      history.push(...rows);
      const result = remainingGrants(history, balance, now);
      // Read beyond the oldest surviving grant's timestamp so a tie spanning
      // two pages cannot silently choose the wrong expiration date.
      const oldestSurvivor = Math.min(...result.grants.map(grant => grant.acquiredAt));
      if (result.complete && (rows.length < 10 || Date.parse(rows.at(-1).date) < oldestSurvivor)) {
        const after = await getBalance();
        const head = unwrap(await api.request('/crack-cash/cash/history', { query: { page: 1, limit: 10, type: 'all' }, signal }));
        if (Math.abs(after.free - balance.free) > EPS || Math.abs(after.paid - balance.paid) > EPS || JSON.stringify(head) !== firstPage) {
          throw new Error('조회 도중 잔액 또는 내역이 변경되었습니다. 잠시 후 다시 확인해 주세요.');
        }
        return result.grants;
      }
      if (rows.length < 10) throw new Error('현재 잔액을 내역과 대조할 수 없어 알림을 표시하지 않았습니다.');
    }
    throw new Error('내역 조회 한도를 초과하여 알림을 표시하지 않았습니다.');
  }
  // The same production functions are exercised by node:test without browser side effects.
  if (typeof module === 'object' && module.exports) {
    module.exports = { remainingGrants, selectAlerts, loadRemaining, dayKey, DEFAULTS };
    return;
  }

  const STORE = 'cracker-expiry-v1';
  let settings = { ...DEFAULTS, ...GM_getValue(STORE, {}) };
  let menuIds = [];
  let popup;
  let popupTimer;
  let controller;
  let requestVersion = 0;
  let busy = false;
  let pending = 0;
  let lastUrl = location.href;
  let lastToken = token();
  let lastDay = dayKey(Date.now());
  let lastRefresh = 0;
  const api = globalThis.Crack.createCrackAPI({ timeout: 15000, token });

  function token() { return globalThis.Crack.readCookie('access_token')?.replace(/^Bearer\s+/i, '').trim() || ''; }
  async function accountKey(value) {
    // Store only an irreversible digest; token contents never leave the API request.
    let identity = value;
    try {
      const part = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(part));
      identity = String(payload.sub ?? payload.userId ?? payload.id ?? value);
    } catch { /* Opaque token: digest it rather than persisting credentials. */ }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function closePopup() {
    clearTimeout(popupTimer);
    popup?.remove();
    popup = null;
  }
  function element(tag, text, parent) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  }
  function showPopup(alerts, message) {
    closePopup();
    popup = document.createElement('div');
    popup.id = 'cracker-expiry-popup';
    popup.style.cssText = 'all:initial;position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));width:min(350px,calc(100vw - 32px));z-index:2147483647;color-scheme:dark';
    const root = popup.attachShadow({ mode: 'open' });
    element('style', `
      *{box-sizing:border-box} section{font:14px/1.6 system-ui,sans-serif;color:#f4f4f5;background:#202127;border:1px solid #45464f;border-radius:16px;padding:18px;box-shadow:0 12px 40px #0006}
      header{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:16px;margin:0}button,a{font:inherit;color:inherit}button{cursor:pointer;background:#36373e;border:0;border-radius:8px;padding:6px 10px}button:focus-visible,a:focus-visible{outline:2px solid #b9a2ff;outline-offset:3px}
      strong{color:#c9b7ff;font-size:22px}p{margin:12px 0}ul{list-style:none;padding:0;margin:12px 0;max-height:min(220px,35vh);overflow:auto}li{padding:8px 0;border-top:1px solid #383941;display:flex;justify-content:space-between;gap:12px}small{color:#b9bac4}footer{display:flex;align-items:center;justify-content:space-between;gap:10px}a{color:#d0beff;text-underline-offset:3px}
    `, root);
    const panel = element('section', undefined, root);
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    const header = element('header', undefined, panel);
    element('h2', '크래커 소멸 알림', header);
    const close = element('button', '×', header);
    close.setAttribute('aria-label', '알림 닫기');
    const dismiss = () => { requestVersion++; controller?.abort(); pending = 0; closePopup(); };
    close.onclick = dismiss;
    if (alerts.length) {
      const summary = element('p', undefined, panel);
      element('strong', `${alerts.reduce((sum, row) => sum + row.quantity, 0).toLocaleString('ko-KR', { maximumFractionDigits: 6 })}개`, summary);
      summary.append('의 소멸일이 가까워요.');
      const list = element('ul', undefined, panel);
      for (const row of alerts) {
        const item = element('li', undefined, list);
        element('span', `${row.days === 0 ? '오늘 소멸' : `D-${row.days}`} · ${row.date.slice(5).replace('-', '/')}`, item);
        element('span', `${row.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 6 })}개`, item);
      }
      element('small', '한국 시간 기준 · 선입선출 잔여 수량', panel);
      // Remove displayed quantities at the next deadline, even if the tab stays open.
      popupTimer = setTimeout(closePopup, Math.min(2147483647, Math.max(1, alerts[0].expires - Date.now())));
    } else element('p', message, panel);
    const footer = element('footer', undefined, panel);
    const link = element('a', '크래커 내역 보기', footer);
    link.href = '/cracker/history';
    const refresh = element('button', '다시 확인', footer);
    refresh.onclick = () => check(true);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
    document.body.append(popup);
  }
  function save() {
    GM_setValue(STORE, settings);
    requestVersion++;
    controller?.abort();
    closePopup();
    registerMenus();
    check(true);
  }
  function registerMenus() {
    menuIds.forEach(id => GM_unregisterMenuCommand(id));
    menuIds = [];
    const menu = (label, fn) => menuIds.push(GM_registerMenuCommand(label, fn));
    menu(`소멸 팝업: ${settings.enabled ? '켜짐' : '꺼짐'} (전환)`, () => { settings.enabled = !settings.enabled; save(); });
    menu(`알림 주기: ${settings.period === 'daily' ? '매일' : '소멸 D-day 지정'} (전환)`, () => { settings.period = settings.period === 'daily' ? 'milestones' : 'daily'; save(); });
    menu(`매일 알림 범위: ${settings.days}일 전부터`, () => {
      const value = prompt('소멸 며칠 전부터 매일 알릴까요? (0~365, 0은 당일)', String(settings.days));
      if (value === null) return;
      const days = Number(value);
      if (!value.trim() || !Number.isInteger(days) || days < 0 || days > 365) return alert('0~365 사이의 정수를 입력해 주세요.');
      settings.days = days; save();
    });
    menu(`소멸일 지정: D-${settings.milestones.join(', D-')}`, () => {
      const value = prompt('알림을 받을 소멸 D-day를 쉼표로 입력하세요. 예: 7,3,1,0 (0은 당일)', settings.milestones.join(','));
      if (value === null) return;
      const parts = value.split(',');
      const days = parts.map(Number);
      if (parts.some(part => !part.trim()) || days.some(day => !Number.isInteger(day) || day < 0 || day > 365)) return alert('0~365 사이의 정수를 쉼표로 구분해 주세요.');
      settings.milestones = [...new Set(days)].sort((a, b) => b - a); save();
    });
    menu(`표시 빈도: ${settings.frequency === 'daily' ? '하루 첫 접속 시' : '사이트 이동마다'} (전환)`, () => { settings.frequency = settings.frequency === 'daily' ? 'visit' : 'daily'; save(); });
    menu('지금 확인 (오늘 표시 여부 무시)', () => check(true));
  }
  async function check(manual = false, refreshOnly = false) {
    if (busy) { pending = Math.max(pending, manual ? 2 : refreshOnly ? 0 : 1); return; }
    if (!settings.enabled || document.hidden && !manual) return;
    const startToken = token();
    if (!startToken) { closePopup(); if (manual) showPopup([], '크랙에 로그인한 뒤 다시 확인해 주세요.'); return; }
    busy = true;
    const version = ++requestVersion;
    controller = new AbortController();
    const signal = controller.signal;
    const work = async () => {
      const key = `${STORE}:shown:${await accountKey(startToken)}`;
      if (!manual && !refreshOnly && settings.frequency === 'daily' && GM_getValue(key, '') === dayKey(Date.now())) return;
      const grants = await loadRemaining(api, Date.now(), signal);
      if (version !== requestVersion || startToken !== token() || document.hidden) return;
      const alerts = selectAlerts(grants, settings, Date.now());
      closePopup();
      if (alerts.length) {
        showPopup(alerts);
        GM_setValue(key, dayKey(Date.now()));
      } else if (manual) showPopup([], '설정한 기간 안에 소멸할 미사용 크래커가 없습니다.');
      lastRefresh = Date.now();
    };
    try {
      // Serialize tabs on this origin so only the first visible tab shows a daily alert.
      if (navigator.locks) await navigator.locks.request(STORE, { signal }, work);
      else await work();
    } catch (error) {
      if (version === requestVersion) {
        closePopup();
        if (manual) showPopup([], error.status === 401 ? '로그인을 다시 확인해 주세요.' : '조회에 실패했습니다. 잠시 후 다시 확인해 주세요.');
        console.warn('[크래커 소멸 알림] 조회 또는 잔액 대조 실패. 알림을 보류합니다.');
      }
    } finally {
      busy = false;
      if (pending) { const next = pending; pending = 0; check(next === 2); }
    }
  }
  function tick() {
    const currentToken = token();
    const day = dayKey(Date.now());
    const changed = location.href !== lastUrl || currentToken !== lastToken || day !== lastDay;
    if (changed) {
      lastUrl = location.href; lastToken = currentToken; lastDay = day;
      requestVersion++; controller?.abort(); closePopup();
      check();
    } else if (popup && Date.now() - lastRefresh > 30000) check(false, true);
  }
  // URL polling also sees pushState/replaceState in Tampermonkey's isolated world.
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); check(); } });
  window.addEventListener('focus', () => check(false, Boolean(popup)));
  registerMenus();
  check();
})();
