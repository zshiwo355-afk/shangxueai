/**
 * 共享 fetch 工具：safeFetch / postJson / getJson / putJson / deleteJson。
 * 所有 api.*.js 文件都从这里 import。
 */
import { buildApiUrl } from "./runtimeConfig";

function parseErrorPayload(payload, fallbackMessage) {
  if (!payload || typeof payload !== "object") return fallbackMessage;
  return payload.detail || payload.message || fallbackMessage;
}

export async function safeFetch(input, init, networkErrorMessage = "网络连接异常，请稍后重试。") {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("请求已中断。"), { code: "REQUEST_ABORTED" });
    }
    throw Object.assign(new Error(networkErrorMessage), { code: "NETWORK_ERROR" });
  }
}

export async function throwRequestError(response, fallbackMessage) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  throw new Error(parseErrorPayload(data, fallbackMessage));
}

export async function getJson(path, fallbackMessage) {
  const response = await safeFetch(buildApiUrl(path), undefined, fallbackMessage);
  if (!response.ok) await throwRequestError(response, fallbackMessage);
  return response.json();
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
  return response.json();
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
  return response.json();
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
    return await response.json();
  } catch {
    return { success: true };
  }
}
