/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le Tableau en une page, ses trois affichages derrière un sélecteur. La recherche et
 * le filtre de jalon sont tenus ici, pour survivre au changement de vue.
 *
 * Deux façons de choisir l'affichage, à départager :
 * - `vues` : le `ViewSwitch` dans la barre d'outils de la page ;
 * - `vues-onglet` : le choix est porté par l'onglet « Tableau ▾ » de la rangée, et la
 *   page n'a pas de sélecteur.
 */
import { Columns3, Hand, List } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ViewSwitch, useView, type ViewOption } from '../../components/prototype/ViewSwitch'
import type { MilestoneFilter } from './data'
import { GestureVariant } from './GestureVariant'
import { KanbanVariant } from './KanbanVariant'
import { ListVariant } from './ListVariant'

export type BoardView = 'kanban' | 'liste' | 'geste'

export const BOARD_VIEWS: ViewOption<BoardView>[] = [
  { key: 'kanban', label: 'Kanban', icon: <Columns3 size={14} /> },
  { key: 'liste', label: 'Liste', icon: <List size={14} /> },
  { key: 'geste', label: 'Par geste', icon: <Hand size={14} /> },
]

export const BOARD_VIEW_KEYS = BOARD_VIEWS.map((option) => option.key)

/** Le drapeau que lit la rangée d'onglets pour porter le menu « Tableau ▾ ». */
export const TAB_MENU_FLAG = 'proto-tableau-onglet'

export function ViewsBoard({ inTab = false }: { inTab?: boolean }) {
  const { projectId } = useParams()
  const [view, setView] = useView<BoardView>('tableau', projectId, BOARD_VIEW_KEYS)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MilestoneFilter>(null)

  // La rangée d'onglets ne connaît pas la variante du proto : on la lui dit.
  useEffect(() => {
    localStorage.setItem(TAB_MENU_FLAG, inTab ? '1' : '0')
    window.dispatchEvent(new Event(TAB_MENU_FLAG))
  }, [inTab])

  const shared = {
    query,
    setQuery,
    filter,
    setFilter,
    view: inTab ? null : <ViewSwitch options={BOARD_VIEWS} value={view} onChange={setView} />,
  }

  if (view === 'liste') return <ListVariant shared={shared} />
  if (view === 'geste') return <GestureVariant shared={shared} />
  return <KanbanVariant shared={shared} />
}
