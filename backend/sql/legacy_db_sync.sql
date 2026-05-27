SET NAMES utf8mb4;

-- Legacy DB sync script:
-- bring an older database up to the schema level already reflected
-- in full_install.sql for the latest main branch.

SET @db_name = DATABASE();

ALTER TABLE `users`
  MODIFY COLUMN `role` VARCHAR(16) NOT NULL DEFAULT 'user' COMMENT 'super_admin / admin / user';

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
    AND TABLE_NAME = 'magic_audio_uploads'
    AND COLUMN_NAME = 'reading_content_id'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_audio_uploads` ADD COLUMN `reading_content_id` BIGINT NULL DEFAULT NULL AFTER `user_id`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_audio_uploads'
    AND INDEX_NAME = 'idx_magic_audio_uploads_reading_content_id'
);
SET @sql = IF(
  @idx_exists = 0,
  "ALTER TABLE `magic_audio_uploads` ADD KEY `idx_magic_audio_uploads_reading_content_id` (`reading_content_id`)",
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
    AND COLUMN_NAME = 'active_reading_content_id'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_audio_uploads` ADD COLUMN `active_reading_content_id` BIGINT GENERATED ALWAYS AS (CASE WHEN `is_deleted` = 0 THEN `reading_content_id` ELSE NULL END) STORED AFTER `reading_content_id`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `magic_audio_uploads` dup
JOIN (
  SELECT `user_id`, `reading_content_id`, MIN(`id`) AS `keep_id`
  FROM `magic_audio_uploads`
  WHERE `is_deleted` = 0
    AND `reading_content_id` IS NOT NULL
  GROUP BY `user_id`, `reading_content_id`
  HAVING COUNT(*) > 1
) keepers
  ON keepers.`user_id` = dup.`user_id`
 AND keepers.`reading_content_id` = dup.`reading_content_id`
SET dup.`is_deleted` = 1,
    dup.`deleted_at` = COALESCE(dup.`deleted_at`, NOW()),
    dup.`remark` = CONCAT(
      LEFT(COALESCE(dup.`remark`, ''), 200),
      CASE
        WHEN COALESCE(dup.`remark`, '') = '' THEN ''
        ELSE ' '
      END,
      '[deduped by legacy_db_sync]'
    )
WHERE dup.`is_deleted` = 0
  AND dup.`id` <> keepers.`keep_id`;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_audio_uploads'
    AND INDEX_NAME = 'uk_magic_audio_uploads_user_content'
);
SET @sql = IF(
  @idx_exists = 0,
  "ALTER TABLE `magic_audio_uploads` ADD UNIQUE KEY `uk_magic_audio_uploads_user_content` (`user_id`, `active_reading_content_id`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_audio_uploads'
    AND INDEX_NAME = 'idx_magic_audio_uploads_user_content'
);
SET @sql = IF(
  @idx_exists = 0,
  "ALTER TABLE `magic_audio_uploads` ADD KEY `idx_magic_audio_uploads_user_content` (`user_id`, `reading_content_id`, `is_deleted`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `question_bank` (
  `id`                  BIGINT       NOT NULL AUTO_INCREMENT,
  `question_type`       VARCHAR(16)  NOT NULL COMMENT 'single / multiple / judge / blank / short_answer',
  `stem`                TEXT         NOT NULL,
  `options_json`        LONGTEXT     NULL,
  `correct_answer_json` LONGTEXT     NULL,
  `default_score`       FLOAT        NOT NULL DEFAULT 5,
  `category`            VARCHAR(128) NOT NULL DEFAULT '',
  `tag`                 VARCHAR(255) NOT NULL DEFAULT '',
  `difficulty`          VARCHAR(32)  NOT NULL DEFAULT '',
  `explanation`         TEXT         NULL,
  `status`              VARCHAR(16)  NOT NULL DEFAULT 'active',
  `source`              VARCHAR(32)  NOT NULL DEFAULT 'manual',
  `created_by`          BIGINT       NOT NULL,
  `created_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_question_bank_status_type` (`status`, `question_type`, `created_at`),
  KEY `idx_question_bank_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Question bank';

CREATE TABLE IF NOT EXISTS `papers` (
  `id`                       BIGINT       NOT NULL AUTO_INCREMENT,
  `title`                    VARCHAR(255) NOT NULL,
  `description`              TEXT         NULL,
  `total_score`              FLOAT        NOT NULL DEFAULT 0,
  `pass_score`               FLOAT        NOT NULL DEFAULT 60,
  `duration_minutes`         INT          NOT NULL DEFAULT 0,
  `auto_grade_objective`     TINYINT(1)   NOT NULL DEFAULT 1,
  `manual_review_subjective` TINYINT(1)   NOT NULL DEFAULT 1,
  `shuffle_questions`        TINYINT(1)   NOT NULL DEFAULT 0,
  `show_answer_after`        VARCHAR(16)  NOT NULL DEFAULT 'after_submit',
  `status`                   VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT 'draft / published / archived',
  `question_count`           INT          NOT NULL DEFAULT 0,
  `created_by`               BIGINT       NOT NULL,
  `created_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_papers_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Paper templates';

CREATE TABLE IF NOT EXISTS `paper_questions` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `paper_id`       BIGINT       NOT NULL,
  `question_id`    BIGINT       NOT NULL,
  `score_override` FLOAT        NULL DEFAULT NULL,
  `sort_order`     INT          NOT NULL DEFAULT 0,
  `section_name`   VARCHAR(128) NOT NULL DEFAULT '',
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_questions_paper_q` (`paper_id`, `question_id`),
  KEY `idx_paper_questions_paper_sort` (`paper_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Paper question bindings';

CREATE TABLE IF NOT EXISTS `paper_assignments` (
  `id`                       BIGINT       NOT NULL AUTO_INCREMENT,
  `paper_id`                 BIGINT       NOT NULL,
  `user_id`                  BIGINT       NOT NULL,
  `max_attempts`             INT          NOT NULL DEFAULT 1,
  `attempt_count`            INT          NOT NULL DEFAULT 0,
  `deadline_at`              DATETIME     NULL DEFAULT NULL,
  `status`                   VARCHAR(16)  NOT NULL DEFAULT 'pending',
  `wecom_push_status`        VARCHAR(16)  NOT NULL DEFAULT 'none',
  `wecom_push_payload_json`  LONGTEXT     NULL,
  `wecom_push_error`         TEXT         NULL,
  `wecom_pushed_at`          DATETIME     NULL DEFAULT NULL,
  `created_by`               BIGINT       NOT NULL,
  `created_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_assignments_paper_user` (`paper_id`, `user_id`),
  KEY `idx_paper_assignments_user_status` (`user_id`, `status`),
  KEY `idx_paper_assignments_paper_status` (`paper_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Paper assignments';

CREATE TABLE IF NOT EXISTS `paper_submissions` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `assignment_id`  BIGINT       NOT NULL,
  `paper_id`       BIGINT       NOT NULL,
  `user_id`        BIGINT       NOT NULL,
  `attempt_no`     INT          NOT NULL DEFAULT 1,
  `status`         VARCHAR(16)  NOT NULL DEFAULT 'in_progress',
  `auto_score`     FLOAT        NULL DEFAULT NULL,
  `manual_score`   FLOAT        NULL DEFAULT NULL,
  `final_score`    FLOAT        NULL DEFAULT NULL,
  `is_pass`        TINYINT(1)   NULL DEFAULT NULL,
  `started_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `submitted_at`   DATETIME     NULL DEFAULT NULL,
  `graded_at`      DATETIME     NULL DEFAULT NULL,
  `graded_by`      BIGINT       NULL DEFAULT NULL,
  `comment`        TEXT         NULL,
  PRIMARY KEY (`id`),
  KEY `idx_paper_submissions_assign` (`assignment_id`, `attempt_no`),
  KEY `idx_paper_submissions_status` (`status`, `submitted_at`),
  KEY `idx_paper_submissions_user` (`user_id`, `paper_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Paper submissions';

CREATE TABLE IF NOT EXISTS `paper_answers` (
  `id`                BIGINT      NOT NULL AUTO_INCREMENT,
  `submission_id`     BIGINT      NOT NULL,
  `paper_question_id` BIGINT      NOT NULL,
  `question_id`       BIGINT      NOT NULL,
  `question_type`     VARCHAR(16) NOT NULL,
  `answer_json`       LONGTEXT    NULL,
  `auto_score`        FLOAT       NULL DEFAULT NULL,
  `manual_score`      FLOAT       NULL DEFAULT NULL,
  `final_score`       FLOAT       NULL DEFAULT NULL,
  `is_correct`        TINYINT(1)  NULL DEFAULT NULL,
  `comment`           TEXT        NULL,
  `created_at`        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_answers_sub_pq` (`submission_id`, `paper_question_id`),
  KEY `idx_paper_answers_submission` (`submission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Paper answers';

CREATE TABLE IF NOT EXISTS `question_import_jobs` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `created_by`      BIGINT       NOT NULL,
  `source`          VARCHAR(16)  NOT NULL DEFAULT 'excel',
  `original_name`   VARCHAR(255) NOT NULL DEFAULT '',
  `total_rows`      INT          NOT NULL DEFAULT 0,
  `valid_rows`      INT          NOT NULL DEFAULT 0,
  `invalid_rows`    INT          NOT NULL DEFAULT 0,
  `rows_json`       LONGTEXT     NOT NULL,
  `committed`       TINYINT(1)   NOT NULL DEFAULT 0,
  `committed_count` INT          NOT NULL DEFAULT 0,
  `committed_at`    DATETIME     NULL DEFAULT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_question_import_jobs_creator` (`created_by`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Question import jobs';

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

CREATE TABLE IF NOT EXISTS `magic_audio_makeup_settings` (
  `id`           BIGINT     NOT NULL AUTO_INCREMENT,
  `enabled`      TINYINT(1) NOT NULL DEFAULT 0,
  `make_up_days` INT        NOT NULL DEFAULT 0,
  `updated_by`   BIGINT     NULL DEFAULT NULL,
  `created_at`   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Audio makeup settings';

CREATE TABLE IF NOT EXISTS `magic_video_series` (
  `id`                        BIGINT       NOT NULL AUTO_INCREMENT,
  `title`                     VARCHAR(255) NOT NULL,
  `description`               TEXT         NULL,
  `sequential_unlock_enabled` TINYINT(1)   NOT NULL DEFAULT 1,
  `enabled`                   TINYINT(1)   NOT NULL DEFAULT 1,
  `created_by`                BIGINT       NOT NULL,
  `created_at`                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted`                TINYINT(1)   NOT NULL DEFAULT 0,
  `deleted_at`                DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Magic video series';

CREATE TABLE IF NOT EXISTS `magic_video_series_items` (
  `id`         BIGINT   NOT NULL AUTO_INCREMENT,
  `series_id`  BIGINT   NOT NULL,
  `video_id`   BIGINT   NOT NULL,
  `sort_order` INT      NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_video_series_items_video` (`video_id`),
  UNIQUE KEY `uk_magic_video_series_items_series_video` (`series_id`, `video_id`),
  KEY `idx_magic_video_series_items_order` (`series_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Magic video series items';

CREATE TABLE IF NOT EXISTS `magic_video_watch_confirm_settings` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT,
  `video_id`         BIGINT       NOT NULL,
  `enabled`          TINYINT(1)   NOT NULL DEFAULT 0,
  `interval_seconds` INT          NOT NULL DEFAULT 300,
  `message`          VARCHAR(255) NOT NULL DEFAULT 'Please confirm you are still watching the video',
  `button_text`      VARCHAR(64)  NOT NULL DEFAULT 'Continue learning',
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_video_watch_confirm_settings_video` (`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Video watch confirm settings';

CREATE TABLE IF NOT EXISTS `magic_video_watch_confirm_logs` (
  `id`               BIGINT   NOT NULL AUTO_INCREMENT,
  `user_id`          BIGINT   NOT NULL,
  `video_id`         BIGINT   NOT NULL,
  `progress_seconds` FLOAT    NOT NULL DEFAULT 0,
  `confirm_round`    INT      NOT NULL DEFAULT 1,
  `confirmed_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_video_watch_confirm_logs_video_user` (`video_id`, `user_id`, `confirmed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Video watch confirm logs';

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='User whitelist capability settings';

CREATE TABLE IF NOT EXISTS `material_projects` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(255) NOT NULL,
  `description` TEXT         NULL,
  `oss_prefix`  VARCHAR(255) NOT NULL DEFAULT '',
  `visibility`  VARCHAR(16)  NOT NULL DEFAULT 'admin',
  `parent_id`   BIGINT       NULL DEFAULT NULL,
  `sort_order`  INT          NOT NULL DEFAULT 0,
  `created_by`  BIGINT       NOT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted`  TINYINT(1)   NOT NULL DEFAULT 0,
  `deleted_at`  DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_material_projects_creator` (`created_by`, `is_deleted`),
  KEY `idx_material_projects_parent_sort` (`parent_id`, `sort_order`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Material projects';

CREATE TABLE IF NOT EXISTS `material_assets` (
  `id`               BIGINT        NOT NULL AUTO_INCREMENT,
  `project_id`       BIGINT        NOT NULL,
  `sort_order`       INT           NOT NULL DEFAULT 0,
  `name`             VARCHAR(255)  NOT NULL,
  `asset_type`       VARCHAR(32)   NOT NULL DEFAULT 'other',
  `file_name`        VARCHAR(255)  NOT NULL,
  `object_key`       VARCHAR(1024) NOT NULL,
  `mime_type`        VARCHAR(128)  NOT NULL DEFAULT '',
  `file_size`        BIGINT        NOT NULL DEFAULT 0,
  `duration_seconds` INT           NOT NULL DEFAULT 0,
  `remark`           TEXT          NULL,
  `tags`             TEXT          NULL,
  `status`           VARCHAR(16)   NOT NULL DEFAULT 'active',
  `created_by`       BIGINT        NOT NULL,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted`       TINYINT(1)    NOT NULL DEFAULT 0,
  `deleted_at`       DATETIME      NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_material_assets_project_type` (`project_id`, `asset_type`, `is_deleted`),
  KEY `idx_material_assets_project_sort` (`project_id`, `sort_order`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Material assets';

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'material_projects'
    AND COLUMN_NAME = 'parent_id'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `material_projects` ADD COLUMN `parent_id` BIGINT NULL DEFAULT NULL AFTER `visibility`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'material_projects'
    AND COLUMN_NAME = 'sort_order'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `material_projects` ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0 AFTER `parent_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'material_projects'
    AND INDEX_NAME = 'idx_material_projects_parent_sort'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `material_projects` ADD INDEX `idx_material_projects_parent_sort` (`parent_id`, `sort_order`, `is_deleted`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'material_assets'
    AND COLUMN_NAME = 'sort_order'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `material_assets` ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0 AFTER `project_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'material_assets'
    AND INDEX_NAME = 'idx_material_assets_project_sort'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `material_assets` ADD INDEX `idx_material_assets_project_sort` (`project_id`, `sort_order`, `is_deleted`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `magic_reading_series` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `title`       VARCHAR(255) NOT NULL,
  `description` TEXT         NULL,
  `start_date`  DATE         NULL DEFAULT NULL,
  `end_date`    DATE         NULL DEFAULT NULL,
  `status`      VARCHAR(16)  NOT NULL DEFAULT 'draft',
  `created_by`  BIGINT       NOT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_series_status` (`status`, `created_at`),
  KEY `idx_magic_reading_series_date` (`start_date`, `end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reading series';

CREATE TABLE IF NOT EXISTS `magic_reading_series_targets` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `series_id`   BIGINT       NOT NULL,
  `target_type` VARCHAR(32)  NOT NULL,
  `target_id`   VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_series_targets_series` (`series_id`),
  KEY `idx_magic_reading_series_targets_lookup` (`series_id`, `target_type`, `target_id`),
  KEY `idx_magic_reading_series_targets_type_target` (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reading series default targets';

CREATE TABLE IF NOT EXISTS `magic_reading_contents` (
  `id`                BIGINT        NOT NULL AUTO_INCREMENT,
  `series_id`         BIGINT        NULL DEFAULT NULL,
  `reading_date`      DATE          NOT NULL,
  `push_time`         TIME          NULL DEFAULT NULL,
  `push_at`           DATETIME      NULL DEFAULT NULL,
  `makeup_deadline_at` DATETIME     NULL DEFAULT NULL,
  `title`             VARCHAR(255)  NOT NULL,
  `description`       TEXT          NULL,
  `source_type`       VARCHAR(32)   NOT NULL DEFAULT 'upload',
  `material_asset_id` BIGINT        NULL DEFAULT NULL,
  `image_object_key`  VARCHAR(1024) NOT NULL,
  `image_url`         VARCHAR(2048) NOT NULL DEFAULT '',
  `image_file_name`   VARCHAR(255)  NOT NULL DEFAULT '',
  `image_mime_type`   VARCHAR(128)  NOT NULL DEFAULT '',
  `image_size`        BIGINT        NOT NULL DEFAULT 0,
  `status`            VARCHAR(16)   NOT NULL DEFAULT 'active',
  `created_by`        BIGINT        NOT NULL,
  `created_at`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted`        TINYINT(1)    NOT NULL DEFAULT 0,
  `deleted_at`        DATETIME      NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_contents_series` (`series_id`),
  KEY `idx_magic_reading_contents_date` (`reading_date`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reading content pushes';

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_reading_contents'
    AND COLUMN_NAME = 'series_id'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_reading_contents` ADD COLUMN `series_id` BIGINT NULL DEFAULT NULL AFTER `id`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_reading_contents'
    AND INDEX_NAME = 'idx_magic_reading_contents_series'
);
SET @sql = IF(
  @idx_exists = 0,
  "ALTER TABLE `magic_reading_contents` ADD KEY `idx_magic_reading_contents_series` (`series_id`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_reading_contents'
    AND COLUMN_NAME = 'push_time'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_reading_contents` ADD COLUMN `push_time` TIME NULL DEFAULT NULL AFTER `reading_date`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_reading_contents'
    AND COLUMN_NAME = 'push_at'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_reading_contents` ADD COLUMN `push_at` DATETIME NULL DEFAULT NULL AFTER `push_time`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_reading_contents'
    AND COLUMN_NAME = 'makeup_deadline_at'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_reading_contents` ADD COLUMN `makeup_deadline_at` DATETIME NULL DEFAULT NULL AFTER `push_at`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_reading_contents'
    AND COLUMN_NAME = 'source_type'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_reading_contents` ADD COLUMN `source_type` VARCHAR(32) NOT NULL DEFAULT 'upload' AFTER `description`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_reading_contents'
    AND COLUMN_NAME = 'material_asset_id'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_reading_contents` ADD COLUMN `material_asset_id` BIGINT NULL DEFAULT NULL AFTER `source_type`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_reading_contents'
    AND INDEX_NAME = 'idx_magic_reading_contents_push_at'
);
SET @sql = IF(
  @idx_exists = 0,
  "ALTER TABLE `magic_reading_contents` ADD KEY `idx_magic_reading_contents_push_at` (`push_at`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_reading_contents'
    AND INDEX_NAME = 'idx_magic_reading_contents_makeup_deadline_at'
);
SET @sql = IF(
  @idx_exists = 0,
  "ALTER TABLE `magic_reading_contents` ADD KEY `idx_magic_reading_contents_makeup_deadline_at` (`makeup_deadline_at`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_reading_contents'
    AND INDEX_NAME = 'idx_magic_reading_contents_material_asset'
);
SET @sql = IF(
  @idx_exists = 0,
  "ALTER TABLE `magic_reading_contents` ADD KEY `idx_magic_reading_contents_material_asset` (`material_asset_id`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `magic_reading_content_targets` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `content_id`  BIGINT       NOT NULL,
  `target_type` VARCHAR(32)  NOT NULL COMMENT 'all / department / user',
  `target_id`   VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_content_targets_lookup` (`content_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reading content targets';

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_videos'
    AND COLUMN_NAME = 'material_asset_id'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE `magic_videos` ADD COLUMN `material_asset_id` BIGINT NULL DEFAULT NULL AFTER `transcode_status`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'magic_videos'
    AND INDEX_NAME = 'idx_magic_videos_material_asset'
);
SET @sql = IF(
  @idx_exists = 0,
  "ALTER TABLE `magic_videos` ADD KEY `idx_magic_videos_material_asset` (`material_asset_id`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
