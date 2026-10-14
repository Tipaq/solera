ALTER TABLE `agent_requests` ADD `accepted_at` integer;--> statement-breakpoint
ALTER TABLE `agent_requests` ADD `resolved_at` integer;--> statement-breakpoint
CREATE INDEX `idx_agent_requests_accepted` ON `agent_requests` (`accepted_at`);