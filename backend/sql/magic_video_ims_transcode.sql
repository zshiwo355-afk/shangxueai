SET @db_name := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD COLUMN `transcode_provider` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '''' AFTER `transcoded_at`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_videos' AND COLUMN_NAME = 'transcode_provider'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD COLUMN `transcode_job_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '''' AFTER `transcode_provider`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_videos' AND COLUMN_NAME = 'transcode_job_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD COLUMN `transcode_output_prefix` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER `transcode_job_id`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_videos' AND COLUMN_NAME = 'transcode_output_prefix'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD COLUMN `transcode_output_key` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER `transcode_output_prefix`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_videos' AND COLUMN_NAME = 'transcode_output_key'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD COLUMN `transcode_progress` int NOT NULL DEFAULT ''0'' AFTER `transcode_output_key`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_videos' AND COLUMN_NAME = 'transcode_progress'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD COLUMN `transcode_started_at` datetime NULL AFTER `transcode_progress`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_videos' AND COLUMN_NAME = 'transcode_started_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE `magic_videos`
  MODIFY COLUMN `transcode_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none'
  COMMENT 'none / pending / processing / completed / failed / cancelled';
