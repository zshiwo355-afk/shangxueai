import { buildApiUrl } from "./runtimeConfig";
import { getToken } from "./auth";
import { deleteJson, getJson, parseJsonResponse, postJson, putJson, safeFetch, throwRequestError } from "./http";
import { multipartUploadToOss } from "./ossMultipart";

function toQs(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

function authHeaders(extra = {}) {
  const headers = new Headers(extra);
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function postAdminJson(path, body, fallbackMessage) {
  return postJson(path, body, fallbackMessage);
}

export async function listLiveRooms(params = {}) {
  return getJson(`/api/admin/live/rooms${toQs(params)}`, "直播列表加载失败。");
}

export async function getLiveRoom(id) {
  return getJson(`/api/admin/live/rooms/${id}`, "直播详情加载失败。");
}

export async function createLiveRoom(payload) {
  return postAdminJson("/api/admin/live/rooms", payload, "新建直播失败。");
}

export async function updateLiveRoom(id, payload) {
  return putJson(`/api/admin/live/rooms/${id}`, payload, "更新直播失败。");
}

export async function deleteLiveRoom(id) {
  return deleteJson(`/api/admin/live/rooms/${id}`, "删除直播失败。");
}

export async function publishLiveRoom(id) {
  return postAdminJson(`/api/admin/live/rooms/${id}/publish`, {}, "发布直播失败。");
}

export async function disableLiveRoom(id) {
  return postAdminJson(`/api/admin/live/rooms/${id}/disable`, {}, "下架直播失败。");
}

export async function listLiveComments(params = {}) {
  return getJson(`/api/admin/live/comments${toQs(params)}`, "评论列表加载失败。");
}

export async function hideLiveComment(id) {
  return postAdminJson(`/api/admin/live/comments/${id}/hide`, {}, "隐藏评论失败。");
}

export async function restoreLiveComment(id) {
  return postAdminJson(`/api/admin/live/comments/${id}/restore`, {}, "恢复评论失败。");
}

export async function batchUpdateLiveComments(payload) {
  return postAdminJson("/api/admin/live/comments/batch", payload, "批量操作评论失败。");
}

export async function deleteLiveComment(id) {
  return deleteJson(`/api/admin/live/comments/${id}`, "删除评论失败。");
}

export async function getLiveCommentSettings() {
  return getJson("/api/admin/live/comments/settings", "评论设置加载失败。");
}

export async function updateLiveCommentSettings(payload) {
  return putJson("/api/admin/live/comments/settings", payload, "评论设置保存失败。");
}

export async function listLiveCommentToggleLogs(id, params = {}) {
  return getJson(
    `/api/admin/live/rooms/${id}/comments/toggle-logs${toQs(params)}`,
    "评论开关记录加载失败。",
  );
}

export async function toggleLiveRoomComments(id, allowComment) {
  return postAdminJson(
    `/api/admin/live/rooms/${id}/comments/toggle`,
    { allow_comment: Boolean(allowComment) },
    "更新评论开关失败。",
  );
}

export async function uploadLiveImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await safeFetch(buildApiUrl("/api/admin/live/upload/image"), {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  }, "图片上传失败。");
  if (!response.ok) await throwRequestError(response, "图片上传失败。");
  return parseJsonResponse(response, "图片上传失败。");
}

async function initLiveVideoUpload(file) {
  return postAdminJson(
    "/api/admin/live/rooms/upload/init",
    {
      file_name: file.name || "live-video.mp4",
      file_size: file.size || 0,
      mime_type: file.type || "video/mp4",
    },
    "申请视频上传地址失败。",
  );
}

async function completeLiveVideoUpload(file, initResult, parts, durationSeconds = 0) {
  return postAdminJson(
    "/api/admin/live/rooms/upload/complete",
    {
      object_key: initResult.object_key,
      upload_id: initResult.upload_id,
      file_name: file.name || "live-video.mp4",
      file_size: file.size || 0,
      mime_type: initResult.mime_type || file.type || "video/mp4",
      duration_seconds: durationSeconds || 0,
      parts,
    },
    "登记视频失败。",
  );
}

async function failLiveVideoUpload(initResult) {
  if (!initResult?.object_key || !initResult?.upload_id) return;
  try {
    await postAdminJson(
      "/api/admin/live/rooms/upload/fail",
      { object_key: initResult.object_key, upload_id: initResult.upload_id },
      "取消视频上传失败。",
    );
  } catch {
    // best effort
  }
}

export async function uploadLiveVideo(file, { onProgress, durationSeconds = 0 } = {}) {
  const initResult = await initLiveVideoUpload(file);
  try {
    const parts = await multipartUploadToOss(file, initResult, onProgress);
    const result = await completeLiveVideoUpload(file, initResult, parts, durationSeconds);
    onProgress?.(100);
    return result;
  } catch (error) {
    await failLiveVideoUpload(initResult);
    throw error;
  }
}

export function buildPublicLiveStreamUrl(slug) {
  return buildApiUrl(`/api/public/live/${encodeURIComponent(slug)}/stream`);
}

export async function getPublicLiveRoom(slug, params = {}) {
  return getJson(`/api/public/live/${encodeURIComponent(slug)}${toQs(params)}`, "直播加载失败。");
}

export async function getPublicLivePlaybackUrl(slug, params = {}) {
  return getJson(`/api/public/live/${encodeURIComponent(slug)}/playback-url${toQs(params)}`, "视频地址加载失败。");
}

export async function getPublicLiveShareConfig(slug, url = "") {
  return getJson(
    `/api/public/live/${encodeURIComponent(slug)}/share-config${toQs({ url })}`,
    "分享配置加载失败。",
  );
}

export async function recordPublicLiveView(slug, payload) {
  return postJson(`/api/public/live/${encodeURIComponent(slug)}/view`, payload, "记录观看失败。");
}

export async function likePublicLive(slug, payload) {
  return postJson(`/api/public/live/${encodeURIComponent(slug)}/like`, payload, "点赞失败。");
}

export async function sharePublicLive(slug, payload) {
  return postJson(`/api/public/live/${encodeURIComponent(slug)}/share`, payload, "分享记录失败。");
}

export async function listPublicLiveComments(slug, params = {}) {
  if (params && Object.keys(params).length) {
    return getJson(
      `/api/public/live/${encodeURIComponent(slug)}/comments${toQs(params)}`,
      "评论加载失败。",
    );
  }
  return getJson(`/api/public/live/${encodeURIComponent(slug)}/comments`, "评论加载失败。");
}

export async function createPublicLiveComment(slug, payload) {
  return postJson(`/api/public/live/${encodeURIComponent(slug)}/comments`, payload, "评论发送失败。");
}
