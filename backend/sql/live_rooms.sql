-- 公开直播/录播活动：后台创建、外部免登录观看、分享卡片统计。
-- 幂等：表已存在则跳过，可重复执行。

CREATE TABLE IF NOT EXISTS `live_rooms` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `slug` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '公开分享短标识',
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '活动标题',
  `lecturer` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '主讲人',
  `intro` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '活动简介',
  `detail_html` longtext COLLATE utf8mb4_unicode_ci COMMENT '活动详情 HTML',
  `content_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'recorded' COMMENT 'recorded/live_stream',
  `video_source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'upload' COMMENT 'upload/material/external_url',
  `video_material_asset_id` bigint DEFAULT NULL COMMENT '素材库视频 ID',
  `video_object_key` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '录播视频 OSS key',
  `video_url` varchar(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '录播视频 URL',
  `video_mime_type` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'video/mp4',
  `video_file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `video_file_size` bigint NOT NULL DEFAULT '0',
  `duration_seconds` int NOT NULL DEFAULT '0',
  `stream_url` varchar(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '真实直播流地址',
  `cover_url` varchar(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '封面图 URL',
  `cover_object_key` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '封面图 OSS key',
  `cover_material_asset_id` bigint DEFAULT NULL COMMENT '素材库封面 ID',
  `share_title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '分享标题',
  `share_desc` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '分享描述',
  `share_image_url` varchar(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '分享图 URL',
  `share_image_object_key` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '分享图 OSS key',
  `share_image_material_asset_id` bigint DEFAULT NULL COMMENT '素材库分享图 ID',
  `start_time` datetime DEFAULT NULL COMMENT '开始时间',
  `duration_minutes` int DEFAULT NULL COMMENT '预计时长(分钟)',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT 'draft/scheduled/live/replay/ended/disabled',
  `allow_like` tinyint(1) NOT NULL DEFAULT '1',
  `allow_comment` tinyint(1) NOT NULL DEFAULT '1',
  `show_counters` tinyint(1) NOT NULL DEFAULT '1',
  `view_count` int NOT NULL DEFAULT '0',
  `view_pv_count` int NOT NULL DEFAULT '0',
  `view_uv_count` int NOT NULL DEFAULT '0',
  `like_count` int NOT NULL DEFAULT '0',
  `share_count` int NOT NULL DEFAULT '0',
  `created_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_live_rooms_slug` (`slug`) USING BTREE,
  KEY `idx_live_rooms_status_start` (`status`,`start_time`) USING BTREE,
  KEY `idx_live_rooms_created` (`created_at`) USING BTREE,
  KEY `idx_live_rooms_video_material` (`video_material_asset_id`) USING BTREE,
  KEY `idx_live_rooms_cover_material` (`cover_material_asset_id`) USING BTREE,
  KEY `idx_live_rooms_share_material` (`share_image_material_asset_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='公开直播/录播活动';



CREATE TABLE IF NOT EXISTS `live_interactions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `live_id` bigint NOT NULL,
  `visitor_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '匿名访客 ID',
  `nickname` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '评论昵称',
  `type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'view/like/share/comment',
  `dedupe_key` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'view/like 幂等键',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'visible' COMMENT 'visible/hidden/deleted',
  `content` text COLLATE utf8mb4_unicode_ci COMMENT '评论内容',
  `ip_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `user_agent` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_live_interactions_dedupe` (`dedupe_key`) USING BTREE,
  KEY `idx_live_interactions_live_type` (`live_id`,`type`,`created_at`) USING BTREE,
  KEY `idx_live_interactions_live_type_status_id` (`live_id`,`type`,`status`,`id`) USING BTREE,
  KEY `idx_live_interactions_visitor` (`live_id`,`visitor_id`,`type`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='公开直播互动记录';


CREATE TABLE IF NOT EXISTS `live_comment_settings` (
  `id` int NOT NULL,
  `block_words` text COLLATE utf8mb4_unicode_ci,
  `updated_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='直播评论配置';


CREATE TABLE IF NOT EXISTS `live_comment_toggle_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `live_id` bigint NOT NULL,
  `allow_comment` tinyint(1) NOT NULL DEFAULT '1',
  `previous_allow_comment` tinyint(1) NOT NULL DEFAULT '1',
  `operator_id` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_live_comment_toggle_logs_room_time` (`live_id`,`created_at`) USING BTREE,
  KEY `idx_live_comment_toggle_logs_operator` (`operator_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='直播评论开关记录';


ALTER TABLE `live_rooms` MODIFY `allow_comment` tinyint(1) NOT NULL DEFAULT '1';
UPDATE `live_rooms` SET `allow_comment` = 1 WHERE `deleted_at` IS NULL;
UPDATE `live_rooms`
SET `status` = CASE WHEN `content_type` = 'live_stream' THEN 'live' ELSE 'replay' END
WHERE `status` = 'published' AND `deleted_at` IS NULL;

-- Existing databases: run backend/sql/live_management_enhancements.sql after this file.
