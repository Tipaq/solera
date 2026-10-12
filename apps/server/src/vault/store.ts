import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  vaultIndexState,
  vaultLinks,
  vaultNotes,
  writeTransaction,
  type Db,
  type Tx,
  type VaultIndexStateRow,
} from '@solera/db'
import {
  VAULT_CROSSROADS_MIN_INCOMING,
  type VaultCountsDto,
  type VaultFolderDto,
  type VaultLinkDto,
  type VaultNoteDto,
  type VaultNoteFactsDto,
  type VaultNoteFilter,
  type VaultTreeDto,
} from '@solera/protocol'
import { buildResolver, targetKey } from './resolve.js'
import type { NoteRecord } from './scan.js'

/**
 * L'écriture et la lecture de l'index niveau 1.
 *
 * Une seule porte d'écriture, `applyBatch` : une passe complète comme un rattrapage y
 * passent, ce qui interdit aux deux chemins de diverger. Les lectures, elles, sont des
 * requêtes — aucun fait n'est stocké deux fois. Les liens entrants ne sont pas une
 * colonne mais l'inversion des liens sortants, parce que c'est *tout* ce qu'ils sont.
 */

/** La ligne unique de `vault_index_state`. */
const STATE_ID = 1

export interface IndexBatch {
  /** La racine que cette passe reflète. Changée, l'index entier est remplacé. */
  root: string
  /** Notes lues, à écrire ou réécrire. */
  upserts: NoteRecord[]
  /** Notes disparues du disque. */
  removals: string[]
  /** Le commit reflété après cette passe, `null` hors dépôt git. */
  commitSha: string | null
  /** Vrai pour une passe complète : l'index est vidé avant d'être réécrit. */
  full: boolean
}

export function readIndexState(db: Db): VaultIndexStateRow | null {
  return db.select().from(vaultIndexState).where(eq(vaultIndexState.id, STATE_ID)).get() ?? null
}

/**
 * Applique une passe d'indexation, et ne rend la main qu'une fois l'état cohérent.
 *
 * Tout dans une transaction d'écriture : un index à moitié écrit mentirait sur les
 * liens entrants, et un redémarrage au mauvais moment le laisserait ainsi. Le SHA
 * n'est posé qu'à la fin, pour la même raison — il affirme que l'index reflète ce
 * commit, donc il ne doit jamais être écrit avant que ce soit vrai.
 */
export function applyBatch(db: Db, batch: IndexBatch): { indexed: number; removed: number } {
  return writeTransaction(db, (tx) => {
    if (batch.full) {
      tx.delete(vaultLinks).run()
      tx.delete(vaultNotes).run()
    }

    for (const chunk of chunks(batch.removals)) {
      tx.delete(vaultNotes).where(inArray(vaultNotes.path, chunk)).run()
      tx.delete(vaultLinks).where(inArray(vaultLinks.sourcePath, chunk)).run()
    }

    for (const record of batch.upserts) {
      tx.insert(vaultNotes)
        .values({
          path: record.path,
          folder: record.folder,
          title: record.title,
          words: record.words,
          bytes: record.bytes,
          tags: JSON.stringify(record.tags),
          modifiedAt: record.modifiedAt,
        })
        .onConflictDoUpdate({
          target: vaultNotes.path,
          set: {
            folder: record.folder,
            title: record.title,
            words: record.words,
            bytes: record.bytes,
            tags: JSON.stringify(record.tags),
            modifiedAt: record.modifiedAt,
          },
        })
        .run()

      // Les liens d'une note se remplacent en bloc : une ligne retirée du texte doit
      // disparaître de l'index, et comparer occurrence par occurrence coûterait plus
      // que de tout réécrire.
      tx.delete(vaultLinks).where(eq(vaultLinks.sourcePath, record.path)).run()
      for (const link of record.links) {
        tx.insert(vaultLinks)
          .values({
            sourcePath: record.path,
            target: link.target,
            targetKey: targetKey(link.target),
            targetPath: null,
            anchor: link.anchor,
            alias: link.alias,
            line: link.line,
          })
          .run()
      }
    }

    resolveLinks(tx)

    const now = Date.now()
    tx.insert(vaultIndexState)
      .values({ id: STATE_ID, path: batch.root, commitSha: batch.commitSha, indexedAt: now })
      .onConflictDoUpdate({
        target: vaultIndexState.id,
        set: { path: batch.root, commitSha: batch.commitSha, indexedAt: now },
      })
      .run()

    return { indexed: batch.upserts.length, removed: batch.removals.length }
  })
}

/** Vide l'index. Sans danger par construction : rien ici n'est une source. */
export function clearIndex(db: Db): void {
  writeTransaction(db, (tx) => {
    tx.delete(vaultLinks).run()
    tx.delete(vaultNotes).run()
    tx.delete(vaultIndexState).run()
  })
}

/**
 * Recalcule la résolution de **tous** les liens, pas seulement de ceux qu'on vient
 * d'écrire.
 *
 * C'est le point qu'on ne peut pas optimiser sans se tromper : une note créée répare
 * les liens cassés qui la visaient, une note supprimée casse ceux qui la citaient, et
 * une note renommée fait les deux. La résolution est une fonction de l'ensemble des
 * notes, donc elle se refait avec l'ensemble. Une mise à jour par clé distincte, dans
 * la transaction : quelques milliers d'exécutions préparées, de l'ordre de la
 * milliseconde pour un vault personnel.
 */
function resolveLinks(tx: Tx): void {
  const paths = tx.select({ path: vaultNotes.path }).from(vaultNotes).all().map((row) => row.path)
  const resolver = buildResolver(paths)

  const keys = tx.selectDistinct({ key: vaultLinks.targetKey }).from(vaultLinks).all()
  for (const { key } of keys) {
    tx.update(vaultLinks)
      .set({ targetPath: resolver.resolve(key) })
      .where(eq(vaultLinks.targetKey, key))
      .run()
  }
}

/** SQLite plafonne les paramètres d'une requête ; les suppressions passent par paquets. */
function* chunks(paths: string[], size = 400): Generator<string[]> {
  for (let i = 0; i < paths.length; i += size) yield paths.slice(i, i + size)
}

/**
 * Le degré entrant de chaque note, les liens d'une note vers elle-même exclus.
 *
 * Une note qui se cite ne cesse pas d'être orpheline : c'est le sens de « personne ne
 * me cite », et sans cette exclusion une note à sommaire interne disparaîtrait de la
 * liste « sans lien entrant » sans que rien ne la relie au reste du vault.
 */
const incomingDegree = sql`(
  SELECT count(*) FROM vault_links
  WHERE vault_links.target_path = vault_notes.path
    AND vault_links.source_path <> vault_notes.path
)`

const outgoingDegree = sql`(
  SELECT count(*) FROM vault_links WHERE vault_links.source_path = vault_notes.path
)`

const brokenDegree = sql`(
  SELECT count(*) FROM vault_links
  WHERE vault_links.source_path = vault_notes.path AND vault_links.target_path IS NULL
)`

export function readCounts(db: Db): VaultCountsDto {
  const row = db
    .get<{ notes: number; drafts: number; brokenLinks: number; orphans: number; crossroads: number }>(sql`
      SELECT
        (SELECT count(*) FROM vault_notes) AS notes,
        (SELECT count(*) FROM vault_notes WHERE folder = '') AS drafts,
        (SELECT count(*) FROM vault_links WHERE target_path IS NULL) AS brokenLinks,
        (SELECT count(*) FROM vault_notes WHERE ${incomingDegree} = 0) AS orphans,
        (SELECT count(*) FROM vault_notes WHERE ${incomingDegree} >= ${VAULT_CROSSROADS_MIN_INCOMING}) AS crossroads
    `)

  return (
    row ?? { notes: 0, drafts: 0, brokenLinks: 0, orphans: 0, crossroads: 0 }
  )
}

export interface NotesQuery {
  filter: VaultNoteFilter
  folder: string
  limit: number
}

/** Les notes, les plus récemment modifiées d'abord — l'ordre dans lequel la page les montre. */
export function listNotes(db: Db, query: NotesQuery): VaultNoteDto[] {
  const conditions = [folderCondition(query.folder), filterCondition(query.filter)].filter(
    (condition) => condition !== null,
  )

  const rows = db
    .select({
      path: vaultNotes.path,
      folder: vaultNotes.folder,
      title: vaultNotes.title,
      words: vaultNotes.words,
      bytes: vaultNotes.bytes,
      tags: vaultNotes.tags,
      modifiedAt: vaultNotes.modifiedAt,
      incoming: incomingDegree.as('incoming'),
      outgoing: outgoingDegree.as('outgoing'),
      broken: brokenDegree.as('broken'),
    })
    .from(vaultNotes)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${vaultNotes.modifiedAt} DESC, ${vaultNotes.path} ASC`)
    .limit(query.limit)
    .all()

  return rows.map(toNoteDto)
}

function folderCondition(folder: string) {
  if (folder.length === 0) return null
  // Le dossier **et ses enfants**, comme les droits : un droit vaut pour un dossier et
  // ce qu'il contient, et une liste qui s'arrêterait au premier niveau ne dirait pas
  // la même chose que la colonne qui la montre.
  return sql`(${vaultNotes.folder} = ${folder} OR ${vaultNotes.folder} LIKE ${`${folder}/%`})`
}

function filterCondition(filter: VaultNoteFilter) {
  switch (filter) {
    case 'all':
      return null
    case 'drafts':
      return eq(vaultNotes.folder, '')
    case 'orphans':
      return sql`${incomingDegree} = 0`
    case 'crossroads':
      return sql`${incomingDegree} >= ${VAULT_CROSSROADS_MIN_INCOMING}`
    case 'broken':
      return sql`${brokenDegree} > 0`
  }
}

/** Tout ce que le niveau 1 sait d'une note, ses deux extrémités de liens comprises. */
export function readNoteFacts(db: Db, path: string): VaultNoteFactsDto | null {
  const note = listOne(db, path)
  if (!note) return null

  const outgoing = db
    .select({
      target: vaultLinks.target,
      anchor: vaultLinks.anchor,
      alias: vaultLinks.alias,
      line: vaultLinks.line,
      path: vaultLinks.targetPath,
      title: vaultNotes.title,
    })
    .from(vaultLinks)
    .leftJoin(vaultNotes, eq(vaultNotes.path, vaultLinks.targetPath))
    .where(eq(vaultLinks.sourcePath, path))
    .orderBy(vaultLinks.line)
    .all()

  const incoming = db
    .select({
      target: vaultLinks.target,
      anchor: vaultLinks.anchor,
      alias: vaultLinks.alias,
      line: vaultLinks.line,
      path: vaultLinks.sourcePath,
      title: vaultNotes.title,
    })
    .from(vaultLinks)
    .innerJoin(vaultNotes, eq(vaultNotes.path, vaultLinks.sourcePath))
    .where(and(eq(vaultLinks.targetPath, path), sql`${vaultLinks.sourcePath} <> ${path}`))
    .orderBy(vaultNotes.title, vaultLinks.line)
    .all()

  return {
    note,
    incoming: incoming.map((row) => ({ ...toLinkDto(row), path: row.path })),
    outgoing: outgoing.map(toLinkDto),
  }
}

function listOne(db: Db, path: string): VaultNoteDto | null {
  const row = db
    .select({
      path: vaultNotes.path,
      folder: vaultNotes.folder,
      title: vaultNotes.title,
      words: vaultNotes.words,
      bytes: vaultNotes.bytes,
      tags: vaultNotes.tags,
      modifiedAt: vaultNotes.modifiedAt,
      incoming: incomingDegree.as('incoming'),
      outgoing: outgoingDegree.as('outgoing'),
      broken: brokenDegree.as('broken'),
    })
    .from(vaultNotes)
    .where(eq(vaultNotes.path, path))
    .get()

  return row ? toNoteDto(row) : null
}

/** Les dossiers du vault et ce qu'ils contiennent, racine comprise dans aucun d'eux. */
export function listFolders(db: Db): VaultFolderDto[] {
  return db
    .select({ path: vaultNotes.folder, notes: sql<number>`count(*)` })
    .from(vaultNotes)
    .where(sql`${vaultNotes.folder} <> ''`)
    .groupBy(vaultNotes.folder)
    .orderBy(vaultNotes.folder)
    .all()
}

interface NoteRow {
  path: string
  folder: string
  title: string
  words: number
  bytes: number
  tags: string
  modifiedAt: number
  incoming: unknown
  outgoing: unknown
  broken: unknown
}

function toNoteDto(row: NoteRow): VaultNoteDto {
  return {
    path: row.path,
    folder: row.folder,
    title: row.title,
    words: row.words,
    bytes: row.bytes,
    tags: readTags(row.tags),
    modifiedAt: row.modifiedAt,
    incoming: Number(row.incoming ?? 0),
    outgoing: Number(row.outgoing ?? 0),
    broken: Number(row.broken ?? 0),
  }
}

/** Une colonne JSON illisible vaut liste vide : l'index se refait, il ne se répare pas. */
function readTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

function toLinkDto(row: {
  target: string
  anchor: string | null
  alias: string | null
  line: number
  path: string | null
  title: string | null
}): VaultLinkDto {
  return {
    path: row.path,
    // Un lien cassé n'a pas de note, donc pas de titre : il porte la cible telle
    // qu'elle est écrite, qui est exactement ce qu'il faut montrer pour la réparer.
    title: row.title ?? row.target,
    target: row.target,
    anchor: row.anchor,
    line: row.line,
  }
}

/**
 * L'arbre du vault, à plat.
 *
 * Les dossiers viennent de `listFolders`, donc de ce que les notes déclarent : un
 * dossier vide n'existe pas dans l'index, et c'est cohérent — l'index lit des notes,
 * pas des dossiers. Un dossier qu'on vient de créer apparaît avec sa première note.
 */
export function readTree(db: Db): VaultTreeDto {
  const notes = db
    .select({
      path: vaultNotes.path,
      folder: vaultNotes.folder,
      title: vaultNotes.title,
      incoming: incomingDegree.as('incoming'),
    })
    .from(vaultNotes)
    .orderBy(vaultNotes.path)
    .all()

  return {
    folders: listFolders(db),
    notes: notes.map((note) => ({ ...note, incoming: Number(note.incoming ?? 0) })),
  }
}
