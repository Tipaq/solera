ALTER TABLE `cards` RENAME COLUMN `milestone_card_id` TO `parent_id`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_cards_milestone`;--> statement-breakpoint
CREATE INDEX `idx_cards_parent` ON `cards` (`parent_id`);--> statement-breakpoint
ALTER TABLE `cards` ADD `accepted_at` integer;--> statement-breakpoint
UPDATE `cards` SET `accepted_at` = `created_at`;--> statement-breakpoint
ALTER TABLE `cards` ADD `to_clarify_since` integer;
