CREATE TABLE `card_relations` (
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_by` text,
	`conversation_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`source_id`, `target_id`, `kind`),
	FOREIGN KEY (`source_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_card_relations_target` ON `card_relations` (`target_id`);