-- Live management enhancements: status-compatible counters, comment nickname,
-- comment moderation settings, and comment toggle audit logs.

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_rooms` ADD COLUMN `view_pv_count` int NOT NULL DEFAULT 0 AFTER `view_count`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'live_rooms'
    AND COLUMN_NAME = 'view_pv_count'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_rooms` ADD COLUMN `view_uv_count` int NOT NULL DEFAULT 0 AFTER `view_pv_count`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'live_rooms'
    AND COLUMN_NAME = 'view_uv_count'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `live_rooms`
SET
  `view_pv_count` = CASE WHEN `view_pv_count` = 0 THEN `view_count` ELSE `view_pv_count` END,
  `view_uv_count` = CASE WHEN `view_uv_count` = 0 THEN `view_count` ELSE `view_uv_count` END;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_interactions` ADD COLUMN `dedupe_key` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''view/like 幂等键'' AFTER `type`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'live_interactions'
    AND COLUMN_NAME = 'dedupe_key'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_interactions` ADD COLUMN `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''visible'' COMMENT ''visible/hidden/deleted'' AFTER `dedupe_key`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'live_interactions'
    AND COLUMN_NAME = 'status'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_interactions` ADD COLUMN `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'live_interactions'
    AND COLUMN_NAME = 'updated_at'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE UNIQUE INDEX `uk_live_interactions_dedupe` ON `live_interactions` (`dedupe_key`)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'live_interactions'
    AND INDEX_NAME = 'uk_live_interactions_dedupe'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_live_interactions_live_type_status_id` ON `live_interactions` (`live_id`,`type`,`status`,`id`)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'live_interactions'
    AND INDEX_NAME = 'idx_live_interactions_live_type_status_id'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `live_interactions` SET `status` = 'visible' WHERE `status` IS NULL OR `status` = '';

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_interactions` ADD COLUMN `nickname` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '''' AFTER `visitor_id`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'live_interactions'
    AND COLUMN_NAME = 'nickname'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `live_comment_settings` (
  `id` int NOT NULL,
  `block_words` text COLLATE utf8mb4_unicode_ci,
  `updated_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='直播评论配置';

CREATE TABLE IF NOT EXISTS `live_comment_toggle_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `live_id` bigint NOT NULL,
  `allow_comment` tinyint(1) NOT NULL DEFAULT '1',
  `previous_allow_comment` tinyint(1) NOT NULL DEFAULT '1',
  `operator_id` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_live_comment_toggle_logs_room_time` (`live_id`,`created_at`) USING BTREE,
  KEY `idx_live_comment_toggle_logs_operator` (`operator_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='直播评论开关记录';
