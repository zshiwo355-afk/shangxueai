const ACTIVE_CAMPAIGN_STATUSES = new Set(["published", "active", "ongoing"]);

export function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeLottery(data) {
  const campaign = data?.campaign || {};
  const link = data?.link || {};
  const chanceTotal = asNumber(link.chance_total ?? link.total_chances ?? data?.chance_total);
  const chanceUsed = Math.max(0, asNumber(link.chance_used ?? link.used_chances ?? data?.chance_used));
  // Historical totals remain available for audit only. They must never revive
  // a used link after switching to the one-draw-per-link rule.
  const chanceLimit = 1;
  const effectiveRemaining = Math.max(0, chanceLimit - chanceUsed);
  return {
    campaign,
    link: {
      ...link,
      chance_total: chanceTotal,
      chance_used: chanceUsed,
      chance_limit: chanceLimit,
      remaining_chances: Math.min(effectiveRemaining, Math.max(0, asNumber(
        link.remaining_chances ?? data?.remaining_chances,
        effectiveRemaining,
      ))),
    },
    prizes: Array.isArray(data?.prizes) ? data.prizes : [],
    recent_draws: Array.isArray(data?.recent_draws) ? data.recent_draws : [],
    share: data?.share || {},
    receipt: normalizeReceipt(data?.receipt),
    winning_summary: normalizeWinningSummary(data?.winning_summary),
  };
}

export function normalizeReceipt(receipt) {
  const submitted = receipt?.submitted === true;
  return {
    submitted,
    manual_redemption: true,
    required: false,
    can_submit: false,
    win_count: Math.max(0, Math.trunc(asNumber(receipt?.win_count))),
  };
}

export function getRedemptionDisplayState(lottery, { spinning = false, resultOpen = false, pendingRequest = false } = {}) {
  if (spinning || resultOpen || pendingRequest) return "hidden";
  if (asNumber(lottery?.link?.chance_used) > 0 && asNumber(lottery?.link?.remaining_chances) <= 0) return "complete";
  return asNumber(lottery?.winning_summary?.total_wins) > 0 ? "progress" : "hidden";
}

export function getPublicHistoryDisplayState({ busy = false, error = "" } = {}) {
  // Even a committed server result must stay concealed until the wheel lands.
  if (busy) return "drawing";
  return error ? "error" : "records";
}

export function normalizeWinningSummary(summary) {
  if (!Array.isArray(summary?.items)) return null;
  if (summary.items.some((item) => !item || typeof item !== "object")) return null;
  const total = Number(summary.total_wins);
  if (!Number.isInteger(total) || total < 0) return null;
  const items = summary.items.map((item) => ({
    prize_id: item.prize_id ?? null,
    prize_name: String(item.prize_name || "幸运好礼"),
    prize_image_url: String(item.prize_image_url || ""),
    quantity: Number(item.quantity),
  }));
  if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) return null;
  if (items.reduce((sum, item) => sum + item.quantity, 0) !== total) return null;
  // Never reconstruct a complete summary from the limited recovery snapshot.
  return { items, total_wins: total };
}

export function getPublicPrizeDisplay(prizes) {
  return (Array.isArray(prizes) ? prizes : []).filter((prize) => prize.type !== "no_win");
}

export function shouldAutoplayPrizes({ count, reducedMotion = false, paused = false, interacting = false, hidden = false }) {
  return count > 1 && !reducedMotion && !paused && !interacting && !hidden;
}

export function shouldRefreshPublicWinners({ busy = false, hidden = false } = {}) {
  return !busy && !hidden;
}

export function normalizePublicWinners(data) {
  if (!Array.isArray(data?.items)) throw new Error("中奖动态返回异常");
  const seen = new Set();
  return data.items.filter((item) => {
    if (!item || item.id == null || !String(item.id).trim() || typeof item.prize_name !== "string" || !item.prize_name.trim()) return false;
    const key = String(item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30).map((item) => ({
    id: String(item.id),
    // Names are anonymized by the server. Do not fall back to customer_name,
    // employee notes, profile URLs or any other private fields.
    display_name: typeof item.display_name === "string" && item.display_name.trim() ? item.display_name.trim().slice(0, 16) : "幸运客户",
    prize_name: item.prize_name.trim(),
    created_at: typeof item.created_at === "string" ? item.created_at : "",
  }));
}

export function groupPublicWinners(items, pageSize = 3) {
  const size = Math.max(1, Math.floor(asNumber(pageSize, 3)));
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

// This is only an in-flight request identity. Counts, results and configuration
// always come from the server; no browser storage is involved.
export function createPendingDrawTracker(createRequestId) {
  const pendingByCode = new Map();
  return {
    getOrCreate(code, chanceUsed) {
      if (!pendingByCode.has(code)) {
        pendingByCode.set(code, Object.freeze({
          requestId: createRequestId(),
          expectedSequence: Math.max(0, asNumber(chanceUsed)) + 1,
        }));
      }
      return pendingByCode.get(code);
    },
    peek(code) { return pendingByCode.get(code); },
    clear(code, requestId) {
      if (pendingByCode.get(code)?.requestId === requestId) pendingByCode.delete(code);
    },
  };
}

export function findConfirmedPendingDraw(lottery, pending) {
  if (!pending) return null;
  return lottery?.recent_draws?.find(
    (draw) => Number(draw.draw_sequence) === pending.expectedSequence,
  ) || null;
}

export function mergeDrawSnapshot(current, response, draw) {
  const history = Array.isArray(response?.recent_draws) ? response.recent_draws : current?.recent_draws || [];
  return normalizeLottery({
    ...current,
    ...response,
    campaign: response?.campaign || current?.campaign,
    prizes: Array.isArray(response?.prizes) ? response.prizes : current?.prizes,
    winning_summary: response?.winning_summary ?? null,
    link: { ...current?.link, ...response?.link },
    // Never decrement a count in the browser, including an idempotent replay.
    recent_draws: [draw, ...history.filter((item) => item.id !== draw.id)]
      .sort((left, right) => asNumber(right.draw_sequence) - asNumber(left.draw_sequence))
      .slice(0, 20),
  });
}

export function getWheelTargetRotation(prizes, draw, previousRotation, reducedMotion = false) {
  if (draw?.prize_id == null) return null;
  const winningIndex = prizes.findIndex((item) => String(item.id) === String(draw?.prize_id));
  // An old result may refer to a prize no longer in the current configuration.
  // Show that authoritative result directly, never land on an unrelated sector.
  if (winningIndex < 0) return null;
  const normalized = ((previousRotation % 360) + 360) % 360;
  const target = (360 - (winningIndex + 0.5) * (360 / prizes.length) + 360) % 360;
  return previousRotation + (reducedMotion ? 0 : 6 * 360) + (target - normalized + 360) % 360;
}

export function isAmbiguousDrawError(error, alreadyUncertain = false) {
  // A rejection of a retry does not prove the original lost response failed.
  return alreadyUncertain || !error?.status || error.status >= 500 || [408, 429].includes(error.status) ||
    error.code === "BAD_RESPONSE" || error.code === "REQUEST_ABORTED";
}

function formatCountdown(value, now) {
  const diff = new Date(value).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) return "正在同步活动状态，请稍候。";
  const totalMinutes = Math.ceil(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days} 天 ${hours} 小时后开始`;
  if (hours) return `${hours} 小时 ${minutes} 分后开始`;
  return `${Math.max(1, minutes)} 分钟后开始`;
}

export function getCampaignState(lottery, now) {
  const campaign = lottery?.campaign || {};
  const link = lottery?.link || {};
  const status = String(campaign.status || "published").toLowerCase();
  const linkStatus = String(link.status || "active").toLowerCase();
  const startTime = campaign.start_at ? new Date(campaign.start_at).getTime() : 0;
  const endTime = campaign.end_at ? new Date(campaign.end_at).getTime() : 0;
  const expiresTime = link.expires_at ? new Date(link.expires_at).getTime() : 0;

  if (linkStatus && linkStatus !== "active") {
    return { key: "link_disabled", title: "这张抽奖卡已停用", detail: "请联系发送给你的工作人员确认。" };
  }
  if (expiresTime && expiresTime <= now) {
    return { key: "link_expired", title: "这张抽奖卡已过期", detail: "请联系发送给你的工作人员。" };
  }
  if (status === "paused") {
    return { key: "paused", title: "活动暂时休息一下", detail: "稍后回来，剩余抽奖机会会为你保留。" };
  }
  if (["ended", "closed"].includes(status) || (endTime && endTime <= now)) {
    return { key: "ended", title: "活动已经结束", detail: "感谢参与，祝你生活愉快。" };
  }
  if (["draft", "unpublished", "not_started"].includes(status) || (startTime && startTime > now)) {
    return {
      key: "not_started",
      title: "好礼正在准备中",
      detail: startTime ? formatCountdown(campaign.start_at, now) : "活动尚未开始，请稍后再来。",
    };
  }
  if (status && !ACTIVE_CAMPAIGN_STATUSES.has(status)) {
    return { key: "unavailable", title: "活动暂不可用", detail: "请稍后再试。" };
  }
  if (asNumber(link.remaining_chances) <= 0) {
    return { key: "exhausted", title: "抽奖已完成", detail: "请截图中奖信息，联系销售人员兑奖。完整记录保留在下方。" };
  }
  return { key: "active", title: "点击抽奖", detail: "好运正在等你" };
}

export function getNextLotteryRefreshDelay(lottery, now) {
  const futureBoundaries = [lottery?.campaign?.start_at, lottery?.campaign?.end_at, lottery?.link?.expires_at]
    .filter(Boolean)
    .map((value) => new Date(value).getTime() - now)
    .filter((delay) => Number.isFinite(delay) && delay > 0);
  // Check just after boundaries and at most every 30 seconds while visible.
  return Math.min(30000, ...futureBoundaries.map((delay) => delay + 100));
}
