/** 后台积分管理 API：规则 / 流水 / 排行 / 手动调分。 */
import { deleteJson, getJson, postJson, putJson } from "./http";

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    search.set(k, String(v));
  });
  const s = search.toString();
  return s ? `?${s}` : "";
}

export async function adminListPointRules() {
  return getJson("/api/admin/points/rules", "积分规则加载失败。");
}

export async function adminUpdatePointRule(id, payload) {
  return putJson(`/api/admin/points/rules/${id}`, payload, "更新规则失败。");
}

export async function adminListPointTransactions(params) {
  return getJson(`/api/admin/points/transactions${buildQuery(params)}`, "积分流水加载失败。");
}

export async function adminManualAdjustPoints(payload) {
  return postJson("/api/admin/points/manual-adjust", payload, "手动调分失败。");
}

export async function adminPointLeaderboard(params) {
  return getJson(`/api/admin/points/leaderboard${buildQuery(params)}`, "排行榜加载失败。");
}

export async function adminListDepartments() {
  return getJson("/api/admin/points/departments", "部门列表加载失败。");
}

export async function adminGetUserPointSummary(userId) {
  return getJson(`/api/admin/points/users/${userId}/summary`, "用户积分摘要加载失败。");
}
