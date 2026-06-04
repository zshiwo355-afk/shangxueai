SET @db_name = DATABASE();

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD COLUMN `wecom_userid` varchar(128) DEFAULT NULL AFTER `disabled`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'wecom_userid'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD COLUMN `wecom_synced_at` datetime DEFAULT NULL AFTER `wecom_userid`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'wecom_synced_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD COLUMN `wecom_raw_json` longtext AFTER `wecom_synced_at`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'wecom_raw_json'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD UNIQUE KEY `uk_users_wecom_userid` (`wecom_userid`) USING BTREE',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND INDEX_NAME = 'uk_users_wecom_userid'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `notification_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `channel` varchar(32) NOT NULL,
  `event_type` varchar(64) NOT NULL,
  `recipient_user_id` bigint DEFAULT NULL,
  `recipient_wecom_userid` varchar(128) DEFAULT NULL,
  `business_type` varchar(64) NOT NULL,
  `business_id` bigint DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `payload_json` longtext,
  `response_json` longtext,
  `error` text,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_notification_logs_recipient` (`recipient_user_id`,`created_at`) USING BTREE,
  KEY `idx_notification_logs_business` (`business_type`,`business_id`) USING BTREE,
  KEY `idx_notification_logs_status` (`status`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='企业微信通知日志';

CREATE TABLE IF NOT EXISTS `wecom_sync_batches` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `mode` varchar(32) NOT NULL DEFAULT 'manual',
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
  `summary_json` longtext,
  `executed_by` bigint DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_wecom_sync_batches_started` (`started_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='企业微信同步批次';

CREATE TABLE IF NOT EXISTS `wecom_sync_entries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `batch_id` bigint NOT NULL,
  `user_id` bigint DEFAULT NULL,
  `wecom_userid` varchar(128) DEFAULT NULL,
  `mobile` varchar(32) DEFAULT NULL,
  `match_type` varchar(32) DEFAULT NULL,
  `action` varchar(32) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `reason` text,
  `before_json` longtext,
  `after_json` longtext,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_wecom_sync_entries_batch` (`batch_id`,`created_at`) USING BTREE,
  KEY `idx_wecom_sync_entries_user` (`user_id`,`created_at`) USING BTREE,
  KEY `idx_wecom_sync_entries_action` (`action`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='企业微信同步明细';

SET @db_name = DATABASE();

CREATE TABLE IF NOT EXISTS `magic_push_batches` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `content_type` varchar(32) NOT NULL,
  `content_id` bigint NOT NULL,
  `trigger_type` varchar(32) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `dedupe_key` varchar(255) NOT NULL,
  `target_snapshot_json` longtext,
  `title_snapshot` varchar(255) NOT NULL DEFAULT '',
  `scheduled_at` datetime DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `success_count` int NOT NULL DEFAULT '0',
  `failed_count` int NOT NULL DEFAULT '0',
  `skipped_count` int NOT NULL DEFAULT '0',
  `created_by` bigint DEFAULT NULL,
  `summary_json` longtext,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_magic_push_batches_dedupe` (`dedupe_key`) USING BTREE,
  KEY `idx_magic_push_batches_content` (`content_type`,`content_id`,`created_at`) USING BTREE,
  KEY `idx_magic_push_batches_status` (`status`,`scheduled_at`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院推送批次';

CREATE TABLE IF NOT EXISTS `magic_push_entries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `batch_id` bigint NOT NULL,
  `content_type` varchar(32) NOT NULL,
  `content_id` bigint NOT NULL,
  `recipient_user_id` bigint NOT NULL,
  `recipient_wecom_userid` varchar(128) DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `skip_reason` varchar(64) DEFAULT NULL,
  `error` text,
  `notification_log_id` bigint DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_magic_push_entries_batch_user` (`batch_id`,`recipient_user_id`) USING BTREE,
  KEY `idx_magic_push_entries_content_user` (`content_type`,`content_id`,`recipient_user_id`,`created_at`) USING BTREE,
  KEY `idx_magic_push_entries_status` (`status`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='魔学院推送明细';


-- 截止提醒：给 exams 加 deadline_at（NULL=不限），并补一个查询索引。
-- 此文件可重复执行，已有列 / 索引会自动跳过。

SET @db_name = DATABASE();

-- 1. exams.deadline_at
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `exams` ADD COLUMN `deadline_at` datetime DEFAULT NULL COMMENT ''考试截止时间（NULL=不限）'' AFTER `ai_weight`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'exams' AND COLUMN_NAME = 'deadline_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. exams 增加 (status, deadline_at) 联合索引，给 deadline reminder worker 扫表用
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `exams` ADD KEY `idx_exams_status_deadline` (`status`,`deadline_at`)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'exams' AND INDEX_NAME = 'idx_exams_status_deadline'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. paper_assignments 也补一个 (status, deadline_at) 联合索引
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `paper_assignments` ADD KEY `idx_paper_assignments_status_deadline` (`status`,`deadline_at`)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'paper_assignments' AND INDEX_NAME = 'idx_paper_assignments_status_deadline'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 轮播图管理：用户端首页可能展示的轮播位，后台先把入口与数据结构做出来。
-- 图片可以走管理员上传 OSS，也可以从素材库导入；统一存 image_url（公开访问 URL）+ image_object_key（OSS 对象键，删除时清理用）。
CREATE TABLE IF NOT EXISTS `banners` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL DEFAULT '' COMMENT '展示标题（可选）',
  `image_url` varchar(2048) NOT NULL COMMENT '图片公开访问 URL',
  `image_object_key` varchar(1024) NOT NULL DEFAULT '' COMMENT 'OSS 对象键，从素材库导入时为素材原 key',
  `link_url` varchar(2048) NOT NULL DEFAULT '' COMMENT '点击跳转链接（可选）',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '升序，越小越靠前',
  `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  `remark` varchar(500) NOT NULL DEFAULT '' COMMENT '备注',
  `material_asset_id` bigint DEFAULT NULL COMMENT '若来自素材库，记录来源素材 id',
  `created_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_banners_enabled_sort` (`enabled`,`sort_order`,`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='首页轮播图';




-- =========================================================================
-- 积分系统（point system）
-- 设计说明：
--   1. point_rules 是规则表：每种"加分动作"对应一条规则，code 是程序里引用的稳定标识符。
--      管理员可以改 points / daily_limit / enabled / description；不允许改 code（动了会断流水）。
--   2. point_transactions 是流水表，每次有效加分/扣分都产出一条不可变记录。
--      dedupe_key 走数据库 UNIQUE 来兜底防重复加分（例如同一个视频完成事件多次回调，
--      第二次会因 UNIQUE 冲突直接被丢弃，业务层不需要再做防重）。
--   3. user_point_summary 是用户积分汇总缓存，避免每次查总分都对流水做 SUM。
--      由服务层在写入流水时同步更新（同事务），数据保持强一致。
--   4. 历史数据不补算：上线前已发生的训练/视频完成/打卡/试卷不入账，从零开始。
-- =========================================================================

-- 规则表：所有积分规则在这里维护，code 是程序内引用标识符，不允许后台改。
CREATE TABLE IF NOT EXISTS `point_rules` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(64) NOT NULL COMMENT '程序标识符，例：training_deal / video_complete',
  `name` varchar(128) NOT NULL COMMENT '展示名',
  `category` varchar(32) NOT NULL DEFAULT '' COMMENT '分类：training/course/reading/paper/exam/manual',
  `points` int NOT NULL DEFAULT 0 COMMENT '默认加分（负数=扣分）',
  `daily_limit` int NOT NULL DEFAULT 0 COMMENT '0=不限；>0 表示同用户同规则每自然日最多入账次数',
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `description` varchar(500) NOT NULL DEFAULT '' COMMENT '规则文字说明，会展示给管理员',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_point_rules_code` (`code`) USING BTREE,
  KEY `idx_point_rules_category` (`category`,`enabled`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='积分规则';

-- 默认规则种子（已存在则不动，可改 points/daily_limit/enabled/description）
INSERT IGNORE INTO `point_rules` (`code`,`name`,`category`,`points`,`daily_limit`,`enabled`,`description`) VALUES
  ('training_deal',      'AI对练-成交',          'training', 20, 0, 1, '一次销售对练复盘结果为"成交"时入账'),
  ('training_intent',    'AI对练-意向客户',      'training', 10, 0, 1, '一次销售对练复盘结果为"意向客户"时入账'),
  ('training_other',     'AI对练-其他完成',      'training', 3,  5, 1, '一次销售对练完成但未达成上述结果，每日最多 5 次入账'),
  ('video_complete',     '课程-视频完整学完',    'course',   15, 0, 1, '同一视频首次标记为完成时入账（每用户每视频仅一次）'),
  ('quiz_pass',          '课程-随堂测通过',      'course',   5,  0, 1, '随堂测点位首次通过时入账（每用户每点位仅一次）'),
  ('reading_checkin',    '读书打卡-当日完成',    'reading',  8,  1, 1, '当日提交读书音频打卡时入账，每自然日最多 1 次'),
  ('reading_streak_7',   '读书打卡-连续7天奖励', 'reading',  30, 0, 1, '读书打卡连续达到 7 天时一次性奖励'),
  ('reading_streak_30',  '读书打卡-连续30天奖励','reading', 100, 0, 1, '读书打卡连续达到 30 天时一次性奖励'),
  ('paper_pass',         '考试-试卷通过',        'paper',    30, 0, 1, '试卷批阅完成且通过时入账（每用户每试卷仅一次）'),
  ('exam_pass',          'AI通关-考试通过',      'exam',     50, 0, 1, 'AI通关考试通过时入账（每用户每 exam 仅一次）'),
  ('manual_adjust',      '手动调整',             'manual',   0,  0, 1, '管理员手动加减分使用，不依赖默认 points');

-- 流水表：每次成功入账写一条；dedupe_key 唯一防重复。
CREATE TABLE IF NOT EXISTS `point_transactions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `rule_code` varchar(64) NOT NULL COMMENT '关联 point_rules.code（manual_adjust 也走这里）',
  `category` varchar(32) NOT NULL DEFAULT '' COMMENT '冗余 category，便于按维度聚合',
  `points` int NOT NULL COMMENT '实际入账分数（已应用规则、上限、手动覆盖之后的值）',
  `business_type` varchar(32) NOT NULL DEFAULT '' COMMENT '业务类型：training_record/video_progress/...',
  `business_id` bigint DEFAULT NULL COMMENT '业务主键 id（manual_adjust 无）',
  `dedupe_key` varchar(255) NOT NULL COMMENT '幂等键，保证同事件不重复入账',
  `remark` varchar(500) NOT NULL DEFAULT '',
  `operator_id` bigint DEFAULT NULL COMMENT '手动调分时记录管理员 user_id',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_point_transactions_dedupe` (`dedupe_key`) USING BTREE,
  KEY `idx_point_transactions_user_time` (`user_id`,`created_at`) USING BTREE,
  KEY `idx_point_transactions_rule_time` (`rule_code`,`created_at`) USING BTREE,
  KEY `idx_point_transactions_category_time` (`category`,`created_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='积分流水';

-- 用户积分汇总：避免每次查总分都对流水做 SUM；服务层与流水写入同事务更新。
CREATE TABLE IF NOT EXISTS `user_point_summary` (
  `user_id` bigint NOT NULL,
  `total_points` int NOT NULL DEFAULT 0 COMMENT '累计总分（含历史扣分）',
  `training_points` int NOT NULL DEFAULT 0 COMMENT 'category=training 的累计',
  `course_points` int NOT NULL DEFAULT 0 COMMENT 'category=course 的累计',
  `reading_points` int NOT NULL DEFAULT 0 COMMENT 'category=reading 的累计',
  `paper_points` int NOT NULL DEFAULT 0 COMMENT 'category=paper 的累计',
  `exam_points` int NOT NULL DEFAULT 0 COMMENT 'category=exam 的累计',
  `manual_points` int NOT NULL DEFAULT 0 COMMENT 'category=manual 的累计',
  `streak_days` int NOT NULL DEFAULT 0 COMMENT '当前读书打卡连续天数',
  `max_streak_days` int NOT NULL DEFAULT 0 COMMENT '历史最长连续天数',
  `last_checkin_date` date DEFAULT NULL COMMENT '最近一次打卡日期，用于 streak 计算',
  `last_event_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`) USING BTREE,
  KEY `idx_user_point_summary_total` (`total_points` DESC) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='用户积分汇总';


-- =========================================================================
-- 导师专区（mentors）
-- 设计说明：
--   1. 导师身份与 users.role 解耦：一条 mentors 记录通过 user_id 关联到 users，但不影响其角色。
--      一个 user 最多对应一条 mentors（UNIQUE user_id）；删除导师档案不影响用户本身。
--   2. 用户端展示信息全部存这里，不在 users 表加冗余字段；展示名/头像可独立维护。
--   3. mentor_recommendations：导师可以挂载推荐内容（视频 / 读物 / 试卷 / 外链），
--      target_type 决定 target_id 怎么解析；用户端点击导师详情时一并展示。
--   4. 头像走素材库选择或本地上传（与 banners 同一套 OSS helpers）。
-- =========================================================================

CREATE TABLE IF NOT EXISTS `mentors` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '关联 users.id；不强约束 role',
  `display_name` varchar(128) NOT NULL COMMENT '对外展示名（默认 = users.display_name）',
  `title` varchar(128) NOT NULL DEFAULT '' COMMENT '头衔，例：金牌讲师 / 销售总监',
  `avatar_url` varchar(2048) NOT NULL DEFAULT '' COMMENT '头像公开 URL',
  `avatar_object_key` varchar(1024) NOT NULL DEFAULT '' COMMENT 'OSS 对象键',
  `avatar_material_id` bigint DEFAULT NULL COMMENT '若来自素材库，记录原 material_assets.id',
  `tagline` varchar(255) NOT NULL DEFAULT '' COMMENT '一句话签名',
  `bio` text COMMENT '长简介（支持换行，前端按段落展示）',
  `expertise_tags` varchar(500) NOT NULL DEFAULT '' COMMENT '专长标签，逗号分隔',
  `years_experience` int NOT NULL DEFAULT 0 COMMENT '从业年限',
  `contact_wecom` varchar(128) NOT NULL DEFAULT '' COMMENT '企业微信联系方式（可选）',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '升序，越小越靠前',
  `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否在用户端展示',
  `featured` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否首页推荐位',
  `created_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_mentors_user` (`user_id`) USING BTREE,
  KEY `idx_mentors_enabled_sort` (`enabled`,`sort_order`,`id`) USING BTREE,
  KEY `idx_mentors_featured` (`featured`,`enabled`,`sort_order`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='导师档案';

CREATE TABLE IF NOT EXISTS `mentor_recommendations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `mentor_id` bigint NOT NULL,
  `target_type` varchar(32) NOT NULL COMMENT 'video / reading / paper / link',
  `target_id` bigint DEFAULT NULL COMMENT '内置类型的资源 id；link 类型时为空',
  `link_url` varchar(2048) NOT NULL DEFAULT '' COMMENT 'target_type=link 时使用',
  `title` varchar(255) NOT NULL DEFAULT '' COMMENT '展示标题（覆盖目标资源原标题）',
  `note` varchar(500) NOT NULL DEFAULT '' COMMENT '导师寄语',
  `sort_order` int NOT NULL DEFAULT 0,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_mentor_recommendations_mentor` (`mentor_id`,`enabled`,`sort_order`) USING BTREE,
  KEY `idx_mentor_recommendations_target` (`target_type`,`target_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='导师推荐内容';
