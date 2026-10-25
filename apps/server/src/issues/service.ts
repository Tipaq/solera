import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull, max } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import {
  cardIssues,
  cards,
  conversations,
  issueSources,
  projects,
  sessionMessages,
  writeTransaction,
  type CardIssueRow,
  type Db,
  type IssueSourceRow,
} from '@solera/db'
import { CARD_CLOSED_COLUMNS, qualifyIssueReferences, type IssueProvider } from '@solera/protocol'
import { createCard } from '../cards/create.js'
import { recordCardMove } from '../cards/moves.js'
import { setCardParent } from '../cards/tree.js'
import type { ExternalComment, ExternalIssue, IssueAdapter } from './adapter.js'
import { repositoryOf } from './links.js'

/** Le balayage : les écritures en attente partent vite, la lecture suit son propre rythme. */
const TICK_MS = 5_000

/** Une source se relit au plus une fois par minute : deux requêtes, loin des quotas. */
const POLL_MS = 60_000

/** Après un refus de l'outil, une écriture n'est retentée que dix minutes plus tard. */
const PUSH_RETRY_MS = 10 * 60_000

/**
 * Le mot laissé sur une issue refusée. En anglais : il s'adresse à qui l'a ouverte, et
 * un dépôt ouvert à la communauté se lit d'abord dans cette langue.
 */
export const REFUSAL_COMMENT = 'Thanks for the report. This was reviewed and is not planned for now, so the issue is closed.'

/** Les sessions « en cours », celles à qui un commentaire est remis sans les relancer. */
const WORKING = ['running', 'awaiting_input'] as const

/**
 * L'absorption des issues dans le board (#84), par polling.
 *
 * Trois mouvements, et seulement ceux-là :
 * - **les issues entrent** en cartes non acceptées dans « à faire » ; une issue rouverte
 *   ramène sa carte dans « à faire » ;
 * - **l'état repart** : ce que les mouvements de cartes ont mis en attente
 *   (`issues/links.ts`) est écrit dans l'outil ;
 * - **un commentaire neuf** est remis à la session en cours sur la carte, sans en lancer
 *   aucune.
 *
 * Le contenu n'est jamais synchronisé : une issue retouchée ne réécrit pas sa carte, qui
 * appartient au board dès qu'elle y est entrée.
 */
export class IssueSources {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private logger: FastifyBaseLogger | null = null
  private readonly retryAt = new Map<string, number>()

  constructor(
    private readonly db: Db,
    private readonly adapters: Record<IssueProvider, IssueAdapter>,
    private readonly token?: (userId: string) => string | undefined,
  ) {}

  start(logger: FastifyBaseLogger): void {
    this.logger = logger
    this.timer = setInterval(() => void this.sweep(), TICK_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  adapter(provider: IssueProvider): IssueAdapter {
    return this.adapters[provider]
  }

  /** Le jeton du propriétaire du projet : c'est en son nom que Solera lit et écrit. */
  tokenFor(projectId: string): string | undefined {
    const project = this.db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId)).get()
    return project ? this.token?.(project.ownerId) : undefined
  }

  async sweep(now = Date.now()): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.pushPending(now)
      const due = this.db.select().from(issueSources).all()
      for (const source of due) {
        if (source.polledAt !== null && source.polledAt > now - POLL_MS) continue
        await this.poll(source)
      }
    } finally {
      this.busy = false
    }
  }

  /** Relit une source tout de suite, au prochain balayage. */
  requestPoll(projectId: string): void {
    this.db.update(issueSources).set({ polledAt: null }).where(eq(issueSources.projectId, projectId)).run()
  }

  async poll(source: IssueSourceRow): Promise<void> {
    const adapter = this.adapters[source.provider]
    const project = this.db.select().from(projects).where(eq(projects.id, source.projectId)).get()
    if (!project) return
    const token = this.token?.(project.ownerId)
    const startedAt = Date.now()

    try {
      const viewer = source.viewer ?? (await adapter.viewer(token))
      const issues = await adapter.changedSince(source.repository, source.issuesCursor, token)
      for (const issue of issues) this.absorb(source, project.ownerId, issue)
      for (const issue of issues.filter((entry) => entry.hasChildren)) {
        const children = await adapter.children(source.repository, issue.id, token)
        this.attachChildren(source, issue.id, children)
      }

      // Le premier passage ne remet pas l'arriéré : un commentaire vieux d'un mois ne
      // concerne pas la session qui tourne aujourd'hui.
      let commentsCursor = source.commentsCursor ?? githubTime(startedAt)
      if (source.commentsCursor !== null) {
        const comments = await adapter.commentsSince(source.repository, source.commentsCursor, token)
        for (const comment of comments) this.relay(source, viewer, comment)
        commentsCursor = comments.at(-1)?.createdAt ?? commentsCursor
      }

      this.db
        .update(issueSources)
        .set({
          viewer,
          issuesCursor: issues.at(-1)?.updatedAt ?? source.issuesCursor,
          commentsCursor,
          polledAt: Date.now(),
          error: null,
        })
        .where(eq(issueSources.projectId, source.projectId))
        .run()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger?.warn({ err, project: source.projectId }, 'lecture des issues en echec')
      this.db
        .update(issueSources)
        .set({ polledAt: Date.now(), error: message })
        .where(eq(issueSources.projectId, source.projectId))
        .run()
    }
  }

  /**
   * Une issue lue : créée en carte si elle est neuve et ouverte, et son état suivi si elle
   * est déjà au board. Une issue fermée inconnue n'entre pas.
   */
  private absorb(source: IssueSourceRow, ownerId: string, issue: ExternalIssue): void {
    const link = this.linkOf(source.projectId, source.provider, issue.id)

    if (!link) {
      if (issue.state !== 'open') return
      writeTransaction(this.db, (tx) => {
        const card = createCard(
          tx as unknown as Db,
          source.projectId,
          ownerId,
          { title: issue.title.trim() || `${source.repository}#${issue.id}`, description: describe(source, issue), column: 'todo' },
          { accepted: false },
        )
        const now = Date.now()
        tx.insert(cardIssues)
          .values({
            cardId: card.id,
            projectId: source.projectId,
            provider: source.provider,
            externalId: issue.id,
            url: issue.url,
            state: 'open',
            pending: null,
            pushError: null,
            createdAt: now,
            updatedAt: now,
          })
          .run()
      })
      return
    }

    if (link.state === issue.state) return
    // L'état lu devient l'état connu avant tout mouvement : c'est contre lui que le
    // mouvement calcule ce qu'il reste à écrire, et l'outil est déjà à jour.
    this.db
      .update(cardIssues)
      .set({ state: issue.state, updatedAt: Date.now() })
      .where(eq(cardIssues.cardId, link.cardId))
      .run()
    // Une issue fermée de l'extérieur ne ferme pas sa carte : Solera fait foi, et c'est
    // une personne qui dit qu'un travail est fini. Une issue rouverte, elle, rouvre.
    if (issue.state === 'open' && link.pending === null) this.reopenCard(link)
  }

  private reopenCard(link: CardIssueRow): void {
    const card = this.db.select().from(cards).where(eq(cards.id, link.cardId)).get()
    if (!card || !CARD_CLOSED_COLUMNS.includes(card.column)) return
    const [last] = this.db
      .select({ position: max(cards.position) })
      .from(cards)
      .where(and(eq(cards.projectId, card.projectId), eq(cards.column, 'todo')))
      .all()
    const now = Date.now()
    writeTransaction(this.db, (tx) => {
      tx.update(cards)
        .set({ column: 'todo', position: (last?.position ?? 0) + 1, updatedAt: now })
        .where(eq(cards.id, card.id))
        .run()
      recordCardMove(tx, { cardId: card.id, from: card.column, to: 'todo', userId: null, at: now })
    })
  }

  /**
   * Les sous-issues rattachent leur carte à celle de la parente, tant que personne ne l'a
   * triée : une fois acceptée, la carte appartient au board, et ni un rattachement ni un
   * détachement faits à la main ne se défont depuis l'outil.
   */
  private attachChildren(source: IssueSourceRow, parentId: string, children: string[]): void {
    const parent = this.linkOf(source.projectId, source.provider, parentId)
    if (!parent || children.length === 0) return
    const linked = this.db
      .select({ id: cards.id, projectId: cards.projectId, parentId: cards.parentId })
      .from(cardIssues)
      .innerJoin(cards, eq(cards.id, cardIssues.cardId))
      .where(
        and(
          eq(cardIssues.projectId, source.projectId),
          eq(cardIssues.provider, source.provider),
          inArray(cardIssues.externalId, children),
          isNull(cards.parentId),
          isNull(cards.acceptedAt),
        ),
      )
      .all()
    for (const child of linked) {
      try {
        setCardParent(this.db, child, parent.cardId, { userId: null })
      } catch (err) {
        // Un cycle ou une parente devenue invalide : le board garde ce qu'il a.
        this.logger?.debug({ err, card: child.id }, 'sous-issue non rattachee')
      }
    }
  }

  /** Un commentaire neuf, remis à chaque session en cours sur la carte de son issue. */
  private relay(source: IssueSourceRow, viewer: string, comment: ExternalComment): void {
    // Les siens ne reviennent pas : une session qui commente par le serveur MCP de l'outil
    // le fait avec le même jeton, et se répondrait à elle-même.
    if (viewer && comment.author === viewer) return
    const link = this.linkOf(source.projectId, source.provider, comment.issueId)
    if (!link) return
    const recipients = this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.cardId, link.cardId),
          inArray(conversations.status, [...WORKING]),
          isNull(conversations.archivedAt),
        ),
      )
      .all()
    if (recipients.length === 0) return
    const body = [
      `@${comment.author} a commenté l'issue ${source.repository}#${comment.issueId} (${comment.url}) :`,
      '',
      comment.body,
    ].join('\n')
    const now = Date.now()
    this.db
      .insert(sessionMessages)
      .values(
        recipients.map((recipient) => ({
          id: randomUUID(),
          projectId: source.projectId,
          // Solera parle, comme pour une décision : expéditrice et destinataire sont la même.
          fromConversationId: recipient.id,
          toConversationId: recipient.id,
          kind: 'issue_comment' as const,
          body,
          createdAt: now,
        })),
      )
      .run()
  }

  /** Écrit dans l'outil ce que les mouvements de cartes ont laissé en attente. */
  private async pushPending(now: number): Promise<void> {
    const pending = this.db.select().from(cardIssues).where(isNotNull(cardIssues.pending)).all()
    for (const link of pending) {
      if ((this.retryAt.get(link.cardId) ?? 0) > now) continue
      const source = this.db.select().from(issueSources).where(eq(issueSources.projectId, link.projectId)).get()
      // Sans source, ou avec une source qui vise un autre dépôt, l'outil n'est plus le
      // sien : l'écriture attend qu'on rebranche le bon. GitHub ignore la casse des noms.
      const repository = repositoryOf(link)
      if (!source || source.provider !== link.provider || repository?.toLowerCase() !== source.repository.toLowerCase()) continue
      await this.push(source, link)
    }
  }

  private async push(source: IssueSourceRow, link: CardIssueRow): Promise<void> {
    const adapter = this.adapters[link.provider]
    const token = this.tokenFor(link.projectId)
    const pending = link.pending
    try {
      if (pending === 'reopen') await adapter.reopen(source.repository, link.externalId, token)
      else if (pending === 'refused') await adapter.close(source.repository, link.externalId, 'not_planned', token, REFUSAL_COMMENT)
      else if (pending === 'completed' || pending === 'not_planned') await adapter.close(source.repository, link.externalId, pending, token)
      else return
      this.retryAt.delete(link.cardId)
      this.db
        .update(cardIssues)
        .set({ state: pending === 'reopen' ? 'open' : 'closed', pending: null, pushError: null, updatedAt: Date.now() })
        // Seulement si rien n'a changé pendant l'écriture : un mouvement arrivé entre-temps
        // a posé sa propre attente, et c'est elle qui doit partir ensuite.
        .where(and(eq(cardIssues.cardId, link.cardId), eq(cardIssues.pending, pending)))
        .run()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger?.warn({ err, card: link.cardId }, "ecriture de l'etat de l'issue en echec")
      this.retryAt.set(link.cardId, Date.now() + PUSH_RETRY_MS)
      this.db.update(cardIssues).set({ pushError: message }).where(eq(cardIssues.cardId, link.cardId)).run()
    }
  }

  private linkOf(projectId: string, provider: IssueProvider, externalId: string): CardIssueRow | undefined {
    return this.db
      .select()
      .from(cardIssues)
      .where(and(eq(cardIssues.projectId, projectId), eq(cardIssues.provider, provider), eq(cardIssues.externalId, externalId)))
      .get()
  }
}

/** Le corps de l'issue, ses `#12` qualifiés, et d'où elle vient. */
function describe(source: IssueSourceRow, issue: ExternalIssue): string {
  const origin = `*Issue [${source.repository}#${issue.id}](${issue.url})${issue.author ? `, ouverte par @${issue.author}` : ''}.*`
  const body = qualifyIssueReferences(issue.body.trim(), source.repository)
  return body ? `${body}\n\n${origin}` : origin
}

/** Une date au format des curseurs de GitHub, à la seconde. */
function githubTime(at: number): string {
  return new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z')
}
