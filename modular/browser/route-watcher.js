(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.RouteWatcher) return;

  const log = CrackModules.Logger?.create?.("Route") || console;
  const listeners = new Set();

  let started = false;
  let lastHref = location.href;
  let pollTimer = null;
  let originalPushState = null;
  let originalReplaceState = null;

  function snapshot(reason = "unknown") {
    const url = new URL(location.href);
    return {
      reason,
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      at: Date.now()
    };
  }

  function notify(reason) {
    if (location.href === lastHref) return;
    const previousHref = lastHref;
    lastHref = location.href;
    const payload = { ...snapshot(reason), previousHref };

    for (const callback of [...listeners]) {
      try { callback(payload); } catch (error) { console.error("[Crack:Route] listener error", error); }
    }
    CrackModules.Events?.emit?.("route:change", payload);
  }

  function start({ pollInterval = 1000 } = {}) {
    if (started) return false;

    lastHref = location.href;
    originalPushState = history.pushState;
    originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      const result = originalPushState.apply(this, args);
      queueMicrotask(() => notify("pushState"));
      return result;
    };

    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      queueMicrotask(() => notify("replaceState"));
      return result;
    };

    root.addEventListener("popstate", onPopState, true);
    root.addEventListener("hashchange", onHashChange, true);

    if (pollInterval > 0) {
      pollTimer = setInterval(() => notify("poll"), pollInterval);
    }

    started = true;
    log.info?.("started");
    return true;
  }

  function onPopState() { notify("popstate"); }
  function onHashChange() { notify("hashchange"); }

  function stop() {
    if (!started) return false;

    if (originalPushState) history.pushState = originalPushState;
    if (originalReplaceState) history.replaceState = originalReplaceState;

    root.removeEventListener("popstate", onPopState, true);
    root.removeEventListener("hashchange", onHashChange, true);

    clearInterval(pollTimer);
    pollTimer = null;
    started = false;
    log.info?.("stopped");
    return true;
  }

  function matches(pattern) {
    const path = location.pathname + location.search + location.hash;
    if (pattern instanceof RegExp) return pattern.test(path);
    if (typeof pattern === "function") return Boolean(pattern(snapshot("match")));
    return path.includes(String(pattern));
  }

  CrackModules.RouteWatcher = {
    start,
    stop,
    isStarted: () => started,
    current: () => snapshot("current"),
    matches,
    onChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
})();