import { eq } from 'drizzle-orm'
import { conversations } from '@solera/db'
import type { ConversationMetrics, ConversationStatus } from '@solera/protocol'
import type { AppContext } from '../http/context.js'
import { conversationMetrics } from './metrics.js'

/** Statut et avancement courants, pour l'instantané envoyé à l'abonnement WebSocket. */
export function readConversationState(
  ctx: AppContext,
  conversationId: string,
): { status: ConversationStatus; lastNotableSeq: number; metrics: ConversationMetrics } | null {
  const row = ctx.db
    .select({
      status: conversations.status,
      lastNotableSeq: conversations.lastNotableSeq,
      turnCount: conversations.turnCount,
      journalBytes: conversations.journalBytes,
      contextUsedTokens: conversations.contextUsedTokens,
      contextMaxTokens: conversations.contextMaxTokens,
      model: conversations.model,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get()

  if (!row) return null
  return {
    status: row.status,
    lastNotableSeq: row.lastNotableSeq,
    metrics: conversationMetrics(row),
  }
}
