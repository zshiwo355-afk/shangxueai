-- 读书打卡录音存 OSS + 转文字：为 magic_audio_uploads 增加录音 OSS 与转写相关列。
-- 幂等：列已存在则跳过，可重复执行。

SET @db_name := DATABASE();

-- 录音 OSS 对象 key
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `audio_object_key` varchar(512) NOT NULL DEFAULT '''' COMMENT ''录音OSS对象key'' AFTER `image_size`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'audio_object_key'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 录音 URL（留空，实际播放走签名 URL）
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `audio_url` varchar(1024) NOT NULL DEFAULT '''' COMMENT ''录音URL'' AFTER `audio_object_key`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'audio_url'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 转写文本
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `transcript_text` longtext NULL COMMENT ''录音转写文本'' AFTER `audio_url`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'transcript_text'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 转写状态：'' 未转 / processing / done / failed
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `transcript_status` varchar(16) NOT NULL DEFAULT '''' COMMENT ''转写状态:processing/done/failed'' AFTER `transcript_text`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'transcript_status'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 转写失败原因
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `transcript_error` varchar(512) NOT NULL DEFAULT '''' COMMENT ''转写失败原因'' AFTER `transcript_status`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'transcript_error'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 转写完成时间
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `transcribed_at` datetime NULL COMMENT ''转写完成时间'' AFTER `transcript_error`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'transcribed_at'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
