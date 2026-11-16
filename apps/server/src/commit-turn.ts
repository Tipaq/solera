import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { and, eq, gt, lte, sql } from 'drizzle-orm'
import { conversations, events, type Db } from '@solera/db'
import type { CommitTurnDto } from '@solera/protocol'
import { readTurnHeads, type TurnHeads } from './checkpoints.js'

/**
 * Le tour qui a produit un commit (S4, carte #171).
 *
 * `git-threads.ts` déduit le fil d'un commit par sa branche ou par les dates ; ici on
 * le lit. Les points de reprise gardent HEAD avant et après chaque tour : un commit est
 * du tour quand HEAD d'avant ne le contient pas et que HEAD d'après le contient. Rien
 * n'est écrit dans le dépôt de l'utilisateur pour ça — le trailer `Solera-Session` a
 * été écarté pour cette raison.
 *
 * La règle seule revendique trop : un tour qui fusionne, tire ou rebase fait lui aussi
 * entrer dans HEAD des commits qu'il n'a pas écrits. Deux filtres la resserrent :
 *
 * - **la date** : le commit a été daté pendant le tour. Un commit ancien qu'un tour
 *   amène par avance rapide ou par fusion n'est pas de lui ;
 * - **la première parenté** : le commit est sur la ligne de premiers parents qui mène
 *   de HEAD d'après à HEAD d'avant. Un commit apporté par fusion est sur la ligne du
 *   second parent.
 *
 * Restent deux tours qui revendiquent le même commit — deux sessions au même endroit
 * en même temps, un rebase sur une base qui vient de bouger. La route se tait alors
 * plutôt que de choisir, comme `threadAt` : le client retombe sur les candidats par
 * dates. Une branche de conversation hérite des captures de sa source sous les mêmes
 * clés ; le commit reste à l'originale, la plus ancienne des deux.
 *
 * Limites : un tour encore ouvert n'a pas de capture d'après, ses commits ne sont
 * rattachés qu'à sa fin ; un commit qu'un tour pose sur une branche à côté puis fusionne
 * en `--no-ff` est sur le second parent, et le tour ne le revendique pas.
 */

const run = promisify(execFile)

const GIT_TIMEOUT_MS = 15_000

/**
 * Marge autour du tour : la date d'un commit est à la seconde, celle d'une capture à la
 * milliseconde, et la capture d'avant est prise juste avant que l'agent ne reçoive le
 * message.
 */
const SLACK_MS = 2_000

/** Le message d'ouverture rendu, sur une ligne : de quoi nommer le tour, pas le relire. */
const MESSAGE_MAX = 280

/** Code de sortie de git, sans lever : `merge-base --is-ancestor` répond par 0 ou 1. */
async function exitCode(cwd: string, args: string[]): Promise<number> {
  try {
    await run('git', args, { cwd, timeout: GIT_TIMEOUT_MS })
    return 0
  } catch (err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'number' ? code : -1
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

/** Un commit tel que la règle le lit : son hash complet et sa date de commit, en ms. */
export interface ResolvedCommit {
  hash: string
  ts: number
}

/**
 * Le commit que désigne `hash`, abrégé ou non ; null si le dépôt ne le connaît pas.
 * Une autre panne de git — dépôt absent, délai dépassé — lève : ce n'est pas un hash
 * inconnu.
 */
export async function resolveCommit(cwd: string, hash: string): Promise<ResolvedCommit | null> {
  if ((await exitCode(cwd, ['rev-parse', '--verify', '-q', `${hash}^{commit}`])) === 1) return null
  const out = (await git(cwd, ['show', '-s', '--format=%H %ct', `${hash}^{commit}`, '--'])).trim()
  const [full, seconds] = out.split(' ')
  if (!full || !seconds) return null
  return { hash: full, ts: Number(seconds) * 1000 }
}

/** Le tour a-t-il, lui, fait entrer ce commit dans HEAD par sa ligne de premiers parents ? */
async function producedBy(cwd: string, hash: string, turn: TurnHeads): Promise<boolean> {
  const { before, after } = turn
  if (!after.head || before.head === after.head) return false
  if ((await exitCode(cwd, ['merge-base', '--is-ancestor', hash, after.head])) !== 0) return false
  if (before.head && (await exitCode(cwd, ['merge-base', '--is-ancestor', hash, before.head])) === 0) return false
  try {
    const firstParents = await git(cwd, ['rev-list', '--first-parent', after.head, ...(before.head ? [`^${before.head}`] : [])])
    return firstParents.split('\n').includes(hash)
  } catch {
    // Un HEAD réécrit depuis et ramassé par le gc : ce tour ne dit plus rien.
    return false
  }
}

/** Le tour d'une conversation dont `key` est la capture : son rang et le message qui l'a ouvert. */
function readTurnOpening(db: Db, conversationId: string, key: string): { turn: number; message: string } | null {
  const started = db
    .select({ seq: events.seq })
    .from(events)
    .where(
      and(
        eq(events.conversationId, conversationId),
        eq(events.type, 'checkpoint.started'),
        sql`${events.payload} ->> '$.key' = ${key}`,
      ),
    )
    .orderBy(events.seq)
    .limit(1)
    .get()
  if (!started) return null

  // Même définition d'un tour que `conversations.turnCount` : un message de
  // l'utilisateur adressé au fil, hors sous-agents, compté une fois par identifiant.
  const userMessage = and(
    eq(events.conversationId, conversationId),
    eq(events.type, 'message.completed'),
    sql`${events.payload} ->> '$.role' = 'user'`,
    sql`coalesce(${events.payload} ->> '$.parentToolCallId', '') = ''`,
  )
  const opener = db
    .select({ seq: events.seq, payload: events.payload })
    .from(events)
    .where(and(userMessage, gt(events.seq, started.seq)))
    .orderBy(events.seq)
    .limit(1)
    .get()
  if (!opener) return null

  const count = db
    .select({ n: sql<number>`count(distinct ${events.payload} ->> '$.messageId')` })
    .from(events)
    .where(and(userMessage, lte(events.seq, opener.seq)))
    .get()
  const blocks = (JSON.parse(opener.payload) as { blocks?: { type: string; text?: string }[] }).blocks ?? []
  const message = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_MAX)
  return { turn: count?.n ?? 1, message }
}

/**
 * Le tour d'un projet qui a produit ce commit, s'il n'y en a qu'un.
 *
 * `hash` est complet et `ts` sa date de commit (`resolveCommit`). Seules comptent les
 * conversations du projet : un même dépôt peut servir à deux projets, et ses refs de
 * captures sont communes.
 */
export async function findCommitTurn(
  db: Db,
  cwd: string,
  projectId: string,
  commit: ResolvedCommit,
): Promise<CommitTurnDto | null> {
  const owned = new Map(
    db
      .select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt })
      .from(conversations)
      .where(eq(conversations.projectId, projectId))
      .all()
      .map((row) => [row.id, row]),
  )

  const turns = (await readTurnHeads(cwd)).filter(
    (turn) =>
      owned.has(turn.conversationId) &&
      commit.ts >= turn.before.ts - SLACK_MS &&
      commit.ts <= turn.after.ts + SLACK_MS,
  )
  const produced: TurnHeads[] = []
  for (const turn of turns) {
    if (await producedBy(cwd, commit.hash, turn)) produced.push(turn)
  }

  // Une branche de conversation porte les mêmes clés que sa source : une seule
  // revendication par tour, celle de la conversation la plus ancienne.
  const byKey = new Map<string, TurnHeads>()
  for (const turn of produced) {
    const current = byKey.get(turn.key)
    const age = (t: TurnHeads) => owned.get(t.conversationId)?.createdAt ?? 0
    if (!current || age(turn) < age(current)) byKey.set(turn.key, turn)
  }
  if (byKey.size !== 1) return null

  const [turn] = [...byKey.values()] as [TurnHeads]
  const conversation = owned.get(turn.conversationId)!
  const opening = readTurnOpening(db, turn.conversationId, turn.key)
  return {
    conversationId: turn.conversationId,
    title: conversation.title,
    turn: opening?.turn ?? null,
    message: opening?.message ?? null,
    key: turn.key,
  }
}
