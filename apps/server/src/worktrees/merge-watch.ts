import { eq, inArray } from 'drizzle-orm'
import { conversations, projects, type Db } from '@solera/db'
import type { Decisions } from '../decisions/decisions.js'
import type { WorktreeCleanup } from './cleanup.js'
import type { WorktreeStatusService } from './status-service.js'

/**
 * Propose dans « À décider » de nettoyer un arbre dès qu'il est fusionné et propre, et
 * retire la proposition si l'arbre bouge avant la réponse.
 *
 * Branché sur les calculs d'avancement plutôt que sur les gestes qui fusionnent : une
 * fusion se fait par l'onglet Git, par un agent au shell, ou sur la forge puis un pull,
 * et seul l'état de l'arbre les voit toutes. Une session qui travaille encore dans
 * l'arbre repousse la question à un calcul suivant : elle n'a peut-être pas fini.
 */
export function watchMergedWorktrees(
  db: Db,
  status: WorktreeStatusService,
  decisions: Decisions,
  cleanup: WorktreeCleanup,
): void {
  decisions.setWorktreeCleaner(async (row) => {
    if (!row.projectId) return 'stale'
    const project = db.select().from(projects).where(eq(projects.id, row.projectId)).get()
    if (!project || !row.worktreePath) return 'stale'
    return cleanup.cleanIfMerged(project, row.worktreePath)
  })

  status.onComputed(async (project, list) => {
    if (!list.base) return
    const byPath = new Map(list.worktrees.map((tree) => [tree.path, tree]))

    for (const path of decisions.pendingWorktreeProposals(project.id)) {
      const tree = byPath.get(path)
      // L'arbre a disparu, ou porte de nouveau du travail.
      if (!tree || tree.state !== 'merged') decisions.withdrawWorktreeProposal(project.id, path)
    }

    for (const tree of list.worktrees) {
      // L'arbre qui porte la branche par défaut n'est pas un chantier qu'on fusionne.
      if (tree.state !== 'merged' || tree.branch === list.base) continue
      // Les sessions qui vivent dans l'arbre, et elles seules : une session de la racine
      // qui y a cité un chemin peut tourner des jours sans rien y faire.
      const ids = tree.conversations.filter((entry) => entry.link === 'worktree').map((entry) => entry.id)
      const linked = ids.length
        ? db
            .select({ id: conversations.id, status: conversations.status, updatedAt: conversations.updatedAt, archivedAt: conversations.archivedAt })
            .from(conversations)
            .where(inArray(conversations.id, ids))
            .all()
        : []
      if (linked.some((row) => row.status === 'running' || row.status === 'awaiting_input')) continue
      const latest = [...linked].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      // Seul le propriétaire peut nettoyer un arbre : c'est à lui que la question va.
      decisions.proposeWorktreeCleanup({
        projectId: project.id,
        conversationId: latest?.id ?? '',
        branch: tree.name,
        path: tree.path,
        base: list.base,
        sessions: linked.filter((row) => row.archivedAt === null).length,
      })
    }
  })
}
