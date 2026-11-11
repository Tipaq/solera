import { Flag, Layers, Plus, SquareKanban, Target, Zap } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CARD_CLOSED_COLUMNS } from '@solera/protocol'
import { Button, EmptyState } from '@solera/ui'
import { ProjectAvatar } from '../components/ProjectAvatar'
import { actionsTabCount, useActionsCount } from '../components/prototype/actionsCount'
import { PlaceShell, type PlaceTab } from '../components/prototype/PlaceShell'
import { askingCount, useLiveConversations } from '../lib/activity'
import { useSessionRequests } from '../lib/session-requests'
import { useCards } from '../lib/cards'
import { useAllConversations } from '../lib/conversations'
import { useTranslate } from '../lib/i18n'
import { useProjects } from '../lib/projects'

/**
 * Le paramètre par lequel une vue ouvre son propre dialogue de création.
 *
 * C'est ce qui permet à la rangée de porter *+ Carte* et *+ Tâche* sans connaître les
 * dialogues : elle écrit l'intention dans l'adresse, la vue la lit. Une autre voie
 * aurait été de faire remonter un gestionnaire depuis la page, ce qui demande un
 * contexte, un effet et un ordre de montage ; celle-ci survit en plus à un
 * rechargement et se partage par lien.
 */
export const NEW_PARAM = 'nouvelle'

/**
 * La coque d'un projet : la bande, puis la rangée de ses vues.
 *
 * Une route de disposition et non un en-tête recopié dans chaque page : c'est ce qui
 * rend la décision 2 de l'audit littérale — la bande **ne dépend pas de la vue**, donc
 * elle ne se remonte pas quand on change d'onglet, et le focus ne saute pas. Les pages
 * qui s'y logent n'ont plus de bande ni d'en-tête propre : elles commencent à leur
 * contenu.
 *
 * Hors de la coque, volontairement : les réglages du projet (`/settings`, qui n'est pas
 * une vue mais une destination du `⋯`) et les conversations (`/c/*`, qui ont leur propre
 * bande, le nom de la session y valant celui du projet).
 *
 * Référence d'interface : `docs/audits/2026-10-14-gestion-de-projet/final/pages/`,
 * écrans F1 à F5, et F14 au téléphone.
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
  const actionsCount = actionsTabCount(useActionsCount(projectId))

  const project = projects?.find((entry) => entry.id === projectId)

  if (isPending) return null
  if (!projectId || !project) return <EmptyState title={t('project.notFound')} />

  /* Les cartes **ouvertes**, pas l'inventaire : « 9 » doit dire ce qui reste à faire,
     et compter le cimetière ferait monter le nombre à mesure qu'on avance. Les feuilles
     seulement, comme le kanban : une parente compterait deux fois le travail de ses
     enfants. */
  const openCards = (cards ?? []).filter((card) => card.children.length === 0 && !CARD_CLOSED_COLUMNS.includes(card.column))

  /* PROTOTYPE : la rangée retenue (2026-11-11), la même que celle du portefeuille —
     Aperçu · Travail · Tableau · Jalons · Actions, puis Réglages au bout. Règle des
     comptes, trois tons : ambre pour ce qui t'attend, vert pour ce qui tourne, gris pour
     un inventaire. */
  const tabs: PlaceTab[] = [
    { to: `/p/${projectId}`, end: true, label: t('project.view.overview'), icon: <Target size={15} /> },
    { to: `/p/${projectId}/travail`, label: 'Travail', icon: <Layers size={15} />, count: askingCount(live, requests), tone: 'caution' },
    { to: `/p/${projectId}/board`, label: 'Tableau', icon: <SquareKanban size={15} />, count: openCards.length },
    { to: `/p/${projectId}/timeline`, label: 'Jalons', icon: <Flag size={15} /> },
    // Le ⚡ de la bande est retiré : l'onglet porte ce qu'il disait — ambre « N à relire »,
    // sinon vert « N en marche ».
    { to: `/p/${projectId}/actions`, label: 'Actions', icon: <Zap size={15} />, count: actionsCount?.count, tone: actionsCount?.tone, countTitle: actionsCount?.title },
  ]

  return (
    <PlaceShell
      icon={<ProjectAvatar project={project} className="size-5 shrink-0" />}
      title={project.name}
      label={t('project.views')}
      tabs={tabs}
      settings={{ to: `/p/${projectId}/settings`, title: t('project.settings.title') }}
      actions={
        <>
          {/* PROTOTYPE : le ⚡ est retiré de la bande (2026-11-11) : l'onglet Actions est
              à un clic, et son compte vert dit ce qui tourne. */}
          {/* Au doigt l'intitulé ferait passer la bande à deux lignes : l'icône suffit,
              et le nom reste porté par le bouton pour qui ne voit pas. */}
          <Button
            size="sm"
            aria-label={t('board.newConversation.short')}
            icon={<Plus size={16} />}
            onClick={() => navigate(`/p/${projectId}/c/new`)}
          >
            <span className="hidden sm:inline">{t('board.newConversation.short')}</span>
          </Button>
        </>
      }
    />
  )
}
