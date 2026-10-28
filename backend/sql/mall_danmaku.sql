-- 商城弹幕增量迁移：仅新增弹幕表，不删除历史数据、不修改任何积分。
-- 可重复执行。应用先锁 users 行，再检查该账号的最后发送时间。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `mall_danmaku` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `user_name` varchar(128) NOT NULL,
  `content` varchar(50) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_mall_danmaku_user` (`user_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商城共享弹幕历史';
