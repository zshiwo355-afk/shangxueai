-- 客户专属抽奖（双十一活动）增量迁移。
-- 执行：mysql -u root -p shangxueai < backend/sql/lottery_campaigns.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `lottery_campaigns` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `slug` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `rules_text` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `start_at` datetime DEFAULT NULL,
  `end_at` datetime DEFAULT NULL,
  `max_chances_per_link` int NOT NULL DEFAULT '1',
  `max_links_per_employee` int NOT NULL DEFAULT '0',
  `hero_image_url` varchar(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `hero_image_object_key` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `hero_image_material_asset_id` bigint DEFAULT NULL,
  `share_title` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `share_desc` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `share_image_url` varchar(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `share_image_object_key` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `share_image_material_asset_id` bigint DEFAULT NULL,
  `config_version` int NOT NULL DEFAULT '1',
  `created_by` bigint NOT NULL,
  `updated_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_lottery_campaigns_slug` (`slug`) USING BTREE,
  KEY `idx_lottery_campaigns_status_time` (`status`,`start_at`,`end_at`) USING BTREE,
  KEY `idx_lottery_campaigns_created` (`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='客户抽奖活动';

CREATE TABLE IF NOT EXISTS `lottery_prizes` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'physical',
  `image_url` varchar(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_object_key` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_material_asset_id` bigint DEFAULT NULL,
  `probability_ppm` int NOT NULL DEFAULT '0',
  `stock_total` int NOT NULL DEFAULT '0',
  `stock_awarded` int NOT NULL DEFAULT '0',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_by` bigint NOT NULL,
  `updated_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_lottery_prizes_campaign_sort` (`campaign_id`,`enabled`,`sort_order`) USING BTREE,
  KEY `idx_lottery_prizes_campaign_type` (`campaign_id`,`type`,`deleted_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='客户抽奖奖品及概率库存';

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

CREATE TABLE IF NOT EXISTS `lottery_campaign_staff` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `link_quota` int NOT NULL DEFAULT '0',
  `max_chances_per_link` int NOT NULL DEFAULT '0',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_lottery_campaign_staff_user` (`campaign_id`,`user_id`) USING BTREE,
  KEY `idx_lottery_campaign_staff_user` (`user_id`,`enabled`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='抽奖活动员工授权';

CREATE TABLE IF NOT EXISTS `lottery_invite_links` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint NOT NULL,
  `public_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_code` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `customer_note` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `chance_total` int NOT NULL,
  `chance_used` int NOT NULL DEFAULT '0',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `expires_at` datetime DEFAULT NULL,
  `created_by_user_id` bigint NOT NULL,
  `last_opened_at` datetime DEFAULT NULL,
  `last_draw_at` datetime DEFAULT NULL,
  `version` int NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_lottery_invite_links_public_code` (`public_code`) USING BTREE,
  KEY `idx_lottery_invite_links_campaign_creator` (`campaign_id`,`created_by_user_id`,`created_at`) USING BTREE,
  KEY `idx_lottery_invite_links_status_expiry` (`status`,`expires_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='员工为客户生成的专属抽奖链接';

CREATE TABLE IF NOT EXISTS `lottery_link_action_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `invite_link_id` bigint NOT NULL,
  `campaign_id` bigint NOT NULL,
  `action` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `before_chance_total` int NOT NULL DEFAULT '0',
  `after_chance_total` int NOT NULL DEFAULT '0',
  `delta` int NOT NULL DEFAULT '0',
  `reason` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `operator_id` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_lottery_link_actions_link_time` (`invite_link_id`,`created_at`) USING BTREE,
  KEY `idx_lottery_link_actions_operator` (`operator_id`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='客户抽奖链接操作记录';

CREATE TABLE IF NOT EXISTS `lottery_draws` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint NOT NULL,
  `invite_link_id` bigint NOT NULL,
  `request_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `draw_sequence` int NOT NULL,
  `result_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `prize_id` bigint DEFAULT NULL,
  `prize_type_snapshot` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `prize_name_snapshot` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `prize_image_url_snapshot` varchar(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `prize_probability_ppm_snapshot` int NOT NULL DEFAULT '0',
  `config_version` int NOT NULL,
  `chance_before` int NOT NULL,
  `chance_after` int NOT NULL,
  `random_value` int NOT NULL,
  `ip_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `user_agent` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_lottery_draws_link_request` (`invite_link_id`,`request_id`) USING BTREE,
  UNIQUE KEY `uk_lottery_draws_link_sequence` (`invite_link_id`,`draw_sequence`) USING BTREE,
  KEY `idx_lottery_draws_campaign_time` (`campaign_id`,`created_at`) USING BTREE,
  KEY `idx_lottery_draws_prize_time` (`prize_id`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='每一次客户抽奖的不可变快照';

CREATE TABLE IF NOT EXISTS `lottery_claims` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint NOT NULL,
  `invite_link_id` bigint NOT NULL,
  `draw_id` bigint NOT NULL,
  `recipient_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient_phone` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient_address` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `operator_id` bigint DEFAULT NULL,
  `operator_remark` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `fulfilled_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_lottery_claims_draw` (`draw_id`) USING BTREE,
  KEY `idx_lottery_claims_campaign_status` (`campaign_id`,`status`,`created_at`) USING BTREE,
  KEY `idx_lottery_claims_link` (`invite_link_id`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='中奖领奖信息与履约状态';

CREATE TABLE IF NOT EXISTS `lottery_audit_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint DEFAULT NULL,
  `entity_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` bigint DEFAULT NULL,
  `action` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `before_json` longtext COLLATE utf8mb4_unicode_ci,
  `after_json` longtext COLLATE utf8mb4_unicode_ci,
  `operator_id` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_lottery_audit_campaign_time` (`campaign_id`,`created_at`) USING BTREE,
  KEY `idx_lottery_audit_entity` (`entity_type`,`entity_id`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='抽奖后台配置审计记录';
