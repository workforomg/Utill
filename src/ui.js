/** Site DOM adaptation only. These selectors are intentionally kept in one file. */
export const SELECTORS = Object.freeze({
  prompt: 'textarea[placeholder="메시지 보내기"]',
  editor: '.tiptap[contenteditable="true"],.ProseMirror[contenteditable="true"]',
  placeholder: '[data-placeholder="메시지 보내기"]',
  message: '[data-message-group-id]',
  menu: '[role="menu"]',
});

export function parseRoute(pathname = globalThis.location?.pathname ?? "/") {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  let match;
  if ((match = /^\/(stories|characters)\/([a-f\d]+)\/(episodes|chats)(?:\/([a-f\d]+))?$/i.exec(path))) {
    const kind = match[1].toLowerCase() === "stories" ? "story" : "character";
    if ((kind === "story" && match[3] !== "episodes") || (kind === "character" && match[3] !== "chats")) return { kind: "other", path };
    return { kind, contentId: match[2], chatId: match[4] ?? null, path };
  }
  if ((match = /^\/u\/([a-f\d]+)\/c\/([a-f\d]+)$/i.exec(path))) return { kind: "story", contentId: match[1], chatId: match[2], legacy: true, path };
  if ((match = /^\/stories\/([a-f\d]+)\/parties\/([a-f\d]+)$/i.exec(path))) return { kind: "party", contentId: match[1], chatId: match[2], path };
  if ((match = /^\/arpg\/([a-f\d]+)\/(?:([a-f\d]+)\/play|play\/([a-f\d]+))$/i.exec(path))) return { kind: "arpg", contentId: match[1], characterId: match[2] ?? match[3], path };
  if ((match = /^\/arpg\/([a-f\d]+)\/builder$/i.exec(path))) return { kind: "builder-arpg", contentId: match[1], path };
  if ((match = /^\/builder\/(story|character)$/.exec(path))) return { kind: `builder-${match[1]}`, path };
  return { kind: path === "/" ? "home" : path === "/my" ? "my" : "other", path };
}

export function isChatRoute(route = parseRoute()) {
  return (route.kind === "story" || route.kind === "character") && Boolean(route.chatId);
}

export function getTheme(doc = document) {
  const root = doc.documentElement;
  const explicit = root.getAttribute("data-theme") ?? doc.body?.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return root.classList.contains("dark") || doc.body?.classList.contains("dark") ? "dark" : "light";
}

export function getPrompt(root = document) {
  const old = root.querySelector(SELECTORS.prompt);
  if (old) return old;
  const editors = [...root.querySelectorAll(SELECTORS.editor)].filter(el => !el.closest('[role="dialog"]'));
  return editors.find(el => el.querySelector(SELECTORS.placeholder)) ?? (editors.length === 1 ? editors[0] : null);
}

export function readPrompt(element = getPrompt()) {
  if (!element) return "";
  return element.tagName === "TEXTAREA" ? element.value : element.innerText ?? element.textContent ?? "";
}

export function setPrompt(text, element = getPrompt()) {
  if (!element) throw new Error("Chat input not found");
  const win = element.ownerDocument.defaultView;
  if (element.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value").set;
    setter.call(element, String(text));
    element.dispatchEvent(new win.Event("input", { bubbles: true }));
    return;
  }
  // Native editing reaches Tiptap's normal transaction path; no React/Fiber introspection.
  element.focus();
  const selection = win.getSelection();
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  if (!element.ownerDocument.execCommand("insertText", false, String(text))) throw new Error("Native editor insertion is unsupported");
}

/** Idempotent decoration outside the editor, avoiding any mutation of its document content. */
export function decoratePrompt(key, create, root = document) {
  const input = getPrompt(root);
  if (!input?.parentElement) return null;
  const parent = input.parentElement;
  let slot = [...parent.children].find(el => el.getAttribute("data-crack-sdk-slot") === key);
  if (slot) return slot;
  slot = input.ownerDocument.createElement("div");
  slot.setAttribute("data-crack-sdk-slot", key);
  slot.style.cssText = "display:flex;gap:8px;align-items:center;width:100%;box-sizing:border-box;flex-shrink:0";
  create(slot);
  parent.insertBefore(slot, input);
  return slot;
}

export function getMessageId(element) {
  return element?.closest(SELECTORS.message)?.getAttribute("data-message-group-id") ?? null;
}

/** Debounces DOM/SPA updates and returns a complete disposer. Callbacks must be idempotent. */
export function watchDOM(callback, { root = document, delay = 60, onError = console.error } = {}) {
  let timer, stopped = false;
  const run = () => {
    timer = undefined;
    if (stopped) return;
    try { Promise.resolve(callback()).catch(onError); } catch (error) { onError(error); }
  };
  const schedule = () => { if (!stopped && timer === undefined) timer = setTimeout(run, delay); };
  const win = root.defaultView ?? root.ownerDocument?.defaultView ?? window;
  const observer = new win.MutationObserver(schedule);
  observer.observe(root, { subtree: true, childList: true, attributes: true });
  win.addEventListener("popstate", schedule);
  // pushState can change the URL without a mutation or popstate; avoid replacing site functions.
  let href = win.location.href;
  const routeTimer = setInterval(() => { if (href !== win.location.href) { href = win.location.href; schedule(); } }, 300);
  run();
  return () => { stopped = true; clearTimeout(timer); clearInterval(routeTimer); observer.disconnect(); win.removeEventListener("popstate", schedule); };
}

export function toast(message, { duration = 3000, doc = document } = {}) {
  let region = doc.getElementById("crack-sdk-toast");
  if (!region) {
    region = doc.createElement("div");
    region.id = "crack-sdk-toast";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.style.cssText = "position:fixed;z-index:2147483647;top:24px;left:50%;transform:translateX(-50%);width:min(460px,calc(100vw - 24px));pointer-events:none";
    doc.body.append(region);
  }
  const node = doc.createElement("div");
  node.textContent = String(message);
  node.style.cssText = "background:#2e2d2b;color:white;border-radius:10px;padding:16px;text-align:center;font:500 16px/1.5 sans-serif;white-space:pre-line";
  region.replaceChildren(node);
  const remove = () => { node.remove(); if (!region.childElementCount) region.remove(); };
  const timer = setTimeout(remove, duration);
  return () => { clearTimeout(timer); remove(); };
}

export function mountPanel({ title, render, doc = document }) {
  const dialog = doc.createElement("dialog");
  dialog.style.cssText = "background:Canvas;color:CanvasText;border:1px solid #888;border-radius:12px;padding:24px;width:min(600px,85vw);max-height:80vh;overflow:auto";
  dialog.setAttribute("aria-label", title);
  const heading = doc.createElement("h2");
  heading.textContent = title;
  const close = doc.createElement("button");
  close.textContent = "닫기";
  close.style.cssText = "float:right;cursor:pointer;padding:6px 12px";
  close.addEventListener("click", () => dialog.close());
  const content = doc.createElement("div");
  dialog.append(close, heading, content);
  render(content);
  doc.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  return () => { dialog.close(); dialog.remove(); };
}

export function mountSettingsButton(key, label, onClick, root = document) {
  const link = root.querySelector('a[href="/setting"],a[href="/my-page"]');
  if (!link?.parentElement) return null;
  let button = [...link.parentElement.children].find(el => el.getAttribute("data-crack-sdk-button") === key);
  if (button) return button;
  button = link.ownerDocument.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("data-crack-sdk-button", key);
  button.style.cssText = "display:block;background:none;color:inherit;border:0;padding:12px;cursor:pointer";
  button.addEventListener("click", onClick);
  link.parentElement.append(button);
  return button;
}

export function mountArticleAction(key, label, onClick, root = document) {
  // Ignore unrelated sort/visibility popovers; only an actual article action menu qualifies.
  const menu = [...root.querySelectorAll(SELECTORS.menu)].find(el =>
    [...el.querySelectorAll('[role="menuitem"]')].some(item => item.textContent.trim() === "수정하기"));
  if (!menu) return null;
  const existing = [...menu.children].find(el => el.getAttribute("data-crack-sdk-action") === key);
  if (existing) return existing;
  const button = menu.ownerDocument.createElement("button");
  button.type = "button";
  button.setAttribute("role", "menuitem");
  button.setAttribute("data-crack-sdk-action", key);
  button.textContent = label;
  button.style.cssText = "display:block;width:100%;text-align:left;background:transparent;color:inherit;border:0;padding:8px;cursor:pointer";
  button.addEventListener("click", event => { event.stopPropagation(); onClick(event); });
  menu.append(button);
  return button;
}

export function mountSideAction(key, label, onClick, root = document) {
  const header = [...root.querySelectorAll("span,p")].find(el => el.textContent.trim() === "채팅방 설정");
  const parent = header?.parentElement;
  if (!parent) return null;
  const existing = [...parent.children].find(el => el.getAttribute("data-crack-sdk-action") === key);
  if (existing) return existing;
  const button = header.ownerDocument.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("data-crack-sdk-action", key);
  button.style.cssText = "display:block;width:100%;background:transparent;color:inherit;text-align:left;border:0;padding:12px;cursor:pointer";
  button.addEventListener("click", onClick);
  header.after(button);
  return button;
}
