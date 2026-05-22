/**
 * 共享 fetch 工具：safeFetch / postJson / getJson / putJson / deleteJson。
 * 所有 api.*.js 文件都从这里 import。
 *
 * 错误处理统一约定：所有抛出的 Error 都带这些字段——
 *   - message：已经做过友好化的中文文案，组件可直接 message.error(err.message)
 *   - code   ：错误分类（NETWORK_ERROR / AUTH_REQUIRED / FORBIDDEN / NOT_FOUND /
 *             VALIDATION / CONFLICT / SERVER_ERROR / BAD_RESPONSE / UNKNOWN）
 *   - status ：HTTP 状态码（如有）
 *   - detail ：后端原始 detail（用于排查）
 */
import { buildApiUrl, clearStoredApiBaseUrl, getStoredApiBaseUrl } from "./runtimeConfig";

// ---------------- 友好文案映射 ----------------

const STATUS_FRIENDLY = {
  400: { code: "BAD_REQUEST", prefix: "请求有误" },
  401: { code: "AUTH_REQUIRED", prefix: "登录态已过期，请重新登录" },
  403: { code: "FORBIDDEN", prefix: "无权限访问" },
  404: { code: "NOT_FOUND", prefix: "资源不存在或已被删除" },
  408: { code: "TIMEOUT", prefix: "请求超时，请稍后再试" },
  409: { code: "CONFLICT", prefix: "状态冲突" },
  413: { code: "PAYLOAD_TOO_LARGE", prefix: "上传文件过大" },
  415: { code: "UNSUPPORTED_MEDIA", prefix: "不支持的文件格式" },
  422: { code: "VALIDATION", prefix: "提交内容有误" },
  429: { code: "RATE_LIMITED", prefix: "操作过于频繁，请稍后再试" },
};

const SERVER_FRIENDLY = { code: "SERVER_ERROR", prefix: "服务器开小差啦，请稍后重试" };

function friendlyForStatus(status) {
  if (STATUS_FRIENDLY[status]) return STATUS_FRIENDLY[status];
  if (status >= 500) return SERVER_FRIENDLY;
  if (status >= 400) return { code: "BAD_REQUEST", prefix: "请求失败" };
  return { code: "UNKNOWN", prefix: "请求失败" };
}

// ---------------- detail 解析 ----------------

function parseValidationDetail(detail) {
  // FastAPI 422 detail 结构：[{loc:["body","username"], msg:"field required", type:"value_error.missing"}, ...]
  if (!Array.isArray(detail)) return "";
  const items = detail
    .map((it) => {
      const loc = Array.isArray(it?.loc) ? it.loc.filter((x) => x !== "body").join(".") : "";
      const msg = (it?.msg || "").replace(/^value is not a valid.*?:\s*/i, "");
      return loc ? `${loc} ${msg}` : msg;
    })
    .filter(Boolean);
  return items.slice(0, 3).join("；") + (items.length > 3 ? "…" : "");
}

function extractBackendDetail(payload) {
  if (!payload || typeof payload !== "object") return "";
  const d = payload.detail ?? payload.message ?? "";
  if (typeof d === "string") return d.trim();
  if (Array.isArray(d)) return parseValidationDetail(d);
  if (d && typeof d === "object" && typeof d.message === "string") return d.message.trim();
  return "";
}

function buildErrorMessage(status, backendDetail, fallbackMessage) {
  const { prefix } = friendlyForStatus(status);
  // 后端 detail 是人类可读的中文文案时，直接用它（带状态码兜底）
  if (backendDetail) {
    // 短消息：「无权限访问：xxx」；长消息（>30）：直接用后端文案
    return backendDetail.length > 30 ? backendDetail : `${prefix}：${backendDetail}`;
  }
  // 没有有用 detail，用前缀 + fallback
  return fallbackMessage ? `${prefix}（${fallbackMessage}）` : prefix;
}

// ---------------- 异常工厂 ----------------

function makeError({ message, code, status, detail }) {
  const err = new Error(message);
  err.code = code || "UNKNOWN";
  if (status !== undefined) err.status = status;
  if (detail !== undefined) err.detail = detail;
  err.isApiError = true;
  return err;
}

// ---------------- 响应判断 ----------------

function looksLikeHtml(text) {
  return /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
}

function isJsonContentType(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  return contentType.includes("application/json") || contentType.includes("+json");
}

function buildBadResponseError(response, fallbackMessage, bodyText = "") {
  const statusLabel = response.status ? `HTTP ${response.status}` : "未知状态";
  if (looksLikeHtml(bodyText)) {
    const stale = getStoredApiBaseUrl();
    let healed = false;
    if (stale) {
      clearStoredApiBaseUrl();
      healed = true;
    }
    const message = healed
      ? "服务暂时不可用，已为你清理本地缓存，请刷新页面重试"
      : "服务暂时不可用，请稍后刷新页面重试";
    return makeError({
      message,
      code: "BAD_RESPONSE",
      status: response.status,
      detail: `接口返回 HTML：${statusLabel} ${response.url || ""}`,
    });
  }
  return makeError({
    message: "服务暂时不可用，请稍后重试",
    code: "BAD_RESPONSE",
    status: response.status,
    detail: `${statusLabel} ${bodyText.slice(0, 200)}`,
  });
}

// ---------------- 公共方法 ----------------

export async function parseJsonResponse(response, fallbackMessage) {
  if (response.status === 204 || response.status === 205) {
    return null;
  }

  if (!isJsonContentType(response)) {
    const bodyText = await response.text().catch(() => "");
    throw buildBadResponseError(response, fallbackMessage, bodyText);
  }

  try {
    return await response.json();
  } catch {
    throw makeError({
      message: "服务返回内容异常，请稍后重试",
      code: "BAD_RESPONSE",
      status: response.status,
    });
  }
}

export async function safeFetch(input, init, networkErrorMessage) {
  try {
    const merged = { cache: "no-store", ...(init || {}) };
    return await fetch(input, merged);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw makeError({ message: "请求已中断。", code: "REQUEST_ABORTED" });
    }
    throw makeError({
      message: networkErrorMessage || "网络连接异常，请检查网络后重试。",
      code: "NETWORK_ERROR",
      detail: error?.message,
    });
  }
}

export async function throwRequestError(response, fallbackMessage) {
  let backendDetail = "";
  if (isJsonContentType(response)) {
    try {
      const data = await response.json();
      backendDetail = extractBackendDetail(data);
    } catch {
      /* ignore */
    }
  } else {
    const bodyText = await response.text().catch(() => "");
    throw buildBadResponseError(response, fallbackMessage, bodyText);
  }

  const { code } = friendlyForStatus(response.status);
  throw makeError({
    message: buildErrorMessage(response.status, backendDetail, fallbackMessage),
    code,
    status: response.status,
    detail: backendDetail,
  });
}

export async function getJson(path, fallbackMessage) {
  const response = await safeFetch(buildApiUrl(path), undefined, fallbackMessage);
  if (!response.ok) await throwRequestError(response, fallbackMessage);
  return parseJsonResponse(response, fallbackMessage);
}

export async function postJson(path, body, fallbackMessage) {
  const response = await safeFetch(
    buildApiUrl(path),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    },
    fallbackMessage,
  );
  if (!response.ok) await throwRequestError(response, fallbackMessage);
  return parseJsonResponse(response, fallbackMessage);
}

export async function putJson(path, body, fallbackMessage) {
  const response = await safeFetch(
    buildApiUrl(path),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    },
    fallbackMessage,
  );
  if (!response.ok) await throwRequestError(response, fallbackMessage);
  return parseJsonResponse(response, fallbackMessage);
}

export async function deleteJson(path, fallbackMessage) {
  const response = await safeFetch(
    buildApiUrl(path),
    { method: "DELETE" },
    fallbackMessage,
  );
  if (!response.ok) await throwRequestError(response, fallbackMessage);
  // delete 可能没有 body
  try {
    return await parseJsonResponse(response, fallbackMessage);
  } catch {
    return { success: true };
  }
}
