import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addStaffUsers,
  applyStaffEnabled,
  normalizeStaffSelection,
  selectableStaffIds,
  staffPermissionPayload,
} from "./lottery-staff-utils.js";

test("single and department additions grant access directly without quota configuration", () => {
  const existing = Object.freeze({ user_id: 1, enabled: true, link_quota: 17, max_chances_per_link: 3 });
  const users = [{ id: 1 }, { id: 2, real_name: "员工二", department: "销售/一组" }, { id: 3, real_name: "员工三" }];
  const result = addStaffUsers([existing], users);
  assert.equal(result.addedCount, 2);
  assert.equal(result.reenabledCount, 0);
  assert.equal(result.rows[0], existing);
  assert.equal(result.rows[1].enabled, true);
  assert.equal(result.rows[1].department, "销售/一组");
  assert.equal(Object.hasOwn(result.rows[1], "link_quota"), false);
  assert.deepEqual(addStaffUsers([existing], [users[1]]).rows[1], result.rows[1]);
});

test("department additions re-enable explicitly chosen employees but never disabled accounts", () => {
  const rows = [
    Object.freeze({ user_id: 1, enabled: false }),
    Object.freeze({ user_id: 2, enabled: false, user_disabled: true }),
    Object.freeze({ user_id: 4, enabled: false }),
  ];
  const result = addStaffUsers(rows, [{ id: 1 }, { id: 2 }, { id: 3, disabled: true }]);
  assert.equal(result.addedCount, 0);
  assert.equal(result.reenabledCount, 1);
  assert.deepEqual(result.rows[0], { ...rows[0], enabled: true });
  assert.equal(result.rows[1], rows[1]);
  assert.equal(result.rows[2], rows[2]);
  assert.equal(rows[0].enabled, false);
});

test("repeated department or search additions never duplicate employees", () => {
  const users = [{ id: 1, real_name: "员工一" }, { id: "1", real_name: "员工一" }, { id: 2 }];
  const first = addStaffUsers([], users);
  assert.equal(first.addedCount, 2);
  const again = addStaffUsers(first.rows, users);
  assert.equal(again.addedCount, 0);
  assert.equal(again.reenabledCount, 0);
  assert.deepEqual(again.rows, first.rows);
});

test("bulk status application honors cross-page keys and leaves all unselected rows untouched", () => {
  const rows = Array.from({ length: 105 }, (_, index) => Object.freeze({ user_id: index + 1, enabled: true, note: `row-${index + 1}` }));
  const selectedAcrossPages = [1, "21", 101];
  const result = applyStaffEnabled(rows, selectedAcrossPages, false);
  for (let index = 0; index < rows.length; index += 1) {
    if ([0, 20, 100].includes(index)) assert.deepEqual(result[index], { ...rows[index], enabled: false });
    else assert.equal(result[index], rows[index]);
  }
  assert.deepEqual(normalizeStaffSelection(rows, selectedAcrossPages), ["1", "21", "101"]);
  assert.equal(applyStaffEnabled(result, [21], true)[20].enabled, true);
});

test("select-all excludes disabled accounts and removes stale or duplicate selection keys", () => {
  const rows = [{ user_id: 1, enabled: false }, { user_id: 2, user_disabled: true, enabled: false }, { user_id: 3, enabled: true }];
  assert.deepEqual(selectableStaffIds(rows), ["1", "3"]);
  assert.deepEqual(normalizeStaffSelection(rows, [1, "1", 2, 3, 999]), ["1", "3"]);
  assert.deepEqual(normalizeStaffSelection(rows.slice(1), [1, 2, 3]), ["3"]);
  assert.deepEqual(normalizeStaffSelection([], [1, 3]), []);
  const result = applyStaffEnabled(rows, [1, 2, 3], true);
  assert.equal(result[1], rows[1]);
  assert.equal(result[1].enabled, false);
});

test("malformed bulk status is ignored instead of accidentally granting access", () => {
  const rows = [{ user_id: 1, enabled: false }];
  for (const status of [undefined, null, "true", 1, {}]) assert.equal(applyStaffEnabled(rows, [1], status), rows);
});

test("save payload clears obsolete limits without trusting historical quota values", () => {
  for (const quota of [undefined, null, "", "abc", -1, 1.5, 10, 100001]) {
    const row = Object.freeze({ user_id: 7, enabled: true, link_quota: quota, max_chances_per_link: 100 });
    assert.deepEqual(staffPermissionPayload(row), { user_id: 7, enabled: true, link_quota: 0, max_chances_per_link: 1 });
    assert.equal(row.link_quota, quota);
  }
  assert.equal(staffPermissionPayload({ user_id: 7, enabled: false }).enabled, false);
  assert.equal(staffPermissionPayload({ user_id: 7, user_disabled: true, enabled: true }).enabled, false);
});

test("staff UI exposes authorization only and preserves saving, pagination, and draft protection", () => {
  const source = readFileSync(new URL("./LotteryAdminPage.jsx", import.meta.url), "utf8");
  const staffPanel = source.slice(source.indexOf("function StaffPanel("), source.indexOf("function LinkShareModal("));
  assert.doesNotMatch(staffPanel, /可建链接数|统一设置|统一额度|单链接抽奖规则|link_quota|InputNumber/);
  assert.match(staffPanel, /按部门添加员工/);
  assert.match(staffPanel, /批量启用/);
  assert.match(staffPanel, /批量停用/);
  assert.match(staffPanel, /preserveSelectedRowKeys: true/);
  assert.match(staffPanel, /pageSizeOptions: \[10, 20, 50, 100\]/);
  assert.match(staffPanel, /重新加载会放弃当前未保存的授权修改/);
  assert.match(staffPanel, /rows\.map\(staffPermissionPayload\)/);
  assert.doesNotMatch(source, /name="max_links_per_employee"|label="员工建链上限"/);
});
