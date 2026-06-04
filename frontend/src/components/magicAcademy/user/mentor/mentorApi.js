import { getJson } from "../../../../lib/http";

export async function fetchEnabledMentors() {
  const list = await getJson("/api/mentors", "导师列表加载失败。");
  return Array.isArray(list) ? list : [];
}
