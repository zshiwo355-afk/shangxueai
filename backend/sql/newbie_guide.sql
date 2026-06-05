-- 新手地图功能：用户引导完成状态 + 触发配置种子数据
ALTER TABLE `users` ADD COLUMN `guide_completed_at` datetime DEFAULT NULL;

INSERT INTO `config_options` (`category`, `value`, `sort_order`, `enabled`)
VALUES
  ('newbie_guide_trigger', '试岗', 10, 1),
  ('newbie_guide_trigger', '实习', 20, 1);
