-- =====================================================================
-- ShangxueAI basic seed data
--
-- Purpose: insert baseline accounts and dictionary options after running
-- backend/sql/full_install.sql.
--
-- Usage:
--   mysql -u root -p shangxueai < backend/sql/basic_seed.sql
--
-- Default admin:
--   username: admin
--   password: 123456
-- =====================================================================

SET NAMES utf8mb4;

-- Default administrator. The password hash is md5('123456').
INSERT INTO `users` (
  `username`,
  `password_md5`,
  `display_name`,
  `real_name`,
  `department`,
  `position`,
  `role`,
  `is_newcomer`,
  `employment_status`,
  `status`,
  `disabled`
) VALUES (
  'admin',
  'e10adc3949ba59abbe56e057f20f883e',
  '系统管理员',
  '系统管理员',
  '平台',
  '管理员',
  'admin',
  0,
  '转正',
  'active',
  0
) ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `real_name` = VALUES(`real_name`),
  `department` = VALUES(`department`),
  `position` = VALUES(`position`),
  `role` = VALUES(`role`),
  `employment_status` = VALUES(`employment_status`),
  `status` = VALUES(`status`),
  `disabled` = VALUES(`disabled`);

-- Default dictionary options.
INSERT INTO `config_options` (`category`, `value`, `sort_order`, `enabled`) VALUES
  ('employment_status', '试岗', 10, 1),
  ('employment_status', '试用', 20, 1),
  ('employment_status', '转正', 30, 1),
  ('employment_status', '离职', 40, 1),

  ('training_type', '初购转化', 10, 1),
  ('training_type', '复购转化', 20, 1),
  ('training_type', '全链路成交', 30, 1),

  ('difficulty', '简单', 10, 1),
  ('difficulty', '中等', 20, 1),
  ('difficulty', '困难', 30, 1),

  ('customer_type', '随机', 10, 1),
  ('customer_type', '送礼客户', 20, 1),
  ('customer_type', '商务接待客户', 30, 1),
  ('customer_type', '自饮客户', 40, 1),
  ('customer_type', '企业客户', 50, 1),
  ('customer_type', '价格敏感客户', 60, 1)
ON DUPLICATE KEY UPDATE
  `sort_order` = VALUES(`sort_order`),
  `enabled` = VALUES(`enabled`);

-- Backfill existing imported users when this script is applied to an
-- already-created database.
UPDATE `users`
SET `employment_status` = '转正'
WHERE `employment_status` IS NULL OR `employment_status` = '';

