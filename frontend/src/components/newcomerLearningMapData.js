const PREFERRED_SERIES_TITLES = ["新员工学习地图", "新人学习地图"];

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function getSeriesTitleRank(title) {
  const normalized = normalizeTitle(title);
  const exactIndex = PREFERRED_SERIES_TITLES.findIndex((item) => normalizeTitle(item) === normalized);
  if (exactIndex >= 0) return exactIndex;
  if (normalized.includes("新人") && normalized.includes("学习地图")) return PREFERRED_SERIES_TITLES.length;
  return Number.POSITIVE_INFINITY;
}

export function buildNewcomerLearningMap(videos) {
  const groups = new Map();

  (Array.isArray(videos) ? videos : []).forEach((item) => {
    if (!item?.series_id || !item?.series_title || item.series_enabled === false) return;
    const rank = getSeriesTitleRank(item.series_title);
    if (!Number.isFinite(rank)) return;

    const key = String(item.series_id);
    if (!groups.has(key)) {
      groups.set(key, {
        id: item.series_id,
        title: item.series_title,
        description: item.series_description || "",
        sequentialUnlockEnabled: !!item.sequential_unlock_enabled,
        rank,
        items: [],
      });
    }
    groups.get(key).items.push(item);
  });

  const series = Array.from(groups.values())
    .sort((left, right) => left.rank - right.rank || right.items.length - left.items.length)[0];
  if (!series) return null;

  series.items.sort((left, right) => (
    Number(left.series_order ?? Number.MAX_SAFE_INTEGER) - Number(right.series_order ?? Number.MAX_SAFE_INTEGER)
    || Number(left.id || 0) - Number(right.id || 0)
  ));
  return series;
}

