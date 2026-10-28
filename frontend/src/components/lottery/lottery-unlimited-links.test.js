import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./LotteryLinkWorkspacePage.jsx", import.meta.url), "utf8");

test("employee workspace ignores all legacy link quota settings", () => {
  assert.doesNotMatch(source, /linkQuota|quotaReached|link_quota|max_links_per_employee|链接额度已用完|追加.*额度/);
  assert.match(source, /title="当前客户链接" value=\{pagination\.total\} suffix="条"/);
});

test("unlimited link creation retains permission, campaign and duplicate-submit guards", () => {
  assert.match(source, /disabled=\{!availableCampaigns\.length \|\| saving \|\| createConfirming\} onClick=\{openCreate\}/);
  assert.match(source, /campaignReadOnly\(campaignRef\.current\)/);
  assert.match(source, /createConfirmingRef\.current = true/);
  assert.match(source, /singleDrawLinkPayload\(/);
  assert.match(source, /确认生成（1 次）/);
});
