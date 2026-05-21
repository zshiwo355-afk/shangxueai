const API_BASE_STORAGE_KEY = "shangxueai-api-base-url";

function normalizeApiBase(url) {
  const cleaned = String(url || "").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.replace(/\/+$/, "");
}

function getWindowApiBase() {
  if (typeof window === "undefined") {
    return "";
  }
  const runtimeConfigValue = window.__APP_API_BASE_URL__;
  return typeof runtimeConfigValue === "string" ? runtimeConfigValue : "";
}

function getQueryApiBase() {
  if (typeof window === "undefined") {
    return "";
  }
  const params = new URLSearchParams(window.location.search);
  return params.get("apiBase") || "";
}

export function getStoredApiBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }
  return normalizeApiBase(window.localStorage.getItem(API_BASE_STORAGE_KEY) || "");
}

export function saveApiBaseUrl(url) {
  if (typeof window === "undefined") {
    return "";
  }
  const normalized = normalizeApiBase(url);
  if (normalized) {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
  } else {
    window.localStorage.removeItem(API_BASE_STORAGE_KEY);
  }
  return normalized;
}

export function clearStoredApiBaseUrl() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(API_BASE_STORAGE_KEY);
  if (typeof window.__APP_API_BASE_URL__ === "string") {
    try {
      delete window.__APP_API_BASE_URL__;
    } catch {
      window.__APP_API_BASE_URL__ = "";
    }
  }
}

function isSameOriginCandidate(candidate) {
  if (typeof window === "undefined") return false;
  try {
    const parsed = new URL(candidate, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return true;
  }
}

export function getApiBaseUrl() {
  const queryBase = normalizeApiBase(getQueryApiBase());
  if (queryBase) {
    return queryBase;
  }
  const runtimeBase = normalizeApiBase(getWindowApiBase());
  if (runtimeBase) {
    if (isSameOriginCandidate(runtimeBase)) {
      // Same-origin override is a no-op (and can mis-route /api when it carries an extra path);
      // fall through to relative paths so the dev-server proxy / prod static server can route /api correctly.
      return "";
    }
    return runtimeBase;
  }
  const envBase = normalizeApiBase(import.meta.env.VITE_API_BASE_URL || "");
  if (envBase) {
    return envBase;
  }
  const stored = getStoredApiBaseUrl();
  if (stored && isSameOriginCandidate(stored)) {
    // 自愈：清掉残留的同源 apiBase，避免 /api 被错误路径前缀劫持。
    clearStoredApiBaseUrl();
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(`[runtimeConfig] cleared stale same-origin apiBase: ${stored}`);
    }
    return "";
  }
  return stored;
}

export function buildApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  if (!base) {
    return normalizedPath;
  }
  if (base.endsWith("/api") && normalizedPath === "/api") {
    return base;
  }
  if (base.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${base}${normalizedPath.slice(4)}`;
  }
  return `${base}${normalizedPath}`;
}
