-- La PR finale d'un jalon (#198) : fermée sans fusion, et la branche qu'elle vise.
ALTER TABLE `cards` ADD `branch_pr_closed_at` integer;--> statement-breakpoint
ALTER TABLE `cards` ADD `branch_pr_base` text;