import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { conversationHandoffs, conversations, type ConversationRow, type Db } from '@solera/db'
import type { AgentConfig, AgentKind } from '@solera/protocol'
import type { OutgoingAttachment } from '../agents/types.js'
import type { SessionManager } from '../sessions/session-manager.js'

const PROVISIONAL_TITLE_MAX = 60

/**
 * Titre affiché entre la création et le résumé du CLI, c'est-à-dire le temps du
 * premier tour. Un extrait du message dit déjà de quoi il s'agit, contrairement à un
 * « Nouvelle conversation » identique pour toutes.
 */
export function provisionalTitle(firstMessage: string | undefined): string {
  const text = firstMessage?.trim().replace(/\s+/g, ' ')
  if (!text) return 'Nouvelle conversation'
  return text.length <= PROVISIONAL_TITLE_MAX
    ? text
    : `${text.slice(0, PROVISIONAL_TITLE_MAX).trimEnd()}...`
}

export interface CreateConversationInput {
  /** Null pour un fil libre, qui n'appartient à aucun projet. */
  projectId: string | null
  userId: string
  agent: AgentKind
  /** Déjà résolue : les `CLI_DEFAULT` sont remplacés avant l'écriture. */
  config: AgentConfig
  worktreeId: string | null
  /** Carte traitée, quand la conversation est lancée depuis le board. */
  cardId: string | null
  title?: string
  /**
   * Texte dont tirer le titre provisoire, quand le premier message ne s'y prête pas :
   * une mission confiée par une autre session commence par son enveloppe balisée.
   */
  titleSource?: string
  /** Jeton d'API à l'origine de la conversation ; null quand elle vient de l'interface. */
  origin: { tokenId: string; label: string } | null
  /** Tâche planifiée dont ce fil est un tir ; absent pour toute autre conversation. */
  scheduleId?: string
  /**
   * Contexte transmis depuis une autre conversation, quand celle-ci la continue dans un
   * autre CLI : écrit avec la ligne, pour que le premier démarrage du CLI le trouve.
   */
  handoff?: {
    fromConversationId: string
    throughSeq: number
    budgetTokens: number
    text: string
  }
  firstMessage?: {
    clientMessageId: string
    text: string
    attachments: OutgoingAttachment[]
    mentions: string[]
    skills: string[]
  }
}

/**
 * Crée une conversation et lui envoie son premier message.
 *
 * Partagé entre l'interface et l'API : le vocabulaire diffère mais le geste est le
 * même, et deux copies auraient divergé au premier champ ajouté.
 */
export async function createConversation(
  db: Db,
  sessions: SessionManager,
  input: CreateConversationInput,
): Promise<ConversationRow> {
  const now = Date.now()
  const row: ConversationRow = {
    id: randomUUID(),
    projectId: input.projectId,
    worktreeId: input.worktreeId,
    cardId: input.cardId,
    userId: input.userId,
    title: input.title ?? provisionalTitle(input.titleSource ?? input.firstMessage?.text),
    titleSetByUser: input.title !== undefined,
    titleSetByAgent: false,
    agent: input.agent,
    agentSessionId: null,
    forkedFromId: null,
    handoffFromId: input.handoff?.fromConversationId ?? null,
    createdByTokenId: input.origin?.tokenId ?? null,
    originLabel: input.origin?.label ?? null,
    scheduleId: input.scheduleId ?? null,
    config: JSON.stringify(input.config),
    status: 'idle',
    backgroundCount: 0,
    loopCount: 0,
    lastSeq: 0,
    lastNotableSeq: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    turnCount: 0,
    journalBytes: 0,
    contextUsedTokens: null,
    contextMaxTokens: null,
    model: null,
    pinned: false,
    // La colonne survit à l'ordre manuel qu'elle servait : les listes trient par
    // activité récente, plus personne ne la lit.
    position: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(conversations).values(row).run()
  if (input.handoff) {
    db.insert(conversationHandoffs)
      .values({ conversationId: row.id, createdAt: now, ...input.handoff })
      .run()
  }

  if (input.firstMessage) {
    // Si l'envoi échoue, la conversation ne doit pas rester comme un fil vide :
    // on la retire et on remonte l'erreur telle quelle.
    try {
      await sessions.sendMessage(
        row.id,
        input.firstMessage.clientMessageId,
        input.firstMessage.text,
        input.firstMessage.attachments,
        input.firstMessage.mentions,
        input.firstMessage.skills,
      )
    } catch (err) {
      db.delete(conversations).where(eq(conversations.id, row.id)).run()
      throw err
    }
  }

  return row
}
