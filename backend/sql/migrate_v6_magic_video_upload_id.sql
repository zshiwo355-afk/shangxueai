ALTER TABLE `magic_videos`
  ADD COLUMN `upload_id` VARCHAR(255) NOT NULL DEFAULT '' AFTER `upload_status`;
