/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * La variante `vues-onglet` : l'affichage du Tableau se choisit dans son onglet
 * (« Tableau ▾ »), sans contrôle dans la page. La rangée reprend le rendu de
 * `ProjectTabs`, avec un menu accroché à l'onglet du Tableau.
 */
import { Check, ChevronDown } from 'lucide-react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Menu, MenuItem, TabCount, cx, tabItemClass } from '@solera/ui'
import type { ViewTab } from '../../components/project/ProjectTabs'
import { BOARD_VIEWS, BOARD_VIEW_KEYS, TAB_MENU_FLAG, type BoardView } from './ViewsBoard'

function subscribe(listener: () => void) {
  window.addEventListener(TAB_MENU_FLAG, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(TAB_MENU_FLAG, listener)
    window.removeEventListener('storage', listener)
  }
}

/** Vrai quand la variante `vues-onglet` est celle du Tableau. */
export function useTabMenuFlag(): boolean {
  return useSyncExternalStore(subscribe, () => localStorage.getItem(TAB_MENU_FLAG) === '1')
}

export function TabsWithViewMenu({ label, tabs, action, projectId, boardTo }: {
  label: string
  tabs: ViewTab[]
  action?: ReactNode
  projectId: string
  boardTo: string
}) {
  const navigate = useNavigate()
  const storage = `proto-vue:tableau:${projectId}`
  const remembered = localStorage.getItem(storage) as BoardView | null
  const current = remembered && BOARD_VIEW_KEYS.includes(remembered) ? remembered : BOARD_VIEW_KEYS[0]!
  const currentOption = BOARD_VIEWS.find((option) => option.key === current)!
  const pick = (next: BoardView) => {
    localStorage.setItem(storage, next)
    navigate(`${boardTo}?variant=vues-onglet&vue=${next}`)
  }

  return (
    <nav aria-label={label} className="flex shrink-0 items-center gap-5 overflow-x-auto border-b border-line px-4">
      {tabs.map((tab) => {
        const board = tab.to === boardTo
        return (
          <span key={tab.to} className="flex shrink-0 items-center">
            <NavLink
              to={board ? `${boardTo}?variant=vues-onglet&vue=${current}` : tab.to}
              end={tab.end}
              className={({ isActive }) => cx(tabItemClass(isActive), 'shrink-0')}
            >
              {/* L'onglet du Tableau porte l'icône de la vue courante. */}
              <span className="shrink-0 text-ink-faint">{board ? currentOption.icon : tab.icon}</span>
              {tab.label}
              {tab.count === undefined || tab.count === 0 ? null : <TabCount count={tab.count} tone={tab.tone} />}
            </NavLink>
            {board ? (
              <Menu
                trigger={
                  <button
                    type="button"
                    aria-label="Choisir l’affichage du tableau"
                    title={`Affichage : ${currentOption.label}`}
                    className="-ml-1 grid size-6 place-items-center rounded text-ink-faint hover:bg-surface-high hover:text-ink"
                  >
                    <ChevronDown size={13} />
                  </button>
                }
              >
                {BOARD_VIEWS.map((option) => (
                  <MenuItem key={option.key} icon={option.icon} onSelect={() => pick(option.key)}>
                    <span className="flex min-w-32 items-center gap-2">
                      {option.label}
                      {option.key === current ? <Check size={13} className="ml-auto text-accent" /> : null}
                    </span>
                  </MenuItem>
                ))}
              </Menu>
            ) : null}
          </span>
        )
      })}
      {action ? <span className="ml-auto flex shrink-0 items-center gap-1.5 py-1.5 pl-3">{action}</span> : null}
    </nav>
  )
}
