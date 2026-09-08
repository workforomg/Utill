(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.ProfileParser) return;

  function helpers() {
    return CrackModules.ParserUtils || {
      unwrap: v => v?.data ?? v,
      firstDefined: (o, keys, fallback = null) => keys.find(k => o?.[k] != null) ? o[keys.find(k => o?.[k] != null)] : fallback
    };
  }

  function parse(input) {
    const h = helpers();
    const raw = h.unwrap(input) || {};

    return {
      id: h.firstDefined(raw, ["id", "userId", "profileId", "uuid"]),
      name: h.firstDefined(raw, ["name", "nickname", "username", "displayName"]),
      avatar: h.firstDefined(raw, ["avatar", "avatarUrl", "profileImage", "profileImageUrl", "image", "imageUrl"]),
      bio: h.firstDefined(raw, ["bio", "description", "introduction", "about"]),
      handle: h.firstDefined(raw, ["handle", "slug", "username"]),
      raw
    };
  }

  CrackModules.ProfileParser = { parse };
})();