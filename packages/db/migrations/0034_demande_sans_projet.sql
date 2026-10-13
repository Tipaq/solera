PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`conversation_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`settled_at` integer,
	`result` text,
	`is_error` integer DEFAULT false NOT NULL,
	`launched_conversation_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_requests`("id", "project_id", "conversation_id", "kind", "payload", "created_at", "settled_at", "result", "is_error", "launched_conversation_id") SELECT "id", "project_id", "conversation_id", "kind", "payload", "created_at", "settled_at", "result", "is_error", "launched_conversation_id" FROM `agent_requests`;--> statement-breakpoint
DROP TABLE `agent_requests`;--> statement-breakpoint
ALTER TABLE `__new_agent_requests` RENAME TO `agent_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_agent_requests_pending` ON `agent_requests` (`settled_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_requests_from` ON `agent_requests` (`conversation_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_requests_launched` ON `agent_requests` (`launched_conversation_id`);