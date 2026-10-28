-- 抽奖公开中奖展示行增量迁移。
-- 仅保存经后台审核、允许公开展示的快照，不改动真实抽奖记录。
-- 可重复执行；已有生产库只需执行本文件一次。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `lottery_display_winners` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint NOT NULL,
  `prize_id` bigint DEFAULT NULL,
  `display_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `prize_name_snapshot` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_demo` tinyint(1) NOT NULL DEFAULT '0',
  `visibility` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'public',
  `source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual_reviewed',
  `batch_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL,
  `display_time` datetime NOT NULL,
  `operator_note` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_lottery_display_batch_row` (`campaign_id`,`batch_id`,`sort_order`) USING BTREE,
  KEY `idx_lottery_display_campaign_time` (`campaign_id`,`visibility`,`display_time`) USING BTREE,
  KEY `idx_lottery_display_demo` (`is_demo`,`source`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='抽奖公开中奖展示快照';
