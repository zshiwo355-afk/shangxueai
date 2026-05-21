/**
 * 鉴权 helper：token + currentUser 都进 localStorage；
 * 全局 fetch 拦截器自动给 /api/* 请求挂 Authorization 头；
 * 401 → 清登录态、跳 /login。
 */
const TOKEN_KEY = "shangxueai-token";
const USER_KEY = "shangxueai-user";

let _onUnauthorized = null;

export function setUnauthorizedHandler(fn) {
  _onUnauthorized = typeof fn === "function" ? fn : null;
}

export function getToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getCurrentUser() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user) {
  if (typeof window === "undefined") return;
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(USER_KEY);
}

export function clearAuth() {
  setToken("");
  setCurrentUser(null);
}

export function isAuthenticated() {
  return !!getToken();
}

export function isAdmin() {
  const u = getCurrentUser();
  return !!u && (u.role || "").toLowerCase() === "admin";
}

/**
 * 安装全局 fetch 拦截器：
 *   - 给 /api/* 请求加 Authorization: Bearer <token>
 *   - 401 → 清登录态 + 调用 onUnauthorized()
 */
export function installAuthFetch() {
  if (typeof window === "undefined" || window.__shangxueai_fetch_installed__) return;
  window.__shangxueai_fetch_installed__ = true;

  const original = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input, init = {}) {
    let url = "";
    if (typeof input === "string") url = input;
    else if (input && input.url) url = input.url;

    const isApi = /\/api\//.test(url) || url.startsWith("/api/");
    if (isApi) {
      init = { cache: "no-store", ...init };
      const token = getToken();
      if (token) {
        const headers = new Headers(init.headers || {});
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        init.headers = headers;
      }
    }

    const response = await original(input, init);
    if (isApi && response.status === 401) {
      clearAuth();
      if (_onUnauthorized) {
        try {
          _onUnauthorized();
        } catch {
          /* ignore */
        }
      }
    }
    return response;
  };
}
