-- 现有用户在职状态回填
-- 如需覆盖所有用户，可去掉 WHERE 条件。
UPDATE `users`
SET `employment_status` = '转正'
WHERE `employment_status` IS NULL OR `employment_status` = '';
