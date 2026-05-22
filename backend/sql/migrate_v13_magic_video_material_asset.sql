START TRANSACTION;

ALTER TABLE `magic_videos`
  ADD COLUMN `material_asset_id` BIGINT NULL DEFAULT NULL AFTER `transcode_status`,
  ADD KEY `idx_magic_videos_material_asset` (`material_asset_id`);

COMMIT;
