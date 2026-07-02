-- Audit trail for reading check-in uploads and deletions.
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS `magic_audio_upload_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `audio_upload_id` bigint DEFAULT NULL,
  `user_id` bigint DEFAULT NULL,
  `reading_content_id` bigint DEFAULT NULL,
  `action` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `operator_user_id` bigint DEFAULT NULL,
  `operator_role` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `has_audio` tinyint(1) NOT NULL DEFAULT '0',
  `has_image` tinyint(1) NOT NULL DEFAULT '0',
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_size` bigint NOT NULL DEFAULT '0',
  `mime_type` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `audio_object_key` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_object_key` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `image_size` bigint NOT NULL DEFAULT '0',
  `uploaded_date` date DEFAULT NULL,
  `uploaded_on` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `snapshot_json` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_magic_audio_upload_logs_upload` (`audio_upload_id`,`created_at`) USING BTREE,
  KEY `idx_magic_audio_upload_logs_user_content` (`user_id`,`reading_content_id`,`created_at`) USING BTREE,
  KEY `idx_magic_audio_upload_logs_action` (`action`,`created_at`) USING BTREE,
  KEY `idx_magic_audio_upload_logs_operator` (`operator_user_id`,`created_at`) USING BTREE,
  KEY `idx_magic_audio_upload_logs_content` (`reading_content_id`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='Reading check-in upload audit logs';
