import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, EmptyState } from '@solera/ui'
import { ProjectAvatar } from '../components/ProjectAvatar'
import { PlaceShell, type PlaceTab } from '../components/places/PlaceShell'
import { askingCount, useLiveConversations } from '../lib/activity'
import { useSessionRequests } from '../lib/session-requests'
import { useCards } from '../lib/cards'
import { useAllConversations } from '../lib/conversations'
import { useTranslate } from '../lib/i18n'
import { openLeafCount } from '../lib/place'
import { PROJECT_TABS, type ProjectTabKey } from '../lib/project-tabs'
import { useProjects } from '../lib/projects'

/**
 * La coque d'un projet : la bande, la rangée de ses vues, Réglages au bout.
 *
 * Une route de disposition et non un en-tête recopié dans chaque page : la bande **ne
 * dépend pas de la vue**, donc elle ne se remonte pas quand on change d'onglet, et le
 * focus ne saute pas. Les pages qui s'y logent n'ont plus de bande ni d'en-tête propre :
 * elles commencent à leur contenu. Les réglages en sont une comme les autres.
 *
 * Hors de la coque, volontairement : les conversations (`/c/*`), qui ont leur propre
 * bande, le nom de la session y valant celui du projet.
 *
 * Référence : `docs/specs/2026-11-page-projet-v2/coque.md` (branche `proto/page-projet`),
 * COQ-1 à COQ-11.
 */
export function ProjectLayout() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const t = useTranslate()

  const { data: projects, isPending } = useProjects()
  const { data: cards } = useCards(projectId)
  const { data: conversations } = useAllConversations()
  const mine = useMemo(
    () => (conversations ?? []).filter((entry) => entry.projectId === projectId),
    [conversations, projectId],
  )
  const live = useLiveConversations(mine)
  const requests = useSessionRequests(projectId, live)

  const project = projects?.find((entry) => entry.id === projectId)

  if (isPending) return null
  if (!projectId || !project) return <EmptyState title={t('project.notFound')} />

  /* Ce qui te demande quelque chose, erreurs comprises, et pas le nombre de sessions :
     le compte de Travail est une demande, d'où l'ambre. Celui du Tableau est un
     inventaire, gris. Jalons n'en a pas ; celui d'Actions (vert « en marche », ambre
     « à relire ») arrive avec sa vue. */
  const asking = askingCount(live, requests)
  const open = openLeafCount(cards)
  const counts: Partial<Record<ProjectTabKey, Partial<PlaceTab>>> = {
    travail: {
      count: asking,
      tone: 'caution',
      countTitle: t(asking === 1 ? 'place.count.asking.one' : 'place.count.asking.many', { count: asking }),
    },
    board: {
      count: open,
      countTitle: t(open === 1 ? 'place.count.openCards.one' : 'place.count.openCards.many', { count: open }),
    },
  }
  const tabs: PlaceTab[] = PROJECT_TABS.map((tab) => ({
    to: `/p/${projectId}${tab.path}`,
    end: tab.path === '',
    label: t(tab.label),
    icon: <tab.icon size={15} />,
    ...counts[tab.key],
  }))

  return (
    <PlaceShell
      icon={<ProjectAvatar project={project} className="size-5 shrink-0" />}
      title={project.name}
      label={t('project.views')}
      tabs={tabs}
      settings={{ to: `/p/${projectId}/settings`, label: t('project.settings.title') }}
      actions={
        /* Au doigt l'intitulé ferait passer la bande à deux lignes : l'icône suffit, et
           le nom reste porté par le bouton pour qui ne voit pas. */
        <Button
          size="sm"
          aria-label={t('board.newConversation.short')}
          icon={<Plus size={16} />}
          onClick={() => navigate(`/p/${projectId}/c/new`)}
        >
          <span className="hidden sm:inline">{t('board.newConversation.short')}</span>
        </Button>
      }
    />
  )
}
