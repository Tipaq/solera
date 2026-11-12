import { GitPullRequest, Play, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { treeSessionId, type TreeRow } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'

/** Un geste sur un arbre : un bouton du tiroir, une entrée du menu `⋯` d'un couloir. */
export interface TreeAction {
  key: 'session' | 'pr' | 'clean'
  label: string
  icon: ReactNode
  run: () => void
  /** Le geste qui retire : séparé des autres, en rouge. */
  tone?: 'critical'
}

/** La session à rouvrir : celle qui t'attend, sinon la première vivante, sinon la plus récente. */
export function sessionToOpen(tree: TreeRow): string | null {
  return treeSessionId(tree)
}

/**
 * Les gestes d'un arbre (`projet.md` T-13.1), dans leur ordre : la session (ou en lancer
 * une ici), la PR, le nettoyage. La racine n'a que sa session. Un arbre créé au shell
 * (sans id) ne se nettoie pas depuis Solera.
 */
export function useTreeActions(projectId: string, tree: TreeRow, { onClean }: { onClean: (tree: TreeRow) => void }): TreeAction[] {
  const t = useTranslate()
  const navigate = useNavigate()
  const sessionId = sessionToOpen(tree)
  const actions: TreeAction[] = [
    {
      key: 'session',
      label: t(sessionId ? 'travail.gesture.session' : 'travail.gesture.launch'),
      icon: <Play size={14} />,
      run: () => navigate(sessionId ? `/p/${projectId}/c/${sessionId}` : tree.root || !tree.id ? `/p/${projectId}/c/new` : `/p/${projectId}/c/new?worktree=${tree.id}`),
    },
  ]
  if (tree.root) return actions
  const prUrl = tree.pr?.url
  if (tree.pr && prUrl) {
    actions.push({ key: 'pr', label: t('travail.gesture.pr', { number: tree.pr.number }), icon: <GitPullRequest size={14} />, run: () => window.open(prUrl, '_blank', 'noopener') })
  }
  if (tree.id) actions.push({ key: 'clean', label: t('travail.gesture.clean'), icon: <Trash2 size={14} />, run: () => onClean(tree), tone: 'critical' })
  return actions
}
