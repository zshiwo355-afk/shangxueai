-- AI 通关取消人工复核：将历史待复核记录按已有 AI 分数自动收口。
-- 本迁移不修改表结构，可重复执行。

START TRANSACTION;

UPDATE `exam_attempts` AS `a`
JOIN `exams` AS `e` ON `e`.`id` = `a`.`exam_id`
SET
  `a`.`is_pass` = (`a`.`score` >= `e`.`pass_score`),
  `a`.`final_score` = `a`.`score`,
  `a`.`final_is_pass` = (`a`.`score` >= `e`.`pass_score`)
WHERE `a`.`status` = 'completed'
  AND `a`.`score` IS NOT NULL
  AND (`a`.`final_score` IS NULL OR `a`.`final_is_pass` IS NULL);

UPDATE `exams` AS `e`
JOIN (
  SELECT
    `a`.`exam_id`,
    `a`.`final_is_pass`,
    `a`.`completed_at`
  FROM `exam_attempts` AS `a`
  JOIN (
    SELECT `exam_id`, MAX(`attempt_no`) AS `attempt_no`
    FROM `exam_attempts`
    WHERE `status` = 'completed'
    GROUP BY `exam_id`
  ) AS `latest`
    ON `latest`.`exam_id` = `a`.`exam_id`
   AND `latest`.`attempt_no` = `a`.`attempt_no`
) AS `last_attempt` ON `last_attempt`.`exam_id` = `e`.`id`
SET
  `e`.`status` = CASE
    WHEN `last_attempt`.`final_is_pass` = 1 THEN 'passed'
    WHEN `e`.`attempt_count` >= `e`.`max_attempts` THEN 'failed'
    ELSE 'pending'
  END,
  `e`.`completed_at` = CASE
    WHEN `last_attempt`.`final_is_pass` = 1 OR `e`.`attempt_count` >= `e`.`max_attempts`
      THEN `last_attempt`.`completed_at`
    ELSE NULL
  END
WHERE `e`.`status` = 'pending_review';

COMMIT;
