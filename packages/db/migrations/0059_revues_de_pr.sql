CREATE TABLE `card_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`card_id` text NOT NULL,
	`author_conversation_id` text NOT NULL,
	`reviewer_conversation_id` text,
	`pr_number` integer NOT NULL,
	`pr_url` text NOT NULL,
	`branch` text NOT NULL,
	`base` text NOT NULL,
	`head_sha` text NOT NULL,
	`reviewed_sha` text,
	`round` integer DEFAULT 1 NOT NULL,
	`max_rounds` integer DEFAULT 3 NOT NULL,
	`state` text DEFAULT 'reviewing' NOT NULL,
	`decision_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_card_reviews_pr` ON `card_reviews` (`project_id`,`pr_number`);--> statement-breakpoint
CREATE INDEX `idx_card_reviews_card` ON `card_reviews` (`card_id`);--> statement-breakpoint
CREATE INDEX `idx_card_reviews_reviewer` ON `card_reviews` (`reviewer_conversation_id`);