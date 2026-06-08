-- 试卷派发增加阅卷人：提交提醒优先推送给该阅卷人的企业微信。

SET @db_name := DATABASE();

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `paper_assignments` ADD COLUMN `reviewer_id` bigint DEFAULT NULL COMMENT ''阅卷人用户ID'' AFTER `user_id`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'paper_assignments' AND COLUMN_NAME = 'reviewer_id'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `paper_assignments` ADD KEY `idx_paper_assignments_reviewer` (`reviewer_id`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'paper_assignments' AND INDEX_NAME = 'idx_paper_assignments_reviewer'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Per-assignment / per-course reward points.
-- NULL means fallback to point_rules.points for the corresponding rule.

SET @db_name := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `paper_assignments` ADD COLUMN `reward_points` int DEFAULT NULL COMMENT ''通过奖励积分，NULL表示使用积分规则默认值'' AFTER `reviewer_id`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'paper_assignments' AND COLUMN_NAME = 'reward_points'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD COLUMN `reward_points` int DEFAULT NULL COMMENT ''完成奖励积分，NULL表示使用积分规则默认值'' AFTER `deadline_at`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_videos' AND COLUMN_NAME = 'reward_points'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

