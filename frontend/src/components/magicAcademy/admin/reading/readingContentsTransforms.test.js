import test from "node:test";
import assert from "node:assert/strict";

import { buildGroupedReadingContents } from "./readingContentsTransforms.js";

test("groups reading contents by series while preserving standalone items and aggregate fields", () => {
  const readingContents = [
    {
      id: 1,
      title: "独立内容",
      reading_date: "2026-06-01",
      push_count: 3,
      completed_count: 1,
      pending_count: 2,
      created_at: "2026-06-01T09:00:00",
      makeup_deadline_at: "2026-06-03T09:00:00",
    },
    {
      id: 2,
      series_id: 10,
      series_title: "六月系列",
      title: "系列内容 A",
      reading_date: "2026-06-02",
      push_count: 4,
      completed_count: 3,
      pending_count: 1,
      created_at: "2026-06-02T09:00:00",
      makeup_deadline_at: "2026-06-05T09:00:00",
      creator_name: "Alice",
    },
    {
      id: 3,
      series_id: 10,
      series_title: "六月系列",
      title: "系列内容 B",
      reading_date: "2026-06-03",
      push_count: 6,
      completed_count: 2,
      pending_count: 4,
      created_at: "2026-06-01T08:00:00",
      makeup_deadline_at: "2026-06-06T10:00:00",
      creator_name: "Bob",
    },
  ];

  const grouped = buildGroupedReadingContents(readingContents);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]._rowType, "content");
  assert.equal(grouped[0].id, 1);

  const seriesRow = grouped[1];
  assert.equal(seriesRow._rowType, "series");
  assert.equal(seriesRow.id, "series-10");
  assert.equal(seriesRow.series_id, 10);
  assert.equal(seriesRow.series_title, "六月系列");
  assert.equal(seriesRow.push_count, 10);
  assert.equal(seriesRow.completed_count, 5);
  assert.equal(seriesRow.pending_count, 5);
  assert.equal(seriesRow.completion_rate, 50);
  assert.equal(seriesRow.makeup_deadline_at, "2026-06-06T10:00:00");
  assert.equal(seriesRow.created_at, "2026-06-01T08:00:00");
  assert.equal(seriesRow.children.length, 2);
  assert.equal(seriesRow.children[0]._rowType, "content");
  assert.equal(seriesRow.children[0].id, 2);
  assert.equal(seriesRow.children[1].id, 3);
});
