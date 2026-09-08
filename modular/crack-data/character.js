(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.CharacterParser) return;

  function h() {
    return CrackModules.ParserUtils || {
      unwrap: v => v?.data ?? v,
      firstDefined: (o, keys, fallback = null) => keys.map(k => o?.[k]).find(v => v != null) ?? fallback,
      normalizeTags: v => Array.isArray(v) ? v : []
    };
  }

  function parse(input) {
    const u = h();
    const raw = u.unwrap(input) || {};

    return {
      id: u.firstDefined(raw, ["id", "characterId", "contentId", "uuid"]),
      name: u.firstDefined(raw, ["name", "title", "characterName"]),
      description: u.firstDefined(raw, ["description", "summary", "introduction", "promptDescription"]),
      creatorId: u.firstDefined(raw, ["creatorId", "authorId", "userId", "ownerId"]),
      image: u.firstDefined(raw, ["thumbnail", "thumbnailUrl", "image", "imageUrl", "coverImage", "coverImageUrl"]),
      tags: u.normalizeTags(u.firstDefined(raw, ["tags", "tagList", "keywords"], [])),
      raw
    };
  }

  function parseList(input) {
    const u = h();
    const raw = u.unwrap(input);
    const list = Array.isArray(raw)
      ? raw
      : u.firstDefined(raw, ["items", "characters", "contents", "list", "results"], []);
    return Array.isArray(list) ? list.map(parse) : [];
  }

  CrackModules.CharacterParser = { parse, parseList };
})();