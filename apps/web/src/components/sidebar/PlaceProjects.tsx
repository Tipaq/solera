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
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, useMatch, useNavigate } from 'react-router-dom'
import type { ConversationDto, ProjectDto, ScheduledTaskDto } from '@solera/protocol'
import { useReorderConversations } from '../../lib/conversations'
import { useTranslate } from '../../lib/i18n'
import { PROJECT_COLORS } from '../../lib/project-colors'
import { projectViewPath, useProjectView } from '../../lib/project-view'
import { useUpdateProject } from '../../lib/projects'
import { useHasUnread } from '../../lib/reads'
import { useUpdateCollapsedProjects, useUserSettings } from '../../lib/user-settings'
import { ProjectAvatar } from '../ProjectAvatar'
import { ConversationLine } from './ConversationLine'
import { RenameInput } from './RenameInput'
import { useActiveIds } from './live'
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
export function PlaceProjects({ projects, conversations, schedules, onNavigate, onReorder }: {
  projects: ProjectDto[]
  conversations: ConversationDto[]
  schedules: ScheduledTaskDto[]
  onNavigate: () => void
  onReorder: (ids: string[]) => void
}) {
  const t = useTranslate()
  const sensors = useDragSensors()
  const activeIds = useActiveIds(conversations)

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

  if (projects.length === 0) {
    return (
      <div className="px-2 pb-4">
        <p className="px-2.5 py-2 text-sm text-ink-faint">{t('shell.projects.empty')}</p>
        <NewProjectRow onNavigate={onNavigate} />
      </div>
    )
  }

  return (
    <div className="px-2 pb-4">
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
                scheduleCount={schedules.filter((task) => task.projectId === project.id).length}
                activeIds={activeIds}
                open={!dragging && !collapsed.has(project.id)}
                collapsed={collapsed.has(project.id)}
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
  scheduleCount,
  activeIds,
  open,
  collapsed,
  onToggle,
  onNavigate,
}: {
  project: ProjectDto
  /** Actives et rangées mêlées : le groupe fait lui-même la coupure. */
  conversations: ConversationDto[]
  scheduleCount: number
  activeIds: Set<string>
  open: boolean
  /** Replié par l'utilisateur, indépendamment de la fermeture forcée par un glissement. */
  collapsed: boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const updateProject = useUpdateProject()
  const reorder = useReorderConversations(project.id)
  const openConversationId = useMatch('/p/:projectId/c/:conversationId')?.params.conversationId
  /*
    Les sessions **actives** ne figurent pas dans le groupe : elles sont déjà dans
    l'activité, au-dessus. Les tirs planifiés non plus — une tâche horaire poserait
    vingt-quatre lignes par jour, et sa section les porte.
  */
  const sessions = useMemo(
    () => conversations.filter((entry) =>
      !entry.archivedAt && !entry.scheduleId && (!activeIds.has(entry.id) || entry.id === openConversationId)),
    [conversations, activeIds, openConversationId],
  )
  const archived = useMemo(
    () => conversations.filter((entry) => entry.archivedAt && !entry.scheduleId),
    [conversations],
  )
  // Replié, le projet répond pour ses lignes : sans ce report, un agent qui finit son
  // tour dans un projet fermé ne se signalerait nulle part.
  const hasUnread = useHasUnread(conversations, openConversationId)
  const [showAll, setShowAll] = useState(false)
  const visible = showAll
    ? sessions
    : sessions.filter((entry, index) => index < SESSIONS_SHOWN || entry.id === openConversationId)
  const [editing, setEditing] = useState(false)
  // Le clic rouvre le projet là où on l'a laissé : au tableau de bord pour ceux qui s'y
  // pilotent, sur une conversation neuve pour les autres.
  const view = useProjectView(project.id)
  const sensors = useDragSensors()

  /**
   * Seul l'en-tête sert de poignée : des listeners posés sur l'élément entier
   * engloberaient la liste des sessions, qui a son propre contexte de glissement.
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

  const onDragEnd = (event: DragEndEvent) => {
    swallowNextClick()
    const { active: dragged, over } = event
    if (!over || dragged.id === over.id) return
    const ids = sessions.map((entry) => entry.id)
    const from = ids.indexOf(String(dragged.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    reorder.mutate(arrayMove(ids, from, to))
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
            to={projectViewPath(project.id, view)}
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
            {/* Uniquement replié : déplié, ce sont les lignes elles-mêmes qui le disent. */}
            {collapsed && hasUnread ? (
              <span title={t('shell.project.unread')} className="size-1.5 shrink-0 rounded-full bg-ink" />
            ) : null}
            {project.activeTerminals > 0 ? (
              <SquareTerminal size={11} className="shrink-0 text-positive" aria-label={t('shell.project.terminals')} />
            ) : null}
            {project.visibility === 'shared' ? (
              <Users size={11} className="shrink-0 text-ink-faint" aria-label={t('shell.project.shared')} />
            ) : null}
          </NavLink>
        )}

        {project.isOwner ? (
          <Menu
            trigger={
              <IconButton
                label={t('shell.project.actions', { name: project.name })}
                size="sm"
                className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              >
                <MoreHorizontal size={14} />
              </IconButton>
            }
          >
            <MenuItem icon={<Pencil size={14} />} onSelect={() => setEditing(true)}>
              {t('shell.rename')}
            </MenuItem>
            <MenuItem icon={<SquareKanban size={14} />} onSelect={() => { onNavigate(); navigate(`/p/${project.id}/board`) }}>
              {t('shell.project.board')}
            </MenuItem>
            <MenuItem icon={<CalendarClock size={14} />} onSelect={() => { onNavigate(); navigate(`/p/${project.id}/schedules`) }}>
              {t('schedule.title')}
            </MenuItem>
            {/* `/p/:id` est devenu le tableau de bord : les réglages du projet ont leur
                propre adresse depuis la carte des pages de lieu. */}
            <MenuItem icon={<SlidersHorizontal size={14} />} onSelect={() => { onNavigate(); navigate(`/p/${project.id}/settings`) }}>
              {t('shell.project.settings')}
            </MenuItem>
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
          </Menu>
        ) : null}

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
        <div className="mb-1 ml-3 border-l border-line pl-1.5">
          <ul>
            <SectionLink to={`/p/${project.id}/board`} icon={<SquareKanban size={14} />} label={t('shell.project.board')} onNavigate={onNavigate} />
            {/* *Planification* est masquée quand elle est vide : une section à zéro
                n'apprend rien, et c'est la page du projet qui fait découvrir la
                fonction. */}
            {scheduleCount > 0 ? (
              <SectionLink
                to={`/p/${project.id}/schedules`}
                icon={<CalendarClock size={14} />}
                label={t('schedule.title')}
                count={scheduleCount}
                onNavigate={onNavigate}
              />
            ) : null}
          </ul>

          <div className="flex h-7 items-center gap-1 pr-0.5 pl-2.5">
            <span className="flex-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">
              {t('shell.sessions.heading')}
            </span>
            <Tooltip label={t('shell.project.newConversation', { name: project.name })}>
              <NavLink
                to={`/p/${project.id}/c/new`}
                onClick={onNavigate}
                aria-label={t('shell.project.newConversation', { name: project.name })}
                className="inline-flex size-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-high hover:text-ink"
              >
                <Plus size={14} />
              </NavLink>
            </Tooltip>
          </div>

          {sessions.length === 0 ? (
            <p className="px-2.5 py-1 text-xs text-ink-faint">{t('shell.conversations.empty')}</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={onDragEnd}
              // Annuler par Échap relâche aussi la souris sur le lien : même traitement.
              onDragCancel={swallowNextClick}
            >
              <SortableContext items={visible.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
                <ul>
                  {visible.map((conversation) => (
                    <ConversationLine key={conversation.id} conversation={conversation} onNavigate={onNavigate} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
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

function SectionLink({ to, icon, label, count, onNavigate }: {
  to: string
  icon: React.ReactNode
  label: string
  count?: number
  onNavigate: () => void
}) {
  return (
    <li>
      <NavLink
        to={to}
        onClick={onNavigate}
        className={({ isActive }) => cx(
          'flex h-11 items-center gap-2 rounded-md px-2.5 text-sm transition-colors md:h-8 pointer-coarse:h-11',
          isActive ? 'bg-surface-high font-medium text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
        )}
      >
        <span className="shrink-0 text-ink-faint">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined ? <span className="text-meta tabular-nums text-ink-faint">{count}</span> : null}
      </NavLink>
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
              draggable={false}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
