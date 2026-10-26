import { probabilityPercentToPpm } from "./lottery-admin-utils.js";

export function prizeEditSnapshot(prize, campaign) {
  return {
    prize: prize ? { ...prize } : null,
    configVersion: Number(campaign.config_version || 1),
    published: campaign.status === "published",
  };
}

export function prizeEditPayload(values, { existing, published, configVersion }) {
  const payload = {
    name: values.name?.trim(),
    description: values.description || "",
    type: values.type,
    sort_order: values.sort_order ?? 0,
    stock_total: Number(values.stock_total),
    image_url: values.image_url || "",
    image_object_key: values.image_object_key || "",
    image_material_asset_id: values.image_material_asset_id ?? null,
  };
  if (existing) payload.config_version = configVersion;
  // Live metadata edits must never resubmit a stale probability or enabled state.
  if (!published || !existing) {
    const ppm = probabilityPercentToPpm(values.probability_percent);
    if (ppm === null) throw new Error("请输入 0–100 的概率，最多保留 4 位小数。");
    payload.probability_ppm = ppm;
    payload.enabled = values.enabled !== false;
  }
  return payload;
}
