import test from "node:test";
import assert from "node:assert/strict";
import { createRedemptionRequest, newRedemptionRequestId, redemptionBlockReason } from "./mall-utils.js";

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
