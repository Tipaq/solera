import { Flag, FolderPlus, History, Layers, Plus, SquareKanban } from 'lucide-react'
import { useMemo } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { CARD_CLOSED_COLUMNS } from '@solera/protocol'
import { Button } from '@solera/ui'
import { PlaceShell, type PlaceTab } from '../components/places/PlaceShell'
import { useAllCards } from '../lib/cards'
import { useTranslate } from '../lib/i18n'
import { usePortfolioAskingCount } from '../lib/portfolio'
import { useProjects } from '../lib/projects'
import { openSettings } from '../lib/settings-dialog'

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
 * La même coque qu'un projet (`PlaceShell`) : la bande porte les gestes, la rangée ne
 * porte que des vues, et Réglages au bout ouvre ceux de l'instance. Ses vues v2
 * arrivent avec le jalon 6 de la page projet v2.
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

  const tabs: PlaceTab[] = [
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
    <PlaceShell
      icon={<SquareKanban size={16} className="shrink-0 text-ink-faint" />}
      title={t('place.projects.title')}
      label={t('portfolio.views')}
      tabs={tabs}
      settings={{ onOpen: () => openSettings(), label: t('place.settings.instance') }}
      actions={
        <>
          {/* L'action de la vue Projets quitte la rangée pour la bande : la rangée ne
              porte plus que des vues. */}
          {onProjects ? (
            <Button size="sm" variant="secondary" aria-label={t('portfolio.action.newProject')} icon={<FolderPlus size={15} />} onClick={() => navigate('/projects/new')}>
              <span className="hidden sm:inline">{t('portfolio.action.newProject')}</span>
            </Button>
          ) : null}
          <Button
            size="sm"
            aria-label={t('shell.conversation.new')}
            icon={<Plus size={16} />}
            onClick={() => navigate('/c/new')}
          >
            <span className="hidden sm:inline">{t('board.newConversation.short')}</span>
          </Button>
        </>
      }
    />
  )
}
