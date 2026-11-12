import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from './api'
import type { TreeFields } from './code-model'
import { sendMessage } from './conversations'
import { useTranslate } from './i18n'
import { openGitPanel, openPanelOnArrival } from './panel'
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

/**
 * La session que visent les gestes d'un arbre : celle qui attend, sinon la première
 * vivante, sinon la plus récente.
 */
export function treeSessionId(tree: Pick<TreeFields, 'sessions' | 'anySessionId'>): string | null {
  return tree.sessions.find((session) => session.tone !== 'running')?.id ?? tree.sessions[0]?.id ?? tree.anySessionId
}

/**
 * Faux pour un arbre créé au shell et sans session : Solera n'en a pas l'identifiant, et
 * n'a donc aucune portée par laquelle l'ouvrir. Le geste ne se montre pas.
 */
export function canDiffTree(tree: TreeTarget): boolean {
  return tree.root || tree.id !== null || treeSessionId(tree) !== null
}

/** Faux pour la racine (on ne rebase pas la base sur elle-même), et comme `canDiffTree`. */
export function canRebaseTree(tree: TreeTarget): boolean {
  return !tree.root && (tree.id !== null || treeSessionId(tree) !== null)
}

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
 * Le geste « Rebaser » sur la base du projet. Un échec de git (conflit, arbre sale,
 * agent au travail) revient en erreur, avec le message du serveur.
 */
export function useRebaseTree(projectId: string) {
  const t = useTranslate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ tree, base }: { tree: TreeTarget; base: string }): Promise<TreeRebaseOutcome> => {
      const sessionId = treeSessionId(tree)
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
