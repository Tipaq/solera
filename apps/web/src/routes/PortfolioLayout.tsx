import { Flag, FolderKanban, Layers, Plus, SquareKanban, Target } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@solera/ui'
import { PlaceShell, type PlaceTab } from '../components/places/PlaceShell'
import { useAllCards } from '../lib/cards'
import { useTranslate } from '../lib/i18n'
import { openLeafCount } from '../lib/place'
import { usePortfolioAskingCount } from '../lib/portfolio'
import { useProjects } from '../lib/projects'
import { openSettings } from '../lib/settings-dialog'

/**
 * La coque du portefeuille : la même qu'un projet (`PlaceShell`), **un cran au-dessus**
 * (`coque.md` PF-1 à PF-4).
 *
 * La bande porte un seul geste, « + Projet », le même sur toutes les vues ; une
 * conversation se lance depuis la barre latérale. La rangée ne porte que des vues —
 * Aperçu, Travail, Tableau, Jalons, Actions —, avec la règle des comptes d'un projet :
 * gris pour un inventaire (Tableau). Pas d'onglet Réglages de projet : au bout, ceux de
 * l'instance, qui s'ouvrent en fenêtre.
 *
 * Travail porte le compte ambre de ce qui te demande quelque chose, dans tous les
 * projets. Actions n'a pas encore sa vue du portefeuille (#241) : son onglet est masqué
 * jusque-là, plutôt que de mener hors de la coque. Tableau et Jalons mènent aux vues
 * actuelles.
 */
export function PortfolioLayout() {
  const navigate = useNavigate()
  const t = useTranslate()

  const { data: projects } = useProjects()
  const visible = useMemo(() => (projects ?? []).filter((project) => !project.archivedAt), [projects])
  const { cards } = useAllCards(visible)
  const open = openLeafCount(cards)
  const asking = usePortfolioAskingCount()

  const tabs: PlaceTab[] = [
    { to: '/projects', end: true, label: t('project.view.overview'), icon: <Target size={15} /> },
    {
      to: '/projects/travail',
      label: t('project.view.travail'),
      icon: <Layers size={15} />,
      count: asking,
      tone: 'caution',
      countTitle: t(asking === 1 ? 'place.count.asking.one' : 'place.count.asking.many', { count: asking }),
    },
    {
      to: '/projects/board',
      label: t('project.board.title'),
      icon: <SquareKanban size={15} />,
      count: open,
      countTitle: t(open === 1 ? 'place.count.openCards.one' : 'place.count.openCards.many', { count: open }),
    },
    { to: '/projects/timeline', label: t('project.view.timeline'), icon: <Flag size={15} /> },
  ]

  return (
    <PlaceShell
      icon={<FolderKanban size={16} className="shrink-0 text-ink-faint" />}
      title={t('place.projects.title')}
      label={t('portfolio.views')}
      tabs={tabs}
      settings={{ onOpen: () => openSettings(), label: t('place.settings.instance') }}
      actions={
        <Button size="sm" aria-label={t('portfolio.action.newProjectLabel')} icon={<Plus size={16} />} onClick={() => navigate('/projects/new')}>
          <span className="hidden sm:inline">{t('portfolio.action.newProject')}</span>
        </Button>
      }
    />
  )
}
