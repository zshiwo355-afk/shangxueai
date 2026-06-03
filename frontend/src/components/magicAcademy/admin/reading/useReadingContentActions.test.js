import test from "node:test";
import assert from "node:assert/strict";

import { createReadingContentActions } from "./useReadingContentActions.js";

test("warns instead of deleting locked reading content", async () => {
  const calls = [];
  const actions = createReadingContentActions({
    deleteAdminReadingContent: async () => calls.push("delete"),
    batchDeleteAdminReadingContents: async () => ({}),
    batchUpdateAdminReadingContentsStatus: async () => ({}),
    reloadReadingContents: async () => calls.push("reload"),
    selectedReadingContentRowKeys: [],
    message: {
      warning: (text) => calls.push(["warning", text]),
      success: (text) => calls.push(["success", text]),
      error: (text) => calls.push(["error", text]),
    },
  });

  await actions.handleDeleteReadingContent({ id: 1, has_checkins: true });

  assert.deepEqual(calls, [["warning", "该内容已有打卡记录，不允许删除，请使用停用。"]]);
});

test("deletes a reading content and reloads the same list", async () => {
  const calls = [];
  const actions = createReadingContentActions({
    deleteAdminReadingContent: async (id) => calls.push(["delete", id]),
    batchDeleteAdminReadingContents: async () => ({}),
    batchUpdateAdminReadingContentsStatus: async () => ({}),
    reloadReadingContents: async () => calls.push("reload"),
    selectedReadingContentRowKeys: [],
    message: {
      warning: (text) => calls.push(["warning", text]),
      success: (text) => calls.push(["success", text]),
      error: (text) => calls.push(["error", text]),
    },
  });

  await actions.handleDeleteReadingContent({ id: 3, has_checkins: false, is_locked: false });

  assert.deepEqual(calls, [["delete", 3], ["success", "读书内容已删除。"], "reload"]);
});

test("warns when batch delete runs without any selected rows", async () => {
  const calls = [];
  const actions = createReadingContentActions({
    deleteAdminReadingContent: async () => {},
    batchDeleteAdminReadingContents: async () => ({}),
    batchUpdateAdminReadingContentsStatus: async () => ({}),
    reloadReadingContents: async () => calls.push("reload"),
    selectedReadingContentRowKeys: [],
    message: {
      warning: (text) => calls.push(["warning", text]),
      success: (text) => calls.push(["success", text]),
      error: (text) => calls.push(["error", text]),
    },
  });

  await actions.handleBatchDeleteReadingContents();

  assert.deepEqual(calls, [["warning", "请先选择要删除的读书内容。"]]);
});

test("keeps batch delete and batch disable success wording unchanged and reloads afterwards", async () => {
  const calls = [];
  const actions = createReadingContentActions({
    deleteAdminReadingContent: async () => {},
    batchDeleteAdminReadingContents: async (ids) => {
      calls.push(["batchDelete", ids]);
      return { deleted_ids: [1, 2], skipped: [3] };
    },
    batchUpdateAdminReadingContentsStatus: async (ids, status) => {
      calls.push(["batchDisable", ids, status]);
      return { updated_ids: [1], skipped: [2] };
    },
    reloadReadingContents: async () => calls.push("reload"),
    selectedReadingContentRowKeys: [1, 2, 3],
    message: {
      warning: (text) => calls.push(["warning", text]),
      success: (text) => calls.push(["success", text]),
      error: (text) => calls.push(["error", text]),
    },
  });

  await actions.handleBatchDeleteReadingContents();
  await actions.handleBatchDisableReadingContents();

  assert.deepEqual(calls, [
    ["batchDelete", [1, 2, 3]],
    ["success", "已删除 2 条，跳过 1 条。"],
    "reload",
    ["batchDisable", [1, 2, 3], "disabled"],
    ["success", "已停用 1 条，跳过 1 条。"],
    "reload",
  ]);
});

test("toggles a reading content status with unchanged success wording and reloads afterwards", async () => {
  const calls = [];
  const actions = createReadingContentActions({
    deleteAdminReadingContent: async () => {},
    batchDeleteAdminReadingContents: async () => ({}),
    batchUpdateAdminReadingContentsStatus: async () => ({}),
    updateAdminReadingContentStatus: async (id, status) => {
      calls.push(["toggle", id, status]);
    },
    reloadReadingContents: async () => calls.push("reload"),
    selectedReadingContentRowKeys: [],
    message: {
      warning: (text) => calls.push(["warning", text]),
      success: (text) => calls.push(["success", text]),
      error: (text) => calls.push(["error", text]),
    },
  });

  await actions.handleToggleReadingContentStatus({ id: 8, status: "active" });
  await actions.handleToggleReadingContentStatus({ id: 9, status: "disabled" });

  assert.deepEqual(calls, [
    ["toggle", 8, "disabled"],
    ["success", "读书内容已停用。"],
    "reload",
    ["toggle", 9, "active"],
    ["success", "读书内容已启用。"],
    "reload",
  ]);
});
