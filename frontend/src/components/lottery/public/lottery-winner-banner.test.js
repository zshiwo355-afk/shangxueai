import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizePublicWinners, shouldRefreshPublicWinners } from "./lottery-public-utils.js";
import { shouldAnimateWinnerBanner, winnerBannerDuration } from "./lottery-winner-banner-utils.js";

const source = (filename) => readFileSync(new URL(filename, import.meta.url), "utf8");

test("one confirmed winner scrolls without requiring a second or fabricated record", () => {
  assert.equal(shouldAnimateWinnerBanner({ count: 1 }), true);
  assert.equal(shouldAnimateWinnerBanner({ count: 30 }), true);
  assert.equal(shouldAnimateWinnerBanner({ count: 0 }), false);
  assert.equal(shouldAnimateWinnerBanner({ count: -1 }), false);
  const realWinner = { id: 31, display_name: "任先生", prize_name: "创始王" };
  assert.deepEqual(normalizePublicWinners({ items: [realWinner] }), [{ ...realWinner, id: "31", created_at: "" }]);
});

test("winner banner pauses for interaction, explicit pause, hidden page and reduced motion", () => {
  for (const count of [1, 8]) {
    for (const state of [{ paused: true }, { reducedMotion: true }, { hidden: true }, { interacting: true }]) {
      assert.equal(shouldAnimateWinnerBanner({ count, ...state }), false);
    }
  }
});

test("measured track distance controls a readable finite speed with an eight-second minimum", () => {
  assert.equal(winnerBannerDuration(120), 8);
  assert.equal(winnerBannerDuration(240), 8);
  assert.equal(winnerBannerDuration(600), 20);
  assert.equal(winnerBannerDuration(1800), 60);
  for (const distance of [undefined, null, NaN, Infinity, -Infinity, -30, 0, "invalid"]) {
    assert.equal(winnerBannerDuration(distance), 8);
  }
});

test("winner output never falls back to private customer data or WeChat profile fields", () => {
  const winners = normalizePublicWinners({ items: [{
    id: 1,
    prize_name: "真实奖品",
    customer_name: "客户完整姓名",
    recipient_phone: "13800000000",
    avatar_url: "https://private.example/avatar",
    openid: "private-openid",
    public_code: "private-link",
  }] });
  assert.deepEqual(winners, [{ id: "1", display_name: "幸运客户", prize_name: "真实奖品", created_at: "" }]);
});

test("winner updates remain suspended until the wheel lands", () => {
  assert.equal(shouldRefreshPublicWinners({ busy: true }), false);
  assert.equal(shouldRefreshPublicWinners({ hidden: true }), false);
  assert.equal(shouldRefreshPublicWinners({ busy: false, hidden: false }), true);
  const component = source("./LotteryWinnersFeed.jsx");
  assert.match(component, /controllerRef\.current\?\.abort\(\)/);
  assert.match(component, /version\s*!==\s*requestRef\.current/);
  assert.match(component, /shouldRefreshPublicWinners\(\{\s*busy:\s*busyRef\.current/);
});

test("winner banner appears before the activity hero instead of beside or beneath the wheel", () => {
  const page = source("./LotteryPublicPage.jsx");
  const banner = page.indexOf("<LotteryWinnersFeed");
  const hero = page.indexOf('<header className="lottery-hero"');
  const wheel = page.indexOf('<section className="lottery-wheel-section"');
  assert.ok(banner > 0 && banner < hero && hero < wheel);
  assert.equal((page.match(/<LotteryWinnersFeed\b/g) || []).length, 1);
  assert.match(page, /<LotteryWinnersFeed[^>]*\bbusy=\{spinning\}/);
});

test("winner banner removes the fixed carousel and keeps decorative loop copies inaccessible", () => {
  const component = source("./LotteryWinnersFeed.jsx");
  assert.doesNotMatch(component, /<Carousel\b/);
  assert.match(component, /lottery-winner-banner__track/);
  assert.match(component, /lottery-winner-banner__group--duplicate/);
  assert.match(component, /aria-hidden(?:=\{(?:true|duplicate(?:\s*\|\|\s*undefined)?)\}|="true")/);
  assert.doesNotMatch(component, /\b(?:customer_name|avatar_url|openid)\b/);
  assert.doesNotMatch(component, /\b(?:Math\.random|localStorage|sessionStorage)\b/);
});

test("banner fades at the edges and moves left while respecting reduced-motion preferences", () => {
  const css = source("./lottery-winners-ticker.css");
  assert.match(css, /mask-image:\s*linear-gradient\(90deg,\s*transparent/);
  assert.match(css, /animation:\s*lottery-winner-drift-left[^;]*\blinear\s+infinite/);
  assert.match(css, /translate3d\(-50%,\s*0,\s*0\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /\.lottery-winner-banner__group--duplicate\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css, /position:\s*fixed/);
});
