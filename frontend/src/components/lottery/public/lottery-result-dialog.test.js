import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./LotteryPublicPage.jsx", import.meta.url), "utf8");

test("closing the draw result only dismisses it and cannot chain a redemption prompt", () => {
  const handler = source.match(/const handleResultClose = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(handler, "the result must have an explicit close action");
  const transitions = [];
  vm.runInNewContext(`(() => {${handler[1]}})()`, {
    setResultOpen: (value) => transitions.push(value),
  });
  assert.deepEqual(transitions, [false]);
  assert.doesNotMatch(source, /completionPromptRef|shouldPromptRedemption|onAfterClose|afterClose=/);
});

test("one result dialog includes both the prize and screenshot redemption instructions", () => {
  const modal = source.slice(source.indexOf("function ResultModal("), source.indexOf("function LoadingPage("));
  assert.equal((modal.match(/<Modal\b/g) || []).length, 1);
  assert.match(modal, /draw\?\.prize_name/);
  assert.match(modal, /请截图中奖信息，联系销售人员兑奖/);
  assert.match(modal, /onClick=\{onClose\}>我知道了<\/Button>/);
  assert.doesNotMatch(modal, /查看中奖清单/);
  assert.match(modal, /onCancel=\{onClose\}/);
});

test("full winning summary remains inline and its optional preview is explicitly user-opened", () => {
  assert.match(source, /<LotteryWinningSummary[\s\S]*?summary=\{lottery\.winning_summary\}/);
  assert.equal((source.match(/setRedemptionOpen\(true\)/g) || []).length, 1);
  assert.match(source, /onOpen=\{\(\) => setRedemptionOpen\(true\)\}/);
});
