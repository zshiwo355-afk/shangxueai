-- 读书打卡支持图片：为 magic_audio_uploads 增加图片相关列（录音/图片至少其一）。

SET @db_name := DATABASE();

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `image_object_key` varchar(512) NOT NULL DEFAULT '''' COMMENT ''打卡图片OSS对象key'' AFTER `mime_type`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'image_object_key'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `image_url` varchar(1024) NOT NULL DEFAULT '''' COMMENT ''打卡图片URL'' AFTER `image_object_key`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'image_url'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `image_file_name` varchar(255) NOT NULL DEFAULT '''' COMMENT ''打卡图片文件名'' AFTER `image_url`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'image_file_name'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `image_mime_type` varchar(128) NOT NULL DEFAULT '''' COMMENT ''打卡图片MIME类型'' AFTER `image_file_name`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'image_mime_type'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_audio_uploads` ADD COLUMN `image_size` bigint NOT NULL DEFAULT 0 COMMENT ''打卡图片字节大小'' AFTER `image_mime_type`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads' AND COLUMN_NAME = 'image_size'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 数据看板性能索引：dashboard_api 的 KPI / 趋势 / 部门统计几乎都按"事件时间 >= 某时间点"做范围过滤，
-- 但这些事件表现有索引的前导列都不是时间列，范围扫描用不上索引，数据量上来后全表扫。
-- 这里给 5 张事件表的时间过滤列补单列 BTREE 索引。幂等：索引已存在则跳过，可重复执行。
--
-- 注意：user_point_summary.user_id 已是主键、各表 user_id join 也走主键/已有索引，无需再补。

SET @db_name := DATABASE();

-- 通用幂等加索引：@tbl / @idx / @cols 三个变量描述目标，存在则跳过。
-- 因 MySQL 预处理无法循环，下面对每个索引重复一段「检查 + 建」。

-- training_records.created_at（KPI 周训练数、趋势、部门训练统计）
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_training_records_created_at` ON `training_records` (`created_at`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'training_records'
    AND INDEX_NAME = 'idx_training_records_created_at'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- exam_attempts.started_at（KPI 今日/周通关数、趋势、部门通关统计）
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_exam_attempts_started_at` ON `exam_attempts` (`started_at`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'exam_attempts'
    AND INDEX_NAME = 'idx_exam_attempts_started_at'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- magic_video_progress.last_watched_at（KPI 今日活跃、视频趋势）
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_magic_video_progress_last_watched_at` ON `magic_video_progress` (`last_watched_at`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_video_progress'
    AND INDEX_NAME = 'idx_magic_video_progress_last_watched_at'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- magic_audio_uploads.(uploaded_on, is_deleted)（KPI 活跃/打卡、音频趋势、部门打卡统计；总是带 is_deleted=0）
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_magic_audio_uploads_uploaded_on` ON `magic_audio_uploads` (`uploaded_on`, `is_deleted`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'magic_audio_uploads'
    AND INDEX_NAME = 'idx_magic_audio_uploads_uploaded_on'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- paper_submissions.started_at（KPI 今日活跃、部门统计按 started_at 过滤）
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_paper_submissions_started_at` ON `paper_submissions` (`started_at`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'paper_submissions'
    AND INDEX_NAME = 'idx_paper_submissions_started_at'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- paper_submissions.(status, graded_at)（KPI 周已批改数：status='graded' AND graded_at>=week_start；
-- 现有 idx_paper_submissions_status 是 (status, submitted_at)，graded_at 用不上）
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_paper_submissions_status_graded_at` ON `paper_submissions` (`status`, `graded_at`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'paper_submissions'
    AND INDEX_NAME = 'idx_paper_submissions_status_graded_at'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- paper_submissions.submitted_at（试卷趋势按 submitted_at 聚合；现有 (status, submitted_at) 前导是 status，
-- 趋势查询不带 status，故单列 submitted_at 更直接）
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_paper_submissions_submitted_at` ON `paper_submissions` (`submitted_at`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS 
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'paper_submissions'
    AND INDEX_NAME = 'idx_paper_submissions_submitted_at'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- 为 users 增加职级名称列 rank_name。幂等：列已存在则跳过，可重复执行。

SET @db_name := DATABASE();

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD COLUMN `rank_name` varchar(32) NOT NULL DEFAULT '''' COMMENT ''职级名称'' AFTER `job_level`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'rank_name'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

