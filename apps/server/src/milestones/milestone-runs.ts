import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import {
  cardBlocks,
  cardNotes,
  cardReviews,
  cards,
  conversations,
  milestoneRunCards,
  milestoneRuns,
  projects,
  worktrees,
  writeTransaction,
  type CardRow,
  type MilestoneRunCardRow,
  type MilestoneRunRow,
  type ProjectRow,
} from '@solera/db'
import {
  cardBranchName,
  parseAgentConfig,
  MILESTONE_BUSY_STATUSES,
  type AgentConfig,
  type ConversationStatus,
  type MilestoneBlockReason,
  type MilestoneBlockerDto,
  type MilestoneExcludedReason,
  type MilestonePlanCardDto,
  type MilestonePlanDto,
  type MilestoneRunCardDto,
  type MilestoneRunDto,
  type StartMilestoneBody,
  type UpdateMilestoneRunBody,
} from '@solera/protocol'
import type { AgentRegistry } from '../agents/registry.js'
import { advanceCardOnLaunch } from '../cards/create.js'
import { ensureParentBranch, parentBranchOf } from '../cards/parent-branch.js'
import { createConversation } from '../conversations/create.js'
import { readGitStatus } from '../git.js'
import type { AppContext } from '../http/context.js'
import { badRequest, conflict } from '../http/errors.js'
import type { Notifications } from '../notifications/dispatcher.js'
import type { SessionManager } from '../sessions/session-manager.js'
import { inheritedConfig } from '../conversations/config-inheritance.js'
import { createWorktree } from '../worktrees/create.js'
import { deriveStatus, layerCards, type DerivedStatus } from './graph.js'

/** Le pilotage relit ses jalons à ce rythme : assez pour enchaîner sans qu'on attende. */
const POLL_MS = 2_000

/** Au-delà, un lancement resté en plan est réputé interrompu par un redémarrage. */
const STALE_LAUNCH_MS = 5 * 60_000

/** Ce que ce module attend de l'aiguillage des notifications. */
export type MilestoneNotifier = Pick<Notifications, 'dispatch'>

/** Pourquoi une carte attend, en clair, pour la note et la notification. */
const BLOCK_WORDS: Record<MilestoneBlockReason, string> = {
  to_clarify: 'elle est « à préciser » : sa session attend tes réponses',
  awaiting_input: 'sa session attend une permission ou une réponse',
  error: 'sa session est en erreur',
  interrupted: 'sa session a été interrompue',
  idle: 'sa session est au repos sans PR à fusionner',
  escalated: 'sa revue a atteint son plafond de tours, et tu tranches',
  merge_failed: 'sa fusion dans la branche du jalon a échoué',
  review_closed: 'sa revue est close sans fusion',
}

/**
 * Raisons déjà signalées par ailleurs : une demande de permission notifie d'elle-même,
 * et le plafond de revue dépose une décision.
 */
const ALREADY_NOTIFIED: ReadonlySet<MilestoneBlockReason> = new Set(['awaiting_input', 'escalated'])

interface Facts {
  run: MilestoneRunRow
  parent: CardRow
  project: ProjectRow
  rows: MilestoneRunCardRow[]
  cards: Map<string, CardRow>
  blockers: Map<string, MilestoneBlockerDto[]>
  layers: Map<string, number>
  sessions: Map<string, { id: string; title: string; status: ConversationStatus; worktreeName: string | null }>
  derived: Map<string, DerivedStatus>
}

/**
 * Le pilotage des jalons lancés (#72) : c'est le serveur qui conduit, pas une session.
 *
 * Chaque tour relit les jalons vivants, déduit l'état de leurs cartes, et lance celles
 * dont les bloqueurs sont terminés tant qu'il reste des places. Une carte bloquée
 * (« à préciser », session en erreur, revue au plafond…) libère sa place et n'arrête que
 * celles qui en dépendent ; le propriétaire du jalon est prévenu une fois par raison.
 *
 * Une carte se lance comme une personne l'aurait fait depuis le board : sa propre
 * branche, partie de celle du jalon (qui porte déjà le travail de ses bloqueurs), une
 * session rattachée à la carte, et la consigne de livraison de #68, qui finit par la
 * fusion dans la branche du jalon. La fin d'une carte, c'est cette fusion.
 *
 * Les limites de `start_session` (lancements par heure, profondeur de chaîne) ne
 * s'appliquent pas : elles gardent d'un agent qui s'emballe, et ici c'est une personne
 * qui a lancé, avec une concurrence bornée par `MAX_MILESTONE_CONCURRENCY`.
 */
export class MilestoneRuns {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null
  private logger: FastifyBaseLogger | null = null

  constructor(
    private readonly ctx: AppContext,
    private readonly sessions: SessionManager,
    private readonly registry: AgentRegistry,
    private readonly notifications?: MilestoneNotifier,
  ) {}

  start(logger: FastifyBaseLogger): void {
    this.logger = logger
    this.timer = setInterval(() => void this.sweep(), POLL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // --- l'aperçu et le lancement -----------------------------------------------------

  /** Ce que ferait le lancement de ce jalon, sans rien lancer. */
  plan(parent: CardRow): MilestonePlanDto {
    const children = this.children(parent.id)
    const childIds = children.map((child) => child.id)
    const withChildren = this.withChildren(childIds)
    const running = this.currentSessions(childIds)
    const { layers, cycle } = layerCards(childIds, this.edgesInto(childIds))
    const blockers = this.unfinishedBlockers(childIds)

    const planned: MilestonePlanCardDto[] = children.map((child) => {
      const excludedReason: MilestoneExcludedReason | null =
        child.acceptedAt === null
          ? 'not_accepted'
          : child.column === 'done' || child.column === 'abandoned'
            ? 'closed'
            : withChildren.has(child.id)
              ? 'has_children'
              : null
      const blockedBy = blockers.get(child.id) ?? []
      return {
        cardId: child.id,
        number: child.number,
        title: child.title,
        layer: layers.get(child.id) ?? -1,
        status: excludedReason ? 'excluded' : running.has(child.id) ? 'running' : blockedBy.length > 0 ? 'waiting' : 'ready',
        excludedReason,
        blockedBy,
      }
    })
    planned.sort((a, b) => a.layer - b.layer || a.number - b.number)
    const byId = new Map(children.map((child) => [child.id, child]))
    return {
      cardId: parent.id,
      cards: planned,
      cycle: cycle.map((id) => byId.get(id)!.number).sort((a, b) => a - b),
      branch: parentBranchOf(parent),
    }
  }

  /**
   * Lance un jalon : enregistre le pilotage et ses cartes, puis laisse le prochain tour
   * lancer ce qui est prêt. Refusé s'il en tourne déjà un, s'il y a un cycle de
   * blocages, ou s'il n'y a rien à lancer.
   */
  async launch(parent: CardRow, project: ProjectRow, userId: string, body: StartMilestoneBody): Promise<MilestoneRunDto> {
    if (this.activeRun(parent.id)) throw conflict('milestone_running', 'This milestone is already running.')
    if (!(await readGitStatus(project.workspacePath))) {
      throw badRequest('not_a_repository', 'This project is not a git repository.')
    }
    const plan = this.plan(parent)
    if (plan.cycle.length > 0) {
      throw conflict('milestone_cycle', 'Cards {cards} block each other.', { cards: plan.cycle.map((n) => `#${n}`).join(', ') })
    }
    const taken = plan.cards.filter((card) => card.status !== 'excluded')
    if (taken.length === 0) throw badRequest('milestone_empty', 'This milestone has no card left to launch.')

    const config = body.config ?? this.defaultConfig(project, userId)
    const running = this.currentSessions(taken.map((card) => card.cardId))
    const now = Date.now()
    const runId = randomUUID()
    writeTransaction(this.ctx.db, (tx) => {
      tx.insert(milestoneRuns)
        .values({
          id: runId,
          projectId: project.id,
          cardId: parent.id,
          state: 'running',
          concurrency: body.concurrency,
          config: JSON.stringify(config),
          startedBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      for (const card of taken) {
        // Une carte déjà au travail est suivie, pas relancée : sa session compte parmi
        // les places, et sa fin débloque les autres comme n'importe quelle carte.
        const session = running.get(card.cardId)
        const override = body.cards[card.cardId]
        tx.insert(milestoneRunCards)
          .values({
            runId,
            cardId: card.cardId,
            config: override ? JSON.stringify(override) : null,
            launch: session ? 'launched' : 'queued',
            conversationId: session?.id ?? null,
            launchedAt: session ? now : null,
            updatedAt: now,
          })
          .run()
      }
    })
    this.note(
      parent.id,
      userId,
      `Jalon lancé : ${taken.length} carte(s), ${body.concurrency} session(s) en parallèle au plus. Les cartes se fusionnent dans \`${plan.branch}\`.`,
    )
    // Le premier tour sans attendre : l'aperçu promettait des départs immédiats.
    void this.sweep()
    return this.read(this.ctx.db.select().from(milestoneRuns).where(eq(milestoneRuns.id, runId)).get()!)
  }

  /** Pause, reprise, arrêt, concurrence. */
  update(run: MilestoneRunRow, userId: string, body: UpdateMilestoneRunBody): MilestoneRunDto {
    if (run.state !== 'running' && run.state !== 'paused') {
      throw conflict('milestone_ended', 'This milestone run has ended.')
    }
    const now = Date.now()
    const patch: Partial<MilestoneRunRow> = { updatedAt: now }
    if (body.concurrency !== undefined) patch.concurrency = body.concurrency
    if (body.state !== undefined && body.state !== run.state) {
      patch.state = body.state
      if (body.state === 'stopped') patch.endedAt = now
      const words = { running: 'Jalon repris.', paused: 'Jalon en pause : plus aucun lancement, les sessions en cours continuent.', stopped: 'Jalon arrêté : les cartes qui attendaient ne partiront pas, les sessions en cours continuent.' }
      this.note(run.cardId, userId, words[body.state])
    }
    this.ctx.db.update(milestoneRuns).set(patch).where(eq(milestoneRuns.id, run.id)).run()
    if (patch.state === 'running') void this.sweep()
    return this.read(this.ctx.db.select().from(milestoneRuns).where(eq(milestoneRuns.id, run.id)).get()!)
  }

  /** Le pilotage vivant d'une parente, ou à défaut le dernier ; null si elle n'a jamais été lancée. */
  latestRun(parentId: string): MilestoneRunRow | null {
    return (
      this.activeRun(parentId) ??
      this.ctx.db.select().from(milestoneRuns).where(eq(milestoneRuns.cardId, parentId)).orderBy(desc(milestoneRuns.createdAt)).limit(1).get() ??
      null
    )
  }

  /** Les pilotages vivants d'un projet, en marche ou en pause, le plus ancien d'abord (#116). */
  activeRuns(projectId: string): MilestoneRunRow[] {
    return this.ctx.db
      .select()
      .from(milestoneRuns)
      .where(and(eq(milestoneRuns.projectId, projectId), inArray(milestoneRuns.state, ['running', 'paused'])))
      .orderBy(milestoneRuns.createdAt)
      .all()
  }

  read(run: MilestoneRunRow): MilestoneRunDto {
    const facts = this.gather(run)
    const config = parseAgentConfig(run.config)
    const list: MilestoneRunCardDto[] = facts
      ? facts.rows.map((row) => {
          const card = facts.cards.get(row.cardId)!
          const derived = facts.derived.get(row.cardId)!
          const session = facts.sessions.get(row.cardId) ?? null
          const own = row.config ? parseAgentConfig(row.config) : null
          return {
            cardId: row.cardId,
            number: card.number,
            title: card.title,
            layer: facts.layers.get(row.cardId) ?? -1,
            status: derived.status,
            blockReason: derived.blockReason,
            blockedBy: facts.blockers.get(row.cardId) ?? [],
            conversationId: session?.id ?? row.conversationId,
            conversationTitle: session?.title ?? null,
            conversationStatus: session?.status ?? null,
            worktreeName: session?.worktreeName ?? null,
            agent: own?.agent ?? null,
            model: own?.model ?? null,
            error: row.error,
          }
        })
      : []
    list.sort((a, b) => a.layer - b.layer || a.number - b.number)
    return {
      id: run.id,
      cardId: run.cardId,
      cardNumber: facts?.parent.number ?? 0,
      cardTitle: facts?.parent.title ?? '',
      state: run.state,
      concurrency: run.concurrency,
      agent: config.agent,
      model: config.model,
      branch: facts ? parentBranchOf(facts.parent) : '',
      busy: list.filter((card) => MILESTONE_BUSY_STATUSES.includes(card.status)).length,
      cards: list,
      createdAt: run.createdAt,
      endedAt: run.endedAt,
    }
  }

  // --- le tour ----------------------------------------------------------------------

  /**
   * Un tour. Un appel pendant qu'un tour tourne rend celui-ci plutôt que d'en empiler
   * un second : qui attend le tour (le lancement, un test) attend bien le travail fait.
   */
  sweep(now = Date.now()): Promise<void> {
    this.running ??= this.round(now).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async round(now: number): Promise<void> {
    // Un lancement resté en plan par un redémarrage repart en file.
    this.ctx.db
      .update(milestoneRunCards)
      .set({ launch: 'queued', updatedAt: now })
      .where(and(eq(milestoneRunCards.launch, 'launching'), lt(milestoneRunCards.updatedAt, now - STALE_LAUNCH_MS)))
      .run()

    const runs = this.ctx.db.select().from(milestoneRuns).where(inArray(milestoneRuns.state, ['running', 'paused'])).all()
    for (const run of runs) {
      try {
        await this.tick(run, now)
      } catch (err) {
        this.logger?.error({ err, run: run.id }, 'tour de jalon en echec')
      }
    }
  }

  private async tick(run: MilestoneRunRow, now: number): Promise<void> {
    this.adoptNewChildren(run, now)
    const facts = this.gather(run, now)
    if (!facts) {
      this.ctx.db.update(milestoneRuns).set({ state: 'stopped', endedAt: now, updatedAt: now }).where(eq(milestoneRuns.id, run.id)).run()
      return
    }

    // Une carte prise en main ailleurs (une session ouverte depuis le board) est adoptée.
    for (const row of facts.rows) {
      const session = facts.sessions.get(row.cardId)
      if (row.launch === 'queued' && session) {
        this.ctx.db
          .update(milestoneRunCards)
          .set({ launch: 'launched', conversationId: session.id, launchedAt: now, updatedAt: now })
          .where(and(eq(milestoneRunCards.runId, run.id), eq(milestoneRunCards.cardId, row.cardId)))
          .run()
        row.launch = 'launched'
        row.launchedAt = now
        facts.derived.set(row.cardId, this.derive(facts, row, now))
      }
    }

    await this.signalBlocks(facts)

    const statuses = [...facts.derived.values()].map((entry) => entry.status)
    if (statuses.every((status) => status === 'done' || status === 'abandoned')) {
      this.ctx.db.update(milestoneRuns).set({ state: 'finished', endedAt: now, updatedAt: now }).where(eq(milestoneRuns.id, run.id)).run()
      this.note(run.cardId, null, 'Jalon terminé : toutes ses cartes sont closes. Solera ouvre la PR de sa branche vers la branche par défaut.')
      return
    }
    if (run.state !== 'running') return

    let free = run.concurrency - statuses.filter((status) => MILESTONE_BUSY_STATUSES.includes(status)).length
    const ready = facts.rows
      .filter((row) => facts.derived.get(row.cardId)?.status === 'queued')
      .sort((a, b) => {
        const left = facts.cards.get(a.cardId)!
        const right = facts.cards.get(b.cardId)!
        return (facts.layers.get(a.cardId) ?? 0) - (facts.layers.get(b.cardId) ?? 0) || left.number - right.number
      })
    for (const row of ready) {
      if (free <= 0) break
      // Relu juste avant : une pause posée pendant un lancement lent doit l'emporter.
      const state = this.ctx.db.select({ state: milestoneRuns.state }).from(milestoneRuns).where(eq(milestoneRuns.id, run.id)).get()?.state
      if (state !== 'running') break
      const claimed = this.ctx.db
        .update(milestoneRunCards)
        .set({ launch: 'launching', updatedAt: Date.now() })
        .where(and(eq(milestoneRunCards.runId, run.id), eq(milestoneRunCards.cardId, row.cardId), eq(milestoneRunCards.launch, 'queued')))
        .run()
      if (claimed.changes === 0) continue
      free -= 1
      await this.launchCard(run, facts, row)
    }
  }

  /** Lance la session d'une carte, dans sa branche partie de celle du jalon. */
  private async launchCard(run: MilestoneRunRow, facts: Facts, row: MilestoneRunCardRow): Promise<void> {
    const card = facts.cards.get(row.cardId)!
    const where = and(eq(milestoneRunCards.runId, run.id), eq(milestoneRunCards.cardId, row.cardId))
    try {
      const base = await ensureParentBranch(this.ctx.db, facts.project, facts.parent)
      const worktreeId = await this.cardWorktree(facts.project, run.startedBy, card, base)
      const wanted = parseAgentConfig(row.config ?? run.config)
      const config = await this.registry.adapter(wanted.agent).resolveDefaults(wanted)
      const conversation = await createConversation(this.ctx.db, this.sessions, {
        projectId: facts.project.id,
        userId: run.startedBy,
        agent: config.agent,
        config,
        worktreeId,
        cardId: card.id,
        title: card.title,
        origin: null,
        firstMessage: {
          clientMessageId: randomUUID(),
          text: mission(card, facts.parent, base),
          attachments: [],
          mentions: [],
          skills: [],
        },
      })
      advanceCardOnLaunch(this.ctx, card.id, run.startedBy)
      const now = Date.now()
      this.ctx.db
        .update(milestoneRunCards)
        .set({ launch: 'launched', conversationId: conversation.id, launchedAt: now, error: null, updatedAt: now })
        .where(where)
        .run()
      this.sessions.statusBus.emit('lists', { conversationId: conversation.id })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      this.ctx.db.update(milestoneRunCards).set({ launch: 'failed', error: reason, updatedAt: Date.now() }).where(where).run()
      this.note(run.cardId, null, `La carte #${card.number} n'a pas pu être lancée : ${reason}`)
      await this.notify(facts, card, `n'a pas pu être lancée : ${reason}`)
      this.logger?.warn({ err, card: card.id }, 'carte de jalon non lancee')
    }
  }

  /**
   * L'arbre de la carte : celui qu'elle a déjà s'il n'a pas été retiré, sinon un neuf sur
   * sa branche (reprise telle quelle si elle existe, sinon partie de celle du jalon).
   */
  private async cardWorktree(project: ProjectRow, userId: string, card: CardRow, base: string): Promise<string> {
    const name = cardBranchName(card.number, card.title)
    const existing = this.ctx.db
      .select({ id: worktrees.id })
      .from(worktrees)
      .where(and(eq(worktrees.projectId, project.id), eq(worktrees.name, name), isNull(worktrees.removedAt)))
      .get()
    if (existing) return existing.id
    return (await createWorktree(this.ctx, project, userId, name, base)).id
  }

  /** Prévient une fois par raison quand une carte se bloque ; oublie la raison quand elle repart. */
  private async signalBlocks(facts: Facts): Promise<void> {
    for (const row of facts.rows) {
      const derived = facts.derived.get(row.cardId)!
      const reason = derived.status === 'blocked' ? derived.blockReason : null
      if (reason === row.notifiedBlock) continue
      this.ctx.db
        .update(milestoneRunCards)
        .set({ notifiedBlock: reason })
        .where(and(eq(milestoneRunCards.runId, facts.run.id), eq(milestoneRunCards.cardId, row.cardId)))
        .run()
      if (!reason) continue
      const card = facts.cards.get(row.cardId)!
      const waiting = this.dependents(facts, row.cardId)
      const tail = waiting.length > 0 ? ` ${waiting.map((n) => `#${n}`).join(', ')} l'attend(ent) ; les autres continuent.` : ' Aucune autre carte ne l’attend.'
      this.note(facts.run.cardId, null, `Carte #${card.number} bloquée : ${BLOCK_WORDS[reason]}.${tail}`)
      if (!ALREADY_NOTIFIED.has(reason)) await this.notify(facts, card, BLOCK_WORDS[reason], facts.sessions.get(row.cardId)?.id)
    }
  }

  /** Les cartes du jalon qui attendent celle-ci, directement ou non. */
  private dependents(facts: Facts, cardId: string): number[] {
    const inside = new Set(facts.rows.map((row) => row.cardId))
    const edges = this.edgesInto([...inside])
    const seen = new Set<string>()
    const stack = [cardId]
    while (stack.length > 0) {
      const id = stack.pop()!
      for (const edge of edges) {
        if (edge.sourceId === id && inside.has(edge.targetId) && !seen.has(edge.targetId)) {
          seen.add(edge.targetId)
          stack.push(edge.targetId)
        }
      }
    }
    return [...seen].map((id) => facts.cards.get(id)!.number).sort((a, b) => a - b)
  }

  private async notify(facts: Facts, card: CardRow, what: string, conversationId?: string): Promise<void> {
    await this.notifications
      ?.dispatch(facts.run.startedBy, {
        kind: 'decision',
        push: {
          title: `Jalon #${facts.parent.number} : carte #${card.number} bloquée`,
          body: `${card.title} : ${what}`,
          url: conversationId ? `/p/${facts.project.id}/c/${conversationId}` : `/p/${facts.project.id}/board`,
          tag: `milestone-${facts.run.id}-${card.id}`,
        },
      })
      .catch((err: unknown) => this.logger?.warn({ err }, 'notification de jalon en echec'))
  }

  /** Les enfants acceptées et ouvertes ajoutées après le lancement entrent dans la file. */
  private adoptNewChildren(run: MilestoneRunRow, now: number): void {
    const known = new Set(
      this.ctx.db.select({ cardId: milestoneRunCards.cardId }).from(milestoneRunCards).where(eq(milestoneRunCards.runId, run.id)).all().map((row) => row.cardId),
    )
    const fresh = this.children(run.cardId).filter(
      (child) => !known.has(child.id) && child.acceptedAt !== null && child.column !== 'done' && child.column !== 'abandoned',
    )
    if (fresh.length === 0) return
    const withChildren = this.withChildren(fresh.map((child) => child.id))
    for (const child of fresh) {
      if (withChildren.has(child.id)) continue
      this.ctx.db
        .insert(milestoneRunCards)
        .values({ runId: run.id, cardId: child.id, config: null, launch: 'queued', updatedAt: now })
        .onConflictDoNothing()
        .run()
    }
  }

  // --- lectures ---------------------------------------------------------------------

  /** Tout ce que le tour et la vue lisent d'un jalon ; null si la parente ou le projet ont disparu. */
  private gather(run: MilestoneRunRow, now = Date.now()): Facts | null {
    const parent = this.ctx.db.select().from(cards).where(eq(cards.id, run.cardId)).get()
    const project = this.ctx.db.select().from(projects).where(eq(projects.id, run.projectId)).get()
    if (!parent || !project) return null
    // Une carte sortie du jalon (rattachée ailleurs) n'en fait plus partie.
    const rows = this.ctx.db
      .select({ row: milestoneRunCards })
      .from(milestoneRunCards)
      .innerJoin(cards, eq(cards.id, milestoneRunCards.cardId))
      .where(and(eq(milestoneRunCards.runId, run.id), eq(cards.parentId, parent.id)))
      .all()
      .map(({ row }) => row)
    const ids = rows.map((row) => row.cardId)
    const cardRows = ids.length > 0 ? this.ctx.db.select().from(cards).where(inArray(cards.id, ids)).all() : []
    const facts: Facts = {
      run,
      parent,
      project,
      rows,
      cards: new Map(cardRows.map((card) => [card.id, card])),
      blockers: this.unfinishedBlockers(ids),
      layers: layerCards(ids, this.edgesInto(ids)).layers,
      sessions: this.currentSessions(ids),
      derived: new Map(),
    }
    const reviews = this.latestReviews(ids)
    for (const row of rows) facts.derived.set(row.cardId, this.derive(facts, row, now, reviews.get(row.cardId)))
    return facts
  }

  private derive(facts: Facts, row: MilestoneRunCardRow, now: number, review?: string): DerivedStatus {
    const card = facts.cards.get(row.cardId)!
    const session = facts.sessions.get(row.cardId)
    return deriveStatus(
      {
        column: card.column,
        toClarify: card.toClarifySince !== null,
        launch: row.launch,
        launchedAt: row.launchedAt,
        blocked: (facts.blockers.get(row.cardId) ?? []).length > 0,
        session: session ? { status: session.status } : null,
        review: review ?? this.latestReviews([row.cardId]).get(row.cardId) ?? null,
      },
      now,
    )
  }

  private children(parentId: string): CardRow[] {
    return this.ctx.db.select().from(cards).where(eq(cards.parentId, parentId)).all()
  }

  private withChildren(ids: string[]): Set<string> {
    if (ids.length === 0) return new Set()
    return new Set(
      this.ctx.db
        .select({ parentId: cards.parentId })
        .from(cards)
        .where(inArray(cards.parentId, ids))
        .all()
        .map((row) => row.parentId!),
    )
  }

  private edgesInto(ids: string[]): Array<{ sourceId: string; targetId: string }> {
    if (ids.length === 0) return []
    return this.ctx.db
      .select({ sourceId: cardBlocks.sourceId, targetId: cardBlocks.targetId })
      .from(cardBlocks)
      .where(inArray(cardBlocks.targetId, ids))
      .all()
  }

  /**
   * Les bloqueurs pas encore terminés de chaque carte, dans le jalon ou ailleurs. Un
   * bloqueur abandonné bloque toujours : son travail n'est pas dans la branche, et c'est
   * à une personne de retirer le lien si la carte peut s'en passer.
   */
  private unfinishedBlockers(ids: string[]): Map<string, MilestoneBlockerDto[]> {
    const result = new Map<string, MilestoneBlockerDto[]>()
    if (ids.length === 0) return result
    const inside = new Set(ids)
    const rows = this.ctx.db
      .select({ targetId: cardBlocks.targetId, sourceId: cards.id, number: cards.number, title: cards.title, column: cards.column, parentId: cards.parentId })
      .from(cardBlocks)
      .innerJoin(cards, eq(cards.id, cardBlocks.sourceId))
      .where(inArray(cardBlocks.targetId, ids))
      .all()
    for (const row of rows) {
      if (row.column === 'done') continue
      const list = result.get(row.targetId) ?? []
      list.push({ number: row.number, title: row.title, outside: !inside.has(row.sourceId), abandoned: row.column === 'abandoned' })
      result.set(row.targetId, list)
    }
    for (const list of result.values()) list.sort((a, b) => a.number - b.number)
    return result
  }

  /**
   * La session qui porte chaque carte : la plus récente qui n'est ni archivée, ni une
   * session de revue. C'est elle qui compte, même si une personne l'a ouverte à la main
   * pour reprendre la carte.
   */
  private currentSessions(ids: string[]): Facts['sessions'] {
    const result: Facts['sessions'] = new Map()
    if (ids.length === 0) return result
    const reviewers = new Set(
      this.ctx.db
        .select({ id: cardReviews.reviewerConversationId })
        .from(cardReviews)
        .where(inArray(cardReviews.cardId, ids))
        .all()
        .flatMap((row) => (row.id ? [row.id] : [])),
    )
    const rows = this.ctx.db
      .select({ id: conversations.id, cardId: conversations.cardId, title: conversations.title, status: conversations.status, worktreeName: worktrees.name })
      .from(conversations)
      .leftJoin(worktrees, eq(worktrees.id, conversations.worktreeId))
      .where(and(inArray(conversations.cardId, ids), isNull(conversations.archivedAt)))
      .orderBy(conversations.createdAt)
      .all()
    for (const row of rows) {
      if (!row.cardId || reviewers.has(row.id)) continue
      result.set(row.cardId, { id: row.id, title: row.title, status: row.status, worktreeName: row.worktreeName })
    }
    return result
  }

  /** L'état de la revue la plus récente de chaque carte. */
  private latestReviews(ids: string[]): Map<string, string> {
    const result = new Map<string, string>()
    if (ids.length === 0) return result
    const rows = this.ctx.db
      .select({ cardId: cardReviews.cardId, state: cardReviews.state })
      .from(cardReviews)
      .where(inArray(cardReviews.cardId, ids))
      .orderBy(cardReviews.updatedAt)
      .all()
    for (const row of rows) result.set(row.cardId, row.state)
    return result
  }

  private activeRun(parentId: string): MilestoneRunRow | null {
    return (
      this.ctx.db
        .select()
        .from(milestoneRuns)
        .where(and(eq(milestoneRuns.cardId, parentId), inArray(milestoneRuns.state, ['running', 'paused'])))
        .get() ?? null
    )
  }

  /** La configuration d'une session neuve dans ce projet : celle du projet, puis du compte. */
  private defaultConfig(project: ProjectRow, userId: string): AgentConfig {
    return inheritedConfig(this.ctx.db, { userId, projectId: project.id, agent: 'claude' })
  }

  private note(cardId: string, userId: string | null, body: string): void {
    this.ctx.db.insert(cardNotes).values({ id: randomUUID(), cardId, conversationId: null, userId, body, createdAt: Date.now() }).run()
  }
}

/**
 * Le premier message d'une carte lancée par son jalon : la phrase du board, puis ce
 * que la session ne peut pas deviner. La livraison (PR vers la branche du jalon, revue,
 * fusion) est dans son briefing, comme pour toute carte enfant.
 */
export function mission(card: CardRow, parent: CardRow, base: string): string {
  return [
    `Prends en charge la carte #${card.number} de ce projet.`,
    '',
    `Elle fait partie du jalon #${parent.number} « ${parent.title} », lancé par l'utilisateur : Solera en fait partir les cartes en parallèle, chacune dans son worktree, dans l'ordre de leurs liens « bloque ». Ton arbre part de \`${base}\`, qui contient déjà le travail des cartes qui bloquaient celle-ci ; d'autres sessions travaillent en même temps sur leurs propres branches.`,
    "Si quelque chose t'empêche d'avancer, dis-le et attends : seules les cartes qui dépendent de la tienne attendront avec toi.",
  ].join('\n')
}
