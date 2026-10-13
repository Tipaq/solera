import { and, eq, isNull, or, type SQL } from 'drizzle-orm'
import { conversations, projects } from '@solera/db'
import type { AppContext } from '../http/context.js'

/**
 * « Les fils de ce projet », les fils libres compris quand `projectId` vaut null.
 *
 * `project_id = NULL` ne rend jamais vrai en SQL : écrire `eq()` sur une colonne devenue
 * nullable ne se voit pas à la relecture et rend simplement zéro ligne. Un helper plutôt
 * qu'un ternaire recopié, pour que les deux endroits qui posent la question posent
 * exactement la même.
 */
export function inProject(projectId: string | null): SQL {
  return projectId === null
    ? isNull(conversations.projectId)
    : eq(conversations.projectId, projectId)
}

/**
 * Qui voit un fil : son projet quand il en a un, son seul propriétaire sinon.
 *
 * À poser sur une **jointure externe** avec `projects` — une jointure interne écarterait
 * purement et simplement les fils libres, et c'est l'erreur que ce helper existe pour
 * empêcher de recopier. Un fil libre ne se partage pas : il n'y a pas de projet dont il
 * hériterait une visibilité, et l'inventer reviendrait à publier une boîte de réception.
 */
export function conversationVisibleTo(userId: string): SQL {
  return or(
    eq(projects.ownerId, userId),
    eq(projects.visibility, 'shared'),
    and(isNull(conversations.projectId), eq(conversations.userId, userId)),
  )!
}

/** Conversations visibles par un utilisateur, pour l'abonnement WebSocket. */
export function canReadConversation(ctx: AppContext, conversationId: string, userId: string): boolean {
  const row = ctx.db
    .select({ id: conversations.id })
    .from(conversations)
    .leftJoin(projects, eq(projects.id, conversations.projectId))
    .where(and(eq(conversations.id, conversationId), conversationVisibleTo(userId)))
    .get()
  return row !== undefined
}
