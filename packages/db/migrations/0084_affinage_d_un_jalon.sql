-- La session d'affinage d'un jalon (#184) : son mode, et l'index qui la retrouve depuis la
-- carte qu'elle affine. Les découpages d'avant le mode posaient leurs questions d'abord.
ALTER TABLE `conversations` ADD `split_mode` text;--> statement-breakpoint
UPDATE `conversations` SET `split_mode` = 'questions' WHERE `purpose` = 'split';--> statement-breakpoint
CREATE INDEX `idx_conversations_split_card` ON `conversations` (`split_card_id`,`created_at`);
