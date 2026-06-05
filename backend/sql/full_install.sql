-- =====================================================================
-- ShangxueAI full schema install
--
-- Purpose: create the complete current database schema only.
-- Usage: mysql -u root -p shangxueai < backend/sql/full_install.sql
-- After schema creation, run backend/sql/basic_seed.sql to insert baseline data.
--
-- Note: this file intentionally does not insert business data.
-- =====================================================================

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;


--
-- Table structure for table `config_options`
--

DROP TABLE IF EXISTS `config_options`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `config_options` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `category` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'training_type / difficulty / customer_type',
  `value` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_config_options_cat_val` (`category`,`value`) USING BTREE,
  KEY `idx_config_options_cat` (`category`,`enabled`,`sort_order`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='下拉选项配置（管理员维护）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `exam_attempts`
--

DROP TABLE IF EXISTS `exam_attempts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `exam_attempts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `exam_id` bigint NOT NULL,
  `attempt_no` int NOT NULL COMMENT '1 或 2',
  `training_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `difficulty` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '中等',
  `customer_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'in_progress' COMMENT 'in_progress / completed / abandoned',
  `score` float DEFAULT NULL COMMENT 'AI 评分',
  `is_pass` tinyint(1) DEFAULT NULL COMMENT 'AI 预判（仅供参考）',
  `result` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `review_json` json DEFAULT NULL,
  `chat_history_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `admin_score` float DEFAULT NULL,
  `admin_comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `final_score` float DEFAULT NULL,
  `final_is_pass` tinyint(1) DEFAULT NULL,
  `reviewed_by` bigint DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_exam_attempts_session` (`session_id`) USING BTREE,
  KEY `idx_exam_attempts_exam` (`exam_id`,`attempt_no`) USING BTREE,
  KEY `idx_exam_attempts_review` (`status`,`reviewed_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='考试尝试与复盘';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `exams`
--

DROP TABLE IF EXISTS `exams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `exams` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '应试者',
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '陪练考试',
  `pass_score` int NOT NULL DEFAULT '60',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending / in_progress / pending_review / passed / failed',
  `attempt_count` int NOT NULL DEFAULT '0',
  `max_attempts` int NOT NULL DEFAULT '2',
  `fixed_training_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fixed_difficulty` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fixed_customer_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ai_weight` float NOT NULL DEFAULT '0.5' COMMENT 'AI 评分占最终成绩比例，0-1',
  `deadline_at` datetime DEFAULT NULL COMMENT '考试截止时间（NULL=不限）',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_exams_user_status` (`user_id`,`status`) USING BTREE,
  KEY `idx_exams_created_by` (`created_by`) USING BTREE,
  KEY `idx_exams_created_at` (`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='考试任务';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_audio_makeup_settings`
--

DROP TABLE IF EXISTS `magic_audio_makeup_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_audio_makeup_settings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `make_up_days` int NOT NULL DEFAULT '0',
  `audio_random_window_minutes` int NOT NULL DEFAULT '0',
  `video_random_window_minutes` int NOT NULL DEFAULT '0',
  `updated_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='Audio makeup settings';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_audio_uploads`
--

DROP TABLE IF EXISTS `magic_audio_uploads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_audio_uploads` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `reading_content_id` bigint DEFAULT NULL,
  `file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_size` bigint NOT NULL DEFAULT '0',
  `mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `auto_checkin_by_whitelist` tinyint(1) NOT NULL DEFAULT '0',
  `uploaded_on` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `uploaded_date` date NOT NULL DEFAULT (curdate()),
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_audio_uploads_user_month` (`user_id`,`uploaded_date`,`is_deleted`) USING BTREE,
  KEY `idx_magic_audio_uploads_reading_content_id` (`reading_content_id`),
  KEY `idx_magic_audio_uploads_user_content` (`user_id`,`reading_content_id`,`is_deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院读书录音上传';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_auto_actions`
--

DROP TABLE IF EXISTS `magic_auto_actions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_auto_actions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `action_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `target_user_id` bigint NOT NULL,
  `target_date` date DEFAULT NULL,
  `video_id` bigint DEFAULT NULL,
  `reading_content_id` bigint DEFAULT NULL,
  `trigger_source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `trigger_ref_id` bigint DEFAULT NULL,
  `dedupe_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `window_start_at` datetime NOT NULL,
  `window_end_at` datetime NOT NULL,
  `scheduled_at` datetime NOT NULL,
  `executed_at` datetime DEFAULT NULL,
  `attempt_count` int NOT NULL DEFAULT '0',
  `last_error` text COLLATE utf8mb4_unicode_ci,
  `created_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_magic_auto_actions_dedupe` (`dedupe_key`),
  KEY `idx_magic_auto_actions_due` (`status`,`scheduled_at`,`window_end_at`),
  KEY `idx_magic_auto_actions_target` (`action_type`,`target_user_id`,`target_date`),
  KEY `idx_magic_auto_actions_video` (`video_id`),
  KEY `idx_magic_auto_actions_reading` (`reading_content_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_questions`
--

DROP TABLE IF EXISTS `magic_questions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_questions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `quiz_point_id` bigint NOT NULL,
  `question_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'single / multiple / judge / blank / short_answer',
  `stem` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `options_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `correct_answer_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `score` float NOT NULL DEFAULT '100',
  `sort_order` int NOT NULL DEFAULT '0',
  `is_required` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_questions_point` (`quiz_point_id`,`sort_order`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院答题题目';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_quiz_answers`
--

DROP TABLE IF EXISTS `magic_quiz_answers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_quiz_answers` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `video_id` bigint NOT NULL,
  `quiz_point_id` bigint NOT NULL,
  `question_id` bigint NOT NULL,
  `attempt_no` int NOT NULL DEFAULT '1',
  `answer_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `correct_answer_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `is_correct` tinyint(1) NOT NULL DEFAULT '0',
  `score` float NOT NULL DEFAULT '0',
  `answer_source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `auto_correct_by_whitelist` tinyint(1) NOT NULL DEFAULT '0',
  `submitted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_quiz_answers_export` (`video_id`,`quiz_point_id`,`submitted_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院答题明细';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_quiz_point_pass_records`
--

DROP TABLE IF EXISTS `magic_quiz_point_pass_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_quiz_point_pass_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `video_id` bigint NOT NULL,
  `quiz_point_id` bigint NOT NULL,
  `attempt_no` int NOT NULL DEFAULT '1',
  `score` float NOT NULL DEFAULT '0',
  `passed` tinyint(1) NOT NULL DEFAULT '0',
  `source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `passed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_quiz_point_pass_records` (`video_id`,`quiz_point_id`,`user_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院答题节点提交记录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_reading_content_targets`
--

DROP TABLE IF EXISTS `magic_reading_content_targets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_reading_content_targets` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `content_id` bigint NOT NULL,
  `target_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'all / department / user',
  `target_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_reading_content_targets_lookup` (`content_id`,`target_type`,`target_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='Reading content targets';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_reading_contents`
--

DROP TABLE IF EXISTS `magic_reading_contents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_reading_contents` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `series_id` bigint DEFAULT NULL,
  `reading_date` date NOT NULL,
  `push_time` time DEFAULT NULL,
  `push_at` datetime DEFAULT NULL,
  `makeup_deadline_at` datetime DEFAULT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `source_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'upload',
  `material_asset_id` bigint DEFAULT NULL,
  `image_object_key` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `image_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_size` bigint NOT NULL DEFAULT '0',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_reading_contents_date` (`reading_date`,`is_deleted`) USING BTREE,
  KEY `idx_magic_reading_contents_push_at` (`push_at`),
  KEY `idx_magic_reading_contents_makeup_deadline_at` (`makeup_deadline_at`),
  KEY `idx_magic_reading_contents_material_asset` (`material_asset_id`),
  KEY `idx_magic_reading_contents_series` (`series_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='Reading content pushes';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_reading_series`
--

DROP TABLE IF EXISTS `magic_reading_series`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_reading_series` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_series_status` (`status`,`created_at`),
  KEY `idx_magic_reading_series_date` (`start_date`,`end_date`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reading series';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_reading_series_targets`
--

DROP TABLE IF EXISTS `magic_reading_series_targets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_reading_series_targets` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `series_id` bigint NOT NULL,
  `target_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_series_targets_series` (`series_id`),
  KEY `idx_magic_reading_series_targets_lookup` (`series_id`,`target_type`,`target_id`),
  KEY `idx_magic_reading_series_targets_type_target` (`target_type`,`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reading series default targets';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_video_progress`
--

DROP TABLE IF EXISTS `magic_video_progress`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_video_progress` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `video_id` bigint NOT NULL,
  `current_position` float NOT NULL DEFAULT '0',
  `max_watched_position` float NOT NULL DEFAULT '0',
  `progress_percent` float NOT NULL DEFAULT '0',
  `is_completed` tinyint(1) NOT NULL DEFAULT '0',
  `completed_at` datetime DEFAULT NULL,
  `last_watched_at` datetime DEFAULT NULL,
  `total_duration` float NOT NULL DEFAULT '0',
  `answered_point_ids_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `quiz_passed` tinyint(1) NOT NULL DEFAULT '0',
  `quiz_version` int NOT NULL DEFAULT '1',
  `answer_attempt_count` int NOT NULL DEFAULT '0',
  `progress_source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `completed_by_whitelist` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_magic_video_progress_user_video` (`user_id`,`video_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院视频观看进度';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_video_quiz_points`
--

DROP TABLE IF EXISTS `magic_video_quiz_points`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_video_quiz_points` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `video_id` bigint NOT NULL,
  `trigger_second` int NOT NULL,
  `question_count` int NOT NULL DEFAULT '0',
  `pass_score` int NOT NULL DEFAULT '60',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_video_quiz_points_video` (`video_id`,`trigger_second`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院视频答题节点';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_video_series`
--

DROP TABLE IF EXISTS `magic_video_series`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_video_series` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `sequential_unlock_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='Magic video series';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_video_series_items`
--

DROP TABLE IF EXISTS `magic_video_series_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_video_series_items` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `series_id` bigint NOT NULL,
  `video_id` bigint NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_magic_video_series_items_video` (`video_id`) USING BTREE,
  UNIQUE KEY `uk_magic_video_series_items_series_video` (`series_id`,`video_id`) USING BTREE,
  KEY `idx_magic_video_series_items_order` (`series_id`,`sort_order`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='Magic video series items';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_video_targets`
--

DROP TABLE IF EXISTS `magic_video_targets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_video_targets` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `video_id` bigint NOT NULL,
  `target_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'all_users / all_newcomers / department / position / role / user',
  `target_value` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_video_targets_video` (`video_id`,`target_type`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院视频适用对象';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_video_watch_confirm_logs`
--

DROP TABLE IF EXISTS `magic_video_watch_confirm_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_video_watch_confirm_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `video_id` bigint NOT NULL,
  `progress_seconds` float NOT NULL DEFAULT '0',
  `confirm_round` int NOT NULL DEFAULT '1',
  `confirmed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_video_watch_confirm_logs_video_user` (`video_id`,`user_id`,`confirmed_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='Video watch confirm logs';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_video_watch_confirm_settings`
--

DROP TABLE IF EXISTS `magic_video_watch_confirm_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_video_watch_confirm_settings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `video_id` bigint NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `interval_seconds` int NOT NULL DEFAULT '300',
  `message` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Please confirm you are still watching the video',
  `button_text` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Continue learning',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_magic_video_watch_confirm_settings_video` (`video_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='Video watch confirm settings';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_video_whitelist`
--

DROP TABLE IF EXISTS `magic_video_whitelist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_video_whitelist` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `video_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `note` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_magic_video_whitelist_video_user` (`video_id`,`user_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院视频白名单';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_videos`
--

DROP TABLE IF EXISTS `magic_videos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_videos` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
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
  `hls_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cover_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cover_asset_id` bigint DEFAULT NULL,
  `mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'video/mp4',
  `file_size` bigint NOT NULL DEFAULT '0',
  `duration_seconds` int NOT NULL DEFAULT '0',
  `duration` int NOT NULL DEFAULT '0',
  `is_required` tinyint(1) NOT NULL DEFAULT '0',
  `is_newcomer_required` tinyint(1) NOT NULL DEFAULT '0',
  `deadline_at` datetime DEFAULT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT 'draft / published / disabled',
  `upload_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed' COMMENT 'pending / uploading / completed / failed / deleted',
  `upload_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `quiz_version` int NOT NULL DEFAULT '1',
  `upload_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `transcode_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' COMMENT 'none / pending / processing / completed / failed',
  `material_asset_id` bigint DEFAULT NULL,
  `replacement_upload_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `replacement_object_key` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `replacement_original_filename` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `replacement_mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `replacement_file_size` bigint NOT NULL DEFAULT '0',
  `replacement_duration_seconds` int NOT NULL DEFAULT '0',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_videos_status` (`status`,`created_at`) USING BTREE,
  KEY `idx_magic_videos_cover_asset` (`cover_asset_id`) USING BTREE,
  KEY `idx_magic_videos_material_asset` (`material_asset_id`) USING BTREE,
  KEY `idx_magic_videos_deleted_created` (`deleted_at`,`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院视频';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `material_assets`
--

DROP TABLE IF EXISTS `material_assets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `material_assets` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `project_id` bigint NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `asset_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `object_key` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `cover_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_size` bigint NOT NULL DEFAULT '0',
  `duration_seconds` int NOT NULL DEFAULT '0',
  `remark` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `tags` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_material_assets_project_type` (`project_id`,`asset_type`,`is_deleted`) USING BTREE,
  KEY `idx_material_assets_project_sort` (`project_id`,`sort_order`,`is_deleted`) USING BTREE,
  KEY `idx_material_assets_deleted_type_created` (`is_deleted`,`asset_type`,`created_at`,`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='Material assets';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `material_projects`
--

DROP TABLE IF EXISTS `material_projects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `material_projects` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `oss_prefix` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `visibility` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'admin',
  `parent_id` bigint DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_material_projects_creator` (`created_by`,`is_deleted`) USING BTREE,
  KEY `idx_material_projects_parent_sort` (`parent_id`,`sort_order`,`is_deleted`) USING BTREE,
  KEY `idx_material_projects_visibility` (`is_deleted`,`visibility`,`created_by`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='Material projects';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `paper_answers`
--

DROP TABLE IF EXISTS `paper_answers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `paper_answers` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `submission_id` bigint NOT NULL,
  `paper_question_id` bigint NOT NULL,
  `question_id` bigint NOT NULL,
  `question_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `answer_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `auto_score` float DEFAULT NULL,
  `manual_score` float DEFAULT NULL,
  `ai_score` float DEFAULT NULL,
  `final_score` float DEFAULT NULL,
  `is_correct` tinyint(1) DEFAULT NULL,
  `comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `ai_comment` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_paper_answers_sub_pq` (`submission_id`,`paper_question_id`) USING BTREE,
  KEY `idx_paper_answers_submission` (`submission_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='试卷单题作答';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `paper_assignments`
--

DROP TABLE IF EXISTS `paper_assignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `paper_assignments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `paper_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `max_attempts` int NOT NULL DEFAULT '1',
  `attempt_count` int NOT NULL DEFAULT '0',
  `deadline_at` datetime DEFAULT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending / in_progress / submitted / pending_review / graded / expired',
  `wecom_push_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' COMMENT 'none / pending / sent / failed',
  `wecom_push_payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `wecom_push_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `wecom_pushed_at` datetime DEFAULT NULL,
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_paper_assignments_paper_user` (`paper_id`,`user_id`) USING BTREE,
  KEY `idx_paper_assignments_user_status` (`user_id`,`status`) USING BTREE,
  KEY `idx_paper_assignments_paper_status` (`paper_id`,`status`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='试卷派发任务';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `paper_questions`
--

DROP TABLE IF EXISTS `paper_questions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `paper_questions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `paper_id` bigint NOT NULL,
  `question_id` bigint NOT NULL COMMENT '引用 question_bank.id',
  `score_override` float DEFAULT NULL COMMENT 'NULL 表示用题库默认分',
  `sort_order` int NOT NULL DEFAULT '0',
  `section_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_paper_questions_paper_q` (`paper_id`,`question_id`) USING BTREE,
  KEY `idx_paper_questions_paper_sort` (`paper_id`,`sort_order`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='试卷-题目关联';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `paper_submissions`
--

DROP TABLE IF EXISTS `paper_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `paper_submissions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `assignment_id` bigint NOT NULL,
  `paper_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `attempt_no` int NOT NULL DEFAULT '1',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'in_progress' COMMENT 'in_progress / submitted / graded',
  `auto_score` float DEFAULT NULL,
  `manual_score` float DEFAULT NULL,
  `final_score` float DEFAULT NULL,
  `is_pass` tinyint(1) DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `submitted_at` datetime DEFAULT NULL,
  `graded_at` datetime DEFAULT NULL,
  `graded_by` bigint DEFAULT NULL,
  `comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_paper_submissions_assign` (`assignment_id`,`attempt_no`) USING BTREE,
  KEY `idx_paper_submissions_status` (`status`,`submitted_at`) USING BTREE,
  KEY `idx_paper_submissions_user` (`user_id`,`paper_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='试卷提交主表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `papers`
--

DROP TABLE IF EXISTS `papers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `papers` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `total_score` float NOT NULL DEFAULT '0',
  `pass_score` float NOT NULL DEFAULT '60',
  `duration_minutes` int NOT NULL DEFAULT '0' COMMENT '0 表示不限时',
  `auto_grade_objective` tinyint(1) NOT NULL DEFAULT '1',
  `manual_review_subjective` tinyint(1) NOT NULL DEFAULT '1',
  `shuffle_questions` tinyint(1) NOT NULL DEFAULT '0',
  `show_answer_after` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'after_submit' COMMENT 'never / after_submit / after_grade',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT 'draft / published / archived',
  `question_count` int NOT NULL DEFAULT '0',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_papers_status_created` (`status`,`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='试卷模板';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `question_bank`
--

DROP TABLE IF EXISTS `question_bank`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `question_bank` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `question_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'single / multiple / judge / blank / short_answer',
  `stem` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `options_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `correct_answer_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `default_score` float NOT NULL DEFAULT '5',
  `category` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `tag` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `difficulty` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `explanation` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `ai_grading_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `grading_keywords` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT 'active / archived',
  `source` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual' COMMENT 'manual / excel / docx',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_question_bank_status_type` (`status`,`question_type`,`created_at`) USING BTREE,
  KEY `idx_question_bank_category` (`category`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='题库';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `question_import_jobs`
--

DROP TABLE IF EXISTS `question_import_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `question_import_jobs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `created_by` bigint NOT NULL,
  `source` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'excel' COMMENT 'excel / docx',
  `original_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `total_rows` int NOT NULL DEFAULT '0',
  `valid_rows` int NOT NULL DEFAULT '0',
  `invalid_rows` int NOT NULL DEFAULT '0',
  `rows_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '解析后逐行 JSON（含 ok / errors / data）',
  `committed` tinyint(1) NOT NULL DEFAULT '0',
  `committed_count` int NOT NULL DEFAULT '0',
  `committed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_question_import_jobs_creator` (`created_by`,`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='题库导入任务流水';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `training_records`
--

DROP TABLE IF EXISTS `training_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `training_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `difficulty` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` float DEFAULT NULL,
  `is_pass` tinyint(1) DEFAULT NULL,
  `result` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `review_json` json DEFAULT NULL,
  `chat_history_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '完整对话历史 JSON',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_training_records_user_created` (`user_id`,`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='训练复盘记录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `training_sessions`
--

DROP TABLE IF EXISTS `training_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_sessions` (
  `id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'session_id, uuid hex',
  `user_id` bigint NOT NULL,
  `mode` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'training' COMMENT 'training / exam',
  `exam_attempt_id` bigint DEFAULT NULL,
  `state_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SessionState 完整序列化',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_training_sessions_user` (`user_id`,`mode`) USING BTREE,
  KEY `idx_training_sessions_attempt` (`exam_attempt_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='训练/考试会话（运行时状态）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_whitelist`
--

DROP TABLE IF EXISTS `user_whitelist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_whitelist` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `auto_checkin_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `course_exempt_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `allow_video_seek` tinyint(1) NOT NULL DEFAULT '0',
  `auto_answer_correct` tinyint(1) NOT NULL DEFAULT '0',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_user_whitelist_user` (`user_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='User whitelist capability settings';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `username` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_md5` char(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'md5(明文密码) 32位小写hex',
  `display_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `real_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `department` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `position` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `role` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT 'super_admin / admin / user',
  `is_newcomer` tinyint(1) NOT NULL DEFAULT '0',
  `employment_status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT 'active / inactive',
  `disabled` tinyint(1) NOT NULL DEFAULT '0',
  `wecom_userid` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wecom_synced_at` datetime DEFAULT NULL,
  `wecom_raw_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_users_username` (`username`) USING BTREE,
  UNIQUE KEY `uk_users_wecom_userid` (`wecom_userid`) USING BTREE,
  KEY `idx_users_role_disabled_status_dept` (`role`,`disabled`,`status`,`department`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=971 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='用户表';
/*!40101 SET character_set_client = @saved_cs_client */;
--
-- Table structure for table `notification_logs`
--

DROP TABLE IF EXISTS `notification_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `channel` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient_user_id` bigint DEFAULT NULL,
  `recipient_wecom_userid` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `business_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_id` bigint DEFAULT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `response_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_notification_logs_recipient` (`recipient_user_id`,`created_at`) USING BTREE,
  KEY `idx_notification_logs_business` (`business_type`,`business_id`) USING BTREE,
  KEY `idx_notification_logs_status` (`status`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='企业微信通知日志';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_push_batches`
--

DROP TABLE IF EXISTS `magic_push_batches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_push_batches` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `content_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `content_id` bigint NOT NULL,
  `trigger_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `dedupe_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_snapshot_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `title_snapshot` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `scheduled_at` datetime DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `success_count` int NOT NULL DEFAULT '0',
  `failed_count` int NOT NULL DEFAULT '0',
  `skipped_count` int NOT NULL DEFAULT '0',
  `created_by` bigint DEFAULT NULL,
  `summary_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_magic_push_batches_dedupe` (`dedupe_key`) USING BTREE,
  KEY `idx_magic_push_batches_content` (`content_type`,`content_id`,`created_at`) USING BTREE,
  KEY `idx_magic_push_batches_status` (`status`,`scheduled_at`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院推送批次';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `magic_push_entries`
--

DROP TABLE IF EXISTS `magic_push_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `magic_push_entries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `batch_id` bigint NOT NULL,
  `content_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `content_id` bigint NOT NULL,
  `recipient_user_id` bigint NOT NULL,
  `recipient_wecom_userid` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `skip_reason` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `notification_log_id` bigint DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_magic_push_entries_batch_user` (`batch_id`,`recipient_user_id`) USING BTREE,
  KEY `idx_magic_push_entries_content_user` (`content_type`,`content_id`,`recipient_user_id`,`created_at`) USING BTREE,
  KEY `idx_magic_push_entries_status` (`status`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院推送明细';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wecom_sync_batches`
--

DROP TABLE IF EXISTS `wecom_sync_batches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wecom_sync_batches` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `mode` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `initial_mode` tinyint(1) NOT NULL DEFAULT '1',
  `total_wecom_users` int NOT NULL DEFAULT '0',
  `matched_count` int NOT NULL DEFAULT '0',
  `bound_count` int NOT NULL DEFAULT '0',
  `updated_count` int NOT NULL DEFAULT '0',
  `created_count` int NOT NULL DEFAULT '0',
  `left_count` int NOT NULL DEFAULT '0',
  `disabled_count` int NOT NULL DEFAULT '0',
  `conflict_count` int NOT NULL DEFAULT '0',
  `skipped_count` int NOT NULL DEFAULT '0',
  `summary_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `executed_by` bigint DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_wecom_sync_batches_started` (`started_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='企业微信同步批次';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wecom_sync_entries`
--

DROP TABLE IF EXISTS `wecom_sync_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wecom_sync_entries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `batch_id` bigint NOT NULL,
  `user_id` bigint DEFAULT NULL,
  `wecom_userid` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobile` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `match_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `before_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `after_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_wecom_sync_entries_batch` (`batch_id`,`created_at`) USING BTREE,
  KEY `idx_wecom_sync_entries_user` (`user_id`,`created_at`) USING BTREE,
  KEY `idx_wecom_sync_entries_action` (`action`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='企业微信同步明细';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `banners`
--

DROP TABLE IF EXISTS `banners`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `banners` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '展示标题（可选）',
  `image_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '图片公开访问 URL',
  `image_object_key` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'OSS 对象键，从素材库导入时为素材原 key',
  `link_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '点击跳转链接（可选）',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '升序，越小越靠前',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '备注',
  `material_asset_id` bigint DEFAULT NULL COMMENT '若来自素材库，记录来源素材 id',
  `created_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_banners_enabled_sort` (`enabled`,`sort_order`,`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='首页轮播图';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `point_rules`
--

DROP TABLE IF EXISTS `point_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `point_rules` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '程序标识符，例：training_deal / video_complete',
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '展示名',
  `category` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '分类：training/course/reading/paper/exam/manual',
  `points` int NOT NULL DEFAULT '0' COMMENT '默认加分（负数=扣分）',
  `daily_limit` int NOT NULL DEFAULT '0' COMMENT '0=不限；>0 表示同用户同规则每自然日最多入账次数',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '规则文字说明，会展示给管理员',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_point_rules_code` (`code`) USING BTREE,
  KEY `idx_point_rules_category` (`category`,`enabled`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='积分规则';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `point_transactions`
--

DROP TABLE IF EXISTS `point_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `point_transactions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `rule_code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 point_rules.code（manual_adjust 也走这里）',
  `category` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '冗余 category，便于按维度聚合',
  `points` int NOT NULL COMMENT '实际入账分数（已应用规则、上限、手动覆盖之后的值）',
  `business_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '业务类型：training_record/video_progress/...',
  `business_id` bigint DEFAULT NULL COMMENT '业务主键 id（manual_adjust 无）',
  `dedupe_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '幂等键，保证同事件不重复入账',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `operator_id` bigint DEFAULT NULL COMMENT '手动调分时记录管理员 user_id',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_point_transactions_dedupe` (`dedupe_key`) USING BTREE,
  KEY `idx_point_transactions_user_time` (`user_id`,`created_at`) USING BTREE,
  KEY `idx_point_transactions_rule_time` (`rule_code`,`created_at`) USING BTREE,
  KEY `idx_point_transactions_category_time` (`category`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='积分流水';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_point_summary`
--

DROP TABLE IF EXISTS `user_point_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_point_summary` (
  `user_id` bigint NOT NULL,
  `total_points` int NOT NULL DEFAULT '0' COMMENT '累计总分（含历史扣分）',
  `training_points` int NOT NULL DEFAULT '0' COMMENT 'category=training 的累计',
  `course_points` int NOT NULL DEFAULT '0' COMMENT 'category=course 的累计',
  `reading_points` int NOT NULL DEFAULT '0' COMMENT 'category=reading 的累计',
  `paper_points` int NOT NULL DEFAULT '0' COMMENT 'category=paper 的累计',
  `exam_points` int NOT NULL DEFAULT '0' COMMENT 'category=exam 的累计',
  `manual_points` int NOT NULL DEFAULT '0' COMMENT 'category=manual 的累计',
  `streak_days` int NOT NULL DEFAULT '0' COMMENT '当前读书打卡连续天数',
  `max_streak_days` int NOT NULL DEFAULT '0' COMMENT '历史最长连续天数',
  `last_checkin_date` date DEFAULT NULL COMMENT '最近一次打卡日期，用于 streak 计算',
  `last_event_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`) USING BTREE,
  KEY `idx_user_point_summary_total` (`total_points` DESC) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='用户积分汇总';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mentors`
--

DROP TABLE IF EXISTS `mentors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mentors` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '关联 users.id；不强约束 role',
  `display_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '对外展示名（默认 = users.display_name）',
  `title` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '头衔，例：金牌讲师 / 销售总监',
  `avatar_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '头像公开 URL',
  `avatar_object_key` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'OSS 对象键',
  `avatar_material_id` bigint DEFAULT NULL COMMENT '若来自素材库，记录原 material_assets.id',
  `tagline` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '一句话签名',
  `bio` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '长简介（支持换行，前端按段落展示）',
  `expertise_tags` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '专长标签，逗号分隔',
  `years_experience` int NOT NULL DEFAULT '0' COMMENT '从业年限',
  `contact_wecom` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '企业微信联系方式（可选）',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '升序，越小越靠前',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否在用户端展示',
  `featured` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否首页推荐位',
  `created_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_mentors_user` (`user_id`) USING BTREE,
  KEY `idx_mentors_enabled_sort` (`enabled`,`sort_order`,`id`) USING BTREE,
  KEY `idx_mentors_featured` (`featured`,`enabled`,`sort_order`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='导师档案';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mentor_recommendations`
--

DROP TABLE IF EXISTS `mentor_recommendations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mentor_recommendations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `mentor_id` bigint NOT NULL,
  `target_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'video / reading / paper / link',
  `target_id` bigint DEFAULT NULL COMMENT '内置类型的资源 id；link 类型时为空',
  `link_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'target_type=link 时使用',
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '展示标题（覆盖目标资源原标题）',
  `note` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '导师寄语',
  `sort_order` int NOT NULL DEFAULT '0',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_mentor_recommendations_mentor` (`mentor_id`,`enabled`,`sort_order`) USING BTREE,
  KEY `idx_mentor_recommendations_target` (`target_type`,`target_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='导师推荐内容';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-28 11:10:37
