-- A 段：在职状态字段 + 字典
-- 1) users 表加列
ALTER TABLE `users`
  ADD COLUMN `employment_status` VARCHAR(32) NOT NULL DEFAULT '' AFTER `is_newcomer`;

-- 2) config_options 加默认在职状态值
INSERT INTO `config_options` (`category`, `value`, `sort_order`, `enabled`) VALUES
  ('employment_status', '试岗', 1, 1),
  ('employment_status', '试用', 2, 1),
  ('employment_status', '转正', 3, 1),
  ('employment_status', '离职', 4, 1);
