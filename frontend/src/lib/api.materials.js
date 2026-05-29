import { buildApiUrl } from "./runtimeConfig";
import { getToken } from "./auth";
import { deleteJson, getJson, parseJsonResponse, putJson, safeFetch, throwRequestError } from "./http";
import { multipartUploadToOss } from "./ossMultipart";

function authHeaders(extra = {}) {
  const headers = new Headers(extra);
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export function buildMaterialAssetPreviewUrl(assetId, { download = false } = {}) {
  const url = new URL(buildApiUrl(`/api/materials/assets/${assetId}/preview`), window.location.origin);
  const token = getToken();
  if (token) url.searchParams.set("access_token", token);
  if (download) url.searchParams.set("download", "1");
  return url.toString();
}

/**
 * Trigger a flash-free download. We deliberately avoid `target="_blank"` —
 * opening a new window for a URL that turns into a download (via
 * Content-Disposition: attachment) makes the new tab pop and immediately
 * close, which the user perceives as a screen flash. A bare anchor click
 * lets the browser intercept the attachment response and skip navigation.
 */
export function triggerMaterialDownload(assetId) {
  const url = buildMaterialAssetPreviewUrl(assetId, { download: true });
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 0);
}

export async function getMaterialAssetSignedUrl(assetId) {
  return getJson(`/api/materials/assets/${assetId}/signed-url`, "获取素材访问地址失败。");
}

export async function listMaterialProjects(keyword = "") {
  const search = new URLSearchParams();
  if (keyword) search.set("keyword", keyword);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/materials/projects${suffix}`, "素材文件夹加载失败。");
}

export async function createMaterialProject(payload) {
  const response = await safeFetch(buildApiUrl("/api/materials/projects"), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload || {}),
  }, "创建素材文件夹失败。");
  if (!response.ok) await throwRequestError(response, "创建素材文件夹失败。");
  return parseJsonResponse(response, "创建素材文件夹失败。");
}

export async function getMaterialProject(id) {
  return getJson(`/api/materials/projects/${id}`, "素材文件夹详情加载失败。");
}

export async function updateMaterialProject(id, payload) {
  return putJson(`/api/materials/projects/${id}`, payload, "更新素材文件夹失败。");
}

export async function deleteMaterialProject(id) {
  return deleteJson(`/api/materials/projects/${id}`, "删除素材文件夹失败。");
}

export async function moveMaterialProject(id, payload) {
  return putJson(`/api/materials/projects/${id}/move`, payload, "移动素材文件夹失败。");
}

export async function listMaterialAssets(projectId, params = {}) {
  const search = new URLSearchParams();
  if (params.keyword) search.set("keyword", params.keyword);
  if (params.asset_type) search.set("asset_type", params.asset_type);
  if (params.page) search.set("page", String(params.page));
  if (params.page_size) search.set("page_size", String(params.page_size));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/materials/projects/${projectId}/assets${suffix}`, "素材文件加载失败。");
}

export async function listAllMaterialAssets(params = {}) {
  const search = new URLSearchParams();
  if (params.keyword) search.set("keyword", params.keyword);
  if (params.asset_type) search.set("asset_type", params.asset_type);
  if (params.page) search.set("page", String(params.page));
  if (params.page_size) search.set("page_size", String(params.page_size));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/materials/assets${suffix}`, "素材文件加载失败。");
}

async function postMaterialJson(path, body, errorMessage) {
  const response = await safeFetch(
    buildApiUrl(path),
    {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body || {}),
    },
    errorMessage,
  );
  if (!response.ok) await throwRequestError(response, errorMessage);
  return parseJsonResponse(response, errorMessage);
}

export async function uploadMaterialAsset(projectId, payload, options = {}) {
  const file = payload?.file;
  if (!file) {
    throw new Error("请选择要上传的文件。");
  }
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  const initResult = await postMaterialJson(
    `/api/materials/projects/${projectId}/assets/upload/init`,
    {
      file_name: file.name || "asset",
      file_size: file.size || 0,
      mime_type: file.type || "",
    },
    "申请上传地址失败。",
  );

  let parts;
  try {
    parts = await multipartUploadToOss(file, initResult, (percent) => {
      if (onProgress) onProgress({ percent });
    });
  } catch (error) {
    try {
      await postMaterialJson(
        `/api/materials/projects/${projectId}/assets/upload/abort`,
        { object_key: initResult.object_key, upload_id: initResult.upload_id },
        "取消上传失败。",
      );
    } catch {
      // best-effort cleanup; surface the original upload error
    }
    throw error;
  }

  return postMaterialJson(
    `/api/materials/projects/${projectId}/assets/upload/complete`,
    {
      object_key: initResult.object_key,
      upload_id: initResult.upload_id,
      file_name: file.name || "asset",
      file_size: file.size || 0,
      mime_type: initResult.mime_type || file.type || "",
      name: payload.name || "",
      remark: payload.remark || "",
      tags: payload.tags || "",
      parts,
    },
    "登记素材失败。",
  );
}

export async function uploadMaterialVideoCover(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await safeFetch(buildApiUrl("/api/materials/upload/video-cover"), {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  }, "视频封面上传失败。");
  if (!response.ok) await throwRequestError(response, "视频封面上传失败。");
  return parseJsonResponse(response, "视频封面上传失败。");
}

export async function getMaterialAsset(id) {
  return getJson(`/api/materials/assets/${id}`, "素材详情加载失败。");
}

export async function updateMaterialAsset(id, payload) {
  return putJson(`/api/materials/assets/${id}`, payload, "更新素材失败。");
}

export async function deleteMaterialAsset(id) {
  return deleteJson(`/api/materials/assets/${id}`, "删除素材失败。");
}

export async function moveMaterialAsset(id, payload) {
  return putJson(`/api/materials/assets/${id}/move`, payload, "移动素材失败。");
}
