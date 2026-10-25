CREATE TABLE `card_issues` (
	`card_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`state` text NOT NULL,
	`pending` text,
	`push_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_card_issues_external` ON `card_issues` (`project_id`,`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_card_issues_pending` ON `card_issues` (`pending`);--> statement-breakpoint
CREATE TABLE `issue_sources` (
	`project_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`repository` text NOT NULL,
	`issues_cursor` text,
	`comments_cursor` text,
	`viewer` text,
	`polled_at` integer,
	`error` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
