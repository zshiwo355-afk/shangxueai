import assert from "node:assert/strict";
import test from "node:test";

import { getWheelTargetRotation } from "./lottery-public-utils.js";
import { getWheelPrizeLabelStyle, hasSameWheelPrizeOrder } from "./lottery-wheel-layout.js";

test("live sector changes bypass the transition instead of mounting upside-down labels", () => {
  const before = [{ id: 1 }, { id: 2 }];
  assert.equal(hasSameWheelPrizeOrder(before, [{ id: 1 }, { id: 2 }]), true);
  for (const after of [[{ id: 2 }, { id: 1 }], [{ id: 1 }], [...before, { id: 3 }]]) {
    assert.equal(hasSameWheelPrizeOrder(before, after), false);
  }
});

function counterRotation(style) {
  return Number(style.transform.match(/rotate\(([-\d.]+)deg\)/)[1]);
}

test("prize content stays upright at rest and at intermediate spin angles", () => {
  for (const count of [1, 7, 10]) {
    for (const rotation of [0, 37.5, 180, 359.99, 1538.5, 2451, 4698]) {
      for (let index = 0; index < count; index += 1) {
        const style = getWheelPrizeLabelStyle(index, count, rotation);
        assert.equal(rotation + counterRotation(style), 0);
        assert.ok(style.transform.startsWith("translate(-50%, -50%)"));
      }
    }
  }
});

test("upright labels preserve the authoritative winning sector under the pointer", () => {
  for (const count of [7, 10]) {
    const prizes = Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
    for (let index = 0; index < count; index += 1) {
      for (const reducedMotion of [false, true]) {
        const rotation = getWheelTargetRotation(prizes, { prize_id: index + 1 }, 432.5, reducedMotion);
        const style = getWheelPrizeLabelStyle(index, count, rotation);
        const x = Number.parseFloat(style.left) - 50;
        const y = Number.parseFloat(style.top) - 50;
        const radians = rotation * Math.PI / 180;
        const rotatedX = x * Math.cos(radians) - y * Math.sin(radians);
        const rotatedY = x * Math.sin(radians) + y * Math.cos(radians);
        assert.ok(Math.abs(rotatedX) < 1e-9, `prize ${index} must stay below the pointer`);
        assert.ok(rotatedY < 0);
        assert.equal(rotation + counterRotation(style), 0);
      }
    }
  }
});

test("seven and ten prize label corners fit a narrow phone wheel at every angle", () => {
  // The narrowest 320px layout has a wheel of approximately 228px. Include
  // every possible resting angle, not only the initial sector positions.
  const diameter = 228;
  for (const [count, width, height] of [[7, 50, 48], [10, 43, 44]]) {
    const style = getWheelPrizeLabelStyle(0, count, 0);
    const radius = Math.hypot(Number.parseFloat(style.left) - 50, Number.parseFloat(style.top) - 50) * diameter / 100;
    const farthestCorner = radius + Math.hypot(width / 2, height / 2);
    assert.ok(farthestCorner < diameter / 2, `${count} prize labels must not be cropped`);
  }
});
