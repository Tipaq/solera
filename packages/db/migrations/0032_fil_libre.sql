PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`worktree_id` text,
	`card_id` text,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`title_set_by_user` integer DEFAULT false NOT NULL,
	`agent` text NOT NULL,
	`agent_session_id` text,
	`forked_from_id` text,
	`created_by_token_id` text,
	`origin_label` text,
	`schedule_id` text,
	`config` text NOT NULL,
	`status` text NOT NULL,
	`background_count` integer DEFAULT 0 NOT NULL,
	`loop_count` integer DEFAULT 0 NOT NULL,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`last_notable_seq` integer DEFAULT 0 NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`journal_bytes` integer DEFAULT 0 NOT NULL,
	`context_used_tokens` integer,
	`context_max_tokens` integer,
	`model` text,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("id", "project_id", "worktree_id", "card_id", "user_id", "title", "title_set_by_user", "agent", "agent_session_id", "forked_from_id", "created_by_token_id", "origin_label", "schedule_id", "config", "status", "background_count", "loop_count", "last_seq", "last_notable_seq", "turn_count", "journal_bytes", "context_used_tokens", "context_max_tokens", "model", "cost_usd", "input_tokens", "output_tokens", "pinned", "position", "archived_at", "created_at", "updated_at") SELECT "id", "project_id", "worktree_id", "card_id", "user_id", "title", "title_set_by_user", "agent", "agent_session_id", "forked_from_id", "created_by_token_id", "origin_label", "schedule_id", "config", "status", "background_count", "loop_count", "last_seq", "last_notable_seq", "turn_count", "journal_bytes", "context_used_tokens", "context_max_tokens", "model", "cost_usd", "input_tokens", "output_tokens", "pinned", "position", "archived_at", "created_at", "updated_at" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_conversations_project` ON `conversations` (`project_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_conversations_user` ON `conversations` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_conversations_schedule` ON `conversations` (`schedule_id`);--> statement-breakpoint
CREATE TABLE `__new_scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`agent` text NOT NULL,
	`config` text NOT NULL,
	`prompt` text NOT NULL,
	`cadence` text NOT NULL,
	`execution_mode` text DEFAULT 'fresh' NOT NULL,
	`overlap_policy` text DEFAULT 'skip' NOT NULL,
	`max_duration_minutes` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by_conversation_id` text,
	`last_run_at` integer,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scheduled_tasks`("id", "project_id", "user_id", "name", "agent", "config", "prompt", "cadence", "execution_mode", "overlap_policy", "max_duration_minutes", "enabled", "created_by_conversation_id", "last_run_at", "next_run_at", "created_at", "updated_at") SELECT "id", "project_id", "user_id", "name", "agent", "config", "prompt", "cadence", "execution_mode", "overlap_policy", "max_duration_minutes", "enabled", "created_by_conversation_id", "last_run_at", "next_run_at", "created_at", "updated_at" FROM `scheduled_tasks`;--> statement-breakpoint
DROP TABLE `scheduled_tasks`;--> statement-breakpoint
ALTER TABLE `__new_scheduled_tasks` RENAME TO `scheduled_tasks`;--> statement-breakpoint
CREATE INDEX `idx_scheduled_tasks_project` ON `scheduled_tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_tasks_due` ON `scheduled_tasks` (`enabled`,`next_run_at`);