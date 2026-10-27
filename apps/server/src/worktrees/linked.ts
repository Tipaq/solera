import { and, eq, inArray, isNull } from 'drizzle-orm'
import { conversationPaths, worktrees, type Db } from '@solera/db'
import { directoryGone, markWorktreeGone } from './gone.js'

/**
 * Les worktrees Solera où une session travaille sans y avoir son cwd : ceux qu'elle a
 * créés par `create_worktree`, ou dans lesquels elle a écrit.
 *
 * Ils s'ajoutent aux dossiers que le CLI peut écrire : sans cela, une session en mode
 * restreint (Codex en `workspace-write`, Claude hors contournement des permissions) se
 * verrait refuser les écritures dans l'arbre qu'on vient de lui créer. Lu à chaque appel,
 * pour qu'un arbre créé en cours de session compte dès le tour suivant chez Codex.
 *
 * Un arbre dont le dossier a disparu n'est jamais rendu : un CLI à qui l'on passe un
 * dossier absent peut refuser de démarrer, et c'est la session de la racine, qui n'y
 * avait qu'écrit, qui tombait alors. Le constat est marqué au passage (`removedAt`),
 * comme partout ailleurs ; `onMarked` dit qu'il faut faire relire les listes.
 */
export function linkedWorktreePaths(
  db: Db,
  conversationId: string,
  projectId: string,
  onMarked?: () => void,
): string[] {
  const trees = db
    .select({ id: worktrees.id, path: worktrees.path })
    .from(worktrees)
    .where(and(eq(worktrees.projectId, projectId), isNull(worktrees.removedAt)))
    .all()
  if (trees.length === 0) return []

  const touched = db
    .select({ path: conversationPaths.path })
    .from(conversationPaths)
    .where(eq(conversationPaths.conversationId, conversationId))
    .all()
    .map((row) => row.path)
  const linked = trees.filter((tree) =>
    touched.some((entry) => entry === tree.path || entry.startsWith(`${tree.path}/`)),
  )

  let marked = false
  const alive = linked.filter((tree) => {
    if (!directoryGone(tree.path)) return true
    if (markWorktreeGone(db, tree.id)) marked = true
    return false
  })
  if (marked) onMarked?.()
  return alive.map((tree) => tree.path)
}

/**
 * Vrai si l'un des dossiers passés à un CLI n'est plus un worktree vivant : retiré par
 * Solera (`removedAt`), ou parti du disque sans que la base le sache, auquel cas il est
 * marqué ici. C'est ce qui décide de relancer un CLI qui les a reçus au lancement.
 */
export function anyWorktreeGone(db: Db, paths: readonly string[], onMarked?: () => void): boolean {
  if (paths.length === 0) return false
  const rows = db
    .select({ id: worktrees.id, path: worktrees.path })
    .from(worktrees)
    .where(and(inArray(worktrees.path, [...paths]), isNull(worktrees.removedAt)))
    .all()

  let gone = false
  let marked = false
  for (const path of paths) {
    const live = rows.filter((row) => row.path === path)
    if (live.length === 0) {
      gone = true
      continue
    }
    if (!directoryGone(path)) continue
    gone = true
    for (const row of live) if (markWorktreeGone(db, row.id)) marked = true
  }
  if (marked) onMarked?.()
  return gone
}
