SET @quiz_version_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'magic_videos'
    AND COLUMN_NAME = 'quiz_version'
);
SET @quiz_version_sql := IF(
  @quiz_version_exists = 0,
  'ALTER TABLE `magic_videos` ADD COLUMN `quiz_version` INT NOT NULL DEFAULT 1 AFTER `upload_id`',
  'SELECT 1'
);
PREPARE magic_videos_stmt FROM @quiz_version_sql;
EXECUTE magic_videos_stmt;
DEALLOCATE PREPARE magic_videos_stmt;

SET @progress_quiz_version_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'magic_video_progress'
    AND COLUMN_NAME = 'quiz_version'
);
SET @progress_quiz_version_sql := IF(
  @progress_quiz_version_exists = 0,
  'ALTER TABLE `magic_video_progress` ADD COLUMN `quiz_version` INT NOT NULL DEFAULT 1 AFTER `quiz_passed`',
  'SELECT 1'
);
PREPARE magic_video_progress_stmt FROM @progress_quiz_version_sql;
EXECUTE magic_video_progress_stmt;
DEALLOCATE PREPARE magic_video_progress_stmt;
