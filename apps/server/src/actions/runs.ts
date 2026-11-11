import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import { actionRuns, type Db } from '@solera/db'
import {
  ACTION_RUNS_KEPT,
  ACTION_RUNS_SHOWN,
  MAX_ACTION_RUN_EXCERPT_CHARS,
  actionRunStatusOf,
  type ActionRunDetailDto,
  type ActionRunDto,
  type ActionRunTrigger,
} from '@solera/protocol'

/**
 * Les passages d'une action : écrits au lancement, clos à la sortie de son terminal.
 *
 * Le terminal garde l'écran entier, mais il disparaît quand on le ferme ou qu'on
 * relance : le passage garde ce qu'il faut pour dire après coup comment ça s'est fini.
 */

export interface RunStart {
  actionId: string
  projectId: string
  trigger: ActionRunTrigger
  conversationId: string | null
  terminalId: string
  cwd: string
}

export function startRun(db: Db, start: RunStart): string {
  const id = randomUUID()
  db.insert(actionRuns)
    .values({ id, ...start, status: 'running', exitCode: null, startedAt: Date.now(), finishedAt: null, excerpt: null })
    .run()
  // Une action lancée cent fois par jour ne doit pas faire grossir la base sans fin.
  const kept = db
    .select({ id: actionRuns.id })
    .from(actionRuns)
    .where(eq(actionRuns.actionId, start.actionId))
    .orderBy(desc(actionRuns.startedAt))
    .limit(ACTION_RUNS_KEPT)
  db.delete(actionRuns)
    .where(and(eq(actionRuns.actionId, start.actionId), notInArray(actionRuns.id, kept)))
    .run()
  return id
}

export function finishRun(db: Db, runId: string, end: { exitCode: number; finishedAt: number; output: string }): void {
  db.update(actionRuns)
    .set({
      status: actionRunStatusOf(end.exitCode),
      exitCode: end.exitCode,
      finishedAt: end.finishedAt,
      excerpt: runExcerpt(end.output),
    })
    .where(and(eq(actionRuns.id, runId), eq(actionRuns.status, 'running')))
    .run()
}

/**
 * Au démarrage : un passage encore « en cours » dont le terminal ne tourne plus a été
 * emporté par l'arrêt du daemon. Sans date de fin, comme son terminal interrompu.
 */
export function closeOrphanRuns(db: Db, liveTerminalIds: string[]): void {
  db.update(actionRuns)
    .set({ status: 'stopped' })
    .where(
      and(
        eq(actionRuns.status, 'running'),
        liveTerminalIds.length > 0
          ? or(isNull(actionRuns.terminalId), notInArray(actionRuns.terminalId, liveTerminalIds))
          : undefined,
      ),
    )
    .run()
}

/**
 * Les derniers passages de chaque action, sans extrait : la liste des actions est relue
 * toutes les dix secondes, et vingt extraits par action la rendraient lourde.
 */
export function latestRuns(db: Db, actionIds: string[]): Map<string, ActionRunDto[]> {
  const runs = new Map<string, ActionRunDto[]>()
  if (actionIds.length === 0) return runs
  const rank = sql<number>`row_number() over (partition by ${actionRuns.actionId} order by ${actionRuns.startedAt} desc, rowid desc)`.as('rank')
  const ranked = db
    .select({ id: actionRuns.id, rank })
    .from(actionRuns)
    .where(inArray(actionRuns.actionId, actionIds))
    .as('ranked')
  const rows = db
    .select(listedColumns)
    .from(actionRuns)
    .innerJoin(ranked, eq(ranked.id, actionRuns.id))
    .where(sql`${ranked.rank} <= ${ACTION_RUNS_SHOWN}`)
    .orderBy(desc(actionRuns.startedAt), sql`${actionRuns}.rowid desc`)
    .all()
  for (const row of rows) {
    const list = runs.get(row.actionId) ?? []
    list.push(row)
    runs.set(row.actionId, list)
  }
  return runs
}

/** Les derniers passages d'une action avec leur extrait, pour son détail. */
export function runDetails(db: Db, actionId: string): ActionRunDetailDto[] {
  return db
    .select({ ...listedColumns, excerpt: actionRuns.excerpt })
    .from(actionRuns)
    .where(eq(actionRuns.actionId, actionId))
    .orderBy(desc(actionRuns.startedAt), sql`rowid desc`)
    .limit(ACTION_RUNS_SHOWN)
    .all()
}

const listedColumns = {
  id: actionRuns.id,
  actionId: actionRuns.actionId,
  trigger: actionRuns.trigger,
  conversationId: actionRuns.conversationId,
  terminalId: actionRuns.terminalId,
  cwd: actionRuns.cwd,
  status: actionRuns.status,
  exitCode: actionRuns.exitCode,
  startedAt: actionRuns.startedAt,
  finishedAt: actionRuns.finishedAt,
} satisfies Record<keyof ActionRunDto, unknown>

/**
 * Les dernières lignes d'une sortie de terminal, telles qu'un écran les montrerait :
 * sans séquences de couleur ni de titre, une ligne réécrite par `\r` (une barre de
 * progression) réduite à son dernier état, coupées sur une fin de ligne. Null sans
 * rien de lisible.
 */
export function runExcerpt(output: string): string | null {
  const lines = output
    // OSC (titre de fenêtre, liens) puis CSI (couleurs, curseur), puis les échappements courts.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .split('\n')
    .map((line) => {
      const segments = line.replace(/\r+$/, '').split('\r')
      return segments[segments.length - 1]!.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trimEnd()
    })
  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return null

  const kept: string[] = []
  let size = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!
    if (size + 1 + line.length > MAX_ACTION_RUN_EXCERPT_CHARS) {
      // Une seule ligne plus longue que la borne : on en garde la fin.
      if (kept.length === 0) kept.push(line.slice(-MAX_ACTION_RUN_EXCERPT_CHARS))
      break
    }
    kept.push(line)
    size += 1 + line.length
  }
  return kept.reverse().join('\n')
}
