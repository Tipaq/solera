import { eq } from 'drizzle-orm'
import { worktrees, type Db, type WorktreeRow } from '@solera/db'
import { countCommitsSince, deleteBranch, readGitStatus, removeWorktree } from '../git.js'
import { directoryGone, markWorktreeGone } from './gone.js'

/**
 * Le rangement des arbres qu'ouvre un tir planifié en mode « Nouveau worktree » (#249).
 *
 * Chaque tir crée sa branche `planifiee/<tâche>-<heure>` et son dossier : une tâche
 * quotidienne en laisserait trente par mois. Ne part ici que ce qui n'a rien produit,
 * sans fichier touché ni commit au-delà de sa base. Ce qui a travaillé reste au
 * nettoyage du chantier, où une personne voit ce qu'elle retire.
 */

/**
 * Vrai si l'arbre n'a rien produit : propre, sans commit au-delà de sa base. Un arbre
 * déjà retiré, ou dont le dossier a disparu, n'a plus rien à retirer.
 */
export async function worktreeUntouched(tree: WorktreeRow): Promise<boolean> {
  if (tree.removedAt !== null || directoryGone(tree.path)) return false
  // Sans base nommée (`HEAD`, faute de branche par défaut) ou sur une branche reprise,
  // « rien au-delà de la base » ne se mesure pas : l'arbre reste.
  if (tree.baseRef === 'HEAD' || tree.baseRef === tree.name) return false
  const status = await readGitStatus(tree.path)
  if (!status || status.isDirty) return false
  return (await countCommitsSince(tree.path, tree.baseRef)) === 0
}

/** Retire l'arbre et sa branche. Le fil qui y vivait reste lisible, l'arbre marqué retiré. */
export async function retireWorktree(db: Db, repo: string, tree: WorktreeRow): Promise<void> {
  await removeWorktree(repo, tree.path, true)
  await deleteBranch(repo, tree.name).catch(() => undefined)
  markWorktreeGone(db, tree.id)
}

/**
 * Défait l'arbre d'un tir qui n'a pas pu lancer sa session : aucun fil ne le cite, et
 * personne n'y a rien écrit. Au mieux : un échec ici ne doit pas masquer celui du tir.
 */
export async function discardWorktree(db: Db, repo: string, tree: WorktreeRow): Promise<void> {
  await removeWorktree(repo, tree.path, true).catch(() => undefined)
  await deleteBranch(repo, tree.name).catch(() => undefined)
  db.delete(worktrees).where(eq(worktrees.id, tree.id)).run()
}
