import { buildApiUrl } from "./runtimeConfig";
import { getToken } from "./auth";
import { deleteJson, getJson, parseJsonResponse, putJson, safeFetch, throwRequestError } from "./http";

function authHeaders(extra = {}) {
  const headers = new Headers(extra);
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export function buildMaterialAssetPreviewUrl(assetId) {
  const url = new URL(buildApiUrl(`/api/materials/assets/${assetId}/preview`), window.location.origin);
  const token = getToken();
  if (token) url.searchParams.set("access_token", token);
  return url.toString();
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
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/materials/projects/${projectId}/assets${suffix}`, "素材文件加载失败。");
}

export async function listAllMaterialAssets(params = {}) {
  const search = new URLSearchParams();
  if (params.keyword) search.set("keyword", params.keyword);
  if (params.asset_type) search.set("asset_type", params.asset_type);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/materials/assets${suffix}`, "素材文件加载失败。");
}

export async function uploadMaterialAsset(projectId, payload) {
  const formData = new FormData();
  formData.append("name", payload.name || "");
  formData.append("remark", payload.remark || "");
  formData.append("tags", payload.tags || "");
  formData.append("file", payload.file);
  const response = await safeFetch(buildApiUrl(`/api/materials/projects/${projectId}/assets`), {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  }, "上传素材失败。");
  if (!response.ok) await throwRequestError(response, "上传素材失败。");
  return parseJsonResponse(response, "上传素材失败。");
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
