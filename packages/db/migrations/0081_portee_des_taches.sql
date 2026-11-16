-- Portée des tâches planifiées (#208). Une tâche existante sans projet était un fil libre
-- planifié : elle prend la portée « sans projet », les autres celle de leur projet.
ALTER TABLE `conversations` ADD `place` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `scope` text DEFAULT 'project' NOT NULL;--> statement-breakpoint
UPDATE `scheduled_tasks` SET `scope` = 'none' WHERE `project_id` IS NULL;
