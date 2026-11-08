ALTER TABLE `conversations` ADD `environment_where` text DEFAULT 'host' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `environment_confined` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `environment_where` text DEFAULT 'host' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `environment_confined` integer DEFAULT false NOT NULL;