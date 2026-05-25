-- Performance indexes for high-frequency admin/user list queries.
-- Safe to run repeatedly on MySQL 8+.

SET @schema_name = DATABASE();

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD INDEX `idx_users_role_disabled_status_dept` (`role`, `disabled`, `status`, `department`)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'users'
    AND index_name = 'idx_users_role_disabled_status_dept'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `exams` ADD INDEX `idx_exams_created_at` (`created_at`)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'exams'
    AND index_name = 'idx_exams_created_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `magic_videos` ADD INDEX `idx_magic_videos_deleted_created` (`deleted_at`, `created_at`)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'magic_videos'
    AND index_name = 'idx_magic_videos_deleted_created'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `material_projects` ADD INDEX `idx_material_projects_visibility` (`is_deleted`, `visibility`, `created_by`)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'material_projects'
    AND index_name = 'idx_material_projects_visibility'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `material_assets` ADD INDEX `idx_material_assets_deleted_type_created` (`is_deleted`, `asset_type`, `created_at`, `id`)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'material_assets'
    AND index_name = 'idx_material_assets_deleted_type_created'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
