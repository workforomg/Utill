(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.ApiObserver) return;

  const log = CrackModules.Logger?.create?.("API") || console;
  const listeners = new Map();

  let started = false;
  let unsubscribers = [];

  function on(event, callback) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(callback);
    return () => listeners.get(event)?.delete(callback);
  }

  function emit(event, payload) {
    const bucket = listeners.get(event);
    if (bucket) {
      for (const callback of [...bucket]) {
        try { callback(payload); } catch (error) { console.error(`[Crack:API] listener error (${event})`, error); }
      }
    }
    CrackModules.Events?.emit?.(`api:${event}`, payload);
  }

  function classify(data) {
    const matches = CrackModules.EndpointRegistry?.match?.(
      data?.url,
      data?.method,
      data
    ) || [];

    return matches;
  }

  function handle(kind, data) {
    const matches = classify(data);
    const payload = { ...data, endpointMatches: matches };

    emit(kind, payload);

    for (const entry of matches) {
      emit(`${entry.name}:${kind}`, {
        ...payload,
        endpoint: entry
      });
    }
  }

  function start() {
    if (started) return false;

    if (CrackModules.FetchWatcher) {
      unsubscribers.push(CrackModules.FetchWatcher.onRequest(data => handle("request", data)));
      unsubscribers.push(CrackModules.FetchWatcher.onResponse(data => handle("response", data)));
      unsubscribers.push(CrackModules.FetchWatcher.onError(data => handle("error", data)));
    }

    if (CrackModules.XHRWatcher) {
      unsubscribers.push(CrackModules.XHRWatcher.onRequest(data => handle("request", data)));
      unsubscribers.push(CrackModules.XHRWatcher.onResponse(data => handle("response", data)));
      unsubscribers.push(CrackModules.XHRWatcher.onError(data => handle("error", data)));
    }

    started = true;
    log.info?.("started");
    return true;
  }

  function stop() {
    if (!started) return false;
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe?.();
    started = false;
    log.info?.("stopped");
    return true;
  }

  CrackModules.ApiObserver = {
    start,
    stop,
    isStarted: () => started,
    on,
    onRequest: cb => on("request", cb),
    onResponse: cb => on("response", cb),
    onError: cb => on("error", cb),
    classify
  };
})();