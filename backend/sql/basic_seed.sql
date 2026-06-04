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

-- Default point rules.
INSERT INTO `point_rules` (`code`, `name`, `category`, `points`, `daily_limit`, `enabled`, `description`) VALUES
  ('training_deal', 'AI对练-成交', 'training', 20, 0, 1, '一次销售对练复盘结果为"成交"时入账'),
  ('training_intent', 'AI对练-意向客户', 'training', 10, 0, 1, '一次销售对练复盘结果为"意向客户"时入账'),
  ('training_other', 'AI对练-其他完成', 'training', 3, 5, 1, '一次销售对练完成但未达成上述结果，每日最多 5 次入账'),
  ('video_complete', '课程-视频完整学完', 'course', 15, 0, 1, '同一视频首次标记为完成时入账（每用户每视频仅一次）'),
  ('quiz_pass', '课程-随堂测通过', 'course', 5, 0, 1, '随堂测点位首次通过时入账（每用户每点位仅一次）'),
  ('reading_checkin', '读书打卡-当日完成', 'reading', 8, 1, 1, '当日提交读书音频打卡时入账，每自然日最多 1 次'),
  ('reading_streak_7', '读书打卡-连续7天奖励', 'reading', 30, 0, 1, '读书打卡连续达到 7 天时一次性奖励'),
  ('reading_streak_30', '读书打卡-连续30天奖励', 'reading', 100, 0, 1, '读书打卡连续达到 30 天时一次性奖励'),
  ('paper_pass', '考试-试卷通过', 'paper', 30, 0, 1, '试卷批阅完成且通过时入账（每用户每试卷仅一次）'),
  ('exam_pass', 'AI通关-考试通过', 'exam', 50, 0, 1, 'AI通关考试通过时入账（每用户每 exam 仅一次）'),
  ('manual_adjust', '手动调整', 'manual', 0, 0, 1, '管理员手动加减分使用，不依赖默认 points')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `category` = VALUES(`category`),
  `points` = VALUES(`points`),
  `daily_limit` = VALUES(`daily_limit`),
  `enabled` = VALUES(`enabled`),
  `description` = VALUES(`description`);
