import { statSync } from 'node:fs'
import { and, eq, isNull } from 'drizzle-orm'
import { worktrees, type Db } from '@solera/db'
import { conflict, HttpError } from '../http/errors.js'

/**
 * Un worktree dont le dossier a disparu (carte #61).
 *
 * Le cas courant n'est pas le retrait par Solera, qui pose déjà `removedAt`, mais le
 * retrait par git : un `gh pr merge --delete-branch` ou un `git worktree remove` emporte
 * le dossier sans que la ligne le sache. Tant qu'elle ne le sait pas, l'explorateur, la
 * vue Git, les terminaux et les mentions résolvent un chemin mort, et le CLI lancé là
 * échoue en `ENOENT` que le SDK de Claude présente comme une affaire de libc.
 *
 * Le marquage tient donc en une écriture : `removedAt`, que tout le reste lit déjà. Qui
 * le pose ne compte pas — le gestionnaire de sessions au lancement d'un CLI, la
 * réconciliation avec `git worktree list` (carte #78) — tant que tous passent par ici.
 */

/** Vrai si le chemin est un dossier. Un fichier au même nom ne fait pas un cwd. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Pose `removedAt` sur un worktree dont le dossier a disparu.
 *
 * Idempotent : vrai seulement si cet appel l'a posé, pour que l'appelant ne signale
 * qu'une fois un changement que d'autres ont pu voir avant lui. Ne touche ni git ni le
 * disque : constater l'absence est à l'appelant.
 */
export function markWorktreeGone(db: Db, worktreeId: string): boolean {
  const result = db
    .update(worktrees)
    .set({ removedAt: Date.now() })
    .where(and(eq(worktrees.id, worktreeId), isNull(worktrees.removedAt)))
    .run()
  return result.changes > 0
}

/**
 * L'état du worktree d'une conversation, constaté sur le disque au besoin.
 *
 * Pour la lecture d'un fil qu'on ouvre : un dossier parti depuis le dernier envoi doit
 * montrer le bandeau tout de suite, pas au premier message refusé. `marked` dit que
 * cette lecture vient de poser `removedAt`, et que les listes sont à relire.
 */
export function checkWorktree(
  db: Db,
  worktreeId: string | null,
): { gone: boolean; marked: boolean } {
  if (!worktreeId) return { gone: false, marked: false }
  const row = db
    .select({ path: worktrees.path, removedAt: worktrees.removedAt })
    .from(worktrees)
    .where(eq(worktrees.id, worktreeId))
    .get()
  if (!row) return { gone: false, marked: false }
  if (row.removedAt) return { gone: true, marked: false }
  if (isDirectory(row.path)) return { gone: false, marked: false }
  return { gone: true, marked: markWorktreeGone(db, worktreeId) }
}

/**
 * Le refus opposé à tout ce qui voudrait travailler dans un dossier disparu.
 *
 * Un seul code pour le worktree retiré et pour le dossier de projet supprimé : dans les
 * deux cas rien ne peut tourner, et c'est le chemin qui dit lequel des deux.
 */
export function workingDirectoryMissing(path: string): HttpError {
  return conflict(
    'working_directory_missing',
    'The working directory of this conversation no longer exists: {path}.',
    { path },
  )
}

export function isWorkingDirectoryMissing(err: unknown): err is HttpError {
  return err instanceof HttpError && err.code === 'working_directory_missing'
}
