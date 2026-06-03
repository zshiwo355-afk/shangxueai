-- 截止提醒：给 exams 加 deadline_at（NULL=不限），并补一个查询索引。
-- 此文件可重复执行，已有列 / 索引会自动跳过。

SET @db_name = DATABASE();

-- 1. exams.deadline_at
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `exams` ADD COLUMN `deadline_at` datetime DEFAULT NULL COMMENT ''考试截止时间（NULL=不限）'' AFTER `ai_weight`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'exams' AND COLUMN_NAME = 'deadline_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. exams 增加 (status, deadline_at) 联合索引，给 deadline reminder worker 扫表用
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `exams` ADD KEY `idx_exams_status_deadline` (`status`,`deadline_at`)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'exams' AND INDEX_NAME = 'idx_exams_status_deadline'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. paper_assignments 也补一个 (status, deadline_at) 联合索引
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `paper_assignments` ADD KEY `idx_paper_assignments_status_deadline` (`status`,`deadline_at`)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'paper_assignments' AND INDEX_NAME = 'idx_paper_assignments_status_deadline'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
