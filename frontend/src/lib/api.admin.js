/** 管理员 API：用户 CRUD + 考试 CRUD。 */
import { deleteJson, getJson, postJson, putJson } from "./http";

// ---- 用户 ----
export async function adminListUsers() {
  return getJson("/api/admin/users", "用户列表加载失败。");
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

// ---- 考试 ----
export async function adminListExams() {
  return getJson("/api/admin/exams", "考试列表加载失败。");
}
export async function adminCreateExam(payload) {
  return postJson("/api/admin/exams", payload, "派发考试失败。");
}
export async function adminGetExamDetail(id) {
  return getJson(`/api/admin/exams/${id}`, "考试详情加载失败。");
}
export async function adminDeleteExam(id) {
  return deleteJson(`/api/admin/exams/${id}`, "删除考试失败。");
}
export async function adminListPendingReview() {
  return getJson("/api/admin/exams/pending-review", "待复核列表加载失败。");
}
export async function adminSubmitReview(attemptId, payload) {
  return postJson(`/api/admin/exam-attempts/${attemptId}/review`, payload, "复核提交失败。");
}
