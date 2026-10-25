CREATE TABLE `claude_transcript_cursors` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`journal_seq` integer NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_events_native_tool` ON `events` (`conversation_id`,`type`,("payload" ->> '$.toolCallId'),`seq`) WHERE "events"."type" = 'tool.started' or "events"."type" = 'tool.completed';