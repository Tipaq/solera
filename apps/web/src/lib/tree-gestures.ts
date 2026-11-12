import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from './api'
import type { TreeFields } from './code-model'
import { sendMessage } from './conversations'
import { useTranslate } from './i18n'
import { openGitPanel, openPanelOnArrival } from './panel'
import { liveSessionId, treeSessionId } from './tree-actions'
import { worktreeScope } from './workspace-scope'
import { worktreeStatusKey } from './worktrees'

/**
 * « Diff » et « Rebaser » d'un arbre (T-13.1, carte #169), pour Travail et l'Aperçu.
 *
 * Un arbre qui a une session est à elle : son diff s'ouvre dans son panneau, et le
 * rebase lui est demandé, parce qu'elle a peut-être du travail en cours que le rebase
 * bousculerait. Un arbre sans session s'ouvre et se rebase sur place, par la portée
 * « worktree » du panneau (`/api/worktrees/:id`).
 */

type TreeTarget = Pick<TreeFields, 'id' | 'root' | 'name' | 'branch' | 'sessions' | 'anySessionId'>

/** Le geste « Diff » : l'onglet Git du panneau, dans la session de l'arbre ou sur lui. */
export function useTreeDiff(projectId: string): (tree: TreeTarget) => void {
  const navigate = useNavigate()
  return useCallback(
    (tree: TreeTarget) => {
      const sessionId = treeSessionId(tree)
      if (sessionId) {
        const path = `/p/${projectId}/c/${sessionId}`
        openPanelOnArrival(path, 'git')
        navigate(path)
        return
      }
      if (tree.root) return openGitPanel(null)
      if (tree.id) openGitPanel({ id: tree.id, name: tree.branch ?? tree.name })
    },
    [navigate, projectId],
  )
}

/** Ce que « Rebaser » a fait : demandé à la session, ou fait dans l'arbre. */
export type TreeRebaseOutcome = { kind: 'asked'; sessionId: string } | { kind: 'rebased' }

/**
 * Le geste « Rebaser » sur la base du projet. Seule une session **vivante** reçoit la
 * demande : écrire à une session close relancerait un agent pour un geste que git fait
 * seul. Un échec de git (conflit, arbre sale, agent au travail) revient en erreur, avec
 * le message du serveur ; le retour à l'écran (toast, T-13.3) est à l'appelant.
 */
export function useRebaseTree(projectId: string) {
  const t = useTranslate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ tree, base }: { tree: TreeTarget; base: string }): Promise<TreeRebaseOutcome> => {
      const sessionId = liveSessionId(tree)
      if (sessionId) {
        await sendMessage(sessionId, t('code.gesture.rebaseRequest', { branch: tree.branch ?? tree.name, base }))
        return { kind: 'asked', sessionId }
      }
      if (!tree.id) throw new Error(t('code.gesture.unknownTree'))
      await api.post(`/api/worktrees/${tree.id}/git/act`, { kind: 'branch-rebase', name: base })
      return { kind: 'rebased' }
    },
    onSettled: (_outcome, _error, { tree }) => {
      void queryClient.invalidateQueries({ queryKey: worktreeStatusKey(projectId) })
      if (!tree.id) return
      // Les lectures du panneau ouvert sur cet arbre : graphe, état, branches.
      const scope = worktreeScope(tree.id)
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === scope })
    },
  })
}
