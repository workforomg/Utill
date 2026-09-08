(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.ChatParser) return;

  function h() {
    return CrackModules.ParserUtils || {
      unwrap: v => v?.data ?? v,
      firstDefined: (o, keys, fallback = null) => keys.map(k => o?.[k]).find(v => v != null) ?? fallback
    };
  }

  function parseMessage(message) {
    return {
      id: message?.id ?? message?.messageId ?? null,
      role: message?.role ?? message?.senderType ?? message?.type ?? null,
      content: message?.content ?? message?.text ?? message?.message ?? null,
      createdAt: message?.createdAt ?? message?.created_at ?? message?.timestamp ?? null,
      raw: message
    };
  }

  function parse(input) {
    const u = h();
    const raw = u.unwrap(input) || {};
    const messages = u.firstDefined(raw, ["messages", "messageList", "history"], []);

    return {
      id: u.firstDefined(raw, ["id", "chatId", "roomId", "conversationId"]),
      characterId: u.firstDefined(raw, ["characterId", "contentId", "botId"]),
      title: u.firstDefined(raw, ["title", "name", "chatTitle"]),
      messages: Array.isArray(messages) ? messages.map(parseMessage) : [],
      messageCount: Number(u.firstDefined(raw, ["messageCount", "totalMessageCount"], Array.isArray(messages) ? messages.length : 0)) || 0,
      raw
    };
  }

  CrackModules.ChatParser = { parse, parseMessage };
})();