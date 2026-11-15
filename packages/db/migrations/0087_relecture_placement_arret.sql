ALTER TABLE `project_actions` ADD `approved_placement` text;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `approved_pinned_branch` text;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `approved_stop_cadence` text;--> statement-breakpoint
-- Jusqu'ici, un agent ne réglait ni le placement ni l'arrêt : ceux d'une action déjà relue sont ceux qu'on a relus.
UPDATE `project_actions` SET `approved_placement` = `placement`, `approved_pinned_branch` = `pinned_branch`, `approved_stop_cadence` = `stop_cadence` WHERE `approved_command` IS NOT NULL;
