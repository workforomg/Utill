import { createEndpointModule } from "./endpoints.js";

export const LIBRARY_ENDPOINTS = Object.freeze({
  "subscribedSeries": {
    "method": "GET",
    "path": "/crack-api/story-series/me/subscribed",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "subscribed-47b1afa689ee49bf.js"
  },
  "selectableStories": {
    "method": "GET",
    "path": "/crack-api/story-series/me/selectable-stories",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "subscribed-47b1afa689ee49bf.js"
  },
  "ownContent": {
    "method": "GET",
    "path": "/crack-api/content/me",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "live-network.json"
  },
  "likedStories": {
    "method": "GET",
    "path": "/crack-api/stories/me/liked",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "live-network.json"
  },
  "collections": {
    "method": "GET",
    "path": "/crack-api/content-collections",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "live-network.json"
  },
  "stories": {
    "method": "GET",
    "path": "/crack-api/stories",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "live-network.json"
  },
  "characters": {
    "method": "GET",
    "path": "/crack-api/characters",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "live-network.json"
  },
  "storyRanking": {
    "method": "GET",
    "path": "/crack-api/stories/ranking",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "live-network.json"
  },
  "temporaryStories": {
    "method": "GET",
    "path": "/crack-api/temp-stories",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "live-network.json"
  },
  "chatFolders": {
    "method": "GET",
    "path": "/crack-gen/chat-folders",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "live-network.json"
  },
  "storyChats": {
    "method": "GET",
    "path": "/crack-gen/v3/chats",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "live-network.json"
  },
  "characterChats": {
    "method": "GET",
    "path": "/crack-gen/character-chats",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "live-network.json"
  }
});

export function createLibraryAPI(options = {}) { return createEndpointModule(LIBRARY_ENDPOINTS, options); }
