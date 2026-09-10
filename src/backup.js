/** Local data and serialization. No dependencies, network, markdown engine or remote images. */
export function exportJSON(value) { return JSON.stringify(value, null, 2); }

export function importJSON(text) {
  return JSON.parse(text, (key, value) => key === "__proto__" || key === "constructor" || key === "prototype" ? undefined : value);
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function exportText(messages) {
  return messages.map(message => `[${message.role ?? "unknown"}]\n${message.content ?? ""}`).join("\n\n");
}

/** HTML stores message text literally. No executable message HTML or external asset requests. */
export function exportHTML(messages, { title = "채팅 백업", markdown = false, media = {} } = {}) {
  const articles = messages.map(message => `<article><h2>${escapeHTML(message.role)}</h2>${markdown ? renderMarkdown(message.content, { media }) : `<pre>${escapeHTML(message.content)}</pre>`}</article>`).join("\n");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escapeHTML(title)}</title><style>body{max-width:800px;margin:40px auto;padding:0 20px;font:16px/1.7 system-ui;background:#fafafa;color:#222}article{padding:16px;margin:16px 0;background:white;border:1px solid #ddd;border-radius:8px}h2{font-size:14px;color:#555}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>${escapeHTML(title)}</h1>${articles}</body></html>`;
}

/** Small, deliberately bounded Markdown subset. Raw HTML is always escaped. */
export function renderMarkdown(value, { media = {} } = {}) {
  const inline = text => {
    const token = /(`[^`\n]+`|!\[([^\]\n]*)\]\(([^\s)]+)\)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)/g;
    let result = "", offset = 0;
    for (const match of text.matchAll(token)) {
      result += escapeHTML(text.slice(offset, match.index)); offset = match.index + match[0].length;
      if (match[0][0] === "`") result += `<code>${escapeHTML(match[0].slice(1, -1))}</code>`;
      else if (match[2] !== undefined) {
        const src = Object.hasOwn(media, match[3]) ? media[match[3]] : null;
        result += typeof src === "string" && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src)
          ? `<img style="max-width:100%" alt="${escapeHTML(match[2])}" src="${src}">` : `<span>[이미지: ${escapeHTML(match[2] || match[3])}]</span>`;
      } else if (match[4] !== undefined) result += `<a href="${escapeHTML(match[5])}" rel="noreferrer noopener">${escapeHTML(match[4])}</a>`;
      else result += match[6] !== undefined ? `<strong>${escapeHTML(match[6])}</strong>` : `<em>${escapeHTML(match[7])}</em>`;
    }
    return result + escapeHTML(text.slice(offset));
  };
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n"), blocks = [];
  let fence = null, code = [], paragraph = [], list = [];
  const flush = () => { if (paragraph.length) { blocks.push(`<p>${paragraph.map(inline).join("<br>")}</p>`); paragraph = []; } if (list.length) { blocks.push(`<ul>${list.map(x => `<li>${inline(x)}</li>`).join("")}</ul>`); list = []; } };
  for (const line of lines) {
    if (/^```/.test(line)) { flush(); if (fence) { blocks.push(`<pre><code>${escapeHTML(code.join("\n"))}</code></pre>`); code = []; fence = null; } else fence = true; continue; }
    if (fence) { code.push(line); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line), item = /^[-*+]\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) { flush(); blocks.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); }
    else if (item) { if (paragraph.length) flush(); list.push(item[1]); }
    else if (/^>\s?/.test(line)) { flush(); blocks.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`); }
    else { if (list.length) flush(); paragraph.push(line); }
  }
  flush(); if (fence) blocks.push(`<pre><code>${escapeHTML(code.join("\n"))}</code></pre>`);
  return blocks.join("\n");
}

/** Explicit image URLs only. Returns embedded bytes; no asset references in the resulting HTML. */
export async function embedImages(urls, { fetch: fetchImpl = globalThis.fetch, signal, maxBytes = 20 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("Positive image byte budget required");
  const media = Object.create(null); let total = 0;
  for (const url of new Set(urls)) {
    signal?.throwIfAborted();
    if (new URL(url).protocol !== "https:") throw new TypeError("Images must use HTTPS");
    const response = await fetchImpl(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
    const type = response.headers.get("content-type")?.split(";")[0];
    if (!/^image\/(png|jpeg|gif|webp)$/.test(type ?? "")) { await response.body?.cancel(); throw new TypeError("Only raster image responses can be embedded"); }
    if (!response.body) throw new Error("Image response has no body");
    const reader = response.body.getReader(), chunks = [];
    try {
      while (true) { signal?.throwIfAborted(); const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) throw new RangeError("Image byte budget exceeded"); chunks.push(value); }
    } finally { await reader.cancel(); reader.releaseLock(); }
    let binary = ""; for (const chunk of chunks) for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
    media[url] = `data:${type};base64,${btoa(binary)}`;
  }
  return media;
}

export function download(value, filename, { type = "application/json", doc = document } = {}) {
  const blob = value instanceof Blob ? value : new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\\/:*?"<>|]/g, "_");
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function backupChat(api, chatId, { signal, ...options } = {}) {
  const session = await api.chat.get(chatId, { signal });
  const messages = await api.chat.export(chatId, { ...options, signal });
  const memories = await api.memory.export(chatId, { ...options, signal });
  return { format: "crack-sdk-backup", version: 1, exportedAt: new Date().toISOString(), session, messages, memories };
}

export function createLocalStore(namespace, storage = globalThis.localStorage) {
  if (!namespace) throw new TypeError("Storage namespace is required");
  const key = id => `${namespace}:${id}`;
  return Object.freeze({
    get(id, fallback = null) { const value = storage.getItem(key(id)); return value === null ? fallback : importJSON(value); },
    set(id, value) { storage.setItem(key(id), exportJSON(value)); return value; },
    remove(id) { storage.removeItem(key(id)); },
    keys() { return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(name => name?.startsWith(`${namespace}:`)).map(name => name.slice(namespace.length + 1)); },
  });
}

/** Lossless local work transfer; no publishing or dependency on the original project. */
export function exportWork(kind, data) {
  if (!["story", "character"].includes(kind) || !data || typeof data !== "object") throw new TypeError("Story or character data required");
  return exportJSON({ format: "crack-sdk-work", version: 1, kind, data });
}

export function importWork(text) {
  const value = importJSON(text);
  if (value?.format !== "crack-sdk-work" || value.version !== 1 || !["story", "character"].includes(value.kind) || !value.data || typeof value.data !== "object" || Array.isArray(value.data)) throw new TypeError("Unsupported work package");
  return value;
}

/** Converts a server story snapshot into a private draft body for explicit review/save. */
export function prepareStoryCopy(source) {
  if (!source || !Array.isArray(source.startingSets)) throw new TypeError("Detailed story snapshot with startingSets required");
  const fields = ["name", "simpleDescription", "detailDescription", "storyDetails", "customPrompt", "isAdult", "genreId", "target", "chatType", "defaultCrackerModel", "chatModelId", "tags", "isCommentBlocked", "originContentTitle", "fanficAgreement", "creatorRecommendedMaxOutput", "addonCategories", "fanfic", "isMovingPortraitImage", "situationImageVersion"];
  const copy = {};
  for (const key of fields) if (Object.hasOwn(source, key)) copy[key] = source[key];
  copy.portraitImageUrl = source.portraitImageUrl ?? source.portraitImage?.gif ?? source.portraitImage?.origin;
  copy.description = source.detailDescription ?? source.description ?? "";
  copy.promptTemplate = source.promptTemplate?.template ?? source.promptTemplate ?? "default";
  copy.visibility = "private";
  copy.chatExamples = source.chatExamples?.map(({ user, character }) => ({ user, character })) ?? [];
  copy.shortcutCommands = source.shortcutCommands?.map(({ name, description, prompt }) => ({ name, description, prompt })) ?? [];
  copy.startingSets = source.startingSets.map(set => {
    const { _id, id, baseSetId, createdAt, updatedAt, ...body } = set;
    if (body.ending?.endings) body.ending = { ...body.ending, endings: body.ending.endings.map(({ _id, id, baseEndingId, ...ending }) => ending) };
    return body;
  });
  return importJSON(exportJSON(copy));
}
