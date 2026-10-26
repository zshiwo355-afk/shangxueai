-- 商城增量迁移：独立账户，已有用户初始余额为 0，不迁移或修改学习积分。
-- 可重复执行；不删除表、不重置余额。应用事务统一锁 users 行后写余额和库存。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `mall_accounts` (
  `user_id` bigint NOT NULL,
  `balance_points` bigint NOT NULL DEFAULT 0,
  `total_points` bigint NOT NULL DEFAULT 0,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `ck_mall_account_points` CHECK (`balance_points` >= 0 AND `total_points` >= `balance_points`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商城积分账户，仅管理员发放';

CREATE TABLE IF NOT EXISTS `mall_grants` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `user_name` varchar(128) NOT NULL DEFAULT '',
  `department` varchar(128) NOT NULL DEFAULT '',
  `points` int NOT NULL,
  `remark` varchar(500) NOT NULL,
  `operator_id` bigint NOT NULL,
  `operator_name` varchar(128) NOT NULL DEFAULT '',
  `request_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `balance_after` bigint NOT NULL,
  `total_after` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mall_grants_request` (`operator_id`, `request_id`),
  KEY `idx_mall_grants_user` (`user_id`, `id`),
  CONSTRAINT `ck_mall_grant_points` CHECK (`points` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商城积分发放记录';

CREATE TABLE IF NOT EXISTS `mall_products` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `description` varchar(2000) NOT NULL DEFAULT '',
  `image_url` varchar(2048) NOT NULL DEFAULT '',
  `price_yuan` int NOT NULL,
  `stock` int NOT NULL DEFAULT 0,
  `version` bigint NOT NULL DEFAULT 1,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint NOT NULL,
  `request_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `create_payload_hash` varchar(64) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mall_products_request` (`created_by`, `request_id`),
  KEY `idx_mall_products_enabled` (`enabled`, `id`),
  CONSTRAINT `ck_mall_product_price` CHECK (`price_yuan` >= 20 AND MOD(`price_yuan`, 20) = 0),
  CONSTRAINT `ck_mall_product_stock` CHECK (`stock` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商城商品';

CREATE TABLE IF NOT EXISTS `mall_redemptions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(32) NOT NULL,
  `user_id` bigint NOT NULL,
  `user_name` varchar(128) NOT NULL DEFAULT '',
  `department` varchar(128) NOT NULL DEFAULT '',
  `product_id` bigint NOT NULL,
  `product_name` varchar(120) NOT NULL,
  `image_url` varchar(2048) NOT NULL DEFAULT '',
  `price_yuan` int NOT NULL,
  `points_cost` int NOT NULL,
  `request_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `redeemed_at` datetime DEFAULT NULL,
  `redeemed_by` bigint DEFAULT NULL,
  `redeemed_by_name` varchar(128) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mall_redemptions_code` (`code`),
  UNIQUE KEY `uk_mall_redemptions_request` (`user_id`, `request_id`),
  KEY `idx_mall_redemptions_user` (`user_id`, `id`),
  KEY `idx_mall_redemptions_status` (`status`, `id`),
  CONSTRAINT `ck_mall_redemption_cost` CHECK (`points_cost` > 0 AND `price_yuan` = `points_cost` * 20),
  CONSTRAINT `ck_mall_redemption_status` CHECK (`status` IN ('pending', 'redeemed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商城兑换及前台核销记录';
