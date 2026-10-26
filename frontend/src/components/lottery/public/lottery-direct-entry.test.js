import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { customerCardPayload } from "../lottery-share-utils.js";

const readSource = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const appSource = readSource("../../../App.jsx");
const publicSource = readSource("./LotteryPublicPage.jsx");

test("QR and historical public links render the same wheel without an auth gate", () => {
  for (const path of ["/share/lottery/:code", "/lottery/:code"]) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(appSource, new RegExp(`<Route\\s+path=["']${escaped}["']\\s+element=\\{<LotteryPublicPage\\s*\\/>\\}\\s*\\/>`));
  }
  const gate = appSource.match(/function isPublicRoute\(pathname\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(gate, "the app must retain an explicit public-session gate");
  const isPublicRoute = vm.runInNewContext(`(${gate})`);
  assert.equal(isPublicRoute("/share/lottery/customer-code"), true);
  assert.equal(isPublicRoute("/lottery/customer-code"), true);
  assert.equal(isPublicRoute("/lottery-workspace"), false);
  assert.equal(isPublicRoute("/admin/lottery"), false);
  assert.equal(isPublicRoute("/share/not-lottery/customer-code"), false);
});

test("the public wheel exposes native forwarding and has no employee instructions or invitation step", () => {
  assert.match(publicSource, /showOptionMenu/);
  assert.match(publicSource, /WeixinJSBridgeReady/);
  assert.match(publicSource, /prepareCardSdk\(/);
  assert.doesNotMatch(publicSource, /hideOptionMenu|hideWechatShareMenu|BLOCKED_WECHAT_MENU_ITEMS/);
  assert.doesNotMatch(publicSource, /销售转发请停留|不用先进入抽奖页|微信转发指引|点右上角|进入抽奖页面/);
  assert.doesNotMatch(publicSource, /window\.location\.(?:replace|assign)\(/);
  assert.doesNotMatch(publicSource, /resolveLotterySharePreview|__lotteryShareBootstrap/);
});

test("public reads and sharing configuration cannot submit a draw", async () => {
  const source = readSource("../../../lib/api.lottery.js")
    .replace(/^import[^\n]+\n/gm, "")
    .replace(/\bexport\s+/g, "");
  const calls = [];
  const context = vm.createContext({
    URLSearchParams,
    getJson: async (...args) => { calls.push({ method: "GET", args }); return {}; },
    postJson: async (...args) => { calls.push({ method: "POST", args }); return {}; },
  });
  vm.runInContext(source, context);
  const code = "same_customer-1";
  const url = `https://example.test/share/lottery/${code}?card=3`;
  await context.getPublicLottery(code);
  await context.getPublicLotteryShareConfig(code, url);
  await context.getPublicLotteryDraws(code);
  await context.getPublicLotteryWinners(code);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ method }) => method === "GET"));
  assert.equal(calls[0].args[0], `/api/public/lottery/${code}`);
  const config = new URL(calls[1].args[0], "https://example.test");
  assert.equal(config.pathname, `/api/public/lottery/${code}/share-config`);
  assert.equal(config.searchParams.get("url"), url);
  assert.ok(calls.every(({ args }) => !/\/draw$/.test(args[0])));
});

test("opening or refreshing the wheel does not invoke its explicit draw handler", () => {
  assert.equal((publicSource.match(/\bdrawPublicLottery\s*\(/g) || []).length, 1);
  const drawStart = publicSource.indexOf("const handleDraw = async () => {");
  const drawEnd = publicSource.indexOf("if (loading) return <LoadingPage", drawStart);
  assert.ok(drawStart > 0 && drawEnd > drawStart);
  assert.match(publicSource.slice(drawStart, drawEnd), /await drawPublicLottery\(code, pending\.requestId, pending\.expectedSequence\)/);
  assert.match(publicSource, /onDraw=\{handleDraw\}/);
  assert.doesNotMatch(publicSource, /\bhandleDraw\s*\(/);
});

test("native card sharing keeps the same customer URL and no employee credentials", () => {
  const share = {
    title: "专属好礼", description: "一份好运", image: "https://example.test/card.jpg",
    url: "https://example.test/share/lottery/customer-1?card=3",
  };
  const card = customerCardPayload(share, "customer-1");
  assert.equal(card.link, share.url);
  assert.equal(card.imgUrl, share.image);
  assert.throws(() => customerCardPayload(share, "customer-2"));
  for (const url of [
    "https://example.test/lottery-share/customer-1#ticket=employee-secret",
    `${share.url}&ticket=employee-secret`,
    `${share.url}#ticket=employee-secret`,
  ]) assert.throws(() => customerCardPayload({ ...share, url }, "customer-1"));
});

test("the credential-bearing legacy preview keeps its independent forwarding guard", () => {
  const source = readSource("../LotterySharePreviewPage.jsx");
  assert.match(source, /hideOptionMenu/);
  assert.match(source, /window\.history\.replaceState\(/);
  assert.match(source, /window\.location\.replace\(destination\)/);
  assert.match(source, /releasePreviewBootstrap/);
});
