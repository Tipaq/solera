import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { and, count, eq, gte, inArray, isNull } from 'drizzle-orm'
import {
  cardMoves,
  cardNotes,
  cards,
  conversations,
  scheduledRuns,
  scheduledTasks,
  worktrees,
  type Db,
  type ProjectRow,
} from '@solera/db'
import {
  CARD_CLOSED_COLUMNS,
  type JournalDto,
  type JournalEntryDto,
  type JournalRunStatus,
} from '@solera/protocol'

/**
 * Le Journal, assemblé à la lecture depuis les sept endroits où la matière vit déjà.
 *
 * Aucune table n'est écrite pour lui, et c'est le parti : cinq sources sont en base et
 * déjà datées (`card_notes`, `cards`, `card_moves`, `conversations`, `scheduled_runs`),
 * les deux dernières se produisent **hors de l'application** — une fusion de branche et
 * un audit versé sur le disque — donc aucune table d'événements ne les aurait vues
 * passer. Le seul fait que personne ne pouvait redériver, la date d'un changement de
 * colonne, a reçu sa table étroite avec la carte #36.
 *
 * Ce module ne sert que le Journal. Il est hors de `http/routes/` parce qu'il touche la
 * base, git et le disque, et qu'une route doit rester la couche qui vérifie des droits
 * et sérialise — pas celle qui orchestre sept lectures.
 */

const run = promisify(execFile)

/**
 * Plus court que celui de la vue Git : ici le `git log` est borné par une fenêtre de
 * quelques jours, et le journal du portefeuille en lance un **par projet**. Un dépôt
 * lent ne doit pas retenir les six autres au-delà de ce délai — sa ligne manquera, et
 * `repoIncomplete` le dira.
 */
const GIT_TIMEOUT_MS = 5000

/**
 * Séparateurs : octet nul entre les champs, RS entre les enregistrements. Écrits en
 * échappement git dans le format (`%x00`) et non en octet littéral — `execFile` refuse
 * un argument qui contient un octet nul, et c'est git qui les pose. Même règle et même
 * raison que dans `git-graph.ts`.
 */
const FIELD = '\x00'
const RECORD = '\x1e'
const LOG_FORMAT = '%H%x00%ct%x00%s%x1e'

/** Au-delà, la page ne se déroule plus : c'est un export qu'on voudrait, pas un journal. */
const MAX_ENTRIES = 400

/** Ce qu'une ligne montre d'un texte libre : la maquette en tient à peu près autant. */
const TITLE_MAX = 160

/**
 * La première ligne utile d'un texte, sans ses marqueurs markdown.
 *
 * Une note de carte est du markdown rédigé pour être lu en entier ; la ligne du journal
 * n'en montre qu'une amorce, et une amorce qui commence par `## ` ou `- ` se lit mal
 * à côté de six titres de cartes. On retire donc le balisage de **début de ligne** et
 * rien d'autre : couper les `*` intérieurs ferait disparaître des mots dans les cas où
 * ils ne balisent rien.
 */
function firstLine(body: string): string {
  const line = body
    .split('\n')
    .map((raw) => raw.replace(/^[\s>#*-]*(?:\[[ x]\]\s*)?/, '').trim())
    .find((raw) => raw.length > 0)
  if (!line) return ''
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

/**
 * Assemble le journal des projets donnés.
 *
 * Les droits sont vérifiés par l'appelant : cette fonction reçoit des projets qu'il a
 * déjà le droit de lire. Un seul projet ou tous, c'est le même chemin — F5 et F11 ne
 * diffèrent que par la pastille que la page pose en tête de ligne.
 */
export async function readJournal(
  db: Db,
  projects: ProjectRow[],
  days: number,
): Promise<JournalDto> {
  if (projects.length === 0) return { entries: [], days, repoIncomplete: false }

  const since = Date.now() - days * 86_400_000
  const ids = projects.map((project) => project.id)

  const fromDb = readFromDb(db, ids, since)
  // Les deux sources hors base, un projet à la fois mais tous en parallèle : chacune
  // est un spawn et un `readdir`, et les attendre en file ferait sept allers-retours
  // là où le système peut les mener de front.
  const fromRepos = await Promise.all(
    projects.map(async (project) => readFromRepo(db, project, since)),
  )

  const entries = [...fromDb, ...fromRepos.flatMap((result) => result.entries)]
  entries.sort((a, b) => b.at - a.at)

  return {
    entries: entries.slice(0, MAX_ENTRIES),
    days,
    repoIncomplete: fromRepos.some((result) => result.incomplete),
  }
}

/** Les cinq sources en base, lues en une passe chacune. */
function readFromDb(db: Db, ids: string[], since: number): JournalEntryDto[] {
  const entries: JournalEntryDto[] = []

  /* Les notes. Le titre est l'amorce du corps, et la provenance porte la session qui
     l'a écrite — c'est elle qui dit *qui* parle quand trois sessions suivent la même
     carte. `NOTE` et non `DÉCISION` : voir `JOURNAL_KINDS`. */
  const notes = db
    .select({
      id: cardNotes.id,
      at: cardNotes.createdAt,
      body: cardNotes.body,
      conversationId: cardNotes.conversationId,
      number: cards.number,
      projectId: cards.projectId,
      sessionTitle: conversations.title,
    })
    .from(cardNotes)
    .innerJoin(cards, eq(cards.id, cardNotes.cardId))
    // Externe : une note survit à la conversation qui l'a produite, et c'est même à ce
    // moment-là qu'elle devient la seule trace. Une jointure interne la ferait
    // disparaître du journal précisément quand elle compte le plus.
    .leftJoin(conversations, eq(conversations.id, cardNotes.conversationId))
    .where(and(inArray(cards.projectId, ids), gte(cardNotes.createdAt, since)))
    .all()

  for (const note of notes) {
    entries.push({
      id: `note:${note.id}`,
      kind: 'note',
      at: note.at,
      title: firstLine(note.body),
      projectId: note.projectId,
      cardNumber: note.number,
      source: note.sessionTitle,
      count: null,
      status: null,
      conversationId: note.conversationId,
    })
  }

  /* Les cartes ouvertes. */
  const opened = db
    .select({
      id: cards.id,
      at: cards.createdAt,
      title: cards.title,
      number: cards.number,
      projectId: cards.projectId,
    })
    .from(cards)
    .where(and(inArray(cards.projectId, ids), gte(cards.createdAt, since)))
    .all()

  for (const card of opened) {
    entries.push({
      id: `opened:${card.id}`,
      kind: 'cardOpened',
      at: card.at,
      title: card.title,
      projectId: card.projectId,
      cardNumber: card.number,
      source: null,
      count: null,
      status: null,
      conversationId: null,
    })
  }

  /* Les cartes fermées. `card_moves` et **pas** `cards.updated_at`, qu'une correction
     de titre réécrit : c'était tout le problème que la carte #33 décrivait, et la table
     est arrivée pour lui. Une carte ressortie puis refermée laisse deux lignes, ce qui
     est la vérité. */
  const closed = db
    .select({
      id: cardMoves.id,
      at: cardMoves.movedAt,
      cardId: cardMoves.cardId,
      title: cards.title,
      number: cards.number,
      projectId: cards.projectId,
    })
    .from(cardMoves)
    .innerJoin(cards, eq(cards.id, cardMoves.cardId))
    .where(
      and(
        inArray(cards.projectId, ids),
        gte(cardMoves.movedAt, since),
        inArray(cardMoves.toColumn, [...CARD_CLOSED_COLUMNS]),
      ),
    )
    .all()

  const sessionCounts = countSessionsByCard(
    db,
    closed.map((move) => move.cardId),
  )

  for (const move of closed) {
    entries.push({
      id: `closed:${move.id}`,
      kind: 'cardClosed',
      at: move.at,
      title: move.title,
      projectId: move.projectId,
      cardNumber: move.number,
      source: null,
      count: sessionCounts.get(move.cardId) ?? 0,
      status: null,
      conversationId: null,
    })
  }

  /* Les sessions ouvertes. Les tirs planifiés en sont exclus : ils ont leur propre
     ligne, plus riche, et une tâche horaire poserait sinon chaque fait deux fois. */
  const sessions = db
    .select({
      id: conversations.id,
      at: conversations.createdAt,
      title: conversations.title,
      agent: conversations.agent,
      projectId: conversations.projectId,
      number: cards.number,
    })
    .from(conversations)
    .leftJoin(cards, eq(cards.id, conversations.cardId))
    .where(
      and(
        inArray(conversations.projectId, ids),
        gte(conversations.createdAt, since),
        isNull(conversations.scheduleId),
      ),
    )
    .all()

  for (const session of sessions) {
    entries.push({
      id: `session:${session.id}`,
      kind: 'session',
      at: session.at,
      title: session.title,
      // La jointure rend `projectId` nullable alors que le filtre l'a borné : un fil
      // libre n'a pas de projet, mais aucun fil libre ne passe ce `where`.
      projectId: session.projectId ?? '',
      cardNumber: session.number,
      source: session.agent,
      count: null,
      status: null,
      conversationId: session.id,
    })
  }

  /* Les tirs planifiés, y compris ceux qui n'ont rien lancé : un tir sauté ou en échec
     est précisément ce qu'on vient chercher dans un journal. */
  const runs = db
    .select({
      id: scheduledRuns.id,
      at: scheduledRuns.startedAt,
      status: scheduledRuns.status,
      summary: scheduledRuns.summary,
      conversationId: scheduledRuns.conversationId,
      name: scheduledTasks.name,
      projectId: scheduledTasks.projectId,
    })
    .from(scheduledRuns)
    .innerJoin(scheduledTasks, eq(scheduledTasks.id, scheduledRuns.taskId))
    .where(
      and(inArray(scheduledTasks.projectId, ids), gte(scheduledRuns.startedAt, since)),
    )
    .all()

  for (const shot of runs) {
    const summary = shot.summary ? firstLine(shot.summary) : ''
    entries.push({
      id: `run:${shot.id}`,
      kind: 'run',
      at: shot.at,
      // Le nom de la tâche *et* ce qu'elle a trouvé : « Veille des CLI » seul ne dit
      // rien d'un jour à l'autre, c'est le compte rendu qui distingue deux tirs.
      title: summary ? `${shot.name} — ${summary}` : shot.name,
      projectId: shot.projectId ?? '',
      cardNumber: null,
      source: null,
      count: null,
      status: shot.status as JournalRunStatus,
      conversationId: shot.conversationId,
    })
  }

  return entries
}

/** Combien de sessions chaque carte a portées, en une requête groupée. */
function countSessionsByCard(db: Db, cardIds: string[]): Map<string, number> {
  if (cardIds.length === 0) return new Map()
  const rows = db
    .select({ cardId: conversations.cardId, total: count() })
    .from(conversations)
    .where(inArray(conversations.cardId, cardIds))
    .groupBy(conversations.cardId)
    .all()
  return new Map(rows.map((row) => [row.cardId ?? '', row.total]))
}

/**
 * Les deux sources qui ne sont pas en base : les branches fusionnées et les audits
 * versés.
 *
 * Toutes deux se lisent dans le dossier du projet, et toutes deux peuvent échouer sans
 * que ce soit une erreur — un projet sans dépôt git, un projet sans `docs/audits/`.
 * L'échec se rapporte (`incomplete`) plutôt que de remonter : un journal amputé de ses
 * fusions reste utile, un 500 ne l'est pas.
 */
async function readFromRepo(
  db: Db,
  project: ProjectRow,
  since: number,
): Promise<{ entries: JournalEntryDto[]; incomplete: boolean }> {
  const [merges, audits] = await Promise.all([
    readMerges(db, project, since),
    readAudits(project, since),
  ])
  return {
    entries: [...(merges ?? []), ...(audits ?? [])],
    // Seules les fusions comptent pour « incomplet » : un projet sans `docs/audits/`
    // n'a rien à cacher, alors qu'un `git log` qui échoue sur un dépôt qui existe veut
    // dire qu'il manque des lignes.
    incomplete: merges === null,
  }
}

/**
 * Les branches fusionnées dans la branche courante, sur la fenêtre.
 *
 * `git log --merges` et non une table : une fusion est faite au terminal, par un CLI ou
 * par la forge, jamais par Solera — aucun chemin d'écriture de l'application ne la voit
 * passer. `--first-parent` pour ne garder que les fusions **dans** cette branche et non
 * celles qu'elle a avalées avec ses apports, qui raconteraient l'histoire d'une autre.
 *
 * Rend `null` quand le dépôt ne répond pas, pour que l'appelant le dise.
 */
async function readMerges(
  db: Db,
  project: ProjectRow,
  since: number,
): Promise<JournalEntryDto[] | null> {
  let stdout: string
  try {
    const result = await run(
      'git',
      [
        'log',
        '--merges',
        '--first-parent',
        `--since=${new Date(since).toISOString()}`,
        `--format=${LOG_FORMAT}`,
      ],
      { cwd: project.workspacePath, timeout: GIT_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
    )
    stdout = result.stdout
  } catch {
    return null
  }

  const merged: { hash: string; at: number; branch: string }[] = []
  for (const record of stdout.split(RECORD)) {
    const [hash, seconds, subject] = record.replace(/^\n/, '').split(FIELD)
    if (!hash || !seconds || !subject) continue
    const branch = branchOf(subject)
    if (!branch) continue
    merged.push({ hash, at: Number(seconds) * 1000, branch })
  }
  if (merged.length === 0) return []

  const cardOf = cardsByBranch(
    db,
    project.id,
    merged.map((entry) => entry.branch),
  )
  const counts = await countCommits(project.workspacePath, merged.map((entry) => entry.hash))

  return merged.map((entry) => ({
    id: `merge:${project.id}:${entry.hash}`,
    kind: 'branch' as const,
    at: entry.at,
    title: entry.branch,
    projectId: project.id,
    cardNumber: cardOf.get(entry.branch) ?? null,
    source: null,
    count: counts.get(entry.hash) ?? null,
    status: null,
    conversationId: null,
  }))
}

/**
 * Le nom de la branche apportée par une fusion, lu dans son sujet.
 *
 * Trois formes couvrent ce qu'on rencontre : la fusion locale de git, celle d'une
 * branche de suivi, et le squelette que les forges écrivent pour une pull request. Un
 * sujet qu'aucune ne reconnaît ne donne pas de ligne — mieux vaut taire une fusion que
 * d'afficher « Merge branch » comme s'il s'agissait d'un nom de branche.
 */
function branchOf(subject: string): string | null {
  const local = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject)
  if (local?.[1]) return local[1].replace(/^origin\//, '')
  const pull = /^Merge pull request #\d+ from (\S+)/.exec(subject)
  if (pull?.[1]) return pull[1].split('/').slice(1).join('/') || pull[1]
  return null
}

/**
 * La carte derrière une branche, quand Solera a ouvert le worktree qui la portait.
 *
 * Le chaînage est `worktrees.name` (qui **est** le nom de la branche, posé par
 * `addWorktree`) vers les conversations qui y ont travaillé, puis vers leur carte. Rien
 * n'est deviné d'un nom de branche : une branche créée au terminal n'a pas de worktree
 * en base, donc pas de carte, et sa ligne n'en montre pas.
 */
function cardsByBranch(db: Db, projectId: string, branches: string[]): Map<string, number> {
  if (branches.length === 0) return new Map()
  const rows = db
    .select({ branch: worktrees.name, number: cards.number })
    .from(worktrees)
    .innerJoin(conversations, eq(conversations.worktreeId, worktrees.id))
    .innerJoin(cards, eq(cards.id, conversations.cardId))
    .where(and(eq(worktrees.projectId, projectId), inArray(worktrees.name, branches)))
    .all()
  // Première rencontre gagnante : plusieurs sessions ont pu suivre des cartes
  // différentes dans le même worktree, et la ligne n'en porte qu'une.
  const found = new Map<string, number>()
  for (const row of rows) if (!found.has(row.branch)) found.set(row.branch, row.number)
  return found
}

/** Combien de commits chaque fusion a apportés : `second parent, non premier parent`. */
async function countCommits(cwd: string, hashes: string[]): Promise<Map<string, number>> {
  const counted = await Promise.all(
    hashes.map(async (hash) => {
      try {
        const { stdout } = await run('git', ['rev-list', '--count', `${hash}^1..${hash}^2`], {
          cwd,
          timeout: GIT_TIMEOUT_MS,
        })
        return [hash, Number(stdout.trim())] as const
      } catch {
        return [hash, Number.NaN] as const
      }
    }),
  )
  return new Map(counted.filter(([, total]) => Number.isFinite(total)))
}

/**
 * Les audits versés dans `docs/audits/`, datés par le jour que porte leur nom.
 *
 * Le nom et non la date du fichier : un audit s'appelle `2026-10-14-gestion-de-projet`
 * par convention de ce dépôt, et c'est la date qu'il revendique. Les `mtime` d'un
 * dossier, eux, bougent à chaque capture réécrite — un audit d'octobre remonterait en
 * tête du journal parce qu'une session a relancé une suite UI.
 *
 * Le titre vient du premier titre de son `README.md`, qui est la phrase que l'audit
 * s'est donnée. Sans README, le chemin seul, qui reste informatif.
 */
async function readAudits(project: ProjectRow, since: number): Promise<JournalEntryDto[] | null> {
  const root = join(project.workspacePath, 'docs', 'audits')
  let names: string[]
  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return null
  }

  const recent = names
    .map((name) => ({ name, at: dayOf(name) }))
    .filter((entry): entry is { name: string; at: number } => entry.at !== null && entry.at >= since)

  return Promise.all(
    recent.map(async (entry) => {
      const heading = await readHeading(join(root, entry.name, 'README.md'))
      const path = `docs/audits/${entry.name}`
      return {
        id: `audit:${project.id}:${entry.name}`,
        kind: 'audit' as const,
        at: entry.at,
        title: heading ? `${path} — ${heading}` : path,
        projectId: project.id,
        cardNumber: null,
        source: null,
        count: null,
        status: null,
        conversationId: null,
      }
    }),
  )
}

/** Le minuit local du jour qu'un nom d'audit porte en tête, ou `null`. */
function dayOf(name: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(name)
  if (!match) return null
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
  return Number.isNaN(at) ? null : at
}

/** Le premier titre markdown d'un fichier, sans le lire en entier. */
async function readHeading(path: string): Promise<string | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const match = /^#\s+(.+)$/m.exec(raw.slice(0, 4096))
    return match?.[1] ? firstLine(match[1]) : null
  } catch {
    return null
  }
}
