import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

export * as schema from './schema.js'
export * from './schema.js'

export type SqliteHandle = InstanceType<typeof Database>
/**
 * `$client` fait partie du type : c'est `drizzle()` qui le pose, et toutes les bases de
 * l'application sortent d'`openDatabase`. Les migrations en ont besoin pour parler à la
 * connexion elle-même, hors de toute transaction.
 */
export type Db = BetterSQLite3Database<typeof schema> & { $client: SqliteHandle }
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Transaction d'écriture, à préférer partout à `db.transaction`.
 *
 * `BEGIN IMMEDIATE` plutôt que le `BEGIN` différé de better-sqlite3 : une transaction
 * différée commence en lecture et ne demande le verrou d'écriture qu'à sa première
 * modification. Si un autre écrivain a committé entre-temps, SQLite refuse la montée
 * en écriture par un `SQLITE_BUSY_SNAPSHOT` immédiat, sans passer par le busy handler.
 * Le `busy_timeout` ne joue donc pas, et l'appelant reçoit « database is locked » alors
 * qu'il aurait suffi d'attendre. Prendre le verrou dès le départ rend l'attente
 * possible, au prix d'un verrou tenu un peu plus longtemps.
 *
 * Le cas s'est produit en vrai : le serveur MCP écrit une note de carte pendant que le
 * runner journalise le tour, l'écriture du journal a échoué et la session est morte
 * en plein travail.
 */
export function writeTransaction<T>(db: Db, body: (tx: Tx) => T): T {
  return db.transaction(body, { behavior: 'immediate' })
}

export function openDatabase(file: string): { db: Db; sqlite: SqliteHandle } {
  mkdirSync(dirname(file), { recursive: true })

  const sqlite = new Database(file)
  // WAL pour que les lectures du journal ne bloquent pas les écritures du daemon.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

/**
 * Applique les migrations en attente, **clés étrangères désactivées**.
 *
 * SQLite ne sait pas retirer un `NOT NULL` ni changer une contrainte : une migration qui
 * le demande recrée la table — copier, `DROP`, renommer. Drizzle écrit alors un
 * `PRAGMA foreign_keys=OFF` en tête du fichier, et c'est un piège : **ce pragma est un
 * non-opérant à l'intérieur d'une transaction**, et le migrateur de Drizzle entoure
 * tout le lot d'un `BEGIN`. Il ne désactive donc rien. Le `DROP TABLE` de la table mère
 * part avec les clés toujours actives, et chaque enfant en `ON DELETE CASCADE` est vidé
 * sans un mot — le journal des conversations, leurs pièces jointes, leurs demandes de
 * permission. La migration réussit, la base est cohérente, et l'historique n'est plus là.
 *
 * Posé ici, hors de toute transaction, le pragma prend effet pour de bon. `foreign_key_check`
 * ensuite, parce qu'une recréation fautive ne doit pas passer inaperçue sous prétexte
 * qu'on vient de taire le contrôle.
 */
export function runMigrations(db: Db, migrationsFolder: string): void {
  const sqlite = db.$client
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(db, { migrationsFolder })
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }

  const broken = sqlite.pragma('foreign_key_check') as { table: string }[]
  if (broken.length > 0) {
    const tables = [...new Set(broken.map((row) => row.table))].join(', ')
    throw new Error(
      `Migrations appliquées, mais les clés étrangères ne tiennent plus (${tables}). ` +
        'La base n\'est pas démarrable en l\'état : restaurer la sauvegarde d\'avant migration.',
    )
  }
}
