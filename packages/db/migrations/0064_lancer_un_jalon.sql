CREATE TABLE `milestone_run_cards` (
	`run_id` text NOT NULL,
	`card_id` text NOT NULL,
	`config` text,
	`launch` text NOT NULL,
	`conversation_id` text,
	`error` text,
	`notified_block` text,
	`launched_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `card_id`),
	FOREIGN KEY (`run_id`) REFERENCES `milestone_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_milestone_run_cards_card` ON `milestone_run_cards` (`card_id`);--> statement-breakpoint
CREATE TABLE `milestone_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`card_id` text NOT NULL,
	`state` text NOT NULL,
	`concurrency` integer DEFAULT 3 NOT NULL,
	`config` text NOT NULL,
	`started_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_milestone_runs_active` ON `milestone_runs` (`card_id`) WHERE "milestone_runs"."state" in ('running', 'paused');