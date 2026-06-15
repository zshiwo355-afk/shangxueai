/** 管理员 API：用户 CRUD + AI 通关 CRUD。 */
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

// ---- 用户 ----
export async function adminListUsers() {
  return getJson("/api/admin/users", "用户列表加载失败。");
}
export async function adminSearchUsers(params = {}) {
  return getJson(`/api/admin/users/search${toQs(params)}`, "用户列表加载失败。");
}
export async function adminListDepartments() {
  return getJson("/api/admin/users/departments", "部门列表加载失败。");
}
export async function adminGetUserDetail(id) {
  return getJson(`/api/admin/users/${id}`, "用户详情加载失败。");
}
export async function adminCreateUser(payload) {
  return postJson("/api/admin/users", payload, "新建用户失败。");
}
export async function adminUpdateUser(id, payload) {
  return putJson(`/api/admin/users/${id}`, payload, "更新用户失败。");
}
export async function adminDeleteUser(id) {
  return deleteJson(`/api/admin/users/${id}`, "删除用户失败。");
}
export async function adminBulkDeleteUsers(ids) {
  return postJson("/api/admin/users/bulk-delete", { ids }, "批量删除用户失败。");
}
export async function adminBulkImportUsers(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await safeFetch(
    buildApiUrl("/api/admin/users/bulk-import"),
    { method: "POST", headers: authHeaders(), body: formData },
    "上传文件失败。",
  );
  if (!response.ok) await throwRequestError(response, "批量导入失败。");
  return parseJsonResponse(response, "批量导入失败。");
}
export function buildUsersTemplateUrl() {
  const url = new URL(
    buildApiUrl("/api/admin/users/template"),
    window.location.origin,
  );
  const token = getToken();
  if (token) url.searchParams.set("access_token", token);
  return url.toString();
}

export async function adminPreviewEmployeeSync(initial_mode = true) {
  return postJson(
    "/api/admin/users/employee-sync/preview",
    { initial_mode },
    "员工同步预览失败。",
  );
}

export async function adminExecuteEmployeeSync(initial_mode = true, preview_token = "") {
  return postJson(
    "/api/admin/users/employee-sync/execute",
    { initial_mode, preview_token },
    "员工同步执行失败。",
  );
}

export async function adminSearchExternalEmployees(params = {}) {
  return getJson(
    `/api/admin/users/employee-sync/search${toQs(params)}`,
    "第三方员工查询失败。",
  );
}

export async function adminListSyncBatches(params = {}) {
  return getJson(
    `/api/admin/users/employee-sync/batches${toQs(params)}`,
    "同步记录加载失败。",
  );
}

export async function adminGetSyncBatchEntries(batchId, params = {}) {
  return getJson(
    `/api/admin/users/employee-sync/batches/${batchId}/entries${toQs(params)}`,
    "同步明细加载失败。",
  );
}

export async function adminDeleteSyncBatch(batchId) {
  return deleteJson(
    `/api/admin/users/employee-sync/batches/${batchId}`,
    "删除同步记录失败。",
  );
}

// ---- 白名单 ----
export async function adminListWhitelist() {
  return getJson("/api/whitelist", "白名单列表加载失败。");
}
export async function adminCreateWhitelist(payload) {
  return postJson("/api/whitelist", payload, "新建白名单失败。");
}
export async function adminUpdateWhitelist(id, payload) {
  return putJson(`/api/whitelist/${id}`, payload, "更新白名单失败。");
}
export async function adminDeleteWhitelist(id) {
  return deleteJson(`/api/whitelist/${id}`, "删除白名单失败。");
}

// ---- AI 通关 ----
export async function adminListExams(params) {
  const qs = params ? toQs(params) : "";
  return getJson(`/api/admin/exams${qs}`, "通关列表加载失败。");
}
export async function adminCreateExam(payload) {
  return postJson("/api/admin/exams", payload, "派发通关失败。");
}
export async function adminBatchCreateExams(payload) {
  return postJson("/api/admin/exams/batch", payload, "批量派发通关失败。");
}
export async function adminGetExamDetail(id) {
  return getJson(`/api/admin/exams/${id}`, "通关详情加载失败。");
}
export async function adminDeleteExam(id) {
  return deleteJson(`/api/admin/exams/${id}`, "删除通关失败。");
}
export async function adminBulkDeleteExams(ids, force = false) {
  return postJson("/api/admin/exams/bulk-delete", { ids, force }, "批量删除通关失败。");
}
export async function adminPushExamWecom(id) {
  return postJson(`/api/admin/exams/${id}/wecom-push`, {}, "推送通关任务失败。");
}
export async function adminListPendingReview() {
  return getJson("/api/admin/exams/pending-review", "待复核列表加载失败。");
}
export async function adminSubmitReview(attemptId, payload) {
  return postJson(`/api/admin/exam-attempts/${attemptId}/review`, payload, "复核提交失败。");
}

export async function adminListTrainingRecords(params = {}) {
  return getJson(`/api/admin/training-records${toQs(params)}`, "训练记录加载失败。");
}
export async function adminGetTrainingRecord(id) {
  return getJson(`/api/admin/training-records/${id}`, "训练记录详情加载失败。");
}
