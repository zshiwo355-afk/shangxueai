import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  campaignLabel, campaignReadOnly, findLotteryCampaign, lotteryCampaignGroups, retainedLotteryCampaignId,
} from "./lottery-campaign-utils.js";

const first = { id: 7, title: "大民族双十一狂欢抽奖", status: "published", can_create_links: true };
const second = { id: 6, title: "石荣霄酒业双十一回馈新老客户抽奖活动", status: "published", can_create_links: true };
const archived = { id: 5, title: "旧活动", status: "deleted", deleted_at: "2026-10-21" };

test("all authorized active campaigns remain independently selectable, not only newest", () => {
  const campaigns = [first, second, archived];
  assert.deepEqual(lotteryCampaignGroups(campaigns), { available: [first, second], history: [archived] });
  assert.equal(findLotteryCampaign(campaigns, "6"), second);
  assert.equal(campaignLabel(second), "#6 · 石荣霄酒业双十一回馈新老客户抽奖活动 · 进行中");
});

test("refresh retains selected older or historical campaign and falls back only if absent", () => {
  const campaigns = [first, second, archived];
  assert.equal(retainedLotteryCampaignId(campaigns, 6), 6);
  assert.equal(retainedLotteryCampaignId(campaigns, "5"), 5);
  assert.equal(retainedLotteryCampaignId(campaigns, 99), 7);
  assert.equal(retainedLotteryCampaignId([archived], 99), 5);
  assert.equal(retainedLotteryCampaignId([], 6), undefined);
});

test("only authorized creatable activities are shown in the creation picker", () => {
  const upcoming = { id: 8, title: "预热活动", status: "published", effective_status: "not_started", can_create_links: true };
  const blocked = [
    archived,
    { id: 9, status: "published", can_create_links: false },
    ...["draft", "paused", "ended", "deleted"].map((status, index) => ({ id: 10 + index, status })),
    { id: 20, status: "published", effective_status: "ended" },
  ];
  assert.deepEqual(lotteryCampaignGroups([first, upcoming, ...blocked]), { available: [first, upcoming], history: blocked });
  assert.equal(campaignReadOnly(undefined), true);
  assert.equal(campaignLabel(upcoming), "#8 · 预热活动 · 未开始");
});

test("workspace exposes all activities and confirms the form-selected activity", () => {
  const source = readFileSync(new URL("./LotteryLinkWorkspacePage.jsx", import.meta.url), "utf8");
  assert.match(source, /availableCampaigns\.map\(\(item\) => \{[\s\S]*aria-pressed=\{selected\}/);
  assert.match(source, /历史 \/ 不可建链活动/);
  assert.match(source, /campaignLabel\(selectedCampaign\)/);
  assert.match(source, /findLotteryCampaign\(campaignsRef\.current, values\.campaign_id\)/);
  assert.match(source, /<Select showSearch optionFilterProp="label" options=\{availableCampaigns\.map/);
  assert.doesNotMatch(source, /<Select disabled options=\{campaigns\.map/);
});

test("switching resets search, page and records; created share waits for target activity", () => {
  const source = readFileSync(new URL("./LotteryLinkWorkspacePage.jsx", import.meta.url), "utf8");
  const select = source.slice(source.indexOf("const selectCampaign ="), source.indexOf("const openCreate ="));
  for (const reset of ["linkRequestRef.current += 1", "setRows([])", "current: 1, total: 0", 'setKeyword("")', 'submittedKeywordRef.current = ""', "setShareRow(null)", "setRecordRow(null)"]) {
    assert.ok(select.includes(reset), `missing campaign reset: ${reset}`);
  }
  assert.match(source, /selectCampaign\(targetCampaign\.id, saved\)/);
  assert.match(source, /pending && String\(pending\.campaign_id\) === String\(campaignId\)/);
  assert.match(source, /requestId === linkRequestRef\.current[\s\S]*String\(activeCampaignRef\.current\) === String\(campaignId\)/);
});
