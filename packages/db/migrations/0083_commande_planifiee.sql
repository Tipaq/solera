ALTER TABLE `project_actions` ADD `approved_cadence` text;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `on_demand` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `cadence` text;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `schedule_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `schedule_max_minutes` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `last_scheduled_at` integer;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `next_run_at` integer;--> statement-breakpoint
CREATE INDEX `idx_project_actions_next_run` ON `project_actions` (`next_run_at`);