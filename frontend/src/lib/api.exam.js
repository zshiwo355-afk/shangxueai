/** AI 通关 API（用户视角）：列表 / 开始 / 提交 / 查复盘。 */
import { getJson, postJson } from "./http";

export async function fetchMyExams() {
  return getJson("/api/exams/my", "通关列表加载失败。");
}

export async function startExam(examId) {
  return postJson(`/api/exams/${examId}/start`, {}, "开始通关失败。");
}

export async function finishExam(examId) {
  return postJson(`/api/exams/${examId}/finish`, {}, "提交通关失败。");
}

export async function fetchMyExamAttempts(examId) {
  return getJson(`/api/exams/${examId}/attempts`, "通关详情加载失败。");
}

// 通关中复用同样的 chat / reset endpoints
export { sendChat, resetTraining } from "./api.training";
