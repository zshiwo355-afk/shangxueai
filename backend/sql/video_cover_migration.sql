ALTER TABLE `magic_videos`
  ADD COLUMN `cover_url` varchar(2048) DEFAULT NULL AFTER `hls_url`;

ALTER TABLE `material_assets`
  ADD COLUMN `cover_url` varchar(2048) NOT NULL DEFAULT '' AFTER `object_key`;
