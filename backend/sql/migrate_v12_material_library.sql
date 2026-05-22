START TRANSACTION;

CREATE TABLE IF NOT EXISTS `material_projects` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(255) NOT NULL,
  `description` TEXT         NULL,
  `oss_prefix`  VARCHAR(255) NOT NULL DEFAULT '',
  `visibility`  VARCHAR(16)  NOT NULL DEFAULT 'admin',
  `created_by`  BIGINT       NOT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted`  TINYINT(1)   NOT NULL DEFAULT 0,
  `deleted_at`  DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_material_projects_creator` (`created_by`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全局素材项目';

CREATE TABLE IF NOT EXISTS `material_assets` (
  `id`               BIGINT        NOT NULL AUTO_INCREMENT,
  `project_id`       BIGINT        NOT NULL,
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
  KEY `idx_material_assets_project_type` (`project_id`, `asset_type`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全局素材文件';

COMMIT;
