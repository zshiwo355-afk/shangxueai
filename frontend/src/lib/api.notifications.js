/** 推送监控 API：notification_logs 列表 / 详情 / 概览 / 事件类型选项。 */
import { getJson, postJson } from "./http";

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

export async function adminListNotifications(params = {}) {
  return getJson(`/api/admin/notifications${toQs(params)}`, "推送记录加载失败。");
}

export async function adminGetNotificationStats() {
  return getJson("/api/admin/notifications/stats", "推送概览加载失败。");
}

export async function adminListNotificationEventTypes() {
  return getJson("/api/admin/notifications/event-types", "事件类型加载失败。");
}

export async function adminGetNotificationDetail(id) {
  return getJson(`/api/admin/notifications/${id}`, "推送详情加载失败。");
}

export async function adminBulkDeleteNotifications(ids) {
  return postJson("/api/admin/notifications/bulk-delete", { ids }, "批量删除推送记录失败。");
}

export async function adminResendNotification(id) {
  return postJson(`/api/admin/notifications/${id}/resend`, {}, "重推失败。");
}

export async function adminBulkResendNotifications(ids) {
  return postJson("/api/admin/notifications/bulk-resend", { ids }, "批量重推失败。");
}
