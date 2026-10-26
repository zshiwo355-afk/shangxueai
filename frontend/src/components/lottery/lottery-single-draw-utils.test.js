import assert from "node:assert/strict";
import test from "node:test";
import { lotteryLinkProgressLabel, lotteryLinkRemaining, singleDrawLinkPayload } from "./lottery-single-draw-utils.js";

test("new links always submit one draw, independent of stale form values", () => {
  const original = Object.freeze({ campaign_id: 7, customer_name: "王先生", chance_total: 10 });
  assert.deepEqual(singleDrawLinkPayload(original), { ...original, chance_total: 1 });
  assert.equal(original.chance_total, 10);
  assert.equal(singleDrawLinkPayload({ campaign_id: 8 }).chance_total, 1);
});

test("current server remaining count overrides historical configured totals", () => {
  assert.equal(lotteryLinkRemaining({ chance_total: 10, chance_used: 2, remaining_chances: 0 }), 0);
  assert.equal(lotteryLinkRemaining({ chance_total: 10, chance_used: 0, remaining_chances: 1 }), 1);
  assert.equal(lotteryLinkRemaining({ chance_total: 10, chance_used: 0, remaining_chances: 0 }), 0);
  assert.equal(lotteryLinkRemaining({ remaining_chances: "1" }), 1);
});

test("older responses do not advertise more than one remaining attempt", () => {
  assert.equal(lotteryLinkRemaining({ chance_total: 10, chance_used: 0 }), 1);
  assert.equal(lotteryLinkRemaining({ chance_total: 10, chance_used: 2 }), 0);
  assert.equal(lotteryLinkRemaining({ chance_total: 1, chance_used: 0, remaining_chances: null }), 1);
  assert.equal(lotteryLinkRemaining({ remaining_chances: 10 }), 1);
  assert.equal(lotteryLinkRemaining({ remaining_chances: -1 }), 0);
  assert.equal(lotteryLinkRemaining(null), 0);
});

test("historical multi-draw records remain truthful without showing a 2/1 fraction", () => {
  assert.equal(lotteryLinkProgressLabel({ chance_total: 10, chance_used: 2, remaining_chances: 0 }), "已抽 2 次 · 当前剩余 0 次");
  assert.equal(lotteryLinkProgressLabel({ chance_total: 1, chance_used: 2, remaining_chances: 0 }), "已抽 2 次 · 当前剩余 0 次");
  assert.equal(lotteryLinkProgressLabel({ chance_total: 1, chance_used: 0, remaining_chances: 1 }), "共 1 次 · 已抽 0 次 · 剩余 1 次");
  assert.equal(lotteryLinkProgressLabel({ chance_total: 1, chance_used: 1, remaining_chances: 0 }), "共 1 次 · 已抽 1 次 · 剩余 0 次");
});
