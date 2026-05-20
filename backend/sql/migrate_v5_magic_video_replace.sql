ALTER TABLE `magic_videos`
  ADD COLUMN `replacement_upload_id` VARCHAR(255) NOT NULL DEFAULT '' AFTER `transcode_status`,
  ADD COLUMN `replacement_object_key` VARCHAR(1024) NOT NULL DEFAULT '' AFTER `replacement_upload_id`,
  ADD COLUMN `replacement_original_filename` VARCHAR(255) NOT NULL DEFAULT '' AFTER `replacement_object_key`,
  ADD COLUMN `replacement_mime_type` VARCHAR(128) NOT NULL DEFAULT '' AFTER `replacement_original_filename`,
  ADD COLUMN `replacement_file_size` BIGINT NOT NULL DEFAULT 0 AFTER `replacement_mime_type`,
  ADD COLUMN `replacement_duration_seconds` INT NOT NULL DEFAULT 0 AFTER `replacement_file_size`;
