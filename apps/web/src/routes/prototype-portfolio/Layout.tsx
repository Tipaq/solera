/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * La coque du portefeuille v2 : la même que celle d'un projet (bande, rangée d'onglets
 * Aperçu · Travail · Tableau · Jalons · Actions), pour tous les projets. Pas d'onglet
 * Réglages de projet : à droite, les réglages de l'instance, qui s'ouvrent en fenêtre.
 * `?variant=actuel` rend la coque d'avant.
 */
import { Flag, FolderKanban, Layers, Plus, SquareKanban, Target, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CARD_CLOSED_COLUMNS } from '@solera/protocol'
import { Button } from '@solera/ui'
import { PlaceShell, type PlaceTab } from '../../components/prototype/PlaceShell'
import { usePrototypeVariant } from '../../components/PrototypeSwitcher'
import { usePortfolioAskingCount } from '../../lib/portfolio'
import { openSettings } from '../../lib/settings-dialog'
import { usePortfolioV2 } from './data'

export const PORTFOLIO_VARIANTS = [
  { key: 'v2', name: 'Portefeuille v2 : la coque d’un projet, tous projets' },
  { key: 'actuel', name: 'Portefeuille actuel' },
]

/** Rend `v2` sauf avec `?variant=actuel`. */
export function usePortfolioVariant(): 'v2' | 'actuel' {
  return usePrototypeVariant(PORTFOLIO_VARIANTS) === 'actuel' ? 'actuel' : 'v2'
}

/** Une route du portefeuille : la page v2, ou l'ancienne avec `?variant=actuel`. */
export function PortfolioSwitch({ v2, children }: { v2: ReactNode; children: ReactNode }) {
  return <>{usePortfolioVariant() === 'actuel' ? children : v2}</>
}

export function PortfolioV2Layout() {
  const navigate = useNavigate()
  const data = usePortfolioV2()
  const asking = usePortfolioAskingCount()
  const openCards = data.cards.filter((card) => card.children.length === 0 && !CARD_CLOSED_COLUMNS.includes(card.column)).length

  /* Même rangée et même règle des comptes que dans un projet (`PlaceShell`) : ambre pour
     ce qui t'attend (Travail), gris pour un inventaire (Tableau). Aperçu, Jalons et
     Actions sans compte, comme dans un projet. */
  const tabs: PlaceTab[] = [
    { to: '/projects', end: true, label: 'Aperçu', icon: <Target size={15} /> },
    { to: '/projects/travail', label: 'Travail', icon: <Layers size={15} />, count: data.demo ? data.inbox.length : asking, tone: 'caution' },
    { to: '/projects/board', label: 'Tableau', icon: <SquareKanban size={15} />, count: openCards },
    { to: '/projects/timeline', label: 'Jalons', icon: <Flag size={15} /> },
    { to: '/projects/actions', label: 'Actions', icon: <Zap size={15} /> },
  ]

  return (
    <PlaceShell
      icon={<FolderKanban size={16} className="text-ink-faint" />}
      title="Projets"
      label="Vues du portefeuille"
      tabs={tabs}
      search={data.demo ? '?demo=1' : ''}
      settings={{ onOpen: () => openSettings(null), title: 'Réglages de l’instance' }}
      actions={
        <Button size="sm" aria-label="Nouveau projet" icon={<Plus size={16} />} onClick={() => navigate('/projects/new')}>
          <span className="hidden sm:inline">Projet</span>
        </Button>
      }
    />
  )
}
