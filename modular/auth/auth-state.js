(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.AuthState) return;

  const log = CrackModules.Logger?.create?.("Auth") || console;
  const listeners = new Set();
  const waiters = new Set();

  let token = null;
  let tokenMeta = null;
  let unbindDetector = null;

  function setToken(nextToken, meta = {}) {
    if (typeof nextToken !== "string" || !nextToken.trim()) return false;
    const normalized = nextToken.trim();
    const changed = normalized !== token;

    token = normalized;
    tokenMeta = {
      ...meta,
      updatedAt: Date.now()
    };

    if (changed) {
      log.info?.("token updated");
      const payload = { token, meta: tokenMeta };

      for (const callback of [...listeners]) {
        try { callback(payload); } catch (error) { console.error("[Crack:Auth] listener error", error); }
      }

      for (const waiter of [...waiters]) {
        waiter.resolve(token);
        waiters.delete(waiter);
      }

      CrackModules.Events?.emit?.("auth:change", payload);
    }

    return changed;
  }

  function clear(reason = "manual") {
    const hadToken = Boolean(token);
    token = null;
    tokenMeta = { reason, updatedAt: Date.now() };

    if (hadToken) {
      const payload = { token: null, meta: tokenMeta };
      for (const callback of [...listeners]) {
        try { callback(payload); } catch (error) { console.error("[Crack:Auth] listener error", error); }
      }
      CrackModules.Events?.emit?.("auth:change", payload);
    }
  }

  function bindDetector() {
    if (unbindDetector || !CrackModules.TokenDetector?.onDetected) return false;

    const existing = CrackModules.TokenDetector.getLastToken?.();
    if (existing) setToken(existing, { source: "detector-existing" });

    unbindDetector = CrackModules.TokenDetector.onDetected(({ token: detectedToken, meta }) => {
      setToken(detectedToken, {
        ...meta,
        source: meta?.source || "token-detector"
      });
    });

    log.info?.("bound to TokenDetector");
    return true;
  }

  function unbind() {
    unbindDetector?.();
    unbindDetector = null;
  }

  function waitForToken({ timeout = 10000, signal } = {}) {
    if (token) return Promise.resolve(token);

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiters.add(waiter);

      const cleanup = () => {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        signal?.removeEventListener("abort", onAbort);
      };

      const finishResolve = value => {
        cleanup();
        resolve(value);
      };

      waiter.resolve = finishResolve;

      const onAbort = () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (timeout > 0) {
        waiter.timer = setTimeout(() => {
          cleanup();
          reject(new Error(`AuthState.waitForToken timeout after ${timeout}ms`));
        }, timeout);
      }

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  CrackModules.AuthState = {
    setToken,
    clear,
    bindDetector,
    unbind,
    getToken: () => token,
    getMeta: () => tokenMeta,
    hasToken: () => Boolean(token),
    waitForToken,
    onChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
})();