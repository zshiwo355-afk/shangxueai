export function campaignStatusLabel(item) {
  return {
    draft: "草稿", published: "进行中", not_started: "未开始", paused: "已暂停",
    ended: "已结束", deleted: "已删除 · 历史归档",
  }[item?.effective_status || item?.status] || "已发布";
}

export function campaignLabel(item) {
  return item ? `#${item.id} · ${item.title} · ${campaignStatusLabel(item)}` : "—";
}

export function campaignReadOnly(item) {
  return !item || !!item.deleted_at || item.can_create_links === false
    || ["draft", "paused", "ended", "deleted"].includes(item.effective_status || item.status);
}

export function findLotteryCampaign(campaigns, id) {
  return campaigns.find((item) => String(item.id) === String(id));
}

export function lotteryCampaignGroups(campaigns) {
  return {
    available: campaigns.filter((item) => !campaignReadOnly(item)),
    history: campaigns.filter(campaignReadOnly),
  };
}

// A refresh must not silently move the employee back to the newest activity.
export function retainedLotteryCampaignId(campaigns, current) {
  return findLotteryCampaign(campaigns, current)?.id
    ?? (campaigns.find((item) => !campaignReadOnly(item)) || campaigns[0])?.id;
}
