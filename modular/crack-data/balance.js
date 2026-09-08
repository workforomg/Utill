(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.BalanceParser) return;

  const KEY_RE = /^(?:cracker|crackers|crack|balance|amount|credit|credits|point|points|coin|coins|walletBalance|currentBalance)$/i;

  function parseNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const normalized = value.replace(/,/g, "").trim();
      if (normalized && Number.isFinite(Number(normalized))) return Number(normalized);
    }
    return null;
  }

  function parse(input) {
    const raw = CrackModules.ParserUtils?.unwrap?.(input) ?? input;
    const direct = raw && typeof raw === "object"
      ? Object.entries(raw).find(([key, value]) => KEY_RE.test(key) && parseNumber(value) !== null)
      : null;

    if (direct) {
      return {
        value: parseNumber(direct[1]),
        key: direct[0],
        path: [direct[0]],
        raw
      };
    }

    const found = CrackModules.ParserUtils?.findFirstKey?.(
      raw,
      (key, value) => KEY_RE.test(key) && parseNumber(value) !== null,
      { maxDepth: 7 }
    );

    return {
      value: found ? parseNumber(found.value) : null,
      key: found?.key ?? null,
      path: found?.path ?? [],
      raw
    };
  }

  CrackModules.BalanceParser = {
    parse,
    parseNumber,
    KEY_RE
  };
})();