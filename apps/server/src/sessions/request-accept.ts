import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import {
  agentRequests,
  cardBlocks,
  cards,
  conversations,
  projects,
  sessionMessages,
  writeTransaction,
  type AgentRequestRow,
  type Db,
} from '@solera/db'
import type { CardCloseOutcome, CardColumn, CardDraft } from '@solera/protocol'
import { addCardBlock, removeCardBlock } from '../cards/blocks.js'
import { isCloseTarget, type CardClosure } from '../cards/close.js'
import { createDraftCards, type DraftCreation } from '../cards/drafts.js'
import { recordCardMove } from '../cards/moves.js'
import { resolveParent, writeCardParent } from '../cards/tree.js'
import type { Config } from '../config.js'
import type { EventLog } from '../events/event-log.js'
import {
  describeCardFilingOutcome,
  describeDraftOutcome,
  describeFilingOutcome,
  recheck,
  tellOutcome,
  type StaleReason,
} from './request-lifecycle.js'

/**
 * Ce qu'un accord fait d'une demande d'agent, qu'il vienne d'un clic ou du réglage
 * « Automatique » (#120, Q12).
 *
 * Un seul chemin pour les deux, et c'est le point : une demande appliquée d'office passe
 * par la même revérification (#119), écrit les mêmes lignes et attribue le geste à la même
 * personne — celle qui a réglé « Automatique » plutôt que celle qui a cliqué. Seuls
 * changent la marque `automatic` du journal, qui fait dire au fil « appliqué
 * automatiquement », et le message d'issue : l'agent l'apprend par le retour de son outil,
 * il n'a pas besoin d'en recevoir un second.
 *
 * Les routes gardent ce qui tient au clic : qui a le droit de cliquer, et le refus.
 */

export interface AcceptDeps {
  db: Db
  config: Config
  log: EventLog
  /** La clôture d'une carte (#69) ; sans elle, une proposition de clôture n'est pas applicable. */
  closure?: CardClosure
  /** Les échecs de clôture, qui n'arrêtent pas les suivantes. */
  warn?: (err: unknown, card: number) => void
}

export interface AcceptInput {
  /** La conversation dans le journal de laquelle la demande est apparue. */
  conversationId: string
  row: AgentRequestRow
  /** Au nom de qui le geste est écrit. */
  userId: string
  automatic: boolean
}

// --- move_conversation ---------------------------------------------------------------

export type FilingAcceptance =
  | { ok: true }
  | { ok: false; reason: StaleReason | 'project_not_found' }

/**
 * Accorde un déplacement de conversation. Rien ne bouge ici : l'accord pose la promesse
 * dans la ligne, et le balayage du daemon déplace dès que la conversation se tait.
 */
export function acceptFiling(
  deps: AcceptDeps,
  input: AcceptInput & {
    filing: { conversationTitle: string; projectId: string; projectName: string | null; fromProjectId?: string | null }
  },
): FilingAcceptance {
  const { db, log } = deps
  const { conversationId, row, filing, userId } = input
  const target = db.select({ title: conversations.title, userId: conversations.userId }).from(conversations).where(eq(conversations.id, conversationId)).get()
  const impossible = (reason: StaleReason | 'project_not_found'): FilingAcceptance => {
    db.update(agentRequests).set({ resolvedAt: Date.now() }).where(eq(agentRequests.id, row.id)).run()
    log.append(conversationId, {
      type: 'filing.resolved',
      requestId: row.id,
      decision: 'impossible',
      decidedBy: userId,
      reason,
      ...(input.automatic ? { automatic: true } : {}),
    })
    if (!input.automatic) {
      tellOutcome(db, row, describeFilingOutcome(target?.title ?? filing.conversationTitle, filing.projectName, 'impossible', reason))
    }
    return { ok: false, reason }
  }

  const stale = recheck(db, deps.config, row, filing.fromProjectId)
  if (stale) return impossible(stale)

  // Le projet de destination, lui, a pu disparaître. Ce qui reste du contrôle — un tour
  // en cours — est l'affaire du balayage, qui réessaie.
  const destination = db
    .select({ ownerId: projects.ownerId, visibility: projects.visibility })
    .from(projects)
    .where(eq(projects.id, filing.projectId))
    .get()
  if (!destination || (destination.ownerId !== userId && destination.visibility !== 'shared')) {
    return impossible('project_not_found')
  }

  db.update(agentRequests).set({ acceptedAt: Date.now() }).where(eq(agentRequests.id, row.id)).run()
  return { ok: true }
}

// --- request_card_change ---------------------------------------------------------------

export interface ProposedCardChange {
  cardId: string
  number: number
  fromColumn: CardColumn
  toColumn?: CardColumn | null
  close?: { abandon: { cardId: string }[] } | null
  parent?: { from?: { cardId: string } | null; to?: { cardId: string } | null } | null
  dueAt?: { from: number | null; to: number | null } | null
  blocks?: { cardId: string }[]
  unblocks?: { cardId: string }[]
}

export type CardFilingAcceptance =
  | { ok: true; applied: number[] }
  | { ok: false; reason: StaleReason | 'cards_gone' }

/**
 * Applique une proposition de changement de cartes, dans une transaction, au nom de
 * `userId`. Les lignes `card_moves` portent cette personne : le mouvement lui est
 * attribué, c'est le fond de la carte #54.
 */
export async function acceptCardFiling(
  deps: AcceptDeps,
  input: AcceptInput & { cards: ProposedCardChange[] },
): Promise<CardFilingAcceptance> {
  const { db, log, closure } = deps
  const { conversationId, row, userId } = input
  const requestId = row.id

  const close = (
    decision: 'impossible' | 'accepted',
    reason: string | null,
    moved: { number: number; fromColumn: CardColumn; toColumn: CardColumn }[],
    applied?: number[],
    closed?: CardCloseOutcome[],
  ) => {
    const now = Date.now()
    db.update(agentRequests)
      .set({ resolvedAt: now, ...(decision === 'accepted' ? { acceptedAt: now } : {}) })
      .where(and(eq(agentRequests.id, requestId), isNull(agentRequests.resolvedAt)))
      .run()
    log.append(conversationId, {
      type: 'card_filing.resolved',
      requestId,
      decision,
      decidedBy: userId,
      reason,
      moved,
      ...(applied ? { applied } : {}),
      ...(closed ? { closed } : {}),
      ...(input.automatic ? { automatic: true } : {}),
    })
    if (!input.automatic) {
      tellOutcome(db, row, describeCardFilingOutcome(decision, reason, applied, input.cards.length))
    }
  }

  // Le fil, l'option et le projet revérifiés (#119) : un fil rangé ailleurs depuis ferait
  // chercher les cartes dans le board d'un autre projet.
  const stale = recheck(db, deps.config, row)
  if (stale) {
    close('impossible', stale, [])
    return { ok: false, reason: stale }
  }

  // Relu à l'accord et non pris de la demande : entre le dépôt et maintenant, une carte a
  // pu être supprimée ou changée par quelqu'un.
  //
  // Le test porte sur la valeur **de départ** et non sur la valeur visée. Tester
  // l'arrivée ne retirait du lot que les cartes ayant déjà rejoint la colonne
  // proposée : une carte qu'une personne venait de ranger dans une *troisième*
  // colonne était quand même poussée là où l'agent la voulait, et la demande affichait
  // encore la colonne du dépôt. Le clic défaisait alors un choix humain plus récent que
  // la proposition — exactement ce que la famille `cardFiling` existe pour empêcher.
  //
  // Toute carte qui a changé depuis le dépôt sort donc du lot, quelle que soit sa
  // destination : sa colonne, et depuis #66 sa parente et son échéance quand la
  // demande les touche. Un lien « bloque » devenu impossible (la carte visée a disparu,
  // ou bloque désormais celle-ci) la retire aussi : l'accord ne pose rien à moitié.
  const projectId = row.projectId!
  const live = input.cards
    .map((proposed) => {
      const card = db
        .select()
        .from(cards)
        .where(and(eq(cards.id, proposed.cardId), eq(cards.projectId, projectId)))
        .get()
      if (!card) return null
      if ((proposed.toColumn || proposed.close) && card.column !== proposed.fromColumn) return null
      if (proposed.close && !closure) return null
      if (proposed.parent && card.parentId !== (proposed.parent.from?.cardId ?? null)) return null
      if (proposed.dueAt && card.dueAt !== proposed.dueAt.from) return null
      let parentId: string | null | undefined
      if (proposed.parent) {
        try {
          parentId = proposed.parent.to ? resolveParent(db, card, proposed.parent.to.cardId) : null
        } catch {
          return null
        }
      }
      for (const target of proposed.blocks ?? []) {
        const exists = db.select({ id: cards.id }).from(cards).where(and(eq(cards.id, target.cardId), eq(cards.projectId, projectId))).get()
        const reverse = db
          .select({ sourceId: cardBlocks.sourceId })
          .from(cardBlocks)
          .where(and(eq(cardBlocks.sourceId, target.cardId), eq(cardBlocks.targetId, card.id)))
          .get()
        if (!exists || reverse) return null
      }
      return { card, proposed, parentId }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  // Plus une seule carte applicable : il n'y a plus de proposition à accorder, et le dire
  // vaut mieux que d'écrire une acceptation qui n'a rien changé. La demande est résolue
  // quand même : elle n'attend plus rien et ne doit pas occuper la place de l'unique
  // demande en attente de la conversation.
  if (live.length === 0) {
    close('impossible', 'cards_gone', [])
    return { ok: false, reason: 'cards_gone' }
  }

  // Une seule transaction pour toute la liste : un lot à moitié écrit laisserait le
  // Journal raconter des changements qui n'ont pas tous eu lieu, et c'est exactement
  // ce que l'en-tête de `card_moves` interdit.
  const now = Date.now()
  const by = { userId }
  const moved: { number: number; fromColumn: CardColumn; toColumn: CardColumn }[] = []
  writeTransaction(db, (tx) => {
    for (const { card, proposed, parentId } of live) {
      if (parentId !== undefined) writeCardParent(tx, card, parentId, by)
      if (proposed.dueAt) tx.update(cards).set({ dueAt: proposed.dueAt.to, updatedAt: now }).where(eq(cards.id, card.id)).run()
      for (const target of proposed.blocks ?? []) {
        addCardBlock(tx, { projectId, sourceId: card.id, targetId: target.cardId, userId })
      }
      for (const target of proposed.unblocks ?? []) removeCardBlock(tx, { sourceId: card.id, targetId: target.cardId })
      if (proposed.toColumn) {
        // Relue après la parente : rattacher une carte peut avoir changé la colonne
        // d'une parente, jamais la sienne.
        tx.update(cards).set({ column: proposed.toColumn, updatedAt: now }).where(eq(cards.id, card.id)).run()
        recordCardMove(tx, { cardId: card.id, from: card.column, to: proposed.toColumn, ...by, at: now })
        moved.push({ number: card.number, fromColumn: card.column, toColumn: proposed.toColumn })
      }
    }
  })

  const applied = live.map(({ card }) => card.number)
  // Les clôtures après la transaction : elles parlent à git et à la forge, et prennent
  // quelques secondes. La demande est marquée résolue avant, pour qu'un second clic
  // pendant ce temps ne la rejoue pas.
  const closing = live.filter(({ proposed }) => proposed.close)
  if (closing.length === 0 || !closure) {
    close('accepted', null, moved, applied)
    return { ok: true, applied }
  }
  db.update(agentRequests).set({ resolvedAt: now, acceptedAt: now }).where(eq(agentRequests.id, requestId)).run()
  const projectRow = db.select().from(projects).where(eq(projects.id, projectId)).get()!
  const closed: CardCloseOutcome[] = []
  for (const { card, proposed } of closing) {
    const target = proposed.toColumn ?? card.column
    if (!isCloseTarget(target)) continue
    // Une clôture qui casse en route n'empêche ni les suivantes ni l'écriture du
    // résultat : la colonne est déjà posée, et le journal doit dire ce qui a eu lieu.
    try {
      closed.push(...(await closure.apply(projectRow, card.id, target, userId, proposed.close!.abandon.map((child) => child.cardId))))
    } catch (err) {
      deps.warn?.(err, card.number)
    }
  }
  close('accepted', null, moved, applied, closed)
  return { ok: true, applied }
}

// --- propose_cards -----------------------------------------------------------------------

export type DraftAcceptance =
  | ({ ok: true } & DraftCreation)
  | { ok: false; reason: StaleReason | 'already_decided' }

/**
 * Crée les cartes d'un brouillon (#70), tel que la personne l'a corrigé ou, en
 * « Automatique », tel que l'agent l'a déposé.
 *
 * Créé, le brouillon revient à la session en message (`cards`) : elle apprend les numéros
 * sans relire le board. En « Automatique », le retour de l'outil les lui donne déjà, et le
 * message, qui la relancerait, n'est pas écrit.
 */
export function acceptDraft(
  deps: AcceptDeps,
  input: AcceptInput & { projectId: string; draft: CardDraft },
): DraftAcceptance {
  const { db, log } = deps
  const { conversationId, row, userId, draft } = input

  const close = (
    decision: 'created' | 'impossible',
    outcome: DraftCreation & { draft?: CardDraft; reason?: string },
  ): boolean => {
    const now = Date.now()
    // Conditionnelle : deux clics qui se croisent ne créent pas deux fois.
    const closed = db
      .update(agentRequests)
      .set({ resolvedAt: now, ...(decision === 'created' ? { acceptedAt: now } : {}) })
      .where(and(eq(agentRequests.id, row.id), isNull(agentRequests.resolvedAt)))
      .run()
    if (closed.changes === 0) return false
    log.append(conversationId, {
      type: 'card_draft.resolved',
      requestId: row.id,
      decision,
      decidedBy: userId,
      ...outcome,
      ...(input.automatic ? { automatic: true } : {}),
    })
    return true
  }

  // Revérifié (#119) : un fil archivé ou rangé ailleurs depuis ne remplit plus le board
  // où le brouillon a été proposé.
  const stale = recheck(db, deps.config, row)
  if (stale) {
    if (!close('impossible', { parent: null, created: [], reason: stale })) return { ok: false, reason: 'already_decided' }
    if (!input.automatic) tellOutcome(db, row, describeDraftOutcome('impossible', stale))
    return { ok: false, reason: stale }
  }

  // La création et la clôture dans la même transaction : un échec de l'une défait
  // l'autre, et un double clic perd la course sur `resolved_at` sans rien créer.
  let created: DraftCreation
  try {
    created = writeTransaction(db, () => {
      const result = createDraftCards(db, { projectId: input.projectId, userId, conversationId, draft })
      if (!close('created', { ...result, draft })) throw new AlreadyDecided()
      if (!input.automatic) {
        db.insert(sessionMessages)
          .values({
            id: randomUUID(),
            projectId: input.projectId,
            fromConversationId: conversationId,
            toConversationId: conversationId,
            kind: 'cards',
            body: [
              'Ton brouillon de cartes a été validé et créé.',
              result.parent ? `Parente : #${result.parent.number} « ${result.parent.title} ».` : null,
              ...result.created.map((card) => `- #${card.number} « ${card.title} »`),
            ]
              .filter((line) => line !== null)
              .join('\n'),
            replyTo: row.id,
            createdAt: Date.now(),
          })
          .run()
      }
      return result
    })
  } catch (err) {
    if (err instanceof AlreadyDecided) return { ok: false, reason: 'already_decided' }
    throw err
  }
  return { ok: true, ...created }
}

class AlreadyDecided extends Error {}
