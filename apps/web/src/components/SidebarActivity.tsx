import * as Dialog from '@radix-ui/react-dialog'
import { useRef, useState } from 'react'
import { Activity, ArrowUpRight, MessageCircleQuestion, MessagesSquare, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { ConversationDto, ProjectDto } from '@solera/protocol'
import { useLiveConversations, type LiveConversation } from '../lib/activity'
import { conversationPath, useOpenConversationId } from '../lib/conversation-route'
import { shortAge } from '../lib/dates'
import { useDisplaySettings } from '../lib/display-settings'
import { useTranslate } from '../lib/i18n'
import { AgentIcon } from './AgentIcon'
import { ProjectAvatar } from './ProjectAvatar'
import { cx, IconButton, Menu, MenuItem, MenuSeparator } from '@solera/ui'

/**
 * L'instantané est celui de `lib/activity.ts`, partagé avec les pages de lieu : il y en
 * avait trois copies après la fusion des quatre branches de la colonne, et une suffit.
 */
type ActivityEntry = LiveConversation

/** Les quatre filtres de la modale, chacun porteur de son compte. */
type Filter = 'all' | 'awaiting' | 'running' | 'unread'

/**
 * Au-delà, le reste est **compté** sur une ligne plutôt que listé : c'est ce qui empêche
 * une journée chargée de transformer l'activité en seconde liste de sessions. Deux au
 * doigt, où chaque ligne coûte 44 px et où le téléphone sert à voir ce qui attend.
 */
const SHOWN = 7
const SHOWN_COARSE = 2

const EMPTY: ConversationDto[] = []

/**
 * L'activité : une ligne par session, 32 px, entre les lieux et la zone basse.
 *
 * Elle ne défile pas et ne se replie pas — la zone basse est la seule partie mobile de
 * la colonne. Ce qui ne tient pas est compté, et la modale porte le reste.
 */
export function SidebarActivity({ conversations = EMPTY, projects = [], onNavigate, coarse = false }: {
  conversations?: ConversationDto[]
  projects?: ProjectDto[]
  onNavigate: () => void
  /** Vrai au doigt : l'activité est coupée à deux lignes. */
  coarse?: boolean
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const returnFocus = useRef<HTMLElement | null>(null)
  const openId = useOpenConversationId()
  const entries = useLiveConversations(conversations, openId)

  const awaiting = entries.filter((entry) => entry.awaiting)
  const running = entries.filter((entry) => entry.running)
  const unread = entries.filter((entry) => entry.unread)
  // Les attentes précèdent le travail en cours : ce qui réclame passe avant ce qui tourne.
  const active = [...awaiting, ...running]
  const shown = coarse ? SHOWN_COARSE : SHOWN
  const rest = active.length - shown

  const show = (next: Filter = 'all') => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFilter(next)
    setOpen(true)
  }
  const navigate = () => { returnFocus.current = null; setOpen(false); onNavigate() }

  return (
    <>
      <div className="shrink-0 border-b border-line px-2 py-1.5" role="group" aria-label={t('shell.activity.label')}>
        {/* L'en-tête porte les compteurs et le « ↗ » vers la modale. Un seul bouton :
            le titre, les pastilles et la flèche ouvrent la même chose, et trois cibles
            voisines pour une seule destination ne font qu'un piège au doigt. */}
        <button
          type="button"
          onClick={() => show()}
          aria-haspopup="dialog"
          className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-surface-high"
        >
          <Activity size={14} className="shrink-0 text-ink-faint" />
          <span className="flex-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">
            {t('shell.overview.heading')}
          </span>
          {awaiting.length > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-caution/12 px-1.5 py-px text-meta font-medium tabular-nums text-caution">
              <MessageCircleQuestion size={11} />
              {/* Le chiffre est l'écriture visible du libellé qui suit : annoncé deux
                  fois, le bouton se lirait « Activité 2 2 à débloquer ». */}
              <span aria-hidden>{awaiting.length}</span>
              <span className="sr-only">{t('shell.overview.awaitingCount', { count: awaiting.length })}</span>
            </span>
          ) : null}
          {running.length > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-accent-wash px-1.5 py-px text-meta font-medium tabular-nums text-accent">
              <RunningDot />
              <span aria-hidden>{running.length}</span>
              <span className="sr-only">{t('shell.overview.runningCount', { count: running.length })}</span>
            </span>
          ) : null}
          <ArrowUpRight size={14} className="shrink-0 text-ink-faint" />
        </button>

        {active.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-ink-faint">{t('shell.overview.quiet')}</p>
        ) : (
          <ul>
            {active.slice(0, shown).map((entry) => (
              <ActivityLine
                key={entry.conversation.id}
                entry={entry}
                project={projects.find((project) => project.id === entry.conversation.projectId)}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}

        {rest > 0 ? (
          <button
            type="button"
            onClick={() => show()}
            className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs text-ink-faint transition-colors hover:bg-surface-high hover:text-ink"
          >
            <Activity size={14} className="shrink-0" />
            {t('shell.overview.moreActive', { count: rest })}
          </button>
        ) : null}
      </div>

      <ActivityDialog
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={() => returnFocus.current?.focus()}
        filter={filter}
        onFilter={setFilter}
        entries={entries}
        counts={{ all: entries.length, awaiting: awaiting.length, running: running.length, unread: unread.length }}
        projects={projects}
        onNavigate={navigate}
      />
    </>
  )
}

function RunningDot() {
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
}

/**
 * Une session en 32 px : agent, titre tronqué, puce du projet, ancienneté, état.
 *
 * Le titre est tronqué et non replié sur deux lignes — sept sessions tiennent alors dans
 * la hauteur que trois prenaient, et c'est tout l'intérêt de la ligne unique.
 */
function ActivityLine({ entry, project, onNavigate }: {
  entry: ActivityEntry
  project?: ProjectDto
  onNavigate: () => void
}) {
  const t = useTranslate()
  const display = useDisplaySettings()
  const label = entry.awaiting
    ? t('shell.activity.awaiting')
    : entry.running
      ? t(entry.status === 'running' ? 'shell.activity.running' : 'shell.overview.background')
      : null

  return (
    <li>
      <NavLink
        to={conversationPath(entry.conversation)}
        onClick={onNavigate}
        title={entry.conversation.title}
        className={({ isActive }) => cx(
          'flex h-11 items-center gap-2 rounded-md px-1.5 pl-2.5 text-sm transition-colors md:h-8 pointer-coarse:h-11',
          isActive ? 'bg-accent-wash text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
        )}
      >
        <span className="shrink-0 text-ink-faint"><AgentIcon agent={entry.conversation.agent} size={14} /></span>
        <span className="min-w-0 flex-1 truncate">{entry.conversation.title}</span>
        {display.projectDot ? (
          <ProjectAvatar project={project} className="size-3" />
        ) : null}
        {display.sessionAge ? (
          <span className="shrink-0 text-meta tabular-nums text-ink-faint">
            {shortAge(entry.settledAt || entry.conversation.updatedAt)}
          </span>
        ) : null}
        <span className="shrink-0" title={label ?? undefined}>
          {entry.awaiting
            ? <MessageCircleQuestion size={12} className="text-caution" />
            : entry.running
              ? <RunningDot />
              : entry.unread ? <span aria-hidden className="block size-1.5 rounded-full bg-ink" /> : null}
        </span>
        {label ? <span className="sr-only">{label}</span> : null}
      </NavLink>
    </li>
  )
}

/**
 * La modale d'activité : quatre filtres qui portent leur compte, plus un filtre par
 * projet.
 *
 * Elle remplace trois onglets dont deux listaient strictement la même chose. Ici le
 * projet s'écrit en clair — la place existe, contrairement à la colonne.
 */
function ActivityDialog({ open, onOpenChange, onCloseAutoFocus, filter, onFilter, entries, counts, projects, onNavigate }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: () => void
  filter: Filter
  onFilter: (filter: Filter) => void
  entries: ActivityEntry[]
  counts: Record<Filter, number>
  projects: ProjectDto[]
  onNavigate: () => void
}) {
  const t = useTranslate()
  /**
   * Trois états et non deux : `undefined` ne filtre rien, `null` ne garde que les fils
   * libres. C'est la forme même de `conversation.projectId`, donc la comparaison plus
   * bas se suffit — un sentinelle `'none'` aurait demandé un cas de plus.
   */
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined)
  const selected = projects.find((project) => project.id === projectId)
  /*
    L'ordre est celui de l'urgence, et non celui du dénombrement : ce qui bloque, puis
    ce qui a fini et attend d'être relu, puis ce qui avance tout seul, et *tous* en
    dernier. C'est ce qu'on vient voir qui doit être sous le pouce, pas l'inventaire.
  */
  const filters: { value: Filter; label: string; tone?: 'caution' }[] = [
    { value: 'awaiting', label: t('shell.activity.awaiting'), tone: 'caution' },
    { value: 'unread', label: t('shell.activity.unread') },
    { value: 'running', label: t('shell.activity.running') },
    { value: 'all', label: t('shell.overview.all') },
  ]
  /** Même ordre d'urgence à l'intérieur de *tous* : rien n'est caché, rien n'est enfoui. */
  const rank = (entry: ActivityEntry): number =>
    entry.awaiting ? 0 : entry.unread ? 1 : entry.running ? 2 : 3
  const rows = entries
    .filter((entry) => {
      if (projectId !== undefined && entry.conversation.projectId !== projectId) return false
      if (filter === 'awaiting') return entry.awaiting
      if (filter === 'running') return entry.running
      if (filter === 'unread') return entry.unread
      return true
    })
    .sort((a, b) => rank(a) - rank(b))

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            onCloseAutoFocus()
          }}
          /* Le gabarit de dialogue du §9 : feuille en bas au doigt, boîte centrée au large. */
          className="surface fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-xl border border-line shadow-pop sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(672px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-3">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-heading font-semibold">
                <Activity size={16} className="text-ink-faint" />{t('shell.overview.overview')}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-ink-faint">{t('shell.overview.scope')}</Dialog.Description>
            </div>
            <Dialog.Close asChild><IconButton label={t('common.close')}><X size={16} /></IconButton></Dialog.Close>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-4 pb-3">
            {filters.map((entry) => (
              <button
                key={entry.value}
                type="button"
                onClick={() => onFilter(entry.value)}
                aria-pressed={filter === entry.value}
                className={cx(
                  'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors',
                  filter === entry.value
                    ? 'bg-accent-wash font-medium text-ink'
                    : 'text-ink-soft hover:bg-surface-high hover:text-ink',
                )}
              >
                {entry.label}
                <span className={cx(
                  'tabular-nums',
                  entry.tone === 'caution' && counts[entry.value] > 0 ? 'text-caution' : 'text-ink-faint',
                )}>
                  {counts[entry.value]}
                </span>
              </button>
            ))}
            {/* Le filtre par projet, à part : il croise les quatre autres au lieu de
                s'y ajouter comme un cinquième. */}
            <span className="ml-auto">
              <Menu
                trigger={
                  <button
                    type="button"
                    className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink"
                  >
                    {selected ? <ProjectAvatar project={selected} className="size-3" /> : null}
                    {selected?.name
                      ?? (projectId === null ? t('destination.none') : t('shell.overview.allProjects'))}
                  </button>
                }
              >
                <MenuItem onSelect={() => setProjectId(undefined)}>{t('shell.overview.allProjects')}</MenuItem>
                <MenuSeparator />
                {/* Les fils libres sont une cible de filtre comme une autre : ils sont le
                    premier groupe de la colonne, pas un reliquat. */}
                <MenuItem icon={<MessagesSquare size={14} />} onSelect={() => setProjectId(null)}>
                  {t('destination.none')}
                </MenuItem>
                {projects.map((project) => (
                  <MenuItem
                    key={project.id}
                    icon={<ProjectAvatar project={project} className="size-3" />}
                    onSelect={() => setProjectId(project.id)}
                  >
                    {project.name}
                  </MenuItem>
                ))}
              </Menu>
            </span>
          </div>

          <div className="min-h-0 overflow-y-auto p-2">
            {rows.length === 0 ? (
              <p role="status" className="px-2 py-8 text-center text-sm text-ink-faint">
                {t(filter === 'awaiting' ? 'shell.activity.empty.awaiting'
                  : filter === 'running' ? 'shell.activity.empty.running'
                    : filter === 'unread' ? 'shell.activity.empty.unread' : 'shell.overview.quiet')}
              </p>
            ) : (
              <ul className="divide-y divide-line/50">
                {rows.map((entry) => (
                  <DialogRow
                    key={entry.conversation.id}
                    entry={entry}
                    project={projects.find((project) => project.id === entry.conversation.projectId)}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Une ligne par session, le projet écrit en clair et l'ancienneté à droite. */
function DialogRow({ entry, project, onNavigate }: {
  entry: ActivityEntry
  project?: ProjectDto
  onNavigate: () => void
}) {
  const t = useTranslate()
  const label = entry.awaiting
    ? t('shell.activity.awaiting')
    : entry.running
      ? t(entry.status === 'running' ? 'shell.activity.running' : 'shell.overview.background')
      : entry.status === 'error' ? t('shell.overview.error')
        : entry.status === 'interrupted' ? t('shell.overview.interrupted')
          : entry.settledAt ? t('shell.overview.done') : null

  return (
    <li>
      <NavLink
        to={conversationPath(entry.conversation)}
        onClick={onNavigate}
        className={({ isActive }) => cx(
          'flex min-h-11 items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-high',
          isActive && 'bg-surface-high',
        )}
      >
        <span className="shrink-0 text-ink-faint"><AgentIcon agent={entry.conversation.agent} size={15} /></span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.conversation.title}</span>
        <span className="hidden min-w-0 shrink-0 items-center gap-1.5 text-xs text-ink-soft sm:flex">
          <ProjectAvatar project={project} className="size-3" />
          <span className="truncate">
            {project?.name
              ?? (entry.conversation.projectId === null
                ? t('destination.none')
                : t('shell.overview.unknown'))}
          </span>
        </span>
        <span className="w-12 shrink-0 text-right text-meta tabular-nums text-ink-faint">
          {shortAge(entry.settledAt || entry.conversation.updatedAt)}
        </span>
        <span className="shrink-0" title={label ?? undefined}>
          {entry.awaiting
            ? <MessageCircleQuestion size={13} className="text-caution" />
            : entry.running
              ? <RunningDot />
              : entry.unread ? <span aria-hidden className="block size-1.5 rounded-full bg-ink" /> : null}
        </span>
        {label ? <span className="sr-only">{label}</span> : null}
      </NavLink>
    </li>
  )
}
