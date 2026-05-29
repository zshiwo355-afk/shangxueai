ALTER TABLE `magic_videos`
  ADD COLUMN `cover_asset_id` bigint DEFAULT NULL AFTER `cover_url`,
  ADD KEY `idx_magic_videos_cover_asset` (`cover_asset_id`) USING BTREE;
