SET @db_name := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD COLUMN `hls_object_prefix` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''HLS切片OSS前缀'' AFTER `hls_url`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_videos' AND COLUMN_NAME = 'hls_object_prefix'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD COLUMN `transcode_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''转码失败原因'' AFTER `transcode_status`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_videos' AND COLUMN_NAME = 'transcode_error'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD COLUMN `transcoded_at` datetime NULL COMMENT ''转码完成时间'' AFTER `transcode_error`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_videos' AND COLUMN_NAME = 'transcoded_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
