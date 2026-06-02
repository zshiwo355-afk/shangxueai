SET @db_name = DATABASE();

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD COLUMN `wecom_userid` varchar(128) DEFAULT NULL AFTER `disabled`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'wecom_userid'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD COLUMN `wecom_synced_at` datetime DEFAULT NULL AFTER `wecom_userid`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'wecom_synced_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD COLUMN `wecom_raw_json` longtext AFTER `wecom_synced_at`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'wecom_raw_json'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD UNIQUE KEY `uk_users_wecom_userid` (`wecom_userid`) USING BTREE',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND INDEX_NAME = 'uk_users_wecom_userid'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `notification_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `channel` varchar(32) NOT NULL,
  `event_type` varchar(64) NOT NULL,
  `recipient_user_id` bigint DEFAULT NULL,
  `recipient_wecom_userid` varchar(128) DEFAULT NULL,
  `business_type` varchar(64) NOT NULL,
  `business_id` bigint DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `payload_json` longtext,
  `response_json` longtext,
  `error` text,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_notification_logs_recipient` (`recipient_user_id`,`created_at`) USING BTREE,
  KEY `idx_notification_logs_business` (`business_type`,`business_id`) USING BTREE,
  KEY `idx_notification_logs_status` (`status`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='企业微信通知日志';

CREATE TABLE IF NOT EXISTS `wecom_sync_batches` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `mode` varchar(32) NOT NULL DEFAULT 'manual',
  `initial_mode` tinyint(1) NOT NULL DEFAULT '1',
  `total_wecom_users` int NOT NULL DEFAULT '0',
  `matched_count` int NOT NULL DEFAULT '0',
  `bound_count` int NOT NULL DEFAULT '0',
  `updated_count` int NOT NULL DEFAULT '0',
  `created_count` int NOT NULL DEFAULT '0',
  `left_count` int NOT NULL DEFAULT '0',
  `disabled_count` int NOT NULL DEFAULT '0',
  `conflict_count` int NOT NULL DEFAULT '0',
  `skipped_count` int NOT NULL DEFAULT '0',
  `summary_json` longtext,
  `executed_by` bigint DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_wecom_sync_batches_started` (`started_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='企业微信同步批次';

CREATE TABLE IF NOT EXISTS `wecom_sync_entries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `batch_id` bigint NOT NULL,
  `user_id` bigint DEFAULT NULL,
  `wecom_userid` varchar(128) DEFAULT NULL,
  `mobile` varchar(32) DEFAULT NULL,
  `match_type` varchar(32) DEFAULT NULL,
  `action` varchar(32) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `reason` text,
  `before_json` longtext,
  `after_json` longtext,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_wecom_sync_entries_batch` (`batch_id`,`created_at`) USING BTREE,
  KEY `idx_wecom_sync_entries_user` (`user_id`,`created_at`) USING BTREE,
  KEY `idx_wecom_sync_entries_action` (`action`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='企业微信同步明细';
