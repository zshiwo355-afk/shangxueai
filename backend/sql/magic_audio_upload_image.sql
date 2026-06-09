-- 读书打卡支持图片：为 magic_audio_uploads 增加图片相关列（录音/图片至少其一）。

SET @db_name := DATABASE();

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `image_object_key` varchar(512) NOT NULL DEFAULT '''' COMMENT ''打卡图片OSS对象key'' AFTER `mime_type`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'image_object_key'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `image_url` varchar(1024) NOT NULL DEFAULT '''' COMMENT ''打卡图片URL'' AFTER `image_object_key`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'image_url'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `image_file_name` varchar(255) NOT NULL DEFAULT '''' COMMENT ''打卡图片文件名'' AFTER `image_url`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'image_file_name'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `image_mime_type` varchar(128) NOT NULL DEFAULT '''' COMMENT ''打卡图片MIME类型'' AFTER `image_file_name`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'image_mime_type'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `image_size` bigint NOT NULL DEFAULT 0 COMMENT ''打卡图片字节大小'' AFTER `image_mime_type`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'image_size'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
