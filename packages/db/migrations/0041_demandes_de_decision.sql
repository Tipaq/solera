ALTER TABLE `agent_requests` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `agent_requests` ADD `answer` text;--> statement-breakpoint
CREATE INDEX `idx_agent_requests_open` ON `agent_requests` (`kind`,`resolved_at`);