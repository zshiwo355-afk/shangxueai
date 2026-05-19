-- =====================================================================
-- ShangxueAI V2.1 数据库升级脚本：保存训练/考试的完整对话历史
--
-- 用法（在已有库上执行）：
--   mysql -u root -p shangxueai < backend/sql/migrate_v2_chat_history.sql
--
-- 如果你直接重跑 init.sql（会清空数据），可不运行此脚本。
-- =====================================================================

SET NAMES utf8mb4;

ALTER TABLE `training_records`
  ADD COLUMN `chat_history_json` LONGTEXT NULL DEFAULT NULL
  COMMENT '完整对话历史 JSON（list[{round,role,content,stage}]），训练完成时落库';

ALTER TABLE `exam_attempts`
  ADD COLUMN `chat_history_json` LONGTEXT NULL DEFAULT NULL
  COMMENT '完整对话历史 JSON（list[{round,role,content,stage}]），考试完成时落库';
