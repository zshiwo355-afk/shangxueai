-- 读书打卡录音/图片文件保留期支持。
-- 仅清理 OSS / 本地文件，magic_audio_uploads 业务记录继续用于完成统计和审计。

SET @db_name = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db_name
      AND TABLE_NAME = 'magic_audio_uploads'
      AND COLUMN_NAME = 'media_purged_at'
  ),
  'SELECT 1',
  'ALTER TABLE `magic_audio_uploads` ADD COLUMN `media_purged_at` datetime NULL COMMENT ''录音和图片文件实际清理时间，业务打卡记录仍保留'' AFTER `deleted_at`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db_name
      AND TABLE_NAME = 'magic_audio_uploads'
      AND INDEX_NAME = 'idx_magic_audio_uploads_media_retention'
  ),
  'SELECT 1',
  'CREATE INDEX `idx_magic_audio_uploads_media_retention` ON `magic_audio_uploads` (`media_purged_at`, `uploaded_on`)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
