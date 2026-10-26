import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getWheelMotion, WHEEL_SPIN_DURATION_MS, WHEEL_SPIN_EASING } from "./lottery-wheel-motion.js";

const page = readFileSync(new URL("./LotteryPublicPage.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./lottery-wheel.css", import.meta.url), "utf8");

// Evaluate the actual configured CSS bezier by solving its x coordinate.
function progress(time) {
  const [x1, y1, x2, y2] = WHEEL_SPIN_EASING.match(/[\d.]+/g).map(Number);
  const curve = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i += 1) {
    const t = (lo + hi) / 2;
    if (curve(t, x1, x2) < time) lo = t; else hi = t;
  }
  return curve((lo + hi) / 2, y1, y2);
}

test("spin lasts around seven seconds and reveals only after settling", () => {
  const motion = getWheelMotion();
  assert.equal(motion.durationMs, 7200);
  assert.equal(motion.style["--lottery-wheel-spin-duration"], `${WHEEL_SPIN_DURATION_MS}ms`);
  assert.equal(motion.style["--lottery-wheel-spin-easing"], WHEEL_SPIN_EASING);
  assert.equal(motion.revealDelayMs, motion.durationMs + 200);
});

test("normal wheel slows progressively with visible movement left in its tail", () => {
  const quarters = [0, .25, .5, .75, 1].map(progress);
  const distances = quarters.slice(1).map((value, i) => value - quarters[i]);
  assert.ok(distances.every(value => value > 0));
  assert.ok(distances.every((value, i) => i === 0 || value < distances[i - 1]));
  assert.ok(quarters[1] < .55, "do not finish most of the spin in the first quarter");
  assert.ok(quarters[3] < .97, "at least 3% of travel remains for the final quarter");
  assert.ok(Math.abs(progress(1) - 1) < 1e-12);
});

test("reduced motion remains short with the same reveal ordering", () => {
  const motion = getWheelMotion(true);
  assert.equal(motion.durationMs, 200);
  assert.equal(motion.style["--lottery-wheel-spin-duration"], "200ms");
  assert.equal(motion.revealDelayMs, 400);
});

test("wheel, upright labels, and result timer all use the same motion profile", () => {
  assert.match(css, /\.lottery-wheel-stage \.lottery-wheel,\s*\.lottery-wheel-stage \.lottery-wheel__label\s*\{\s*transition: transform var\(--lottery-wheel-spin-duration\) var\(--lottery-wheel-spin-easing\)/);
  assert.match(page, /className="lottery-wheel-stage" style=\{motion\.style\}/);
  assert.match(page, /const motion = getWheelMotion\(prefersReducedMotion\)/);
  assert.match(page, /setWheelMotion\(motion\)/);
  assert.match(page, /\}, motion\.revealDelayMs\)/);
  assert.doesNotMatch(page, /4900/);
  assert.match(page, /nextRotation === null \|\| response\.idempotent/);
  assert.match(page, /if \(!canDraw \|\| spinningRef\.current\) return/);
  assert.match(page, /const activeNotice = !spinning && campaignState\.key !== "active"/);
});
