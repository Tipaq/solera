import { FileDiff, GitMerge, GitPullRequest, MessageCircleQuestion, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { TreeRow } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'
import { primaryGesture, treeGestures, treeSessionId, liveSessionId, type TreeGestureKey } from '../../lib/tree-actions'
import { useRebaseTree, useTreeDiff } from '../../lib/tree-gestures'
import type { Gesture } from './GestureMenu'
import { useTravailActions } from './TravailActions'
import { errorText, useTravailNotice } from './TravailNotice'

/** Un geste sur un arbre : un bouton du tiroir, une entrée du menu `⋯` d'un couloir ou d'une ligne. */
export type TreeAction = Gesture<TreeGestureKey | 'reply' | 'review'>

/**
 * Les gestes d'un arbre (`projet.md` T-13.1), dans l'ordre de `treeGestures` : la session
 * (ou en lancer une ici), le diff, la PR, le rebase, la fusion d'une PR prête, le
 * nettoyage. Leur retour se dit au même endroit, sous la barre (T-13.3) ; le nettoyage
 * et la fusion passent par les confirmations de la page.
 *
 * `long` : les libellés du menu d'une ligne du tableau (T-6.2), qui se lisent seuls,
 * loin du nom de l'arbre ; le tiroir et les couloirs gardent les courts.
 */
export function useTreeActions(projectId: string, tree: TreeRow, { long = false }: { long?: boolean } = {}): TreeAction[] {
  const t = useTranslate()
  const navigate = useNavigate()
  const say = useTravailNotice()
  const page = useTravailActions()
  const diff = useTreeDiff(projectId)
  const rebase = useRebaseTree(projectId)
  const name = tree.branch ?? tree.name
  const sessionId = treeSessionId(tree)
  const prUrl = tree.pr?.url ?? null
  const label = (key: 'session' | 'launch' | 'diff' | 'pr' | 'rebase' | 'clean') => (long ? (`travail.gesture.long.${key}` as const) : (`travail.gesture.${key}` as const))

  const action = (key: TreeGestureKey, launch: boolean): Omit<TreeAction, 'disabled'> => {
    switch (key) {
      case 'session':
        return {
          key,
          label: t(label(launch ? 'launch' : 'session')),
          icon: <Play size={14} />,
          run: () => navigate(sessionId ? `/p/${projectId}/c/${sessionId}` : tree.root || !tree.id ? `/p/${projectId}/c/new` : `/p/${projectId}/c/new?worktree=${tree.id}`),
        }
      case 'diff':
        return { key, label: t(label('diff')), icon: <FileDiff size={14} />, run: () => diff(tree) }
      case 'pr':
        return { key, label: t(label('pr'), { number: tree.pr?.number ?? 0 }), icon: <GitPullRequest size={14} />, run: () => prUrl && window.open(prUrl, '_blank', 'noopener') }
      case 'rebase':
        return {
          key,
          label: t(label('rebase')),
          icon: <RefreshCw size={14} />,
          run: () => {
            const base = page.base
            if (!base) return
            rebase.mutate(
              { tree, base },
              {
                onSuccess: (outcome) => say(outcome.kind === 'asked' ? t('travail.gesture.rebaseAsked', { branch: name }) : t('travail.gesture.rebased', { branch: name, base })),
                onError: (error) => say(errorText(error), 'critical'),
              },
            )
          },
        }
      case 'merge':
        return { key, label: t('travail.gesture.merge'), icon: <GitMerge size={14} />, run: () => page.merge(tree) }
      case 'clean':
        return { key, label: t(label('clean')), icon: <Trash2 size={14} />, run: () => page.clean({ trees: [tree], branches: [] }), tone: 'critical' }
    }
  }

  // Sans base (un dépôt sans branche), il n'y a rien sur quoi rebaser : le geste ne se montre pas.
  return treeGestures(tree).filter((gesture) => gesture.key !== 'rebase' || page.base !== null).map((gesture) => ({
    ...action(gesture.key, gesture.launch ?? false),
    // Un rebase en cours ne se relance pas.
    disabled: gesture.disabled || (gesture.key === 'rebase' && rebase.isPending) || undefined,
  }))
}

/**
 * Le geste que le verdict appelle (T-6.2), montré en clair sur la ligne du tableau au
 * téléphone, et en tête de son menu : répondre, nettoyer, relire.
 */
export function usePrimaryAction(projectId: string, tree: TreeRow): TreeAction | null {
  const t = useTranslate()
  const navigate = useNavigate()
  const page = useTravailActions()
  switch (primaryGesture(tree)) {
    case 'reply': {
      const sessionId = liveSessionId(tree)
      return { key: 'reply', label: t('travail.gesture.reply'), icon: <MessageCircleQuestion size={14} />, run: () => sessionId && navigate(`/p/${projectId}/c/${sessionId}`) }
    }
    case 'clean':
      return { key: 'clean', label: t('travail.gesture.clean'), icon: <Trash2 size={14} />, run: () => page.clean({ trees: [tree], branches: [] }) }
    case 'review': {
      const url = tree.pr?.url
      return { key: 'review', label: t('travail.gesture.review'), icon: <GitPullRequest size={14} />, run: () => url && window.open(url, '_blank', 'noopener') }
    }
    default:
      return null
  }
}
