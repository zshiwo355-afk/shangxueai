import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAudioMakeupDateMap,
  getAudioCalendarCellState,
} from "./audioCalendarUtils.js";

test("hides status tags for dates outside the visible calendar month", () => {
  const state = getAudioCalendarCellState({
    dateText: "2026-06-30",
    monthText: "2026-07",
    dayData: undefined,
    todayText: "2026-07-02",
  });

  assert.equal(state.status, "outside_month");
  assert.equal(state.shouldRenderStatus, false);
  assert.equal(state.count, 0);
});

test("hides status tags until the selected month data has loaded", () => {
  const state = getAudioCalendarCellState({
    dateText: "2026-07-01",
    monthText: "2026-07",
    dayData: undefined,
    isMonthLoaded: false,
    todayText: "2026-07-02",
  });

  assert.equal(state.status, "loading");
  assert.equal(state.shouldRenderStatus, false);
});

test("resolves uploaded and makeup states only inside the selected month", () => {
  const uploaded = getAudioCalendarCellState({
    dateText: "2026-07-01",
    monthText: "2026-07",
    dayData: { uploaded: true, count: 2 },
    todayText: "2026-07-02",
  });

  assert.equal(uploaded.status, "uploaded");
  assert.equal(uploaded.shouldRenderStatus, true);
  assert.equal(uploaded.count, 2);

  const makeupByDate = buildAudioMakeupDateMap([
    { reading_content_id: 1, date: "2026-07-01", can_makeup: false, is_expired: false },
    { reading_content_id: 2, date: "2026-07-01", can_makeup: true, is_expired: false },
  ]);
  const makeup = getAudioCalendarCellState({
    dateText: "2026-07-01",
    monthText: "2026-07",
    dayData: { uploaded: false, count: 0 },
    makeupData: makeupByDate["2026-07-01"],
    todayText: "2026-07-02",
  });

  assert.equal(makeup.status, "makeup_available");
  assert.equal(makeup.shouldRenderStatus, true);
});
