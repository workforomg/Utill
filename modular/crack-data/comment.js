(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.CommentParser) return;

  function h() {
    return CrackModules.ParserUtils || {
      unwrap: v => v?.data ?? v,
      firstDefined: (o, keys, fallback = null) => keys.map(k => o?.[k]).find(v => v != null) ?? fallback
    };
  }

  function parse(input) {
    const u = h();
    const raw = u.unwrap(input) || {};
    const author = u.firstDefined(raw, ["author", "user", "writer"], {}) || {};

    return {
      id: u.firstDefined(raw, ["id", "commentId", "uuid"]),
      content: u.firstDefined(raw, ["content", "text", "message", "body"]),
      createdAt: u.firstDefined(raw, ["createdAt", "created_at", "timestamp"]),
      likeCount: Number(u.firstDefined(raw, ["likeCount", "likes", "heartCount"], 0)) || 0,
      author: {
        id: u.firstDefined(author, ["id", "userId", "uuid"]),
        name: u.firstDefined(author, ["name", "nickname", "username", "displayName"]),
        avatar: u.firstDefined(author, ["avatar", "avatarUrl", "profileImage", "profileImageUrl"])
      },
      raw
    };
  }

  function parseList(input) {
    const u = h();
    const raw = u.unwrap(input);
    const list = Array.isArray(raw)
      ? raw
      : u.firstDefined(raw, ["items", "comments", "list", "results"], []);
    return Array.isArray(list) ? list.map(parse) : [];
  }

  CrackModules.CommentParser = { parse, parseList };
})();