import { buildApiUrl } from "./runtimeConfig";
import { getToken } from "./auth";
import { deleteJson, getJson, parseJsonResponse, postJson, putJson, safeFetch, throwRequestError } from "./http";

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
  return parseJsonResponse(response, "视频上传失败。");
}

export async function listMagicVideos() {
  const response = await safeFetch(buildApiUrl("/api/magic/videos"), {
    headers: authHeaders(),
  }, "视频列表加载失败。");
  if (!response.ok) await throwRequestError(response, "视频列表加载失败。");
  return parseJsonResponse(response, "视频列表加载失败。");
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
export async function listMagicVideoSeries() {
  return getJson("/api/magic-academy/admin/video-series", "系列列表加载失败。");
}
export async function createMagicVideoSeries(payload) {
  return postJson("/api/magic-academy/admin/video-series", payload, "新建系列失败。");
}
export async function updateMagicVideoSeries(id, payload) {
  return putJson(`/api/magic-academy/admin/video-series/${id}`, payload, "更新系列失败。");
}
export async function deleteMagicVideoSeries(id) {
  return deleteJson(`/api/magic-academy/admin/video-series/${id}`, "删除系列失败。");
}
export async function addMagicVideoSeriesItem(seriesId, payload) {
  return postJson(`/api/magic-academy/admin/video-series/${seriesId}/items`, payload, "添加系列视频失败。");
}
export async function reorderMagicVideoSeriesItems(seriesId, payload) {
  return putJson(`/api/magic-academy/admin/video-series/${seriesId}/items/reorder`, payload, "调整系列顺序失败。");
}
export async function removeMagicVideoSeriesItem(seriesId, videoId) {
  return deleteJson(`/api/magic-academy/admin/video-series/${seriesId}/items/${videoId}`, "移除系列视频失败。");
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
  return parseJsonResponse(response, "初始化视频上传失败。");
}

export async function completeMagicVideoUpload(payload) {
  const response = await safeFetch(buildApiUrl("/api/magic/videos/upload/complete"), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload || {}),
  }, "完成视频上传失败。");
  if (!response.ok) await throwRequestError(response, "完成视频上传失败。");
  return parseJsonResponse(response, "完成视频上传失败。");
}

export async function failMagicVideoUpload(payload) {
  const response = await safeFetch(buildApiUrl("/api/magic/videos/upload/fail"), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload || {}),
  }, "回写上传失败状态失败。");
  if (!response.ok) await throwRequestError(response, "回写上传失败状态失败。");
  return parseJsonResponse(response, "回写上传失败状态失败。");
}

export async function initMagicVideoReplaceUpload(videoId, payload) {
  const response = await safeFetch(buildApiUrl(`/api/magic/videos/${videoId}/replace/init`), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload || {}),
  }, "初始化替换上传失败。");
  if (!response.ok) await throwRequestError(response, "初始化替换上传失败。");
  return parseJsonResponse(response, "初始化替换上传失败。");
}

export async function completeMagicVideoReplaceUpload(videoId, payload) {
  const response = await safeFetch(buildApiUrl(`/api/magic/videos/${videoId}/replace/complete`), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload || {}),
  }, "完成替换上传失败。");
  if (!response.ok) await throwRequestError(response, "完成替换上传失败。");
  return parseJsonResponse(response, "完成替换上传失败。");
}

export async function failMagicVideoReplaceUpload(videoId, payload) {
  const response = await safeFetch(buildApiUrl(`/api/magic/videos/${videoId}/replace/fail`), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload || {}),
  }, "回写替换上传失败状态失败。");
  if (!response.ok) await throwRequestError(response, "回写替换上传失败状态失败。");
  return parseJsonResponse(response, "回写替换上传失败状态失败。");
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
export async function createMagicWatchConfirmLog(videoId, payload) {
  return postJson(`/api/magic-academy/my/videos/${videoId}/watch-confirm`, payload, "确认观看失败。");
}
export async function fetchMagicWatchConfirmSetting(videoId) {
  return getJson(`/api/magic-academy/admin/videos/${videoId}/watch-confirm-setting`, "观看确认配置加载失败。");
}
export async function updateMagicWatchConfirmSetting(videoId, payload) {
  return putJson(`/api/magic-academy/admin/videos/${videoId}/watch-confirm-setting`, payload, "观看确认配置保存失败。");
}

export async function fetchMagicVideoStats(videoId, params = {}) {
  const search = new URLSearchParams();
  if (params.department) search.set("department", params.department);
  if (params.user_id) search.set("user_id", String(params.user_id));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/magic-academy/videos/${videoId}/stats${suffix}`, "学习统计加载失败。");
}
export async function fetchMagicVideoAnswers(videoId, params = {}) {
  const search = new URLSearchParams();
  if (params.department) search.set("department", params.department);
  if (params.user_id) search.set("user_id", String(params.user_id));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/magic-academy/videos/${videoId}/answers${suffix}`, "答题详情加载失败。");
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
export async function fetchMyReadingContents(date) {
  const search = new URLSearchParams();
  if (date) search.set("date", date);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/magic-academy/my/reading-contents${suffix}`, "读书内容加载失败。");
}
export async function fetchMyAudioMakeupOptions(month) {
  const search = new URLSearchParams();
  if (month) search.set("month", month);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/magic-academy/my/audios/makeup-options${suffix}`, "补卡选项加载失败。");
}
export async function fetchMyAudioCalendar(month) {
  const search = new URLSearchParams();
  if (month) search.set("month", month);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/magic-academy/my/audios/calendar${suffix}`, "录音日历加载失败。");
}
export async function uploadMyAudio(payload) {
  return postJson("/api/magic-academy/my/audios", payload, "录音上传失败。");
}
export async function submitMyAudioMakeup(payload) {
  return postJson("/api/magic-academy/my/audios/makeup", payload, "补卡失败。");
}
export async function deleteMyAudio(id) {
  return deleteJson(`/api/magic-academy/my/audios/${id}`, "删除录音失败。");
}
export async function fetchMagicAudioMakeupSetting() {
  return getJson("/api/magic-academy/admin/audio-makeup-setting", "补卡设置加载失败。");
}
export async function updateMagicAudioMakeupSetting(payload) {
  return putJson("/api/magic-academy/admin/audio-makeup-setting", payload, "补卡设置保存失败。");
}
export async function fetchAdminReadingContents(params = {}) {
  const search = new URLSearchParams();
  if (params.month) search.set("month", params.month);
  if (params.date) search.set("date", params.date);
  if (params.keyword) search.set("keyword", params.keyword);
  if (params.page) search.set("page", String(params.page));
  if (params.page_size) search.set("page_size", String(params.page_size));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/magic-academy/admin/reading-contents${suffix}`, "读书内容列表加载失败。");
}
export async function fetchAdminReadingContentDetail(id) {
  return getJson(`/api/magic-academy/admin/reading-contents/${id}`, "读书内容详情加载失败。");
}
async function submitReadingContentForm(url, method, payload, errorMessage) {
  const formData = new FormData();
  formData.append("reading_date", payload.reading_date);
  formData.append("title", payload.title || "");
  formData.append("description", payload.description || "");
  formData.append("image_source", payload.image_source || "upload");
  if (payload.material_asset_id) formData.append("material_asset_id", String(payload.material_asset_id));
  formData.append("target_type", payload.target_type || "user");
  formData.append("target_user_ids", JSON.stringify(payload.target_user_ids || []));
  formData.append("target_department_ids", JSON.stringify(payload.target_department_ids || []));
  formData.append("target_position_ids", JSON.stringify(payload.target_position_ids || []));
  if (payload.image) formData.append("image", payload.image);
  const response = await safeFetch(buildApiUrl(url), {
    method,
    headers: authHeaders(),
    body: formData,
  }, errorMessage);
  if (!response.ok) await throwRequestError(response, errorMessage);
  return parseJsonResponse(response, errorMessage);
}
export async function createAdminReadingContent(payload) {
  return submitReadingContentForm("/api/magic-academy/admin/reading-contents", "POST", payload, "新增读书内容失败。");
}
export async function updateAdminReadingContent(id, payload) {
  return submitReadingContentForm(`/api/magic-academy/admin/reading-contents/${id}`, "PUT", payload, "更新读书内容失败。");
}
export async function deleteAdminReadingContent(id) {
  return deleteJson(`/api/magic-academy/admin/reading-contents/${id}`, "删除读书内容失败。");
}

export async function fetchMagicAudioStats(params = {}) {
  const search = new URLSearchParams();
  if (params.month) search.set("month", params.month);
  if (params.department) search.set("department", params.department);
  if (params.user_id) search.set("user_id", String(params.user_id));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/magic-academy/admin/audio-stats${suffix}`, "录音统计加载失败。");
}
export async function fetchAdminAudioCalendar(params = {}) {
  const search = new URLSearchParams();
  if (params.month) search.set("month", params.month);
  if (params.department) search.set("department", params.department);
  if (params.user_id) search.set("user_id", String(params.user_id));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson(`/api/magic-academy/admin/audios/calendar${suffix}`, "录音日历加载失败。");
}
