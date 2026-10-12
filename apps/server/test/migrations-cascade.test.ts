import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { openDatabase, runMigrations } from '@solera/db'

/**
 * Ce qu'une migration ne doit jamais faire : emporter le journal en silence.
 *
 * SQLite ne sait ni retirer un `NOT NULL` ni changer une contrainte. Une migration qui le
 * demande recrée la table — copier, `DROP`, renommer — et Drizzle écrit alors un
 * `PRAGMA foreign_keys=OFF` en tête du fichier. Ce pragma est un **non-opérant à
 * l'intérieur d'une transaction**, et le migrateur entoure tout le lot d'un `BEGIN` : il
 * ne désactive donc rien. Le `DROP TABLE` de la table mère part clés actives, et chaque
 * enfant en `ON DELETE CASCADE` est vidé. La migration réussit, la base reste cohérente,
 * et l'historique de toutes les conversations n'est plus là.
 *
 * C'est arrivé : la migration 0032 a vidé les 27 000 événements d'une instance de
 * développement, et aurait vidé les 115 000 de l'instance réelle au déploiement suivant.
 * Le test part donc d'une base peuplée *avant* la migration fautive, et vérifie ce que
 * personne ne regarde quand une migration dit « ok » : que les enfants sont toujours là.
 */

const MIGRATIONS = fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url))

/** La dernière migration qui recrée `conversations`, donc celle qui met le piège. */
const RECREATES_CONVERSATIONS = '0032_fil_libre'

/**
 * Un dossier de migrations tronqué juste avant `tag`, pour fabriquer une base d'avant.
 *
 * Le journal porte l'ordre ; tronquer les deux (fichiers et journal) donne un dossier
 * que Drizzle applique sans rien savoir de la suite.
 */
async function migrationsBefore(dir: string, tag: string): Promise<string> {
  const folder = join(dir, 'migrations')
  await cp(MIGRATIONS, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  const cut = journal.entries.findIndex((entry) => entry.tag === tag)
  assert.notEqual(cut, -1, `migration ${tag} introuvable : le test garde un repère disparu`)
  const kept = journal.entries.slice(0, cut)
  await writeFile(journalPath, JSON.stringify({ ...journal, entries: kept }, null, 2))
  for (const name of await readdir(folder)) {
    if (!name.endsWith('.sql')) continue
    if (!kept.some((entry) => `${entry.tag}.sql` === name)) await rm(join(folder, name))
  }
  return folder
}

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-migrations-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('une recréation de table ne vide pas les tables en cascade', async (t) => {
  const dir = await harness(t)
  const file = join(dir, 'test.sqlite')
  const before = await migrationsBefore(dir, RECREATES_CONVERSATIONS)

  // Une base d'avant la migration fautive, peuplée comme une vraie : une conversation,
  // son journal, et une pièce jointe. Les trois tables sont filles de `conversations`.
  const first = openDatabase(file)
  runMigrations(first.db, before)
  first.sqlite.exec(`
    INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at)
      VALUES ('u1', 'alex', 'Alex', '', 0, 1);
    INSERT INTO projects (id, owner_id, name, workspace_path, visibility, position, created_at)
      VALUES ('p1', 'u1', 'Projet', '/tmp/p1', 'private', 0, 1);
    INSERT INTO conversations (id, project_id, user_id, title, agent, config, status, created_at, updated_at)
      VALUES ('c1', 'p1', 'u1', 'Un fil', 'claude', '{}', 'idle', 1, 1);
    INSERT INTO events (conversation_id, seq, ts, type, payload)
      VALUES ('c1', 1, 1, 'message.user', '{}'), ('c1', 2, 2, 'message.assistant', '{}');
    INSERT INTO attachments (id, user_id, conversation_id, filename, mime_type, size_bytes, storage_path, created_at)
      VALUES ('a1', 'u1', 'c1', 'note.txt', 'text/plain', 3, '/tmp/a1', 1);
  `)
  first.sqlite.close()

  // Puis toutes les migrations, celle qui recrée `conversations` comprise.
  const { db, sqlite } = openDatabase(file)
  t.after(() => sqlite.close())
  runMigrations(db, MIGRATIONS)

  const count = (table: string) =>
    (sqlite.prepare(`select count(*) c from ${table}`).get() as { c: number }).c
  assert.equal(count('conversations'), 1, 'la conversation elle-même a survécu')
  assert.equal(count('events'), 2, 'le journal doit survivre à la recréation de sa table mère')
  assert.equal(count('attachments'), 1, 'les pièces jointes aussi')

  // Et la migration a bien fait son travail : un fil sans projet est désormais possible.
  sqlite
    .prepare(
      `INSERT INTO conversations (id, project_id, user_id, title, agent, config, status, created_at, updated_at)
       VALUES ('c2', NULL, 'u1', 'Fil libre', 'claude', '{}', 'idle', 1, 1)`,
    )
    .run()
  assert.equal(count('conversations'), 2)
})
