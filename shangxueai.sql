/*
 Navicat Premium Dump SQL

 Source Server         : root
 Source Server Type    : MySQL
 Source Server Version : 80026 (8.0.26)
 Source Host           : localhost:3306
 Source Schema         : shangxueai

 Target Server Type    : MySQL
 Target Server Version : 80026 (8.0.26)
 File Encoding         : 65001

 Date: 28/05/2026 17:32:52
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for config_options
-- ----------------------------
DROP TABLE IF EXISTS `config_options`;
CREATE TABLE `config_options`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `category` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'training_type / difficulty / customer_type',
  `value` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_config_options_cat_val`(`category` ASC, `value` ASC) USING BTREE,
  INDEX `idx_config_options_cat`(`category` ASC, `enabled` ASC, `sort_order` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 77 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '????ѡ?????ã?????Աά????' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for exam_attempts
-- ----------------------------
DROP TABLE IF EXISTS `exam_attempts`;
CREATE TABLE `exam_attempts`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `exam_id` bigint NOT NULL,
  `attempt_no` int NOT NULL COMMENT '1 ? 2',
  `training_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `difficulty` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '??',
  `customer_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'in_progress' COMMENT 'in_progress / completed / abandoned',
  `score` float NULL DEFAULT NULL COMMENT 'AI ??',
  `is_pass` tinyint(1) NULL DEFAULT NULL COMMENT 'AI ???????',
  `result` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `review_json` json NULL,
  `chat_history_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `admin_score` float NULL DEFAULT NULL,
  `admin_comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `final_score` float NULL DEFAULT NULL,
  `final_is_pass` tinyint(1) NULL DEFAULT NULL,
  `reviewed_by` bigint NULL DEFAULT NULL,
  `reviewed_at` datetime NULL DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_exam_attempts_session`(`session_id` ASC) USING BTREE,
  INDEX `idx_exam_attempts_exam`(`exam_id` ASC, `attempt_no` ASC) USING BTREE,
  INDEX `idx_exam_attempts_review`(`status` ASC, `reviewed_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '???????' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for exams
-- ----------------------------
DROP TABLE IF EXISTS `exams`;
CREATE TABLE `exams`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '???',
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '????',
  `pass_score` int NOT NULL DEFAULT 60,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending / in_progress / pending_review / passed / failed',
  `attempt_count` int NOT NULL DEFAULT 0,
  `max_attempts` int NOT NULL DEFAULT 2,
  `fixed_training_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `fixed_difficulty` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `fixed_customer_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `ai_weight` float NOT NULL DEFAULT 0.5 COMMENT 'AI ??????????0-1',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_exams_user_status`(`user_id` ASC, `status` ASC) USING BTREE,
  INDEX `idx_exams_created_by`(`created_by` ASC) USING BTREE,
  INDEX `idx_exams_created_at`(`created_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '????' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for magic_audio_makeup_settings
-- ----------------------------
DROP TABLE IF EXISTS `magic_audio_makeup_settings`;
CREATE TABLE `magic_audio_makeup_settings`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `enabled` tinyint(1) NOT NULL DEFAULT 0,
  `make_up_days` int NOT NULL DEFAULT 0,
  `audio_random_window_minutes` int NOT NULL DEFAULT 0,
  `video_random_window_minutes` int NOT NULL DEFAULT 0,
  `updated_by` bigint NULL DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Audio makeup settings' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_audio_uploads
-- ----------------------------
DROP TABLE IF EXISTS `magic_audio_uploads`;
CREATE TABLE `magic_audio_uploads`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `reading_content_id` bigint NULL DEFAULT NULL,
  `file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_size` bigint NOT NULL DEFAULT 0,
  `mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `auto_checkin_by_whitelist` tinyint(1) NOT NULL DEFAULT 0,
  `uploaded_on` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `uploaded_date` date NOT NULL DEFAULT (curdate()),
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `deleted_at` datetime NULL DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_audio_uploads_user_month`(`user_id` ASC, `uploaded_date` ASC, `is_deleted` ASC) USING BTREE,
  INDEX `idx_magic_audio_uploads_reading_content_id`(`reading_content_id` ASC) USING BTREE,
  INDEX `idx_magic_audio_uploads_user_content`(`user_id` ASC, `reading_content_id` ASC, `is_deleted` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ħѧԺ????¼???ϴ?' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_auto_actions
-- ----------------------------
DROP TABLE IF EXISTS `magic_auto_actions`;
CREATE TABLE `magic_auto_actions`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `action_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `target_user_id` bigint NOT NULL,
  `target_date` date NULL DEFAULT NULL,
  `video_id` bigint NULL DEFAULT NULL,
  `reading_content_id` bigint NULL DEFAULT NULL,
  `trigger_source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `trigger_ref_id` bigint NULL DEFAULT NULL,
  `dedupe_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `window_start_at` datetime NOT NULL,
  `window_end_at` datetime NOT NULL,
  `scheduled_at` datetime NOT NULL,
  `executed_at` datetime NULL DEFAULT NULL,
  `attempt_count` int NOT NULL DEFAULT 0,
  `last_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `created_by` bigint NULL DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_magic_auto_actions_dedupe`(`dedupe_key` ASC) USING BTREE,
  INDEX `idx_magic_auto_actions_due`(`status` ASC, `scheduled_at` ASC, `window_end_at` ASC) USING BTREE,
  INDEX `idx_magic_auto_actions_target`(`action_type` ASC, `target_user_id` ASC, `target_date` ASC) USING BTREE,
  INDEX `idx_magic_auto_actions_video`(`video_id` ASC) USING BTREE,
  INDEX `idx_magic_auto_actions_reading`(`reading_content_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for magic_questions
-- ----------------------------
DROP TABLE IF EXISTS `magic_questions`;
CREATE TABLE `magic_questions`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `quiz_point_id` bigint NOT NULL,
  `question_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'single / multiple / judge / blank / short_answer',
  `stem` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `options_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `correct_answer_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `score` float NOT NULL DEFAULT 100,
  `sort_order` int NOT NULL DEFAULT 0,
  `is_required` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_questions_point`(`quiz_point_id` ASC, `sort_order` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ħѧԺ??????Ŀ' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_quiz_answers
-- ----------------------------
DROP TABLE IF EXISTS `magic_quiz_answers`;
CREATE TABLE `magic_quiz_answers`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `video_id` bigint NOT NULL,
  `quiz_point_id` bigint NOT NULL,
  `question_id` bigint NOT NULL,
  `attempt_no` int NOT NULL DEFAULT 1,
  `answer_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `correct_answer_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `is_correct` tinyint(1) NOT NULL DEFAULT 0,
  `score` float NOT NULL DEFAULT 0,
  `answer_source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `auto_correct_by_whitelist` tinyint(1) NOT NULL DEFAULT 0,
  `submitted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_quiz_answers_export`(`video_id` ASC, `quiz_point_id` ASC, `submitted_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ħѧԺ?????' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_quiz_point_pass_records
-- ----------------------------
DROP TABLE IF EXISTS `magic_quiz_point_pass_records`;
CREATE TABLE `magic_quiz_point_pass_records`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `video_id` bigint NOT NULL,
  `quiz_point_id` bigint NOT NULL,
  `attempt_no` int NOT NULL DEFAULT 1,
  `score` float NOT NULL DEFAULT 0,
  `passed` tinyint(1) NOT NULL DEFAULT 0,
  `source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `passed_at` datetime NULL DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_quiz_point_pass_records`(`video_id` ASC, `quiz_point_id` ASC, `user_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ħѧԺ?????ڵ??ύ??¼' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_reading_content_targets
-- ----------------------------
DROP TABLE IF EXISTS `magic_reading_content_targets`;
CREATE TABLE `magic_reading_content_targets`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `content_id` bigint NOT NULL,
  `target_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'all / department / user',
  `target_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_reading_content_targets_lookup`(`content_id` ASC, `target_type` ASC, `target_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 3 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Reading content targets' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_reading_contents
-- ----------------------------
DROP TABLE IF EXISTS `magic_reading_contents`;
CREATE TABLE `magic_reading_contents`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `series_id` bigint NULL DEFAULT NULL,
  `reading_date` date NOT NULL,
  `push_time` time NULL DEFAULT NULL,
  `push_at` datetime NULL DEFAULT NULL,
  `makeup_deadline_at` datetime NULL DEFAULT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `source_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'upload',
  `material_asset_id` bigint NULL DEFAULT NULL,
  `image_object_key` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `image_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_size` bigint NOT NULL DEFAULT 0,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `deleted_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_reading_contents_date`(`reading_date` ASC, `is_deleted` ASC) USING BTREE,
  INDEX `idx_magic_reading_contents_push_at`(`push_at` ASC) USING BTREE,
  INDEX `idx_magic_reading_contents_makeup_deadline_at`(`makeup_deadline_at` ASC) USING BTREE,
  INDEX `idx_magic_reading_contents_material_asset`(`material_asset_id` ASC) USING BTREE,
  INDEX `idx_magic_reading_contents_series`(`series_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 3 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Reading content pushes' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_reading_series
-- ----------------------------
DROP TABLE IF EXISTS `magic_reading_series`;
CREATE TABLE `magic_reading_series`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `start_date` date NULL DEFAULT NULL,
  `end_date` date NULL DEFAULT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_reading_series_status`(`status` ASC, `created_at` ASC) USING BTREE,
  INDEX `idx_magic_reading_series_date`(`start_date` ASC, `end_date` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Reading series' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for magic_reading_series_targets
-- ----------------------------
DROP TABLE IF EXISTS `magic_reading_series_targets`;
CREATE TABLE `magic_reading_series_targets`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `series_id` bigint NOT NULL,
  `target_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_reading_series_targets_series`(`series_id` ASC) USING BTREE,
  INDEX `idx_magic_reading_series_targets_lookup`(`series_id` ASC, `target_type` ASC, `target_id` ASC) USING BTREE,
  INDEX `idx_magic_reading_series_targets_type_target`(`target_type` ASC, `target_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Reading series default targets' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for magic_video_progress
-- ----------------------------
DROP TABLE IF EXISTS `magic_video_progress`;
CREATE TABLE `magic_video_progress`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `video_id` bigint NOT NULL,
  `current_position` float NOT NULL DEFAULT 0,
  `max_watched_position` float NOT NULL DEFAULT 0,
  `progress_percent` float NOT NULL DEFAULT 0,
  `is_completed` tinyint(1) NOT NULL DEFAULT 0,
  `completed_at` datetime NULL DEFAULT NULL,
  `last_watched_at` datetime NULL DEFAULT NULL,
  `total_duration` float NOT NULL DEFAULT 0,
  `answered_point_ids_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `quiz_passed` tinyint(1) NOT NULL DEFAULT 0,
  `quiz_version` int NOT NULL DEFAULT 1,
  `answer_attempt_count` int NOT NULL DEFAULT 0,
  `progress_source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `completed_by_whitelist` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_magic_video_progress_user_video`(`user_id` ASC, `video_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ħѧԺ??Ƶ?ۿ??' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_video_quiz_points
-- ----------------------------
DROP TABLE IF EXISTS `magic_video_quiz_points`;
CREATE TABLE `magic_video_quiz_points`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `video_id` bigint NOT NULL,
  `trigger_second` int NOT NULL,
  `question_count` int NOT NULL DEFAULT 0,
  `pass_score` int NOT NULL DEFAULT 60,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_video_quiz_points_video`(`video_id` ASC, `trigger_second` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ħѧԺ??Ƶ?????ڵ' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_video_series
-- ----------------------------
DROP TABLE IF EXISTS `magic_video_series`;
CREATE TABLE `magic_video_series`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `sequential_unlock_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `deleted_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Magic video series' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_video_series_items
-- ----------------------------
DROP TABLE IF EXISTS `magic_video_series_items`;
CREATE TABLE `magic_video_series_items`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `series_id` bigint NOT NULL,
  `video_id` bigint NOT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_magic_video_series_items_video`(`video_id` ASC) USING BTREE,
  UNIQUE INDEX `uk_magic_video_series_items_series_video`(`series_id` ASC, `video_id` ASC) USING BTREE,
  INDEX `idx_magic_video_series_items_order`(`series_id` ASC, `sort_order` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 3 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Magic video series items' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_video_targets
-- ----------------------------
DROP TABLE IF EXISTS `magic_video_targets`;
CREATE TABLE `magic_video_targets`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `video_id` bigint NOT NULL,
  `target_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'all_users / all_newcomers / department / position / role / user',
  `target_value` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_video_targets_video`(`video_id` ASC, `target_type` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ħѧԺ??Ƶ???ö??' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_video_watch_confirm_logs
-- ----------------------------
DROP TABLE IF EXISTS `magic_video_watch_confirm_logs`;
CREATE TABLE `magic_video_watch_confirm_logs`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `video_id` bigint NOT NULL,
  `progress_seconds` float NOT NULL DEFAULT 0,
  `confirm_round` int NOT NULL DEFAULT 1,
  `confirmed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_video_watch_confirm_logs_video_user`(`video_id` ASC, `user_id` ASC, `confirmed_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Video watch confirm logs' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_video_watch_confirm_settings
-- ----------------------------
DROP TABLE IF EXISTS `magic_video_watch_confirm_settings`;
CREATE TABLE `magic_video_watch_confirm_settings`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `video_id` bigint NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 0,
  `interval_seconds` int NOT NULL DEFAULT 300,
  `message` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Please confirm you are still watching the video',
  `button_text` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Continue learning',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_magic_video_watch_confirm_settings_video`(`video_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Video watch confirm settings' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_video_whitelist
-- ----------------------------
DROP TABLE IF EXISTS `magic_video_whitelist`;
CREATE TABLE `magic_video_whitelist`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `video_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `note` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_magic_video_whitelist_video_user`(`video_id` ASC, `user_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ħѧԺ??Ƶ???' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for magic_videos
-- ----------------------------
DROP TABLE IF EXISTS `magic_videos`;
CREATE TABLE `magic_videos`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `category` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_filename` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `stored_filename` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `storage_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'local',
  `oss_bucket` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `oss_endpoint` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `oss_object_key` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `oss_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `cdn_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `play_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `hls_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `cover_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'video/mp4',
  `file_size` bigint NOT NULL DEFAULT 0,
  `duration_seconds` int NOT NULL DEFAULT 0,
  `duration` int NOT NULL DEFAULT 0,
  `is_required` tinyint(1) NOT NULL DEFAULT 0,
  `is_newcomer_required` tinyint(1) NOT NULL DEFAULT 0,
  `deadline_at` datetime NULL DEFAULT NULL,
  `reward_points` int NULL DEFAULT NULL COMMENT '完成奖励积分，NULL表示使用积分规则默认值',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT 'draft / published / disabled',
  `upload_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed' COMMENT 'pending / uploading / completed / failed / deleted',
  `upload_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `quiz_version` int NOT NULL DEFAULT 1,
  `upload_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `transcode_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' COMMENT 'none / pending / processing / completed / failed',
  `material_asset_id` bigint NULL DEFAULT NULL,
  `replacement_upload_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `replacement_object_key` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `replacement_original_filename` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `replacement_mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `replacement_file_size` bigint NOT NULL DEFAULT 0,
  `replacement_duration_seconds` int NOT NULL DEFAULT 0,
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_magic_videos_status`(`status` ASC, `created_at` ASC) USING BTREE,
  INDEX `idx_magic_videos_material_asset`(`material_asset_id` ASC) USING BTREE,
  INDEX `idx_magic_videos_deleted_created`(`deleted_at` ASC, `created_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ħѧԺ??Ƶ' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for material_assets
-- ----------------------------
DROP TABLE IF EXISTS `material_assets`;
CREATE TABLE `material_assets`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `project_id` bigint NOT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `asset_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `object_key` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_size` bigint NOT NULL DEFAULT 0,
  `duration_seconds` int NOT NULL DEFAULT 0,
  `remark` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `tags` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `deleted_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_material_assets_project_type`(`project_id` ASC, `asset_type` ASC, `is_deleted` ASC) USING BTREE,
  INDEX `idx_material_assets_project_sort`(`project_id` ASC, `sort_order` ASC, `is_deleted` ASC) USING BTREE,
  INDEX `idx_material_assets_deleted_type_created`(`is_deleted` ASC, `asset_type` ASC, `created_at` ASC, `id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 9 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Material assets' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for material_projects
-- ----------------------------
DROP TABLE IF EXISTS `material_projects`;
CREATE TABLE `material_projects`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `oss_prefix` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `visibility` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'admin',
  `parent_id` bigint NULL DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `deleted_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_material_projects_creator`(`created_by` ASC, `is_deleted` ASC) USING BTREE,
  INDEX `idx_material_projects_parent_sort`(`parent_id` ASC, `sort_order` ASC, `is_deleted` ASC) USING BTREE,
  INDEX `idx_material_projects_visibility`(`is_deleted` ASC, `visibility` ASC, `created_by` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Material projects' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for paper_answers
-- ----------------------------
DROP TABLE IF EXISTS `paper_answers`;
CREATE TABLE `paper_answers`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `submission_id` bigint NOT NULL,
  `paper_question_id` bigint NOT NULL,
  `question_id` bigint NOT NULL,
  `question_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `answer_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `auto_score` float NULL DEFAULT NULL,
  `manual_score` float NULL DEFAULT NULL,
  `ai_score` float NULL DEFAULT NULL,
  `final_score` float NULL DEFAULT NULL,
  `is_correct` tinyint(1) NULL DEFAULT NULL,
  `comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `ai_comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_paper_answers_sub_pq`(`submission_id` ASC, `paper_question_id` ASC) USING BTREE,
  INDEX `idx_paper_answers_submission`(`submission_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 31 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '?Ծ??????' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for paper_assignments
-- ----------------------------
DROP TABLE IF EXISTS `paper_assignments`;
CREATE TABLE `paper_assignments`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `paper_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `reviewer_id` bigint NULL DEFAULT NULL COMMENT '阅卷人用户ID',
  `reward_points` int NULL DEFAULT NULL COMMENT '通过奖励积分，NULL表示使用积分规则默认值',
  `max_attempts` int NOT NULL DEFAULT 1,
  `attempt_count` int NOT NULL DEFAULT 0,
  `deadline_at` datetime NULL DEFAULT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending / in_progress / submitted / pending_review / graded / expired',
  `wecom_push_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' COMMENT 'none / pending / sent / failed',
  `wecom_push_payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `wecom_push_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `wecom_pushed_at` datetime NULL DEFAULT NULL,
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_paper_assignments_paper_user`(`paper_id` ASC, `user_id` ASC) USING BTREE,
  INDEX `idx_paper_assignments_user_status`(`user_id` ASC, `status` ASC) USING BTREE,
  INDEX `idx_paper_assignments_reviewer`(`reviewer_id` ASC) USING BTREE,
  INDEX `idx_paper_assignments_paper_status`(`paper_id` ASC, `status` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 25 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '?Ծ??ɷ????' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for paper_questions
-- ----------------------------
DROP TABLE IF EXISTS `paper_questions`;
CREATE TABLE `paper_questions`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `paper_id` bigint NOT NULL,
  `question_id` bigint NOT NULL COMMENT '???? question_bank.id',
  `score_override` float NULL DEFAULT NULL COMMENT 'NULL ??ʾ??????Ĭ?Ϸ',
  `sort_order` int NOT NULL DEFAULT 0,
  `section_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_paper_questions_paper_q`(`paper_id` ASC, `question_id` ASC) USING BTREE,
  INDEX `idx_paper_questions_paper_sort`(`paper_id` ASC, `sort_order` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 31 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '?Ծ?-??Ŀ????' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for paper_submissions
-- ----------------------------
DROP TABLE IF EXISTS `paper_submissions`;
CREATE TABLE `paper_submissions`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `assignment_id` bigint NOT NULL,
  `paper_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `attempt_no` int NOT NULL DEFAULT 1,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'in_progress' COMMENT 'in_progress / submitted / graded',
  `auto_score` float NULL DEFAULT NULL,
  `manual_score` float NULL DEFAULT NULL,
  `final_score` float NULL DEFAULT NULL,
  `is_pass` tinyint(1) NULL DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `submitted_at` datetime NULL DEFAULT NULL,
  `graded_at` datetime NULL DEFAULT NULL,
  `graded_by` bigint NULL DEFAULT NULL,
  `comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_paper_submissions_assign`(`assignment_id` ASC, `attempt_no` ASC) USING BTREE,
  INDEX `idx_paper_submissions_status`(`status` ASC, `submitted_at` ASC) USING BTREE,
  INDEX `idx_paper_submissions_user`(`user_id` ASC, `paper_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 5 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '?Ծ??ύ?' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for papers
-- ----------------------------
DROP TABLE IF EXISTS `papers`;
CREATE TABLE `papers`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `total_score` float NOT NULL DEFAULT 0,
  `pass_score` float NOT NULL DEFAULT 60,
  `duration_minutes` int NOT NULL DEFAULT 0 COMMENT '0 ??ʾ????ʱ',
  `auto_grade_objective` tinyint(1) NOT NULL DEFAULT 1,
  `manual_review_subjective` tinyint(1) NOT NULL DEFAULT 1,
  `shuffle_questions` tinyint(1) NOT NULL DEFAULT 0,
  `show_answer_after` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'after_submit' COMMENT 'never / after_submit / after_grade',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT 'draft / published / archived',
  `question_count` int NOT NULL DEFAULT 0,
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_papers_status_created`(`status` ASC, `created_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '?Ծ?ģ?' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for question_bank
-- ----------------------------
DROP TABLE IF EXISTS `question_bank`;
CREATE TABLE `question_bank`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `question_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'single / multiple / judge / blank / short_answer',
  `stem` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `options_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `correct_answer_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `default_score` float NOT NULL DEFAULT 5,
  `category` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `tag` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `difficulty` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `explanation` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `ai_grading_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `grading_keywords` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT 'active / archived',
  `source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual' COMMENT 'manual / excel / docx',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_question_bank_status_type`(`status` ASC, `question_type` ASC, `created_at` ASC) USING BTREE,
  INDEX `idx_question_bank_category`(`category` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 41 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '???' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for question_import_jobs
-- ----------------------------
DROP TABLE IF EXISTS `question_import_jobs`;
CREATE TABLE `question_import_jobs`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `created_by` bigint NOT NULL,
  `source` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'excel' COMMENT 'excel / docx',
  `original_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `total_rows` int NOT NULL DEFAULT 0,
  `valid_rows` int NOT NULL DEFAULT 0,
  `invalid_rows` int NOT NULL DEFAULT 0,
  `rows_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '?????????? JSON???? ok / errors / data??',
  `committed` tinyint(1) NOT NULL DEFAULT 0,
  `committed_count` int NOT NULL DEFAULT 0,
  `committed_at` datetime NULL DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_question_import_jobs_creator`(`created_by` ASC, `created_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 11 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '???⵼???????' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for training_records
-- ----------------------------
DROP TABLE IF EXISTS `training_records`;
CREATE TABLE `training_records`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `training_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `difficulty` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` float NULL DEFAULT NULL,
  `is_pass` tinyint(1) NULL DEFAULT NULL,
  `result` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `review_json` json NULL,
  `chat_history_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '?????Ի???ʷ JSON',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_training_records_user_created`(`user_id` ASC, `created_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ѵ?????̼?¼' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for training_sessions
-- ----------------------------
DROP TABLE IF EXISTS `training_sessions`;
CREATE TABLE `training_sessions`  (
  `id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'session_id, uuid hex',
  `user_id` bigint NOT NULL,
  `mode` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'training' COMMENT 'training / exam',
  `exam_attempt_id` bigint NULL DEFAULT NULL,
  `state_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SessionState ???????л?',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_training_sessions_user`(`user_id` ASC, `mode` ASC) USING BTREE,
  INDEX `idx_training_sessions_attempt`(`exam_attempt_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'ѵ??/???ԻỰ??????ʱ״̬??' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for user_whitelist
-- ----------------------------
DROP TABLE IF EXISTS `user_whitelist`;
CREATE TABLE `user_whitelist`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `auto_checkin_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `course_exempt_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `allow_video_seek` tinyint(1) NOT NULL DEFAULT 0,
  `auto_answer_correct` tinyint(1) NOT NULL DEFAULT 0,
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_user_whitelist_user`(`user_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'User whitelist capability settings' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `username` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_md5` char(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'md5(????????) 32λСдhex',
  `display_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `real_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `department` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `position` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `job_level` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'M线' COMMENT 'M线 / P线',
  `role` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT 'super_admin / admin / user',
  `is_newcomer` tinyint(1) NOT NULL DEFAULT 0,
  `employment_status` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT 'active / inactive',
  `disabled` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_users_username`(`username` ASC) USING BTREE,
  INDEX `idx_users_role_disabled_status_dept`(`role` ASC, `disabled` ASC, `status` ASC, `department` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1287 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '?û??' ROW_FORMAT = DYNAMIC;

SET FOREIGN_KEY_CHECKS = 1;


SET NAMES utf8mb4;

-- Default administrator. The password hash is md5('123456').
INSERT INTO `users` (
  `username`,
  `password_md5`,
  `display_name`,
  `real_name`,
  `department`,
  `position`,
  `job_level`,
  `role`,
  `is_newcomer`,
  `employment_status`,
  `status`,
  `disabled`
) VALUES (
  'admin',
  'e10adc3949ba59abbe56e057f20f883e',
  '系统管理员',
  '系统管理员',
  '平台',
  '管理员',
  'M线',
  'admin',
  0,
  '转正',
  'active',
  0
) ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `real_name` = VALUES(`real_name`),
  `department` = VALUES(`department`),
  `position` = VALUES(`position`),
  `job_level` = VALUES(`job_level`),
  `role` = VALUES(`role`),
  `employment_status` = VALUES(`employment_status`),
  `status` = VALUES(`status`),
  `disabled` = VALUES(`disabled`);

-- Default dictionary options.
INSERT INTO `config_options` (`category`, `value`, `sort_order`, `enabled`) VALUES
  ('employment_status', '试岗', 10, 1),
  ('employment_status', '试用', 20, 1),
  ('employment_status', '转正', 30, 1),
  ('employment_status', '离职', 40, 1),

  ('training_type', '初购转化', 10, 1),
  ('training_type', '复购转化', 20, 1),
  ('training_type', '全链路成交', 30, 1),

  ('difficulty', '简单', 10, 1),
  ('difficulty', '中等', 20, 1),
  ('difficulty', '困难', 30, 1),

  ('customer_type', '随机', 10, 1),
  ('customer_type', '送礼客户', 20, 1),
  ('customer_type', '商务接待客户', 30, 1),
  ('customer_type', '自饮客户', 40, 1),
  ('customer_type', '企业客户', 50, 1),
  ('customer_type', '价格敏感客户', 60, 1)
ON DUPLICATE KEY UPDATE
  `sort_order` = VALUES(`sort_order`),
  `enabled` = VALUES(`enabled`);

-- Backfill existing imported users when this script is applied to an
-- already-created database.
UPDATE `users`
SET `employment_status` = '转正'
WHERE `employment_status` IS NULL OR `employment_status` = '';

