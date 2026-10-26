import assert from "node:assert/strict";
import test from "node:test";
import { claimEditableStatuses, claimLinkRecord, hasClaimReceipt, lotteryPrizeConfig, preferredCampaignId, probabilityPercentToPpm } from "./lottery-admin-utils.js";

test("probability percentages convert exactly to integer ppm", () => {
  assert.equal(probabilityPercentToPpm("0.0001"), 1);
  assert.equal(probabilityPercentToPpm("1"), 10000);
  assert.equal(probabilityPercentToPpm("88.1234"), 881234);
  assert.equal(probabilityPercentToPpm(0), 0);
  assert.equal(probabilityPercentToPpm(100), 1000000);
  assert.equal(["0.1", "0.2", "99.7"].reduce((sum, value) => sum + probabilityPercentToPpm(value), 0), 1000000);
});

test("invalid or overprecision values cannot be silently treated as zero", () => {
  for (const value of [null, undefined, "", " ", "-1", "100.0001", "0.00001", "abc", "1e2", Infinity, NaN]) {
    assert.equal(probabilityPercentToPpm(value), null, String(value));
  }
});

test("campaign selection keeps exact ID and falls back after deletion", () => {
  const campaigns = [{ id: 5, title: "同名活动" }, { id: 8, title: "同名活动" }];
  assert.equal(preferredCampaignId(campaigns, 5, "8"), 8);
  assert.equal(preferredCampaignId(campaigns, 8, 999), 8);
  assert.equal(preferredCampaignId(campaigns, 999), 5);
  assert.equal(preferredCampaignId([], 5), undefined);
});

test("claim progress never moves backwards and terminal records are read-only", () => {
  assert.deepEqual(claimEditableStatuses("pending"), ["pending", "contacted", "fulfilled", "cancelled"]);
  assert.deepEqual(claimEditableStatuses("contacted"), ["contacted", "fulfilled", "cancelled"]);
  for (const status of ["fulfilled", "cancelled", "unknown", undefined]) {
    assert.deepEqual(claimEditableStatuses(status), []);
  }
});

test("related claim history uses the invite link ID, never the claim ID", () => {
  const record = claimLinkRecord({ id: 13, invite_link_id: 7, campaign_id: 4, customer_code: "C-1", created_by_user_id: 8 });
  assert.equal(record.id, 7);
  assert.equal(record.campaign_id, 4);
  assert.equal(record.customer_code, "C-1");
  assert.equal(record.created_by_user_id, 8);
  assert.equal(record.chance_total, undefined);
  assert.equal(claimLinkRecord({ id: 13 }), null);
});

test("a single stocked real prize can publish without a no-win fallback", () => {
  const prize = { id: 1, type: "physical", enabled: true, probability_ppm: 1_000_000, stock_total: 5, stock_awarded: 0 };
  assert.equal(lotteryPrizeConfig([prize]).ready, true);
  assert.equal(lotteryPrizeConfig([]).ready, false);
  assert.equal(lotteryPrizeConfig(Array.from({ length: 13 }, () => ({ ...prize, probability_ppm: 0 }))).ready, false);
});

test("legacy no-win prizes require an explicit operator change; values are never rewritten", () => {
  const prizes = [
    { id: 1, type: "physical", enabled: true, probability_ppm: 900000, stock_total: 5, stock_awarded: 0 },
    { id: 2, type: "no_win", enabled: true, probability_ppm: 100000, stock_total: 0, stock_awarded: 0 },
  ];
  const before = JSON.stringify(prizes);
  assert.equal(lotteryPrizeConfig(prizes).ready, false);
  assert.equal(lotteryPrizeConfig(prizes).legacyCount, 1);
  assert.equal(JSON.stringify(prizes), before);
  const stopped = [prizes[0], { ...prizes[1], enabled: false }];
  assert.equal(lotteryPrizeConfig(stopped).totalPpm, 900000);
  assert.equal(lotteryPrizeConfig(stopped).ready, false);
  assert.equal(lotteryPrizeConfig([{ ...prizes[0], probability_ppm: 1_000_000 }, stopped[1]]).ready, true);
});

test("publish requires a positive-weight stocked prize, not merely 100 percent configured", () => {
  const sold = { type: "physical", enabled: true, probability_ppm: 1_000_000, stock_total: 5, stock_awarded: 5 };
  assert.equal(lotteryPrizeConfig([sold]).ready, false);
  assert.equal(lotteryPrizeConfig([sold, { ...sold, probability_ppm: 0, stock_awarded: 0 }]).ready, false);
  assert.equal(lotteryPrizeConfig([{ ...sold, probability_ppm: 700000 }, { ...sold, type: "coupon", probability_ppm: 300000, stock_awarded: 0 }]).ready, true);
});

test("manual redemption does not require addresses; historical receipts remain distinguishable", () => {
  const receipt = { recipient_name: "王先生", recipient_phone: "13800000000", recipient_address: "贵州省测试地址" };
  assert.equal(hasClaimReceipt(receipt), true);
  for (const field of Object.keys(receipt)) {
    assert.equal(hasClaimReceipt({ ...receipt, [field]: " " }), false);
  }
  assert.equal(hasClaimReceipt({ customer_name: "王先生", receipt_submitted: true }), false);
  assert.deepEqual(claimEditableStatuses("pending", false), ["pending", "contacted", "fulfilled", "cancelled"]);
  assert.deepEqual(claimEditableStatuses("contacted", false), ["contacted", "fulfilled", "cancelled"]);
  assert.deepEqual(claimEditableStatuses("fulfilled", true), []);
});
