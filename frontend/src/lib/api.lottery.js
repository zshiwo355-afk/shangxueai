import { getJson, postJson } from "./http";

function encodeCode(code) {
  return encodeURIComponent(String(code || "").trim());
}

export async function getPublicLottery(code, { signal } = {}) {
  return getJson(
    `/api/public/lottery/${encodeCode(code)}`,
    "抽奖活动加载失败。",
    { signal },
  );
}

export async function getPublicLotteryShareConfig(code, url = "") {
  const search = new URLSearchParams();
  if (url) search.set("url", url);
  const query = search.toString();
  return getJson(
    `/api/public/lottery/${encodeCode(code)}/share-config${query ? `?${query}` : ""}`,
    "分享配置加载失败。",
  );
}

export async function getPublicLotteryDraws(code, { page = 1, pageSize = 10, signal } = {}) {
  const search = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return getJson(
    `/api/public/lottery/${encodeCode(code)}/draws?${search}`,
    "抽奖记录加载失败。",
    { signal },
  );
}

export async function getPublicLotteryWinners(code, { signal } = {}) {
  return getJson(
    `/api/public/lottery/${encodeCode(code)}/winners`,
    "中奖动态暂未同步。",
    { signal },
  );
}

export async function drawPublicLottery(code, requestId, expectedSequence) {
  return postJson(
    `/api/public/lottery/${encodeCode(code)}/draw`,
    { request_id: requestId, expected_draw_sequence: expectedSequence },
    "抽奖失败，请稍后重试。",
  );
}

export async function claimPublicLotteryPrize(code, drawId, payload) {
  return postJson(
    `/api/public/lottery/${encodeCode(code)}/draws/${encodeURIComponent(drawId)}/claim`,
    payload,
    "领奖信息提交失败。",
  );
}

export async function submitPublicLotteryReceipt(code, payload) {
  return postJson(
    `/api/public/lottery/${encodeCode(code)}/receipt`,
    payload,
    "收货信息提交失败，请稍后重试。",
  );
}
