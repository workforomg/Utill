import { createEndpointModule } from "./endpoints.js";

export const PROFILES_ENDPOINTS = Object.freeze({
  "me": {
    "method": "GET",
    "path": "/crack-api/profiles",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "_app-995c29090acd8bf6.js"
  },
  "get": {
    "method": "GET",
    "path": "/crack-api/profiles/:userId",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "_app-995c29090acd8bf6.js"
  },
  "defaultImage": {
    "method": "GET",
    "path": "/crack-api/profiles/profile-image",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "onboardingStatus": {
    "method": "GET",
    "path": "/crack-api/profiles/onboarding/check",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "shareURL": {
    "method": "GET",
    "path": "/crack-api/profiles/:profileId/share-url",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "agreements": {
    "method": "GET",
    "path": "/crack-api/profiles/:profileId/agreements",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "followers": {
    "method": "GET",
    "path": "/crack-api/profiles/:profileId/followers",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "_app-995c29090acd8bf6.js"
  },
  "followings": {
    "method": "GET",
    "path": "/crack-api/profiles/:profileId/followings",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "followingStatus": {
    "method": "GET",
    "path": "/crack-api/profiles/:profileId/following-status",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "chatProfiles": {
    "method": "GET",
    "path": "/crack-api/profiles/:profileId/chat-profiles",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "update": {
    "method": "PATCH",
    "path": "/crack-api/profiles/:userId",
    "effect": "write",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "updateUISettings": {
    "method": "PATCH",
    "path": "/crack-api/profiles/ui-setting",
    "effect": "write",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "validate": {
    "method": "POST",
    "path": "/crack-api/profiles/validate-inputs",
    "effect": "write",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "follow": {
    "method": "POST",
    "path": "/crack-api/profiles/:profileId/follow",
    "effect": "write",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "unfollow": {
    "method": "DELETE",
    "path": "/crack-api/profiles/:profileId/follow",
    "effect": "write",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "updateFollowNotifications": {
    "method": "PATCH",
    "path": "/crack-api/profiles/:profileId/follow",
    "effect": "write",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "createChatProfile": {
    "method": "POST",
    "path": "/crack-api/profiles/:profileId/chat-profiles",
    "effect": "write",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "updateChatProfile": {
    "method": "PATCH",
    "path": "/crack-api/profiles/:profileId/chat-profiles/:chatProfileId",
    "effect": "write",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "deleteChatProfile": {
    "method": "DELETE",
    "path": "/crack-api/profiles/:profileId/chat-profiles/:chatProfileId",
    "effect": "write",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "personalizedPages": {
    "method": "GET",
    "path": "/crack-api/pages/me",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "personalized-2aea1c47d5f5921e.js"
  },
  "updatePersonalizedPages": {
    "method": "PUT",
    "path": "/crack-api/pages",
    "effect": "write",
    "evidence": "loaded-source-only",
    "source": "personalized-2aea1c47d5f5921e.js"
  },
  "badges": {
    "method": "GET",
    "path": "/crack-api/assignments",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "assignment-34f5cf2d26a88b3f.js"
  },
  "badge": {
    "method": "GET",
    "path": "/crack-api/assignments/:assignmentId",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "assignment-34f5cf2d26a88b3f.js"
  },
  "blocks": {
    "method": "GET",
    "path": "/crack-api/block",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "block-center-e705d642fe39a422.js"
  }
});

export function createProfilesAPI(options = {}) { return createEndpointModule(PROFILES_ENDPOINTS, options); }
