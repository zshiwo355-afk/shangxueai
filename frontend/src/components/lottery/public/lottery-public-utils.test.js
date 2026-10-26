import assert from "node:assert/strict";
import test from "node:test";

import {
  createPendingDrawTracker,
  findConfirmedPendingDraw,
  getCampaignState,
  getNextLotteryRefreshDelay,
  getPublicPrizeDisplay,
  getPublicHistoryDisplayState,
  getRedemptionDisplayState,
  getWheelTargetRotation,
  groupPublicWinners,
  isAmbiguousDrawError,
  mergeDrawSnapshot,
  normalizeLottery,
  normalizePublicWinners,
  normalizeReceipt,
  normalizeWinningSummary,
  shouldAutoplayPrizes,
  shouldRefreshPublicWinners,
} from "./lottery-public-utils.js";

function snapshot(overrides = {}) {
  return normalizeLottery({
    campaign: { id: 1, status: "published", title: "测试活动", config_version: 1 },
    link: { status: "active", chance_total: 3, chance_used: 0, remaining_chances: 3 },
    prizes: [{ id: 11, name: "旧奖品" }, { id: 12, name: "谢谢参与", type: "no_win" }],
    recent_draws: [],
    ...overrides,
  });
}

test("pending draw identities work with browser storage entirely blocked", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new Error("Storage is blocked"); },
  });
  try {
    let count = 0;
    const pending = createPendingDrawTracker(() => `request-${++count}`);
    const first = pending.getOrCreate("link-a", 0);
    assert.deepEqual(first, { requestId: "request-1", expectedSequence: 1 });
    assert.equal(pending.getOrCreate("link-a", 0), first);
    assert.equal(count, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("lost-response retry preserves expected sequence despite refreshed counts", () => {
  let count = 0;
  const pending = createPendingDrawTracker(() => `request-${++count}`);
  const first = pending.getOrCreate("link-a", 0);
  assert.equal(pending.getOrCreate("link-a", 1), first);
  assert.equal(pending.getOrCreate("link-a", 20).expectedSequence, 1);
  assert.deepEqual(pending.getOrCreate("link-b", 7), { requestId: "request-2", expectedSequence: 8 });
  pending.clear("link-a", "stale-request");
  assert.equal(pending.peek("link-a"), first);
  pending.clear("link-a", first.requestId);
  assert.deepEqual(pending.getOrCreate("link-a", 1), { requestId: "request-3", expectedSequence: 2 });
});

test("refresh recovers committed results by server draw sequence without submitting a draw", () => {
  const pending = { requestId: "response-was-lost", expectedSequence: 2 };
  const draw = { id: 93, draw_sequence: 2, prize_id: 11, prize_name: "已中奖品" };
  const latest = snapshot({ recent_draws: [{ id: 94, draw_sequence: 3 }, draw] });
  assert.equal(findConfirmedPendingDraw(latest, pending), draw);
  assert.equal(findConfirmedPendingDraw(snapshot(), pending), null);
  assert.equal(findConfirmedPendingDraw(latest, null), null);
});

test("reload starts without pending writes and does not revive historical extra chances", () => {
  let generated = 0;
  const freshPage = createPendingDrawTracker(() => `request-${++generated}`);
  const latest = snapshot({ link: { chance_total: 3, chance_used: 1 } });
  assert.equal(freshPage.peek("link-a"), undefined);
  assert.equal(generated, 0);
  assert.equal(latest.link.remaining_chances, 0);
  assert.equal(latest.link.chance_total, 3);
  assert.equal(latest.link.chance_limit, 1);
  assert.equal(freshPage.getOrCreate("link-a", latest.link.chance_used).expectedSequence, 2);
});

test("draw response hydrates latest campaign, prize list and counts before animation", () => {
  const original = snapshot({ share: { title: "分享卡片" } });
  const draw = { id: 44, draw_sequence: 1, prize_id: 99, result_type: "win" };
  const response = {
    campaign: { id: 1, status: "published", title: "更新活动", config_version: 7 },
    prizes: [{ id: 99, name: "新奖品" }, { id: 12, name: "谢谢参与" }],
    link: { chance_total: 3, chance_used: 1, remaining_chances: 2 },
    draw,
  };
  const updated = mergeDrawSnapshot(original, response, draw);
  assert.equal(updated.campaign.title, "更新活动");
  assert.equal(updated.campaign.config_version, 7);
  assert.deepEqual(updated.prizes, response.prizes);
  assert.equal(updated.link.remaining_chances, 0);
  assert.equal(updated.share.title, "分享卡片");
  assert.equal(updated.recent_draws[0], draw);
  assert.notEqual(getWheelTargetRotation(updated.prizes, draw, 0), null);
  assert.equal(getWheelTargetRotation(original.prizes, draw, 0), null);
});

test("idempotent replay never decrements counts or duplicates history locally", () => {
  const draw = { id: 2, draw_sequence: 1, prize_id: 11 };
  const current = snapshot({ link: { chance_total: 3, chance_used: 3, remaining_chances: 0 }, recent_draws: [draw] });
  const replayed = mergeDrawSnapshot(current, { link: current.link, idempotent: true }, draw);
  assert.equal(replayed.link.chance_used, 3);
  assert.equal(replayed.link.remaining_chances, 0);
  assert.equal(replayed.recent_draws.length, 1);
  const missingCounts = mergeDrawSnapshot(current, {}, draw);
  assert.equal(missingCounts.link.chance_used, 3);
  const newerDraw = { id: 3, draw_sequence: 2, prize_id: 11 };
  const withNewerHistory = mergeDrawSnapshot({ ...current, recent_draws: [newerDraw, draw] }, {}, draw);
  assert.deepEqual(withNewerHistory.recent_draws.map((item) => item.id), [3, 2]);
});

test("removed or unknown winning prize has no fabricated wheel landing", () => {
  assert.equal(getWheelTargetRotation([{ id: 1 }], { prize_id: 99 }, 900), null);
  assert.equal(getWheelTargetRotation([], { prize_id: 99 }, 900), null);
  const prizes = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const rotation = getWheelTargetRotation(prizes, { prize_id: "2" }, 0);
  assert.equal(rotation % 360, 225);
  assert.equal(getWheelTargetRotation(prizes, { prize_id: 2 }, 0, true), 225);
});

test("prestart refresh is scheduled at boundary and only server publication enables drawing", () => {
  const start = Date.parse("2026-10-22T10:00:00+08:00");
  const before = snapshot({ campaign: { status: "not_started", start_at: "2026-10-22T10:00:00+08:00" } });
  assert.equal(getCampaignState(before, start - 1000).key, "not_started");
  assert.equal(getNextLotteryRefreshDelay(before, start - 1000), 1100);
  assert.equal(getCampaignState(before, start + 100).key, "not_started");
  const refreshed = snapshot({ campaign: { status: "active", start_at: "2026-10-22T10:00:00+08:00" } });
  assert.equal(getCampaignState(refreshed, start + 100).key, "active");
  assert.equal(getNextLotteryRefreshDelay(refreshed, start + 100), 30000);
});

test("server refresh reflects pause and resume but historical added chances do not revive used links", () => {
  const now = Date.now();
  assert.equal(getCampaignState(snapshot({ campaign: { status: "paused" } }), now).key, "paused");
  assert.equal(getCampaignState(snapshot(), now).key, "active");
  assert.equal(getCampaignState(snapshot({ link: { chance_total: 3, chance_used: 3 } }), now).key, "exhausted");
  assert.equal(getCampaignState(snapshot({ link: { chance_total: 4, chance_used: 3 } }), now).key, "exhausted");
});

test("ambiguous network/server responses retain identity; concrete rejections may reset it", () => {
  for (const error of [{}, { status: 502 }, { status: 408 }, { status: 429 }, { status: 200, code: "BAD_RESPONSE" }]) {
    assert.equal(isAmbiguousDrawError(error), true);
  }
  for (const status of [400, 403, 404, 409, 422]) {
    assert.equal(isAmbiguousDrawError({ status }), false);
    assert.equal(isAmbiguousDrawError({ status }, true), true);
  }
});

const fullSummary = {
  items: [{ prize_id: 11, prize_name: "精选礼盒", prize_image_url: "/gift.jpg", quantity: 24 }, { prize_id: 14, prize_name: "经典好礼", prize_image_url: "", quantity: 3 }],
  total_wins: 27,
};

test("inline redemption summary stays hidden until the single result dialog closes", () => {
  const unfinished = snapshot({ winning_summary: fullSummary });
  assert.equal(getRedemptionDisplayState(unfinished), "progress");
  const finished = snapshot({ winning_summary: fullSummary, link: { chance_total: 27, chance_used: 27 } });
  assert.equal(getRedemptionDisplayState(finished), "complete");
  for (const state of [{ spinning: true }, { resultOpen: true }, { pendingRequest: { requestId: "uncertain" } }]) {
    assert.equal(getRedemptionDisplayState(finished, state), "hidden");
  }
});

test("exhausted reload shows permanent full summary without automatically opening another modal", () => {
  const refreshed = snapshot({ winning_summary: fullSummary, link: { chance_total: 27, chance_used: 27 }, recent_draws: Array.from({ length: 20 }, (_, index) => ({ id: index + 8 })) });
  assert.equal(getRedemptionDisplayState(refreshed), "complete");
  assert.equal(refreshed.winning_summary.total_wins, 27);
  assert.equal(refreshed.winning_summary.items[0].quantity, 24);
  assert.equal(refreshed.recent_draws.length, 20);
});

test("committed draws stay concealed in history and winning summary until the wheel lands", () => {
  const committed = snapshot({
    link: { chance_total: 1, chance_used: 1, remaining_chances: 0 },
    recent_draws: [{ id: 1, result_type: "win", prize_name: "尚未揭晓的奖品" }],
    winning_summary: fullSummary,
  });
  assert.equal(getPublicHistoryDisplayState({ busy: true }), "drawing");
  assert.equal(getPublicHistoryDisplayState({ busy: true, error: "old request failed" }), "drawing");
  assert.equal(getRedemptionDisplayState(committed, { spinning: true }), "hidden");
  assert.equal(getPublicHistoryDisplayState({ busy: false }), "records");
  assert.equal(getPublicHistoryDisplayState({ error: "failed" }), "error");
  assert.equal(getRedemptionDisplayState(committed, { resultOpen: true }), "hidden");
  assert.equal(getRedemptionDisplayState(committed), "complete");
  assert.deepEqual(committed.winning_summary, fullSummary);
});

test("legacy links retain all wins and allow redemption after their first draw", () => {
  const added = snapshot({ winning_summary: fullSummary, link: { chance_total: 30, chance_used: 27 } });
  assert.equal(getRedemptionDisplayState(added), "complete");
  assert.deepEqual(added.winning_summary, fullSummary);
  const completed = snapshot({ winning_summary: fullSummary, link: { chance_total: 30, chance_used: 30 } });
  assert.equal(getRedemptionDisplayState(completed), "complete");
});

test("single-draw normalization respects server exhaustion and never advertises more than one chance", () => {
  const unused = snapshot({ link: { chance_total: 100, chance_used: 0, remaining_chances: 100 } });
  assert.equal(unused.link.chance_total, 100);
  assert.equal(unused.link.chance_limit, 1);
  assert.equal(unused.link.remaining_chances, 1);
  const used = snapshot({ link: { chance_total: 100, chance_used: 1, remaining_chances: 99 } });
  assert.equal(used.link.remaining_chances, 0);
  assert.equal(getCampaignState(used, Date.now()).key, "exhausted");
  assert.equal(snapshot({ link: { chance_limit: 1, chance_used: 0, remaining_chances: 0 } }).link.remaining_chances, 0);
  assert.equal(snapshot({ link: { chance_total: 100, chance_used: 0 } }).link.remaining_chances, 1);
});

test("public winners whitelist safe server fields, deduplicate and never construct synthetic winners", () => {
  const raw = { id: 1, display_name: "张先生", prize_name: "精选礼盒", created_at: "2026-10-23T10:00:00+08:00", customer_name: "张某某", phone: "private", code: "private", avatar_url: "private" };
  assert.deepEqual(normalizePublicWinners({ items: [raw, { ...raw }, null, { id: 2 }, { id: 3, prize_name: " " }] }), [{ id: "1", display_name: "张先生", prize_name: "精选礼盒", created_at: raw.created_at }]);
  assert.deepEqual(normalizePublicWinners({ items: [] }), []);
  assert.throws(() => normalizePublicWinners({}), /中奖动态返回异常/);
  assert.equal(normalizePublicWinners({ items: [{ id: 3, prize_name: "好礼", customer_name: "不得回显" }] })[0].display_name, "幸运客户");
  assert.equal(normalizePublicWinners({ items: Array.from({ length: 35 }, (_, i) => ({ id: i, prize_name: "真实好礼" })) }).length, 30);
});

test("winner groups preserve each real result once without duplicating sparse pages", () => {
  const records = Array.from({ length: 7 }, (_, id) => ({ id }));
  const groups = groupPublicWinners(records);
  assert.deepEqual(groups.map((items) => items.length), [3, 3, 1]);
  assert.deepEqual(groups.flat(), records);
  assert.deepEqual(groupPublicWinners([]), []);
});

test("winner refresh waits for the wheel to land, not for the result modal to close", () => {
  assert.equal(shouldRefreshPublicWinners({ busy: true, hidden: false }), false);
  assert.equal(shouldRefreshPublicWinners({ busy: true, hidden: true }), false);
  assert.equal(shouldRefreshPublicWinners({ busy: false, hidden: true }), false);
  assert.equal(shouldRefreshPublicWinners({ busy: false, hidden: false }), true);
  assert.equal(shouldRefreshPublicWinners({ busy: false, resultOpen: true }), true);
});

test("draw response hydrates complete summary and idempotent replay never adds a local win", () => {
  const original = snapshot();
  const draw = { id: 27, draw_sequence: 27, result_type: "win", prize_id: 11 };
  const response = { link: { chance_total: 27, chance_used: 27, remaining_chances: 0 }, winning_summary: fullSummary, draw };
  const latest = mergeDrawSnapshot(original, response, draw);
  assert.deepEqual(latest.winning_summary, fullSummary);
  const replay = mergeDrawSnapshot(latest, { ...response, idempotent: true }, draw);
  assert.deepEqual(replay.winning_summary, fullSummary);
  assert.equal(replay.recent_draws.length, 1);
  assert.equal(mergeDrawSnapshot(latest, { link: response.link }, draw).winning_summary, null);
});

test("missing or incomplete summaries never fabricate totals from recent records", () => {
  assert.equal(normalizeWinningSummary(undefined), null);
  assert.equal(normalizeWinningSummary({ items: [], total_wins: 27 }), null);
  assert.equal(normalizeWinningSummary({ items: [null], total_wins: 1 }), null);
  assert.equal(normalizeWinningSummary({ items: [{ quantity: -1 }], total_wins: -1 }), null);
  assert.equal(normalizeWinningSummary({ items: [{ quantity: 1.5 }], total_wins: 1.5 }), null);
  const missing = snapshot({ link: { chance_total: 27, chance_used: 27 }, recent_draws: [{ id: 1, result_type: "win" }] });
  assert.equal(missing.winning_summary, null);
  assert.equal(getRedemptionDisplayState(missing), "complete");
  assert.equal(normalizeLottery({ winning_summary: { ...fullSummary, recipient_phone: "private", request_id: "private" } }).winning_summary.recipient_phone, undefined);
});

test("manual redemption disables old address collection even when an old server advertises it", () => {
  assert.deepEqual(normalizeReceipt({ submitted: true, required: true, can_submit: true, win_count: 3 }), { submitted: true, manual_redemption: true, required: false, can_submit: false, win_count: 3 });
  assert.equal(normalizeReceipt({ required: true, can_submit: true }).can_submit, false);
  const historical = snapshot({ link: { chance_total: 1, chance_used: 1 }, winning_summary: { items: [], total_wins: 0 } });
  assert.equal(historical.winning_summary.total_wins, 0);
  assert.equal(getRedemptionDisplayState(historical), "complete");
});

test("product carousel autoplay pauses for interaction, hidden page and reduced motion", () => {
  assert.equal(shouldAutoplayPrizes({ count: 8 }), true);
  assert.equal(shouldAutoplayPrizes({ count: 1 }), false);
  assert.equal(shouldAutoplayPrizes({ count: 0 }), false);
  for (const state of [{ reducedMotion: true }, { paused: true }, { interacting: true }, { hidden: true }]) {
    assert.equal(shouldAutoplayPrizes({ count: 8, ...state }), false);
  }
});

test("current public wheel excludes legacy nonwinning configuration without rewriting historical results", () => {
  const prizes = [{ id: 1, type: "physical", name: "奖品" }, { id: 2, type: "no_win", name: "旧未中奖项" }];
  assert.deepEqual(getPublicPrizeDisplay(prizes), [prizes[0]]);
  const historicalDraw = { id: 4, prize_id: 2, result_type: "no_win" };
  const state = snapshot({ prizes, recent_draws: [historicalDraw] });
  assert.equal(state.recent_draws[0].result_type, "no_win");
  assert.equal(getWheelTargetRotation(getPublicPrizeDisplay(prizes), historicalDraw, 0), null);
});
