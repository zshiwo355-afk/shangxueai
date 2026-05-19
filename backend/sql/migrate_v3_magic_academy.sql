SET NAMES utf8mb4;

ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `real_name` VARCHAR(128) NOT NULL DEFAULT '' AFTER `display_name`,
  ADD COLUMN IF NOT EXISTS `department` VARCHAR(128) NOT NULL DEFAULT '' AFTER `real_name`,
  ADD COLUMN IF NOT EXISTS `position` VARCHAR(128) NOT NULL DEFAULT '' AFTER `department`,
  ADD COLUMN IF NOT EXISTS `is_newcomer` TINYINT(1) NOT NULL DEFAULT 0 AFTER `role`,
  ADD COLUMN IF NOT EXISTS `status` VARCHAR(16) NOT NULL DEFAULT 'active' AFTER `is_newcomer`;

UPDATE `users`
SET
  `real_name` = CASE WHEN COALESCE(`real_name`, '') = '' THEN COALESCE(`display_name`, `username`, '') ELSE `real_name` END,
  `status` = CASE WHEN COALESCE(`status`, '') = '' THEN 'active' ELSE `status` END;

CREATE TABLE IF NOT EXISTS `magic_videos` (
  `id`                    BIGINT       NOT NULL AUTO_INCREMENT,
  `title`                 VARCHAR(255) NOT NULL,
  `description`           TEXT         NULL,
  `category`              VARCHAR(128) NOT NULL DEFAULT '',
  `file_name`             VARCHAR(255) NOT NULL,
  `file_path`             VARCHAR(512) NOT NULL,
  `mime_type`             VARCHAR(128) NOT NULL DEFAULT 'video/mp4',
  `file_size`             BIGINT       NOT NULL DEFAULT 0,
  `duration_seconds`      INT          NOT NULL DEFAULT 0,
  `is_required`           TINYINT(1)   NOT NULL DEFAULT 0,
  `is_newcomer_required`  TINYINT(1)   NOT NULL DEFAULT 0,
  `deadline_at`           DATETIME     NULL DEFAULT NULL,
  `status`                VARCHAR(16)  NOT NULL DEFAULT 'draft',
  `created_by`            BIGINT       NOT NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_videos_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `magic_video_targets` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `video_id`     BIGINT       NOT NULL,
  `target_type`  VARCHAR(32)  NOT NULL,
  `target_value` VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_video_targets_video` (`video_id`, `target_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `magic_video_quiz_points` (
  `id`             BIGINT      NOT NULL AUTO_INCREMENT,
  `video_id`       BIGINT      NOT NULL,
  `trigger_second` INT         NOT NULL,
  `question_count` INT         NOT NULL DEFAULT 0,
  `pass_score`     INT         NOT NULL DEFAULT 60,
  `enabled`        TINYINT(1)  NOT NULL DEFAULT 1,
  `created_at`     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_video_quiz_points_video` (`video_id`, `trigger_second`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `magic_questions` (
  `id`                  BIGINT      NOT NULL AUTO_INCREMENT,
  `quiz_point_id`       BIGINT      NOT NULL,
  `question_type`       VARCHAR(16) NOT NULL,
  `stem`                TEXT        NOT NULL,
  `options_json`        LONGTEXT    NULL,
  `correct_answer_json` LONGTEXT    NULL,
  `score`               FLOAT       NOT NULL DEFAULT 100,
  `sort_order`          INT         NOT NULL DEFAULT 0,
  `is_required`         TINYINT(1)  NOT NULL DEFAULT 1,
  `created_at`          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_questions_point` (`quiz_point_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `magic_video_progress` (
  `id`                       BIGINT      NOT NULL AUTO_INCREMENT,
  `user_id`                  BIGINT      NOT NULL,
  `video_id`                 BIGINT      NOT NULL,
  `current_position`         FLOAT       NOT NULL DEFAULT 0,
  `max_watched_position`     FLOAT       NOT NULL DEFAULT 0,
  `progress_percent`         FLOAT       NOT NULL DEFAULT 0,
  `is_completed`             TINYINT(1)  NOT NULL DEFAULT 0,
  `completed_at`             DATETIME    NULL DEFAULT NULL,
  `last_watched_at`          DATETIME    NULL DEFAULT NULL,
  `total_duration`           FLOAT       NOT NULL DEFAULT 0,
  `answered_point_ids_json`  LONGTEXT    NULL,
  `quiz_passed`              TINYINT(1)  NOT NULL DEFAULT 0,
  `answer_attempt_count`     INT         NOT NULL DEFAULT 0,
  `created_at`               DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_video_progress_user_video` (`user_id`, `video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `magic_quiz_answers` (
  `id`                  BIGINT      NOT NULL AUTO_INCREMENT,
  `user_id`             BIGINT      NOT NULL,
  `video_id`            BIGINT      NOT NULL,
  `quiz_point_id`       BIGINT      NOT NULL,
  `question_id`         BIGINT      NOT NULL,
  `attempt_no`          INT         NOT NULL DEFAULT 1,
  `answer_json`         LONGTEXT    NULL,
  `correct_answer_json` LONGTEXT    NULL,
  `is_correct`          TINYINT(1)  NOT NULL DEFAULT 0,
  `score`               FLOAT       NOT NULL DEFAULT 0,
  `submitted_at`        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_quiz_answers_export` (`video_id`, `quiz_point_id`, `submitted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `magic_quiz_point_pass_records` (
  `id`            BIGINT      NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT      NOT NULL,
  `video_id`      BIGINT      NOT NULL,
  `quiz_point_id` BIGINT      NOT NULL,
  `attempt_no`    INT         NOT NULL DEFAULT 1,
  `score`         FLOAT       NOT NULL DEFAULT 0,
  `passed`        TINYINT(1)  NOT NULL DEFAULT 0,
  `passed_at`     DATETIME    NULL DEFAULT NULL,
  `created_at`    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_quiz_point_pass_records` (`video_id`, `quiz_point_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `magic_video_whitelist` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `video_id`   BIGINT       NOT NULL,
  `user_id`    BIGINT       NOT NULL,
  `note`       VARCHAR(255) NOT NULL DEFAULT '',
  `created_by` BIGINT       NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_video_whitelist_video_user` (`video_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `magic_audio_uploads` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT       NOT NULL,
  `file_name`     VARCHAR(255) NOT NULL,
  `file_path`     VARCHAR(512) NOT NULL,
  `file_size`     BIGINT       NOT NULL DEFAULT 0,
  `mime_type`     VARCHAR(128) NOT NULL DEFAULT '',
  `remark`        VARCHAR(255) NOT NULL DEFAULT '',
  `uploaded_on`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `uploaded_date` DATE         NOT NULL DEFAULT (CURRENT_DATE),
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `deleted_at`    DATETIME     NULL DEFAULT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_audio_uploads_user_month` (`user_id`, `uploaded_date`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
