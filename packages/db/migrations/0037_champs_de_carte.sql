CREATE TABLE `card_blocks` (
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`source_id`, `target_id`),
	FOREIGN KEY (`source_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_card_blocks_target` ON `card_blocks` (`target_id`);--> statement-breakpoint
CREATE TABLE `card_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`from_column` text NOT NULL,
	`to_column` text NOT NULL,
	`user_id` text,
	`moved_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_card_moves_card` ON `card_moves` (`card_id`,`moved_at`);--> statement-breakpoint
ALTER TABLE `cards` ADD `due_at` integer;--> statement-breakpoint
-- Retouché à la main : drizzle-kit écrit `REFERENCES cards(id)` sans l'action, et une
-- clé étrangère sans `ON DELETE` est en `NO ACTION` — supprimer une carte-jalon
-- échouait alors au lieu de détacher les cartes qu'elle portait. SQLite accepte la
-- clause dans un `ADD COLUMN` tant que la colonne est nullable, ce qu'elle est.
ALTER TABLE `cards` ADD `milestone_card_id` text REFERENCES cards(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_cards_milestone` ON `cards` (`milestone_card_id`);