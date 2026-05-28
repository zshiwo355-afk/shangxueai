-- B 段：AI 简答题判分
-- 1) 题库新增 AI 判分配置
ALTER TABLE `question_bank`
  ADD COLUMN `ai_grading_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `explanation`,
  ADD COLUMN `grading_keywords` TEXT NULL AFTER `ai_grading_enabled`;

-- 2) 答题记录新增 AI 评分 + 评语
ALTER TABLE `paper_answers`
  ADD COLUMN `ai_score` FLOAT NULL AFTER `manual_score`,
  ADD COLUMN `ai_comment` TEXT NULL AFTER `comment`;
