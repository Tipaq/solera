import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { cardNotes, cardReviews, cards, projects, type CardRow, type ProjectRow } from '@solera/db'
import type { CardBranchPrDto } from '@solera/protocol'
import type { AppContext } from '../http/context.js'
import type { Notifications } from '../notifications/dispatcher.js'
import { defaultBase } from '../worktrees/assess.js'
import type { Forge, PullRequest } from './forge.js'
import { PullRequestNotReady, mergeReadyPullRequest } from './merge.js'

/**
 * Après un échec, la forge n'est relancée pour cette parente qu'une demi-heure plus tard.
 * Une PR fermée sans fusion se relit au même rythme : elle peut être rouverte.
 */
const RETRY_MS = 30 * 60_000

/**
 * Une PR de parente ouverte se relit une fois par minute : le balayage passe deux fois par
 * seconde, et un `gh` par jalon à ce rythme serait du bruit pour la forge. La minute est
 * celle du cache des PR de l'Activité.
 */
const CHECK_MS = 60_000

/** Ce que ce module attend de l'aiguillage des notifications. */
export type ParentNotifier = Pick<Notifications, 'dispatch'>

/**
 * La PR d'une carte parente vers la branche par défaut (#68, lot 3).
 *
 * Les enfants se fusionnent seules dans la branche de leur parente, au vert de leur
 * revue (`reviews.ts`). Quand elles sont toutes closes, terminées ou abandonnées, et
 * qu'au moins une y a été fusionnée, Solera ouvre la PR de la branche vers la branche par
 * défaut et prévient le propriétaire du projet. **Il ne la fusionne pas** : c'est le
 * seul geste qui touche la branche par défaut, et il reste celui d'une personne.
 *
 * Pas de revue d'agent sur cette PR : chacune de ses parties a déjà été relue.
 *
 * Balayé avec les demandes d'agent, comme les fusions : une requête indexée, vide la
 * plupart du temps. Les échecs attendent `RETRY_MS`, en mémoire : un redémarrage les
 * retente tout de suite, ce qui est le comportement voulu.
 */
export class ParentPullRequests {
  private readonly retryAt = new Map<string, number>()
  /** Quand relire chaque PR ouverte, par parente : la fusion faite sur la forge (#187). */
  private readonly checkAt = new Map<string, number>()
  private checking = false
  private logger: FastifyBaseLogger | null = null

  constructor(
    private readonly ctx: AppContext,
    private readonly forge: Forge,
    private readonly token?: (userId: string) => string | undefined,
    private readonly notifications?: ParentNotifier,
  ) {}

  setLogger(logger: FastifyBaseLogger): void {
    this.logger = logger
  }

  async sweep(now = Date.now()): Promise<void> {
    const parents = this.ctx.db
      .select()
      .from(cards)
      .where(and(isNotNull(cards.branch), isNull(cards.branchPrNumber)))
      .all()
    for (const parent of parents) {
      if ((this.retryAt.get(parent.id) ?? 0) > now) continue
      const merged = this.mergedChildren(parent)
      if (merged === null) continue
      const project = this.ctx.db.select().from(projects).where(eq(projects.id, parent.projectId)).get()
      if (!project) continue
      await this.open(parent, project, merged)
    }
  }

  /**
   * Relit les PR de parente ouvertes, et pose leur date de fusion quand la forge les dit
   * fusionnées : une fusion faite sur GitHub livre le jalon comme celle faite depuis
   * Solera. Une PR fermée sans fusion le dit (#198), et peut être rouverte : elle se
   * relit à la demi-heure.
   *
   * À part de `sweep`, et lancée sans être attendue : un `gh` par jalon ouvert, jusqu'à
   * vingt secondes chacun quand la forge traîne, retarderait les demandes d'agent.
   */
  async checkMerged(now = Date.now()): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      await this.checkOpen(now)
    } finally {
      this.checking = false
    }
  }

  private async checkOpen(now: number): Promise<void> {
    const open = this.ctx.db
      .select({ card: cards, project: projects })
      .from(cards)
      .innerJoin(projects, eq(projects.id, cards.projectId))
      .where(and(isNotNull(cards.branchPrNumber), isNull(cards.branchPrMergedAt), isNull(projects.archivedAt)))
      .all()
    for (const { card: parent, project } of open) {
      if ((this.checkAt.get(parent.id) ?? 0) > now) continue
      let pr: PullRequest
      try {
        pr = await this.forge.readPullRequest(project.workspacePath, String(parent.branchPrNumber), this.token?.(project.ownerId))
      } catch (err) {
        this.checkAt.set(parent.id, now + RETRY_MS)
        this.logger?.warn({ err, card: parent.id }, 'PR de carte parente non relue')
        continue
      }
      if (pr.state === 'MERGED') {
        this.checkAt.delete(parent.id)
        recordBranchPrMerged(this.ctx, parent, pr, pr.mergedAt ?? now)
      } else {
        this.checkAt.set(parent.id, now + (pr.state === 'CLOSED' ? RETRY_MS : CHECK_MS))
        recordBranchPrState(this.ctx, parent, pr, now)
      }
    }
  }

  /**
   * Les PR fusionnées des enfants, quand toutes sont closes et qu'au moins une l'a été
   * par sa revue ; null sinon. Une branche où rien n'a été fusionné n'a rien à proposer.
   */
  private mergedChildren(parent: CardRow): Array<{ number: number; title: string; pr: number }> | null {
    const children = this.ctx.db
      .select({ id: cards.id, number: cards.number, title: cards.title, column: cards.column })
      .from(cards)
      .where(eq(cards.parentId, parent.id))
      .all()
    if (children.length === 0) return null
    if (children.some((child) => child.column !== 'done' && child.column !== 'abandoned')) return null
    const reviews = this.ctx.db
      .select({ cardId: cardReviews.cardId, pr: cardReviews.prNumber })
      .from(cardReviews)
      .where(
        and(
          inArray(cardReviews.cardId, children.map((child) => child.id)),
          eq(cardReviews.state, 'merged'),
          eq(cardReviews.base, parent.branch!),
        ),
      )
      .all()
    if (reviews.length === 0) return null
    return reviews.flatMap((review) => {
      const child = children.find((entry) => entry.id === review.cardId)
      return child ? [{ number: child.number, title: child.title, pr: review.pr }] : []
    })
  }

  private async open(parent: CardRow, project: ProjectRow, merged: Array<{ number: number; title: string; pr: number }>): Promise<void> {
    const branch = parent.branch!
    const repo = project.workspacePath
    const token = this.token?.(project.ownerId)
    const base = ((await defaultBase(repo)) ?? 'main').replace(/^origin\//, '')
    let pr: { number: number; url: string }
    try {
      // Une PR déjà ouverte à la main pour cette branche est reprise plutôt que doublée.
      const existing = await this.forge.readPullRequest(repo, branch, token).catch(() => null)
      if (existing && existing.head === branch && existing.state !== 'CLOSED') {
        pr = { number: existing.number, url: existing.url }
      } else {
        pr = await this.forge.createPullRequest(
          repo,
          {
            head: branch,
            base,
            title: `#${parent.number} ${parent.title}`,
            body: [
              `Les cartes de #${parent.number}, chacune relue par une session de revue puis fusionnée dans \`${branch}\` :`,
              '',
              ...merged.map((child) => `- #${child.number} ${child.title} (PR #${child.pr})`),
              '',
              'Ouverte par Solera quand toutes les cartes enfants ont été closes. La fusion vers la branche par défaut reste à faire à la main.',
            ].join('\n'),
          },
          token,
        )
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      // La note ne part qu'au premier échec : la suivante tous les quarts d'heure ferait
      // d'une forge en panne un fil de bruit sur la carte.
      if (!this.retryAt.has(parent.id)) this.note(parent.id, `PR de \`${branch}\` vers \`${base}\` impossible à ouvrir : ${reason}`)
      this.retryAt.set(parent.id, Date.now() + RETRY_MS)
      this.logger?.warn({ err, card: parent.id }, 'PR de carte parente non ouverte')
      return
    }

    this.retryAt.delete(parent.id)
    this.ctx.db
      .update(cards)
      .set({ branchPrNumber: pr.number, branchPrUrl: pr.url, branchPrBase: base })
      .where(and(eq(cards.id, parent.id), isNull(cards.branchPrNumber)))
      .run()
    this.note(
      parent.id,
      `Toutes les cartes enfants sont closes : PR #${pr.number} ouverte de \`${branch}\` vers \`${base}\` (${pr.url}). À fusionner par une personne.`,
    )
    await this.notifications
      ?.dispatch(project.ownerId, {
        kind: 'decision',
        push: {
          title: 'Carte prête à fusionner',
          body: `#${parent.number} ${parent.title} : PR #${pr.number} vers ${base}`,
          url: `/p/${project.id}/board`,
          tag: `parent-pr-${parent.id}`,
        },
      })
      .catch((err: unknown) => this.logger?.warn({ err, card: parent.id }, 'notification de PR de parente non émise'))
  }

  private note(cardId: string, body: string): void {
    note(this.ctx, cardId, body)
  }
}

/** La carte n'a pas de PR finale : sa branche n'a pas encore été proposée. */
export class BranchPrMissing extends Error {}

/**
 * Fusionne la PR d'une parente vers la branche par défaut (#187) : le « Fusionner dans
 * main » d'un jalon. La fusion est celle d'un arbre (`mergeReadyPullRequest`), avec ses
 * refus : la PR doit être prête. Pose la date de fusion et une note ; **ne clôt pas la
 * carte**, dont la clôture reste un geste à part (#69).
 *
 * Une PR que la forge dit déjà fusionnée est refusée comme les autres, mais sa date est
 * posée au passage : elle l'a été sur GitHub, et le jalon est livré.
 *
 * `BranchPrMissing` sans PR, `PullRequestNotReady` si elle n'est pas prête, `ForgeError`
 * si la forge refuse.
 */
export async function mergeBranchPullRequest(
  ctx: AppContext,
  forge: Forge,
  card: CardRow,
  project: ProjectRow,
  token?: string,
): Promise<CardBranchPrDto & { mergedAt: number }> {
  if (card.branchPrNumber === null) throw new BranchPrMissing(`#${card.number} n'a pas de PR vers la branche par défaut.`)
  let pr: PullRequest
  try {
    pr = await mergeReadyPullRequest(forge, project.workspacePath, String(card.branchPrNumber), token)
  } catch (err) {
    if (err instanceof PullRequestNotReady) {
      if (err.reason === 'merged') recordBranchPrMerged(ctx, card, err.pullRequest, err.pullRequest.mergedAt ?? Date.now())
      else recordBranchPrState(ctx, card, err.pullRequest, Date.now())
    }
    throw err
  }
  const mergedAt = Date.now()
  recordBranchPrMerged(ctx, card, pr, mergedAt)
  return { number: pr.number, url: pr.url, base: pr.base, mergedAt, closedAt: null }
}

/** La date de fusion, et sa note, une seule fois : la première à la voir l'écrit. */
function recordBranchPrMerged(ctx: AppContext, card: CardRow, pr: PullRequest, at: number): void {
  const { changes } = ctx.db
    .update(cards)
    .set({ branchPrMergedAt: at, branchPrClosedAt: null, branchPrBase: pr.base })
    .where(and(eq(cards.id, card.id), isNull(cards.branchPrMergedAt)))
    .run()
  if (changes === 0) return
  note(ctx, card.id, `PR #${pr.number} de \`${pr.head}\` fusionnée dans \`${pr.base}\` : le travail de #${card.number} est livré.`)
}

/**
 * Ce que la forge dit d'une PR pas fusionnée (#198) : sa base, et si elle est fermée.
 * La fermeture se note une fois, à la première lecture qui la voit ; rouverte, elle se
 * lève sans note, et le jalon propose de nouveau la fusion.
 */
function recordBranchPrState(ctx: AppContext, card: CardRow, pr: PullRequest, at: number): void {
  const closed = pr.state === 'CLOSED'
  // Relue chaque minute, une PR ouverte n'a rien à écrire la plupart du temps.
  if (closed === (card.branchPrClosedAt !== null) && card.branchPrBase === pr.base) return
  const { changes } = ctx.db
    .update(cards)
    .set({ branchPrClosedAt: closed ? at : null, branchPrBase: pr.base })
    .where(and(eq(cards.id, card.id), isNull(cards.branchPrMergedAt), closed ? isNull(cards.branchPrClosedAt) : undefined))
    .run()
  if (closed && changes > 0) {
    note(ctx, card.id, `PR #${pr.number} de \`${pr.head}\` vers \`${pr.base}\` fermée sans fusion : rouvre-la sur la forge pour livrer #${card.number}.`)
  }
}

function note(ctx: AppContext, cardId: string, body: string): void {
  ctx.db
    .insert(cardNotes)
    .values({ id: randomUUID(), cardId, conversationId: null, userId: null, body, createdAt: Date.now() })
    .run()
}
