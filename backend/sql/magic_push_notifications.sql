SET @db_name = DATABASE();

CREATE TABLE IF NOT EXISTS `magic_push_batches` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `content_type` varchar(32) NOT NULL,
  `content_id` bigint NOT NULL,
  `trigger_type` varchar(32) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `dedupe_key` varchar(255) NOT NULL,
  `target_snapshot_json` longtext,
  `title_snapshot` varchar(255) NOT NULL DEFAULT '',
  `scheduled_at` datetime DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `success_count` int NOT NULL DEFAULT '0',
  `failed_count` int NOT NULL DEFAULT '0',
  `skipped_count` int NOT NULL DEFAULT '0',
  `created_by` bigint DEFAULT NULL,
  `summary_json` longtext,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_magic_push_batches_dedupe` (`dedupe_key`) USING BTREE,
  KEY `idx_magic_push_batches_content` (`content_type`,`content_id`,`created_at`) USING BTREE,
  KEY `idx_magic_push_batches_status` (`status`,`scheduled_at`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院推送批次';

CREATE TABLE IF NOT EXISTS `magic_push_entries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `batch_id` bigint NOT NULL,
  `content_type` varchar(32) NOT NULL,
  `content_id` bigint NOT NULL,
  `recipient_user_id` bigint NOT NULL,
  `recipient_wecom_userid` varchar(128) DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `skip_reason` varchar(64) DEFAULT NULL,
  `error` text,
  `notification_log_id` bigint DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_magic_push_entries_batch_user` (`batch_id`,`recipient_user_id`) USING BTREE,
  KEY `idx_magic_push_entries_content_user` (`content_type`,`content_id`,`recipient_user_id`,`created_at`) USING BTREE,
  KEY `idx_magic_push_entries_status` (`status`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院推送明细';
