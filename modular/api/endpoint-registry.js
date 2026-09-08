(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.EndpointRegistry) return;

  const log = CrackModules.Logger?.create?.("Endpoints") || console;
  const entries = new Map();

  function wildcardToRegExp(pattern) {
    const escaped = String(pattern)
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
  }

  function normalizePattern(pattern) {
    if (pattern instanceof RegExp || typeof pattern === "function") return pattern;
    if (typeof pattern !== "string" || !pattern.trim()) {
      throw new TypeError("Endpoint pattern must be a string, RegExp, or function");
    }

    const trimmed = pattern.trim();
    if (trimmed.includes("*")) return wildcardToRegExp(trimmed);
    return trimmed;
  }

  function register(name, pattern, {
    method = "*",
    tags = [],
    description = ""
  } = {}) {
    if (!name) throw new Error("Endpoint name is required");

    const entry = {
      name: String(name),
      pattern: normalizePattern(pattern),
      method: String(method || "*").toUpperCase(),
      tags: [...tags],
      description: String(description || "")
    };

    if (!entries.has(entry.name)) entries.set(entry.name, []);
    entries.get(entry.name).push(entry);
    log.debug?.("registered", entry.name, pattern);
    return entry;
  }

  function registerMany(definitions) {
    const added = [];
    for (const definition of definitions || []) {
      if (!definition) continue;
      added.push(register(
        definition.name,
        definition.pattern,
        definition.options || {
          method: definition.method,
          tags: definition.tags,
          description: definition.description
        }
      ));
    }
    return added;
  }

  function testPattern(pattern, url, context) {
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0;
      return pattern.test(url);
    }
    if (typeof pattern === "function") return Boolean(pattern(url, context));
    return url.includes(pattern);
  }

  function match(url, method = "GET", context = {}) {
    const targetMethod = String(method || "GET").toUpperCase();
    const matches = [];

    for (const list of entries.values()) {
      for (const entry of list) {
        if (entry.method !== "*" && entry.method !== targetMethod) continue;
        if (testPattern(entry.pattern, String(url || ""), { ...context, method: targetMethod })) {
          matches.push(entry);
        }
      }
    }

    return matches;
  }

  function remove(name) {
    return entries.delete(String(name));
  }

  function clear() {
    entries.clear();
  }

  function list(name) {
    if (name != null) return [...(entries.get(String(name)) || [])];
    return [...entries.values()].flat();
  }

  CrackModules.EndpointRegistry = {
    register,
    registerMany,
    match,
    remove,
    clear,
    list,
    has: name => entries.has(String(name))
  };
})();