import assert from "node:assert/strict";
import test from "node:test";
import { LOTTERY_PAGE_OPTIONS, loadAllLotteryCampaigns, loadLotteryPage, lotteryPageRequest } from "./lottery-pagination.js";

test("page controls support all sizes and changing page size returns to page one", () => {
  assert.deepEqual(LOTTERY_PAGE_OPTIONS.pageSizeOptions, [10, 20, 50, 100]);
  assert.equal(LOTTERY_PAGE_OPTIONS.showQuickJumper, true);
  assert.deepEqual(lotteryPageRequest(4, 10, 10), { current: 4, pageSize: 10 });
  assert.deepEqual(lotteryPageRequest(4, 20, 10), { current: 1, pageSize: 20 });
  assert.deepEqual(lotteryPageRequest(0, 500, 10), { current: 1, pageSize: 100 });
});

test("record lists preserve server totals and requested page", async () => {
  const result = await loadLotteryPage(async (params) => {
    assert.deepEqual(params, { page: 3, page_size: 20 });
    return { items: [{ id: 41 }], total: 41, missing_claim_count: 2 };
  }, { current: 3, pageSize: 20 });
  assert.deepEqual(result.pagination, { current: 3, pageSize: 20, total: 41 });
  assert.equal(result.data.missing_claim_count, 2);
  assert.deepEqual(result.items, [{ id: 41 }]);
});

test("an emptied final page returns to the new last page", async () => {
  const pages = [];
  const result = await loadLotteryPage(async ({ page }) => {
    pages.push(page);
    return { items: page === 3 ? [] : [{ id: 11 }], total: 11 };
  }, { current: 3, pageSize: 10 });
  assert.deepEqual(pages, [3, 2]);
  assert.equal(result.pagination.current, 2);
});

test("repeated shrink is bounded and zero total returns to page one", async () => {
  const pages = [];
  const result = await loadLotteryPage(async ({ page }) => {
    pages.push(page);
    return { items: [], total: pages.length === 1 ? 20 : 0 };
  }, { current: 4, pageSize: 10 });
  assert.deepEqual(pages, [4, 2, 1]);
  assert.deepEqual(result.pagination, { current: 1, pageSize: 10, total: 0 });
});

test("superseded record responses are discarded without starting fallback requests", async () => {
  let current = true;
  let calls = 0;
  const result = await loadLotteryPage(async () => {
    calls += 1;
    current = false;
    return { items: [], total: 0 };
  }, { current: 3, pageSize: 10 }, () => current);
  assert.equal(result, null);
  assert.equal(calls, 1);
});

test("an older slow page cannot replace a newer completed page", async () => {
  let activeRequest = 1;
  let finishOldRequest;
  const oldResponse = new Promise((resolve) => { finishOldRequest = resolve; });
  const oldPage = loadLotteryPage(() => oldResponse, { current: 1, pageSize: 10 }, () => activeRequest === 1);
  activeRequest = 2;
  const newPage = await loadLotteryPage(async () => ({ items: [{ id: 11 }], total: 11 }), { current: 2, pageSize: 10 }, () => activeRequest === 2);
  finishOldRequest({ items: [{ id: 1 }], total: 11 });
  assert.equal(await oldPage, null);
  assert.equal(newPage.pagination.current, 2);
  assert.deepEqual(newPage.items, [{ id: 11 }]);
});

test("request failures remain failures rather than empty successful pages", async () => {
  await assert.rejects(loadLotteryPage(async () => { throw new Error("offline"); }, { current: 1, pageSize: 10 }), /offline/);
});

test("activity selector includes entries beyond 100 and deduplicates shifting pages", async () => {
  const calls = [];
  const result = await loadAllLotteryCampaigns(async ({ page, page_size }) => {
    calls.push({ page, page_size });
    return { items: page === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) : [{ id: 100 }, { id: 101 }], total: 101 };
  });
  assert.deepEqual(calls, [{ page: 1, page_size: 100 }, { page: 2, page_size: 100 }]);
  assert.equal(result.length, 101);
  assert.equal(result.at(-1).id, 101);
});

test("superseded activity list does not continue downloading further pages", async () => {
  let current = true;
  let calls = 0;
  const result = await loadAllLotteryCampaigns(async () => {
    calls += 1;
    current = false;
    return { items: [{ id: 1 }], total: 150 };
  }, () => current);
  assert.equal(result, null);
  assert.equal(calls, 1);
});
