import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Archive,
  CalendarClock,
  ChevronRight,
  FolderPlus,
  MessagesSquare,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  SlidersHorizontal,
  SquareKanban,
  SquareTerminal,
  Target,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, useMatch, useNavigate } from 'react-router-dom'
import type { ConversationDto, ProjectDto } from '@solera/protocol'
import { useOpenConversationId } from '../../lib/conversation-route'
import { useTranslate } from '../../lib/i18n'
import { PROJECT_COLORS } from '../../lib/project-colors'
import { useUpdateProject } from '../../lib/projects'
import { useLiveConversations } from '../../lib/activity'
import { useHasUnread } from '../../lib/reads'
import { mostUrgent, threadState } from '../../lib/signals'
import { useUpdateCollapsedProjects, useUserSettings } from '../../lib/user-settings'
import { ProjectAvatar } from '../ProjectAvatar'
import { StateDot } from '../chat/Signals'
import { ConversationLine } from './ConversationLine'
import { RenameInput } from './RenameInput'
import {
  cx,
  IconButton,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSwatch,
  MenuSwatchRow,
  Tooltip,
  TooltipButton,
} from '@solera/ui'

/** Au-delà, le reste est compté sur une ligne : « 26 autres sessions… ». */
const SESSIONS_SHOWN = 10

/**
 * Neutralise le clic qui suit immédiatement un glisser-déposer.
 *
 * L'écouteur est posé en phase de capture pour passer avant le lien, et retiré au tour
 * de boucle suivant : si le glissement n'a produit aucun clic, il ne doit surtout pas
 * manger le clic légitime d'après.
 */
function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
}

/**
 * Souris : un seuil de déplacement, pour que le clic sur un lien reste un clic.
 * Tactile : un appui long, sinon le glissement volerait le défilement de la liste.
 */
function useDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )
}

/**
 * Le lieu *Projets* : l'arbre des projets.
 *
 * Le projet ouvert au centre est déplié, les autres sont des lignes. Le dépli est un
 * état du compte : **rien ne se déplie ni ne se replie tout seul**, et aucune ligne
 * n'est surlignée quand ce qui est ouvert n'appartient pas à ce lieu. On retrouve la
 * colonne telle qu'on l'a laissée ; c'est la bande du haut qui dit où l'on est.
 *
 * Plus de `ProjectSwitcher` au-dessus — 12 rem de haut à lui seul — ni de bouton *tous
 * les projets* : les projets sont là, dépliés ou non.
 */
export function PlaceProjects({ projects, conversations, onNavigate, onReorder }: {
  projects: ProjectDto[]
  conversations: ConversationDto[]
  onNavigate: () => void
  onReorder: (ids: string[]) => void
}) {
  const t = useTranslate()
  const sensors = useDragSensors()
  /** Le projet ouvert au centre, quelle que soit sa page : son groupe suit. */
  const openProjectId = useMatch('/p/:projectId/*')?.params.projectId

  /**
   * Le repli vient du compte, pas du navigateur : on referme un projet parce qu'on n'y
   * travaille pas en ce moment, ce qui reste vrai d'un poste à l'autre.
   */
  const { data: settings } = useUserSettings()
  const setCollapsedProjects = useUpdateCollapsedProjects()
  const collapsed = useMemo(
    () => new Set(settings?.collapsedProjects ?? []),
    [settings?.collapsedProjects],
  )
  const toggle = (projectId: string) => {
    const next = new Set(collapsed)
    if (!next.delete(projectId)) next.add(projectId)
    setCollapsedProjects.mutate([...next])
  }

  /**
   * Pendant qu'on déplace un projet, toutes les conversations sont repliées : un projet
   * qui en porte trente rend la liste plus haute que l'écran et le glissement devient
   * impraticable. Temporaire, et sans écraser les replis voulus.
   */
  const [dragging, setDragging] = useState(false)

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(false)
    // Un glissement se termine par un `mouseup` sur le lien du projet : sans avaler le
    // clic qui suit, réordonner ouvrirait le projet déplacé.
    swallowNextClick()
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = projects.map((project) => project.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    onReorder(arrayMove(ids, from, to))
  }

  const free = useMemo(
    () => conversations.filter((entry) => entry.projectId === null),
    [conversations],
  )

  if (projects.length === 0 && free.length === 0) {
    return (
      <div className="px-2 pb-4">
        <p className="px-2.5 py-2 text-sm text-ink-faint">{t('shell.projects.empty')}</p>
        <NewProjectRow onNavigate={onNavigate} />
      </div>
    )
  }

  return (
    <div className="px-2 pb-4">
      {/* *Sans projet* ouvre la liste, avant les projets : c'est une boîte de réception,
          pas un cas particulier qu'on range en bas. Hors du contexte de glissement — on
          ne réordonne que des projets, et ce groupe n'en est pas un. */}
      {free.length > 0 ? (
        <ul>
          <FreeThreadsGroup conversations={free} onNavigate={onNavigate} />
        </ul>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragStart={() => setDragging(true)}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragging(false)
          swallowNextClick()
        }}
      >
        <SortableContext items={projects.map((project) => project.id)} strategy={verticalListSortingStrategy}>
          <ul>
            {projects.map((project) => (
              <ProjectGroup
                key={project.id}
                project={project}
                conversations={conversations.filter((entry) => entry.projectId === project.id)}
                // Le projet qui porte la conversation ouverte se déplie d'office :
                // la colonne suit ce qu'on lit, et une ligne sélectionnée sous un
                // groupe fermé ne se voit pas.
                open={!dragging && (!collapsed.has(project.id) || project.id === openProjectId)}
                onToggle={() => toggle(project.id)}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <NewProjectRow onNavigate={onNavigate} />
    </div>
  )
}

/**
 * Le groupe *Sans projet*, en tête de la liste.
 *
 * Une conversation neuve n'appartient à rien (carte #14) : ses fils doivent donc avoir
 * un domicile visible, sans quoi ils ne s'atteignent que par la palette. Pas d'avatar,
 * pas de `⋯`, pas de board ni de planification — il n'y a pas de projet derrière, juste
 * des fils.
 *
 * Le repli reste local au navigateur, à la différence de celui d'un projet : le réglage
 * du compte est une liste d'identifiants de projets, validée comme des UUID côté serveur,
 * et ce groupe n'en a pas.
 */
function FreeThreadsGroup({ conversations, onNavigate }: {
  conversations: ConversationDto[]
  onNavigate: () => void
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(true)
  const openConversationId = useOpenConversationId()
  // Même règle que dans un projet : le groupe liste tout ce qui n'est pas rangé, y
  // compris ce qui travaille.
  const sessions = useMemo(
    () => conversations.filter((entry) => !entry.archivedAt),
    [conversations],
  )
  const archived = useMemo(() => conversations.filter((entry) => entry.archivedAt), [conversations])
  const hasUnread = useHasUnread(conversations, openConversationId)

  return (
    <li>
      <div className="group flex h-11 items-center gap-0.5 rounded-md pr-1 text-ink transition-colors hover:bg-surface-high md:h-9 pointer-coarse:h-11">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm font-semibold"
        >
          <MessagesSquare size={16} className="shrink-0 text-ink-faint" />
          <span className="truncate">{t('destination.none')}</span>
          {!open && hasUnread ? (
            <span title={t('shell.project.unread')}><StateDot state="unread" labelled={false} /></span>
          ) : null}
        </button>

        <Tooltip label={t('shell.conversation.new')}>
          <NavLink
            to="/c/new"
            onClick={onNavigate}
            aria-label={t('shell.conversation.new')}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-high hover:text-ink"
          >
            <Plus size={14} />
          </NavLink>
        </Tooltip>

        <TooltipButton
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? t('shell.threads.collapseFree') : t('shell.threads.expandFree')}
          aria-expanded={open}
          className="flex size-11 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink md:size-6 pointer-coarse:size-11"
        >
          <ChevronRight size={14} className={cx('transition-transform', open && 'rotate-90')} />
        </TooltipButton>
      </div>

      {open ? (
        <div className="mb-1 ml-3 border-l border-line pl-1.5">
          {sessions.length === 0 ? (
            <p className="px-2.5 py-1 text-xs text-ink-faint">{t('shell.conversations.empty')}</p>
          ) : (
            <ul>
              {sessions.map((conversation) => (
                <ConversationLine
                  key={conversation.id}
                  conversation={conversation}
                  onNavigate={onNavigate}
                  // Un fil libre n'a pas d'ordre à défendre : rien ne le réordonne.
                />
              ))}
            </ul>
          )}
          {archived.length > 0 ? (
            <ArchivedSection conversations={archived} onNavigate={onNavigate} />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function NewProjectRow({ onNavigate }: { onNavigate: () => void }) {
  const t = useTranslate()
  return (
    <NavLink
      to="/projects/new"
      onClick={onNavigate}
      className="flex h-11 items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-faint transition-colors hover:bg-surface-high hover:text-ink md:h-9 pointer-coarse:h-11"
    >
      <FolderPlus size={16} className="shrink-0" />
      {t('shell.projects.new')}
    </NavLink>
  )
}

function ProjectGroup({
  project,
  conversations,
  open,
  onToggle,
  onNavigate,
}: {
  project: ProjectDto
  /** Actives et rangées mêlées : le groupe fait lui-même la coupure. */
  conversations: ConversationDto[]
  open: boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const updateProject = useUpdateProject()
  const openConversationId = useOpenConversationId()
  /*
    Le groupe liste **toutes** les sessions du projet, actives comprises. Elles en
    étaient retirées tant qu'elles figuraient dans l'activité, pour ne pas les écrire
    deux fois — mais une session qu'un agent vient de lancer naissait alors invisible
    de son propre projet, et n'y apparaissait qu'une fois calmée. Un sommaire de projet
    qui perd sa ligne au moment où elle devient intéressante ne sert plus à rien ;
    l'activité, elle, est un triage transversal, et la répétition est son prix.

    Les tirs planifiés restent dehors : une tâche horaire poserait vingt-quatre lignes
    par jour. Le groupe ne montre donc que les sessions, et le lieu *Planifiées* juste
    au-dessus les tâches elles-mêmes — jamais ce qu'elles ont lancé. C'est la décision de
    la carte #35, prise quand la colonne dépliait encore les vues d'un projet sous sa
    ligne ; la carte #31 a depuis retiré ces sous-liens, et l'historique des tirs, sur la
    vue *Planifiées* du projet, est devenu l'unique route vers le fil d'un tir.
  */
  const sessions = useMemo(
    () => conversations.filter((entry) => !entry.archivedAt && !entry.scheduleId),
    [conversations],
  )
  /*
    Les deux points d'état de la ligne, selon la charte de `threadState` : celui du
    travail en cours, et celui de ce qui réclame — le plus urgent des fils qui attendent
    ou n'ont pas été lus, de la même couleur que sur leur propre ligne. Le flux vivant et non le statut REST — un agent qui démarre doit
    allumer la ligne sans attendre la prochaine requête.

    Les tirs planifiés comptent ici, à la différence de la liste : une tâche qui a planté
    toute seule réclame bien un regard, et sa ligne est précisément celle qu'on ne voit
    pas puisqu'elle n'est pas listée.
  */
  const live = useLiveConversations(conversations, openConversationId ?? undefined)
  const running = live.some((entry) => entry.running)
  const demanding = mostUrgent(
    live
      .filter((entry) => entry.awaiting || entry.unread)
      .map((entry) => threadState({ status: entry.status, busy: entry.running, unread: entry.unread })),
  )
  const archived = useMemo(
    () => conversations.filter((entry) => entry.archivedAt && !entry.scheduleId),
    [conversations],
  )
  const [showAll, setShowAll] = useState(false)
  const visible = showAll
    ? sessions
    : sessions.filter((entry, index) => index < SESSIONS_SHOWN || entry.id === openConversationId)
  const [editing, setEditing] = useState(false)

  /**
   * Seul l'en-tête sert de poignée : des listeners posés sur l'élément entier
   * engloberaient la liste des sessions, qu'on ne déplace plus mais qui reste
   * cliquable ligne à ligne.
   */
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, disabled: editing })

  const commitRename = (draft: string) => {
    setEditing(false)
    const name = draft.trim()
    if (name && name !== project.name) updateProject.mutate({ id: project.id, name })
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(isDragging && 'shadow-float z-10 rounded-md bg-surface-high opacity-90')}
    >
      {/* Le fond est porté par la ligne entière, pas par le lien : sinon les boutons
          d'action se retrouvent visuellement hors de l'élément survolé. */}
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="group flex h-11 items-center gap-0.5 rounded-md pr-1 text-ink transition-colors hover:bg-surface-high md:h-9 pointer-coarse:h-11"
      >
        {editing ? (
          <RenameInput
            value={project.name}
            onCommit={commitRename}
            onCancel={() => setEditing(false)}
            className="h-7 min-w-0 flex-1 rounded border border-accent bg-sunken px-1.5 text-sm text-ink outline-none"
          />
        ) : (
          <NavLink
            /* Toujours le tableau de bord : c'est la porte du projet, et une porte
               ne se déplace pas. Le clic rouvrait la dernière vue consultée, si bien
               qu'un passage par le board la rendait définitive — la page qui dit où en
               est le projet devenait alors introuvable sans taper son adresse. Le
               board et une conversation neuve sont à un clic de là, en haut de page. */
            to={`/p/${project.id}`}
            onClick={onNavigate}
            // Renommer au double-clic, comme dans un explorateur de fichiers.
            onDoubleClick={(event) => {
              event.preventDefault()
              if (project.isOwner) setEditing(true)
            }}
            className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-sm font-semibold"
            title={project.name}
          >
            <ProjectAvatar project={project} className="size-4" />
            <span className="truncate">{project.name}</span>
            {project.activeTerminals > 0 ? (
              <SquareTerminal size={11} className="shrink-0 text-positive" aria-label={t('shell.project.terminals')} />
            ) : null}
            {project.visibility === 'shared' ? (
              <Users size={11} className="shrink-0 text-ink-faint" aria-label={t('shell.project.shared')} />
            ) : null}
          </NavLink>
        )}

        {/*
          Au repos les deux points d'état, au survol le `+` et le `⋯` : ils **cèdent la
          place**, on n'ajoute pas. C'est la limite du parti — la ligne porte quatre
          cibles et pas une de plus, et au doigt, où il n'y a pas de survol, les deux
          boutons sont permanents et le nom est tronqué d'autant.

          Les points disent ce que les sessions réclament, sans aller chercher les
          cartes : la colonne tient déjà toutes les conversations, elle n'a pas de
          requête à faire pour ces deux pastilles.
        */}
        <span
          aria-hidden
          data-project-state
          className="flex shrink-0 items-center gap-1 pr-1 group-hover:hidden group-focus-within:hidden pointer-coarse:hidden"
        >
          {running ? <StateDot state="working" labelled={false} /> : null}
          {demanding ? <StateDot state={demanding} labelled={false} /> : null}
        </span>

        <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex pointer-coarse:flex">
          <Tooltip label={t('shell.project.newConversation', { name: project.name })}>
            <NavLink
              to={`/p/${project.id}/c/new`}
              onClick={onNavigate}
              aria-label={t('shell.project.newConversation', { name: project.name })}
              className="inline-flex size-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-high hover:text-ink pointer-coarse:size-9"
            >
              <Plus size={14} />
            </NavLink>
          </Tooltip>

          {project.isOwner ? (
            <Menu
              trigger={
                <IconButton label={t('shell.project.actions', { name: project.name })} size="sm">
                  <MoreHorizontal size={14} />
                </IconButton>
              }
            >
              {/* Les vues en second rang, et seulement ici : la colonne n'a pas de
                  rangée d'onglets sous les yeux, donc le menu est le seul endroit d'où
                  l'on va droit au board sans passer par l'Aperçu. La bande d'un projet,
                  elle, ne les redit pas — sa rangée est juste en dessous. */}
              <MenuItem icon={<Target size={14} />} onSelect={() => { onNavigate(); navigate(`/p/${project.id}`) }}>
                {t('project.view.overview')}
              </MenuItem>
              <MenuItem icon={<SquareKanban size={14} />} onSelect={() => { onNavigate(); navigate(`/p/${project.id}/board`) }}>
                {t('shell.project.board')}
              </MenuItem>
              <MenuItem icon={<CalendarClock size={14} />} onSelect={() => { onNavigate(); navigate(`/p/${project.id}/schedules`) }}>
                {t('place.schedules.title')}
              </MenuItem>
              <MenuItem icon={<SlidersHorizontal size={14} />} onSelect={() => { onNavigate(); navigate(`/p/${project.id}/settings`) }}>
                {t('shell.project.settings')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Pencil size={14} />} onSelect={() => setEditing(true)}>
                {t('shell.rename')}
              </MenuItem>
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
            </Menu>
          ) : null}
        </span>

        <TooltipButton
          type="button"
          onClick={onToggle}
          aria-label={open ? t('shell.project.collapse', { name: project.name }) : t('shell.project.expand', { name: project.name })}
          aria-expanded={open}
          className="flex size-11 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink md:size-6 pointer-coarse:size-11"
        >
          <ChevronRight size={14} className={cx('transition-transform', open && 'rotate-90')} />
        </TooltipButton>
      </div>

      {open ? (
        /*
          Le filet qui tient le contenu d'un projet prend sa couleur.

          C'est le seul endroit où elle travaille quand le projet a une image : la
          pastille de `ProjectAvatar`, son unique rendu jusqu'ici, ne paraît qu'à défaut
          de logo. Un filet déjà présent plutôt qu'une surface de plus — la colonne a
          son compte de couleurs, et celle-ci n'a pas à crier : mêlée au trait de
          séparation, elle marque le bloc d'un projet sans se lire comme un état.

          Rien pour qui n'a rien choisi : `null` veut dire « l'accent du thème », et un
          filet d'accent sous chaque projet ne distinguerait plus personne.
        */
        <div
          className="mb-1 ml-3 border-l border-line pl-1.5"
          style={project.color
            ? { borderColor: `color-mix(in oklch, var(--sg-line), ${project.color} 70%)` }
            : undefined}
        >
          {/* Plus aucun sous-lien de vue, et plus d'en-tête « Sessions » : les onglets
              portent les vues — c'est la fin de l'hésitation « je clique le sous-lien ou
              l'onglet ? » — et sous un projet déplié il n'y a que des sessions, ce que
              le filet de couleur dit déjà. Le `+` qui créait une conversation est
              remonté sur la ligne du projet, où le survol l'offre. */}
          {sessions.length === 0 ? (
            <p className="px-2.5 py-1 text-xs text-ink-faint">{t('shell.conversations.empty')}</p>
          ) : (
            <ul>
              {visible.map((conversation) => (
                <ConversationLine key={conversation.id} conversation={conversation} onNavigate={onNavigate} />
              ))}
            </ul>
          )}

          {/* « 26 autres sessions… » plutôt que « Voir les 26 sessions » : le reste est
              compté, et le libellé ne promet pas une page qui n'existe pas. */}
          {sessions.length > visible.length || showAll ? (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="flex h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-ink-faint transition-colors hover:bg-surface-high hover:text-ink md:h-8 pointer-coarse:h-11"
            >
              <MessagesSquare size={14} className="shrink-0" />
              {showAll
                ? t('shell.sessions.less')
                : t('shell.sessions.more', { count: sessions.length - visible.length })}
            </button>
          ) : null}

          {archived.length > 0 ? (
            <ArchivedSection conversations={archived} onNavigate={onNavigate} />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/**
 * Repliée et en fin de liste : ce qui est rangé doit rester atteignable sans revenir
 * peser sur ce qu'on a sous les yeux. Hors de tout contexte de glissement, les archivées
 * n'ayant pas d'ordre à défendre.
 */
function ArchivedSection({ conversations, onNavigate }: {
  conversations: ConversationDto[]
  onNavigate: () => void
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-ink-faint transition-colors hover:bg-surface-high hover:text-ink-soft md:h-8 pointer-coarse:h-11"
      >
        <Archive size={14} className="shrink-0" />
        <span className="flex-1">{t('shell.conversations.archived', { count: String(conversations.length) })}</span>
        <ChevronRight size={11} className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open ? (
        <ul>
          {conversations.map((conversation) => (
            <ConversationLine
              key={conversation.id}
              conversation={conversation}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
