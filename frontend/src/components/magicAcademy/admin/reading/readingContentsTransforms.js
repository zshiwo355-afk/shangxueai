export function buildGroupedReadingContents(readingContents = []) {
  const rows = [];
  const seriesRowsMap = new Map();

  for (const item of readingContents) {
    if (!item.series_id) {
      rows.push({ ...item, _rowType: "content" });
      continue;
    }
    const groupKey = `series-${item.series_id}`;
    let seriesRow = seriesRowsMap.get(groupKey);
    if (!seriesRow) {
      seriesRow = {
        id: groupKey,
        _rowType: "series",
        series_id: item.series_id,
        series_title: item.series_title || "未命名系列",
        title: item.series_title || "未命名系列",
        reading_date: "",
        push_at: "",
        push_count: 0,
        completed_count: 0,
        pending_count: 0,
        completion_rate: 0,
        makeup_deadline_at: "",
        creator_name: item.creator_name || "",
        created_at: item.created_at || "",
        children: [],
      };
      seriesRowsMap.set(groupKey, seriesRow);
      rows.push(seriesRow);
    }
    seriesRow.children.push({ ...item, _rowType: "content" });
    seriesRow.push_count += Number(item.push_count || 0);
    seriesRow.completed_count += Number(item.completed_count || 0);
    seriesRow.pending_count += Number(item.pending_count || 0);
    if (!seriesRow.makeup_deadline_at || (item.makeup_deadline_at && item.makeup_deadline_at > seriesRow.makeup_deadline_at)) {
      seriesRow.makeup_deadline_at = item.makeup_deadline_at || seriesRow.makeup_deadline_at;
    }
    if (!seriesRow.created_at || (item.created_at && item.created_at < seriesRow.created_at)) {
      seriesRow.created_at = item.created_at || seriesRow.created_at;
    }
  }

  for (const row of rows) {
    if (row._rowType !== "series") continue;
    const total = Number(row.push_count || 0);
    const completed = Number(row.completed_count || 0);
    row.completion_rate = total ? Number(((completed / total) * 100).toFixed(2)) : 0;
  }

  return rows;
}
