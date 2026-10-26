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
import { buildApiUrl } from "./runtimeConfig";

function authHeaders(extra = {}) {
  const headers = new Headers(extra);
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function toQs(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

// Employee workspace -------------------------------------------------------

export function listEmployeeLotteryCampaigns() {
  return getJson("/api/lottery/campaigns", "可用抽奖活动加载失败。");
}

export function listEmployeeLotteryLinks(params = {}) {
  return getJson(`/api/lottery/links${toQs(params)}`, "客户专属链接加载失败。");
}

export function createEmployeeLotteryLink(payload) {
  return postJson("/api/lottery/links", payload, "生成客户专属链接失败。");
}

export function getEmployeeLotteryLink(id) {
  return getJson(`/api/lottery/links/${id}`, "专属链接详情加载失败。");
}

export function actOnEmployeeLotteryLink(id, payload) {
  return postJson(`/api/lottery/links/${id}/actions`, payload, "专属链接操作失败。");
}

export function listEmployeeLotteryLinkActions(id, params = {}) {
  return getJson(`/api/lottery/links/${id}/actions${toQs(params)}`, "链接操作记录加载失败。");
}

export function listEmployeeLotteryLinkDraws(id, params = {}) {
  return getJson(`/api/lottery/links/${id}/draws${toQs(params)}`, "抽奖记录加载失败。");
}

// Admin console ------------------------------------------------------------

export function listAdminLotteryCampaigns(params = {}) {
  return getJson(`/api/admin/lottery/campaigns${toQs(params)}`, "抽奖活动加载失败。");
}

export function getAdminLotteryCampaign(id) {
  return getJson(`/api/admin/lottery/campaigns/${id}`, "抽奖活动详情加载失败。");
}

export function createAdminLotteryCampaign(payload) {
  return postJson("/api/admin/lottery/campaigns", payload, "创建抽奖活动失败。");
}

export function updateAdminLotteryCampaign(id, payload) {
  return putJson(`/api/admin/lottery/campaigns/${id}`, payload, "更新抽奖活动失败。");
}

export function deleteAdminLotteryCampaign(id) {
  return deleteJson(`/api/admin/lottery/campaigns/${id}`, "删除抽奖活动失败。");
}

export function updateAdminLotteryProbabilities(campaignId, payload) {
  return putJson(`/api/admin/lottery/campaigns/${campaignId}/probabilities`, payload, "活动概率更新失败。");
}

export function changeAdminLotteryCampaignStatus(id, status) {
  return postJson(`/api/admin/lottery/campaigns/${id}/status`, { status }, "活动状态更新失败。");
}

export async function uploadAdminLotteryImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await safeFetch(
    buildApiUrl("/api/admin/lottery/upload-image"),
    { method: "POST", headers: authHeaders(), body: formData },
    "图片上传失败。",
  );
  if (!response.ok) await throwRequestError(response, "图片上传失败。");
  return parseJsonResponse(response, "图片上传失败。");
}

export function listAdminLotteryPrizes(campaignId) {
  return getJson(`/api/admin/lottery/campaigns/${campaignId}/prizes`, "奖品配置加载失败。");
}

export function createAdminLotteryPrize(campaignId, payload) {
  return postJson(`/api/admin/lottery/campaigns/${campaignId}/prizes`, payload, "新增奖品失败。");
}

export function updateAdminLotteryPrize(id, payload) {
  return putJson(`/api/admin/lottery/prizes/${id}`, payload, "更新奖品失败。");
}

export function changeAdminLotteryPrizeStatus(id, enabled) {
  return postJson(`/api/admin/lottery/prizes/${id}/status`, { enabled }, "奖品状态更新失败。");
}

export function deleteAdminLotteryPrize(id) {
  return deleteJson(`/api/admin/lottery/prizes/${id}`, "删除奖品失败。");
}

export function listAdminLotteryStaff(campaignId) {
  return getJson(`/api/admin/lottery/campaigns/${campaignId}/staff`, "活动员工权限加载失败。");
}

export function saveAdminLotteryStaff(campaignId, assignments) {
  return putJson(
    `/api/admin/lottery/campaigns/${campaignId}/staff`,
    { assignments },
    "活动员工权限保存失败。",
  );
}

export function listAdminLotteryLinks(params = {}) {
  return getJson(`/api/admin/lottery/links${toQs(params)}`, "客户专属链接加载失败。");
}

export function actOnAdminLotteryLink(id, payload) {
  return postJson(`/api/admin/lottery/links/${id}/actions`, payload, "专属链接操作失败。");
}

export function listAdminLotteryLinkActions(id, params = {}) {
  return getJson(`/api/admin/lottery/links/${id}/actions${toQs(params)}`, "链接操作记录加载失败。");
}

export function listAdminLotteryDraws(params = {}) {
  return getJson(`/api/admin/lottery/draws${toQs(params)}`, "抽奖记录加载失败。");
}

export function listAdminLotteryClaims(params = {}) {
  return getJson(`/api/admin/lottery/claims${toQs(params)}`, "领奖记录加载失败。");
}

export function changeAdminLotteryClaimStatus(id, payload) {
  return postJson(`/api/admin/lottery/claims/${id}/status`, payload, "领奖状态更新失败。");
}

export function listAdminLotteryAuditLogs(params = {}) {
  return getJson(`/api/admin/lottery/audit-logs${toQs(params)}`, "活动审计记录加载失败。");
}

export function lotteryPublicUrl(publicCode) {
  if (!publicCode) return "";
  return `${window.location.origin}/lottery/${encodeURIComponent(publicCode)}`;
}

export function lotteryShareUrl(publicCode) {
  if (!publicCode) return "";
  return `${window.location.origin}/share/lottery/${encodeURIComponent(publicCode)}`;
}
