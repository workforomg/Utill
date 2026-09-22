// ==UserScript==
// @name         오리지날 찍먹
// @namespace    
// @version      1.0.0
// @description  공식 프로필의 무료대화권 작품 목록 · 썸네일 · 남은 횟수 · 만료 시각
// @match        https://crack.wrtn.ai/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
(() => {
  "use strict";
  if (globalThis.__ucOriginalTrials) return;
  const PROFILE = "/profile/8uykmYvxsnm-WRKOSTlTQ0E1";
  const API = "https://crack-api.wrtn.ai/crack-api/content/654b85f1489169464c54ef0d";
  let host, root, dialog, trigger, status, list, nextButton, refreshButton;
  let headers, controller, cursor = "", complete = false, checked = 0;
  const stories = new Map();
  const cursors = new Set();
  const filters = { target: "all", safety: "all" };
  const rows = new Map();
  let emptyState;
  function targetName(story) {
    return typeof story.target === "string" ? story.target : story.target?.name;
  }
  function matchesFilters(story) {
    return (filters.target === "all" || targetName(story) === filters.target) &&
      (filters.safety === "all" || story.isAdult === (filters.safety === "unsafe"));
  }
  function applyFilters() {
    let visible = 0;
    for (const [id, story] of stories) {
      const row = rows.get(id);
      if (!row) continue;
      row.hidden = !matchesFilters(story);
      if (!row.hidden) visible++;
    }
    emptyState.hidden = visible > 0;
    emptyState.textContent = controller ? "조건에 맞는 작품을 확인하고 있어요…" : "선택한 조건에 맞는 작품이 없어요.";
    return visible;
  }
  function filterGroup(label, key, choices) {
    const group = node("div", undefined, "filter-group");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    group.append(node("span", label, "filter-label"));
    for (const [value, text] of choices) {
      const button = node("button", text);
      button.type = "button";
      button.setAttribute("aria-pressed", String(filters[key] === value));
      button.addEventListener("click", () => {
        filters[key] = value;
        for (const sibling of group.querySelectorAll("button")) sibling.setAttribute("aria-pressed", String(sibling === button));
        update();
      });
      group.append(button);
    }
    return group;
  }
  async function loadTargets(batch, run) {
    let index = 0;
    async function worker() {
      while (index < batch.length && !run.signal.aborted && eligible()) {
        const story = batch[index++];
        if (targetName(story)) continue;
        try {
          const response = await fetch(`https://crack-api.wrtn.ai/crack-api/stories/${encodeURIComponent(story.sourceId)}`, {
            credentials: "include", cache: "no-store", headers: headers(),
            signal: AbortSignal.any([run.signal, AbortSignal.timeout(20000)])
          });
          if (!response.ok) continue;
          const body = await response.json();
          if (run.signal.aborted || controller !== run) return;
          story.target = body?.data?.target;
          update();
        } catch {
          // Unclassified works remain in All; never guess an audience.
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
  }
  const eligible = () => location.pathname.replace(/\/$/, "") === PROFILE && new URLSearchParams(location.search).get("type") === "story";
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  function passLabel(pass, now = Date.now()) {
    if (Date.parse(pass.endAt) <= now) return "기간 만료";
    if (Date.parse(pass.startAt) > now) return "시작 전";
    return Number.isFinite(pass.remainingCount) ? `남은 ${Math.max(0, pass.remainingCount)}회` : "남은 횟수 확인 불가";
  }
  function card(story) {
    const row = node("a", undefined, "card");
    row.href = `/detail/${encodeURIComponent(story.sourceId)}`;
    row.target = "_blank";
    row.rel = "noopener noreferrer";
    const cover = node("div", "STORY", "cover");
    const source = story.portraitImage || story.profileImage;
    const url = typeof source === "string" ? source : source?.w200 || source?.w600 || source?.origin;
    if (typeof url === "string" && /^https:\/\//i.test(url)) {
      const img = node("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => img.remove(), { once: true });
      cover.append(img);
    }
    const info = node("div", undefined, "info");
    info.append(node("span", `CRACK ORIGINAL${story.isAdult ? " · 19+" : ""}`, "original"), node("h3", story.name || "제목 없음"), node("p", story.creator?.nickname || "", "creator"), node("p", story.simpleDescription || "", "description"));
    const pass = story.freeChatPass;
    const badge = node("span", passLabel(pass), "pass");
    if (pass.remainingCount === 0 || Date.parse(pass.endAt) <= Date.now()) badge.classList.add("muted");
    const end = new Date(pass.endAt);
    const expiry = Number.isFinite(end.getTime()) ? `${end.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}까지 (한국 시간)` : "";
    const counts = node("div", undefined, "counts");
    counts.append(badge, node("span", Number.isFinite(pass.grantedCount) ? `/ 지급 ${pass.grantedCount}회` : ""));
    info.append(counts, node("p", expiry, "expiry"), node("p", `대화 ${Number(story.totalMessageCount || 0).toLocaleString("ko-KR")} · 좋아요 ${Number(story.likeCount || 0).toLocaleString("ko-KR")}`, "stats"));
    row.append(cover, info);
    return row;
  }
  function update(message) {
    const visible = applyFilters();
    const unknown = [...stories.values()].filter(story => !targetName(story)).length;
    status.textContent = message || `${checked.toLocaleString("ko-KR")}개 작품 확인 · 찍먹 ${stories.size.toLocaleString("ko-KR")}개 중 ${visible.toLocaleString("ko-KR")}개 표시${complete ? " · 전체 확인 완료" : ""}${unknown ? ` · 향 분류 ${controller ? "확인 중" : "미확인"} ${unknown}개 (전체에서 표시)` : ""}`;
    nextButton.textContent = controller ? "불러오기 중지" : "이어서 불러오기";
    nextButton.hidden = complete;
    refreshButton.disabled = !!controller;
    list.setAttribute("aria-busy", String(!!controller));
  }
  async function load(reset = false) {
    if (controller || !eligible()) return;
    if (reset) {
      cursor = ""; complete = false; checked = 0;
      stories.clear(); rows.clear(); cursors.clear(); list.replaceChildren(emptyState);
    }
    if (complete) return;
    const run = new AbortController();
    controller = run;
    update("작품과 무료대화권을 불러오는 중…");
    let failure = "";
    try {
      while (!complete && !run.signal.aborted && eligible()) {
        const params = new URLSearchParams({ limit: "20", type: "story", sort: "createdAt" });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`${API}?${params}`, { credentials: "include", cache: "no-store", headers: headers(), signal: AbortSignal.any([run.signal, AbortSignal.timeout(20000)]) });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "크랙 로그인 상태를 확인한 뒤 다시 시도해 주세요." : `요청 실패 (${response.status}). 잠시 후 이어서 불러와 주세요.`);
        const body = await response.json();
        const data = body?.data;
        if (!Array.isArray(data?.contents)) throw new Error("작품 목록 응답 형식이 달라졌어요.");
        if (run.signal.aborted || !eligible()) break;
        const batch = [];
        for (const story of data.contents) {
          if (story.type !== "story" || !story.original?.isOriginal || !story.freeChatPass || !story.sourceId) continue;
          if (stories.has(story.sourceId)) {
            if (!targetName(stories.get(story.sourceId))) batch.push(stories.get(story.sourceId));
            continue;
          }
          stories.set(story.sourceId, story);
          const row = card(story);
          rows.set(story.sourceId, row);
          list.append(row);
          batch.push(story);
        }
        update();
        await loadTargets(batch, run);
        if (run.signal.aborted || controller !== run || !eligible()) break;
        checked += data.contents.length;
        const next = data.nextCursor;
        if (next && (next === cursor || cursors.has(next))) throw new Error("목록의 다음 페이지가 반복돼 불러오기를 중지했어요.");
        complete = !next;
        cursor = next || "";
        if (next) cursors.add(next);
        update();
      }
    } catch (error) {
      if (!run.signal.aborted) failure = error.name === "TimeoutError" ? "응답이 지연되고 있어요. 이어서 불러오기를 눌러 주세요." : error.message || "목록을 불러오지 못했어요.";
    } finally {
      if (controller === run) {
        controller = null;
        update(failure ? `${failure} (현재 ${stories.size}개 표시)` : complete && !stories.size ? "무료대화권이 있는 오리지날 스토리가 없어요." : undefined);
      }
    }
  }
  function close() {
    controller?.abort();
    controller = null;
    if (dialog.open) dialog.close();
    trigger.focus();
  }
  function create() {
    host = node("div"); host.id = "uc-original-trials";
    root = host.attachShadow({ mode: "open" });
    const style = node("style");
    style.textContent = `
      .filters{display:flex;flex-wrap:wrap;gap:10px 20px;padding:0 24px 14px}.filter-group{display:flex;align-items:center;gap:6px}.filter-label{font-size:12px;color:#aaa;margin-right:4px}.filter-group button{padding:7px 12px;font-size:13px;border-radius:8px}.filter-group button[aria-pressed="true"]{background:#ef493c24;border-color:#ef655b;color:#ff9189}.empty{padding:30px 0;text-align:center;color:#aaa;font-size:14px}
      :host{font-family:Pretendard,system-ui,sans-serif;color-scheme:dark;color:#f4f4f5}*{box-sizing:border-box}button,a{font:inherit}button{cursor:pointer;border:1px solid #45454b;border-radius:10px;background:#29292e;color:#fff;padding:10px 14px}button:hover{background:#39393f}button:focus-visible,a:focus-visible{outline:2px solid #ff655c;outline-offset:3px}button:disabled{opacity:.45;cursor:wait}
      .trigger{position:fixed;right:80px;bottom:18px;z-index:2147483645;height:48px;background:#e8443c;border-color:#f45a52;font-weight:750;box-shadow:0 8px 28px #0006}.trigger:hover{background:#f15349}
      dialog{width:min(760px,calc(100vw - 24px));max-height:calc(100dvh - 40px);padding:0;border:1px solid #414147;border-radius:20px;background:#18181b;color:#f4f4f5;box-shadow:0 24px 80px #0009}dialog::backdrop{background:#000a;backdrop-filter:blur(4px)}.layout{display:flex;flex-direction:column;max-height:calc(100dvh - 44px)}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:22px 24px 12px}h2{margin:0;font-size:22px;letter-spacing:-.6px}.sub{margin:0;padding:0 24px 12px;color:#a9a9b2;font-size:13px;line-height:1.6}.status{padding:12px 24px;background:#222226;font-size:13px;color:#ccc;margin:0}.list{overflow:auto;overscroll-behavior:contain;padding:4px 24px;min-height:100px}.card{display:flex;gap:18px;padding:20px 0;border-bottom:1px solid #303035;text-decoration:none;color:inherit}.card:hover h3{color:#ff7068}.cover{position:relative;flex:0 0 108px;height:148px;border-radius:10px;overflow:hidden;background:#303037;color:#8b8b96;display:grid;place-items:center;font-size:12px}.cover img{position:absolute;width:100%;height:100%;object-fit:cover}.info{min-width:0;flex:1}.original{color:#fa655b;font-size:10px;font-weight:850;letter-spacing:.8px}h3{margin:5px 0;font-size:17px;overflow-wrap:anywhere}p{margin:4px 0}.creator,.stats,.expiry{color:#9696a2;font-size:12px}.description{font-size:13px;line-height:1.5;color:#ccc;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.counts{display:flex;gap:8px;align-items:center;margin-top:10px;font-size:12px;color:#aaa}.pass{display:inline-block;background:#ef493c24;color:#ff8076;font-size:13px;font-weight:750;border-radius:6px;padding:5px 9px}.pass.muted{background:#36363c;color:#aaa}.expiry{margin-top:7px}footer{display:flex;justify-content:flex-end;gap:8px;padding:14px 24px;border-top:1px solid #303035}[hidden]{display:none!important}@media(max-width:480px){header{padding:18px 16px 10px}h2{font-size:19px}.list{padding:0 16px}.cover{flex-basis:82px;height:115px}.card{gap:12px}h3{font-size:15px}.trigger{font-size:13px}.sub,.status{padding-left:16px;padding-right:16px}}
    `;
    trigger = node("button", "오리지날 찍먹", "trigger");
    trigger.type = "button"; trigger.setAttribute("aria-haspopup", "dialog");
    dialog = node("dialog"); dialog.setAttribute("aria-labelledby", "uc-trials-title");
    const layout = node("div", undefined, "layout");
    const top = node("header");
    const title = node("h2", "오리지날 찍먹 스토리"); title.id = "uc-trials-title";
    const dismiss = node("button", "닫기"); dismiss.addEventListener("click", close);
    top.append(title, dismiss);
    status = node("p", "", "status"); status.setAttribute("role", "status");
    list = node("div", undefined, "list");
    emptyState = node("p", "", "empty");
    list.append(emptyState);
    const filterBar = node("div", undefined, "filters");
    filterBar.append(
      filterGroup("작품 성향", "target", [["all", "전체"], ["남성향", "남성향"], ["여성향", "여성향"]]),
      filterGroup("이용 등급", "safety", [["all", "전체"], ["safe", "세이프"], ["unsafe", "언세이프"]])
    );
    const footer = node("footer");
    refreshButton = node("button", "새로고침"); refreshButton.addEventListener("click", () => load(true));
    nextButton = node("button", "이어서 불러오기"); nextButton.addEventListener("click", () => controller ? controller.abort() : load());
    footer.append(refreshButton, nextButton);
    layout.append(top, node("p", "작품별 무료대화권과 남은 횟수 · 작품을 누르면 새 탭에서 열립니다.", "sub"), filterBar, status, list, footer);
    dialog.append(layout);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
    trigger.addEventListener("click", () => { dialog.showModal(); load(true); });
    root.append(style, trigger, dialog); document.body.append(host);
  }
  globalThis.__ucOriginalTrials = {
    sync(requestHeaders) {
      headers = requestHeaders;
      if (eligible()) { if (!host?.isConnected) create(); }
      else if (host) { controller?.abort(); controller = null; if (dialog.open) dialog.close(); host.remove(); host = null; }
    }
  };
})();

  function pageCookieValue(name) {
    const prefix = `${name}=`;
    const pair = String(document.cookie || "")
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(prefix));
    if (!pair) return "";
    try {
      return decodeURIComponent(pair.slice(prefix.length));
    } catch {
      return pair.slice(prefix.length);
    }
  }
  function historyRequestHeaders() {
    const accessToken = pageCookieValue("access_token");
    const wrtnId = pageCookieValue("__w_id");
    return {
      accept: "application/json",
      platform: "web",
      "wrtn-locale": "ko-KR",
      ...(accessToken ? {
        Authorization: accessToken.startsWith("Bearer ") ? accessToken : `Bearer ${accessToken}`
      } : {}),
      ...(wrtnId ? { "x-wrtn-id": wrtnId } : {})
    };
  }
  // The script matches the whole site so client-side navigation also works.
  // The feature itself only mounts on the requested profile and story tab.
  function syncOriginalTrials() {
    globalThis.__ucOriginalTrials.sync(historyRequestHeaders);
  }
  syncOriginalTrials();
  addEventListener("popstate", syncOriginalTrials);
  let trialsLastUrl = location.href;
  setInterval(() => {
    if (location.href === trialsLastUrl) return;
    trialsLastUrl = location.href;
    syncOriginalTrials();
  }, 500);

})();
