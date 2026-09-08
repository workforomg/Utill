(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.ParserUtils) return;

  function unwrap(value) {
    let current = value;
    const visited = new Set();

    while (current && typeof current === "object" && !Array.isArray(current) && !visited.has(current)) {
      visited.add(current);

      const keys = Object.keys(current);
      const wrapperKey = ["data", "result", "payload", "response"].find(key =>
        key in current &&
        current[key] &&
        typeof current[key] === "object" &&
        keys.length <= 4
      );

      if (!wrapperKey) break;
      current = current[wrapperKey];
    }

    return current;
  }

  function firstDefined(object, keys, fallback = null) {
    if (!object || typeof object !== "object") return fallback;
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null) return object[key];
    }
    return fallback;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }

  function findFirstKey(value, matcher, {
    maxDepth = 6,
    includeArrays = true
  } = {}) {
    const seen = new WeakSet();

    function walk(node, path, depth) {
      if (depth > maxDepth || node == null || typeof node !== "object") return null;
      if (seen.has(node)) return null;
      seen.add(node);

      if (Array.isArray(node)) {
        if (!includeArrays) return null;
        for (let i = 0; i < node.length; i++) {
          const found = walk(node[i], [...path, i], depth + 1);
          if (found) return found;
        }
        return null;
      }

      for (const [key, child] of Object.entries(node)) {
        if (matcher(key, child, path)) {
          return {
            key,
            value: child,
            path: [...path, key]
          };
        }
      }

      for (const [key, child] of Object.entries(node)) {
        const found = walk(child, [...path, key], depth + 1);
        if (found) return found;
      }

      return null;
    }

    return walk(value, [], 0);
  }

  function normalizeTags(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map(item => {
        if (typeof item === "string") return item;
        return firstDefined(item, ["name", "label", "title", "value"], null);
      }).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(",").map(v => v.trim()).filter(Boolean);
    }
    return [];
  }

  CrackModules.ParserUtils = {
    unwrap,
    firstDefined,
    asArray,
    findFirstKey,
    normalizeTags
  };
})();