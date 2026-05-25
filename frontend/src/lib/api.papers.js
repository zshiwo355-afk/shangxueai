/** 考试管理 API：题库 / 试卷 / 派发 / 复核 / 导入。 */
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

function toQs(params) {
  if (!params) return "";
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    usp.set(k, String(v));
  });
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// ---------------- 题库 ----------------

export async function listQuestionBank(params = {}) {
  return getJson(`/api/admin/question-bank${toQs(params)}`, "题库列表加载失败。");
}

export async function listQuestionCategories() {
  return getJson("/api/admin/question-bank/categories", "题库分类加载失败。");
}

export async function getQuestion(id) {
  return getJson(`/api/admin/question-bank/${id}`, "题目加载失败。");
}

export async function createQuestion(payload) {
  return postJson("/api/admin/question-bank", payload, "新建题目失败。");
}

export async function updateQuestion(id, payload) {
  return putJson(`/api/admin/question-bank/${id}`, payload, "更新题目失败。");
}

export async function deleteQuestion(id) {
  return deleteJson(`/api/admin/question-bank/${id}`, "删除题目失败。");
}

export async function bulkDeleteQuestions(ids) {
  return postJson("/api/admin/question-bank/bulk-delete", { ids }, "批量删除题目失败。");
}

export async function bulkSetQuestionStatus(ids, status) {
  return postJson("/api/admin/question-bank/bulk-status", { ids, status }, "批量更新状态失败。");
}

// ---------------- 试卷 ----------------

export async function listPapers(params = {}) {
  return getJson(`/api/admin/papers${toQs(params)}`, "试卷列表加载失败。");
}

export async function getPaperDetail(id) {
  return getJson(`/api/admin/papers/${id}`, "试卷详情加载失败。");
}

export async function createPaper(payload) {
  return postJson("/api/admin/papers", payload, "新建试卷失败。");
}

export async function updatePaper(id, payload) {
  return putJson(`/api/admin/papers/${id}`, payload, "更新试卷失败。");
}

export async function deletePaper(id) {
  return deleteJson(`/api/admin/papers/${id}`, "删除试卷失败。");
}

export async function publishPaper(id) {
  return postJson(`/api/admin/papers/${id}/publish`, {}, "发布试卷失败。");
}

export async function attachQuestionsToPaper(paperId, payload) {
  return postJson(`/api/admin/papers/${paperId}/questions`, payload, "添加题目到试卷失败。");
}

export async function reorderPaperQuestions(paperId, payload) {
  return putJson(`/api/admin/papers/${paperId}/questions/reorder`, payload, "调整题目顺序失败。");
}

export async function removePaperQuestion(paperId, paperQuestionId) {
  return deleteJson(
    `/api/admin/papers/${paperId}/questions/${paperQuestionId}`,
    "移除题目失败。",
  );
}

// ---------------- 派发 + 复核 ----------------

export async function listAssignments(params = {}) {
  return getJson(`/api/admin/paper-assignments${toQs(params)}`, "派发列表加载失败。");
}

export async function listPendingReview(params = {}) {
  return getJson(`/api/admin/paper-assignments/pending-review${toQs(params)}`, "待复核列表加载失败。");
}

export async function listPendingSubmissions(params = {}) {
  return getJson(`/api/admin/paper-assignments/pending-submissions${toQs(params)}`, "待复核提交加载失败。");
}

export async function createAssignments(payload) {
  return postJson("/api/admin/paper-assignments", payload, "派发试卷失败。");
}

export async function deleteAssignment(id, force = false) {
  const qs = force ? "?force=true" : "";
  return deleteJson(`/api/admin/paper-assignments/${id}${qs}`, "删除派发任务失败。");
}

export async function pushAssignmentWeCom(id) {
  return postJson(`/api/admin/paper-assignments/${id}/wecom-push`, {}, "推送企微失败。");
}

export async function listSubmissions(assignmentId) {
  return getJson(
    `/api/admin/paper-assignments/${assignmentId}/submissions`,
    "提交列表加载失败。",
  );
}

export async function getSubmissionDetail(submissionId) {
  return getJson(
    `/api/admin/paper-assignments/submissions/${submissionId}`,
    "提交详情加载失败。",
  );
}

export async function gradeSubmission(submissionId, payload) {
  return postJson(
    `/api/admin/paper-assignments/submissions/${submissionId}/grade`,
    payload,
    "提交评分失败。",
  );
}

// ---------------- 导入 ----------------

export async function uploadImportFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await safeFetch(
    buildApiUrl("/api/admin/question-imports/upload"),
    { method: "POST", headers: authHeaders(), body: formData },
    "上传文件失败。",
  );
  if (!response.ok) await throwRequestError(response, "上传文件失败。");
  return parseJsonResponse(response, "上传文件失败。");
}

export async function getImportJob(jobId) {
  return getJson(`/api/admin/question-imports/${jobId}`, "导入任务加载失败。");
}

export async function updateImportRow(jobId, rowIdx, data) {
  return putJson(
    `/api/admin/question-imports/${jobId}/rows/${rowIdx}`,
    { data },
    "更新行失败。",
  );
}

export async function commitImport(jobId, paperId) {
  const qs = paperId ? `?paper_id=${encodeURIComponent(paperId)}` : "";
  return postJson(`/api/admin/question-imports/${jobId}/commit${qs}`, {}, "导入入库失败。");
}

export function buildImportTemplateUrl(fmt = "xlsx") {
  const safe = fmt === "docx" ? "docx" : "xlsx";
  const url = new URL(
    buildApiUrl(`/api/admin/question-imports/template?fmt=${safe}`),
    window.location.origin,
  );
  const token = getToken();
  if (token) url.searchParams.set("access_token", token);
  return url.toString();
}
