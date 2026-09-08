(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.TokenDetector) return;

  const log = CrackModules.Logger?.create?.("Token") || console;
  const listeners = new Set();

  let started = false;
  let unsubscribeFetch = null;
  let unsubscribeXHR = null;
  let lastToken = null;

  function headersToObject(headers) {
    if (CrackModules.Utils?.toHeadersObject) return CrackModules.Utils.toHeadersObject(headers);
    const out = {};
    try {
      for (const [k, v] of new Headers(headers || {}).entries()) out[k.toLowerCase()] = v;
    } catch {}
    return out;
  }

  function extractAuthorization(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const trimmed = value.trim();
    const bearer = trimmed.match(/^Bearer\s+(.+)$/i);
    return bearer ? bearer[1].trim() : trimmed;
  }

  function inspectHeaders(headers, meta = {}) {
    const normalized = headersToObject(headers);
    const auth = normalized.authorization;
    if (!auth) return null;

    const token = extractAuthorization(auth);
    if (!token) return null;

    capture(token, {
      ...meta,
      source: meta.source || "authorization-header"
    });
    return token;
  }

  function inspectRequest(request, meta = {}) {
    if (!request) return null;
    return inspectHeaders(request.headers, meta);
  }

  function capture(token, meta = {}) {
    if (typeof token !== "string" || !token.trim()) return false;
    const normalized = token.trim();
    if (normalized === lastToken) return false;

    lastToken = normalized;
    const payload = {
      token: normalized,
      meta,
      at: Date.now()
    };

    log.info?.("token detected", meta.source || "unknown");
    for (const callback of [...listeners]) {
      try { callback(payload); } catch (error) { console.error("[Crack:Token] listener error", error); }
    }
    CrackModules.Events?.emit?.("token:detected", payload);
    return true;
  }

  function handleWatcherRequest(data) {
    inspectHeaders(data?.headers, {
      source: `${data?.type || "request"}-header`,
      url: data?.url,
      method: data?.method,
      requestId: data?.id
    });
  }

  function start() {
    if (started) return false;

    if (CrackModules.FetchWatcher?.onRequest) {
      unsubscribeFetch = CrackModules.FetchWatcher.onRequest(handleWatcherRequest);
    }

    if (CrackModules.XHRWatcher?.onRequest) {
      unsubscribeXHR = CrackModules.XHRWatcher.onRequest(handleWatcherRequest);
    }

    started = true;
    log.info?.("started");
    return true;
  }

  function stop() {
    if (!started) return false;
    unsubscribeFetch?.();
    unsubscribeXHR?.();
    unsubscribeFetch = null;
    unsubscribeXHR = null;
    started = false;
    log.info?.("stopped");
    return true;
  }

  CrackModules.TokenDetector = {
    start,
    stop,
    isStarted: () => started,
    getLastToken: () => lastToken,
    extractAuthorization,
    inspectHeaders,
    inspectRequest,
    capture,
    onDetected(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
})();