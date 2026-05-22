/** 管理员 API：用户 CRUD + AI 通关 CRUD。 */
import { deleteJson, getJson, postJson, putJson } from "./http";

// ---- 用户 ----
export async function adminListUsers() {
  return getJson("/api/admin/users", "用户列表加载失败。");
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

// ---- AI 通关 ----
export async function adminListExams() {
  return getJson("/api/admin/exams", "通关列表加载失败。");
}
export async function adminCreateExam(payload) {
  return postJson("/api/admin/exams", payload, "派发通关失败。");
}
export async function adminGetExamDetail(id) {
  return getJson(`/api/admin/exams/${id}`, "通关详情加载失败。");
}
export async function adminDeleteExam(id) {
  return deleteJson(`/api/admin/exams/${id}`, "删除通关失败。");
}
export async function adminListPendingReview() {
  return getJson("/api/admin/exams/pending-review", "待复核列表加载失败。");
}
export async function adminSubmitReview(attemptId, payload) {
  return postJson(`/api/admin/exam-attempts/${attemptId}/review`, payload, "复核提交失败。");
}
