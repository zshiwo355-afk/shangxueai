-- =====================================================================
-- ShangxueAI 数据库 · 一键完整安装（合并版）
--
-- 本文件 = 基准 init.sql 的全量 DDL + 种子数据，并已内含以下增量脚本的最终形态：
--   migrate_v2_chat_history.sql      （training_records / exam_attempts 对话历史）
--   migrate_v2_admin_review.sql      （考试固定参数、管理员复核与最终分）
--   migrate_v3_magic_academy.sql     （users 扩展字段 + 魔学院相关表）
--   migrate_v4_magic_video_oss.sql   （magic_videos OSS / 播放与上传状态等列）
--   migrate_v8_exam_papers.sql       （考试管理：题库 / 试卷 / 派发 / 提交 / 复核 / 导入）
--
-- 全新库：只需执行本文件（或与之等价的 init.sql）即可，无需再跑 migrate_*.sql。
-- 已有旧库升级：请仍按版本顺序单独执行 migrate_*.sql；勿对本文件重复执行（含 DROP）。
--
-- 使用方式：
--   1) 先建库：CREATE DATABASE shangxueai DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   2) CMD（推荐）：mysql -u root -p shangxueai < "C:/Users/你的用户名/Desktop/project/shangxue/backend/sql/full_install.sql"
--   3) 已在 mysql> 里用 SOURCE 时（Windows）：路径必须用正斜杠或双反斜杠，否则会报 Unknown command '\U'、路径错乱：
--        SOURCE C:/Users/你的用户名/Desktop/project/shangxue/backend/sql/full_install.sql;
--        或 SOURCE C:\\Users\\你的用户名\\Desktop\\project\\shangxue\\backend\\sql\\full_install.sql;
--
-- 初始管理员账号：admin / 123456 （md5: e10adc3949ba59abbe56e057f20f883e）
--
-- 说明：init.sql 与本文件正文一致时二者任选其一；后续若只维护一份，建议以本文件为准。
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1) users — 用户（管理员 + 普通学员）
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `username`     VARCHAR(64)  NOT NULL,
  `password_md5` CHAR(32)     NOT NULL COMMENT 'md5(明文密码) 32位小写hex',
  `display_name` VARCHAR(128) NOT NULL DEFAULT '',
  `real_name`    VARCHAR(128) NOT NULL DEFAULT '',
  `department`   VARCHAR(128) NOT NULL DEFAULT '',
  `position`     VARCHAR(128) NOT NULL DEFAULT '',
  `role`         VARCHAR(16)  NOT NULL DEFAULT 'user' COMMENT 'super_admin / admin / user',
  `is_newcomer`  TINYINT(1)   NOT NULL DEFAULT 0,
  `status`       VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active / inactive',
  `disabled`     TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- ---------------------------------------------------------------------
-- 2) config_options — 三类下拉项（训练类型/难度/客户类型）
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `config_options`;
CREATE TABLE `config_options` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `category`   VARCHAR(32)  NOT NULL COMMENT 'training_type / difficulty / customer_type',
  `value`      VARCHAR(64)  NOT NULL,
  `sort_order` INT          NOT NULL DEFAULT 0,
  `enabled`    TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_options_cat_val` (`category`, `value`),
  KEY `idx_config_options_cat` (`category`, `enabled`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='下拉选项配置（管理员维护）';

-- ---------------------------------------------------------------------
-- 3) magic_audio_makeup_settings — 读书打卡补卡设置
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_audio_makeup_settings`;
CREATE TABLE `magic_audio_makeup_settings` (
  `id`           BIGINT     NOT NULL AUTO_INCREMENT,
  `enabled`      TINYINT(1) NOT NULL DEFAULT 0,
  `make_up_days` INT        NOT NULL DEFAULT 0,
  `updated_by`   BIGINT     NULL DEFAULT NULL,
  `created_at`   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='读书打卡补卡设置';

-- ---------------------------------------------------------------------
-- 4) training_sessions — 训练 / 考试通用会话（替代 V1 的 .sessions JSON）
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `training_sessions`;
CREATE TABLE `training_sessions` (
  `id`              VARCHAR(64) NOT NULL COMMENT 'session_id, uuid hex',
  `user_id`         BIGINT      NOT NULL,
  `mode`            VARCHAR(16) NOT NULL DEFAULT 'training' COMMENT 'training / exam',
  `exam_attempt_id` BIGINT      NULL DEFAULT NULL,
  `state_json`      LONGTEXT    NOT NULL COMMENT 'SessionState 完整序列化',
  `created_at`      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_training_sessions_user` (`user_id`, `mode`),
  KEY `idx_training_sessions_attempt` (`exam_attempt_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='训练/考试会话（运行时状态）';

-- ---------------------------------------------------------------------
-- 4) exams — 考试任务（管理员派发）
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `exams`;
CREATE TABLE `exams` (
  `id`                  BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`             BIGINT       NOT NULL COMMENT '应试者',
  `title`               VARCHAR(255) NOT NULL DEFAULT '陪练考试',
  `pass_score`          INT          NOT NULL DEFAULT 60,
  `status`              VARCHAR(16)  NOT NULL DEFAULT 'pending'
                        COMMENT 'pending / in_progress / pending_review / passed / failed',
  `attempt_count`       INT          NOT NULL DEFAULT 0,
  `max_attempts`        INT          NOT NULL DEFAULT 2,
  `fixed_training_type` VARCHAR(64)  NULL DEFAULT NULL,
  `fixed_difficulty`    VARCHAR(32)  NULL DEFAULT NULL,
  `fixed_customer_type` VARCHAR(64)  NULL DEFAULT NULL,
  `ai_weight`           FLOAT        NOT NULL DEFAULT 0.5
                        COMMENT 'AI 评分占最终成绩比例，0-1',
  `created_by`          BIGINT       NOT NULL,
  `created_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at`        DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_exams_user_status` (`user_id`, `status`),
  KEY `idx_exams_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考试任务';

-- ---------------------------------------------------------------------
-- 5) exam_attempts — 单次考试尝试 + 复盘 + 管理员复核
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `exam_attempts`;
CREATE TABLE `exam_attempts` (
  `id`                BIGINT      NOT NULL AUTO_INCREMENT,
  `exam_id`           BIGINT      NOT NULL,
  `attempt_no`        INT         NOT NULL COMMENT '1 或 2',
  `training_type`     VARCHAR(64) NOT NULL,
  `difficulty`        VARCHAR(32) NOT NULL DEFAULT '中等',
  `customer_type`     VARCHAR(64) NOT NULL,
  `session_id`        VARCHAR(64) NULL DEFAULT NULL,
  `status`            VARCHAR(16) NOT NULL DEFAULT 'in_progress' COMMENT 'in_progress / completed / abandoned',
  `score`             FLOAT       NULL DEFAULT NULL COMMENT 'AI 评分',
  `is_pass`           TINYINT(1)  NULL DEFAULT NULL COMMENT 'AI 预判（仅供参考）',
  `result`            VARCHAR(16) NULL DEFAULT NULL,
  `review_json`       JSON        NULL DEFAULT NULL,
  `chat_history_json` LONGTEXT    NULL DEFAULT NULL,
  `admin_score`       FLOAT       NULL DEFAULT NULL,
  `admin_comment`     TEXT        NULL DEFAULT NULL,
  `final_score`       FLOAT       NULL DEFAULT NULL,
  `final_is_pass`     TINYINT(1)  NULL DEFAULT NULL,
  `reviewed_by`       BIGINT      NULL DEFAULT NULL,
  `reviewed_at`       DATETIME    NULL DEFAULT NULL,
  `started_at`        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at`      DATETIME    NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_exam_attempts_session` (`session_id`),
  KEY `idx_exam_attempts_exam` (`exam_id`, `attempt_no`),
  KEY `idx_exam_attempts_review` (`status`, `reviewed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考试尝试与复盘';

-- ---------------------------------------------------------------------
-- 6) training_records — 训练复盘记录（V2.1：含完整对话历史）
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `training_records`;
CREATE TABLE `training_records` (
  `id`                BIGINT      NOT NULL AUTO_INCREMENT,
  `user_id`           BIGINT      NOT NULL,
  `training_type`     VARCHAR(64) NOT NULL,
  `difficulty`        VARCHAR(32) NOT NULL,
  `customer_type`     VARCHAR(64) NOT NULL,
  `score`             FLOAT       NULL DEFAULT NULL,
  `is_pass`           TINYINT(1)  NULL DEFAULT NULL,
  `result`            VARCHAR(16) NULL DEFAULT NULL,
  `review_json`       JSON        NULL DEFAULT NULL,
  `chat_history_json` LONGTEXT    NULL DEFAULT NULL COMMENT '完整对话历史 JSON',
  `created_at`        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_training_records_user_created` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='训练复盘记录';

-- ---------------------------------------------------------------------
-- 7) magic_videos — 魔学院视频
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_videos`;
CREATE TABLE `magic_videos` (
  `id`                    BIGINT       NOT NULL AUTO_INCREMENT,
  `title`                 VARCHAR(255) NOT NULL,
  `description`           TEXT         NULL,
  `category`              VARCHAR(128) NOT NULL DEFAULT '',
  `file_name`             VARCHAR(255) NOT NULL,
  `file_path`             VARCHAR(512) NOT NULL,
  `original_filename`     VARCHAR(255) NOT NULL DEFAULT '',
  `stored_filename`       VARCHAR(255) NOT NULL DEFAULT '',
  `storage_type`          VARCHAR(32)  NOT NULL DEFAULT 'local',
  `oss_bucket`            VARCHAR(255) NOT NULL DEFAULT '',
  `oss_endpoint`          VARCHAR(255) NOT NULL DEFAULT '',
  `oss_object_key`        VARCHAR(1024) NOT NULL DEFAULT '',
  `oss_url`               VARCHAR(2048) NOT NULL DEFAULT '',
  `cdn_url`               VARCHAR(2048) NOT NULL DEFAULT '',
  `play_url`              VARCHAR(2048) NOT NULL DEFAULT '',
  `hls_url`               VARCHAR(2048) NULL DEFAULT NULL,
  `cover_url`             VARCHAR(2048) NULL DEFAULT NULL,
  `mime_type`             VARCHAR(128) NOT NULL DEFAULT 'video/mp4',
  `file_size`             BIGINT       NOT NULL DEFAULT 0,
  `duration_seconds`      INT          NOT NULL DEFAULT 0,
  `duration`              INT          NOT NULL DEFAULT 0,
  `is_required`           TINYINT(1)   NOT NULL DEFAULT 0,
  `is_newcomer_required`  TINYINT(1)   NOT NULL DEFAULT 0,
  `deadline_at`           DATETIME     NULL DEFAULT NULL,
  `status`                VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT 'draft / published / disabled',
  `upload_status`         VARCHAR(16)  NOT NULL DEFAULT 'completed' COMMENT 'pending / uploading / completed / failed / deleted',
  `upload_id`             VARCHAR(255) NOT NULL DEFAULT '',
  `quiz_version`          INT          NOT NULL DEFAULT 1,
  `upload_error`          TEXT         NULL,
  `transcode_status`      VARCHAR(16)  NOT NULL DEFAULT 'none' COMMENT 'none / pending / processing / completed / failed',
  `material_asset_id`     BIGINT       NULL DEFAULT NULL,
  `replacement_upload_id` VARCHAR(255) NOT NULL DEFAULT '',
  `replacement_object_key` VARCHAR(1024) NOT NULL DEFAULT '',
  `replacement_original_filename` VARCHAR(255) NOT NULL DEFAULT '',
  `replacement_mime_type` VARCHAR(128) NOT NULL DEFAULT '',
  `replacement_file_size` BIGINT       NOT NULL DEFAULT 0,
  `replacement_duration_seconds` INT   NOT NULL DEFAULT 0,
  `created_by`            BIGINT       NOT NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`            DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_magic_videos_status` (`status`, `created_at`),
  KEY `idx_magic_videos_material_asset` (`material_asset_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='魔学院视频';

-- ---------------------------------------------------------------------
-- 8) magic_video_series — 视频系列
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_video_series`;
CREATE TABLE `magic_video_series` (
  `id`                        BIGINT       NOT NULL AUTO_INCREMENT,
  `title`                     VARCHAR(255) NOT NULL,
  `description`               TEXT         NULL,
  `sequential_unlock_enabled` TINYINT(1)   NOT NULL DEFAULT 1,
  `enabled`                   TINYINT(1)   NOT NULL DEFAULT 1,
  `created_by`                BIGINT       NOT NULL,
  `created_at`                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted`                TINYINT(1)   NOT NULL DEFAULT 0,
  `deleted_at`                DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频系列';

-- ---------------------------------------------------------------------
-- 9) magic_video_series_items — 系列视频关系
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_video_series_items`;
CREATE TABLE `magic_video_series_items` (
  `id`         BIGINT   NOT NULL AUTO_INCREMENT,
  `series_id`  BIGINT   NOT NULL,
  `video_id`   BIGINT   NOT NULL,
  `sort_order` INT      NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_video_series_items_video` (`video_id`),
  UNIQUE KEY `uk_magic_video_series_items_series_video` (`series_id`, `video_id`),
  KEY `idx_magic_video_series_items_order` (`series_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系列视频关系';

-- ---------------------------------------------------------------------
-- 10) magic_video_targets — 视频适用对象
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_video_targets`;
CREATE TABLE `magic_video_targets` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `video_id`     BIGINT       NOT NULL,
  `target_type`  VARCHAR(32)  NOT NULL COMMENT 'all_users / all_newcomers / department / position / role / user',
  `target_value` VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_video_targets_video` (`video_id`, `target_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='魔学院视频适用对象';

-- ---------------------------------------------------------------------
-- 11) magic_video_quiz_points — 视频答题节点
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_video_quiz_points`;
CREATE TABLE `magic_video_quiz_points` (
  `id`             BIGINT      NOT NULL AUTO_INCREMENT,
  `video_id`       BIGINT      NOT NULL,
  `trigger_second` INT         NOT NULL,
  `question_count` INT         NOT NULL DEFAULT 0,
  `pass_score`     INT         NOT NULL DEFAULT 60,
  `enabled`        TINYINT(1)  NOT NULL DEFAULT 1,
  `created_at`     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_video_quiz_points_video` (`video_id`, `trigger_second`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='魔学院视频答题节点';

-- ---------------------------------------------------------------------
-- 12) magic_questions — 节点题目
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_questions`;
CREATE TABLE `magic_questions` (
  `id`                  BIGINT      NOT NULL AUTO_INCREMENT,
  `quiz_point_id`       BIGINT      NOT NULL,
  `question_type`       VARCHAR(16) NOT NULL COMMENT 'single / multiple / judge / blank / short_answer',
  `stem`                TEXT        NOT NULL,
  `options_json`        LONGTEXT    NULL,
  `correct_answer_json` LONGTEXT    NULL,
  `score`               FLOAT       NOT NULL DEFAULT 100,
  `sort_order`          INT         NOT NULL DEFAULT 0,
  `is_required`         TINYINT(1)  NOT NULL DEFAULT 1,
  `created_at`          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_questions_point` (`quiz_point_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='魔学院答题题目';

-- ---------------------------------------------------------------------
-- 13) magic_video_progress — 员工观看进度
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_video_progress`;
CREATE TABLE `magic_video_progress` (
  `id`                       BIGINT      NOT NULL AUTO_INCREMENT,
  `user_id`                  BIGINT      NOT NULL,
  `video_id`                 BIGINT      NOT NULL,
  `current_position`         FLOAT       NOT NULL DEFAULT 0,
  `max_watched_position`     FLOAT       NOT NULL DEFAULT 0,
  `progress_percent`         FLOAT       NOT NULL DEFAULT 0,
  `is_completed`             TINYINT(1)  NOT NULL DEFAULT 0,
  `completed_at`             DATETIME    NULL DEFAULT NULL,
  `last_watched_at`          DATETIME    NULL DEFAULT NULL,
  `total_duration`           FLOAT       NOT NULL DEFAULT 0,
  `answered_point_ids_json`  LONGTEXT    NULL,
  `quiz_passed`              TINYINT(1)  NOT NULL DEFAULT 0,
  `quiz_version`             INT         NOT NULL DEFAULT 1,
  `answer_attempt_count`     INT         NOT NULL DEFAULT 0,
  `progress_source`          VARCHAR(32) NOT NULL DEFAULT 'manual',
  `completed_by_whitelist`   TINYINT(1)  NOT NULL DEFAULT 0,
  `created_at`               DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_video_progress_user_video` (`user_id`, `video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='魔学院视频观看进度';

-- ---------------------------------------------------------------------
-- 14) magic_quiz_answers — 每题答案明细
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_quiz_answers`;
CREATE TABLE `magic_quiz_answers` (
  `id`                  BIGINT      NOT NULL AUTO_INCREMENT,
  `user_id`             BIGINT      NOT NULL,
  `video_id`            BIGINT      NOT NULL,
  `quiz_point_id`       BIGINT      NOT NULL,
  `question_id`         BIGINT      NOT NULL,
  `attempt_no`          INT         NOT NULL DEFAULT 1,
  `answer_json`         LONGTEXT    NULL,
  `correct_answer_json` LONGTEXT    NULL,
  `is_correct`          TINYINT(1)  NOT NULL DEFAULT 0,
  `score`               FLOAT       NOT NULL DEFAULT 0,
  `answer_source`       VARCHAR(32) NOT NULL DEFAULT 'manual',
  `auto_correct_by_whitelist` TINYINT(1) NOT NULL DEFAULT 0,
  `submitted_at`        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_quiz_answers_export` (`video_id`, `quiz_point_id`, `submitted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='魔学院答题明细';

-- ---------------------------------------------------------------------
-- 15) magic_quiz_point_pass_records — 节点提交记录
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_quiz_point_pass_records`;
CREATE TABLE `magic_quiz_point_pass_records` (
  `id`            BIGINT      NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT      NOT NULL,
  `video_id`      BIGINT      NOT NULL,
  `quiz_point_id` BIGINT      NOT NULL,
  `attempt_no`    INT         NOT NULL DEFAULT 1,
  `score`         FLOAT       NOT NULL DEFAULT 0,
  `passed`        TINYINT(1)  NOT NULL DEFAULT 0,
  `source`        VARCHAR(32) NOT NULL DEFAULT 'manual',
  `passed_at`     DATETIME    NULL DEFAULT NULL,
  `created_at`    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_quiz_point_pass_records` (`video_id`, `quiz_point_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='魔学院答题节点提交记录';

-- ---------------------------------------------------------------------
-- 16) magic_video_watch_confirm_settings — 观看确认弹窗配置
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_video_watch_confirm_settings`;
CREATE TABLE `magic_video_watch_confirm_settings` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT,
  `video_id`         BIGINT       NOT NULL,
  `enabled`          TINYINT(1)   NOT NULL DEFAULT 0,
  `interval_seconds` INT          NOT NULL DEFAULT 300,
  `message`          VARCHAR(255) NOT NULL DEFAULT '请确认你正在观看视频',
  `button_text`      VARCHAR(64)  NOT NULL DEFAULT '继续学习',
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_video_watch_confirm_settings_video` (`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频观看确认弹窗配置';

-- ---------------------------------------------------------------------
-- 17) magic_video_watch_confirm_logs — 观看确认弹窗日志
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_video_watch_confirm_logs`;
CREATE TABLE `magic_video_watch_confirm_logs` (
  `id`               BIGINT   NOT NULL AUTO_INCREMENT,
  `user_id`          BIGINT   NOT NULL,
  `video_id`         BIGINT   NOT NULL,
  `progress_seconds` FLOAT    NOT NULL DEFAULT 0,
  `confirm_round`    INT      NOT NULL DEFAULT 1,
  `confirmed_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_video_watch_confirm_logs_video_user` (`video_id`, `user_id`, `confirmed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频观看确认弹窗日志';

-- ---------------------------------------------------------------------
-- 18) magic_video_whitelist — 视频限制白名单
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_video_whitelist`;
CREATE TABLE `magic_video_whitelist` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `video_id`   BIGINT       NOT NULL,
  `user_id`    BIGINT       NOT NULL,
  `note`       VARCHAR(255) NOT NULL DEFAULT '',
  `created_by` BIGINT       NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_video_whitelist_video_user` (`video_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='魔学院视频白名单';

-- ---------------------------------------------------------------------
-- 19) user_whitelist — 用户白名单能力配置
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `user_whitelist`;
CREATE TABLE `user_whitelist` (
  `id`                    BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`               BIGINT       NOT NULL,
  `enabled`               TINYINT(1)   NOT NULL DEFAULT 1,
  `auto_checkin_enabled`  TINYINT(1)   NOT NULL DEFAULT 0,
  `course_exempt_enabled` TINYINT(1)   NOT NULL DEFAULT 0,
  `allow_video_seek`      TINYINT(1)   NOT NULL DEFAULT 0,
  `auto_answer_correct`   TINYINT(1)   NOT NULL DEFAULT 0,
  `remark`                VARCHAR(255) NOT NULL DEFAULT '',
  `created_by`            BIGINT       NOT NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_whitelist_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户白名单能力配置';

-- ---------------------------------------------------------------------
-- 20) material_projects — 全局素材项目
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `material_projects`;
CREATE TABLE `material_projects` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(255) NOT NULL,
  `description` TEXT         NULL,
  `oss_prefix`  VARCHAR(255) NOT NULL DEFAULT '',
  `visibility`  VARCHAR(16)  NOT NULL DEFAULT 'admin',
  `parent_id`   BIGINT       NULL DEFAULT NULL,
  `sort_order`  INT          NOT NULL DEFAULT 0,
  `created_by`  BIGINT       NOT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted`  TINYINT(1)   NOT NULL DEFAULT 0,
  `deleted_at`  DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_material_projects_creator` (`created_by`, `is_deleted`),
  KEY `idx_material_projects_parent_sort` (`parent_id`, `sort_order`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全局素材项目';

-- ---------------------------------------------------------------------
-- 21) material_assets — 全局素材文件
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `material_assets`;
CREATE TABLE `material_assets` (
  `id`               BIGINT        NOT NULL AUTO_INCREMENT,
  `project_id`       BIGINT        NOT NULL,
  `sort_order`       INT           NOT NULL DEFAULT 0,
  `name`             VARCHAR(255)  NOT NULL,
  `asset_type`       VARCHAR(32)   NOT NULL DEFAULT 'other',
  `file_name`        VARCHAR(255)  NOT NULL,
  `object_key`       VARCHAR(1024) NOT NULL,
  `mime_type`        VARCHAR(128)  NOT NULL DEFAULT '',
  `file_size`        BIGINT        NOT NULL DEFAULT 0,
  `duration_seconds` INT           NOT NULL DEFAULT 0,
  `remark`           TEXT          NULL,
  `tags`             TEXT          NULL,
  `status`           VARCHAR(16)   NOT NULL DEFAULT 'active',
  `created_by`       BIGINT        NOT NULL,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted`       TINYINT(1)    NOT NULL DEFAULT 0,
  `deleted_at`       DATETIME      NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_material_assets_project_type` (`project_id`, `asset_type`, `is_deleted`),
  KEY `idx_material_assets_project_sort` (`project_id`, `sort_order`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全局素材文件';

-- ---------------------------------------------------------------------
-- 22) magic_reading_contents — 每日读书内容推送
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_reading_contents`;
CREATE TABLE `magic_reading_contents` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT,
  `reading_date`     DATE         NOT NULL,
  `title`            VARCHAR(255) NOT NULL,
  `description`      TEXT         NULL,
  `image_object_key` VARCHAR(1024) NOT NULL,
  `image_url`        VARCHAR(2048) NOT NULL DEFAULT '',
  `image_file_name`  VARCHAR(255) NOT NULL DEFAULT '',
  `image_mime_type`  VARCHAR(128) NOT NULL DEFAULT '',
  `image_size`       BIGINT       NOT NULL DEFAULT 0,
  `status`           VARCHAR(16)  NOT NULL DEFAULT 'active',
  `created_by`       BIGINT       NOT NULL,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted`       TINYINT(1)   NOT NULL DEFAULT 0,
  `deleted_at`       DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_contents_date` (`reading_date`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每日读书内容推送';

-- ---------------------------------------------------------------------
-- 23) magic_reading_content_targets — 读书内容推送对象
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_reading_content_targets`;
CREATE TABLE `magic_reading_content_targets` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `content_id`  BIGINT       NOT NULL,
  `target_type` VARCHAR(32)  NOT NULL COMMENT 'all / department / user',
  `target_id`   VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_content_targets_lookup` (`content_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='读书内容推送对象';

-- ---------------------------------------------------------------------
-- 24) magic_audio_uploads — 读书录音上传
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `magic_audio_uploads`;
CREATE TABLE `magic_audio_uploads` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`      BIGINT       NOT NULL,
  `file_name`    VARCHAR(255) NOT NULL,
  `file_path`    VARCHAR(512) NOT NULL,
  `file_size`    BIGINT       NOT NULL DEFAULT 0,
  `mime_type`    VARCHAR(128) NOT NULL DEFAULT '',
  `remark`       VARCHAR(255) NOT NULL DEFAULT '',
  `source`       VARCHAR(32)  NOT NULL DEFAULT 'manual',
  `auto_checkin_by_whitelist` TINYINT(1) NOT NULL DEFAULT 0,
  `uploaded_on`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `uploaded_date` DATE        NOT NULL DEFAULT (CURRENT_DATE),
  `is_deleted`   TINYINT(1)   NOT NULL DEFAULT 0,
  `deleted_at`   DATETIME     NULL DEFAULT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_audio_uploads_user_month` (`user_id`, `uploaded_date`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='魔学院读书录音上传';

-- ---------------------------------------------------------------------
-- 16) question_bank — 题库（考试管理模块）
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `question_bank`;
CREATE TABLE `question_bank` (
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
  `status`              VARCHAR(16)  NOT NULL DEFAULT 'active',
  `source`              VARCHAR(32)  NOT NULL DEFAULT 'manual',
  `created_by`          BIGINT       NOT NULL,
  `created_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_question_bank_status_type` (`status`, `question_type`, `created_at`),
  KEY `idx_question_bank_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='题库';

-- ---------------------------------------------------------------------
-- 17) papers — 试卷模板
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `papers`;
CREATE TABLE `papers` (
  `id`                       BIGINT       NOT NULL AUTO_INCREMENT,
  `title`                    VARCHAR(255) NOT NULL,
  `description`              TEXT         NULL,
  `total_score`              FLOAT        NOT NULL DEFAULT 0,
  `pass_score`               FLOAT        NOT NULL DEFAULT 60,
  `duration_minutes`         INT          NOT NULL DEFAULT 0,
  `auto_grade_objective`     TINYINT(1)   NOT NULL DEFAULT 1,
  `manual_review_subjective` TINYINT(1)   NOT NULL DEFAULT 1,
  `shuffle_questions`        TINYINT(1)   NOT NULL DEFAULT 0,
  `show_answer_after`        VARCHAR(16)  NOT NULL DEFAULT 'after_submit',
  `status`                   VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT 'draft / published / archived',
  `question_count`           INT          NOT NULL DEFAULT 0,
  `created_by`               BIGINT       NOT NULL,
  `created_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_papers_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷模板';

-- ---------------------------------------------------------------------
-- 18) paper_questions — 试卷-题目关联
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `paper_questions`;
CREATE TABLE `paper_questions` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `paper_id`       BIGINT       NOT NULL,
  `question_id`    BIGINT       NOT NULL,
  `score_override` FLOAT        NULL DEFAULT NULL,
  `sort_order`     INT          NOT NULL DEFAULT 0,
  `section_name`   VARCHAR(128) NOT NULL DEFAULT '',
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_questions_paper_q` (`paper_id`, `question_id`),
  KEY `idx_paper_questions_paper_sort` (`paper_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷-题目关联';

-- ---------------------------------------------------------------------
-- 19) paper_assignments — 试卷派发任务
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `paper_assignments`;
CREATE TABLE `paper_assignments` (
  `id`                       BIGINT       NOT NULL AUTO_INCREMENT,
  `paper_id`                 BIGINT       NOT NULL,
  `user_id`                  BIGINT       NOT NULL,
  `max_attempts`             INT          NOT NULL DEFAULT 1,
  `attempt_count`            INT          NOT NULL DEFAULT 0,
  `deadline_at`              DATETIME     NULL DEFAULT NULL,
  `status`                   VARCHAR(16)  NOT NULL DEFAULT 'pending',
  `wecom_push_status`        VARCHAR(16)  NOT NULL DEFAULT 'none',
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
-- 20) paper_submissions — 试卷提交主表
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `paper_submissions`;
CREATE TABLE `paper_submissions` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `assignment_id`  BIGINT       NOT NULL,
  `paper_id`       BIGINT       NOT NULL,
  `user_id`        BIGINT       NOT NULL,
  `attempt_no`     INT          NOT NULL DEFAULT 1,
  `status`         VARCHAR(16)  NOT NULL DEFAULT 'in_progress',
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
-- 21) paper_answers — 单题作答明细
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `paper_answers`;
CREATE TABLE `paper_answers` (
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
-- 22) question_import_jobs — 题库导入任务
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `question_import_jobs`;
CREATE TABLE `question_import_jobs` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `created_by`      BIGINT       NOT NULL,
  `source`          VARCHAR(16)  NOT NULL DEFAULT 'excel',
  `original_name`   VARCHAR(255) NOT NULL DEFAULT '',
  `total_rows`      INT          NOT NULL DEFAULT 0,
  `valid_rows`      INT          NOT NULL DEFAULT 0,
  `invalid_rows`    INT          NOT NULL DEFAULT 0,
  `rows_json`       LONGTEXT     NOT NULL,
  `committed`       TINYINT(1)   NOT NULL DEFAULT 0,
  `committed_count` INT          NOT NULL DEFAULT 0,
  `committed_at`    DATETIME     NULL DEFAULT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_question_import_jobs_creator` (`created_by`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='题库导入任务流水';

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- 种子数据
-- =====================================================================

-- 默认管理员：admin / 123456
INSERT INTO `users` (`username`, `password_md5`, `display_name`, `real_name`, `department`, `position`, `role`, `is_newcomer`, `status`, `disabled`)
VALUES ('admin', 'e10adc3949ba59abbe56e057f20f883e', '系统管理员', '系统管理员', '平台', '管理员', 'admin', 0, 'active', 0);

-- 默认下拉项
INSERT INTO `config_options` (`category`, `value`, `sort_order`, `enabled`) VALUES
  ('training_type', '初购转化',         10, 1),
  ('training_type', '复购转化',         20, 1),
  ('training_type', '全链路成交',       30, 1),

  ('difficulty',    '简单',             10, 1),
  ('difficulty',    '中等',             20, 1),
  ('difficulty',    '困难',             30, 1),

  ('customer_type', '随机',             10, 1),
  ('customer_type', '送礼客户',         20, 1),
  ('customer_type', '商务接待客户',     30, 1),
  ('customer_type', '自饮客户',         40, 1),
  ('customer_type', '企业客户',         50, 1),
  ('customer_type', '价格敏感客户',     60, 1);
