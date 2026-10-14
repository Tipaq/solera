CREATE TABLE IF NOT EXISTS `vault_index_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`commit_sha` text,
	`indexed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vault_links` (
	`source_path` text NOT NULL,
	`target` text NOT NULL,
	`target_key` text NOT NULL,
	`target_path` text,
	`anchor` text,
	`alias` text,
	`line` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vault_links_source` ON `vault_links` (`source_path`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vault_links_target` ON `vault_links` (`target_path`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vault_notes` (
	`path` text PRIMARY KEY NOT NULL,
	`folder` text NOT NULL,
	`title` text NOT NULL,
	`words` integer NOT NULL,
	`bytes` integer NOT NULL,
	`tags` text NOT NULL,
	`modified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vault_notes_folder` ON `vault_notes` (`folder`);
