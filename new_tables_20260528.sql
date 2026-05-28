-- 仅包含本次新增的读书系列表
-- 如果你的库里已经有 magic_reading_contents / magic_reading_content_targets，
-- 只需要补这两个表，再执行 employment_status / ai_grading 的 ALTER 脚本即可。

CREATE TABLE IF NOT EXISTS `magic_reading_series` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_series_status` (`status`,`created_at`),
  KEY `idx_magic_reading_series_date` (`start_date`,`end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reading series';

CREATE TABLE IF NOT EXISTS `magic_reading_series_targets` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `series_id` bigint NOT NULL,
  `target_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_series_targets_series` (`series_id`),
  KEY `idx_magic_reading_series_targets_lookup` (`series_id`,`target_type`,`target_id`),
  KEY `idx_magic_reading_series_targets_type_target` (`target_type`,`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reading series default targets';
