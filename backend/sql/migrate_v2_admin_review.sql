-- =====================================================================
-- ShangxueAI V2.2 数据库升级脚本：
--   1) 派发考试时支持固定 训练类型 / 难度 / 客户类型（NULL = 随机）
--   2) 管理员复核 AI 评分，按权重计算最终成绩
--
-- 用法（在已有库上执行）：
--   mysql -u root -p shangxueai < backend/sql/migrate_v2_admin_review.sql
-- =====================================================================

SET NAMES utf8mb4;

-- 1) exams：固定参数 + AI 权重
ALTER TABLE `exams`
  ADD COLUMN `fixed_training_type` VARCHAR(64) NULL DEFAULT NULL
    COMMENT '指定训练类型，NULL=每次随机抽取';
ALTER TABLE `exams`
  ADD COLUMN `fixed_difficulty` VARCHAR(32) NULL DEFAULT NULL
    COMMENT '指定难度，NULL=每次随机抽取';
ALTER TABLE `exams`
  ADD COLUMN `fixed_customer_type` VARCHAR(64) NULL DEFAULT NULL
    COMMENT '指定客户类型，NULL=每次随机抽取';
ALTER TABLE `exams`
  ADD COLUMN `ai_weight` FLOAT NOT NULL DEFAULT 0.5
    COMMENT 'AI 自动评分占最终成绩的权重，0-1。管理员复核分占 1-ai_weight。';

-- 2) exam_attempts：管理员复核字段
ALTER TABLE `exam_attempts`
  ADD COLUMN `admin_score` FLOAT NULL DEFAULT NULL
    COMMENT '管理员人工评分 0-100';
ALTER TABLE `exam_attempts`
  ADD COLUMN `admin_comment` TEXT NULL DEFAULT NULL
    COMMENT '管理员评语';
ALTER TABLE `exam_attempts`
  ADD COLUMN `final_score` FLOAT NULL DEFAULT NULL
    COMMENT '最终综合分 = AI*ai_weight + admin*(1-ai_weight)';
ALTER TABLE `exam_attempts`
  ADD COLUMN `final_is_pass` TINYINT(1) NULL DEFAULT NULL
    COMMENT '基于最终分 >= 及格分判定，是合格的最终依据';
ALTER TABLE `exam_attempts`
  ADD COLUMN `reviewed_by` BIGINT NULL DEFAULT NULL
    COMMENT '复核管理员 user_id';
ALTER TABLE `exam_attempts`
  ADD COLUMN `reviewed_at` DATETIME NULL DEFAULT NULL
    COMMENT '复核完成时间';

-- 把已存在但还没复核的 exams 的状态保留为现状；新生命周期下：
--   - 用户提交后 attempts.status='completed' 但 reviewed_at IS NULL 即视为待复核
--   - 复核完成后 reviewed_at 落值，exam.status 才迁移到 passed/failed/pending(允许重考)
