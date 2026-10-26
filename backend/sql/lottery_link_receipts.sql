-- 客户抽奖全部结束后，按客户专属链接统一登记一次收货资料。
-- 发布前先备份 SHOW CREATE TABLE，并核对 information_schema.columns：
-- 下列四列必须全部不存在才执行；若全部已存在则跳过，部分存在需人工核对。
-- 仅新增字段，不改活动、概率、库存、抽奖/领奖历史。旧进程插入链接兼容默认值。
-- receipt_submitted_at 由应用写入 UTC，无数据库本地时区默认值。
ALTER TABLE `lottery_invite_links`
  ADD COLUMN `recipient_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  ADD COLUMN `recipient_phone` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  ADD COLUMN `recipient_address` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  ADD COLUMN `receipt_submitted_at` datetime DEFAULT NULL;
