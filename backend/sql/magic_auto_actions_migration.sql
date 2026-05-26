ALTER TABLE `magic_audio_makeup_settings`
  ADD COLUMN `audio_random_window_minutes` INT NOT NULL DEFAULT 0 AFTER `make_up_days`,
  ADD COLUMN `video_random_window_minutes` INT NOT NULL DEFAULT 0 AFTER `audio_random_window_minutes`;

CREATE TABLE `magic_auto_actions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `action_type` VARCHAR(32) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `target_user_id` BIGINT NOT NULL,
  `target_date` DATE NULL,
  `video_id` BIGINT NULL,
  `reading_content_id` BIGINT NULL,
  `trigger_source` VARCHAR(32) NOT NULL DEFAULT '',
  `trigger_ref_id` BIGINT NULL,
  `dedupe_key` VARCHAR(255) NOT NULL,
  `window_start_at` DATETIME NOT NULL,
  `window_end_at` DATETIME NOT NULL,
  `scheduled_at` DATETIME NOT NULL,
  `executed_at` DATETIME NULL,
  `attempt_count` INT NOT NULL DEFAULT 0,
  `last_error` TEXT NULL,
  `created_by` BIGINT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_auto_actions_dedupe` (`dedupe_key`),
  KEY `idx_magic_auto_actions_due` (`status`, `scheduled_at`, `window_end_at`),
  KEY `idx_magic_auto_actions_target` (`action_type`, `target_user_id`, `target_date`),
  KEY `idx_magic_auto_actions_video` (`video_id`),
  KEY `idx_magic_auto_actions_reading` (`reading_content_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
