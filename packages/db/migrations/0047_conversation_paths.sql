CREATE TABLE `conversation_paths` (
	`conversation_id` text NOT NULL,
	`path` text NOT NULL,
	`last_ts` integer NOT NULL,
	PRIMARY KEY(`conversation_id`, `path`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `agent_requests` ADD `worktree_path` text;--> statement-breakpoint
-- Rattrapage unique : les éditions déjà journalisées hors du répertoire de travail
-- (chemin absolu) alimentent la table, pour que les chantiers existants soient
-- rattachés à leurs sessions sans attendre une nouvelle écriture. Les dossiers cités
-- par les commandes sont rattrapés au démarrage (`worktrees/backfill.ts`).
INSERT INTO `conversation_paths` (`conversation_id`, `path`, `last_ts`)
SELECT `conversation_id`, `payload` ->> '$.path', max(`ts`)
FROM `events`
WHERE `type` = 'file.edited' AND substr(`payload` ->> '$.path', 1, 1) = '/'
  AND `conversation_id` IN (SELECT `id` FROM `conversations`)
GROUP BY `conversation_id`, `payload` ->> '$.path';
