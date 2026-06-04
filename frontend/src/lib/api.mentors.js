/** 后台导师管理 API。 */
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

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    search.set(k, String(v));
  });
  const s = search.toString();
  return s ? `?${s}` : "";
}

export async function adminListMentors() {
  return getJson("/api/admin/mentors", "导师列表加载失败。");
}

export async function adminGetMentor(id) {
  return getJson(`/api/admin/mentors/${id}`, "导师详情加载失败。");
}

export async function adminCreateMentor(payload) {
  return postJson("/api/admin/mentors", payload, "新建导师失败。");
}

export async function adminUpdateMentor(id, payload) {
  return putJson(`/api/admin/mentors/${id}`, payload, "更新导师失败。");
}

export async function adminDeleteMentor(id) {
  return deleteJson(`/api/admin/mentors/${id}`, "删除导师失败。");
}

export async function adminUploadMentorAvatar(mentorId, file) {
  const formData = new FormData();
  formData.append("file", file);
  // mentorId=0 时表示"还没保存的草稿"——后端允许，仅返回 url+key，不写入档案
  const id = Number(mentorId) || 0;
  const response = await safeFetch(
    buildApiUrl(`/api/admin/mentors/${id}/avatar/upload`),
    { method: "POST", headers: authHeaders(), body: formData },
    "头像上传失败。",
  );
  if (!response.ok) await throwRequestError(response, "头像上传失败。");
  return parseJsonResponse(response, "头像上传失败。");
}

export async function adminImportMentorAvatarFromMaterial(mentorId, materialAssetId) {
  const id = Number(mentorId) || 0;
  return postJson(
    `/api/admin/mentors/${id}/avatar/import-from-material`,
    { material_asset_id: Number(materialAssetId) },
    "导入头像失败。",
  );
}

export async function adminListMentorRecommendations(mentorId) {
  return getJson(`/api/admin/mentors/${mentorId}/recommendations`, "推荐内容加载失败。");
}

export async function adminCreateMentorRecommendation(mentorId, payload) {
  return postJson(`/api/admin/mentors/${mentorId}/recommendations`, payload, "新增推荐失败。");
}

export async function adminUpdateMentorRecommendation(mentorId, recId, payload) {
  return putJson(`/api/admin/mentors/${mentorId}/recommendations/${recId}`, payload, "更新推荐失败。");
}

export async function adminDeleteMentorRecommendation(mentorId, recId) {
  return deleteJson(`/api/admin/mentors/${mentorId}/recommendations/${recId}`, "删除推荐失败。");
}

export async function adminSearchMentorCandidates(keyword = "") {
  return getJson(
    `/api/admin/mentors/_candidates/search${buildQuery({ keyword })}`,
    "用户搜索失败。",
  );
}
