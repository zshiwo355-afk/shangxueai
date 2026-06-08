/** 后台数据看板 API。 */
import { getJson } from "./http";

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    search.set(k, String(v));
  });
  const s = search.toString();
  return s ? `?${s}` : "";
}

export async function fetchDashboardKpi() {
  return getJson("/api/admin/dashboard/kpi", "看板 KPI 加载失败。");
}

export async function fetchDashboardTrend(metric, days = 30) {
  return getJson(
    `/api/admin/dashboard/trend${buildQuery({ metric, days })}`,
    "趋势加载失败。",
  );
}

export async function fetchDashboardDepartmentStats(days = 30) {
  return getJson(
    `/api/admin/dashboard/department-stats${buildQuery({ days })}`,
    "部门统计加载失败。",
  );
}

export async function fetchDashboardPendingTasks() {
  return getJson(
    "/api/admin/dashboard/pending-tasks",
    "待办加载失败。",
  );
}

export async function fetchDashboardLeaderboardPreview(limit = 10) {
  return getJson(
    `/api/admin/dashboard/leaderboard-preview${buildQuery({ limit })}`,
    "排行预览加载失败。",
  );
}

export async function fetchDashboardPointsBreakdown(params = {}) {
  return getJson(
    `/api/admin/dashboard/points-breakdown${buildQuery(params)}`,
    "积分构成加载失败。",
  );
}
