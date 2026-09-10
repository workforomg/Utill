import { createEndpointModule } from "./endpoints.js";

export const COMMUNITY_ENDPOINTS = Object.freeze({
  "announcements": {
    "method": "GET",
    "path": "/crack-api/announcements",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "1445-26b08898e57587cb.js"
  },
  "announcementIndicator": {
    "method": "GET",
    "path": "/crack-api/announcements/noti",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "1445-26b08898e57587cb.js"
  },
  "notifications": {
    "method": "GET",
    "path": "/crack-api/alarm",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "9821-ffceb9bdef2e1ed5.js"
  },
  "notificationIndicator": {
    "method": "GET",
    "path": "/crack-api/alarm/check",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "9821-ffceb9bdef2e1ed5.js"
  },
  "feeds": {
    "method": "GET",
    "path": "/crack-api/feeds",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "%5BfeedId%5D-40bbf943221c4a9b.js"
  },
  "feed": {
    "method": "GET",
    "path": "/crack-api/feeds/:feedId",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "%5BfeedId%5D-40bbf943221c4a9b.js"
  },
  "comments": {
    "method": "GET",
    "path": "/crack-api/feeds/:feedId/comments",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "%5BfeedId%5D-40bbf943221c4a9b.js"
  },
  "pinnedComments": {
    "method": "GET",
    "path": "/crack-api/feeds/:feedId/comments/pinned",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "%5BfeedId%5D-40bbf943221c4a9b.js"
  }
});

export function createCommunityAPI(options = {}) { return createEndpointModule(COMMUNITY_ENDPOINTS, options); }
