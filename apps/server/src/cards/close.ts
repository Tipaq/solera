import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { cardNotes, cardReviews, cards, conversations, writeTransaction, type CardRow, type Db, type ProjectRow } from '@solera/db'
import {
  CARD_CLOSED_COLUMNS,
  type CardCloseKeptReason,
  type CardCloseOutcome,
  type WorktreeStatusDto,
  type WorktreeStatusListDto,
} from '@solera/protocol'
import { deleteBranch } from '../git.js'
import { HttpError } from '../http/errors.js'
import type { Forge, PullRequest } from '../reviews/forge.js'
import { Refusal } from '../sessions/refusal.js'
import type { WorktreeCleanup } from '../worktrees/cleanup.js'
import type { WorktreeStatusService } from '../worktrees/status-service.js'
import { recordCardMove } from './moves.js'

const run = promisify(execFile)

/** `ls-remote` et `push --delete` parlent au réseau. */
const NETWORK_TIMEOUT_MS = 60_000

/** Les statuts d'une session qui travaille : rien de ce qu'elle utilise ne se retire. */
const BUSY = ['running', 'awaiting_input'] as const

/** Les deux colonnes où une clôture range la carte. */
export type CloseTarget = 'done' | 'abandoned'

export function isCloseTarget(value: unknown): value is CloseTarget {
  return value === 'done' || value === 'abandoned'
}

/** Ce que la demande montre avant le clic. */
export interface ClosePlan {
  conversations: number
  worktrees: string[]
  abandon: { cardId: string; number: number; title: string }[]
  branch: string | null
}

/**
 * Clore une carte finie (#69) : un seul clic du propriétaire du projet la range, archive
 * toutes ses conversations, retire ses worktrees et supprime ses branches.
 *
 * Rien ne se perd en route, et c'est la règle qui décide de chaque geste :
 * - un arbre n'est retiré que si tout ce qu'il porte est ailleurs : dans la branche par
 *   défaut, dans une PR fusionnée jusqu'à son dernier commit, ou sur la forge. Sinon il
 *   reste, et la note de la carte dit pourquoi ;
 * - une branche n'est supprimée sur la forge que si sa PR est fusionnée et que la forge
 *   n'a rien reçu depuis. Jamais la branche par défaut. Le bouton « Restore branch » de
 *   GitHub la rend au besoin ;
 * - une session qui travaille n'est ni archivée ni privée de son arbre.
 *
 * Une parente se clôt comme une feuille, et en plus supprime sa branche `jalon/…` une fois
 * sa PR vers la branche par défaut fusionnée. Ses enfants encore ouvertes ne sont closes
 * que si la demande les a nommées : c'est une clôture explicite, quand un point s'est
 * révélé irréalisable, et elles passent alors en « abandonné ».
 */
export class CardClosure {
  constructor(
    private readonly db: Db,
    private readonly status: WorktreeStatusService,
    private readonly cleanup: WorktreeCleanup,
    private readonly forge: Forge,
    private readonly token?: (userId: string) => string | undefined,
  ) {}

  /**
   * Au dépôt : ce que la clôture touchera, ou un refus tant que le travail n'est pas livré.
   *
   * « Livré » veut dire la PR fusionnée, et rien de plus : la vérification, c'est
   * l'agent qui la rapporte dans sa raison, et la personne qui la juge en cliquant. Une
   * clôture en « abandonné » ne demande rien de tel, puisqu'elle renonce au travail.
   */
  async plan(project: ProjectRow, card: CardRow, target: CloseTarget): Promise<ClosePlan> {
    const children = this.db
      .select({ cardId: cards.id, number: cards.number, title: cards.title, column: cards.column })
      .from(cards)
      .where(eq(cards.parentId, card.id))
      .all()
    const abandon = children
      .filter((child) => !CARD_CLOSED_COLUMNS.includes(child.column))
      .map(({ cardId, number, title }) => ({ cardId, number, title }))

    const list = await this.freshList(project)
    const own = this.treesOf(list, [card.id])

    if (target === 'done') {
      for (const tree of own.trees) {
        if (tree.state === 'merged' || tree.state === 'empty' || tree.state === 'missing') continue
        const pr = tree.branch ? await this.pullRequestOf(project, card.id, tree.branch) : null
        if (pr?.state !== 'MERGED') {
          throw new Refusal(
            `Refusé : la branche \`${tree.branch ?? tree.name}\` de #${card.number} n'est pas fusionnée. Propose la clôture une fois sa PR fusionnée et le résultat vérifié.`,
          )
        }
      }
      // Une parente sans enfant ouverte se clôt une fois sa PR vers la branche par
      // défaut fusionnée : avant, sa branche porte encore le travail de ses enfants.
      if (abandon.length === 0 && card.branchPrNumber !== null) {
        const pr = await this.readPullRequest(project, String(card.branchPrNumber))
        if (pr?.state !== 'MERGED') {
          throw new Refusal(
            `Refusé : la PR #${card.branchPrNumber} de \`${card.branch}\` vers la branche par défaut n'est pas fusionnée. C'est l'utilisateur qui la fusionne ; propose la clôture de #${card.number} après.`,
          )
        }
      }
    }

    const all = abandon.length > 0 ? this.treesOf(list, [card.id, ...abandon.map((child) => child.cardId)]) : own
    return {
      conversations: all.open,
      worktrees: all.trees.map((tree) => tree.name),
      abandon,
      branch: target === 'done' && card.branch ? card.branch : null,
    }
  }

  /**
   * Au clic, la colonne de la carte déjà posée par la route : abandonne les enfants que la
   * demande nommait et qui sont encore ouvertes, retire les arbres, supprime les branches,
   * archive les conversations, et laisse une note sur chaque carte touchée.
   */
  async apply(
    project: ProjectRow,
    cardId: string,
    target: CloseTarget,
    userId: string,
    abandonIds: string[],
  ): Promise<CardCloseOutcome[]> {
    const card = this.db.select().from(cards).where(eq(cards.id, cardId)).get()
    if (!card) return []

    const now = Date.now()
    const abandoned = abandonIds.length
      ? this.db
          .select()
          .from(cards)
          .where(and(eq(cards.parentId, card.id), inArray(cards.id, abandonIds), notInArray(cards.column, [...CARD_CLOSED_COLUMNS])))
          .all()
      : []
    if (abandoned.length > 0) {
      writeTransaction(this.db, (tx) => {
        for (const child of abandoned) {
          tx.update(cards).set({ column: 'abandoned', updatedAt: now }).where(eq(cards.id, child.id)).run()
          recordCardMove(tx, { cardId: child.id, from: child.column, to: 'abandoned', userId, at: now })
        }
      })
    }

    const outcome: CardCloseOutcome = await this.closeOne(project, card, target)
    outcome.abandoned = abandoned.map((child) => child.number)
    const outcomes = [outcome]
    for (const child of abandoned) {
      outcomes.push(await this.closeOne(project, child, 'abandoned'))
    }

    if (target === 'done' && card.branch) await this.dropParentBranch(project, card, outcome)

    this.note(card.id, describe(outcome, card.number, target))
    for (const [index, child] of abandoned.entries()) {
      this.note(child.id, `Abandonnée à la clôture de la carte parente #${card.number}. ${describe(outcomes[index + 1]!, child.number, 'abandoned')}`)
    }
    return outcomes
  }

  /** Les arbres d'une carte, puis ses conversations. */
  private async closeOne(project: ProjectRow, card: CardRow, target: CloseTarget): Promise<CardCloseOutcome> {
    const outcome: CardCloseOutcome = { number: card.number, archived: 0, removed: [], kept: [], deleted: [], abandoned: [] }
    const list = await this.freshList(project)
    const { trees, ids } = this.treesOf(list, [card.id])
    const base = list.base

    for (const tree of trees) {
      const keep = (reason: CardCloseKeptReason) => outcome.kept.push({ name: tree.name, reason })
      if (this.busy(tree.conversations.map((entry) => entry.id)).length > 0) {
        keep('busy')
        continue
      }
      if (this.shared(tree, ids)) {
        keep('shared')
        continue
      }
      if (tree.state === 'dirty') {
        keep('dirty')
        continue
      }
      if (tree.state === 'unreadable') {
        keep('unreadable')
        continue
      }
      const pr = tree.branch ? await this.pullRequestOf(project, card.id, tree.branch) : null
      const merged = pr?.state === 'MERGED' ? pr : null
      const safe =
        tree.state !== 'unmerged' ||
        (merged !== null && merged.headSha === tree.head) ||
        (tree.branch !== null && tree.head !== null && (await remoteTip(project.workspacePath, tree.branch)) === tree.head)
      if (!safe) {
        keep('unpushed')
        continue
      }

      try {
        const result = await this.cleanup.run(project, { path: tree.path, deleteBranch: true, stopServices: true })
        if (!result) continue
        outcome.archived += result.archived
        outcome.removed.push(tree.name)
      } catch (err) {
        if (!(err instanceof HttpError)) throw err
        keep(err.code === 'worktree_busy' ? 'busy' : 'refused')
        continue
      }

      // La forge, seulement pour un travail livré : une branche abandonnée garde le sien.
      if (target === 'done' && merged && tree.branch && !isBase(tree.branch, base)) {
        if (await this.dropRemote(project, tree.branch, merged.headSha)) outcome.deleted.push(tree.branch)
      }
    }

    // Les conversations qui ne vivaient dans aucun arbre retiré : à la racine, dans un
    // arbre gardé, ou déjà sans arbre. Celles qui travaillent restent ouvertes.
    outcome.archived += this.db
      .update(conversations)
      .set({ archivedAt: Date.now() })
      .where(and(eq(conversations.cardId, card.id), isNull(conversations.archivedAt), notInArray(conversations.status, [...BUSY])))
      .run().changes
    return outcome
  }

  /** La branche `jalon/…` d'une parente, une fois sa PR vers la branche par défaut fusionnée. */
  private async dropParentBranch(project: ProjectRow, card: CardRow, outcome: CardCloseOutcome): Promise<void> {
    const branch = card.branch!
    const pr = card.branchPrNumber !== null ? await this.readPullRequest(project, String(card.branchPrNumber)) : null
    if (pr?.state !== 'MERGED' || pr.head !== branch) {
      outcome.kept.push({ name: branch, reason: 'unmerged' })
      return
    }
    // Extraite dans un arbre, git refuse : elle reste, sans rien casser.
    await deleteBranch(project.workspacePath, branch).catch(() => undefined)
    const base = (await this.freshList(project)).base
    if (!isBase(branch, base) && (await this.dropRemote(project, branch, pr.headSha))) outcome.deleted.push(branch)
  }

  /**
   * Supprime la branche sur la forge si elle en est restée au commit fusionné. Une branche
   * déjà absente, ou qui a reçu des commits depuis la fusion, n'est pas touchée.
   */
  private async dropRemote(project: ProjectRow, branch: string, headSha: string): Promise<boolean> {
    if ((await remoteTip(project.workspacePath, branch)) !== headSha) return false
    return (await git(project.workspacePath, ['push', '--quiet', 'origin', '--delete', branch], NETWORK_TIMEOUT_MS)).ok
  }

  /**
   * Les arbres où vivent les conversations de ces cartes (leur cwd), hors l'arbre de la
   * branche par défaut, avec le nombre de ces conversations encore ouvertes.
   */
  private treesOf(list: WorktreeStatusListDto, cardIds: string[]): { trees: WorktreeStatusDto[]; ids: Set<string>; open: number } {
    const rows = this.db
      .select({ id: conversations.id, archivedAt: conversations.archivedAt })
      .from(conversations)
      .where(inArray(conversations.cardId, cardIds))
      .all()
    const ids = new Set(rows.map((row) => row.id))
    const trees = list.worktrees.filter(
      (tree) => !isBase(tree.branch, list.base) && tree.conversations.some((entry) => entry.link === 'worktree' && ids.has(entry.id)),
    )
    return { trees, ids, open: rows.filter((row) => row.archivedAt === null).length }
  }

  /** Une autre session encore ouverte vit dans l'arbre : le retirer la priverait du sien. */
  private shared(tree: WorktreeStatusDto, ids: Set<string>): boolean {
    const others = tree.conversations.filter((entry) => entry.link === 'worktree' && !ids.has(entry.id)).map((entry) => entry.id)
    if (others.length === 0) return false
    return (
      this.db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(inArray(conversations.id, others), isNull(conversations.archivedAt)))
        .get() !== undefined
    )
  }

  private busy(ids: string[]): string[] {
    if (ids.length === 0) return []
    return this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(inArray(conversations.id, ids), isNull(conversations.archivedAt), inArray(conversations.status, [...BUSY])))
      .all()
      .map((row) => row.id)
  }

  /**
   * La PR d'une branche : celle que la revue connaît (#68), sinon celle que la forge
   * trouve par le nom de la branche. Null si aucune, ou si la forge ne répond pas.
   */
  private async pullRequestOf(project: ProjectRow, cardId: string, branch: string): Promise<PullRequest | null> {
    const review = this.db
      .select({ pr: cardReviews.prNumber })
      .from(cardReviews)
      .where(and(eq(cardReviews.cardId, cardId), eq(cardReviews.branch, branch)))
      .orderBy(desc(cardReviews.createdAt))
      .get()
    const pr = await this.readPullRequest(project, review ? String(review.pr) : branch)
    return pr && pr.head === branch ? pr : null
  }

  private async readPullRequest(project: ProjectRow, ref: string): Promise<PullRequest | null> {
    return this.forge.readPullRequest(project.workspacePath, ref, this.token?.(project.ownerId)).catch(() => null)
  }

  /** Relue à l'instant : la décision de retirer un arbre ne se prend pas sur un cache. */
  private async freshList(project: ProjectRow): Promise<WorktreeStatusListDto> {
    this.status.invalidate(project.id)
    return this.status.current(project)
  }

  private note(cardId: string, body: string): void {
    this.db.insert(cardNotes).values({ id: randomUUID(), cardId, conversationId: null, userId: null, body, createdAt: Date.now() }).run()
  }
}

/** La branche par défaut, sous son nom local ou distant : jamais touchée. */
function isBase(branch: string | null, base: string | null): boolean {
  if (branch === null || base === null) return false
  return branch === base || branch === base.replace(/^origin\//, '')
}

const KEPT_WORDS: Record<CardCloseKeptReason, string> = {
  dirty: 'des modifications non commitées',
  unpushed: 'des commits absents de la forge',
  busy: 'une session y travaille',
  shared: "une session d'une autre carte y vit",
  unreadable: "git n'a pas su le juger",
  refused: 'git a refusé de le retirer',
  unmerged: "sa PR vers la branche par défaut n'est pas fusionnée",
}

/** La note laissée sur la carte : ce que la clôture a fait, et ce qu'elle a laissé. */
export function describe(outcome: CardCloseOutcome, number: number, target: CloseTarget): string {
  const code = (names: string[]) => names.map((name) => `\`${name}\``).join(', ')
  const lines = [
    `Carte #${number} close${target === 'abandoned' ? ' en « abandonné »' : ''} : ${outcome.archived} conversation(s) archivée(s).`,
  ]
  if (outcome.abandoned.length > 0) lines.push(`Enfants abandonnées : ${outcome.abandoned.map((n) => `#${n}`).join(', ')}.`)
  if (outcome.removed.length > 0) lines.push(`Worktree(s) retiré(s) : ${code(outcome.removed)}.`)
  if (outcome.deleted.length > 0) lines.push(`Branche(s) supprimée(s) sur la forge : ${code(outcome.deleted)}.`)
  for (const kept of outcome.kept) lines.push(`Laissé en place : \`${kept.name}\`, ${KEPT_WORDS[kept.reason]}.`)
  return lines.join('\n')
}

/** Le commit d'une branche sur la forge, ou null : absente, pas de remote, réseau coupé. */
async function remoteTip(repo: string, branch: string): Promise<string | null> {
  const result = await git(repo, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], NETWORK_TIMEOUT_MS)
  if (!result.ok) return null
  return result.stdout.trim().split(/\s+/)[0] || null
}

async function git(cwd: string, args: string[], timeout = 10_000): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    return { ok: true, stdout }
  } catch {
    return { ok: false, stdout: '' }
  }
}
