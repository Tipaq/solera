import { Flag, Layers, SquareKanban, Target, Zap, type LucideIcon } from 'lucide-react'
import type { MessageKey } from './i18n'

export type ProjectTabKey = 'overview' | 'travail' | 'board' | 'timeline' | 'actions'

export interface ProjectTab {
  key: ProjectTabKey
  /** Ce qui suit `/p/:id` ; vide pour l'Aperçu, la porte du projet. */
  path: string
  label: MessageKey
  icon: LucideIcon
}

/**
 * Les onglets d'un projet, dans l'ordre de la rangée.
 *
 * Une seule liste pour la rangée de la coque et pour le `⋯` du projet dans la colonne :
 * ce menu est le seul chemin direct vers un onglet quand la rangée n'est pas sous les
 * yeux, et il doit en suivre l'ordre (SID-13). Réglages n'en est pas : il vit au bout de
 * la rangée, à part.
 */
export const PROJECT_TABS: readonly ProjectTab[] = [
  { key: 'overview', path: '', label: 'project.view.overview', icon: Target },
  { key: 'travail', path: '/travail', label: 'project.view.travail', icon: Layers },
  { key: 'board', path: '/board', label: 'project.board.title', icon: SquareKanban },
  { key: 'timeline', path: '/timeline', label: 'project.view.timeline', icon: Flag },
  { key: 'actions', path: '/actions', label: 'project.view.actions', icon: Zap },
]
