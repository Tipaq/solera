import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { cardNotes, cardReviews, cards, projects, type CardRow, type ProjectRow } from '@solera/db'
import type { AppContext } from '../http/context.js'
import type { Notifications } from '../notifications/dispatcher.js'
import { defaultBase } from '../worktrees/assess.js'
import type { Forge } from './forge.js'

/** Après un échec, la forge n'est relancée pour cette parente qu'une demi-heure plus tard. */
const RETRY_MS = 30 * 60_000

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
      .set({ branchPrNumber: pr.number, branchPrUrl: pr.url })
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
    this.ctx.db
      .insert(cardNotes)
      .values({ id: randomUUID(), cardId, conversationId: null, userId: null, body, createdAt: Date.now() })
      .run()
  }
}
