/**
 * 共享 fetch 工具：safeFetch / postJson / getJson / putJson / deleteJson。
 * 所有 api.*.js 文件都从这里 import。
 */
import { buildApiUrl, clearStoredApiBaseUrl, getStoredApiBaseUrl } from "./runtimeConfig";

function parseErrorPayload(payload, fallbackMessage) {
  if (!payload || typeof payload !== "object") return fallbackMessage;
  return payload.detail || payload.message || fallbackMessage;
}

function looksLikeHtml(text) {
  return /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
}

function isJsonContentType(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  return contentType.includes("application/json") || contentType.includes("+json");
}

function buildUnexpectedPayloadMessage(response, fallbackMessage, bodyText = "") {
  const statusLabel = response.status ? `HTTP ${response.status}` : "未知状态";
  if (looksLikeHtml(bodyText)) {
    const stale = getStoredApiBaseUrl();
    let healed = false;
    if (stale) {
      clearStoredApiBaseUrl();
      healed = true;
    }
    const tail = healed
      ? "（已清理本地残留的 API 基址配置，请刷新页面重试）"
      : "（请确认后端是否在 8000 端口运行，并刷新页面重试）";
    return `${fallbackMessage}（接口返回了 HTML 页面：${statusLabel} ${response.url || ""}）${tail}`;
  }
  return `${fallbackMessage}（接口返回格式不是 JSON：${statusLabel} ${response.url || ""}）`;
}

export async function parseJsonResponse(response, fallbackMessage) {
  if (response.status === 204 || response.status === 205) {
    return null;
  }

  if (!isJsonContentType(response)) {
    const bodyText = await response.text().catch(() => "");
    throw Object.assign(
      new Error(buildUnexpectedPayloadMessage(response, fallbackMessage, bodyText)),
      { status: response.status, url: response.url, responseText: bodyText.slice(0, 200) },
    );
  }

  try {
    return await response.json();
  } catch {
    throw Object.assign(
      new Error(`${fallbackMessage}（接口响应不是合法 JSON：HTTP ${response.status} ${response.url || ""}）`),
      { status: response.status, url: response.url },
    );
  }
}

export async function safeFetch(input, init, networkErrorMessage = "网络连接异常，请稍后重试。") {
  try {
    const merged = { cache: "no-store", ...(init || {}) };
    return await fetch(input, merged);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("请求已中断。"), { code: "REQUEST_ABORTED" });
    }
    throw Object.assign(new Error(networkErrorMessage), { code: "NETWORK_ERROR" });
  }
}

export async function throwRequestError(response, fallbackMessage) {
  let data = null;
  if (isJsonContentType(response)) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    const bodyText = await response.text().catch(() => "");
    throw Object.assign(
      new Error(buildUnexpectedPayloadMessage(response, fallbackMessage, bodyText)),
      { status: response.status, url: response.url, responseText: bodyText.slice(0, 200) },
    );
  }
  throw Object.assign(new Error(parseErrorPayload(data, fallbackMessage)), { status: response.status });
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
