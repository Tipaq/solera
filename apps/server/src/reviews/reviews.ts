import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { and, eq, isNotNull, lt } from 'drizzle-orm'
import {
  agentRequests,
  cardNotes,
  cardReviews,
  cards,
  conversations,
  projects,
  sessionMessages,
  writeTransaction,
  type AgentRequestRow,
  type CardReviewRow,
  type ConversationRow,
  type Db,
  type ProjectRow,
} from '@solera/db'
import { formatSessionMessage, type AgentConfig, type AgentKind } from '@solera/protocol'
import { recordCardMove } from '../cards/moves.js'
import { parentBranchFor } from '../cards/parent-branch.js'
import { createConversation } from '../conversations/create.js'
import type { Decisions } from '../decisions/decisions.js'
import type { AppContext } from '../http/context.js'
import { Refusal } from '../sessions/refusal.js'
import type { SessionManager } from '../sessions/session-manager.js'
import { resolveConversationCwd } from '../workspace.js'
import { ForgeError, type Forge } from './forge.js'

const run = promisify(execFile)

/** Tours de revue avant qu'une personne tranche (#68, accordé par Tim le 2026-10-25). */
export const DEFAULT_MAX_ROUNDS = 3

/** Au-delà, une fusion marquée en cours est réputée interrompue par un redémarrage. */
const STALE_MERGE_MS = 5 * 60_000

/** Un verdict tient dans un message entre sessions, comme `MAX_PEER_MESSAGE_CHARS`. */
export const MAX_REVIEW_SUMMARY_CHARS = 4000

/** Les réponses proposées au plafond, relues par `submit` quand la revue reprend. */
export const ESCALATION_OPTIONS = {
  accept: 'Accepter en l’état',
  again: 'Un tour de plus',
  takeOver: 'Je reprends la main',
} as const

/** Ce que la revue demande au daemon : la configuration qu'aurait une session lancée. */
export type ReviewerConfig = (agent: AgentKind, project: ProjectRow, userId: string) => Promise<AgentConfig>

/**
 * La revue d'une PR de carte, en boucle avec la session qui l'a écrite (#68).
 *
 * 1. L'auteur pousse, ouvre sa PR et la signale (`request_review`). Solera lit la PR sur
 *    la forge, vérifie que c'est bien la branche de l'auteur et qu'elle est poussée
 *    jusqu'à son dernier commit, puis lance une session de revue dans le même arbre.
 * 2. La revue relit, lance les vérifications et rend son verdict (`submit_review`).
 *    `changes` repart à l'auteur en message ; `approve` range la carte « à vérifier ».
 * 3. L'auteur corrige, pousse et resignale : la même session de revue est réveillée,
 *    pour garder ce qu'elle a déjà lu. Un commit déjà relu ne relance rien.
 * 4. Au-delà de `max_rounds`, une décision part vers le propriétaire du projet, au nom
 *    de la revue, et c'est sa réponse qui dit si la boucle reprend.
 *
 * **Personne ne fusionne ici.** Le mode auto refuse `gh pr merge` aux sessions, et la
 * fusion d'une carte dans la branche de sa parente sera faite par le serveur (lot 2).
 *
 * Les textes rendus sont rédigés pour le modèle, comme le reste des outils.
 */
export class Reviews {
  constructor(
    private readonly ctx: AppContext,
    private readonly sessions: SessionManager,
    private readonly forge: Forge,
    private readonly reviewerConfig: ReviewerConfig,
    /** Sans elles, le plafond n'est signalé que par une note sur la carte. */
    private readonly decisions?: Decisions,
    /** Un jeton GitHub enregistré pour ce compte, passé à la forge s'il existe. */
    private readonly token?: (userId: string) => string | undefined,
  ) {}

  // --- request_review, par l'auteur ------------------------------------------------

  async request(requester: ConversationRow, project: ProjectRow, payload: Record<string, unknown>): Promise<string> {
    const ref = typeof payload.pr === 'number' ? String(payload.pr) : typeof payload.pr === 'string' ? payload.pr.trim() : ''
    if (!ref) throw new Refusal('Le paramètre `pr` est requis : le numéro ou l’URL de la PR que tu viens d’ouvrir.')

    if (reviewOf(this.ctx.db, requester.id)) {
      throw new Refusal('Refusé : cette session est la revue d’une PR, pas son auteure. Rends ton verdict avec submit_review.')
    }
    const card = requester.cardId
      ? this.ctx.db.select().from(cards).where(and(eq(cards.id, requester.cardId), eq(cards.projectId, project.id))).get()
      : undefined
    if (!card) {
      throw new Refusal(
        "Cette conversation n'est rattachée à aucune carte : la revue relit une PR au regard de la carte qu'elle traite. Rattache-la avec link_card, ou demande une relecture à l'utilisateur.",
      )
    }

    const cwd = resolveConversationCwd(this.ctx.db, requester)
    if (!cwd) throw new Refusal('Cette session n’a pas de répertoire de travail : il n’y a pas de branche à relire.')
    const branch = await gitLine(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])
    const localHead = await gitLine(cwd, ['rev-parse', 'HEAD'])
    if (!branch || !localHead) {
      throw new Refusal('Ton arbre n’est sur aucune branche (HEAD détachée, ou pas un dépôt) : la revue relit une branche.')
    }

    let pr
    try {
      pr = await this.forge.readPullRequest(cwd, ref, this.token?.(requester.userId))
    } catch (err) {
      if (err instanceof ForgeError) throw new Refusal(err.message)
      throw err
    }
    if (pr.state !== 'OPEN') {
      throw new Refusal(`La PR #${pr.number} est ${pr.state === 'MERGED' ? 'déjà fusionnée' : 'fermée'} : il n'y a rien à relire.`)
    }
    if (pr.head !== branch) {
      throw new Refusal(
        `La PR #${pr.number} propose la branche « ${pr.head} », et ton arbre est sur « ${branch} » : la revue relirait autre chose que ton travail. Signale la PR de ta branche.`,
      )
    }
    if (pr.headSha !== localHead) {
      throw new Refusal(
        `Ta branche n'est pas poussée jusqu'à ton dernier commit (la PR s'arrête à ${pr.headSha.slice(0, 8)}, ton arbre est à ${localHead.slice(0, 8)}). Pousse, puis rappelle request_review.`,
      )
    }
    // Une carte enfant se fusionne dans la branche de sa parente, jamais directement dans
    // la branche par défaut : c'est la parente qui y part, d'un geste de l'utilisateur.
    let expected: string | null
    try {
      expected = await parentBranchFor(this.ctx.db, project, card.id)
    } catch (err) {
      throw new Refusal(err instanceof Error ? err.message : String(err))
    }
    if (expected && pr.base !== expected) {
      throw new Refusal(
        `La carte #${card.number} appartient à une carte parente : sa PR doit viser la branche \`${expected}\`, et la #${pr.number} vise \`${pr.base}\`. Change sa base (\`gh pr edit ${pr.number} --base ${expected}\`), rebase ta branche dessus si besoin, pousse, puis rappelle request_review.`,
      )
    }
    const dirty = await gitLine(cwd, ['status', '--porcelain', '--untracked-files=no'])
    if (dirty) {
      throw new Refusal(
        'Ton arbre a des modifications non commitées : la revue y lance les vérifications, et elle relirait autre chose que la PR. Commite et pousse, ou mets-les de côté, puis rappelle request_review.',
      )
    }

    const now = Date.now()
    const existing = this.ctx.db
      .select()
      .from(cardReviews)
      .where(and(eq(cardReviews.projectId, project.id), eq(cardReviews.prNumber, pr.number)))
      .get()

    if (!existing) {
      const id = randomUUID()
      this.ctx.db
        .insert(cardReviews)
        .values({
          id,
          projectId: project.id,
          cardId: card.id,
          authorConversationId: requester.id,
          prNumber: pr.number,
          prUrl: pr.url,
          branch: pr.head,
          base: pr.base,
          headSha: pr.headSha,
          round: 1,
          maxRounds: DEFAULT_MAX_ROUNDS,
          state: 'reviewing',
          createdAt: now,
          updatedAt: now,
        })
        .run()
      let reviewer: ConversationRow
      try {
        reviewer = await this.launchReviewer(id, requester, project, card)
      } catch (err) {
        // Pas de ligne orpheline : un nouvel appel doit pouvoir relancer la revue.
        this.ctx.db.delete(cardReviews).where(eq(cardReviews.id, id)).run()
        throw err
      }
      this.note(card.id, requester.id, `PR #${pr.number} ouverte (${pr.url}), \`${pr.head}\` → \`${pr.base}\` : revue lancée (tour 1 sur ${DEFAULT_MAX_ROUNDS}).`)
      return [
        `Revue lancée sur la PR #${pr.number} (\`${pr.head}\` → \`${pr.base}\`), tour 1 sur ${DEFAULT_MAX_ROUNDS} : session « ${reviewer.title} », id ${reviewer.id}.`,
        "Elle travaille dans ton arbre : n'y modifie rien tant qu'elle relit. Termine ton tour ; son verdict t'arrivera en message.",
        'Ne fusionne pas la PR toi-même.',
      ].join('\n')
    }

    if (existing.authorConversationId !== requester.id) {
      throw new Refusal(`La PR #${pr.number} a été signalée par une autre session : c'est elle qui en suit la revue.`)
    }
    if (existing.state === 'escalated') {
      throw new Refusal(
        `La revue de la PR #${pr.number} a atteint son plafond de ${existing.maxRounds} tours, et l'utilisateur tranche. Attends sa réponse ; elle repassera par la revue.`,
      )
    }
    if (existing.state === 'closed') {
      throw new Refusal(`La revue de la PR #${pr.number} est close : il n'y a plus rien à relire.`)
    }
    if (existing.state === 'to_merge' || existing.state === 'merging' || existing.state === 'merged') {
      throw new Refusal(
        `La PR #${pr.number} est au vert et Solera la fusionne dans \`${existing.base}\` dès que ta session est au repos : n'y pousse plus rien. Termine ton tour.`,
      )
    }
    if (existing.state === 'reviewing') {
      throw new Refusal(
        `La revue de la PR #${pr.number} est déjà en cours (tour ${existing.round}). Termine ton tour : son verdict t'arrivera en message, et tes commits poussés depuis seront relus au tour suivant.`,
      )
    }
    if (pr.headSha === existing.reviewedSha) {
      throw new Refusal(
        `Le commit ${pr.headSha.slice(0, 8)} a déjà été relu : rien n'a bougé depuis le dernier verdict. Corrige, commite, pousse, puis rappelle request_review.`,
      )
    }

    const round = existing.round + 1
    this.ctx.db
      .update(cardReviews)
      .set({ headSha: pr.headSha, round, state: 'reviewing', updatedAt: now })
      .where(eq(cardReviews.id, existing.id))
      .run()
    if (existing.reviewerConversationId) {
      this.send(project.id, requester, existing.reviewerConversationId, [
        `Nouveau tour de revue sur la PR #${pr.number} : tour ${round} sur ${existing.maxRounds}.`,
        `La branche \`${pr.head}\` est maintenant à \`${pr.headSha}\` (relu au tour précédent : \`${existing.reviewedSha?.slice(0, 8) ?? '?'}\`).`,
        `Relis ce qui a changé depuis (\`git diff ${existing.reviewedSha ?? `origin/${pr.base}`}..HEAD\`), vérifie que tes demandes sont traitées, relance les vérifications, puis rends ton verdict avec submit_review.`,
      ].join('\n'))
    }
    this.note(card.id, requester.id, `PR #${pr.number} : nouveau tour de revue (${round} sur ${existing.maxRounds}), à \`${pr.headSha.slice(0, 8)}\`.`)
    return [
      `Revue relancée sur la PR #${pr.number}, tour ${round} sur ${existing.maxRounds}.`,
      "Termine ton tour ; le verdict t'arrivera en message. N'écris rien dans l'arbre tant qu'elle relit.",
    ].join('\n')
  }

  // --- submit_review, par la revue -------------------------------------------------

  submit(requester: ConversationRow, project: ProjectRow, payload: Record<string, unknown>): string {
    const review = reviewOf(this.ctx.db, requester.id)
    if (!review) {
      throw new Refusal("Cette session n'est la revue d'aucune PR : submit_review sert à la session que Solera lance pour relire.")
    }
    const verdict = payload.verdict
    if (verdict !== 'approve' && verdict !== 'changes') {
      throw new Refusal('Le paramètre `verdict` vaut `approve` ou `changes`.')
    }
    const summary = typeof payload.summary === 'string' ? payload.summary.trim() : ''
    if (!summary) throw new Refusal('Le paramètre `summary` est requis : ce que tu as relu, et pour `changes`, ce que l’auteur doit corriger.')
    if (summary.length > MAX_REVIEW_SUMMARY_CHARS) {
      throw new Refusal(
        `Résumé trop long (${summary.length} caractères, ${MAX_REVIEW_SUMMARY_CHARS} au plus) : le détail va dans tes commentaires sur la PR.`,
      )
    }

    let maxRounds = review.maxRounds
    if (review.state === 'escalated') {
      const answer = this.escalationAnswer(review)
      if (answer === null) {
        throw new Refusal("L'utilisateur n'a pas encore tranché : attends sa réponse, elle t'arrivera en message.")
      }
      if (answer === ESCALATION_OPTIONS.takeOver) {
        throw new Refusal("L'utilisateur reprend la main sur cette PR : il n'y a plus de verdict à rendre. Termine ton tour.")
      }
      if (verdict === 'changes') {
        if (answer !== ESCALATION_OPTIONS.again) {
          throw new Refusal(`L'utilisateur a répondu « ${answer} » : rends \`approve\`, ou laisse-le trancher.`)
        }
        maxRounds = review.maxRounds + 1
      }
    } else if (review.state !== 'reviewing') {
      throw new Refusal(
        `Aucun tour de revue n'est en cours sur la PR #${review.prNumber} (${review.state === 'changes' ? "l'auteur corrige" : review.state === 'approved' ? 'déjà au vert' : 'revue close'}). Termine ton tour : un nouveau commit te reviendra en message.`,
      )
    }

    const author = this.ctx.db.select().from(conversations).where(eq(conversations.id, review.authorConversationId)).get()
    const now = Date.now()
    const tag = `PR #${review.prNumber}`

    if (verdict === 'approve' && this.mergesIntoParent(review)) {
      this.ctx.db
        .update(cardReviews)
        .set({ state: 'to_merge', reviewedSha: review.headSha, updatedAt: now })
        .where(eq(cardReviews.id, review.id))
        .run()
      this.note(review.cardId, requester.id, `Revue au vert, ${tag} au tour ${review.round} : Solera la fusionne dans \`${review.base}\`.\n\n${summary}`)
      if (author) {
        this.send(project.id, requester, author.id, [
          `Revue au vert : ${tag} acceptée au tour ${review.round}.`,
          summary,
          `Solera la fusionne en squash dans \`${review.base}\`, la branche de la carte parente, dès que ta session est au repos, puis passe la carte en terminé. N'y pousse plus rien et ne la fusionne pas toi-même. Laisse une note sur la carte, puis termine ton tour.`,
        ].join('\n\n'))
      }
      return `Verdict enregistré : ${tag} au vert. Solera la fusionne dans \`${review.base}\` dès que la session auteure est au repos. Termine ton tour.`
    }

    if (verdict === 'approve') {
      this.ctx.db
        .update(cardReviews)
        .set({ state: 'approved', reviewedSha: review.headSha, updatedAt: now })
        .where(eq(cardReviews.id, review.id))
        .run()
      this.moveCardToReview(review.cardId, requester)
      this.note(review.cardId, requester.id, `Revue au vert, ${tag} au tour ${review.round}.\n\n${summary}`)
      if (author) {
        this.send(project.id, requester, author.id, [
          `Revue au vert : ${tag} acceptée au tour ${review.round}.`,
          summary,
          "La carte passe « à vérifier ». Ne fusionne pas la PR toi-même : la fusion n'est pas le geste d'une session. Laisse une note sur la carte, puis termine ton tour.",
        ].join('\n\n'))
      }
      return `Verdict enregistré : ${tag} au vert. La session auteure est prévenue et la carte passe « à vérifier ». Termine ton tour.`
    }

    if (review.round >= maxRounds) {
      const escalated = this.escalate(review, requester, project, summary)
      this.ctx.db
        .update(cardReviews)
        .set({ state: 'escalated', reviewedSha: review.headSha, decisionId: escalated, updatedAt: now })
        .where(eq(cardReviews.id, review.id))
        .run()
      this.note(review.cardId, requester.id, `Revue : ${tag} a atteint le plafond de ${maxRounds} tours avec des corrections encore demandées. L'utilisateur tranche.\n\n${summary}`)
      if (author) {
        this.send(project.id, requester, author.id, [
          `Revue : ${tag} a encore des corrections demandées après ${maxRounds} tours, le plafond. L'utilisateur tranche ; ne corrige pas tant qu'il n'a pas répondu.`,
          summary,
          'Termine ton tour : la suite te reviendra en message.',
        ].join('\n\n'))
      }
      return escalated
        ? `Plafond de ${maxRounds} tours atteint : une décision est déposée en ton nom pour l'utilisateur (« Accepter en l’état », « Un tour de plus », « Je reprends la main »). Sa réponse t'arrivera en message : « Accepter » → submit_review avec \`approve\` ; « Un tour de plus » → submit_review avec \`changes\` et ce qui reste à corriger ; « Je reprends la main » → plus rien à faire. Termine ton tour.`
        : `Plafond de ${maxRounds} tours atteint. Les décisions sont désactivées sur cette instance : une note sur la carte le dit à l'utilisateur, qui reprend la main. Termine ton tour.`
    }

    this.ctx.db
      .update(cardReviews)
      .set({ state: 'changes', reviewedSha: review.headSha, maxRounds, updatedAt: now })
      .where(eq(cardReviews.id, review.id))
      .run()
    this.note(review.cardId, requester.id, `Revue : corrections demandées sur ${tag} (tour ${review.round} sur ${maxRounds}).\n\n${summary}`)
    if (author) {
      this.send(project.id, requester, author.id, [
        `Revue : corrections demandées sur ${tag} (tour ${review.round} sur ${maxRounds}).`,
        summary,
        `Corrige, commite et pousse, puis rappelle request_review avec la même PR : la revue repartira sur ton nouveau commit. Si tu n'es pas d'accord avec une demande, dis-le à la revue avec send_session_message (to="${requester.id}") plutôt que de l'ignorer.`,
      ].join('\n\n'))
    }
    return `Verdict enregistré : corrections demandées sur ${tag}, tour ${review.round} sur ${maxRounds}. La session auteure les reçoit en message ; son prochain commit te reviendra. Termine ton tour.`
  }

  // --- la fusion dans la branche de la parente --------------------------------------

  /**
   * Fusionne les PR au vert qui visent la branche de leur carte parente, une fois leur
   * session auteure au repos : fusionner sous une session qui travaille encore, c'est
   * livrer ce qu'elle n'a pas fini de dire. Appelé par le balayage des demandes.
   *
   * En squash, au commit relu (`--match-head-commit`) : un commit poussé après le verdict
   * fait échouer la fusion plutôt que de passer sans revue. Et sans supprimer la branche,
   * dont le worktree porte encore la session.
   */
  async mergeReady(): Promise<void> {
    // Un `merging` resté en plan par un redémarrage repasse en file : relire la PR dira
    // s'il avait abouti.
    this.ctx.db
      .update(cardReviews)
      .set({ state: 'to_merge' })
      .where(and(eq(cardReviews.state, 'merging'), lt(cardReviews.updatedAt, Date.now() - STALE_MERGE_MS)))
      .run()

    const ready = this.ctx.db
      .select({ review: cardReviews, status: conversations.status })
      .from(cardReviews)
      .innerJoin(conversations, eq(conversations.id, cardReviews.authorConversationId))
      .where(eq(cardReviews.state, 'to_merge'))
      .all()
    for (const { review, status } of ready) {
      if (status === 'running' || status === 'awaiting_input') continue
      const claimed = this.ctx.db
        .update(cardReviews)
        .set({ state: 'merging', updatedAt: Date.now() })
        .where(and(eq(cardReviews.id, review.id), eq(cardReviews.state, 'to_merge')))
        .run()
      if (claimed.changes === 0) continue
      await this.merge(review)
    }
  }

  private async merge(review: CardReviewRow): Promise<void> {
    const project = this.ctx.db.select().from(projects).where(eq(projects.id, review.projectId)).get()
    const author = this.ctx.db.select().from(conversations).where(eq(conversations.id, review.authorConversationId)).get()
    if (!project || !author) {
      this.ctx.db.update(cardReviews).set({ state: 'closed', updatedAt: Date.now() }).where(eq(cardReviews.id, review.id)).run()
      return
    }
    // Les messages viennent de la revue, l'interlocutrice de l'auteure dans cette boucle.
    const sender =
      (review.reviewerConversationId
        ? this.ctx.db.select().from(conversations).where(eq(conversations.id, review.reviewerConversationId)).get()
        : undefined) ?? author
    const token = this.token?.(author.userId)
    const tag = `PR #${review.prNumber}`
    try {
      const pr = await this.forge.readPullRequest(project.workspacePath, String(review.prNumber), token)
      if (pr.state === 'CLOSED') throw new ForgeError(`${tag} a été fermée sans être fusionnée.`)
      if (pr.state === 'OPEN') {
        if (pr.base !== review.base) throw new ForgeError(`${tag} vise désormais \`${pr.base}\`, et non \`${review.base}\`.`)
        await this.forge.mergePullRequest(project.workspacePath, review.prNumber, review.reviewedSha ?? review.headSha, token)
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      this.ctx.db.update(cardReviews).set({ state: 'merge_failed', updatedAt: Date.now() }).where(eq(cardReviews.id, review.id)).run()
      this.note(review.cardId, sender.id, `Fusion de ${tag} dans \`${review.base}\` impossible : ${reason}`)
      this.send(project.id, sender, author.id, [
        `Solera n'a pas pu fusionner ${tag} dans \`${review.base}\` : ${reason}`,
        "S'il faut rebaser ou corriger, fais-le, pousse, puis rappelle request_review : un nouveau commit repasse par la revue. Sinon, dis-le à l'utilisateur.",
      ].join('\n\n'))
      return
    }

    const now = Date.now()
    this.ctx.db.update(cardReviews).set({ state: 'merged', updatedAt: now }).where(eq(cardReviews.id, review.id)).run()
    writeTransaction(this.ctx.db, (tx) => {
      const card = tx.select({ column: cards.column }).from(cards).where(eq(cards.id, review.cardId)).get()
      if (!card || card.column === 'done' || card.column === 'abandoned') return
      tx.update(cards).set({ column: 'done', updatedAt: now }).where(eq(cards.id, review.cardId)).run()
      recordCardMove(tx, { cardId: review.cardId, from: card.column, to: 'done', userId: null, at: now })
    })
    this.note(review.cardId, sender.id, `${tag} fusionnée en squash dans \`${review.base}\`, la branche de la carte parente : carte terminée. La branche \`${review.branch}\` et son worktree restent en place.`)
    this.send(project.id, sender, author.id, [
      `${tag} est fusionnée dans \`${review.base}\`, et la carte est terminée.`,
      "Ta branche et ton worktree restent en place jusqu'à la clôture de la carte : n'y pousse plus rien pour elle. Si le résultat est vérifié, propose de la clore avec `request_card_change` et `close: true` ; sinon vérifie-le d'abord. Puis termine ton tour.",
    ].join('\n\n'))
  }

  /** La PR vise-t-elle la branche de la parente de sa carte ? Alors le vert fusionne. */
  private mergesIntoParent(review: CardReviewRow): boolean {
    const card = this.ctx.db.select({ parentId: cards.parentId }).from(cards).where(eq(cards.id, review.cardId)).get()
    if (!card?.parentId) return false
    const parent = this.ctx.db.select({ branch: cards.branch }).from(cards).where(eq(cards.id, card.parentId)).get()
    return parent?.branch === review.base
  }

  // --- le reste -------------------------------------------------------------------

  /**
   * Lance la session de revue, dans l'arbre de l'auteur et sur la même carte.
   *
   * Créée sans premier message, rattachée à la revue, puis lancée : son serveur MCP et
   * son briefing ne naissent qu'avec le premier message, et c'est en lisant la ligne
   * qu'ils lui ouvrent `submit_review` et la savent relectrice.
   */
  private async launchReviewer(
    reviewId: string,
    author: ConversationRow,
    project: ProjectRow,
    card: { id: string; number: number; title: string },
  ): Promise<ConversationRow> {
    const review = this.ctx.db.select().from(cardReviews).where(eq(cardReviews.id, reviewId)).get()!
    const config = await this.reviewerConfig(author.agent, project, author.userId)
    const row = await createConversation(this.ctx.db, this.sessions, {
      projectId: project.id,
      userId: author.userId,
      agent: author.agent,
      config,
      worktreeId: author.worktreeId,
      cardId: card.id,
      title: `Revue de la PR #${review.prNumber} (#${card.number})`,
      origin: null,
    })
    this.ctx.db.update(cardReviews).set({ reviewerConversationId: row.id }).where(eq(cardReviews.id, reviewId)).run()
    try {
      await this.sessions.sendMessage(
        row.id,
        randomUUID(),
        formatSessionMessage({
          kind: 'launch',
          from: author.id,
          title: author.title,
          agent: author.agent,
          messageId: reviewId,
          body: reviewerMission(review, card),
        }),
        [],
        [],
        [],
      )
    } catch (err) {
      this.ctx.db.delete(conversations).where(eq(conversations.id, row.id)).run()
      throw err
    }
    return row
  }

  /** La décision du plafond, déposée au nom de la revue ; son id, ou null sans décisions. */
  private escalate(review: CardReviewRow, reviewer: ConversationRow, project: ProjectRow, summary: string): string | null {
    if (!this.decisions || !this.ctx.config.mcp.decisions) return null
    const id = randomUUID()
    const payload = {
      question: `PR #${review.prNumber} : ${review.maxRounds} tours de revue, et des corrections restent demandées. Que faire ?`,
      context: [`[PR #${review.prNumber}](${review.prUrl}), \`${review.branch}\` → \`${review.base}\`.`, '', '**Dernier verdict de la revue :**', '', summary].join('\n'),
      options: [ESCALATION_OPTIONS.accept, ESCALATION_OPTIONS.again, ESCALATION_OPTIONS.takeOver],
    }
    this.ctx.db
      .insert(agentRequests)
      .values({ id, projectId: project.id, conversationId: reviewer.id, kind: 'request_decision', payload: JSON.stringify(payload), createdAt: Date.now() })
      .run()
    const request = this.ctx.db.select().from(agentRequests).where(eq(agentRequests.id, id)).get() as AgentRequestRow
    const deposit = this.decisions.request(request, reviewer, project, payload)
    this.ctx.db
      .update(agentRequests)
      .set({ settledAt: Date.now(), result: deposit.text, isError: false })
      .where(eq(agentRequests.id, id))
      .run()
    deposit.announce()
    return id
  }

  /** L'option retenue au plafond, ou null tant que personne n'a tranché. */
  private escalationAnswer(review: CardReviewRow): string | null {
    if (!review.decisionId) return null
    const row = this.ctx.db
      .select({ answer: agentRequests.answer })
      .from(agentRequests)
      .where(and(eq(agentRequests.id, review.decisionId), isNotNull(agentRequests.resolvedAt)))
      .get()
    if (!row?.answer) return null
    const answer = JSON.parse(row.answer) as { option?: string; text?: string; by?: string }
    if (answer.by === 'withdrawn' || answer.by === 'expired') return ESCALATION_OPTIONS.takeOver
    // Une réponse libre se lit comme une consigne de plus : la revue peut conclure dans
    // un sens ou dans l'autre, à sa lumière.
    return answer.option ?? ESCALATION_OPTIONS.again
  }

  /** « À vérifier » au vert, depuis « en cours » seulement : un autre rang est un choix. */
  private moveCardToReview(cardId: string, reviewer: ConversationRow): void {
    const now = Date.now()
    writeTransaction(this.ctx.db, (tx) => {
      const moved = tx
        .update(cards)
        .set({ column: 'review', updatedAt: now })
        .where(and(eq(cards.id, cardId), eq(cards.column, 'in_progress')))
        .run()
      if (moved.changes === 0) return
      recordCardMove(tx, { cardId, from: 'in_progress', to: 'review', userId: null, conversationId: reviewer.id, at: now })
    })
  }

  private send(projectId: string, from: ConversationRow, to: string, body: string): void {
    this.ctx.db
      .insert(sessionMessages)
      .values({
        id: randomUUID(),
        projectId,
        fromConversationId: from.id,
        toConversationId: to,
        kind: 'message',
        body,
        createdAt: Date.now(),
      })
      .run()
  }

  private note(cardId: string, conversationId: string, body: string): void {
    this.ctx.db
      .insert(cardNotes)
      .values({ id: randomUUID(), cardId, conversationId, userId: null, body, createdAt: Date.now() })
      .run()
  }
}

/** La revue que cette conversation mène, si elle en mène une. */
export function reviewOf(db: Db, conversationId: string): CardReviewRow | undefined {
  if (!conversationId) return undefined
  return db.select().from(cardReviews).where(eq(cardReviews.reviewerConversationId, conversationId)).get()
}

/** La mission de la session de revue, au premier tour. */
function reviewerMission(review: CardReviewRow, card: { number: number; title: string }): string {
  return [
    `Relis la PR #${review.prNumber} (${review.prUrl}) de la carte #${card.number} « ${card.title} » : la branche \`${review.branch}\`, vers \`${review.base}\`. Tu es la revue, pas l'auteure, et tu travailles dans son arbre : **n'y modifie, n'y commite et n'y pousse rien.**`,
    '',
    `1. Lis la carte avec \`read_card\` (${card.number}) : c'est elle qui dit ce que la PR doit faire.`,
    `2. \`git fetch origin\`, puis lis \`git diff origin/${review.base}...HEAD\` et \`git log origin/${review.base}..HEAD\`.`,
    `3. Lance les vérifications que les consignes du dépôt prévoient (AGENTS.md, CLAUDE.md : typecheck, lint, tests). Aucune CI ne les joue à ta place.`,
    `4. Invoque la skill \`solera:code-review\` sur \`origin/${review.base}...HEAD\`, sur ses deux axes : les standards du dépôt et la spec de la carte. Vérifie aussi les cas limites.`,
    `5. Si tu le peux, pose tes remarques sur la PR (\`gh pr review ${review.prNumber} --comment\`). N'approuve pas et ne fusionne pas sur GitHub.`,
    `6. Rends ton verdict avec \`submit_review\` : \`approve\` s'il ne reste rien de bloquant, \`changes\` sinon, avec un résumé que l'auteure peut suivre sans te relire (quoi corriger, où, pourquoi). Un détail de style ne justifie pas un tour de plus.`,
    '',
    `Puis termine ton tour. Si l'auteure corrige, son nouveau commit te reviendra en message pour le tour suivant. Plafond : ${review.maxRounds} tours, au-delà l'utilisateur tranche.`,
  ].join('\n')
}

async function gitLine(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 10_000 })
    return stdout.trim()
  } catch {
    return ''
  }
}
