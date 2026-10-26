import assert from "node:assert/strict";
import test from "node:test";
import { createPrizeMarqueeEntries } from "./lottery-prize-marquee-utils.js";

test("two-row loops contain every actual prize and fill a complete viewport", () => {
  for (const count of [2, 3, 5, 6, 9, 10, 11]) {
    const prizes = Array.from({ length: count }, (_, id) => ({ id, name: `奖品 ${id}` }));
    const entries = createPrizeMarqueeEntries(prizes, 8);
    assert.ok(entries.length >= 16);
    assert.equal(entries.length % 2, 0);
    assert.equal(entries.length % count, 0);
    assert.deepEqual(entries.filter((entry) => !entry.repeated).map((entry) => entry.prize), prizes);
    entries.forEach((entry, index) => assert.equal(entry.prize, prizes[index % count]));
  }
});

test("empty, single-prize and reduced-motion displays do not repeat content", () => {
  assert.deepEqual(createPrizeMarqueeEntries([]), []);
  assert.deepEqual(createPrizeMarqueeEntries(null), []);
  const prizes = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.equal(createPrizeMarqueeEntries([prizes[0]], 8).length, 1);
  assert.deepEqual(createPrizeMarqueeEntries(prizes, 8, true).map((entry) => entry.prize), prizes);
  assert.ok(createPrizeMarqueeEntries(prizes, 8, true).every((entry) => !entry.repeated));
});

test("invalid measurements have a safe finite two-row fallback", () => {
  for (const width of [NaN, Infinity, -4, 0]) {
    const entries = createPrizeMarqueeEntries([{ id: 1 }, { id: 2 }, { id: 3 }], width);
    assert.equal(entries.length, 6);
  }
});
