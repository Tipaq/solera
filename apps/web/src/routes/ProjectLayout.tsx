import {
  CalendarClock,
  GitBranch,
  History,
  MoreHorizontal,
  Palette,
  Plus,
  SlidersHorizontal,
  SquareKanban,
  Target,
} from 'lucide-react'
import { Outlet, useMatch, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CARD_CLOSED_COLUMNS } from '@solera/protocol'
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSwatch,
  MenuSwatchRow,
} from '@solera/ui'
import { HeaderBand } from '../components/HeaderBand'
import { ProjectAvatar } from '../components/ProjectAvatar'
import { ProjectTabs, type ViewTab } from '../components/project/ProjectTabs'
import { useCards } from '../lib/cards'
import { useTranslate } from '../lib/i18n'
import { PROJECT_COLORS } from '../lib/project-colors'
import { useProjects, useUpdateProject } from '../lib/projects'
import { useSchedules } from '../lib/schedules'

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
  const [, setParams] = useSearchParams()

  const { data: projects, isPending } = useProjects()
  const { data: cards } = useCards(projectId)
  const { data: schedules } = useSchedules()
  const updateProject = useUpdateProject()

  const project = projects?.find((entry) => entry.id === projectId)
  const onBoard = useMatch('/p/:projectId/board') !== null
  const onSchedules = useMatch('/p/:projectId/schedules') !== null

  if (isPending) return null
  if (!projectId || !project) return <EmptyState title={t('project.notFound')} />

  /* Les cartes **ouvertes**, pas l'inventaire : « 9 » doit dire ce qui reste à faire,
     et compter le cimetière ferait monter le nombre à mesure qu'on avance. */
  const openCards = (cards ?? []).filter((card) => !CARD_CLOSED_COLUMNS.includes(card.column))
  const tasks = (schedules ?? []).filter((task) => task.projectId === projectId)

  const tabs: ViewTab[] = [
    {
      to: `/p/${projectId}`,
      end: true,
      label: t('project.view.overview'),
      icon: <Target size={15} />,
    },
    {
      to: `/p/${projectId}/board`,
      label: t('project.board.title'),
      icon: <SquareKanban size={15} />,
      count: openCards.length,
    },
    {
      to: `/p/${projectId}/schedules`,
      label: t('place.schedules.title'),
      icon: <CalendarClock size={15} />,
      count: tasks.length,
    },
    {
      to: `/p/${projectId}/journal`,
      label: t('project.view.journal'),
      icon: <History size={15} />,
      /* Sans compteur, et c'est voulu : un journal n'a pas de reste à faire. Le nombre
         de lignes des quinze derniers jours dirait l'inventaire que le gabarit interdit
         au bandeau, et coûterait de surcroît un `git log` par projet rien que pour
         dessiner la rangée. */
    },
    /* Pas d'onglet *Chronologie* pour l'instant : elle attend que les échéances et les
       jalons de la carte #36 aient de quoi remplir un axe. Un onglet qui mène à une
       page vide est pire que son absence — il promet une vue et rend une erreur. */
  ]

  /* L'Aperçu est la seule vue sans action propre : elle ne crée rien, elle envoie. */
  const action =
    onBoard || onSchedules ? (
      <Button
        size="sm"
        icon={<Plus size={15} />}
        onClick={() => setParams((current) => {
          current.set(NEW_PARAM, '1')
          return current
        })}
      >
        {t(onBoard ? 'project.action.newCard' : 'project.action.newTask')}
      </Button>
    ) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderBand>
        <ProjectAvatar project={project} className="size-5 shrink-0" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</h1>
        {project.git ? (
          <span className="hidden sm:block">
            <Badge icon={<GitBranch size={11} />}>{project.git.branch}</Badge>
          </span>
        ) : null}
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
        {/* Le `⋯` ne navigue plus vers une vue : la rangée est juste en dessous, et
            redire les quatre vues ici est exactement la redondance que l'audit est
            venu défaire. Il ne porte donc que les gestes du projet. */}
        <Menu
          trigger={
            <IconButton label={t('place.project.menu')} size="sm">
              <MoreHorizontal size={16} />
            </IconButton>
          }
        >
          <MenuItem
            icon={<SlidersHorizontal size={16} />}
            onSelect={() => navigate(`/p/${projectId}/settings`)}
          >
            {t('project.settings.title')}
          </MenuItem>
          {project.isOwner ? (
            <>
              <MenuSeparator />
              <MenuLabel>
                <span className="flex items-center gap-1.5"><Palette size={11} /> {t('shell.color')}</span>
              </MenuLabel>
              <MenuSwatchRow>
                {PROJECT_COLORS.map((entry) => (
                  <MenuSwatch
                    key={entry.value ?? 'default'}
                    color={entry.value}
                    label={t(entry.label)}
                    selected={project.color === entry.value}
                    onSelect={() => updateProject.mutate({ id: project.id, color: entry.value })}
                  />
                ))}
              </MenuSwatchRow>
            </>
          ) : null}
        </Menu>
      </HeaderBand>

      <ProjectTabs label={t('project.views')} tabs={tabs} action={action} />

      {/* `relative` : le tiroir de carte et le panneau du board s'y posent en absolu.
          Ils ne recouvrent donc plus la bande ni la rangée, ce qui est le but — la
          bande d'un projet reste lisible pendant qu'on lit un diff. */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-clip">
        <Outlet />
      </div>
    </div>
  )
}
