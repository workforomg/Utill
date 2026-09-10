/** Transport only. No site DOM, package, CDN, automatic refresh or background work. */
export class HttpError extends Error {
  constructor(status, body, url) {
    super(`Crack HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export class ResponseError extends Error {
  constructor(message) { super(message); this.name = "ResponseError"; }
}

export function readCookie(name, cookie = globalThis.document?.cookie ?? "") {
  const entry = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!entry) return null;
  const value = entry.slice(name.length + 1);
  try { return decodeURIComponent(value); } catch { return value; }
}

export function createTransport({
  baseURL = "https://crack-api.wrtn.ai",
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  token = () => readCookie("access_token"),
  timeout = 30_000,
} = {}) {
  const base = new URL(baseURL);
  if (!Number.isFinite(timeout) || timeout < 0) throw new RangeError("Invalid timeout");
  return async function request(path, { method = "GET", query, body, signal } = {}) {
    const url = new URL(path, base);
    // Do not send the site's token to arbitrary absolute URLs or upload hosts.
    if (url.origin !== base.origin) throw new TypeError("Request must use the configured API origin");
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach(item => url.searchParams.append(key, String(item)));
      else url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = timeout ? setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeout) : null;
    try {
      controller.signal.throwIfAborted();
      const accessToken = await token();
      controller.signal.throwIfAborted();
      const response = await fetchImpl(url.toString(), {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          platform: "web",
          "wrtn-locale": "ko-KR",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed;
      try { parsed = text.trim() ? JSON.parse(text) : undefined; }
      catch {
        if (!response.ok) throw new HttpError(response.status, text, url.toString());
        throw new ResponseError("Expected JSON from the Crack API");
      }
      if (!response.ok) throw new HttpError(response.status, parsed, url.toString());
      return parsed;
    } finally {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  };
}

export function unwrapData(response) {
  return response && Object.hasOwn(response, "data") ? response.data : response;
}

/** Engine.IO 4 / Socket.IO 5 JSON over native WebSocket. Explicit connect, no replay. */
export function createSocketTransport({
  baseURL = "https://crack-api.wrtn.ai", path = "/character-chat/socket.io/", namespace = "/v3/chats",
  auth = () => { const token = readCookie("access_token"); return token ? { token: `Bearer ${token}`, refreshToken: readCookie("refresh_token") ?? "", platform: "web", wrtnLocale: "ko-KR" } : {}; },
  WebSocket: Socket = globalThis.WebSocket, timeout = 20_000, onError = console.error,
} = {}) {
  const url = new URL(path, baseURL);
  if (url.origin !== new URL(baseURL).origin || url.protocol !== "https:") throw new TypeError("Socket must use the configured HTTPS origin");
  if (!/^\/[\w/-]+$/.test(namespace)) throw new TypeError("Invalid socket namespace");
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError("Positive timeout required");
  url.protocol = "wss:"; url.searchParams.set("EIO", "4"); url.searchParams.set("transport", "websocket");
  const listeners = new Map(), pending = new Map();
  let socket, connected = false, connecting, resolveConnect, rejectConnect, connectTimer, heartbeat, heartbeatMs, nextId = 0, detachSignal;
  const report = error => { try { onError(error); } catch {} };
  const dispatch = (name, ...args) => { for (const fn of listeners.get(name) ?? []) { try { Promise.resolve(fn(...args)).catch(report); } catch (error) { report(error); } } };
  const close = (reason = new Error("Socket closed")) => {
    const old = socket; socket = null; connected = false; connecting = null;
    clearTimeout(connectTimer); clearTimeout(heartbeat); detachSignal?.(); detachSignal = null;
    rejectConnect?.(reason); resolveConnect = rejectConnect = null;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(reason); }
    pending.clear();
    if (old) { old.onmessage = old.onerror = old.onclose = null; old.close(); dispatch("disconnect", reason); }
  };
  const touch = () => { clearTimeout(heartbeat); heartbeat = setTimeout(() => close(new Error("Socket heartbeat expired")), heartbeatMs); };
  const receive = async (event, active) => {
    if (socket !== active) return;
    try {
      const packet = event.data;
      if (typeof packet !== "string") throw new ResponseError("Binary socket packets are unsupported");
      if (packet[0] === "0") {
        const open = JSON.parse(packet.slice(1));
        if (!open.sid || !Number.isFinite(open.pingInterval) || !Number.isFinite(open.pingTimeout) || open.pingInterval <= 0 || open.pingTimeout <= 0) throw new ResponseError("Invalid socket handshake");
        heartbeatMs = open.pingInterval + open.pingTimeout; touch();
        const credentials = await auth();
        if (socket === active) active.send(`40${namespace},${JSON.stringify(credentials)}`);
        return;
      }
      if (packet[0] === "2") { active.send(`3${packet.slice(1)}`); if (heartbeatMs) touch(); return; }
      if (packet[0] === "1") { close(new Error("Server closed connection")); return; }
      if (packet[0] !== "4") return;
      const type = packet[1];
      if (type === "5" || type === "6") throw new ResponseError("Binary socket events are unsupported");
      let rest = packet.slice(2), ns = "/";
      if (rest.startsWith("/")) { const comma = rest.indexOf(","); ns = comma < 0 ? rest : rest.slice(0, comma); rest = comma < 0 ? "" : rest.slice(comma + 1); }
      if (ns !== namespace) return;
      if (type === "0") { connected = true; clearTimeout(connectTimer); resolveConnect?.(); resolveConnect = rejectConnect = null; dispatch("connect"); return; }
      if (type === "1" || type === "4") { close(new ResponseError(type === "4" ? "Socket authentication rejected" : "Namespace disconnected")); return; }
      const match = /^(\d*)([\s\S]*)$/.exec(rest), id = match[1], payload = JSON.parse(match[2]);
      if (!Array.isArray(payload)) throw new ResponseError("Invalid socket event payload");
      if (type === "3") {
        const item = pending.get(Number(id));
        if (id && item) { pending.delete(Number(id)); clearTimeout(item.timer); item.resolve(payload.length === 1 ? payload[0] : payload); }
      } else if (type === "2") {
        if (typeof payload[0] !== "string") throw new ResponseError("Missing socket event name");
        let acknowledged = false;
        const ack = (...values) => { if (!acknowledged && socket === active) { active.send(`43${namespace},${id}${JSON.stringify(values)}`); acknowledged = true; } };
        dispatch(payload[0], ...payload.slice(1), ...(id ? [ack] : []));
      }
    } catch (error) { if (socket === active) close(error); }
  };
  return Object.freeze({
    get connected() { return connected; },
    on(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); return () => listeners.get(name)?.delete(listener); },
    connect({ signal } = {}) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (connected) return Promise.resolve();
      if (connecting) return connecting;
      connecting = new Promise((resolve, reject) => { resolveConnect = resolve; rejectConnect = reject; });
      const result = connecting;
      try {
        const active = new Socket(url.toString()); socket = active;
        active.onmessage = event => { void receive(event, active); };
        active.onerror = () => { if (socket === active) close(new Error("WebSocket failed")); };
        active.onclose = () => { if (socket === active) close(new Error("WebSocket disconnected")); };
        connectTimer = setTimeout(() => close(new Error("Socket connect timed out")), timeout);
        const abort = () => close(signal.reason);
        signal?.addEventListener("abort", abort, { once: true });
        detachSignal = () => signal?.removeEventListener("abort", abort);
      } catch (error) { close(error); }
      return result;
    },
    emit(name, body) {
      if (!connected) return Promise.reject(new Error("Connect before emitting"));
      if (typeof name !== "string" || !name) return Promise.reject(new TypeError("Event name required"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Socket acknowledgement timed out: ${name}; outcome unknown, do not automatically retry`)); }, timeout);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(`42${namespace},${id}${JSON.stringify([name, body])}`); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    close,
  });
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Returns raw objects, retaining new server fields. All malformed/partial exports throw. */
export async function* paginate(request, path, field, {
  max = -1, limit = 20, delay = 100, signal, query = {}, mode = "cursor",
} = {}) {
  if (!Number.isInteger(max) || max < -1 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(delay) || delay < 0) {
    throw new RangeError("max: -1 or nonnegative integer; limit: 1..100; delay: nonnegative milliseconds");
  }
  if (mode !== "cursor" && mode !== "page") throw new TypeError("Unknown pagination mode");
  let count = 0, page = 1, cursor;
  const cursors = new Set();
  const pages = new Set();
  while (max === -1 || count < max) {
    signal?.throwIfAborted();
    const response = await request(path, { query: { ...query, limit, ...(mode === "page" ? { page } : { cursor }) }, signal });
    const data = unwrapData(response);
    const items = data?.[field];
    if (!Array.isArray(items)) throw new ResponseError(`Missing ${field} array`);
    if (!items.length) return;
    if (mode === "page") {
      const fingerprint = JSON.stringify(items);
      if (pages.has(fingerprint)) throw new ResponseError("Server repeated a page");
      pages.add(fingerprint);
    }
    for (const item of items) {
      signal?.throwIfAborted();
      yield item;
      if (++count === max) return;
    }
    if (mode === "page") {
      if (data.hasNext === false || items.length < limit) return;
      page++;
    } else {
      const next = data && Object.hasOwn(data, "nextCursor") ? data.nextCursor : response?.nextCursor;
      if (next === null || next === undefined || next === "") return;
      if (typeof next !== "string" || cursors.has(next)) throw new ResponseError("Invalid or repeated nextCursor");
      cursors.add(next);
      cursor = next;
    }
    if (delay) await sleep(delay, signal);
  }
}

export async function collect(iterator, { reverse = false } = {}) {
  const items = [];
  for await (const item of iterator) items.push(item);
  return reverse ? items.reverse() : items;
}
