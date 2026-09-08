(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.XHRWatcher) return;

  const log = CrackModules.Logger?.create?.("XHR") || console;
  const meta = new WeakMap();
  const local = {
    request: new Set(),
    response: new Set(),
    error: new Set()
  };

  let started = false;
  let originalOpen = null;
  let originalSend = null;
  let originalSetRequestHeader = null;

  function emit(type, payload) {
    for (const callback of [...local[type]]) {
      try { callback(payload); } catch (error) { console.error("[Crack:XHR] listener error", error); }
    }
    CrackModules.Events?.emit?.(`xhr:${type}`, payload);
  }

  function makeId() {
    return CrackModules.Utils?.randomId?.("xhr") ||
      `xhr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeUrl(input) {
    if (CrackModules.Utils?.normalizeUrl) return CrackModules.Utils.normalizeUrl(input);
    try { return new URL(String(input), location.href).href; } catch { return String(input ?? ""); }
  }

  function start() {
    if (started) return false;

    const proto = root.XMLHttpRequest?.prototype;
    if (!proto) {
      log.warn?.("XMLHttpRequest is unavailable");
      return false;
    }

    originalOpen = proto.open;
    originalSend = proto.send;
    originalSetRequestHeader = proto.setRequestHeader;

    proto.open = function(method, url, ...rest) {
      meta.set(this, {
        id: makeId(),
        type: "xhr",
        method: String(method || "GET").toUpperCase(),
        url: normalizeUrl(url),
        headers: {},
        openArgs: [method, url, ...rest]
      });
      return originalOpen.call(this, method, url, ...rest);
    };

    proto.setRequestHeader = function(name, value) {
      const info = meta.get(this);
      if (info) info.headers[String(name).toLowerCase()] = String(value);
      return originalSetRequestHeader.call(this, name, value);
    };

    proto.send = function(body) {
      const info = meta.get(this) || {
        id: makeId(),
        type: "xhr",
        method: "GET",
        url: "",
        headers: {}
      };

      info.body = body;
      info.startedAt = performance.now();
      meta.set(this, info);

      emit("request", {
        ...info,
        xhr: this
      });

      const onLoadEnd = () => {
        this.removeEventListener("loadend", onLoadEnd);
        const payload = {
          ...info,
          xhr: this,
          status: this.status,
          ok: this.status >= 200 && this.status < 300,
          responseType: this.responseType,
          response: this.response,
          elapsedMs: performance.now() - info.startedAt
        };

        if (this.status === 0) emit("error", payload);
        else emit("response", payload);
      };

      this.addEventListener("loadend", onLoadEnd);
      return originalSend.call(this, body);
    };

    proto.open.__crackXHRWatcher = true;
    proto.send.__crackXHRWatcher = true;
    started = true;
    log.info?.("started");
    return true;
  }

  function stop() {
    if (!started) return false;
    const proto = root.XMLHttpRequest?.prototype;
    if (proto) {
      if (originalOpen) proto.open = originalOpen;
      if (originalSend) proto.send = originalSend;
      if (originalSetRequestHeader) proto.setRequestHeader = originalSetRequestHeader;
    }
    started = false;
    log.info?.("stopped");
    return true;
  }

  function on(type, callback) {
    if (!local[type]) throw new Error(`Unknown XHR event: ${type}`);
    local[type].add(callback);
    return () => local[type].delete(callback);
  }

  CrackModules.XHRWatcher = {
    start,
    stop,
    isStarted: () => started,
    onRequest: cb => on("request", cb),
    onResponse: cb => on("response", cb),
    onError: cb => on("error", cb)
  };
})();