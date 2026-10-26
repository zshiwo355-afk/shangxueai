// Use decimal strings so the editor validates the same integer ppm total as the API.
export function probabilityPercentToPpm(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const ppm = Number(whole) * 10000 + Number(fraction.padEnd(4, "0"));
  return Number.isSafeInteger(ppm) && ppm >= 0 && ppm <= 1_000_000 ? ppm : null;
}

export function preferredCampaignId(campaigns, currentId, preferredId) {
  const find = (id) => campaigns.find((campaign) => String(campaign.id) === String(id))?.id;
  return find(preferredId) ?? find(currentId) ?? campaigns[0]?.id;
}

export function claimEditableStatuses(status) {
  const statuses = status === "pending" ? ["pending", "contacted", "fulfilled", "cancelled"]
    : status === "contacted" ? ["contacted", "fulfilled", "cancelled"] : [];
  return statuses;
}

export function hasClaimReceipt(claim) {
  return [claim?.recipient_name, claim?.recipient_phone, claim?.recipient_address]
    .every((value) => typeof value === "string" && value.trim().length > 0);
}

export function lotteryPrizeConfig(rows) {
  const active = rows.filter((row) => row.enabled !== false && !row.deleted_at);
  const totalPpm = active.reduce((sum, row) => sum + Number(row.probability_ppm || 0), 0);
  const legacyCount = active.filter((row) => row.type === "no_win").length;
  const stockReady = active.some((row) => ["physical", "coupon"].includes(row.type)
    && Number(row.probability_ppm) > 0 && Number(row.stock_total || 0) > Number(row.stock_awarded || 0));
  return {
    active, totalPpm, legacyCount, stockReady,
    ready: active.length >= 1 && active.length <= 12 && legacyCount === 0
      && active.every((row) => ["physical", "coupon"].includes(row.type))
      && active.every((row) => Number.isInteger(row.probability_ppm) && row.probability_ppm >= 0 && row.probability_ppm <= 1_000_000)
      && active.every((row) => Number(row.stock_total || 0) >= Number(row.stock_awarded || 0))
      && totalPpm === 1_000_000 && stockReady,
  };
}

export function claimLinkRecord(claim) {
  if (!claim?.invite_link_id) return null;
  return {
    id: claim.invite_link_id,
    campaign_id: claim.campaign_id,
    customer_name: claim.customer_name,
    customer_code: claim.customer_code,
    created_by_user_id: claim.created_by_user_id,
    created_by_name: claim.created_by_name,
    chance_total: claim.chance_total,
    chance_used: claim.chance_used,
    remaining_chances: claim.remaining_chances,
  };
}
