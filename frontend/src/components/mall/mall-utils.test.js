import test from "node:test";
import assert from "node:assert/strict";
import { createRedemptionRequest, mallDanmakuArrivalLanes, mallDanmakuLayout, mallDanmakuMotion, mergeMallDanmaku, newRedemptionRequestId, nextMallDanmaku, redemptionBlockReason, resizeMallDanmakuFrames } from "./mall-utils.js";

const product = { id: 7, price_yuan: 100, points_cost: 5, stock: 1, enabled: true };

test("redeeming requires loaded balance, sufficient points, stock and an enabled product", () => {
  assert.equal(redemptionBlockReason(product, null), "等待余额更新");
  assert.equal(redemptionBlockReason(product, 4), "还差 1 积分");
  assert.equal(redemptionBlockReason(product, 5), "");
  assert.equal(redemptionBlockReason({ ...product, stock: 0 }, 10), "暂时兑完");
  assert.equal(redemptionBlockReason({ ...product, enabled: false }, 10), "商品已下架");
});

test("a redemption retry sends the same key and confirmed price without a client-supplied points deduction", () => {
  const requestId = newRedemptionRequestId();
  const request = createRedemptionRequest(product, requestId);
  assert.deepEqual(request, { product_id: 7, expected_price_yuan: 100, request_id: requestId });
  assert.deepEqual(createRedemptionRequest(product, requestId), request);
  assert.notEqual(newRedemptionRequestId(), requestId);
});

test("danmaku keeps the newest 100 without duplicates or losing a send to a stale poll", () => {
  const old = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, content: `弹幕${i + 1}` }));
  const sent = { id: 101, content: "刚刚发送" };
  const current = mergeMallDanmaku(old, [sent]);
  assert.equal(current.length, 100);
  assert.equal(current[0].id, 2);
  assert.deepEqual(mergeMallDanmaku(current, old), current);
  assert.deepEqual(current.at(-1), sent);
});

test("danmaku loops, skips other occupied lanes, and survives removal from the latest 100", () => {
  const items = [{ id: 3 }, { id: 4 }, { id: 5 }];
  assert.equal(nextMallDanmaku(items, 3, [4]).id, 5);
  assert.equal(nextMallDanmaku(items, 5, [3]).id, 4);
  assert.equal(nextMallDanmaku(items, 1).id, 3);
  assert.equal(nextMallDanmaku(items, 5, [3, 4, 5]), null);
  assert.equal(nextMallDanmaku([], 0), null);
  assert.equal(nextMallDanmaku([{ id: 1 }], 1).id, 1);
});

test("all new arrivals play before history, including a lower ID committed late", () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 101 }, { id: 102 }, { id: 103 }, { id: 104 }];
  assert.equal(nextMallDanmaku(items, 1, [101, 102, 103], [104]).id, 104);
  assert.equal(nextMallDanmaku(items, 102, [102], [101]).id, 101);
  assert.equal(nextMallDanmaku(items, 1, [], [999]).id, 2);
});

test("new arrivals preserve a paused message while the other lanes keep playing", () => {
  const frames = [{ key: 10, hovered: true }, { key: 11 }, null];
  assert.deepEqual(mallDanmakuArrivalLanes(frames), [1, 2]);
  frames[0] = { key: 10, pinned: true };
  assert.deepEqual(mallDanmakuArrivalLanes(frames), [1, 2]);
  frames[0] = { key: 10 };
  assert.deepEqual(mallDanmakuArrivalLanes(frames), [0, 1, 2]);
  assert.deepEqual(mallDanmakuArrivalLanes(frames.map((frame) => ({ ...frame, pinned: true }))), []);
});

test("danmaku uses up to ten lanes and reduces the count in a short viewport", () => {
  assert.deepEqual(mallDanmakuLayout(900), { height: 900, count: 10 });
  assert.deepEqual(mallDanmakuLayout(520), { height: 520, count: 10 });
  assert.deepEqual(mallDanmakuLayout(519), { height: 519, count: 9 });
  assert.deepEqual(mallDanmakuLayout(200), { height: 200, count: 3 });
  assert.deepEqual(mallDanmakuLayout(0), { height: 44, count: 1 });
});

test("ten random 44px messages never overlap or leave the visible page", () => {
  const layout = mallDanmakuLayout(520);
  for (const value of [0, 0.2, 0.5, 0.8, 0.999]) {
    const frames = [];
    for (let index = 0; index < layout.count; index += 1) {
      frames.push(mallDanmakuMotion("加油", frames.map((frame) => frame.band), layout, () => value));
    }
    assert.equal(new Set(frames.map((frame) => frame.band)).size, 10);
    for (const frame of frames) {
      assert.ok(frame.top >= 0 && frame.top / 100 * layout.height + 44 <= layout.height);
      assert.ok(frame.duration >= 14 && frame.duration < 23);
      assert.ok(frame.delay >= 0.2 && frame.delay < 3);
    }
    const tops = frames.map((frame) => frame.top / 100 * layout.height).sort((a, b) => a - b);
    tops.slice(1).forEach((top, index) => assert.ok(top - tops[index] >= 44));
    assert.equal(mallDanmakuMotion("已满", frames.map((frame) => frame.band), layout, () => value), null);
  }
});

test("each passage can vary its height, speed and start time while long text gets more reading time", () => {
  const layout = mallDanmakuLayout(700);
  const early = mallDanmakuMotion("加油", [], layout, () => 0.1);
  const later = mallDanmakuMotion("加油", [], layout, () => 0.9);
  assert.notEqual(early.top, later.top);
  assert.notEqual(early.duration, later.duration);
  assert.notEqual(early.delay, later.delay);
  assert.ok(mallDanmakuMotion("🎉".repeat(50), [], layout, () => 0.1).duration > early.duration);
});

test("shrinking preserves held frames and animation identity while fitting all retained messages", () => {
  const originalLayout = mallDanmakuLayout(800);
  const frames = Array.from({ length: 10 }, (_, index) => ({
    key: index + 1,
    item: { id: index + 1 },
    hovered: index === 7,
    pinned: index === 9,
    motion: mallDanmakuMotion("加油", Array.from({ length: index }, (_, band) => band), originalLayout, () => 0),
  }));
  const before = structuredClone(frames);
  const layout = mallDanmakuLayout(200);
  const resized = resizeMallDanmakuFrames(frames, layout, () => 0.999);
  assert.deepEqual(resized.map((frame) => frame.key), [1, 8, 10]);
  resized.forEach((frame, index) => {
    const original = frames.find((candidate) => candidate.key === frame.key);
    assert.equal(frame.item, original.item);
    assert.equal(frame.hovered, original.hovered);
    assert.equal(frame.pinned, original.pinned);
    assert.equal(frame.motion.duration, original.motion.duration);
    assert.equal(frame.motion.delay, original.motion.delay);
    assert.equal(frame.motion.band, index);
    assert.ok(frame.motion.top >= 0 && frame.motion.top / 100 * layout.height + 44 <= layout.height);
    if (index) assert.ok((frame.motion.top - resized[index - 1].motion.top) / 100 * layout.height >= 44);
  });
  assert.deepEqual(frames, before);
  const smallest = resizeMallDanmakuFrames(frames, mallDanmakuLayout(0), () => 0.999);
  assert.equal(smallest.length, 1);
  assert.equal(smallest[0].key, 8);
  assert.equal(smallest[0].motion.top, 0);
});

test("expanding preserves existing slots and appends empty slots", () => {
  const layout = mallDanmakuLayout(520);
  const frame = { key: 5, pinned: true, motion: { band: 0, top: 0, duration: 20, delay: 0 } };
  const resized = resizeMallDanmakuFrames([null, frame, null], layout, () => 0.5);
  assert.equal(resized.length, 10);
  assert.equal(resized[0], null);
  assert.equal(resized[1].key, frame.key);
  assert.equal(resized[1].pinned, true);
  assert.equal(resized[1].motion.duration, 20);
  assert.equal(resized[1].motion.delay, 0);
  assert.deepEqual(resized.slice(2), Array(8).fill(null));
});
