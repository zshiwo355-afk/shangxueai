export const LOTTERY_CHANCES_PER_LINK = 1;

export function singleDrawLinkPayload(values) {
  return { ...values, chance_total: LOTTERY_CHANCES_PER_LINK };
}

// The server applies the current rule without rewriting historical draw totals.
// Prefer its remaining count; an older response must never offer extra attempts.
export function lotteryLinkRemaining(row) {
  const remaining = row?.remaining_chances;
  if (remaining !== null && remaining !== undefined && remaining !== "" && Number.isFinite(Number(remaining))) {
    return Math.min(LOTTERY_CHANCES_PER_LINK, Math.max(0, Number(remaining)));
  }
  return Number(row?.chance_total) > 0 && Number(row?.chance_used || 0) === 0 ? 1 : 0;
}

export function lotteryLinkProgressLabel(row) {
  const used = Math.max(0, Number(row?.chance_used) || 0);
  const remaining = lotteryLinkRemaining(row);
  return used > 1 || Number(row?.chance_total) > 1
    ? `已抽 ${used} 次 · 当前剩余 ${remaining} 次`
    : `共 1 次 · 已抽 ${used} 次 · 剩余 ${remaining} 次`;
}
