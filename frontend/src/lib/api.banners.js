/** 轮播图 API：管理员 CRUD + 上传 / 从素材库导入；用户端只读启用项。 */
import { buildApiUrl } from "./runtimeConfig";
import { getToken } from "./auth";
import {
  deleteJson,
  getJson,
  parseJsonResponse,
  postJson,
  putJson,
  safeFetch,
  throwRequestError,
} from "./http";

function authHeaders(extra = {}) {
  const headers = new Headers(extra);
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export async function fetchActiveBanners() {
  return getJson("/api/banners", "轮播图加载失败。");
}

export async function adminListBanners() {
  return getJson("/api/admin/banners", "轮播图列表加载失败。");
}

export async function adminCreateBanner(payload) {
  return postJson("/api/admin/banners", payload, "新建轮播图失败。");
}

export async function adminUpdateBanner(id, payload) {
  return putJson(`/api/admin/banners/${id}`, payload, "更新轮播图失败。");
}

export async function adminDeleteBanner(id) {
  return deleteJson(`/api/admin/banners/${id}`, "删除轮播图失败。");
}

export async function adminUploadBannerImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await safeFetch(
    buildApiUrl("/api/admin/banners/upload"),
    { method: "POST", headers: authHeaders(), body: formData },
    "图片上传失败。",
  );
  if (!response.ok) await throwRequestError(response, "图片上传失败。");
  return parseJsonResponse(response, "图片上传失败。");
}

export async function adminImportBannerFromMaterial(materialAssetId) {
  return postJson(
    "/api/admin/banners/import-from-material",
    { material_asset_id: Number(materialAssetId) },
    "从素材库导入失败。",
  );
}
