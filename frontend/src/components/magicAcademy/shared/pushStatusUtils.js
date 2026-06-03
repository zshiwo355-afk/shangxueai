export function getPushStatusMeta(status) {
  if (status === "sent") return { label: "已推送", color: "success" };
  if (status === "partial") return { label: "部分成功", color: "warning" };
  if (status === "failed") return { label: "推送失败", color: "error" };
  if (status === "pending") return { label: "待推送", color: "default" };
  if (status === "running") return { label: "推送中", color: "processing" };
  return { label: "未推送", color: "default" };
}

export function getPushSummaryText(summary) {
  if (!summary) return "暂无记录";
  return `成功 ${summary.success_count || 0} / 失败 ${summary.failed_count || 0} / 跳过 ${summary.skipped_count || 0}`;
}

export function getPushLatestTime(summary) {
  return summary?.finished_at || summary?.started_at || summary?.created_at || "";
}

export function formatPushLatestTime(summary) {
  const latestTime = getPushLatestTime(summary);
  return latestTime ? latestTime.replace("T", " ").slice(0, 19) : "—";
}

export function isPushRetryDisabled(summary) {
  return summary?.status === "running" || summary?.status === "pending";
}
