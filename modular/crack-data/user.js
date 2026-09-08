(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.UserParser) return;

  function h() {
    return CrackModules.ParserUtils || {
      unwrap: v => v?.data ?? v,
      firstDefined: (o, keys, fallback = null) => keys.map(k => o?.[k]).find(v => v != null) ?? fallback
    };
  }

  function parse(input) {
    const u = h();
    const raw = u.unwrap(input) || {};

    return {
      id: u.firstDefined(raw, ["id", "userId", "uuid"]),
      name: u.firstDefined(raw, ["name", "nickname", "username", "displayName"]),
      username: u.firstDefined(raw, ["username", "handle", "slug"]),
      avatar: u.firstDefined(raw, ["avatar", "avatarUrl", "profileImage", "profileImageUrl", "imageUrl"]),
      email: u.firstDefined(raw, ["email"], null),
      raw
    };
  }

  CrackModules.UserParser = { parse };
})();