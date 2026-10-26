import assert from "node:assert/strict";
import test from "node:test";
import { LOTTERY_PAGE_SIZE_OPTIONS, lotteryPageChange, lotteryPageFromResponse } from "./lottery-pagination-utils.js";
import { mergeDrawSnapshot, normalizeLottery } from "./public/lottery-public-utils.js";

test("all supported sizes are explicit and changing size resets to first page", () => {
  assert.deepEqual(LOTTERY_PAGE_SIZE_OPTIONS, [10, 20, 50, 100]);
  for (const pageSize of [20, 50, 100]) {
    assert.deepEqual(lotteryPageChange({ current: 4, pageSize: 10, total: 95 }, 2, pageSize), { current: 1, pageSize, total: 95 });
  }
  assert.equal(lotteryPageChange({ current: 4, pageSize: 10 }, 5, 10).current, 5);
  assert.equal(lotteryPageChange({ current: 4, pageSize: 10 }, 2, 200).pageSize, 10);
});

test("server total, not page item count, controls complete history pagination", () => {
  const last = [{ id: 1 }];
  assert.deepEqual(lotteryPageFromResponse({ items: last, total: 31 }, 4, 10), { items: last, current: 4, pageSize: 10, total: 31 });
  const highPage = lotteryPageFromResponse({ items: [], total: 31 }, 8, 10);
  assert.equal(highPage.current, 4);
  assert.equal(lotteryPageFromResponse({ items: [], total: 0 }, 8, 10).current, 1);
});

test("pagination does not replace or expand the interrupted-draw recovery snapshot", () => {
  const recent = Array.from({ length: 20 }, (_, index) => ({ id: 30 - index, draw_sequence: 30 - index }));
  const current = normalizeLottery({ recent_draws: recent, link: { chance_total: 100, chance_used: 30 } });
  const pastPage = lotteryPageFromResponse({ items: [{ id: 1, draw_sequence: 1 }], total: 30 }, 3, 10);
  assert.equal(pastPage.total, 30);
  assert.equal(current.recent_draws.length, 20);
  const latest = mergeDrawSnapshot(current, { link: { chance_total: 100, chance_used: 31 } }, { id: 31, draw_sequence: 31 });
  assert.equal(latest.recent_draws.length, 20);
  assert.equal(latest.recent_draws[0].id, 31);
  assert.equal(pastPage.items[0].id, 1);
});
