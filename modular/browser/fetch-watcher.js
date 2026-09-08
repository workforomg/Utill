(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.FetchWatcher) return;

  const log = CrackModules.Logger?.create?.("Fetch") || console;
  const local = {
    request: new Set(),
    response: new Set(),
    error: new Set()
  };

  let started = false;
  let originalFetch = null;

  function emit(type, payload) {
    for (const callback of [...local[type]]) {
      try { callback(payload); } catch (error) { console.error("[Crack:Fetch] listener error", error); }
    }
    CrackModules.Events?.emit?.(`fetch:${type}`, payload);
  }

  function headersToObject(headers) {
    if (CrackModules.Utils?.toHeadersObject) return CrackModules.Utils.toHeadersObject(headers);
    const out = {};
    try {
      for (const [k, v] of new Headers(headers || {}).entries()) out[k.toLowerCase()] = v;
    } catch {}
    return out;
  }

  function normalizeUrl(input) {
    if (CrackModules.Utils?.normalizeUrl) return CrackModules.Utils.normalizeUrl(input);
    try {
      return new URL(input instanceof Request ? input.url : String(input), location.href).href;
    } catch {
      return String(input ?? "");
    }
  }

  function makeId() {
    return CrackModules.Utils?.randomId?.("fetch") ||
      `fetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function start() {
    if (started) return false;
    if (typeof root.fetch !== "function") {
      log.warn?.("window.fetch is unavailable");
      return false;
    }

    originalFetch = root.fetch;

    async function wrappedFetch(input, init) {
      const id = makeId();
      const startedAt = performance.now();
      const requestObject = input instanceof Request ? input : null;

      const request = {
        id,
        type: "fetch",
        url: normalizeUrl(input),
        method: String(init?.method || requestObject?.method || "GET").toUpperCase(),
        headers: {
          ...headersToObject(requestObject?.headers),
          ...headersToObject(init?.headers)
        },
        input,
        init: init || {},
        startedAt
      };

      emit("request", request);

      try {
        const response = await originalFetch.apply(this, arguments);
        emit("response", {
          ...request,
          status: response.status,
          ok: response.ok,
          response: response.clone(),
          rawResponse: response,
          elapsedMs: performance.now() - startedAt
        });
        return response;
      } catch (error) {
        emit("error", {
          ...request,
          error,
          elapsedMs: performance.now() - startedAt
        });
        throw error;
      }
    }

    wrappedFetch.__crackFetchWatcher = true;
    wrappedFetch.__originalFetch = originalFetch;
    root.fetch = wrappedFetch;
    started = true;
    log.info?.("started");
    return true;
  }

  function stop() {
    if (!started) return false;
    if (root.fetch?.__crackFetchWatcher && originalFetch) {
      root.fetch = originalFetch;
    }
    started = false;
    log.info?.("stopped");
    return true;
  }

  function on(type, callback) {
    if (!local[type]) throw new Error(`Unknown fetch event: ${type}`);
    local[type].add(callback);
    return () => local[type].delete(callback);
  }

  CrackModules.FetchWatcher = {
    start,
    stop,
    isStarted: () => started,
    onRequest: cb => on("request", cb),
    onResponse: cb => on("response", cb),
    onError: cb => on("error", cb),
    getOriginalFetch: () => originalFetch
  };
})();