START TRANSACTION;

CREATE TABLE IF NOT EXISTS `magic_reading_contents` (
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

CREATE TABLE IF NOT EXISTS `magic_reading_content_targets` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `content_id`  BIGINT       NOT NULL,
  `target_type` VARCHAR(32)  NOT NULL COMMENT 'all / department / user',
  `target_id`   VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_magic_reading_content_targets_lookup` (`content_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='读书内容推送对象';

COMMIT;
