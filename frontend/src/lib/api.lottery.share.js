import { postJson } from "./http";

export function createLotteryShareSession(linkId) {
  return postJson(`/api/lottery/links/${linkId}/share-session`, {}, "员工分享二维码生成失败。");
}

export function resolveLotterySharePreview(ticket, url) {
  return postJson("/api/public/lottery/share-preview", { ticket, url }, "员工分享入口已失效，请重新生成二维码。");
}

export function getLotteryDirectShareConfig(linkId, url) {
  return postJson(`/api/lottery/links/${linkId}/share-config`, { url }, "客户卡片准备失败。");
}
