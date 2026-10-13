import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { worktrees, type ProjectRow, type WorktreeRow } from '@solera/db'
import { GitError, addWorktree, readGitStatus } from '../git.js'
import type { AppContext } from '../http/context.js'
import { badRequest, conflict } from '../http/errors.js'

/**
 * Crée un worktree du projet sur une branche, neuve ou existante.
 *
 * Partagé entre la route et les sessions lancées par un agent (`start_session`) : le
 * dossier, la réutilisation d'une branche et la ligne en base suivent la même règle.
 * Ici plutôt que dans la route, pour que le daemon n'ait pas à dépendre de la couche
 * HTTP afin d'ouvrir un arbre de travail.
 */
export async function createWorktree(
  ctx: AppContext,
  project: ProjectRow,
  userId: string,
  name: string,
  baseRef: string,
): Promise<WorktreeRow> {
  if (!(await readGitStatus(project.workspacePath))) {
    throw badRequest('not_a_repository', 'This project is not a git repository.')
  }

  const existing = ctx.db
    .select()
    .from(worktrees)
    .where(and(eq(worktrees.projectId, project.id), eq(worktrees.name, name)))
    .get()
  if (existing && !existing.removedAt) {
    throw conflict('worktree_exists', 'Worktree {name} already exists.', { name })
  }

  // Les worktrees vivent dans le répertoire de données, pas dans le projet : ils ne
  // doivent pas polluer l'arborescence que l'utilisateur voit dans son éditeur.
  const path = join(ctx.config.paths.worktrees, project.id, name.replace(/\//g, '__'))
  const { reusedBranch } = await addWorktree(project.workspacePath, path, name, baseRef).catch(
    (err: unknown) => {
      if (err instanceof GitError) throw badRequest('git_failed', err.message)
      throw err
    },
  )

  const row: WorktreeRow = {
    id: randomUUID(),
    projectId: project.id,
    name,
    path,
    baseRef: reusedBranch ? name : baseRef,
    createdBy: userId,
    createdAt: Date.now(),
    removedAt: null,
  }

  // Une entrée précédente supprimée porte le même nom : l'index unique l'interdirait.
  if (existing) ctx.db.delete(worktrees).where(eq(worktrees.id, existing.id)).run()
  ctx.db.insert(worktrees).values(row).run()
  return row
}
