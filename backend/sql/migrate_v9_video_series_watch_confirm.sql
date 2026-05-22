SET NAMES utf8mb4;

SET @db_name = DATABASE();

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频系列';

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系列视频关系';

CREATE TABLE IF NOT EXISTS `magic_video_watch_confirm_settings` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT,
  `video_id`         BIGINT       NOT NULL,
  `enabled`          TINYINT(1)   NOT NULL DEFAULT 0,
  `interval_seconds` INT          NOT NULL DEFAULT 300,
  `message`          VARCHAR(255) NOT NULL DEFAULT '请确认你正在观看视频',
  `button_text`      VARCHAR(64)  NOT NULL DEFAULT '继续学习',
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_video_watch_confirm_settings_video` (`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频观看确认弹窗配置';

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频观看确认弹窗日志';
