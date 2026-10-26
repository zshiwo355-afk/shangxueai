import assert from "node:assert/strict";
import test from "node:test";
import { grantRequest, productFormPayload, productUpdatePayload, validMallImageUrl, validMallPoints } from "./mall-admin-utils.js";

test("库存恢复旧值时，旧编辑和上下架重试仍提交打开时的版本", () => {
  const opened = { id: 1, stock: 1, version: 1 };
  const afterUpdateAndRedemption = { id: 1, stock: 1, version: 3 };
  for (const change of [{ stock: 2 }, { stock: 1, enabled: false }]) {
    const retry = productUpdatePayload(opened, change);
    assert.equal(retry.expected_version, 1);
    assert.notEqual(retry.expected_version, afterUpdateAndRedemption.version);
    assert.equal("expected_stock" in retry, false);
    assert.equal(productUpdatePayload(afterUpdateAndRedemption, change).expected_version, 3);
  }
  assert.deepEqual(opened, { id: 1, stock: 1, version: 1 });
});

test("商品按正整数积分定价，不接受小数或超出金额上限的积分", () => {
  for (const value of [1, 5, 100, 100000000]) assert.equal(validMallPoints(value), true);
  for (const value of [0, -1, 1.5, 100000001, NaN, Infinity, "5", null, undefined]) {
    assert.equal(validMallPoints(value), false);
    assert.throws(() => productFormPayload({ name: "商品", points_cost: value }), /兑换积分/);
  }
});

test("新增和编辑统一将5积分保存为100元，重开编辑不重复换算", () => {
  const form = { name: " 保温杯 ", description: " 前台领取 ", image_url: "", points_cost: 5, stock: 2, enabled: true };
  const payload = productFormPayload(form);
  assert.deepEqual(payload, { name: "保温杯", description: "前台领取", image_url: "", price_yuan: 100, stock: 2, enabled: true });
  assert.equal(form.points_cost, 5);
  const saved = { ...payload, id: 1, points_cost: 5, version: 2 };
  const updated = productUpdatePayload(saved, productFormPayload({ ...form, points_cost: saved.points_cost }));
  assert.equal(updated.price_yuan, 100);
  assert.equal(updated.expected_version, 2);
  assert.equal("points_cost" in updated, false);
  assert.equal(productFormPayload({ ...form, points_cost: 6 }).price_yuan, 120);
  assert.equal(productFormPayload({ ...form, points_cost: 100000000 }).price_yuan, 2000000000);
});

test("同一发放失败重试保持request_id，修改任何发放内容重新生成", () => {
  let sequence = 0;
  const id = () => `request-${++sequence}`;
  const payload = { user_id: 3, points: 10, remark: "学习奖励" };
  const first = grantRequest(null, payload, id);
  assert.equal(grantRequest(first, { ...payload }, id), first);
  for (const change of [{ user_id: 4 }, { points: 20 }, { remark: "活动奖励" }]) {
    const next = grantRequest(first, { ...payload, ...change }, id);
    assert.notEqual(next.payload.request_id, first.payload.request_id);
    assert.equal(next.payload.user_id, change.user_id ?? payload.user_id);
  }
  assert.deepEqual(payload, { user_id: 3, points: 10, remark: "学习奖励" });
});

test("图片仅允许安全HTTPS地址或商城图片路径", () => {
  assert.equal(validMallImageUrl(""), true);
  assert.equal(validMallImageUrl("https://example.com/product.png"), true);
  assert.equal(validMallImageUrl("/assets/mall/product.png"), true);
  for (const url of ["javascript:alert(1)", "data:image/png;base64,abc", "//example.com/p.png", "http://example.com/p.png", "https://user:password@example.com/p.png", "/api/materials/1?access_token=secret", "/assets/%2e%2e/file", "https://example.com/image.png#secret", "/assets/%5cfile", "/assets/image%00.png"]) {
    assert.equal(validMallImageUrl(url), false, url);
  }
});
