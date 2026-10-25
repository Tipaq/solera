import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { and, eq, isNull } from 'drizzle-orm'
import { cards, type CardRow, type Db, type ProjectRow } from '@solera/db'
import { parentBranchName } from '@solera/protocol'
import { defaultBase } from '../worktrees/assess.js'

const run = promisify(execFile)

/** Un fetch ou un push parle au réseau : plus long qu'un git local. */
const NETWORK_TIMEOUT_MS = 60_000

/**
 * La branche d'une carte parente, où ses enfants se fusionnent (#68).
 *
 * Créée au premier besoin, c'est-à-dire au premier arbre d'une enfant ou à sa première
 * PR, depuis la branche par défaut telle que la forge la connaît, puis **poussée** : la
 * PR d'une enfant ne peut viser qu'une branche qui existe sur la forge. Son nom est
 * gardé sur la carte, pour qu'un titre renommé ne la déplace pas en route.
 *
 * Avant de servir de base, la copie locale est ramenée à celle de la forge, où les
 * fusions des enfants ont lieu : une enfant lancée après la fusion d'une sœur doit
 * partir de son travail. Sans remote, tout reste local.
 *
 * Rend null pour une carte sans parente : sa base reste celle de toujours.
 */
export async function parentBranchFor(db: Db, project: ProjectRow, cardId: string | null): Promise<string | null> {
  if (!cardId) return null
  const card = db.select({ parentId: cards.parentId }).from(cards).where(eq(cards.id, cardId)).get()
  if (!card?.parentId) return null
  const parent = db.select().from(cards).where(and(eq(cards.id, card.parentId), eq(cards.projectId, project.id))).get()
  if (!parent) return null
  return ensureParentBranch(db, project, parent)
}

/** Le nom qu'a ou qu'aura la branche de cette parente, sans rien créer. */
export function parentBranchOf(parent: Pick<CardRow, 'branch' | 'number' | 'title'>): string {
  return parent.branch ?? parentBranchName(parent.number, parent.title)
}

export async function ensureParentBranch(db: Db, project: ProjectRow, parent: CardRow): Promise<string> {
  const name = parentBranchOf(parent)
  const repo = project.workspacePath
  const hasOrigin = (await git(repo, ['remote', 'get-url', 'origin'])).ok

  if (hasOrigin) {
    // Avance la copie locale sur la forge. Refusé si elle est extraite dans un arbre ou
    // si elle a divergé : on garde alors ce qu'on a, plutôt que d'écraser.
    await git(repo, ['fetch', '--quiet', 'origin', `refs/heads/${name}:refs/heads/${name}`], NETWORK_TIMEOUT_MS)
  }

  if (!(await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).ok) {
    const base = (await defaultBase(repo)) ?? 'HEAD'
    const local = base.replace(/^origin\//, '')
    let start = base
    if (hasOrigin && (await git(repo, ['fetch', '--quiet', 'origin', local], NETWORK_TIMEOUT_MS)).ok) {
      start = `refs/remotes/origin/${local}`
    }
    const created = await git(repo, ['branch', '--no-track', name, start])
    // Une autre enfant a pu la créer entre-temps : seul compte qu'elle existe.
    if (!created.ok && !(await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).ok) {
      throw new Error(`La branche « ${name} » de la carte #${parent.number} n'a pas pu être créée : ${created.stderr}`)
    }
  }

  if (hasOrigin) {
    const remote = await git(repo, ['ls-remote', '--heads', 'origin', name], NETWORK_TIMEOUT_MS)
    if (remote.ok && remote.stdout.trim() === '') {
      const pushed = await git(repo, ['push', '--quiet', 'origin', `refs/heads/${name}:refs/heads/${name}`], NETWORK_TIMEOUT_MS)
      if (!pushed.ok) {
        throw new Error(`La branche « ${name} » de la carte #${parent.number} n'a pas pu être poussée : ${pushed.stderr}`)
      }
    }
  }

  if (parent.branch === null) {
    db.update(cards).set({ branch: name }).where(and(eq(cards.id, parent.id), isNull(cards.branch))).run()
  }
  return name
}

async function git(cwd: string, args: string[], timeout = 10_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run('git', args, {
      cwd,
      timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return { ok: true, stdout, stderr }
  } catch (err) {
    const stderr = ((err as { stderr?: string }).stderr ?? (err instanceof Error ? err.message : String(err))).trim()
    return { ok: false, stdout: '', stderr: stderr.split('\n')[0] ?? '' }
  }
}
