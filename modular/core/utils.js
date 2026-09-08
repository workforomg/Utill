(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.Utils) return;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function safeJsonParse(value, fallback = null) {
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function debounce(fn, wait = 100) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function throttle(fn, wait = 100) {
    let last = 0;
    let trailingTimer = null;
    let trailingArgs = null;
    let trailingThis = null;

    return function throttled(...args) {
      const now = Date.now();
      const remaining = wait - (now - last);

      if (remaining <= 0) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
        last = now;
        fn.apply(this, args);
        return;
      }

      trailingArgs = args;
      trailingThis = this;

      if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          trailingTimer = null;
          last = Date.now();
          fn.apply(trailingThis, trailingArgs);
        }, remaining);
      }
    };
  }

  function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== "[object Object]") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function clone(value) {
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {}
    }
    if (value == null || typeof value !== "object") return value;
    return JSON.parse(JSON.stringify(value));
  }

  function toHeadersObject(headers) {
    const out = {};
    if (!headers) return out;

    try {
      const normalized = new Headers(headers);
      for (const [key, value] of normalized.entries()) out[key.toLowerCase()] = value;
      return out;
    } catch {}

    if (Array.isArray(headers)) {
      for (const item of headers) {
        if (Array.isArray(item) && item.length >= 2) {
          out[String(item[0]).toLowerCase()] = String(item[1]);
        }
      }
      return out;
    }

    if (isPlainObject(headers)) {
      for (const [key, value] of Object.entries(headers)) {
        out[String(key).toLowerCase()] = String(value);
      }
    }

    return out;
  }

  function getHeader(headers, name) {
    return toHeadersObject(headers)[String(name).toLowerCase()] ?? null;
  }

  function normalizeUrl(input, base = location.href) {
    try {
      if (input instanceof Request) return new URL(input.url, base).href;
      return new URL(String(input), base).href;
    } catch {
      return String(input ?? "");
    }
  }

  function randomId(prefix = "id") {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  async function waitForCondition(check, {
    timeout = 10000,
    interval = 100,
    signal
  } = {}) {
    const started = Date.now();

    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const value = await check();
      if (value) return value;

      if (Date.now() - started >= timeout) {
        throw new Error(`waitForCondition timeout after ${timeout}ms`);
      }
      await sleep(interval);
    }
  }

  function stableStringify(value) {
    const seen = new WeakSet();

    function normalize(input) {
      if (input === null || typeof input !== "object") return input;
      if (seen.has(input)) return "[Circular]";
      seen.add(input);

      if (Array.isArray(input)) return input.map(normalize);

      const out = {};
      for (const key of Object.keys(input).sort()) {
        out[key] = normalize(input[key]);
      }
      return out;
    }

    return JSON.stringify(normalize(value));
  }

  CrackModules.Utils = Object.freeze({
    sleep,
    safeJsonParse,
    debounce,
    throttle,
    isPlainObject,
    clone,
    toHeadersObject,
    getHeader,
    normalizeUrl,
    randomId,
    waitForCondition,
    stableStringify
  });
})();