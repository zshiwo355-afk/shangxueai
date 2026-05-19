import { buildApiUrl } from "./runtimeConfig";
import { getToken } from "./auth";
import { deleteJson, getJson, postJson, putJson, safeFetch, throwRequestError } from "./http";

function authHeaders(extra = {}) {
  const headers = new Headers(extra);
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export function buildMagicVideoStreamUrl(videoId) {
  const url = new URL(buildApiUrl(`/api/magic-academy/videos/${videoId}/stream`), window.location.origin);
  const token = getToken();
  if (token) url.searchParams.set("access_token", token);
  return url.toString();
}

export async function uploadMagicVideoFile(file, durationSeconds = 0) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("duration_seconds", String(durationSeconds || 0));
  const response = await safeFetch(buildApiUrl("/api/magic-academy/upload/video"), {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  }, "视频上传失败。");
  if (!response.ok) await throwRequestError(response, "视频上传失败。");
  return response.json();
}

export async function listMagicVideos() {
  const response = await safeFetch(buildApiUrl("/api/magic/videos"), {
    headers: authHeaders(),
  }, "视频列表加载失败。");
  if (!response.ok) await throwRequestError(response, "视频列表加载失败。");
  return response.json();
}
export async function createMagicVideo(payload) {
  return postJson("/api/magic-academy/videos", payload, "新建视频失败。");
}
export async function updateMagicVideo(id, payload) {
  return putJson(`/api/magic-academy/videos/${id}`, payload, "更新视频失败。");
}
export async function deleteMagicVideo(id) {
  return deleteJson(`/api/magic-academy/videos/${id}`, "删除视频失败。");
}
export async function publishMagicVideo(id) {
  return postJson(`/api/magic-academy/videos/${id}/publish`, {}, "发布视频失败。");
}
export async function disableMagicVideo(id) {
  return postJson(`/api/magic-academy/videos/${id}/disable`, {}, "停用视频失败。");
}

export async function initMagicVideoUpload(payload) {
  const response = await safeFetch(buildApiUrl("/api/magic/videos/upload/init"), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload || {}),
  }, "初始化视频上传失败。");
  if (!response.ok) await throwRequestError(response, "初始化视频上传失败。");
  return response.json();
}

export async function completeMagicVideoUpload(payload) {
  const response = await safeFetch(buildApiUrl("/api/magic/videos/upload/complete"), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload || {}),
  }, "完成视频上传失败。");
  if (!response.ok) await throwRequestError(response, "完成视频上传失败。");
  return response.json();
}

export async function failMagicVideoUpload(payload) {
  const response = await safeFetch(buildApiUrl("/api/magic/videos/upload/fail"), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload || {}),
  }, "回写上传失败状态失败。");
  if (!response.ok) await throwRequestError(response, "回写上传失败状态失败。");
  return response.json();
}

export async function listMagicQuizPoints(videoId) {
  return getJson(`/api/magic-academy/videos/${videoId}/quiz-points`, "答题节点加载失败。");
}
export async function createMagicQuizPoint(videoId, payload) {
  return postJson(`/api/magic-academy/videos/${videoId}/quiz-points`, payload, "创建答题节点失败。");
}
export async function updateMagicQuizPoint(pointId, payload) {
  return putJson(`/api/magic-academy/quiz-points/${pointId}`, payload, "更新答题节点失败。");
}
export async function deleteMagicQuizPoint(pointId) {
  return deleteJson(`/api/magic-academy/quiz-points/${pointId}`, "删除答题节点失败。");
}
export async function createMagicQuestion(pointId, payload) {
  return postJson(`/api/magic-academy/quiz-points/${pointId}/questions`, payload, "创建题目失败。");
}
export async function updateMagicQuestion(questionId, payload) {
  return putJson(`/api/magic-academy/questions/${questionId}`, payload, "更新题目失败。");
}
export async function deleteMagicQuestion(questionId) {
  return deleteJson(`/api/magic-academy/questions/${questionId}`, "删除题目失败。");
}

export async function fetchMyMagicVideos() {
  return getJson("/api/magic-academy/my/videos", "学习视频加载失败。");
}
export async function fetchMyMagicVideoDetail(videoId) {
  return getJson(`/api/magic-academy/my/videos/${videoId}`, "视频详情加载失败。");
}
export async function saveMyMagicVideoProgress(videoId, payload) {
  return postJson(`/api/magic-academy/my/videos/${videoId}/progress`, payload, "保存进度失败。");
}
export async function submitMyMagicQuiz(videoId, payload) {
  return postJson(`/api/magic-academy/my/videos/${videoId}/submit-quiz`, payload, "提交答题失败。");
}

export async function fetchMagicVideoStats(videoId) {
  return getJson(`/api/magic-academy/videos/${videoId}/stats`, "学习统计加载失败。");
}
export async function fetchMagicVideoAnswers(videoId) {
  return getJson(`/api/magic-academy/videos/${videoId}/answers`, "答题详情加载失败。");
}

export async function downloadMagicFile(path) {
  const response = await safeFetch(buildApiUrl(path), {
    headers: authHeaders(),
  }, "下载失败。");
  if (!response.ok) await throwRequestError(response, "下载失败。");
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  return { blob, filename: match?.[1] || "export.xlsx" };
}

export async function listMagicWhitelist() {
  return getJson("/api/magic-academy/video-whitelist", "白名单加载失败。");
}
export async function createMagicWhitelist(payload) {
  return postJson("/api/magic-academy/video-whitelist", payload, "添加白名单失败。");
}
export async function deleteMagicWhitelist(id) {
  return deleteJson(`/api/magic-academy/video-whitelist/${id}`, "删除白名单失败。");
}

export async function fetchMyAudios() {
  return getJson("/api/magic-academy/my/audios", "录音记录加载失败。");
}
export async function uploadMyAudio(file, remark = "") {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("remark", remark || "");
  const response = await safeFetch(buildApiUrl("/api/magic-academy/my/audios"), {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  }, "录音上传失败。");
  if (!response.ok) await throwRequestError(response, "录音上传失败。");
  return response.json();
}
export async function deleteMyAudio(id) {
  return deleteJson(`/api/magic-academy/my/audios/${id}`, "删除录音失败。");
}

export async function fetchMagicAudioStats(params = {}) {
  const search = new URLSearchParams();
  if (params.month) search.set("month", params.month);
  if (params.department) search.set("department", params.department);
  if (params.user_id) search.set("user_id", String(params.user_id));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/magic-academy/admin/audio-stats${suffix}`, "录音统计加载失败。");
}
