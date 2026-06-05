import { getJson, postJson } from "./http";

export async function fetchGuideStatus() {
  return getJson("/api/newbie-guide/status", "新手引导状态加载失败。");
}

export async function completeGuide() {
  return postJson("/api/newbie-guide/complete", {}, "新手引导标记失败。");
}
