import { Flag, FolderPlus, History, Layers, Plus, SquareKanban } from 'lucide-react'
import { useMemo } from 'react'
import { Outlet, useMatch, useNavigate } from 'react-router-dom'
import { CARD_CLOSED_COLUMNS } from '@solera/protocol'
import { Button } from '@solera/ui'
import { HeaderBand } from '../components/HeaderBand'
import { ProjectTabs, type ViewTab } from '../components/project/ProjectTabs'
import { useAllCards } from '../lib/cards'
import { useTranslate } from '../lib/i18n'
import { usePortfolioAskingCount } from '../lib/portfolio'
import { useProjects } from '../lib/projects'

/**
 * La coque du portefeuille : la même grammaire qu'un projet, **un cran au-dessus**.
 *
 * C'est la cinquième décision de l'audit du 2026-10-14, et elle rend deux choses. Les
 * projets d'abord : serrés dans une colonne de 22 rem à côté d'une liste de cartes, ils
 * passaient au second plan, alors que c'est leur page. Le transversal ensuite : *Travail*
 * et le board global ont désormais leur propre largeur au lieu de prendre celle des
 * projets — et c'est ce qui a permis d'écarter un cinquième lieu « Travail », le
 * transversal appartenant à la page qui montre déjà tous les projets. *Travail* s'est
 * depuis fondu dans l'Activité (#117), la même liste que celle d'un projet.
 *
 * Pas de `⋯` dans la bande, à la différence d'un projet : un portefeuille n'a pas de
 * gestes à soi. Un menu n'aurait porté que les vues, que la rangée dit déjà.
 */
export function PortfolioLayout() {
  const navigate = useNavigate()
  const t = useTranslate()

  const { data: projects } = useProjects()
  const visible = useMemo(
    () => (projects ?? []).filter((project) => !project.archivedAt),
    [projects],
  )
  const { cards } = useAllCards(visible)
  const asking = usePortfolioAskingCount()
  const onProjects = useMatch('/projects') !== null

  const openCards = cards.filter((card) => !CARD_CLOSED_COLUMNS.includes(card.column))

  const tabs: ViewTab[] = [
    {
      to: '/projects',
      end: true,
      label: t('place.projects.title'),
      icon: <SquareKanban size={15} />,
      count: visible.length,
    },
    {
      to: '/projects/activity',
      label: t('project.view.activity'),
      icon: <Layers size={15} />,
      // Ce qui te demande quelque chose, comme l'onglet d'un projet : une demande, pas
      // un inventaire, et la seule teinte d'alerte de la rangée.
      count: asking,
      tone: 'caution',
    },
    {
      to: '/projects/board',
      label: t('project.board.title'),
      icon: <SquareKanban size={15} />,
      count: openCards.length,
    },
    {
      to: '/projects/timeline',
      label: t('project.view.timeline'),
      icon: <Flag size={15} />,
    },
    {
      to: '/projects/journal',
      label: t('portfolio.view.journal'),
      icon: <History size={15} />,
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderBand>
        <SquareKanban size={16} className="shrink-0 text-ink-faint" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{t('place.projects.title')}</h1>
        <Button
          size="sm"
          aria-label={t('shell.conversation.new')}
          icon={<Plus size={16} />}
          onClick={() => navigate('/c/new')}
        >
          <span className="hidden sm:inline">{t('board.newConversation.short')}</span>
        </Button>
      </HeaderBand>

      <ProjectTabs
        label={t('portfolio.views')}
        tabs={tabs}
        action={
          onProjects ? (
            <Button size="sm" icon={<FolderPlus size={15} />} onClick={() => navigate('/projects/new')}>
              {t('portfolio.action.newProject')}
            </Button>
          ) : null
        }
      />

      <div className="relative min-h-0 min-w-0 flex-1 overflow-clip">
        <Outlet />
      </div>
    </div>
  )
}
