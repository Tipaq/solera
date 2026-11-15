import { eq } from 'drizzle-orm'
import { worktrees, type Db, type WorktreeRow } from '@solera/db'
import { deleteBranch, readCheckout, removeWorktree } from '../git.js'
import { directoryGone } from './gone.js'

/**
 * Les arbres qu'ouvre un tir planifié en mode « Nouveau worktree » (#249).
 *
 * Chaque tir crée sa branche `planifiee/<tâche>-<heure>` et son dossier : une tâche
 * quotidienne en laisserait trente par mois. Le tir rend le sien s'il n'a rien produit,
 * par le nettoyage du chantier (`WorktreeCleanup`) ; ce qui a travaillé y reste, pour
 * qu'une personne voie ce qu'elle retire.
 */

/**
 * Vrai si l'arbre n'a rien produit : ni fichier modifié ou non suivi, ni commit au-delà
 * de la branche par défaut. Les fichiers ignorés ne comptent pas : ce sont des sorties
 * (dépendances, builds) qu'un tir laisse sans les avoir voulues. Sans base connue, on ne
 * sait pas : l'arbre reste.
 */
export async function worktreeUntouched(tree: WorktreeRow): Promise<boolean> {
  if (tree.removedAt !== null || directoryGone(tree.path)) return false
  const { ahead, dirtyFiles } = await readCheckout(tree.path)
  return ahead === 0 && dirtyFiles === 0
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
