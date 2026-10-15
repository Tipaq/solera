import { eq } from 'drizzle-orm'
import { conversations, type Db } from '@solera/db'
import { conversationWorkspace, projectWorkspace } from '../../workspace.js'

/**
 * Les routes du panneau (arborescence, fichiers, git) existent en deux portées : par
 * conversation, où le répertoire est celui du fil, worktree compris, et par projet, où
 * c'est le workspace. Même logique, même contrôle d'accès, seul le résolveur change :
 * chaque module les enregistre en boucle sur cette liste plutôt qu'en deux copies.
 */
export interface WorkspaceScope {
  base: string
  cwdOf(db: Db, id: string, userId: string): string
  /**
   * Projet auquel ce répertoire appartient.
   *
   * La vue Git en a besoin et pas les autres : c'est par lui qu'on retrouve les fils
   * qui ont écrit les commits et ceux qui occupent les worktrees. À appeler après
   * `cwdOf`, qui porte le contrôle de visibilité.
   */
  projectIdOf(db: Db, id: string): string | null
}

export const workspaceScopes: readonly WorkspaceScope[] = [
  {
    base: '/api/conversations/:id',
    cwdOf: conversationWorkspace,
    projectIdOf: (db, id) =>
      db
        .select({ projectId: conversations.projectId })
        .from(conversations)
        .where(eq(conversations.id, id))
        .get()?.projectId ?? null,
  },
  { base: '/api/projects/:id', cwdOf: projectWorkspace, projectIdOf: (_db, id) => id },
]
