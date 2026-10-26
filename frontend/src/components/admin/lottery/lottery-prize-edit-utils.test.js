import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prizeEditPayload, prizeEditSnapshot } from "./lottery-prize-edit-utils.js";

const values = { name: " 礼盒 ", description: "新说明", type: "physical", sort_order: 3, stock_total: 50, probability_percent: 25, enabled: true, image_url: "https://example.test/prize.jpg", image_object_key: "a.jpg", image_material_asset_id: 9 };

test("optional cleared sort order uses the default instead of sending null", () => {
  const data = prizeEditPayload({ ...values, sort_order: null }, { existing: true, published: true, configVersion: 3 });
  assert.equal(data.sort_order, 0);
});

test("live prize edits send the frozen version and metadata, never allocation fields", () => {
  const data = prizeEditPayload(values, { existing: true, published: true, configVersion: 8 });
  assert.equal(data.config_version, 8);
  assert.equal(data.name, "礼盒");
  assert.equal(data.stock_total, 50);
  assert.equal(data.image_material_asset_id, 9);
  assert.ok(!Object.hasOwn(data, "probability_ppm"));
  assert.ok(!Object.hasOwn(data, "enabled"));
  assert.ok(!Object.hasOwn(data, "probability_percent"));
});

test("editor snapshots do not silently adopt newer background campaign versions", () => {
  const row = { id: 1, name: "原名称", stock_total: 10 };
  const campaign = { config_version: 8, status: "published" };
  const snapshot = prizeEditSnapshot(row, campaign);
  campaign.config_version = 9;
  campaign.status = "paused";
  row.name = "其他管理员修改";
  assert.equal(snapshot.configVersion, 8);
  assert.equal(snapshot.published, true);
  assert.equal(snapshot.prize.name, "原名称");
});

test("draft editing and creation preserve probability and enabled configuration", () => {
  const update = prizeEditPayload(values, { existing: true, published: false, configVersion: 3 });
  assert.equal(update.probability_ppm, 250000);
  assert.equal(update.enabled, true);
  assert.equal(update.config_version, 3);
  const create = prizeEditPayload({ ...values, enabled: false }, { existing: false, published: false });
  assert.equal(create.enabled, false);
  assert.ok(!Object.hasOwn(create, "config_version"));
  assert.throws(() => prizeEditPayload({ ...values, probability_percent: "wrong" }, { existing: false }));
});

test("clearing prize artwork sends all empty references and does not carry unrelated fields", () => {
  const data = prizeEditPayload({ ...values, image_url: "", image_object_key: "", image_material_asset_id: null, stock_awarded: 0, campaign_id: 999 }, { existing: true, published: true, configVersion: 3 });
  assert.equal(data.image_url, "");
  assert.equal(data.image_object_key, "");
  assert.equal(data.image_material_asset_id, null);
  assert.ok(!Object.hasOwn(data, "stock_awarded"));
  assert.ok(!Object.hasOwn(data, "campaign_id"));
});

test("published prize edit buttons stay enabled while archive and allocation guards remain", () => {
  const source = readFileSync(new URL("./LotteryAdminPage.jsx", import.meta.url), "utf8");
  assert.match(source, /disabled=\{archived \|\| loading\}[^\n]*setEditing\(prizeEditSnapshot\(row, campaign\)\)/);
  assert.match(source, /configVersion=\{editing\?\.configVersion\}/);
  assert.match(source, /<InputNumber disabled=\{published\}/);
  assert.match(source, /<Switch disabled=\{published\}/);
  assert.match(source, /disabled=\{editingLocked \|\| loading\}/);
});
