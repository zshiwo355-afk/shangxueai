/** 选项 API：用户取启用项 + 管理员全 CRUD。 */
import { deleteJson, getJson, postJson, putJson } from "./http";

export async function fetchOptions() {
  return getJson("/api/options", "下拉项加载失败。");
}

export async function adminListOptions(category) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  return getJson(`/api/admin/options${qs}`, "选项列表加载失败。");
}

export async function adminCreateOption(payload) {
  return postJson("/api/admin/options", payload, "新建选项失败。");
}

export async function adminUpdateOption(id, payload) {
  return putJson(`/api/admin/options/${id}`, payload, "更新选项失败。");
}

export async function adminDeleteOption(id) {
  return deleteJson(`/api/admin/options/${id}`, "删除选项失败。");
}
