(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.ApiClient) return;

  const log = CrackModules.Logger?.create?.("ApiClient") || console;
  const CRACK_ORIGIN = "https://crack.wrtn.ai";

  function resolveUrl(input) {
    const base = location.origin === CRACK_ORIGIN ? location.origin : CRACK_ORIGIN;
    const url = new URL(String(input), `${base}/`);

    if (url.origin !== CRACK_ORIGIN) {
      throw new Error(`External URL blocked by Crack ApiClient: ${url.origin}`);
    }
    return url;
  }

  function normalizeBody({ body, json, headers }) {
    if (json !== undefined) {
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return JSON.stringify(json);
    }
    return body;
  }

  async function request(input, {
    method = "GET",
    headers: inputHeaders,
    body,
    json,
    auth = true,
    token,
    credentials = "include",
    signal,
    ...rest
  } = {}) {
    const url = resolveUrl(input);
    const headers = new Headers(inputHeaders || {});

    const authToken = token || CrackModules.AuthState?.getToken?.();
    if (auth && authToken && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${authToken}`);
    }

    const response = await fetch(url.href, {
      ...rest,
      method: String(method || "GET").toUpperCase(),
      headers,
      body: normalizeBody({ body, json, headers }),
      credentials,
      signal
    });

    return response;
  }

  async function requestJson(input, options = {}) {
    const response = await request(input, options);
    let data = null;

    try {
      data = await response.clone().json();
    } catch {}

    if (!response.ok) {
      const error = new Error(`Crack API request failed: ${response.status} ${response.statusText}`);
      error.response = response;
      error.data = data;
      throw error;
    }

    return {
      response,
      data
    };
  }

  CrackModules.ApiClient = {
    CRACK_ORIGIN,
    resolveUrl,
    request,
    requestJson,
    get: (url, options = {}) => request(url, { ...options, method: "GET" }),
    post: (url, json, options = {}) => request(url, { ...options, method: "POST", json }),
    put: (url, json, options = {}) => request(url, { ...options, method: "PUT", json }),
    patch: (url, json, options = {}) => request(url, { ...options, method: "PATCH", json }),
    delete: (url, options = {}) => request(url, { ...options, method: "DELETE" })
  };

  log.debug?.("ready");
})();