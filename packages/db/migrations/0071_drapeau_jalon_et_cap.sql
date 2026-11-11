ALTER TABLE `cards` ADD `milestone` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `cap` text;--> statement-breakpoint
-- Une carte de premier niveau qui a des enfants était un jalon de fait : elle le reste.
UPDATE `cards` SET `milestone` = 1 WHERE `parent_id` IS NULL AND `id` IN (SELECT `parent_id` FROM `cards` WHERE `parent_id` IS NOT NULL);
