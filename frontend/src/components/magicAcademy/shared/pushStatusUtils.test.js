import test from "node:test";
import assert from "node:assert/strict";

import {
  formatPushLatestTime,
  getPushStatusMeta,
  getPushSummaryText,
  isPushRetryDisabled,
} from "./pushStatusUtils.js";

test("maps push status labels and colors without changing business wording", () => {
  assert.deepEqual(getPushStatusMeta("sent"), { label: "已推送", color: "success" });
  assert.deepEqual(getPushStatusMeta("partial"), { label: "部分成功", color: "warning" });
  assert.deepEqual(getPushStatusMeta("failed"), { label: "推送失败", color: "error" });
  assert.deepEqual(getPushStatusMeta("pending"), { label: "待推送", color: "default" });
  assert.deepEqual(getPushStatusMeta("running"), { label: "推送中", color: "processing" });
  assert.deepEqual(getPushStatusMeta("unknown"), { label: "未推送", color: "default" });
});

test("keeps push summary text, latest time formatting, and retry disable rules unchanged", () => {
  const summary = {
    status: "running",
    success_count: 3,
    failed_count: 1,
    skipped_count: 2,
    finished_at: "",
    started_at: "2026-06-02T10:20:30",
    created_at: "2026-06-02T09:00:00",
  };

  assert.equal(getPushSummaryText(summary), "成功 3 / 失败 1 / 跳过 2");
  assert.equal(getPushSummaryText(null), "暂无记录");
  assert.equal(formatPushLatestTime(summary), "2026-06-02 10:20:30");
  assert.equal(formatPushLatestTime(null), "—");
  assert.equal(isPushRetryDisabled(summary), true);
  assert.equal(isPushRetryDisabled({ status: "pending" }), true);
  assert.equal(isPushRetryDisabled({ status: "sent" }), false);
});
