SET NAMES utf8mb4;

ALTER TABLE `users`
  MODIFY COLUMN `role` VARCHAR(16) NOT NULL DEFAULT 'user' COMMENT 'super_admin / admin / user';

SET @db_name = DATABASE();

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_video_progress'
    AND COLUMN_NAME = 'progress_source'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_video_progress` ADD COLUMN `progress_source` VARCHAR(32) NOT NULL DEFAULT 'manual' AFTER `answer_attempt_count`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_video_progress'
    AND COLUMN_NAME = 'completed_by_whitelist'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_video_progress` ADD COLUMN `completed_by_whitelist` TINYINT(1) NOT NULL DEFAULT 0 AFTER `progress_source`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_quiz_answers'
    AND COLUMN_NAME = 'answer_source'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_quiz_answers` ADD COLUMN `answer_source` VARCHAR(32) NOT NULL DEFAULT 'manual' AFTER `score`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_quiz_answers'
    AND COLUMN_NAME = 'auto_correct_by_whitelist'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_quiz_answers` ADD COLUMN `auto_correct_by_whitelist` TINYINT(1) NOT NULL DEFAULT 0 AFTER `answer_source`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_quiz_point_pass_records'
    AND COLUMN_NAME = 'source'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_quiz_point_pass_records` ADD COLUMN `source` VARCHAR(32) NOT NULL DEFAULT 'manual' AFTER `passed`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_audio_uploads'
    AND COLUMN_NAME = 'source'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_audio_uploads` ADD COLUMN `source` VARCHAR(32) NOT NULL DEFAULT 'manual' AFTER `remark`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_audio_uploads'
    AND COLUMN_NAME = 'auto_checkin_by_whitelist'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_audio_uploads` ADD COLUMN `auto_checkin_by_whitelist` TINYINT(1) NOT NULL DEFAULT 0 AFTER `source`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `user_whitelist` (
  `id`                    BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`               BIGINT       NOT NULL,
  `enabled`               TINYINT(1)   NOT NULL DEFAULT 1,
  `auto_checkin_enabled`  TINYINT(1)   NOT NULL DEFAULT 0,
  `course_exempt_enabled` TINYINT(1)   NOT NULL DEFAULT 0,
  `allow_video_seek`      TINYINT(1)   NOT NULL DEFAULT 0,
  `auto_answer_correct`   TINYINT(1)   NOT NULL DEFAULT 0,
  `remark`                VARCHAR(255) NOT NULL DEFAULT '',
  `created_by`            BIGINT       NOT NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_whitelist_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户白名单能力配置';
