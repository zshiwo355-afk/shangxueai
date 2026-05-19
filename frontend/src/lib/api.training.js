/** 训练 API：start / chat / finish / reset + 训练记录列表/详情/删除。 */
import { deleteJson, getJson, postJson } from "./http";

export async function startTraining(payload) {
  return postJson("/api/training/start", payload, "训练启动失败，请稍后重试。");
}

export async function sendChat(payload) {
  return postJson("/api/training/chat", payload, "发送消息失败。");
}

export async function finishTraining(payload) {
  return postJson("/api/training/finish", payload, "结束训练失败。");
}

export async function resetTraining(payload) {
  return postJson("/api/training/reset", payload, "重置失败。");
}

export async function fetchMyTrainingRecords() {
  return getJson("/api/training/records", "训练记录加载失败。");
}

export async function fetchTrainingRecord(id) {
  return getJson(`/api/training/records/${id}`, "训练详情加载失败。");
}

export async function deleteTrainingRecord(id) {
  return deleteJson(`/api/training/records/${id}`, "删除训练记录失败。");
}
