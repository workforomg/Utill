(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.Events) return;

  const listeners = new Map();

  function getBucket(event) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    return listeners.get(event);
  }

  const Events = {
    on(event, callback) {
      if (typeof callback !== "function") {
        throw new TypeError("Events.on(event, callback): callback must be a function");
      }
      getBucket(event).add(callback);
      return () => Events.off(event, callback);
    },

    once(event, callback) {
      const off = Events.on(event, (...args) => {
        off();
        callback(...args);
      });
      return off;
    },

    off(event, callback) {
      const bucket = listeners.get(event);
      if (!bucket) return false;
      const removed = bucket.delete(callback);
      if (bucket.size === 0) listeners.delete(event);
      return removed;
    },

    emit(event, payload) {
      const bucket = listeners.get(event);
      if (!bucket || bucket.size === 0) return 0;

      let called = 0;
      for (const callback of [...bucket]) {
        try {
          callback(payload);
          called += 1;
        } catch (error) {
          console.error(`[Crack:Events] listener error (${event})`, error);
        }
      }
      return called;
    },

    clear(event) {
      if (typeof event === "string") {
        listeners.delete(event);
      } else {
        listeners.clear();
      }
    },

    listenerCount(event) {
      return listeners.get(event)?.size || 0;
    },

    events() {
      return [...listeners.keys()];
    }
  };

  CrackModules.Events = Events;
})();