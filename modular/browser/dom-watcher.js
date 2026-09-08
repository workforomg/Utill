(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.DOMWatcher) return;

  const log = CrackModules.Logger?.create?.("DOM") || console;
  const observers = new Set();

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function waitFor(selector, {
    root: observeRoot = document,
    timeout = 10000,
    visible = false,
    signal
  } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const find = () => {
        const element = observeRoot.querySelector(selector);
        if (!element) return null;
        if (visible && !isVisible(element)) return null;
        return element;
      };

      const existing = find();
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = find();
        if (!element) return;
        cleanup();
        resolve(element);
      });

      let timer = null;

      function cleanup() {
        observer.disconnect();
        observers.delete(observer);
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }

      function onAbort() {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      }

      observer.observe(observeRoot === document ? document.documentElement : observeRoot, {
        childList: true,
        subtree: true,
        attributes: visible
      });

      observers.add(observer);

      if (timeout > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`DOMWatcher.waitFor timeout: ${selector}`));
        }, timeout);
      }

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  function observe(selector, callback, {
    root: observeRoot = document,
    includeExisting = true,
    once = false,
    subtree = true
  } = {}) {
    const seen = new WeakSet();

    function inspect(container) {
      const matches = [];
      if (container instanceof Element && container.matches(selector)) matches.push(container);
      if (container.querySelectorAll) matches.push(...container.querySelectorAll(selector));

      for (const element of matches) {
        if (seen.has(element)) continue;
        seen.add(element);

        try {
          callback(element);
        } catch (error) {
          console.error("[Crack:DOM] observe callback error", error);
        }

        if (once) {
          observer.disconnect();
          observers.delete(observer);
          return true;
        }
      }
      return false;
    }

    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (inspect(node) && once) return;
        }
      }
    });

    if (includeExisting && inspect(observeRoot) && once) {
      return () => {};
    }

    observer.observe(observeRoot === document ? document.documentElement : observeRoot, {
      childList: true,
      subtree
    });

    observers.add(observer);

    return () => {
      observer.disconnect();
      observers.delete(observer);
    };
  }

  function onAdded(callback, { root: observeRoot = document, subtree = true } = {}) {
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          try {
            callback(node, record);
          } catch (error) {
            console.error("[Crack:DOM] onAdded callback error", error);
          }
        }
      }
    });

    observer.observe(observeRoot === document ? document.documentElement : observeRoot, {
      childList: true,
      subtree
    });

    observers.add(observer);
    return () => {
      observer.disconnect();
      observers.delete(observer);
    };
  }

  function disconnectAll() {
    for (const observer of [...observers]) observer.disconnect();
    observers.clear();
    log.info?.("all observers disconnected");
  }

  CrackModules.DOMWatcher = {
    waitFor,
    observe,
    onAdded,
    isVisible,
    disconnectAll,
    observerCount: () => observers.size
  };
})();