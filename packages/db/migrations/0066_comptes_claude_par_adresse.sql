DROP INDEX `idx_claude_accounts_owner_label`;--> statement-breakpoint
ALTER TABLE `claude_accounts` ADD `email` text;--> statement-breakpoint
ALTER TABLE `claude_accounts` ADD `alias` text;--> statement-breakpoint
-- Retouché à la main : l'ancien libellé devient l'alias, sans quoi les comptes d'avant
-- les adresses perdraient leur nom. Le démarrage retrouve ensuite leur adresse et retire
-- l'alias qui ne fait que la répéter.
UPDATE `claude_accounts` SET `alias` = `label`;--> statement-breakpoint
CREATE INDEX `idx_claude_accounts_owner_email` ON `claude_accounts` (`owner_id`,`email`);--> statement-breakpoint
ALTER TABLE `claude_accounts` DROP COLUMN `label`;
