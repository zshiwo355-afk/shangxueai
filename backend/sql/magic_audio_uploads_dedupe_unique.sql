SET NAMES utf8mb4;

-- 读书打卡去重 + 唯一约束迁移
-- 目的：
-- 1. 清理同一 user_id + reading_content_id 的重复活动记录，仅保留最早一条；
-- 2. 为未删除且已绑定 reading_content_id 的记录建立唯一约束；
-- 3. 保留历史 reading_content_id IS NULL 的 legacy 数据，不做自动归因。

START TRANSACTION;

ALTER TABLE `magic_audio_uploads`
  ADD COLUMN IF NOT EXISTS `active_reading_content_id` BIGINT
  GENERATED ALWAYS AS (
    CASE
      WHEN `is_deleted` = 0 THEN `reading_content_id`
      ELSE NULL
    END
  ) STORED;

UPDATE `magic_audio_uploads` dup
JOIN (
  SELECT `user_id`, `reading_content_id`, MIN(`id`) AS `keep_id`
  FROM `magic_audio_uploads`
  WHERE `is_deleted` = 0
    AND `reading_content_id` IS NOT NULL
  GROUP BY `user_id`, `reading_content_id`
  HAVING COUNT(*) > 1
) keepers
  ON keepers.`user_id` = dup.`user_id`
 AND keepers.`reading_content_id` = dup.`reading_content_id`
SET dup.`is_deleted` = 1,
    dup.`deleted_at` = COALESCE(dup.`deleted_at`, NOW()),
    dup.`remark` = CONCAT(
      LEFT(COALESCE(dup.`remark`, ''), 200),
      CASE
        WHEN COALESCE(dup.`remark`, '') = '' THEN ''
        ELSE ' '
      END,
      '[deduped before unique index]'
    )
WHERE dup.`is_deleted` = 0
  AND dup.`id` <> keepers.`keep_id`;

ALTER TABLE `magic_audio_uploads`
  ADD UNIQUE KEY `uk_magic_audio_uploads_user_content` (`user_id`, `active_reading_content_id`);

COMMIT;
