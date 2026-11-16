ALTER TABLE `milestone_runs` ADD `confined` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `autonomous_confined` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `confined` integer;