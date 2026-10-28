import { getJson, parseJsonResponse, postJson, putJson, safeFetch, throwRequestError } from "./http";
import { buildApiUrl } from "./runtimeConfig";

function query(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  return search.size ? `?${search}` : "";
}

export const fetchMallSummary = () => getJson("/api/mall/summary", "商城积分加载失败。");
export const fetchMallLeaderboard = () => getJson("/api/mall/leaderboard", "积分排行榜加载失败。");
export const fetchMallProducts = (params) => getJson(`/api/mall/products${query(params)}`, "商品加载失败。");
export const createMallRedemption = (payload) => postJson("/api/mall/redemptions", payload, "兑换失败。");
export const fetchMyMallRedemptions = (params) => getJson(`/api/mall/redemptions${query(params)}`, "兑换记录加载失败。");
export const fetchMallDanmaku = () => getJson("/api/mall/danmaku", "弹幕暂时无法加载。");
export const sendMallDanmaku = (content) => postJson("/api/mall/danmaku", { content }, "弹幕发送失败，请重试。");

export const fetchAdminMallSummary = (id) => getJson(`/api/admin/mall/users/${id}/summary`, "员工商城积分加载失败。");
export const fetchAdminMallGrants = (params) => getJson(`/api/admin/mall/grants${query(params)}`, "积分发放记录加载失败。");
export const grantMallPoints = (payload) => postJson("/api/admin/mall/grants", payload, "积分发放失败。");
export const fetchAdminMallProducts = (params) => getJson(`/api/admin/mall/products${query(params)}`, "商品加载失败。");
export const createAdminMallProduct = (payload) => postJson("/api/admin/mall/products", payload, "商品保存失败。");
export const updateAdminMallProduct = (id, payload) => putJson(`/api/admin/mall/products/${id}`, payload, "商品保存失败。");
export const fetchAdminMallRedemptions = (params) => getJson(`/api/admin/mall/redemptions${query(params)}`, "兑换记录加载失败。");
export const verifyMallRedemption = (id) => postJson(`/api/admin/mall/redemptions/${id}/verify`, {}, "领取核销失败。");

export async function uploadAdminMallImage(file) {
  const body = new FormData();
  body.append("file", file);
  const response = await safeFetch(buildApiUrl("/api/admin/mall/images"), {
    method: "POST", body,
  }, "商品图片上传失败。");
  if (!response.ok) await throwRequestError(response, "商品图片上传失败。");
  return parseJsonResponse(response, "商品图片上传失败。");
}
