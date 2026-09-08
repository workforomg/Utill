(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.Logger) return;

  const LEVELS = Object.freeze({
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 99
  });

  let enabled = true;
  let level = "info";

  function canLog(targetLevel) {
    return enabled && LEVELS[targetLevel] >= LEVELS[level];
  }

  function prefix(name) {
    return `[Crack:${name}]`;
  }

  function create(name) {
    const label = String(name || "Module");

    return Object.freeze({
      debug(...args) {
        if (canLog("debug")) console.debug(prefix(label), ...args);
      },
      info(...args) {
        if (canLog("info")) console.info(prefix(label), ...args);
      },
      warn(...args) {
        if (canLog("warn")) console.warn(prefix(label), ...args);
      },
      error(...args) {
        if (canLog("error")) console.error(prefix(label), ...args);
      }
    });
  }

  CrackModules.Logger = {
    LEVELS,
    create,

    setEnabled(value) {
      enabled = Boolean(value);
    },

    isEnabled() {
      return enabled;
    },

    setLevel(nextLevel) {
      if (!(nextLevel in LEVELS)) {
        throw new Error(`Unknown log level: ${nextLevel}`);
      }
      level = nextLevel;
    },

    getLevel() {
      return level;
    }
  };
})();