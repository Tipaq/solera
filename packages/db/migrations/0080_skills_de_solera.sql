-- Les skills écrits pour Solera, livrés par le dossier `skills/` de son propre dépôt. Même
-- règle que les sources de 0028 : insérée ici et non au démarrage, pour qu'une source
-- supprimée ne revienne pas. `ref` reste vide : pour cette source, vide veut dire « le
-- tag de la version installée », voir `skill-library/solera-skills.ts`.
INSERT INTO `skill_sources` (`id`, `name`, `url`, `ref`, `subpath`, `builtin`, `enabled`, `created_at`, `updated_at`)
VALUES
  ('builtin:solera-skills', 'Tipaq/solera', 'https://github.com/Tipaq/solera.git', NULL, 'skills', 1, 1,
   CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
