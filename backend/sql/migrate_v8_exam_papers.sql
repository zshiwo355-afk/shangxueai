-- =====================================================================
-- migrate_v8_exam_papers.sql
--
-- 新增"考试管理"模块（独立卷库式，对标问卷星）
--
-- 与现有 exams / exam_attempts（AI 通关，聊天式）完全解耦：
--   - question_bank          题库主表
--   - papers                 试卷主表
--   - paper_questions        试卷-题目关联（手工挑题、按序、单题分值覆写）
--   - paper_assignments      试卷派发任务（含企微推送状态）
--   - paper_submissions      用户提交（attempt 主表）
--   - paper_answers          单题作答明细
--   - question_import_jobs   导入任务（解析预览 + 行内编辑 + 确认入库）
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- question_bank
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `question_bank` (
  `id`                  BIGINT       NOT NULL AUTO_INCREMENT,
  `question_type`       VARCHAR(16)  NOT NULL COMMENT 'single / multiple / judge / blank / short_answer',
  `stem`                TEXT         NOT NULL,
  `options_json`        LONGTEXT     NULL,
  `correct_answer_json` LONGTEXT     NULL,
  `default_score`       FLOAT        NOT NULL DEFAULT 5,
  `category`            VARCHAR(128) NOT NULL DEFAULT '',
  `tag`                 VARCHAR(255) NOT NULL DEFAULT '',
  `difficulty`          VARCHAR(32)  NOT NULL DEFAULT '',
  `explanation`         TEXT         NULL,
  `status`              VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active / archived',
  `source`              VARCHAR(32)  NOT NULL DEFAULT 'manual' COMMENT 'manual / excel / docx',
  `created_by`          BIGINT       NOT NULL,
  `created_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_question_bank_status_type` (`status`, `question_type`, `created_at`),
  KEY `idx_question_bank_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='题库';

-- ---------------------------------------------------------------------
-- papers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `papers` (
  `id`                       BIGINT       NOT NULL AUTO_INCREMENT,
  `title`                    VARCHAR(255) NOT NULL,
  `description`              TEXT         NULL,
  `total_score`              FLOAT        NOT NULL DEFAULT 0,
  `pass_score`               FLOAT        NOT NULL DEFAULT 60,
  `duration_minutes`         INT          NOT NULL DEFAULT 0 COMMENT '0 表示不限时',
  `auto_grade_objective`     TINYINT(1)   NOT NULL DEFAULT 1,
  `manual_review_subjective` TINYINT(1)   NOT NULL DEFAULT 1,
  `shuffle_questions`        TINYINT(1)   NOT NULL DEFAULT 0,
  `show_answer_after`        VARCHAR(16)  NOT NULL DEFAULT 'after_submit' COMMENT 'never / after_submit / after_grade',
  `status`                   VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT 'draft / published / archived',
  `question_count`           INT          NOT NULL DEFAULT 0,
  `created_by`               BIGINT       NOT NULL,
  `created_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_papers_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷模板';

-- ---------------------------------------------------------------------
-- paper_questions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `paper_questions` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `paper_id`       BIGINT       NOT NULL,
  `question_id`    BIGINT       NOT NULL COMMENT '引用 question_bank.id',
  `score_override` FLOAT        NULL DEFAULT NULL COMMENT 'NULL 表示用题库默认分',
  `sort_order`     INT          NOT NULL DEFAULT 0,
  `section_name`   VARCHAR(128) NOT NULL DEFAULT '',
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_questions_paper_q` (`paper_id`, `question_id`),
  KEY `idx_paper_questions_paper_sort` (`paper_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷-题目关联';

-- ---------------------------------------------------------------------
-- paper_assignments
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `paper_assignments` (
  `id`                       BIGINT       NOT NULL AUTO_INCREMENT,
  `paper_id`                 BIGINT       NOT NULL,
  `user_id`                  BIGINT       NOT NULL,
  `max_attempts`             INT          NOT NULL DEFAULT 1,
  `attempt_count`            INT          NOT NULL DEFAULT 0,
  `deadline_at`              DATETIME     NULL DEFAULT NULL,
  `status`                   VARCHAR(16)  NOT NULL DEFAULT 'pending'
                             COMMENT 'pending / in_progress / submitted / pending_review / graded / expired',
  `wecom_push_status`        VARCHAR(16)  NOT NULL DEFAULT 'none'
                             COMMENT 'none / pending / sent / failed',
  `wecom_push_payload_json`  LONGTEXT     NULL,
  `wecom_push_error`         TEXT         NULL,
  `wecom_pushed_at`          DATETIME     NULL DEFAULT NULL,
  `created_by`               BIGINT       NOT NULL,
  `created_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_assignments_paper_user` (`paper_id`, `user_id`),
  KEY `idx_paper_assignments_user_status` (`user_id`, `status`),
  KEY `idx_paper_assignments_paper_status` (`paper_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷派发任务';

-- ---------------------------------------------------------------------
-- paper_submissions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `paper_submissions` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `assignment_id`  BIGINT       NOT NULL,
  `paper_id`       BIGINT       NOT NULL,
  `user_id`        BIGINT       NOT NULL,
  `attempt_no`     INT          NOT NULL DEFAULT 1,
  `status`         VARCHAR(16)  NOT NULL DEFAULT 'in_progress'
                   COMMENT 'in_progress / submitted / graded',
  `auto_score`     FLOAT        NULL DEFAULT NULL,
  `manual_score`   FLOAT        NULL DEFAULT NULL,
  `final_score`    FLOAT        NULL DEFAULT NULL,
  `is_pass`        TINYINT(1)   NULL DEFAULT NULL,
  `started_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `submitted_at`   DATETIME     NULL DEFAULT NULL,
  `graded_at`      DATETIME     NULL DEFAULT NULL,
  `graded_by`      BIGINT       NULL DEFAULT NULL,
  `comment`        TEXT         NULL,
  PRIMARY KEY (`id`),
  KEY `idx_paper_submissions_assign` (`assignment_id`, `attempt_no`),
  KEY `idx_paper_submissions_status` (`status`, `submitted_at`),
  KEY `idx_paper_submissions_user` (`user_id`, `paper_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷提交主表';

-- ---------------------------------------------------------------------
-- paper_answers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `paper_answers` (
  `id`                BIGINT      NOT NULL AUTO_INCREMENT,
  `submission_id`     BIGINT      NOT NULL,
  `paper_question_id` BIGINT      NOT NULL,
  `question_id`       BIGINT      NOT NULL,
  `question_type`     VARCHAR(16) NOT NULL,
  `answer_json`       LONGTEXT    NULL,
  `auto_score`        FLOAT       NULL DEFAULT NULL,
  `manual_score`      FLOAT       NULL DEFAULT NULL,
  `final_score`       FLOAT       NULL DEFAULT NULL,
  `is_correct`        TINYINT(1)  NULL DEFAULT NULL,
  `comment`           TEXT        NULL,
  `created_at`        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_answers_sub_pq` (`submission_id`, `paper_question_id`),
  KEY `idx_paper_answers_submission` (`submission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷单题作答';

-- ---------------------------------------------------------------------
-- question_import_jobs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `question_import_jobs` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `created_by`      BIGINT       NOT NULL,
  `source`          VARCHAR(16)  NOT NULL DEFAULT 'excel' COMMENT 'excel / docx',
  `original_name`   VARCHAR(255) NOT NULL DEFAULT '',
  `total_rows`      INT          NOT NULL DEFAULT 0,
  `valid_rows`      INT          NOT NULL DEFAULT 0,
  `invalid_rows`    INT          NOT NULL DEFAULT 0,
  `rows_json`       LONGTEXT     NOT NULL COMMENT '解析后逐行 JSON（含 ok / errors / data）',
  `committed`       TINYINT(1)   NOT NULL DEFAULT 0,
  `committed_count` INT          NOT NULL DEFAULT 0,
  `committed_at`    DATETIME     NULL DEFAULT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_question_import_jobs_creator` (`created_by`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='题库导入任务流水';
