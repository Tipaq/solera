-- Les deux nouvelles colonnes ne sont pas recopiées : l'ancienne table ne les a pas, leurs défauts
-- (à la demande, à la racine) disent ce que faisait une tâche existante.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`agent` text NOT NULL,
	`config` text NOT NULL,
	`prompt` text NOT NULL,
	`cadence` text,
	`on_demand` integer DEFAULT true NOT NULL,
	`worktree_mode` text DEFAULT 'root' NOT NULL,
	`execution_mode` text DEFAULT 'fresh' NOT NULL,
	`overlap_policy` text DEFAULT 'skip' NOT NULL,
	`confined` integer,
	`max_duration_minutes` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by_conversation_id` text,
	`check_script` text,
	`check_timeout_seconds` integer DEFAULT 120 NOT NULL,
	`check_approved_at` integer,
	`check_proposed_by` text,
	`last_run_at` integer,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scheduled_tasks`("id", "project_id", "user_id", "name", "agent", "config", "prompt", "cadence", "execution_mode", "overlap_policy", "confined", "max_duration_minutes", "enabled", "created_by_conversation_id", "check_script", "check_timeout_seconds", "check_approved_at", "check_proposed_by", "last_run_at", "next_run_at", "created_at", "updated_at") SELECT "id", "project_id", "user_id", "name", "agent", "config", "prompt", "cadence", "execution_mode", "overlap_policy", "confined", "max_duration_minutes", "enabled", "created_by_conversation_id", "check_script", "check_timeout_seconds", "check_approved_at", "check_proposed_by", "last_run_at", "next_run_at", "created_at", "updated_at" FROM `scheduled_tasks`;--> statement-breakpoint
DROP TABLE `scheduled_tasks`;--> statement-breakpoint
ALTER TABLE `__new_scheduled_tasks` RENAME TO `scheduled_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_scheduled_tasks_project` ON `scheduled_tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_tasks_due` ON `scheduled_tasks` (`enabled`,`next_run_at`);