// ==UserScript==
// @name         이전 신작들
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @updateURL    https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EC%9D%B4%EC%A0%84%EC%8B%A0%EC%9E%91.user.js
// @downloadURL  https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EC%9D%B4%EC%A0%84%EC%8B%A0%EC%9E%91.user.js
// @author       지유지요
// @description  오늘 신작을 중복 없이 7일간 기록합니다. 날짜별 조회, isAdult 기반 모두·세이프·언세이프 필터와 실제 상세페이지 이동을 지원합니다.
// @match        https://crack.wrtn.ai/*
// @require      https://raw.githubusercontent.com/workforomg/Utill/main/dist/index.js
// @require      https://raw.githubusercontent.com/workforomg/Utill/main/dist/ui.js
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      crack-api.wrtn.ai
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * SDK source/API contract checked: 2026-09-18.
 *   dist/index.js   -> Crack.createLibraryAPI().stories({ query }, { signal })
 *                   Crack.createCrackAPI().story.getPublic(id, { signal })
 *   dist/ui.js      -> CrackUI.createPageUI().resolve('nav.images')
 * These are external @require dependencies, NOT pasted copies of the SDK.
 * Only GET story lists and GET public story details are allowed by the transport.
 * v1.0.1: image candidates, same-ID image repair, referrer retry, detail fallback.
 * v1.0.2: read the observed portraitImage { origin, w200, w600, gif, gif600 } shape.
 * Prefer w600, then w200, origin, gif600, gif; never synthesize image URLs.
 * v1.0.3: exact API isAdult boolean filter (all / safe / unsafe).
 * Existing records are updated in place; unknown ratings are never guessed safe.
 * Filtering is local display only, not an API query or collection restriction.
 * IndexedDB stores/indexes and firstSeenAt retention rules are unchanged.
 * Existing IndexedDB names/keys/timestamps are deliberately unchanged.
 * Storage: this browser / this site, IndexedDB. No remote archive, no analytics.
 * The date is the first observation date in Asia/Seoul, NOT a claimed release date.
 * Does not backfill missed days or bypass login/age/visibility restrictions.
 * Integration note: live authenticated Crack responses/DOM were not available
 * during authoring. Unknown list/pagination shapes are reported, not erased.
 */
(() => {
  'use strict';
  if (window.top !== window.self) return;

  const C = Object.freeze({
    DB: 'crack-new-release-history-v1',
    DB_VERSION: 1,
    RETENTION: 7 * 24 * 60 * 60 * 1000,
    POLL: 5 * 60 * 1000,
    MAINTENANCE: 60 * 1000,
    REQUEST_TIMEOUT: 25 * 1000,
    PAGE_DELAY: 450,
    MAX_PAGES: 200,
    LEASE: 90 * 1000,
    MANUAL_COOLDOWN: 15 * 1000,
    PAGE_SIZE: 24,
    RATING_BATCH: 50,
    API_ORIGIN: 'https://crack-api.wrtn.ai',
    API_PATH: '/crack-api/stories',
    SITE_ORIGIN: 'https://crack.wrtn.ai',
    BUTTON_ID: 'crh-history-navigation',
    HOST_ID: 'crh-history-modal-host',
    RESTORE_KEY: 'crh-history-return-v1',
  });
  const NOTICE = '확프를 켜고 크랙 페이지를 열어 둔 동안, ‘오늘 신작’에서 확인한 작품을 자동 기록합니다. 보관 중인 동일 작품은 다시 저장하지 않으며, 처음 기록한 시각부터 7일(168시간)이 지나면 자동 삭제됩니다. 날짜는 실제 출시일이 아닌 최초 수집일(한국 시간)입니다. 꺼 둔 동안 놓친 신작은 복구할 수 없고, 만료 기록은 다음 실행 시에도 정리됩니다.';
  const OWNER = globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const SDK = globalThis.CrackLibrary ?? globalThis.Crack;
  const UI = globalThis.CrackUI;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(C.DB) : null;
  let library, detailAPI, pageUI, databasePromise, latestEnvelope, running = false, stopped = false;
  let activeController, modal, maintenanceTimer, mountingTimer, mutationObserver, themeObserver;
  let state = { phase: 'idle', message: '기록을 준비하고 있습니다.', last: null };
  let lastPrune = 0, lastRoute = location.pathname, lastMaintenance = 0, previousTheme = '';

  class ArchiveError extends Error {
    constructor(message, code = 'ArchiveError') { super(message); this.name = code; }
  }
  const text = (v, max = 500) => (typeof v === 'string' || typeof v === 'number') ? String(v).trim().slice(0, max) : '';
  const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const own = (obj, key) => isObject(obj) && Object.prototype.hasOwnProperty.call(obj, key);
  const dateKey = (time = Date.now()) => new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const localTime = time => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(time));
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const firstText = (...vs) => vs.map(v => text(v, 4000)).find(Boolean) || '';
  function countValue(...values) {
    for (const v of values) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
      if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v);
    }
    return null;
  }
  // Accept image URLs, not arbitrary identifiers masquerading as site-relative paths.
  // Preserve signed query strings; decode HTML ampersands, not URL path/query bytes.
  function imageURL(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 8192) return '';
    let raw = value.trim().replace(/&(?:amp|#0*38|#x0*26);/gi, '&');
    if (/^https?%3a/i.test(raw)) { try { raw = decodeURIComponent(raw); } catch { return ''; } }
    if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(raw)) raw = `https://${raw}`;
    if (!/^(?:https?:\/\/|\/\/|\/(?!\/))/i.test(raw)) return '';
    try {
      const url = new URL(raw, C.SITE_ORIGIN);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      return url.href;
    } catch { return ''; }
  }
  function imageURLs(value) {
    const out = [], visited = new Set();
    let budget = 160;
    const visit = (v, depth = 0) => {
      if (depth > 6 || --budget < 0 || out.length >= 12) return;
      if (typeof v === 'string') {
        const url = imageURL(v);
        if (url && !out.includes(url)) {
          out.push(url);
          // Retain an observed optimizer URL, with its original URL as a fallback.
          const parsed = new URL(url);
          if (parsed.pathname === '/_next/image') visit(parsed.searchParams.get('url'), depth + 1);
        } else if (!url && /^[\[{]/.test(v.trim())) {
          try { visit(JSON.parse(v), depth + 1); } catch {}
        }
        return;
      }
      if (!v || typeof v !== 'object' || visited.has(v)) return;
      visited.add(v);
      if (Array.isArray(v)) { v.slice(0, 12).forEach(x => visit(x, depth + 1)); return; }
      // Only traverse image/asset fields. Never pick a creator's avatar, prompt,
      // chat attachment or an unrelated URL by recursively walking a whole story.
      // Crack's actual portraitImage response uses these variant keys.
      // The API/SDK already returns them; do not guess file-name suffixes.
      const priority = ['w600','w200','origin','gif600','gif',
        'url','src','uri','imageUrl','imageURL','thumbnailUrl','originalUrl','original',
        'publicUrl','cdnUrl','fileUrl','secureUrl','path','thumbnail','image','images',
        'small','medium','large','mobile','desktop','web','webp','avif','png','jpeg','jpg',
        'variants','formats','sizes','urls','asset','file','data'];
      const keys = [...new Set([...priority, ...Object.keys(v).filter(k => /image|thumbnail|cover|poster|picture/i.test(k))])];
      for (const key of keys) if (own(v, key)) visit(v[key], depth + 1);
    };
    visit(value);
    return out;
  }
  function safeImage(value) { return imageURLs(value)[0] || ''; }
  function uniqueImages(values, max = 12) {
    return [...new Set(values.flatMap(imageURLs))].slice(0, max);
  }
  function storyImages(item) {
    if (!isObject(item)) return [];
    const nested = isObject(item.story) ? item.story : isObject(item.content) ? item.content : item;
    const roots = nested === item ? [item] : [nested, item];
    const values = [];
    for (const root of roots) {
      const preferred = ['portraitImage','thumbnailImageUrl','thumbnailUrl','thumbnailImage','thumbnail','thumbnails',
        'coverImageUrl','coverImage','coverUrl','cover','mainImageUrl','mainImage',
        'profileImageUrl','profileImage','imageUrl','imageURL','image','imageUrls','images',
        'representativeImageUrl','representativeImage','posterUrl','poster','media','assets'];
      const keys = [...new Set([...preferred, ...Object.keys(root).filter(k =>
        /^(?:(?:story|content|main|profile|representative|preview|display|card|vertical|portrait|background)[_-]?)?(?:image|thumbnail|thumb|cover|poster|picture)/i.test(k))])];
      for (const key of keys) if (own(root, key) && !/^(?:creator|author|user|avatar)/i.test(key)) values.push(root[key]);
    }
    return uniqueImages(values);
  }
  let siteImageSnapshot = { at: 0, path: '', images: new Map() };
  function domStoryImages(id) {
    const now = Date.now();
    if (now - siteImageSnapshot.at > 2000 || siteImageSnapshot.path !== location.pathname) {
      const images = new Map();
      for (const link of [...document.querySelectorAll('a[href*="/detail/"],a[href*="/stories/"]')].slice(0, 800)) {
        try {
          const url = new URL(link.getAttribute('href'), C.SITE_ORIGIN);
          const match = /^\/(?:detail|stories)\/([a-zA-Z0-9_-]{1,128})\/?$/.exec(url.pathname);
          if (url.origin !== C.SITE_ORIGIN || !match) continue;
          const candidates = [...link.querySelectorAll('img')].filter(img =>
            img.complete && img.naturalWidth > 32 && !/avatar|rounded-full/i.test(`${img.className} ${img.getAttribute('alt') || ''}`));
          candidates.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
          const urls = uniqueImages(candidates.map(img => img.currentSrc || img.getAttribute('src')));
          if (urls.length) images.set(match[1], uniqueImages([...(images.get(match[1]) || []), ...urls]));
        } catch {}
      }
      siteImageSnapshot = { at: now, path: location.pathname, images };
    }
    return siteImageSnapshot.images.get(id) || [];
  }
  function recordImages(record) { return uniqueImages([record.thumbnail, ...(record.imageCandidates || [])]); }
  function mergeImageFields(existing, incoming) {
    const candidates = uniqueImages([...recordImages(incoming), ...recordImages(existing)]);
    if (!candidates.length) return null;
    if (existing.thumbnail === candidates[0] && JSON.stringify(existing.imageCandidates || []) === JSON.stringify(candidates) && existing.imageSchema === 1) return null;
    // This is an in-place image-only repair, NOT another observation/record.
    // firstSeenAt, day, title, description and the retention clock are untouched.
    return { ...existing, thumbnail: candidates[0], imageCandidates: candidates, imageSchema: 1 };
  }
  // Preserve false as a real value. Do not combine isAdult with isNSFW/ageRating,
  // coerce strings, or classify a missing/invalid value as safe.
  function storyAdult(item) {
    if (!isObject(item)) return null;
    const story = isObject(item.story) ? item.story : isObject(item.content) ? item.content : item;
    if (own(story, 'isAdult')) return typeof story.isAdult === 'boolean' ? story.isAdult : null;
    return story !== item && own(item, 'isAdult') && typeof item.isAdult === 'boolean' ? item.isAdult : null;
  }
  function recordAdult(record) {
    // v1.0.2's `adult` was derived from several fields, so it is not a reliable
    // substitute for the original isAdult boolean. Reconfirm legacy entries.
    return typeof record?.isAdult === 'boolean' ? record.isAdult : null;
  }
  function matchesAdult(record, filter = 'all') {
    if (filter === 'all') return true;
    if (filter === 'safe') return recordAdult(record) === false;
    if (filter === 'unsafe') return recordAdult(record) === true;
    return false;
  }
  function mergeObservedFields(existing, incoming) {
    const images = mergeImageFields(existing, incoming);
    const rating = recordAdult(incoming);
    const changed = rating !== null && (existing.isAdult !== rating || existing.adult !== rating);
    if (!images && !changed) return null;
    // No title, ID, firstSeenAt, day, or dedupe/retention timestamp is replaced.
    return changed ? { ...(images || existing), isAdult: rating, adult: rating } : images;
  }
  function detailURL(id, rawURL) {
    if (typeof rawURL === 'string') {
      try {
        const url = new URL(rawURL, C.SITE_ORIGIN);
        const match = /^\/(?:detail|stories)\/([^/]+)\/?$/.exec(url.pathname);
        if (url.origin === C.SITE_ORIGIN && match && decodeURIComponent(match[1]) === id && !url.username && !url.password) {
          return url.origin + url.pathname; // Do not retain tracking/login parameters.
        }
      } catch { /* Use the site's ordinary detail route. */ }
    }
    return `${C.SITE_ORIGIN}/detail/${encodeURIComponent(id)}`;
  }
  function normalizeStory(item, seenAt = Date.now()) {
    if (!isObject(item)) return null;
    const s = isObject(item.story) ? item.story : isObject(item.content) ? item.content : item;
    const id = firstText(s._id, s.id, s.storyId, s.contentId, item.storyId);
    if (!validId(id)) return null;
    const author = s.creatorProfile ?? s.creator ?? s.author ?? s.profile ?? s.user ?? {};
    const title = firstText(s.title, s.name, s.storyName) || `제목 미제공 · ${id.slice(-6)}`;
    const description = firstText(s.description, s.introduction, s.summary, s.shortDescription, s.synopsis);
    const tagsSource = s.tags ?? s.hashtags ?? s.hashTags ?? s.genres ?? [];
    const tags = [...new Set((Array.isArray(tagsSource) ? tagsSource : typeof tagsSource === 'string' ? tagsSource.split(/[,#]/) : [])
      .map(t => text(isObject(t) ? (t.name ?? t.tag ?? t.label ?? t.title) : t, 60)).filter(Boolean))].slice(0, 16);
    const imageCandidates = uniqueImages([...storyImages(item), ...domStoryImages(id)]);
    const thumbnail = imageCandidates[0] || '';
    return {
      id, title: text(title, 300), description: text(description, 2400), thumbnail, imageCandidates, imageSchema: 1,
      author: text(typeof author === 'string' ? author : firstText(author.nickname, author.nickName, author.name, author.username, s.creatorName, s.authorName), 120),
      tags, detailUrl: detailURL(id, s.detailUrl ?? s.detailPageUrl ?? s.url),
      chatCount: countValue(s.chatCount, s.playCount, s.conversationCount, s.totalChatCount, s.messageCount, s.statistics?.chatCount, s.stats?.chatCount),
      likeCount: countValue(s.likeCount, s.likesCount, s.statistics?.likeCount, s.stats?.likeCount),
      isAdult: storyAdult(item), adult: storyAdult(item) === true,
      firstSeenAt: seenAt, day: dateKey(seenAt),
    };
  }

  // Unwrap only known collection envelopes. A malformed response is NOT an empty day.
  function extractPage(response) {
    const roots = [];
    let current = response;
    for (let depth = 0; depth < 4 && isObject(current); depth++) {
      roots.push(current);
      if (!own(current, 'data')) break;
      current = current.data;
    }
    if (Array.isArray(current)) return { items: current, roots, source: 'array' };
    for (const root of [...roots].reverse()) {
      for (const key of ['stories', 'items', 'results', 'contents', 'list']) {
        if (Array.isArray(root[key])) return { items: root[key], roots: [...roots, root.pagination, root.pageInfo, root.meta].filter(isObject), source: key };
      }
    }
    throw new ArchiveError('스토리 목록 응답 형식을 확인할 수 없습니다. 기존 기록은 유지했습니다.', 'ResponseShapeError');
  }
  function getField(roots, names) {
    for (const root of [...roots].reverse()) for (const key of names) if (own(root, key)) return { found: true, value: root[key] };
    return { found: false, value: undefined };
  }
  function nextQuery(page, query) {
    const roots = page.roots;
    const cursor = getField(roots, ['nextCursor', 'next_cursor']);
    const has = getField(roots, ['hasNext', 'hasNextPage', 'hasMore']);
    const next = getField(roots, ['nextPage']);
    if (cursor.found) {
      if (cursor.value === null || cursor.value === undefined || cursor.value === '') {
        if (has.value === true) throw new ArchiveError('다음 페이지가 있다고 응답했지만 커서가 없습니다. 확인된 목록만 보관했습니다.', 'PaginationError');
        return { query: null, verifiedEnd: true };
      }
      if (!['string', 'number'].includes(typeof cursor.value)) throw new ArchiveError('다음 페이지 커서 형식이 달라 수집을 중단했습니다.', 'PaginationError');
      return { query: { sort: 'recommend', isTodayReleased: true, cursor: String(cursor.value) }, verifiedEnd: false };
    }
    if (has.found && has.value === false) return { query: null, verifiedEnd: true };
    if (next.found && next.value !== null && next.value !== undefined && next.value !== '') {
      const n = Number(next.value);
      if (!Number.isInteger(n) || n < 1) throw new ArchiveError('다음 페이지 번호 형식이 달라 수집을 중단했습니다.', 'PaginationError');
      return { query: { sort: 'recommend', isTodayReleased: true, page: n }, verifiedEnd: false };
    }
    const currentPage = getField(roots, ['currentPage', 'page']);
    const totalPages = getField(roots, ['totalPages', 'pageCount']);
    const currentNumber = Number(currentPage.value ?? query.page ?? 1);
    if (has.value === true || (totalPages.found && Number(totalPages.value) > currentNumber)) {
      if (!Number.isInteger(currentNumber) || currentNumber < 0) throw new ArchiveError('현재 페이지 번호를 확인하지 못했습니다.', 'PaginationError');
      return { query: { sort: 'recommend', isTodayReleased: true, page: currentNumber + 1 }, verifiedEnd: false };
    }
    if (totalPages.found && Number(totalPages.value) <= currentNumber) return { query: null, verifiedEnd: true };
    // No speculative offsets/cursors: unknown pagination is surfaced in the UI.
    return { query: null, verifiedEnd: false };
  }

  // The SDK constructs/validates the endpoint and auth headers. This adapter only
  // transports that read-only request using Tampermonkey's request API.
  function gmFetch(url, init = {}) {
    return new Promise((resolve, reject) => {
      let parsed;
      try { parsed = new URL(url); } catch { reject(new TypeError('Invalid API URL')); return; }
      if (parsed.origin !== C.API_ORIGIN || !(parsed.pathname === C.API_PATH || /^\/crack-api\/stories\/[a-zA-Z0-9_-]{1,128}$/.test(parsed.pathname)) || (init.method ?? 'GET') !== 'GET') {
        reject(new TypeError('이 확프는 스토리 목록·공개 상세 조회의 GET 요청만 허용합니다.')); return;
      }
      const signal = init.signal;
      if (signal?.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
      let handle, finished = false;
      const finish = (fn, value) => { if (finished) return; finished = true; signal?.removeEventListener('abort', abort); fn(value); };
      const abort = () => { handle?.abort(); finish(reject, signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        handle = GM_xmlhttpRequest({
          method: 'GET', url: parsed.href,
          headers: Object.fromEntries(new Headers(init.headers ?? {})),
          timeout: C.REQUEST_TIMEOUT, responseType: 'text', anonymous: false, redirect: 'error',
          onload: r => {
            try {
              if (r.finalUrl && new URL(r.finalUrl).origin !== C.API_ORIGIN) throw new TypeError('Unexpected API redirect');
              const retryHeader = /^retry-after:\s*(.+)$/im.exec(r.responseHeaders ?? '')?.[1]?.trim();
              const body = typeof r.responseText === 'string' ? r.responseText : typeof r.response === 'string' ? r.response : '';
              finish(resolve, { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => body, retryAfter: retryHeader });
            } catch (error) { finish(reject, error); }
          },
          onerror: () => finish(reject, new ArchiveError('크랙 API 연결에 실패했습니다. 로그인 상태와 네트워크를 확인해 주세요.', 'NetworkError')),
          ontimeout: () => finish(reject, new ArchiveError('크랙 API 응답 시간이 초과되었습니다.', 'TimeoutError')),
          onabort: () => finish(reject, new DOMException('Aborted', 'AbortError')),
        });
      } catch (error) { finish(reject, error); }
    });
  }

  // IndexedDB read-write transactions serialize competing tabs and keep an ID
  // unique without read/modify/write races in a single huge JSON storage value.
  function db() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(C.DB, C.DB_VERSION);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('stories', { keyPath: 'id' });
        store.createIndex('firstSeenAt', 'firstSeenAt');
        store.createIndex('day', 'day');
        req.result.createObjectStore('meta', { keyPath: 'key' });
        const seen = req.result.createObjectStore('seen', { keyPath: 'id' });
        seen.createIndex('lastSeenAt', 'lastSeenAt');
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new ArchiveError('기록 저장소가 다른 탭에 의해 잠겨 있습니다. 다른 크랙 탭을 새로고침해 주세요.', 'StorageBlocked'));
      req.onsuccess = () => {
        const result = req.result;
        result.onversionchange = () => { result.close(); databasePromise = null; };
        result.onclose = () => { databasePromise = null; };
        resolve(result);
      };
    }).catch(error => { databasePromise = null; throw error; });
    return databasePromise;
  }
  async function transaction(stores, mode, run) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(stores, mode);
      let result, explicitError;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => {}; // onabort is the single rejection path.
      tx.onabort = () => reject(explicitError ?? tx.error ?? new Error('Storage transaction aborted'));
      try { run(tx, value => { result = value; }, error => { explicitError = error; tx.abort(); }); }
      catch (error) { explicitError = error; tx.abort(); }
    });
  }
  const readMeta = () => transaction(['meta'], 'readonly', (tx, done) => {
    const r = tx.objectStore('meta').get('sync'); r.onsuccess = () => done(r.result ?? { key: 'sync' });
  });
  function acquireLease(force, now = Date.now()) {
    return transaction(['meta'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('meta'), get = store.get('sync');
      get.onsuccess = () => {
        const m = get.result ?? { key: 'sync' };
        if (m.owner && m.owner !== OWNER && m.leaseUntil > now) { done({ acquired: false, reason: 'busy', meta: m }); return; }
        const cooldown = force ? C.MANUAL_COOLDOWN : C.POLL;
        if ((m.retryAt > now && (!force || m.retryStatus === 429)) || (m.lastAttempt && now - m.lastAttempt < cooldown)) { done({ acquired: false, reason: 'cooldown', meta: m }); return; }
        store.put({ ...m, owner: OWNER, leaseUntil: now + C.LEASE, lastAttempt: now });
        done({ acquired: true, meta: m });
      };
    });
  }
  function renewLease() {
    return transaction(['meta'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('meta'), get = store.get('sync');
      get.onsuccess = () => {
        if (get.result?.owner !== OWNER) { done(false); return; }
        store.put({ ...get.result, leaseUntil: Date.now() + C.LEASE }); done(true);
      };
    });
  }
  function releaseLease(patch = {}) {
    return transaction(['meta'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('meta'), get = store.get('sync');
      get.onsuccess = () => {
        const m = get.result;
        if (m?.owner !== OWNER) { done(m); return; }
        const next = { ...m, ...patch, owner: '', leaseUntil: 0 };
        store.put(next); done(next);
      };
    });
  }
  function prune(now = Date.now()) {
    return transaction(['stories', 'seen'], 'readwrite', (tx, done) => {
      let removed = 0;
      const req = tx.objectStore('stories').index('firstSeenAt').openCursor(IDBKeyRange.upperBound(now - C.RETENTION, true));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { done(removed); return; }
        cursor.delete(); removed++; cursor.continue();
      };
      // Minimal dedupe IDs contain no title/image/description. They expire after
      // 7 days without a fresh sighting. An expired card still in today's feed
      // must NOT reappear with a new firstSeenAt at the next poll.
      const seenReq = tx.objectStore('seen').index('lastSeenAt').openCursor(IDBKeyRange.upperBound(now - C.RETENTION, true));
      seenReq.onsuccess = () => {
        const cursor = seenReq.result;
        if (!cursor) return;
        cursor.delete(); cursor.continue();
      };
    });
  }
  function insertNew(records, now = Date.now()) {
    const unique = new Map(records.map(r => [r.id, r]));
    return transaction(['stories', 'seen'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('stories'), seenStore = tx.objectStore('seen');
      const result = { added: 0, duplicate: records.length - unique.size, repaired: 0 };
      done(result);
      for (const record of unique.values()) {
        const get = store.get(record.id);
        get.onsuccess = () => {
          const existing = get.result;
          const seenGet = seenStore.get(record.id);
          seenGet.onsuccess = () => {
            const previous = seenGet.result;
            const firstSeenAt = Math.min(existing?.firstSeenAt ?? Infinity, previous?.firstSeenAt ?? Infinity, record.firstSeenAt);
            // A tiny hourly heartbeat for dedupe only. Image/rating repairs never
            // move the existing story's firstSeenAt or its retention deadline.
            if (!previous || now - previous.lastSeenAt >= 60 * 60 * 1000) {
              seenStore.put({ id: record.id, firstSeenAt, lastSeenAt: now });
            }
            if (existing) {
              result.duplicate++;
              if (existing.firstSeenAt >= now - C.RETENTION) {
                const patched = mergeObservedFields(existing, record);
                if (patched) { store.put(patched); result.repaired++; }
              }
              return;
            }
            if (firstSeenAt < now - C.RETENTION) { result.duplicate++; return; }
            store.add({ ...record, firstSeenAt, day: dateKey(firstSeenAt) }); result.added++;
          };
        };
      }
    });
  }
  function repairImageRecord(id, candidates, now = Date.now()) {
    const urls = uniqueImages(candidates);
    if (!validId(id) || !urls.length) return Promise.resolve(null);
    return transaction(['stories'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('stories'), get = store.get(id);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing || existing.firstSeenAt < now - C.RETENTION) { done(null); return; }
        const patched = mergeImageFields(existing, { thumbnail: urls[0], imageCandidates: urls });
        if (patched) store.put(patched);
        done(patched || existing);
      };
    });
  }
  function repairAdultRecord(id, isAdult, now = Date.now()) {
    if (!validId(id) || typeof isAdult !== 'boolean') return Promise.resolve(null);
    return transaction(['stories'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('stories'), get = store.get(id);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing || existing.firstSeenAt < now - C.RETENTION) { done(null); return; }
        if (existing.isAdult === isAdult && existing.adult === isAdult) { done(existing); return; }
        const patched = { ...existing, isAdult, adult: isAdult };
        store.put(patched); done(patched);
      };
    });
  }
  function readRecords(now = Date.now()) {
    return transaction(['stories'], 'readonly', (tx, done) => {
      // Expired entries are excluded even if browser timer throttling delayed pruning.
      const req = tx.objectStore('stories').index('firstSeenAt').getAll(IDBKeyRange.lowerBound(now - C.RETENTION));
      req.onsuccess = () => done(req.result);
    });
  }
  function notifyChanged() {
    channel?.postMessage({ type: 'changed' });
    if (modal) void reloadModal().catch(showFailure);
  }
  function setState(phase, message, last = state.last) {
    state = { phase, message, last };
    updateStatus();
  }
  function humanError(error) {
    if (error?.status === 401 || error?.status === 403) return `신작 조회 권한을 확인하지 못했습니다(HTTP ${error.status}). 크랙에서 로그인 상태를 확인해 주세요. 기존 기록은 유지됩니다.`;
    if (error?.status === 429) return '요청이 제한되어 자동 조회를 잠시 쉬고 있습니다(HTTP 429). 기존 기록은 유지됩니다.';
    if (error?.status) return `크랙 API 오류(HTTP ${error.status})로 수집을 중단했습니다. 기존 기록은 유지됩니다.`;
    if (error?.name === 'QuotaExceededError') return '브라우저 저장 공간이 부족합니다. 이전 기록은 유지하고 이번 수집을 중단했습니다.';
    if (error?.name === 'AbortError') return '수집을 중단했습니다. 이미 저장한 기록은 유지됩니다.';
    return text(error?.message, 260) || '수집 또는 기록 저장 중 오류가 발생했습니다. 기존 기록은 유지됩니다.';
  }
  function showFailure(error) {
    setState('error', humanError(error));
    // Do not log API bodies, auth tokens or SDK HttpError.url (which may contain cursors).
    console.warn('[크랙 이전 신작들]', { name: error?.name, status: error?.status, message: humanError(error) });
  }
  const pause = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });

  async function collect({ force = false } = {}) {
    if (running || stopped) return;
    if (!library) { setState('error', 'SDK를 불러오지 못했습니다. Tampermonkey의 @require 다운로드 상태를 확인해 주세요.'); return; }
    if (!navigator.onLine) { setState('offline', '오프라인입니다. 저장된 기록은 볼 수 있으며 연결 후 수집을 재개합니다.'); return; }
    running = true;
    let lease = false, stats = { pages: 0, fetched: 0, added: 0, duplicate: 0, repaired: 0, invalid: 0 }, outcome;
    const allIds = new Set(), querySignatures = new Set(), pageSignatures = new Set();
    try {
      const acquired = await acquireLease(force);
      if (!acquired.acquired) {
        state.last = acquired.meta;
        if (acquired.reason === 'busy') setState('idle', '다른 크랙 탭에서 신작을 수집하고 있습니다.');
        else if (acquired.meta.error) setState('error', acquired.meta.error);
        else setState('idle', acquired.meta.lastSuccess ? lastSummary(acquired.meta) : '중복 요청을 줄이기 위해 다음 조회를 기다리고 있습니다.');
        return;
      }
      lease = true;
      activeController = new AbortController();
      const signal = activeController.signal;
      if (await prune()) notifyChanged();
      const startedDay = dateKey();
      let query = { sort: 'recommend', isTodayReleased: true };
      let verifiedEnd = false;
      while (query) {
        signal.throwIfAborted();
        if (stats.pages >= C.MAX_PAGES) throw new ArchiveError(`안전 제한(${C.MAX_PAGES}페이지)에 도달했습니다. 지금까지 확인한 작품은 저장했습니다.`, 'PageLimit');
        if (dateKey() !== startedDay) throw new ArchiveError('한국 시간 날짜가 바뀌어 이번 수집을 종료했습니다. 다음 조회에서 새 날짜로 다시 확인합니다.', 'DayChanged');
        const qsig = JSON.stringify(query);
        if (querySignatures.has(qsig)) throw new ArchiveError('서버가 같은 다음 페이지를 반환해 수집을 중단했습니다. 기존 기록은 유지됩니다.', 'PaginationLoop');
        querySignatures.add(qsig);
        if (!(await renewLease())) throw new ArchiveError('수집 담당 탭이 바뀌어 중복 요청을 중단했습니다.', 'LeaseLost');
        setState('collecting', `${stats.pages + 1}번째 목록 확인 중 · 새 기록 ${stats.added.toLocaleString()}개`);
        const response = await library.stories({ query }, { signal });
        const observedAt = Date.now();
        // Avoid attributing a request spanning midnight to an unverified date.
        if (dateKey(observedAt) !== startedDay) throw new ArchiveError('조회 도중 한국 시간 날짜가 바뀌었습니다. 다음 조회에서 새 날짜 목록을 확인합니다.', 'DayChanged');
        const page = extractPage(latestEnvelope ?? response);
        latestEnvelope = null;
        stats.pages++;
        const normalized = page.items.map(item => normalizeStory(item, observedAt)).filter(Boolean);
        stats.invalid += page.items.length - normalized.length;
        if (page.items.length && !normalized.length) throw new ArchiveError('응답에서 작품 ID를 확인하지 못했습니다. 기존 기록은 유지했습니다.', 'StoryShapeError');
        const signature = JSON.stringify(normalized.map(s => s.id).sort());
        if (normalized.length && pageSignatures.has(signature)) throw new ArchiveError('동일한 목록 페이지가 반복되어 추가 조회를 멈췄습니다. 확인한 작품은 저장했습니다.', 'PaginationLoop');
        pageSignatures.add(signature);
        for (const record of normalized) allIds.add(record.id);
        stats.fetched = allIds.size;
        const result = await insertNew(normalized, observedAt);
        stats.added += result.added;
        stats.duplicate += result.duplicate;
        stats.repaired += result.repaired;
        if (result.added || result.repaired) notifyChanged();
        const continuation = nextQuery(page, query);
        if (!normalized.length && continuation.query) throw new ArchiveError('빈 목록에 다음 페이지가 표시되어 수집을 중단했습니다.', 'PaginationError');
        query = continuation.query;
        verifiedEnd = continuation.verifiedEnd;
        if (query) await pause(C.PAGE_DELAY, signal);
      }
      outcome = { lastSuccess: Date.now(), stats, verifiedEnd, error: '', failures: 0, retryAt: 0, retryStatus: 0 };
      const m = await releaseLease(outcome); lease = false;
      setState('idle', lastSummary(m), m);
    } catch (error) {
      const message = humanError(error);
      if (lease) {
        try {
          const old = await readMeta();
          const failures = (old.failures ?? 0) + 1;
          const backoff = error?.status === 429 ? Math.min(60 * 60000, 15 * 60000 * 2 ** Math.min(failures - 1, 2)) : Math.min(30 * 60000, C.POLL * 2 ** Math.min(failures - 1, 3));
          state.last = await releaseLease({ error: message, stats, failures, retryStatus: error?.status ?? 0, retryAt: Date.now() + (error?.name === 'DayChanged' ? 15000 : backoff) });
          lease = false;
        } catch (storageError) { console.warn('[크랙 이전 신작들] 저장소 상태 기록 실패', storageError?.name); }
      }
      showFailure(error);
    } finally {
      if (lease) { try { await releaseLease(); } catch {} }
      activeController = null; latestEnvelope = null; running = false;
      channel?.postMessage({ type: 'status' });
      updateStatus();
    }
  }
  function lastSummary(m) {
    if (!m?.lastSuccess) return '아직 신작을 확인하지 못했습니다.';
    const s = m.stats ?? {};
    return `최근 확인 ${localTime(m.lastSuccess)} · 반환 작품 ${(s.fetched ?? 0).toLocaleString()}개 · 새 기록 ${(s.added ?? 0).toLocaleString()}개${s.repaired ? ` · 이미지·등급 보완 ${s.repaired}개` : ''}${s.invalid ? ` · 형식 미확인 ${s.invalid}개 제외` : ''}${m.verifiedEnd ? '' : ' · 페이지 종료 정보 미제공'}`;
  }

  // ---- Image repair: bounded, cancellable reads, never a new story record. ----
  const detailImageCache = new Map();
  let detailQueue = Promise.resolve(), lastDetailAt = 0, detailBlockedUntil = 0;
  function cacheDetailImages(id, result, ttl = 5 * 60000) {
    detailImageCache.set(id, { result, until: Date.now() + ttl });
    while (detailImageCache.size > 300) detailImageCache.delete(detailImageCache.keys().next().value);
    return result;
  }
  function fetchStoryImages(id, signal) {
    const job = detailQueue.catch(() => {}).then(async () => {
      signal?.throwIfAborted();
      const cached = detailImageCache.get(id);
      if (cached?.until > Date.now()) return cached.result;
      if (!validId(id) || !detailAPI?.story?.getPublic) return { urls: [], reason: '상세 조회 SDK를 확인해 주세요.' };
      if (Date.now() < detailBlockedUntil) return { urls: [], reason: '요청 제한 또는 인증 오류로 이미지 복구를 잠시 쉬고 있습니다.' };
      await pause(Math.max(0, 650 - (Date.now() - lastDetailAt)), signal);
      signal?.throwIfAborted();
      lastDetailAt = Date.now();
      try {
        const response = await detailAPI.story.getPublic(id, { signal });
        signal?.throwIfAborted();
        let payload = response;
        for (let i = 0; i < 4 && isObject(payload) && own(payload, 'data'); i++) payload = payload.data;
        const story = isObject(payload?.story) ? payload.story : isObject(payload?.content) ? payload.content : payload;
        const responseId = firstText(story?._id, story?.id, story?.storyId, story?.contentId);
        if (responseId && responseId !== id) return cacheDetailImages(id, { urls: [], reason: '다른 작품의 응답이어서 이미지 보완을 중단했습니다.' });
        const urls = uniqueImages([...storyImages(payload), ...domStoryImages(id)]);
        return cacheDetailImages(id, { urls, isAdult: storyAdult(payload), reason: urls.length ? '' : '응답에서 이미지 주소를 찾지 못했습니다.' });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        const status = Number(error?.status) || 0;
        if ([401, 403, 429].includes(status)) detailBlockedUntil = Date.now() + (status === 429 ? 5 * 60000 : 60000);
        const reason = [401, 403].includes(status) ? '작품 열람 권한을 확인해 주세요.'
          : status === 404 ? '삭제되었거나 조회할 수 없는 작품입니다.'
          : status === 429 ? '요청 제한으로 이미지 복구를 잠시 쉬고 있습니다.'
          : status ? `상세 조회 실패(HTTP ${status})` : '상세 정보 연결에 실패했습니다.';
        return cacheDetailImages(id, { urls: [], reason }, status === 404 ? 10 * 60000 : 60000);
      }
    });
    detailQueue = job.catch(() => {});
    return job;
  }
  function tryImageURL(url, cover, placeholder, signal, policy) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const img = el('img');
      img.alt = ''; img.width = 240; img.height = 320;
      // Our IntersectionObserver controls loading. Do not layer browser lazy
      // loading inside the shadow-dialog: visible cards must actually request src.
      img.loading = 'eager'; img.decoding = 'async'; img.referrerPolicy = policy;
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
      let finished = false, timer;
      const finish = (ok, error) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        img.onload = img.onerror = null;
        if (!ok) { img.removeAttribute('src'); img.remove(); }
        else { placeholder.hidden = true; cover.dataset.imageStatus = 'loaded'; }
        if (error) reject(error); else resolve(ok);
      };
      const abort = () => finish(false, signal.reason || new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      // Register handlers BEFORE src: a cached response can load immediately.
      img.onload = () => finish(img.naturalWidth > 0);
      img.onerror = () => finish(false);
      timer = setTimeout(() => finish(false), 10000);
      cover.prepend(img);
      img.src = url;
      if (img.complete && img.naturalWidth > 0) finish(true);
    });
  }
  async function loadCardImage(cover, placeholder, record, signal) {
    const attempted = new Set();
    let candidates = uniqueImages([...recordImages(record), ...domStoryImages(record.id)]);
    const save = async urls => {
      const patched = await repairImageRecord(record.id, urls);
      if (patched) {
        record.thumbnail = patched.thumbnail; record.imageCandidates = patched.imageCandidates; record.imageSchema = 1;
      }
    };
    const attempt = async urls => {
      for (const url of urls.slice(0, 6)) {
        signal.throwIfAborted();
        if (attempted.has(url)) continue;
        attempted.add(url);
        // Use the site's origin by default. Some image hosts require a Referer;
        // others reject it. The previous build unconditionally removed it.
        for (const policy of ['origin', 'no-referrer']) {
          if (await tryImageURL(url, cover, placeholder, signal, policy)) {
            try { await save(uniqueImages([url, ...candidates])); }
            catch { /* Storage failure must not hide a successfully loaded image. */ }
            return true;
          }
        }
      }
      return false;
    };
    try {
      signal.throwIfAborted();
      cover.dataset.imageStatus = 'loading';
      if (await attempt(candidates)) return;
      placeholder.textContent = '이미지 주소 확인 중…';
      const detail = await fetchStoryImages(record.id, signal);
      signal.throwIfAborted();
      candidates = uniqueImages([...detail.urls, ...candidates]);
      if (detail.urls.length) {
        try { await save(candidates); } catch {}
        if (await attempt(detail.urls)) return;
      }
      cover.dataset.imageStatus = 'failed';
      placeholder.textContent = candidates.length ? '이미지 로드 실패' : '이미지 주소 없음';
      cover.title = `${detail.reason || '이미지 서버에서 파일을 불러오지 못했습니다.'} 상단 ‘이미지 복구’로 다시 확인할 수 있습니다.`;
    } catch (error) {
      if (signal.aborted) return;
      cover.dataset.imageStatus = 'failed'; placeholder.textContent = '이미지 확인 실패';
      cover.title = '상단 ‘이미지 복구’로 다시 확인할 수 있습니다.';
    }
  }
  function clearImageJobs(m) {
    m.imageController?.abort(); m.imageObserver?.disconnect(); m.imageTasks?.clear();
  }
  function prepareImageJobs(m) {
    m.imageController = new AbortController(); m.imageTasks = new Map();
    m.imageObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const task = m.imageTasks.get(entry.target);
        m.imageTasks.delete(entry.target); m.imageObserver?.unobserve(entry.target);
        task?.();
      }
    }, { root: m.scroller, rootMargin: '240px' }) : null;
  }
  function queueCardImage(cover, placeholder, record) {
    const m = modal;
    if (!m?.imageController) return;
    const signal = m.imageController.signal;
    const task = () => { if (!signal.aborted) void loadCardImage(cover, placeholder, record, signal); };
    if (m.imageObserver) { m.imageTasks.set(cover, task); m.imageObserver.observe(cover); }
    else queueMicrotask(task);
  }
  function retryVisibleImages() {
    if (!modal) return;
    // Clear this screen's negative result cache, not the entire user's history.
    // A rate-limit cooldown is deliberately NOT reset by this button.
    for (const card of modal.grid.querySelectorAll('[data-story-id]')) detailImageCache.delete(card.dataset.storyId);
    siteImageSnapshot.at = 0;
    renderList(false);
  }

  // ---- UI: ordinary links to the real detail page, not simulated details. ----
  const CSS = `
    :host{all:initial;font-family:var(--crh-font,Arial,"Apple SD Gothic Neo","Malgun Gothic",sans-serif);color-scheme:light}
    *{box-sizing:border-box}button,input,select{font:inherit}button,a,input,select{-webkit-tap-highlight-color:transparent}
    dialog{--bg:#ffffff;--panel:#f7f7f8;--line:#e7e7eb;--fg:#232326;--muted:#777780;--accent:#343438;--on-accent:white;--shadow:0 24px 90px #0003;color-scheme:light;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:22px;padding:0;margin:auto;width:min(1060px,calc(100vw - 36px));height:min(880px,89vh);height:min(880px,89dvh);max-width:none;max-height:none;overflow:hidden;box-shadow:var(--shadow);font-family:inherit;font-size:14px;line-height:1.5}
    dialog[data-theme=dark]{--bg:#171719;--panel:#222225;--line:#333338;--fg:#ededf0;--muted:#a0a0a9;--accent:#efeff2;--on-accent:#202023;--shadow:0 24px 90px #0008;color-scheme:dark}
    dialog::backdrop{background:#0008;backdrop-filter:blur(3px)}
    .shell{display:flex;flex-direction:column;height:100%;min-height:0}header{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:24px 26px 18px;flex:none}
    .eyebrow{font-size:11px;letter-spacing:.08em;color:var(--muted);font-weight:600;margin:0 0 3px}h2{font-size:24px;letter-spacing:-.7px;margin:0;font-weight:800;line-height:1.35}.sub{color:var(--muted);font-size:12px;margin:5px 0 0}.actions{display:flex;gap:8px;align-items:center;flex:none}
    button{color:var(--fg);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px;cursor:pointer;white-space:nowrap;font-weight:600;font-size:12px;line-height:1.4}button:hover{filter:brightness(.96)}button:disabled{opacity:.45;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--fg);outline-offset:3px}button.close{font-size:24px;border:0;background:transparent;padding:0;width:36px;height:36px;line-height:1}
    details.notice{margin:0 26px 16px;padding:11px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel);font-size:12px;color:var(--muted);flex:none}summary{cursor:pointer;color:var(--fg);font-weight:600}details p{margin:9px 0 1px;line-height:1.7}
    .filters{padding:0 26px 14px;display:flex;gap:9px;flex:none}.search{position:relative;flex:1;min-width:0}.search input{width:100%;border:1px solid var(--line);border-radius:11px;background:var(--panel);color:var(--fg);padding:11px 14px;font-size:13px;min-width:0}.search input::placeholder{color:var(--muted)}select{border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:11px;font-size:12px;padding:0 10px;max-width:145px}
    .rating-row{padding:0 26px 14px;display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;flex:none}.rating-group{display:inline-flex;gap:3px;padding:3px;border:1px solid var(--line);border-radius:11px;background:var(--panel);flex:none}.rating-option{border:0;border-radius:8px;background:transparent;padding:8px 13px;font-size:12px;color:var(--muted)}.rating-option[aria-pressed=true]{background:var(--accent);color:var(--on-accent)}.rating-info{display:flex;align-items:center;gap:8px;min-width:0;flex:1;flex-wrap:wrap}.rating-hint{font-size:11px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}.rating-repair{padding:5px 8px;font-size:11px}.rating-repair[hidden],.rating-hint[hidden]{display:none}.badge.unknown{font-size:9px;font-weight:500}
    .dates{display:flex;gap:7px;overflow:auto;flex:none;padding:0 26px 15px;scrollbar-width:thin}.date{display:flex;align-items:center;gap:7px;flex:none;border-radius:9px;background:var(--bg);padding:9px 12px;font-size:12px}.date small{font-size:10px;opacity:.65}.date[aria-pressed=true]{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}.date.zero{opacity:.65}
    .status{font-size:11px;color:var(--muted);padding:11px 26px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);min-height:40px;flex:none;display:flex;gap:10px;justify-content:space-between;align-items:center}.status[data-error=true]{color:#b34a3d}dialog[data-theme=dark] .status[data-error=true]{color:#f6a297}.status .total{font-weight:600;color:var(--fg);flex:none}.status-message{overflow-wrap:anywhere}
    .scroller{padding:20px 26px 24px;overflow:auto;overscroll-behavior:contain;flex:1;min-height:0;scrollbar-width:thin}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:24px 15px}.card{min-width:0}.card-link{display:block;text-decoration:none;color:inherit;border-radius:12px}.cover{position:relative;width:100%;aspect-ratio:3/4;border-radius:12px;background:var(--panel);overflow:hidden;display:flex;align-items:center;justify-content:center;border:1px solid var(--line)}.cover img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .16s ease}.card-link:hover .cover img{transform:scale(1.035)}.placeholder{font-size:12px;color:var(--muted);padding:10px;text-align:center;overflow-wrap:anywhere}.placeholder[hidden]{display:none}.badge{position:absolute;right:7px;top:7px;border-radius:5px;padding:2px 5px;background:#232326cc;color:#fff;font-size:10px;font-weight:700}.record-date{position:absolute;left:7px;bottom:7px;border-radius:5px;padding:3px 6px;background:#151515ae;color:#fff;font-size:10px;backdrop-filter:blur(5px)}
    h3{margin:10px 0 4px;font-size:14px;font-weight:750;line-height:1.4;letter-spacing:-.2px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}.description{margin:0;color:var(--muted);font-size:11px;line-height:1.6;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;min-height:35px;overflow-wrap:anywhere}.author{font-size:11px;color:var(--muted);margin:7px 0 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tags{display:flex;gap:4px;overflow:hidden;max-height:21px;margin-top:6px}.tag{font-size:10px;white-space:nowrap;border-radius:4px;background:var(--panel);color:var(--muted);padding:2px 5px;max-width:105px;overflow:hidden;text-overflow:ellipsis}.metrics{display:flex;gap:10px;font-size:10px;color:var(--muted);margin-top:7px}.metric{display:flex;gap:4px;align-items:center}.metric svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.7}
    .empty{text-align:center;padding:60px 16px;color:var(--muted)}.empty strong{display:block;font-size:17px;color:var(--fg);margin-bottom:10px}.empty p{font-size:12px;line-height:1.8;margin:0;white-space:pre-line}.pager{display:flex;align-items:center;justify-content:center;gap:16px;margin-top:26px;font-size:12px;color:var(--muted)}.pager[hidden]{display:none}.foot{padding:12px 26px;border-top:1px solid var(--line);font-size:10px;color:var(--muted);flex:none}.foot p{margin:0;line-height:1.65}
    @media(min-width:1250px){.grid{grid-template-columns:repeat(6,minmax(0,1fr))}}@media(max-width:800px){.grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:20px 12px}}@media(max-width:620px){dialog{border-radius:17px;width:calc(100vw - 20px);height:94vh;height:94dvh}header{padding:18px 16px 14px;gap:9px}h2{font-size:21px}.eyebrow{font-size:10px}.sub{font-size:11px}.actions{gap:3px}.actions .refresh,.actions .retry-images{padding:7px 6px;font-size:10px}.notice{margin-left:16px!important;margin-right:16px!important}.filters{padding-left:16px;padding-right:16px;gap:7px}.rating-row{padding-left:16px;padding-right:16px;gap:8px}.rating-option{font-size:11px;padding:7px 11px}.rating-info{flex-basis:100%}.rating-hint{font-size:10px}select{max-width:116px;font-size:11px}.dates{padding-left:16px;padding-right:16px}.status{padding:9px 16px;align-items:flex-start;gap:8px;font-size:10px}.scroller{padding:16px}.grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 10px}h3{font-size:12px}.description{font-size:10px}.author{font-size:10px}.cover{border-radius:9px}.foot{padding:10px 16px}.record-date{font-size:9px}}
    @media(max-width:390px){header{flex-wrap:wrap}.actions{margin-left:auto}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sub{font-size:10px}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
  `;
  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function getSiteTheme() {
    let detected = 'light';
    try { detected = UI?.getTheme?.(document) ?? 'light'; } catch {}
    const explicit = document.documentElement.getAttribute('data-theme') ?? document.body?.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') return explicit;
    if (document.documentElement.classList.contains('dark') || document.body?.classList.contains('dark')) return 'dark';
    for (const node of [document.querySelector('main'), document.body, document.documentElement]) {
      if (!node) continue;
      const match = getComputedStyle(node).backgroundColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
      if (match && (match[4] === undefined || Number(match[4]) > .5)) {
        const luminance = .2126 * +match[1] + .7152 * +match[2] + .0722 * +match[3];
        return luminance < 115 ? 'dark' : 'light';
      }
    }
    return detected;
  }
  function applyTheme() {
    const theme = getSiteTheme(); previousTheme = theme;
    if (modal) {
      modal.dialog.dataset.theme = theme;
      const font = getComputedStyle(document.body).fontFamily;
      if (font) modal.host.style.setProperty('--crh-font', font);
    }
  }
  function savedView() {
    try {
      const result = JSON.parse(sessionStorage.getItem(C.RESTORE_KEY) ?? 'null');
      if (!isObject(result) || !Number.isFinite(result.at) || Date.now() - result.at > 30 * 60 * 1000) return null;
      return result;
    } catch { return null; }
  }
  function persistView(reopen = false) {
    if (!modal) return;
    try {
      sessionStorage.setItem(C.RESTORE_KEY, JSON.stringify({ date: modal.selected, query: modal.search.value, sort: modal.sort.value, adultFilter: modal.adultFilter, page: modal.page, reopen, route: location.pathname, at: Date.now() }));
    } catch {}
  }
  function closeModal() { modal?.dialog.close(); }
  async function openModal({ restore = false } = {}) {
    if (modal) { modal.dialog.focus(); return; }
    const host = el('div'); host.id = C.HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = el('style'); style.textContent = CSS;
    const dialog = el('dialog'); dialog.setAttribute('aria-labelledby', 'crh-title'); dialog.setAttribute('aria-describedby', 'crh-subtitle');
    const shell = el('div', 'shell');
    const header = el('header');
    const titles = el('div'); titles.append(el('p', 'eyebrow', '나만의 신작 기록'));
    const title = el('h2', '', '이전 신작들'); title.id = 'crh-title';
    const subtitle = el('p', 'sub', '최근 7일 · 최초 수집일 기준 · 한국 시간'); subtitle.id = 'crh-subtitle'; titles.append(title, subtitle);
    const actions = el('div', 'actions');
    const retryImages = el('button', 'retry-images', '이미지 복구'); retryImages.type = 'button'; retryImages.title = '현재 화면의 실패한 이미지를 다시 확인합니다. 기록일과 보관 기한은 바뀌지 않습니다.';
    const refresh = el('button', 'refresh', '지금 수집'); refresh.type = 'button'; refresh.title = '오늘 신작을 다시 조회합니다. 과거 날짜를 소급 조회하지 않습니다.';
    const close = el('button', 'close', '×'); close.type = 'button'; close.setAttribute('aria-label', '닫기'); close.addEventListener('click', closeModal); actions.append(retryImages, refresh, close); header.append(titles, actions);
    const notice = el('details', 'notice'); notice.open = window.matchMedia('(min-width: 621px)').matches;
    notice.append(el('summary', '', '중복 저장 방지 · 7일 뒤 자동 삭제'), el('p', '', NOTICE));
    const filters = el('div', 'filters'); const searchWrap = el('div', 'search');
    const search = el('input'); search.type = 'search'; search.placeholder = '제목, 제작자, 태그 검색'; search.setAttribute('aria-label', '기록 검색'); search.autocomplete = 'off'; search.maxLength = 200; searchWrap.append(search);
    const sort = el('select'); sort.setAttribute('aria-label', '정렬');
    for (const [value, label] of [['newest','수집 최신순'],['oldest','수집 오래된순'],['name','이름순'],['popular','대화 많은순']]) { const o = el('option','',label); o.value = value; sort.append(o); }
    filters.append(searchWrap, sort);
    const ratingRow = el('div', 'rating-row');
    const ratingGroup = el('div', 'rating-group'); ratingGroup.setAttribute('role', 'group'); ratingGroup.setAttribute('aria-label', '콘텐츠 등급 필터');
    const ratingButtons = new Map();
    for (const [value, label] of [['all', '모두'], ['safe', '세이프만'], ['unsafe', '언세이프만']]) {
      const b = el('button', 'rating-option', label); b.type = 'button'; b.dataset.adultFilter = value;
      b.setAttribute('aria-pressed', String(value === 'all'));
      b.title = value === 'all' ? '세이프·언세이프 모두 표시 (등급 미확인 포함)' : value === 'safe' ? 'isAdult가 false인 작품만 표시' : 'isAdult가 true인 작품만 표시';
      b.addEventListener('click', () => {
        if (modal?.host !== host || modal.adultFilter === value) return;
        modal.adultFilter = value; modal.page = 1; modal.ratingMessage = '';
        renderDates(); renderList(); persistView();
      });
      ratingButtons.set(value, b); ratingGroup.append(b);
    }
    const ratingInfo = el('div', 'rating-info');
    const ratingHint = el('span', 'rating-hint'); ratingHint.setAttribute('role', 'status'); ratingHint.setAttribute('aria-live', 'polite');
    const ratingRepair = el('button', 'rating-repair', '등급 확인'); ratingRepair.type = 'button'; ratingRepair.hidden = true;
    ratingRepair.title = `선택한 날짜·검색 조건의 미확인 작품을 최대 ${C.RATING_BATCH}개씩 공개 상세 API로 확인합니다. 기록일은 바뀌지 않습니다.`;
    ratingRepair.addEventListener('click', () => {
      if (modal?.host !== host) return;
      if (modal.ratingController) modal.ratingController.abort();
      else void repairUnknownRatings().catch(showFailure);
    });
    ratingInfo.append(ratingHint, ratingRepair); ratingRow.append(ratingGroup, ratingInfo);
    const dates = el('div', 'dates'); dates.setAttribute('aria-label', '최초 수집 날짜 선택');
    const status = el('div', 'status'); const statusMessage = el('span', 'status-message'); statusMessage.setAttribute('role', 'status'); statusMessage.setAttribute('aria-live', 'polite');
    const total = el('span', 'total'); status.append(statusMessage,total);
    const scroller = el('div', 'scroller'); const grid = el('div', 'grid'); const empty = el('div', 'empty'); const pager = el('div', 'pager'); scroller.append(grid, empty, pager);
    const footer = el('div', 'foot'); footer.append(el('p','', '작품을 누르면 크랙의 실제 상세페이지로 이동합니다. 소개·숫자는 수집 당시 정보입니다. 표시되지 않는 이미지는 현재 공개 상세 정보로 보완합니다.'), el('p','', '등급 필터는 API의 isAdult 값으로 표시만 바꿉니다. 값이 없거나 확인되지 않은 이전 기록은 ‘모두’에서만 표시합니다. 이 브라우저에만 저장되며, 삭제·비공개 작품은 열리지 않을 수 있습니다. 중복 확인용 ID는 마지막 확인 후 7일간만 별도 유지됩니다.'));
    shell.append(header, notice, filters, ratingRow, dates, status, scroller, footer); dialog.append(shell); shadow.append(style, dialog); document.body.append(host);
    const saved = savedView();
    modal = { host, dialog, search, sort, ratingButtons, ratingHint, ratingRepair, ratingController: null, ratingMessage: '', adultFilter: ['all','safe','unsafe'].includes(saved?.adultFilter) ? saved.adultFilter : 'all', dates, status, statusMessage, total, scroller, grid, empty, pager, refresh, retryImages, imageController: null, imageObserver: null, imageTasks: new Map(), records: [], selected: saved?.date ?? dateKey(), page: restore ? (saved?.page ?? 1) : 1, loadVersion: 0 };
    if (saved) { search.value = text(saved.query, 200); if (['newest','oldest','name','popular'].includes(saved.sort)) sort.value = saved.sort; }
    let inputTimer;
    search.addEventListener('input', () => { clearTimeout(inputTimer); inputTimer = setTimeout(() => { if (modal?.host !== host) return; modal.page = 1; modal.ratingMessage = ''; renderList(); persistView(); }, 120); });
    sort.addEventListener('change', () => { modal.page = 1; renderList(); persistView(); });
    refresh.addEventListener('click', () => void collect({ force: true }));
    retryImages.addEventListener('click', () => retryVisibleImages());
    let backdropDown = false;
    dialog.addEventListener('pointerdown', e => { const r = dialog.getBoundingClientRect(); backdropDown = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; });
    dialog.addEventListener('pointerup', e => { const r = dialog.getBoundingClientRect(); if (backdropDown && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) closeModal(); backdropDown = false; });
    dialog.addEventListener('close', () => { clearTimeout(inputTimer); if (modal?.host === host) { modal.ratingController?.abort(); clearImageJobs(modal); } if (modal?.host === host) { persistView(false); modal = null; } host.remove(); document.getElementById(C.BUTTON_ID)?.focus({ preventScroll: true }); }, { once: true });
    applyTheme(); dialog.showModal(); updateStatus();
    empty.append(el('strong','','기록을 불러오는 중입니다.'));
    try { await prune(); await reloadModal(); } catch (error) { showFailure(error); if (modal?.host === host) { empty.replaceChildren(el('strong','','저장소를 열지 못했습니다.'), el('p','',humanError(error))); } }
    if (modal?.host === host && !restore) search.focus({ preventScroll: true });
  }
  async function reloadModal() {
    const m = modal; if (!m) return;
    const version = ++m.loadVersion;
    const rows = await readRecords();
    if (modal !== m || version !== m.loadVersion) return;
    m.records = rows; m.renderDay = dateKey();
    renderDates(); renderList(false); updateStatus();
  }
  function renderDates() {
    if (!modal) return;
    const m = modal, counts = new Map();
    const visible = m.records.filter(row => matchesAdult(row, m.adultFilter));
    for (const row of visible) counts.set(row.day, (counts.get(row.day) ?? 0) + 1);
    const days = [];
    for (let i = 0; i <= 7; i++) days.push(dateKey(Date.now() - i * 86400000));
    if (m.selected !== 'all' && !days.includes(m.selected)) m.selected = dateKey();
    const oldScroll = m.dates.scrollLeft;
    m.dates.replaceChildren();
    for (const day of ['all', ...days]) {
      const count = day === 'all' ? visible.length : (counts.get(day) ?? 0);
      // The 8th calendar date is a partial day in the rolling 168-hour window.
      if (day === days[7] && !count && day !== m.selected) continue;
      const label = day === 'all' ? '전체' : day === dateKey() ? '오늘' : day === days[1] ? '어제' : `${Number(day.slice(5, 7))}.${Number(day.slice(8))}`;
      const b = el('button', `date${count ? '' : ' zero'}`); b.type = 'button'; b.dataset.date = day;
      b.setAttribute('aria-pressed', String(day === m.selected)); b.title = (day === 'all' ? '보관 중인 전체 기록' : `${day} 최초 수집`) + ' · 등급 필터 기준 개수 (검색어 제외)';
      b.append(el('span','',label),el('small','',String(count)));
      b.addEventListener('click', () => { if (!modal) return; modal.selected = day; modal.page = 1; modal.ratingMessage = ''; renderDates(); renderList(); persistView(); });
      m.dates.append(b);
    }
    m.dates.scrollLeft = oldScroll;
  }
  function filteredRecords(records, selected, search, sort, adultFilter = 'all') {
    const terms = search.toLocaleLowerCase('ko-KR').trim().split(/\s+/).filter(Boolean);
    const result = records.filter(s => matchesAdult(s, adultFilter) && (selected === 'all' || s.day === selected) && (!terms.length || terms.every(term => `${s.title} ${s.author} ${s.description} ${(s.tags || []).join(' ')}`.toLocaleLowerCase('ko-KR').includes(term))));
    result.sort((a,b) => sort === 'oldest' ? a.firstSeenAt - b.firstSeenAt || a.id.localeCompare(b.id) : sort === 'name' ? a.title.localeCompare(b.title,'ko') : sort === 'popular' ? (b.chatCount ?? -1) - (a.chatCount ?? -1) || b.firstSeenAt - a.firstSeenAt : b.firstSeenAt - a.firstSeenAt || a.id.localeCompare(b.id));
    return result;
  }
  function unknownRatings(m) {
    return filteredRecords(m.records, m.selected, m.search.value, m.sort.value, 'all').filter(row => recordAdult(row) === null);
  }
  function updateRatingControls() {
    const m = modal; if (!m) return;
    for (const [value, button] of m.ratingButtons) button.setAttribute('aria-pressed', String(value === m.adultFilter));
    const unknown = unknownRatings(m).length;
    m.ratingHint.textContent = m.ratingMessage || (unknown ? `등급 미확인 ${unknown.toLocaleString()}개는 ‘모두’에서만 표시됩니다.` : '');
    m.ratingHint.hidden = !m.ratingHint.textContent;
    m.ratingRepair.hidden = !unknown && !m.ratingController;
    m.ratingRepair.textContent = m.ratingController ? '확인 중지' : '등급 확인';
  }
  async function repairUnknownRatings() {
    const m = modal; if (!m || m.ratingController) return;
    if (!navigator.onLine) { m.ratingMessage = '오프라인입니다. 연결 후 등급을 확인해 주세요.'; updateRatingControls(); return; }
    if (!detailAPI?.story?.getPublic) { m.ratingMessage = '상세 조회 SDK를 확인해 주세요. 크랙을 새로고침한 뒤 다시 시도해 주세요.'; updateRatingControls(); return; }
    const pending = unknownRatings(m), targets = pending.slice(0, C.RATING_BATCH);
    if (!targets.length) return;
    const controller = new AbortController(); m.ratingController = controller;
    let checked = 0, updated = 0, interrupted = false;
    try {
      for (const row of targets) {
        controller.signal.throwIfAborted();
        if (modal !== m) break;
        if (Date.now() < detailBlockedUntil) { interrupted = true; break; }
        m.ratingMessage = `등급 확인 중 ${checked + 1}/${targets.length}`; updateRatingControls();
        // Uses the same throttled public-detail queue/cache as image repair.
        const result = await fetchStoryImages(row.id, controller.signal);
        controller.signal.throwIfAborted();
        checked++;
        if (typeof result.isAdult === 'boolean') {
          const patched = await repairAdultRecord(row.id, result.isAdult);
          if (patched) {
            updated++;
            const live = m.records.find(r => r.id === row.id);
            if (live) { live.isAdult = patched.isAdult; live.adult = patched.adult; }
          }
        }
      }
      m.ratingMessage = interrupted
        ? `요청 제한 또는 인증 오류로 등급 확인을 중단했습니다. ${updated}개 반영됨.`
        : `등급 ${updated}개 반영 · 미확인 ${checked - updated}개${pending.length > targets.length ? ' · 남은 작품은 ‘등급 확인’을 다시 눌러 주세요.' : ''}`;
    } catch (error) {
      m.ratingMessage = controller.signal.aborted ? `등급 확인 중지 · ${updated}개 반영` : `등급 확인 실패 · ${updated}개 반영. ${humanError(error)}`;
    } finally {
      m.ratingController = null;
      if (updated) channel?.postMessage({ type: 'changed' });
      if (modal === m) { await reloadModal(); updateRatingControls(); }
    }
  }
  function formatCount(value) { return value >= 10000 ? `${(value/10000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/,'')}만` : value.toLocaleString('ko-KR'); }
  function metric(type, value) {
    const span = el('span','metric'); span.title = `${type === 'chat' ? '대화' : '좋아요'} ${value.toLocaleString()} · 수집 당시`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d',type === 'chat' ? 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z' : 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z'); svg.append(path);
    span.append(svg,document.createTextNode(formatCount(value))); return span;
  }
  function makeCard(record) {
    const article = el('article','card'); article.dataset.storyId = record.id;
    const link = el('a','card-link'); link.href = detailURL(record.id,record.detailUrl); link.title = `${record.title} · 상세페이지`;
    link.addEventListener('click', e => { if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) persistView(true); });
    const cover = el('div','cover');
    const placeholder = el('span','placeholder','이미지 확인 중…'); cover.append(placeholder);
    queueCardImage(cover, placeholder, record);
    if (recordAdult(record) === true) cover.append(el('span','badge','19'));
    else if (recordAdult(record) === null) cover.append(el('span','badge unknown','등급 미확인'));
    if (modal?.selected === 'all') cover.append(el('span','record-date',`${Number(record.day.slice(5,7))}.${Number(record.day.slice(8))} 수집`));
    const name = el('h3','',record.title); const desc = el('p','description',record.description || '소개가 제공되지 않았습니다.');
    link.append(cover,name,desc); article.append(link);
    if (record.author) article.append(el('p','author',`by ${record.author}`));
    if (record.tags.length) { const tags = el('div','tags'); for (const tag of record.tags.slice(0,3)) { const t = el('span','tag',`#${tag.replace(/^#/,'')}`); t.title = tag; tags.append(t); } article.append(tags); }
    const metrics = el('div','metrics');
    if (record.chatCount !== null) metrics.append(metric('chat',record.chatCount));
    if (record.likeCount !== null) metrics.append(metric('like',record.likeCount));
    if (metrics.childElementCount) article.append(metrics);
    return article;
  }
  function renderList(scroll = true) {
    if (!modal) return;
    const m = modal, records = filteredRecords(m.records,m.selected,m.search.value,m.sort.value,m.adultFilter);
    updateRatingControls();
    const pages = Math.max(1,Math.ceil(records.length/C.PAGE_SIZE));
    m.page = Math.min(Math.max(1,m.page),pages); m.total.textContent = `${records.length.toLocaleString()}개 작품`;
    clearImageJobs(m);
    prepareImageJobs(m);
    m.grid.replaceChildren(); m.empty.replaceChildren(); m.pager.replaceChildren(); m.empty.hidden = !!records.length;
    if (!records.length) {
      const narrowed = m.adultFilter !== 'all' || !!m.search.value.trim();
      m.empty.append(el('strong','', narrowed ? '조건에 맞는 작품이 없습니다.' : '이 날짜의 기록이 없습니다.'), el('p','', narrowed ? '등급 필터, 검색어 또는 날짜를 바꿔 보세요.\n등급 미확인 작품은 ‘모두’에서 보거나 ‘등급 확인’으로 확인할 수 있습니다.' : '확프를 켠 뒤 확인한 오늘 신작부터 기록됩니다.\n확인하지 못한 날짜의 작품은 소급해서 가져오지 않습니다.'));
    } else {
      const fragment = document.createDocumentFragment();
      records.slice((m.page-1)*C.PAGE_SIZE,m.page*C.PAGE_SIZE).forEach(s=>fragment.append(makeCard(s))); m.grid.append(fragment);
    }
    m.pager.hidden = pages <= 1;
    if (pages > 1) {
      const before = el('button','','이전'); before.type='button'; before.disabled=m.page===1;
      const next = el('button','','다음'); next.type='button'; next.disabled=m.page===pages;
      before.addEventListener('click',()=>{ m.page--; renderList(); persistView(); }); next.addEventListener('click',()=>{ m.page++; renderList(); persistView(); });
      m.pager.append(before,el('span','',`${m.page} / ${pages}`),next);
    }
    if (scroll) m.scroller.scrollTop=0;
  }
  function updateStatus() {
    if (!modal) return;
    modal.statusMessage.textContent=state.message;
    modal.status.dataset.error=String(state.phase==='error');
    modal.refresh.disabled=running;
    modal.refresh.textContent=running?'수집 중…':'지금 수집';
  }

  function isVisible(node) {
    if (!node?.isConnected || node.closest('[hidden],[aria-hidden="true"],dialog,[role="dialog"]')) return false;
    const style=getComputedStyle(node); return style.display!=='none' && style.visibility!=='hidden' && node.getClientRects().length>0;
  }
  function findImagesTab() {
    let candidates=[];
    try { const r=pageUI?.resolve('nav.images'); if(r?.elements) candidates.push(...r.elements); } catch {}
    candidates.push(...document.querySelectorAll('a[href="/image/generate"],a[href^="/image/generate?"],a[href="https://crack.wrtn.ai/image/generate"]'));
    candidates=[...new Set(candidates)].filter(isVisible);
    if(!candidates.length) candidates=[...document.querySelectorAll('header button,nav button,[role="tablist"] button,[role="tab"]')].filter(n=>isVisible(n)&&n.textContent.replace(/\s+/g,'').trim()==='이미지');
    // Prefer a top/main navigation row over a sidebar or footer copy.
    const score=node=>{const r=node.getBoundingClientRect();const parent=node.parentElement?.textContent??'';return (node.closest('header,nav,[role="tablist"]')?100:0)+(parent.includes('스토리')?60:0)+(parent.includes('캐릭터')?40:0)+(r.top>=-100&&r.top<300?35:0)-Math.max(0,r.top)/100;};
    return candidates.sort((a,b)=>score(b)-score(a))[0]??null;
  }
  function mountButton(force=false) {
    if(stopped||!document.body)return;
    const existing=document.getElementById(C.BUTTON_ID);
    // Fast path for frequent chat mutations: no full document scan while mounted.
    if(existing?.isConnected&&!force&&location.pathname===lastRoute)return;
    lastRoute=location.pathname;
    const anchor=findImagesTab();
    if(!anchor){if(existing&&!isVisible(existing))existing.remove();return;}
    const button=existing??el('button','','이전 신작들');button.id=C.BUTTON_ID;button.type='button';
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-label','이전 신작들: 날짜별 7일 기록 열기');
    const s=getComputedStyle(anchor);
    button.style.cssText=`display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;white-space:nowrap;cursor:pointer;background:transparent;border:0;border-radius:8px;color:inherit;line-height:1.4;padding:8px 10px;margin-left:4px;font-family:inherit;font-size:${s.fontSize};font-weight:${s.fontWeight};min-height:36px;vertical-align:middle;`;
    if(!existing)button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();void openModal().catch(showFailure);});
    // Preserve a list-based nav without nesting buttons inside links.
    if(anchor.parentElement?.tagName==='LI'&&anchor.parentElement.parentElement?.matches('ul,ol')){
      let li=button.parentElement?.dataset?.crhNavWrapper==='true'?button.parentElement:null;
      if(!li){li=el('li');li.dataset.crhNavWrapper='true';li.style.cssText='display:flex;align-items:center;flex-shrink:0;';li.append(button);}
      if(anchor.parentElement.nextElementSibling!==li)anchor.parentElement.after(li);
    }else if(anchor.nextElementSibling!==button){anchor.after(button);}
  }
  function scheduleMount(force=false){if(mountingTimer)return;mountingTimer=setTimeout(()=>{mountingTimer=null;mountButton(force);},350);}
  async function maintenance() {
    if(stopped)return;
    const now=Date.now();
    if(now-lastMaintenance<1000)return;
    lastMaintenance=now;
    try{
      if(now-lastPrune>=C.MAINTENANCE){const removed=await prune(now);lastPrune=now;if(removed)notifyChanged();else if(modal&&modal.renderDay!==dateKey(now))await reloadModal();}
      if(location.pathname!==lastRoute)mountButton(true);
      if(modal&&getSiteTheme()!==previousTheme)applyTheme();
      await collect();
    }catch(error){showFailure(error);}
  }
  function attemptRestore() {
    const saved=savedView();
    if(!saved?.reopen||saved.route!==location.pathname)return;
    try{sessionStorage.setItem(C.RESTORE_KEY,JSON.stringify({...saved,reopen:false}));}catch{}
    void openModal({restore:true}).catch(showFailure);
  }
  async function start() {
    if(document.getElementById('crh-running-marker'))return;
    const marker=el('meta');marker.id='crh-running-marker';document.head.append(marker);
    try{
      if(typeof SDK?.createLibraryAPI!=='function')throw new ArchiveError('CrackLibrary SDK를 찾지 못했습니다. @require 파일 다운로드를 확인해 주세요.','SDKMissing');
      const transport=SDK.createTransport({fetch:gmFetch,timeout:C.REQUEST_TIMEOUT});
      const core=globalThis.Crack ?? SDK;
      detailAPI=typeof core.createCrackAPI==='function' ? core.createCrackAPI({request:transport}) : null;
      // Keep the raw envelope so nextCursor outside `data` is not lost when the
      // SDK method unwraps `data`. This still makes exactly one SDK GET per page.
      library=SDK.createLibraryAPI({request:async(path,options)=>{
        const envelope=await transport(path,options); latestEnvelope=envelope; return envelope;
      }});
      const description=library.describe('stories',{query:{sort:'recommend',isTodayReleased:true}});
      if(description.method!=='GET'||description.path!==C.API_PATH)throw new ArchiveError('SDK의 스토리 API 경로가 바뀌었습니다. 잘못된 요청을 막기 위해 수집을 중단했습니다.','SDKChanged');
      pageUI=UI?.createPageUI?.({root:document});
    }catch(error){library=null;showFailure(error);}
    mountButton();
    mutationObserver=new MutationObserver(changes=>{
      if(document.getElementById(C.BUTTON_ID)?.isConnected&&location.pathname===lastRoute)return;
      if(changes.some(c=>!c.target.closest?.(`#${C.HOST_ID}`)))scheduleMount();
    });
    mutationObserver.observe(document.body,{childList:true,subtree:true});
    themeObserver=new MutationObserver(()=>{if(modal)applyTheme();});
    themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme','style']});
    themeObserver.observe(document.body,{attributes:true,attributeFilter:['class','data-theme','style']});
    window.addEventListener('resize',()=>scheduleMount(true),{passive:true});
    window.addEventListener('popstate',()=>{scheduleMount(true);attemptRestore();});
    window.addEventListener('online',()=>void maintenance());
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void maintenance();});
    window.addEventListener('pagehide',()=>{stopped=true;activeController?.abort();if(modal){modal.ratingController?.abort();clearImageJobs(modal);}clearInterval(maintenanceTimer);void releaseLease().catch(()=>{});});
    window.addEventListener('pageshow',e=>{if(e.persisted){stopped=false;maintenanceTimer=setInterval(()=>void maintenance(),C.MAINTENANCE);void maintenance();if(modal)renderList(false);attemptRestore();}});
    channel?.addEventListener('message',async event=>{
      if(!['changed','status'].includes(event.data?.type))return;
      try{
        if(event.data.type==='changed'&&modal)await reloadModal();
        if(!running){const m=await readMeta();setState(m.error?'error':'idle',m.error||lastSummary(m),m);}
      }catch(error){showFailure(error);}
    });
    if(typeof GM_registerMenuCommand==='function'){
      GM_registerMenuCommand('📅 이전 신작들 열기',()=>void openModal().catch(showFailure));
      GM_registerMenuCommand('↻ 오늘 신작 지금 수집',()=>void collect({force:true}));
      GM_registerMenuCommand('🖼 현재 목록 이미지 복구',()=>{if(modal)retryVisibleImages();else void openModal().catch(showFailure);});
    }
    try{await db();if(await prune())notifyChanged();lastPrune=Date.now();const m=await readMeta();if(m.lastSuccess)setState(m.error?'error':'idle',m.error||lastSummary(m),m);}catch(error){showFailure(error);}
    maintenanceTimer=setInterval(()=>void maintenance(),C.MAINTENANCE);
    attemptRestore();
    void collect();
  }
  // Test-only entry point: inaccessible on crack.wrtn.ai and never enabled by default.
  if(location.hostname==='127.0.0.1'&&globalThis.__CRH_TEST_MODE__===true){
    globalThis.__CRH_TEST__={C,storyAdult,recordAdult,matchesAdult,mergeObservedFields,repairAdultRecord,repairUnknownRatings,savedView,persistView,renderDates,renderList,imageURL,imageURLs,storyImages,domStoryImages,recordImages,mergeImageFields,repairImageRecord,fetchStoryImages,loadCardImage,retryVisibleImages,clearImageJobs,prepareImageJobs,safeImage,setDetailAPI:api=>{detailAPI=api;},getModal:()=>modal,normalizeStory,extractPage,nextQuery,dateKey,detailURL,gmFetch,db,prune,insertNew,readRecords,readMeta,acquireLease,releaseLease,filteredRecords,collect,openModal,closeModal,start,stop:()=>{stopped=true;activeController?.abort();clearInterval(maintenanceTimer);mutationObserver?.disconnect();themeObserver?.disconnect();if(modal){modal.ratingController?.abort();clearImageJobs(modal);}channel?.close();}};
  } else {
    void start().catch(showFailure);
  }
})();
