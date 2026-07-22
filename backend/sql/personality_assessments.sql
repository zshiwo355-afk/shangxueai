-- 人格与职场行为测评模块（增量建表，可重复执行）
CREATE TABLE IF NOT EXISTS `personality_forms` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `public_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `info_fields_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `schema_version` int NOT NULL DEFAULT '1',
  `rules_version` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'personality-v3',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `disabled_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_personality_forms_public_code` (`public_code`) USING BTREE,
  KEY `idx_personality_forms_status_created` (`status`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='人格测评表单';

CREATE TABLE IF NOT EXISTS `personality_submissions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `form_id` bigint NOT NULL,
  `draft_token_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `attempt_no` int NOT NULL DEFAULT '1',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `respondent_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `respondent_phone` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `respondent_age` int DEFAULT NULL,
  `respondent_gender` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `respondent_position` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `profile_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `form_snapshot_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `answers_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `score_json` longtext COLLATE utf8mb4_unicode_ci,
  `ai_report_json` longtext COLLATE utf8mb4_unicode_ci,
  `ai_prompt_version` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_official` tinyint(1) NOT NULL DEFAULT '0',
  `duration_seconds` int DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `saved_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `submitted_at` datetime DEFAULT NULL,
  `ai_generated_at` datetime DEFAULT NULL,
  `anonymized_at` datetime DEFAULT NULL,
  `share_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `share_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `share_expires_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_personality_submissions_draft_token` (`draft_token_hash`) USING BTREE,
  UNIQUE KEY `uk_personality_submissions_share_code` (`share_code`) USING BTREE,
  KEY `idx_personality_submissions_form_status` (`form_id`,`status`,`submitted_at`) USING BTREE,
  KEY `idx_personality_submissions_form_phone` (`form_id`,`respondent_phone`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='人格测评答卷';

-- 已有数据库：幂等补充单份答卷分享字段。
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `personality_submissions` ADD COLUMN `share_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `anonymized_at`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'personality_submissions'
    AND COLUMN_NAME = 'share_code'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `personality_submissions` ADD COLUMN `share_enabled` tinyint(1) NOT NULL DEFAULT ''0'' AFTER `share_code`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'personality_submissions'
    AND COLUMN_NAME = 'share_enabled'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `personality_submissions` ADD COLUMN `share_expires_at` datetime DEFAULT NULL AFTER `share_enabled`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'personality_submissions'
    AND COLUMN_NAME = 'share_expires_at'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE UNIQUE INDEX `uk_personality_submissions_share_code` ON `personality_submissions` (`share_code`)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'personality_submissions'
    AND INDEX_NAME = 'uk_personality_submissions_share_code'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
