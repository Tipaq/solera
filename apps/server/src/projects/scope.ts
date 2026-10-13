import { and, eq, or, type SQL } from 'drizzle-orm'
import { projects } from '@solera/db'
import type { AppContext } from '../http/context.js'

/**
 * Un utilisateur voit un projet s'il en est propriétaire ou si le projet est partagé.
 * Seul le propriétaire peut le modifier ou le supprimer.
 */
export function visibilityFilter(userId: string): SQL {
  return or(eq(projects.ownerId, userId), eq(projects.visibility, 'shared'))!
}

/**
 * Le projet, s'il est visible par cet utilisateur.
 *
 * Ici plutôt que dans la route, pour que le hub des terminaux n'ait pas à dépendre de
 * la couche HTTP afin de poser une question de visibilité.
 */
export function visibleProject(ctx: AppContext, projectId: string, userId: string) {
  return ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), visibilityFilter(userId)))
    .get()
}
