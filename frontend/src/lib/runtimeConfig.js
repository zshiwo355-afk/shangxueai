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

export function getApiBaseUrl() {
  const queryBase = normalizeApiBase(getQueryApiBase());
  if (queryBase) {
    return queryBase;
  }
  const runtimeBase = normalizeApiBase(getWindowApiBase());
  if (runtimeBase) {
    return runtimeBase;
  }
  const envBase = normalizeApiBase(import.meta.env.VITE_API_BASE_URL || "");
  if (envBase) {
    return envBase;
  }
  return getStoredApiBaseUrl();
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
