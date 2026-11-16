CREATE TABLE `action_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`project_id` text NOT NULL,
	`trigger` text NOT NULL,
	`conversation_id` text,
	`terminal_id` text,
	`cwd` text NOT NULL,
	`status` text NOT NULL,
	`exit_code` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`excerpt` text,
	FOREIGN KEY (`action_id`) REFERENCES `project_actions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_action_runs_action` ON `action_runs` (`action_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_action_runs_project` ON `action_runs` (`project_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `project_actions` ADD `approved_kind` text;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `approved_command` text;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `approved_subdir` text;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `approved_url` text;--> statement-breakpoint
-- Une action validée l'a été telle qu'elle est : c'est ce que sa relecture a vu.
UPDATE `project_actions` SET `approved_kind` = `kind`, `approved_command` = `command`, `approved_subdir` = `subdir`, `approved_url` = `url` WHERE `approved_at` IS NOT NULL;
