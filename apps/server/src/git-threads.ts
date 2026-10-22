import { eq } from 'drizzle-orm'
import { conversations, projects, worktrees, type Db } from '@solera/db'
import type { ThreadRefDto } from '@solera/protocol'

/**
 * Le rattachement d'un commit, ou d'un worktree, au fil qui l'a écrit.
 *
 * C'est l'écart assumé avec GitKraken (carte #10) : l'auteur d'un commit est presque
 * toujours un agent, et ce qui renseigne est la conversation. Rien dans un dépôt git
 * ne porte cette information — aucun en-tête, aucune note — donc elle se déduit, et
 * ce module est l'endroit où la déduction est écrite une fois, avec ses limites.
 *
 * Deux règles, dans cet ordre :
 *
 * 1. **Par la branche.** Un commit atteint depuis une seule tête de branche n'existe
 *    que par elle ; si cette branche est sortie dans un worktree, le fil qui occupe ce
 *    worktree l'a écrit. Ça ne se trompe pas, d'où `sure: true`.
 * 2. **Par recoupement de dates.** Pour le reste — l'histoire commune, donc `main` —
 *    on cherche les fils qui travaillaient dans ce même répertoire à cette heure-là.
 *    S'il y en a exactement un, c'est lui ; s'il y en a deux, on ne dit rien plutôt
 *    que de choisir. `sure: false`, et l'infobulle le dit.
 *
 * Ce qui ferait tomber la règle 2 : rien n'empêche deux sessions de travailler à la
 * racine en même temps — c'est même courant ici. La règle ne ment pas pour autant,
 * elle se tait.
 */

export interface ThreadWindow {
  id: string
  title: string
  /** Répertoire de travail du fil : son worktree, ou le workspace du projet. */
  path: string
  from: number
  to: number
}

/**
 * Les fils d'un projet, avec leur répertoire et la période où ils ont vécu.
 *
 * Les conversations archivées comptent : un commit d'il y a trois jours a été écrit
 * par un fil qui, le plus souvent, est fermé depuis.
 */
export function readThreadWindows(db: Db, projectId: string): ThreadWindow[] {
  const rows = db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      archivedAt: conversations.archivedAt,
      worktreePath: worktrees.path,
      worktreeRemovedAt: worktrees.removedAt,
      workspacePath: projects.workspacePath,
    })
    .from(conversations)
    .innerJoin(projects, eq(projects.id, conversations.projectId))
    .leftJoin(worktrees, eq(worktrees.id, conversations.worktreeId))
    .where(eq(conversations.projectId, projectId))
    .all()

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    // Un worktree retiré retombe sur le workspace, sans quoi un fil pointerait un
    // dossier qui n'existe plus. C'est aussi là qu'il reprend s'il continue à la racine.
    path:
      row.worktreePath && !row.worktreeRemovedAt ? row.worktreePath : row.workspacePath,
    from: row.createdAt,
    to: row.archivedAt ?? row.updatedAt,
  }))
}

const ref = (thread: ThreadWindow, sure: boolean): ThreadRefDto => ({
  id: thread.id,
  title: thread.title,
  sure,
})

/**
 * Le fil qui occupe un worktree : le dernier à y avoir travaillé.
 *
 * Plusieurs fils peuvent partager un worktree au fil du temps ; celui qu'on nomme est
 * le plus récent, qui est celui qu'on cherche quand on lit « qui est là-dedans ».
 */
export function threadByPath(threads: ThreadWindow[]): Map<string, ThreadRefDto> {
  const latest = new Map<string, ThreadWindow>()
  for (const thread of threads) {
    const current = latest.get(thread.path)
    if (!current || current.to < thread.to) latest.set(thread.path, thread)
  }
  return new Map([...latest].map(([path, thread]) => [path, ref(thread, true)]))
}

/**
 * Le fil qui travaillait dans ce répertoire à cette heure-là, s'il n'y en a qu'un.
 *
 * Une marge d'une heure après le dernier message : un commit tombe souvent juste après
 * le tour qui l'a produit, parfois après que la session a été laissée.
 */
const GRACE_MS = 60 * 60 * 1000

export function threadAt(
  threads: ThreadWindow[],
  path: string,
  ts: number,
): ThreadRefDto | null {
  const candidates = threads.filter(
    (thread) => thread.path === path && ts >= thread.from && ts <= thread.to + GRACE_MS,
  )
  return candidates.length === 1 ? ref(candidates[0] as ThreadWindow, false) : null
}
