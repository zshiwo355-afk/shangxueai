/**
 * 鉴权 helper：token + currentUser 都进 localStorage；
 * 全局 fetch 拦截器自动给 /api/* 请求挂 Authorization 头；
 * 401 → 清登录态、跳 /login。
 */
const TOKEN_KEY = "shangxueai-token";
const USER_KEY = "shangxueai-user";

let _onUnauthorized = null;
let _memoryToken = "";
let _memoryUser = null;
let _cookieSessionActive = false;

function readStorage(key) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Some WeCom webviews disable or isolate localStorage. Memory and the
    // HttpOnly server cookie keep the current session usable in that case.
  }
}

export function setUnauthorizedHandler(fn) {
  _onUnauthorized = typeof fn === "function" ? fn : null;
}

export function getToken() {
  const stored = readStorage(TOKEN_KEY);
  if (stored !== null) {
    _memoryToken = stored;
    return stored;
  }
  return _memoryToken;
}

export function setToken(token) {
  _memoryToken = token || "";
  writeStorage(TOKEN_KEY, _memoryToken);
}

export function getCurrentUser() {
  const raw = readStorage(USER_KEY);
  if (raw === null) return _memoryUser;
  if (!raw) {
    _memoryUser = null;
    return null;
  }
  try {
    _memoryUser = JSON.parse(raw);
    return _memoryUser;
  } catch {
    _memoryUser = null;
    return null;
  }
}

export function setCurrentUser(user) {
  _memoryUser = user || null;
  writeStorage(USER_KEY, user ? JSON.stringify(user) : "");
}

export function setCookieSessionActive(active) {
  _cookieSessionActive = !!active;
}

export function clearAuth() {
  setToken("");
  setCurrentUser(null);
  setCookieSessionActive(false);
}

export function isAuthenticated() {
  return !!getToken() || _cookieSessionActive;
}

export function isAdmin() {
  const u = getCurrentUser();
  const role = (u?.role || "").toLowerCase();
  return role === "admin" || role === "super_admin";
}

export function isSuperAdmin() {
  const u = getCurrentUser();
  return !!u && (u.role || "").toLowerCase() === "super_admin";
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
    const skipAuthRedirect = !!init.skipAuthRedirect;
    if (skipAuthRedirect) {
      init = { ...init };
      delete init.skipAuthRedirect;
    }
    let url = "";
    if (typeof input === "string") url = input;
    else if (input && input.url) url = input.url;

    const isApi = /\/api\//.test(url) || url.startsWith("/api/");
    if (isApi) {
      init = { cache: "no-store", credentials: "include", ...init };
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
    if (isApi && response.status === 401 && !skipAuthRedirect) {
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
