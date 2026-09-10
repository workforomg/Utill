import { createTransport, createSocketTransport, unwrapData, paginate, collect, ResponseError, sleep } from "./http.js";

/** All site endpoint knowledge lives here. Observed build: main-arm64-bf95710, 2026-09-09. */
export const ENDPOINTS = Object.freeze({
  chat: "/crack-gen/v3/chats",
  models: "/crack-gen/v3/chat-models",
  story: "/crack-api/stories",
  character: "/crack-api/characters",
  temporaryStories: "/crack-api/temp-stories",
  attendance: "/crack-cash/attendance",
  crackers: "/crack-cash/crackers",
  alarms: "/crack-api/alarm",
  bulkImages: "/crack-api/situation-images/presigned-urls/bulk",
  situationImages: "/crack-api/situation-images",
  storyDrafts: "/crack-api/story-drafts",
});

function segment(id) {
  if (typeof id !== "string" || !id.trim() || id === "." || id === "..") throw new TypeError("A nonempty ID is required");
  return encodeURIComponent(id);
}

export function isAttendanceTime(now = new Date()) {
  return (now.getUTCHours() + 9) % 24 >= 6;
}

export function createCrackAPI(options = {}) {
  const request = options.request ?? createTransport(options);
  const data = async (path, init) => unwrapData(await request(path, init));
  const chatPath = id => `${ENDPOINTS.chat}/${segment(id)}`;
  const messagesPath = id => `${chatPath(id)}/messages`;
  const summariesPath = id => `${chatPath(id)}/summaries`;
  const messages = (id, options = {}) => paginate(request, messagesPath(id), "messages", {
    ...options, query: { sortOrder: "desc", ...options.query },
  });
  const summaries = (id, options = {}) => paginate(request, summariesPath(id), "summaries", {
    ...options, query: { type: "longTerm", orderBy: "newest", filter: "all", ...options.query },
  });
  return Object.freeze({
    request,
    chat: Object.freeze({
      get: (id, options) => data(chatPath(id), options),
      getMessage: (id, messageId, options) => data(`${messagesPath(id)}/${segment(messageId)}`, options),
      messages,
      export: (id, options = {}) => collect(messages(id, options), { reverse: options.naturalOrder !== false }),
      async last(id, role, options = {}) {
        for await (const item of messages(id, options)) if (!role || item.role === role) return item;
        return null;
      },
      update: (id, body, options = {}) => data(chatPath(id), { ...options, method: "PATCH", body }),
      editMessage: (id, messageId, body, options = {}) => data(`${messagesPath(id)}/${segment(messageId)}`, { ...options, method: "PATCH", body }),
      deleteMessage: (id, messageId, options = {}) => data(`${messagesPath(id)}/${segment(messageId)}`, { ...options, method: "DELETE" }),
      create: (body, options = {}) => data(ENDPOINTS.chat, { ...options, method: "POST", body }),
      branch: (id, body, options = {}) => data(`${chatPath(id)}/branch`, { ...options, method: "POST", body }),
      getDefaultSettings: options => data(`${ENDPOINTS.chat}/default-chat-setting`, options),
      setDefaultSettings: (body, options = {}) => data(`${ENDPOINTS.chat}/default-chat-setting`, { ...options, method: "POST", body }),
    }),
    memory: Object.freeze({
      iterate: summaries,
      export: (id, options = {}) => collect(summaries(id, options), { reverse: options.naturalOrder !== false }),
      create: (id, body, options = {}) => data(summariesPath(id), { ...options, method: "POST", body: { ...body, type: "longTerm" } }),
      update: (id, summaryId, body, options = {}) => data(`${summariesPath(id)}/${segment(summaryId)}`, { ...options, method: "PATCH", body }),
      delete: (id, summaryId, options = {}) => data(`${summariesPath(id)}/${segment(summaryId)}`, { ...options, method: "DELETE" }),
      version: (id, options) => data(`${summariesPath(id)}/version`, options),
      setShortTerm: (id, summary, options = {}) => data(summariesPath(id), { ...options, method: "PUT", body: { summary } }),
      deleteMany: (id, summaryIds, options = {}) => data(summariesPath(id), { ...options, method: "DELETE", body: { summaryIds } }),
      markRead: (id, options = {}) => data(`${summariesPath(id)}/read`, { ...options, method: "POST" }),
    }),
    story: Object.freeze({
      get: (id, options) => data(`${ENDPOINTS.story}/me/${segment(id)}`, options),
      getPublic: (id, options) => data(`${ENDPOINTS.story}/${segment(id)}`, options),
      reserve: (options = {}) => data(ENDPOINTS.temporaryStories, { ...options, method: "POST" }),
      create: (body, options = {}) => data(`${ENDPOINTS.story}/v2`, { ...options, method: "POST", body }),
      update: (id, body, options = {}) => data(`${ENDPOINTS.story}/${segment(id)}/v2`, { ...options, method: "PATCH", body }),
    }),
    character: Object.freeze({
      get: (id, options) => data(`${ENDPOINTS.character}/me/${segment(id)}`, options),
      getPublic: (id, options) => data(`${ENDPOINTS.character}/${segment(id)}`, options),
      reserve: (options = {}) => data(`${ENDPOINTS.character}/new`, { ...options, method: "POST" }),
      create: (id, body, options = {}) => data(`${ENDPOINTS.character}/${segment(id)}`, { ...options, method: "POST", body: { ...body, characterId: id } }),
      update: (id, body, options = {}) => data(`${ENDPOINTS.character}/${segment(id)}`, { ...options, method: "PUT", body: { ...body, characterId: id } }),
    }),
    drafts: Object.freeze({
      iterate: (storyId, options = {}) => paginate(request, ENDPOINTS.storyDrafts, "storyDrafts", { ...options, query: { ...options.query, storyId } }),
      get: (id, options) => data(`${ENDPOINTS.storyDrafts}/${segment(id)}`, options),
      save: (storyId, body, options = {}) => data(`${ENDPOINTS.storyDrafts}/v2`, { ...options, method: "POST", body: { ...body, storyId } }),
      deleteMany: (storyDraftIds, options = {}) => data(`${ENDPOINTS.storyDrafts}/delete-many`, { ...options, method: "POST", body: { storyDraftIds } }),
    }),
    userNote: Object.freeze({
      async get(chatId, options) { return (await data(chatPath(chatId), options))?.story?.userNote ?? null; },
      set: (chatId, content, { isExtend = false, ...options } = {}) => {
        if (typeof content !== "string") throw new TypeError("User note must be text");
        if (!isExtend && content.length > 500) throw new RangeError("Standard user note is limited to 500 characters; explicit isExtend required");
        return data(chatPath(chatId), { ...options, method: "PATCH", body: { userNote: { content, isExtend } } });
      },
    }),
    account: Object.freeze({
      attendance: options => data(ENDPOINTS.attendance, options),
      async isAttendable(options) { return (await data(ENDPOINTS.attendance, options))?.attendanceStatus === "NOT_ATTENDED"; },
      attend: (options = {}) => data(ENDPOINTS.attendance, { ...options, method: "POST" }),
      isAttendanceTime,
      crackers: options => data(ENDPOINTS.crackers, options),
      async models({ serviceType, storyId, signal } = {}) {
        const result = await data(ENDPOINTS.models, { query: { serviceType, storyId }, signal });
        if (!Array.isArray(result?.models)) throw new ResponseError("Missing models array");
        return result.models;
      },
    }),
    notifications: Object.freeze({
      iterate: (options = {}) => paginate(request, ENDPOINTS.alarms, "alarms", { ...options, mode: "page" }),
      list: (options = {}) => collect(paginate(request, ENDPOINTS.alarms, "alarms", { ...options, mode: "page" }), { reverse: options.naturalOrder === true }),
    }),
    images: Object.freeze({
      prepareStartingSet: (options = {}) => data("/crack-api/story-starting-sets/prepare", { ...options, method: "POST" }),
      renameCategory: (body, options = {}) => data(`${ENDPOINTS.situationImages}/categories`, { ...options, method: "PATCH", body }),
      renameSituation: (body, options = {}) => data(`${ENDPOINTS.situationImages}/situations`, { ...options, method: "PATCH", body }),
      delete: (id, options = {}) => data(`${ENDPOINTS.situationImages}/${segment(id)}`, { ...options, method: "DELETE" }),
      prepareBulk: (body, options = {}) => data(ENDPOINTS.bulkImages, { ...options, method: "POST", body }),
      status: (storyId, { baseSetIds, ...query }, options = {}) => data(`${ENDPOINTS.situationImages}/stories/${segment(storyId)}/starting-sets`, { ...options, query: { ...query, "baseSetIds[]": baseSetIds } }),
      // This performs a raw signed upload. It deliberately never uses the auth transport.
      async upload(url, blob, { signal, fetch: uploadFetch = globalThis.fetch } = {}) {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") throw new TypeError("Signed upload URL must use HTTPS");
        const result = await uploadFetch(url, { method: "PUT", body: blob, signal, credentials: "omit", headers: { "Content-Type": blob.type || "application/octet-stream" } });
        if (!result.ok) throw new Error(`Image upload failed: ${result.status}`);
      },
    }),
  });
}

/** Separate sockets per chat; acknowledgements are acceptance, not generation completion. */
export function createChatSession({ chatId, kind = "story", ...options }) {
  segment(chatId);
  if (!["story", "character"].includes(kind)) throw new TypeError("Only story and character chats are supported");
  const socket = createSocketTransport({ ...options, namespace: kind === "story" ? "/v3/chats" : "/v1/character/chats" });
  let entered = false, entering;
  socket.on("disconnect", () => { entered = false; entering = null; });
  const command = async (name, body = {}) => {
    const response = await socket.emit(name, { ...body, chatId });
    if (response?.error) throw Object.assign(new Error(response.error.message ?? "Chat command failed"), { detail: response.error });
    return response;
  };
  const active = (name, body) => entered ? command(name, body) : Promise.reject(new Error("Enter chat before sending"));
  return Object.freeze({
    on: socket.on,
    get connected() { return socket.connected && entered; },
    connect(options) {
      if (entered) return Promise.resolve();
      if (entering) return entering;
      entering = (async () => { try { await socket.connect(options); await command("enter"); entered = true; } catch (error) { socket.close(error); throw error; } finally { entering = null; } })();
      return entering;
    },
    send(message, { prevMessageId } = {}) { if (typeof message !== "string" || !message.trim()) return Promise.reject(new TypeError("Message text required")); return active("send", { message, prevMessageId }); },
    stop: () => active("stop"),
    reroll: () => active("reroll"),
    continue: prevMessageId => active("continue", { prevMessageId }),
    autoPlay: prevMessageId => active("autoPlay", { prevMessageId }),
    generateEpilogue: prevMessageId => kind === "story" ? active("generateEpilogue", { prevMessageId }) : Promise.reject(new TypeError("Epilogues require story chat")),
    async leave() { try { if (entered) await command("exit"); } finally { socket.close(); } },
    close: socket.close,
  });
}

/** Caller supplies files and category/situation labels; no model downloads or classifiers. */
export async function uploadSituationImages(api, { sourceId, files, startingSets }, {
  signal, concurrency = 4, timeout = 120_000, interval = 2_000, onProgress = () => {},
} = {}) {
  segment(sourceId);
  if (!Array.isArray(files) || !files.length || files.length > 1000 || !Array.isArray(startingSets) || !startingSets.length) throw new TypeError("1..1000 files and starting sets required");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(interval) || interval <= 0) throw new RangeError("Invalid upload limits");
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Image processing timed out", "TimeoutError")), timeout);
  const taskSignal = controller.signal;
  const key = item => JSON.stringify([item.category, item.situation]);
  const lookup = new Map();
  try {
    for (const item of files) {
      if (!item.file || !/^image\/(png|jpeg|webp|gif)$/.test(item.file.type) || typeof item.category !== "string" || typeof item.situation !== "string") throw new TypeError("Supported image file and labels required");
      if (lookup.has(key(item))) throw new TypeError("Duplicate category/situation pair");
      lookup.set(key(item), item.file);
    }
    for (const set of startingSets) segment(set.baseSetId);
    taskSignal.throwIfAborted();
    const prepared = await api.images.prepareBulk({ sourceId, uploads: files.map(({ file, category, situation }) => ({ fileType: file.type.split("/")[1], category, situation })), startingSets }, { signal: taskSignal });
    if (!prepared?.bulkId || !Array.isArray(prepared.startingSets)) throw new ResponseError("Missing bulk image signing result");
    const jobs = [], rejected = [];
    for (const set of prepared.startingSets) {
      if (!Array.isArray(set.uploads) || !Array.isArray(set.rejected)) throw new ResponseError("Invalid signed image set");
      rejected.push(...set.rejected);
      for (const upload of set.uploads) {
        const file = lookup.get(key(upload));
        if (!file || typeof upload.url !== "string") throw new ResponseError("Signed image cannot be matched to input file");
        jobs.push({ ...upload, file, baseSetId: set.baseSetId });
      }
    }
    let index = 0, completed = 0;
    const failed = [];
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (index < jobs.length) {
        taskSignal.throwIfAborted(); const job = jobs[index++];
        try { await api.images.upload(job.url, job.file, { signal: taskSignal }); completed++; }
        catch (error) { taskSignal.throwIfAborted(); failed.push({ category: job.category, situation: job.situation, baseSetId: job.baseSetId, error: error.message }); }
        await onProgress({ phase: "upload", completed, failed: failed.length, total: jobs.length });
      }
    }));
    taskSignal.throwIfAborted();
    if (!completed) return { bulkId: prepared.bulkId, complete: false, rejected, failed, startingSets: [] };
    while (true) {
      taskSignal.throwIfAborted();
      const status = await api.images.status(sourceId, { bulkId: prepared.bulkId, baseSetIds: startingSets.map(set => set.baseSetId) }, { signal: taskSignal });
      if (!Array.isArray(status?.startingSets) || !status.startingSets.length) throw new ResponseError("Missing image processing status");
      let total = 0, success = 0, errors = 0;
      for (const set of status.startingSets) {
        const p = set.progress;
        if (![p?.totalCount, p?.successCount, p?.errorCount].every(n => Number.isInteger(n) && n >= 0)) throw new ResponseError("Invalid image processing progress");
        total += p.totalCount; success += p.successCount; errors += p.errorCount;
      }
      await onProgress({ phase: "processing", total, success, errors });
      taskSignal.throwIfAborted();
      const serverRejected = status.startingSets.flatMap(set => set.rejected ?? []);
      if (total >= completed && success + errors >= total - failed.length) return { ...status, bulkId: prepared.bulkId, complete: failed.length === 0 && rejected.length === 0 && serverRejected.length === 0 && errors === 0, rejected: [...rejected, ...serverRejected], failed };
      await sleep(interval, taskSignal);
    }
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort(); }
}

/** Read-only integration checks for the caller's signed-in runtime. Never returns personal content. */
export async function verifyReadAccess(api, { chatId, storyId, characterId, signal, onResult = () => {} } = {}) {
  const checks = [
    ["models", () => api.account.models({ signal }), value => Array.isArray(value) ? { count: value.length } : null],
    ["attendance", () => api.account.attendance({ signal }), value => typeof value?.attendanceStatus === "string" ? { responseValid: true } : null],
    ["notifications", () => api.notifications.list({ max: 20, signal }), value => Array.isArray(value) ? { count: value.length, limited: true } : null],
  ];
  if (chatId) checks.push(
    ["chat", () => api.chat.get(chatId, { signal }), value => value && typeof value === "object" ? { responseValid: true } : null],
    ["messages", () => api.chat.export(chatId, { signal }), value => Array.isArray(value) ? { count: value.length, nonRerollCount: value.filter(item => !item.reroll).length } : null],
    ["memories", () => api.memory.export(chatId, { signal }), value => Array.isArray(value) ? { count: value.length } : null],
  );
  if (storyId) checks.push(["owned-story", () => api.story.get(storyId, { signal }), value => Array.isArray(value?.startingSets) ? { responseValid: true } : null]);
  if (characterId) checks.push(["owned-character", () => api.character.get(characterId, { signal }), value => value && typeof value === "object" ? { responseValid: true } : null]);
  const results = [];
  for (const [name, run, inspect] of checks) {
    signal?.throwIfAborted(); let result;
    try {
      const metadata = inspect(await run()); signal?.throwIfAborted();
      result = metadata ? { name, ok: true, ...metadata } : { name, ok: false, error: "UnexpectedResponse" };
    } catch (error) {
      signal?.throwIfAborted();
      result = { name, ok: false, error: error.name, ...(Number.isInteger(error.status) ? { status: error.status } : {}) };
    }
    results.push(result); await onResult(result);
  }
  return { checkedAt: new Date().toISOString(), ok: results.every(item => item.ok), checks: results };
}
