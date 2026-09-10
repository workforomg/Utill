import { parseRoute, isChatRoute, getPrompt, readPrompt, getMessageId, decoratePrompt, watchDOM, toast, mountSideAction, mountPanel } from "./ui.js";
import { backupChat, exportJSON, download } from "./backup.js";

/** Optional features. Importing this file never starts observers, requests or timers. */
export function poll(task, { interval = 30_000, maxInterval = Math.max(300_000, interval), onError = console.error } = {}) {
  if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(maxInterval) || maxInterval < interval) throw new RangeError("Invalid polling interval");
  const controller = new AbortController();
  let timer, next = interval;
  const run = async () => {
    try { await task(controller.signal); next = interval; }
    catch (error) {
      if (!controller.signal.aborted) {
        next = Math.min(next * 2, maxInterval);
        try { onError(error); } catch { /* Reporting must not stop cleanup. */ }
      }
    }
    if (!controller.signal.aborted) timer = setTimeout(run, next);
  };
  void run();
  return () => { controller.abort(); clearTimeout(timer); };
}

export function watchMemory(api, { chatId = () => isChatRoute() ? parseRoute().chatId : null, onChange = () => toast("요약 메모리가 변경되었어요."), ...options } = {}) {
  const previous = new Map();
  return poll(async signal => {
    const id = chatId();
    if (!id) return;
    const next = await api.memory.export(id, { signal });
    signal.throwIfAborted();
    const signature = JSON.stringify(next);
    const old = previous.get(id);
    if (old !== undefined && old !== signature) await onChange(next, id);
    previous.set(id, signature);
  }, options);
}

export function watchNotifications(api, { onNotification = notification => toast(notification.title ?? notification.content ?? "새 알림"), ...options } = {}) {
  let seen = null;
  return poll(async signal => {
    const items = await api.notifications.list({ max: 100, signal });
    signal.throwIfAborted();
    const ids = new Set(items.map(item => item._id ?? item.id));
    if (ids.has(undefined)) throw new Error("Notification has no ID");
    if (seen) for (const item of [...items].reverse()) {
      signal.throwIfAborted();
      const id = item._id ?? item.id;
      if (!seen.has(id)) { await onNotification(item); seen.add(id); }
    }
    seen = ids;
  }, options);
}

export function watchAttendance(api, { onAvailable = () => toast("크랙 출석을 할 수 있어요."), ...options } = {}) {
  let lastDay;
  return poll(async signal => {
    if (!api.account.isAttendanceTime()) return;
    const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    if (lastDay === day) return;
    const available = await api.account.isAttendable({ signal });
    signal.throwIfAborted();
    if (available) { await onAvailable(); lastDay = day; }
  }, { interval: 60_000, ...options });
}

export function installLongPressCopy(api, { root = document, milliseconds = 650, onError = console.error } = {}) {
  let timer, point, fired = false;
  const controller = new AbortController();
  const cancel = () => { clearTimeout(timer); point = undefined; };
  const start = event => {
    cancel(); fired = false;
    if (event.button !== 0 || !isChatRoute()) return;
    const input = getPrompt(root), target = event.target;
    const isPrompt = input?.contains(target);
    const id = getMessageId(target), chatId = parseRoute().chatId;
    if (!isPrompt && !id) return;
    point = { x: event.clientX, y: event.clientY };
    timer = setTimeout(async () => {
      fired = true;
      try {
        const content = isPrompt ? readPrompt(input) : (await api.chat.getMessage(chatId, id, { signal: controller.signal })).content;
        if (controller.signal.aborted) return;
        const win = root.defaultView ?? root.ownerDocument.defaultView;
        await win.navigator.clipboard.writeText(String(content ?? ""));
        toast("복사되었어요.");
      } catch (error) { if (!controller.signal.aborted) onError(error); }
    }, milliseconds);
  };
  const move = event => { if (point && Math.hypot(point.x - event.clientX, point.y - event.clientY) > 10) cancel(); };
  const context = event => { if (fired) event.preventDefault(); };
  const handlers = { pointerdown: start, pointerup: cancel, pointercancel: cancel, pointermove: move, contextmenu: context };
  for (const [event, handler] of Object.entries(handlers)) root.addEventListener(event, handler);
  return () => { cancel(); controller.abort(); for (const [event, handler] of Object.entries(handlers)) root.removeEventListener(event, handler); };
}

/** Counts stored non-reroll messages, matching the original counter's counting rule. */
export function installCounter(api, { root = document, interval = 30_000, onError = console.error } = {}) {
  const counts = new Map();
  let activeId, slot;
  const render = () => {
    const route = parseRoute();
    if (!isChatRoute(route)) { slot?.remove(); slot = null; return; }
    if (activeId !== route.chatId) { slot?.remove(); slot = null; activeId = route.chatId; }
    slot = decoratePrompt("counter", () => {}, root);
    if (slot) {
      const label = counts.has(activeId) ? `${counts.get(activeId)}개 메시지` : "메시지 수 확인 중";
      if (slot.textContent !== label) slot.textContent = label;
    }
  };
  const stopDOM = watchDOM(render, { root, onError });
  const stopPoll = poll(async signal => {
    const route = parseRoute();
    if (!isChatRoute(route)) return;
    let count = 0;
    for await (const message of api.chat.messages(route.chatId, { signal })) if (!message.reroll) count++;
    signal.throwIfAborted();
    counts.set(route.chatId, count);
    render();
  }, { interval, onError });
  return () => { stopDOM(); stopPoll(); slot?.remove(); };
}

export function installBackupAction(api, { root = document, onError = console.error } = {}) {
  const controller = new AbortController();
  let button, busy = false;
  const stop = watchDOM(() => {
    if (!isChatRoute()) { button?.remove(); button = null; return; }
    button = mountSideAction("backup", "채팅 JSON 백업", async () => {
      if (busy) return;
      const id = parseRoute().chatId;
      if (!id) return;
      busy = true;
      try {
        const backup = await backupChat(api, id, { signal: controller.signal });
        if (!controller.signal.aborted) download(exportJSON(backup), `crack-${id}.json`);
      } catch (error) { if (!controller.signal.aborted) onError(error); }
      finally { busy = false; }
    }, root);
  }, { root, onError });
  return () => { stop(); controller.abort(); button?.remove(); };
}

export function installResizableInputs({ root = document } = {}) {
  const modified = new Map();
  const stop = watchDOM(() => {
    if (!parseRoute().kind.startsWith("builder-")) return;
    for (const input of root.querySelectorAll("textarea")) {
      if (modified.has(input)) continue;
      modified.set(input, { resize: input.style.resize, overflow: input.style.overflow, minHeight: input.style.minHeight });
      input.style.resize = "vertical";
      input.style.overflow = "auto";
      input.style.minHeight = "80px";
    }
  }, { root });
  return () => { stop(); for (const [node, style] of modified) Object.assign(node.style, style); };
}

/** Keeps notebook storage local; applying a note to the site remains a caller action. */
export function createNotebook(store) {
  const key = (contentId, name) => `note:${encodeURIComponent(contentId)}:${encodeURIComponent(name)}`;
  return Object.freeze({
    save(contentId, name, content) { return store.set(key(contentId, name), { contentId, name, content, updatedAt: new Date().toISOString() }); },
    get: (contentId, name) => store.get(key(contentId, name)),
    remove: (contentId, name) => store.remove(key(contentId, name)),
    list(contentId) { return store.keys().filter(id => id.startsWith(`note:${encodeURIComponent(contentId)}:`)).map(id => store.get(id)); },
    async apply(api, chatId, contentId, name, options) {
      const note = store.get(key(contentId, name));
      if (!note) throw new Error("Saved note not found");
      return api.userNote.set(chatId, note.content, options);
    },
  });
}

/** Local notebook UI. Applying a selected note is a separate explicit button action. */
export function openNotebook({ notebook, api, contentId, chatId, doc = document }) {
  const controller = new AbortController();
  const closePanel = mountPanel({ title: "내 유저노트", doc, render(root) {
    const select = doc.createElement("select"), name = doc.createElement("input"), content = doc.createElement("textarea"), status = doc.createElement("p");
    select.setAttribute("aria-label", "저장한 노트"); name.setAttribute("aria-label", "노트 이름"); content.setAttribute("aria-label", "노트 내용");
    content.rows = 10; content.style.cssText = "display:block;width:100%;resize:vertical";
    const refresh = () => { select.replaceChildren(); for (const note of notebook.list(contentId)) { const option = doc.createElement("option"); option.value = option.textContent = note.name; select.append(option); } };
    select.addEventListener("change", () => { const note = notebook.get(contentId, select.value); if (note) { name.value = note.name; content.value = note.content; } });
    const action = (label, handler) => { const button = doc.createElement("button"); button.type = "button"; button.textContent = label; button.addEventListener("click", async () => { button.disabled = true; try { await handler(); } catch (error) { if (!controller.signal.aborted) status.textContent = error.message; } finally { button.disabled = false; } }); return button; };
    root.append(select, name, content,
      action("로컬 저장", () => { if (!name.value.trim()) throw new Error("노트 이름을 입력하세요."); notebook.save(contentId, name.value.trim(), content.value); refresh(); status.textContent = "로컬에 저장했습니다."; }),
      action("로컬 삭제", () => { notebook.remove(contentId, name.value.trim()); refresh(); status.textContent = "로컬 노트를 삭제했습니다."; }),
      action("이 채팅방에 적용", async () => { if (!chatId) throw new Error("채팅방이 필요합니다."); await api.userNote.set(chatId, content.value, { signal: controller.signal }); if (!controller.signal.aborted) status.textContent = "채팅방에 적용했습니다. 사이트 설정 화면은 다시 열어 확인하세요."; }), status);
    status.setAttribute("role", "status"); refresh();
    root.closest("dialog")?.addEventListener("close", () => controller.abort(), { once: true });
  } });
  return () => { controller.abort(); closePanel(); };
}

/** Uses browser notifications only after the caller explicitly requests permission. */
export async function requestNotificationPermission(NotificationClass = globalThis.Notification) {
  if (!NotificationClass) return "unsupported";
  return NotificationClass.permission === "default" ? NotificationClass.requestPermission() : NotificationClass.permission;
}

export function notifyDesktop(title, { body, tag, Notification: NotificationClass = globalThis.Notification } = {}) {
  if (!NotificationClass || NotificationClass.permission !== "granted") return null;
  return new NotificationClass(String(title), { body: String(body ?? ""), tag });
}

/** Frozen thumbnails use a local canvas; image data is never exported or sent elsewhere. */
export function installFrozenThumbnails({ root = document, selector = 'img[alt="character_thumbnail"]' } = {}) {
  const modified = new Map();
  const stop = watchDOM(() => {
    for (const img of root.querySelectorAll(selector)) {
      const source = img.currentSrc || img.src;
      const old = modified.get(img);
      if (old?.source === source || !img.complete || !img.naturalWidth || !img.parentElement) continue;
      old?.dispose();
      const canvas = img.ownerDocument.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.drawImage(img, 0, 0);
      canvas.className = img.className;
      canvas.style.cssText = img.style.cssText;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", img.alt);
      const originalVisibility = img.style.visibility;
      const enter = () => { canvas.hidden = true; img.style.visibility = originalVisibility; };
      const leave = () => { canvas.hidden = false; img.style.visibility = "hidden"; };
      const parent = img.parentElement;
      parent.insertBefore(canvas, img);
      leave();
      parent.addEventListener("pointerenter", enter);
      parent.addEventListener("pointerleave", leave);
      const dispose = () => { canvas.remove(); img.style.visibility = originalVisibility; parent.removeEventListener("pointerenter", enter); parent.removeEventListener("pointerleave", leave); };
      modified.set(img, { source, dispose });
    }
    for (const [img, state] of modified) if (!img.isConnected) { state.dispose(); modified.delete(img); }
  }, { root });
  return () => { stop(); for (const state of modified.values()) state.dispose(); };
}

export function installPortraitLayout({ root = document, selector = '[data-testid="virtuoso-scroller"] img' } = {}) {
  const saved = new Map();
  const stop = watchDOM(() => {
    for (const img of root.querySelectorAll(selector)) {
      const parent = img.parentElement;
      if (!parent || saved.has(parent)) continue;
      saved.set(parent, { width: parent.style.width, height: parent.style.height, borderRadius: parent.style.borderRadius });
      Object.assign(parent.style, { width: "36px", height: "54px", borderRadius: "0px" });
    }
  }, { root });
  return () => { stop(); for (const [node, style] of saved) Object.assign(node.style, style); };
}

/** Explicit target required: old banners cannot safely be identified from generic button text. */
export function installHiddenElements({ selector, root = document } = {}) {
  if (!selector) throw new TypeError("Provide a verified banner/dialog selector");
  const saved = new Map();
  const stop = watchDOM(() => {
    for (const el of root.querySelectorAll(selector)) {
      if (saved.has(el)) continue;
      saved.set(el, el.hidden);
      el.hidden = true;
    }
  }, { root });
  return () => { stop(); for (const [node, hidden] of saved) node.hidden = hidden; };
}

export function estimateRemainingMessages(quantity, cost) {
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(cost) || cost < 0) throw new RangeError("Nonnegative numeric quantity and cost required");
  return cost === 0 ? Infinity : Math.floor(quantity / cost);
}

/** A host-independent model cost panel; callers provide the effective cost, including options. */
export function openModelCosts({ quantity, models, costOf, doc = document }) {
  if (typeof costOf !== "function") throw new TypeError("Provide costOf(model) for the selected pricing options");
  return mountPanel({ title: "모델별 예상 대화 수", doc, render(root) {
    const description = doc.createElement("p"); description.textContent = `보유 크래커: ${quantity}. 적용한 옵션의 비용 기준 예상치입니다.`; root.append(description);
    const table = doc.createElement("table");
    const heading = doc.createElement("tr");
    for (const label of ["모델", "메시지당 비용", "예상 메시지 수"]) { const th = doc.createElement("th"); th.textContent = label; heading.append(th); } table.append(heading);
    for (const model of models) {
      const cost = costOf(model), count = estimateRemainingMessages(quantity, cost), row = doc.createElement("tr");
      for (const value of [model.name ?? model._id, cost, count === Infinity ? "무료" : count]) { const cell = doc.createElement("td"); cell.textContent = String(value); cell.style.padding = "8px"; row.append(cell); } table.append(row);
    }
    root.append(table);
  } });
}
