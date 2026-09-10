import { createEndpointModule } from "./endpoints.js";

export const DISCOVERY_ENDPOINTS = Object.freeze({
  "search": {
    "method": "GET",
    "path": "/crack-page/search",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "search-a2fc9e827c797044.js"
  },
  "sortFilters": {
    "method": "GET",
    "path": "/crack-page/search/sort-filters",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "search-a2fc9e827c797044.js"
  },
  "contents": {
    "method": "GET",
    "path": "/crack-api/content/search",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "search-a2fc9e827c797044.js"
  },
  "tags": {
    "method": "GET",
    "path": "/crack-api/content/search/tag",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "search-a2fc9e827c797044.js"
  },
  "series": {
    "method": "GET",
    "path": "/crack-api/story-series/search",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "search-a2fc9e827c797044.js"
  },
  "profiles": {
    "method": "GET",
    "path": "/crack-api/profiles/search",
    "effect": "read",
    "evidence": "loaded-source-only",
    "source": "_app-995c29090acd8bf6.js"
  },
  "keywordRanking": {
    "method": "GET",
    "path": "/crack-api/keyword/ranking",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "9821-ffceb9bdef2e1ed5.js"
  },
  "recentKeywords": {
    "method": "GET",
    "path": "/crack-api/keyword/recent",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "9821-ffceb9bdef2e1ed5.js"
  },
  "genreNavigations": {
    "method": "GET",
    "path": "/crack-page/genre-navigations/web",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "145-d372b8ab0763a851.js"
  },
  "page": {
    "method": "GET",
    "path": "/crack-page/pages/:pageId/web",
    "effect": "read",
    "evidence": "observed-http-status",
    "source": "145-d372b8ab0763a851.js"
  }
});

export function createDiscoveryAPI(options = {}) { return createEndpointModule(DISCOVERY_ENDPOINTS, options); }
