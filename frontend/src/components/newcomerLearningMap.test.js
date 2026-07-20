import assert from "node:assert/strict";
import test from "node:test";

import { buildNewcomerLearningMap } from "./newcomerLearningMapData.js";

test("buildNewcomerLearningMap selects the configured newcomer series and sorts its lessons", () => {
  const result = buildNewcomerLearningMap([
    { id: 7, series_id: 2, series_title: "其他系列", series_order: 10 },
    { id: 2, series_id: 3, series_title: "新员工学习地图", series_order: 20, series_enabled: true },
    { id: 1, series_id: 3, series_title: "新员工学习地图", series_order: 10, series_enabled: true },
  ]);

  assert.equal(result.id, 3);
  assert.deepEqual(result.items.map((item) => item.id), [1, 2]);
});

test("buildNewcomerLearningMap supports the shorter newcomer map title", () => {
  const result = buildNewcomerLearningMap([
    { id: 1, series_id: 5, series_title: "新人学习地图", series_order: 10 },
  ]);

  assert.equal(result?.id, 5);
});
