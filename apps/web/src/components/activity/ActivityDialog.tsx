import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, MessagesSquare, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { cx, IconButton, Menu, MenuItem, MenuSeparator } from '@solera/ui'
import type { LiveConversation } from '../../lib/activity'
import { conversationPath } from '../../lib/conversation-route'
import { shortAge } from '../../lib/dates'
import type { ForYouRequest } from '../../lib/for-you'
import { useTranslate } from '../../lib/i18n'
import { threadState } from '../../lib/signals'
import { AgentIcon } from '../AgentIcon'
import { ProjectAvatar } from '../ProjectAvatar'
import { StateDot } from '../chat/Signals'
import { ForYouItem, ForYouSettled } from './ForYouItem'

/** Les quatre filtres de la modale, dans l'ordre de ce qu'ils réclament. */
export type ActivityFilter = 'forYou' | 'unread' | 'running' | 'all'

/** Le temps où une demande réglée dit qu'elle l'est, avant de partir. */
const SETTLED_MS = 1_100

/**
 * Ce que la colonne et la modale se partagent : les quatre groupes, tous projets
 * confondus. Un fil bloqué est dans « Pour toi » et nulle part ailleurs ; un fil qui
 * tourne et attend un accord est dans les deux (Q38).
 */
export function activityGroups(entries: LiveConversation[], forYou: ForYouRequest[]) {
  const sessions = entries.filter((entry) => !entry.awaiting)
  return {
    forYou,
    // Les plus récentes d'abord, parce que c'est la coupure de la colonne qui tranche.
    unread: sessions.filter((entry) => entry.unread).sort((a, b) => b.since - a.since),
    running: sessions.filter((entry) => entry.running),
    sessions,
  }
}

/** Le premier filtre non vide : ce qu'on vient chercher en ouvrant, pas l'inventaire. */
export function entryFilter(groups: ReturnType<typeof activityGroups>): ActivityFilter {
  return groups.forYou.length > 0 ? 'forYou'
    : groups.unread.length > 0 ? 'unread'
      : groups.running.length > 0 ? 'running' : 'all'
}

/**
 * La modale d'Activité (#121) : **Pour toi**, Non lues, En cours, Tout, et le filtre par
 * projet qui les croise.
 *
 * Dans « Pour toi », une demande se déplie sur place pour y répondre sans ouvrir le fil.
 * Rien n'est anticipé : la ligne part quand le journal ou l'API dit la demande tranchée,
 * et dit une seconde qu'elle est réglée.
 */
export function ActivityDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  filter,
  onFilter,
  projectId,
  onProjectId,
  expanded,
  onExpanded,
  entries,
  forYou,
  projects,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: () => void
  filter: ActivityFilter
  onFilter: (filter: ActivityFilter) => void
  /** `undefined` ne filtre rien, `null` ne garde que les fils libres. */
  projectId: string | null | undefined
  onProjectId: (projectId: string | null | undefined) => void
  /** La demande dépliée, par sa clé. */
  expanded: string | null
  onExpanded: (key: string | null) => void
  entries: LiveConversation[]
  forYou: ForYouRequest[]
  projects: ProjectDto[]
  /** Ferme la modale avant d'aller au fil. */
  onNavigate: () => void
}) {
  const t = useTranslate()
  const selected = projects.find((project) => project.id === projectId)
  const projectOf = (id: string | null) => projects.find((project) => project.id === id)
  const groups = activityGroups(entries, forYou)
  const settled = useSettled(forYou, expanded, onExpanded)

  const inScope = (id: string | null) => projectId === undefined || id === projectId
  const requests = filter === 'forYou' || filter === 'all'
    ? forYou.filter((entry) => inScope(entry.projectId))
    : []
  const sessions = (filter === 'unread' ? groups.unread
    : filter === 'running' ? groups.running
      : filter === 'all' ? [...groups.sessions].sort((a, b) => rank(a) - rank(b)) : [])
    .filter((entry) => inScope(entry.conversation.projectId))

  const filters: { value: ActivityFilter; label: string; count: number; tone?: 'caution' }[] = [
    { value: 'forYou', label: t('forYou.filter'), count: groups.forYou.length, tone: 'caution' },
    { value: 'unread', label: t('shell.activity.unread'), count: groups.unread.length },
    { value: 'running', label: t('shell.activity.running'), count: groups.running.length },
    { value: 'all', label: t('shell.overview.all'), count: groups.forYou.length + groups.sessions.length },
  ]
  const empty = requests.length === 0 && sessions.length === 0 && !settled

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
                  'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors pointer-coarse:h-11',
                  filter === entry.value
                    ? 'bg-accent-wash font-medium text-ink'
                    : 'text-ink-soft hover:bg-surface-high hover:text-ink',
                )}
              >
                {entry.label}
                <span className={cx(
                  'tabular-nums',
                  entry.tone === 'caution' && entry.count > 0 ? 'text-caution' : 'text-ink-faint',
                )}>
                  {entry.count}
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
                    className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink pointer-coarse:h-11"
                  >
                    {selected ? <ProjectAvatar project={selected} className="size-3" /> : null}
                    {selected?.name
                      ?? (projectId === null ? t('destination.none') : t('shell.overview.allProjects'))}
                  </button>
                }
              >
                <MenuItem onSelect={() => onProjectId(undefined)}>{t('shell.overview.allProjects')}</MenuItem>
                <MenuSeparator />
                <MenuItem icon={<MessagesSquare size={14} />} onSelect={() => onProjectId(null)}>
                  {t('destination.none')}
                </MenuItem>
                {projects.map((project) => (
                  <MenuItem
                    key={project.id}
                    icon={<ProjectAvatar project={project} className="size-3" />}
                    onSelect={() => onProjectId(project.id)}
                  >
                    {project.name}
                  </MenuItem>
                ))}
              </Menu>
            </span>
          </div>

          <div className="min-h-0 overflow-y-auto p-2">
            {empty ? (
              <p role="status" className="px-2 py-8 text-center text-sm text-ink-faint">
                {t(filter === 'forYou' ? 'forYou.empty'
                  : filter === 'running' ? 'shell.activity.empty.running'
                    : filter === 'unread' ? 'shell.activity.empty.unread' : 'shell.overview.quiet')}
              </p>
            ) : (
              <ul className="divide-y divide-line/50">
                {requests.map((entry, index) => (
                  <SettledBefore key={entry.key} settled={settled} index={index}>
                    <ForYouItem
                      entry={entry}
                      project={projectOf(entry.projectId)}
                      open={expanded === entry.key}
                      onToggle={() => onExpanded(expanded === entry.key ? null : entry.key)}
                      onOpenThread={() => onNavigate()}
                      threadPath={conversationPath({ id: entry.conversationId, projectId: entry.projectId })}
                    />
                  </SettledBefore>
                ))}
                {settled && settled.index >= requests.length && (filter === 'forYou' || filter === 'all')
                  ? <ForYouSettled entry={settled.entry} />
                  : null}
                {sessions.map((entry) => (
                  <SessionRow
                    key={entry.conversation.id}
                    entry={entry}
                    project={projectOf(entry.conversation.projectId)}
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

/** Même ordre d'urgence dans *Tout* : ce qui a fini sans être lu, puis ce qui tourne. */
function rank(entry: LiveConversation): number {
  return entry.unread ? 0 : entry.running ? 1 : 2
}

interface Settled { entry: ForYouRequest; index: number }

/**
 * La demande dépliée qui vient de partir de la liste — tranchée ici ou ailleurs : elle
 * le dit une seconde, à sa place, puis s'efface et replie la ligne.
 */
function useSettled(
  forYou: ForYouRequest[],
  expanded: string | null,
  onExpanded: (key: string | null) => void,
): Settled | null {
  const [settled, setSettled] = useState<Settled | null>(null)
  const last = useRef<Settled | null>(null)
  const present = expanded === null ? -1 : forYou.findIndex((entry) => entry.key === expanded)

  useEffect(() => {
    if (expanded === null) {
      last.current = null
      return
    }
    if (present !== -1) {
      last.current = { entry: forYou[present]!, index: present }
      return
    }
    if (!last.current) return
    setSettled(last.current)
    last.current = null
    onExpanded(null)
  }, [expanded, present, forYou, onExpanded])

  useEffect(() => {
    if (!settled) return
    const timer = window.setTimeout(() => setSettled(null), SETTLED_MS)
    return () => window.clearTimeout(timer)
  }, [settled])

  return settled
}

function SettledBefore({ settled, index, children }: {
  settled: Settled | null
  index: number
  children: ReactNode
}) {
  return (
    <>
      {settled?.index === index ? <ForYouSettled entry={settled.entry} /> : null}
      {children}
    </>
  )
}

/** Une session, le projet écrit en clair et l'ancienneté à droite. */
function SessionRow({ entry, project, onNavigate }: {
  entry: LiveConversation
  project?: ProjectDto
  onNavigate: () => void
}) {
  const t = useTranslate()
  const label = entry.running
    ? t(entry.status === 'running' ? 'shell.activity.running' : 'shell.overview.background')
    : entry.status === 'error' ? t('shell.overview.error')
      : entry.status === 'interrupted' ? t('shell.overview.interrupted')
        : entry.settledAt ? t('shell.overview.done') : null
  const state = threadState({ status: entry.status, busy: entry.running, unread: entry.unread })

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
        <span className={cx('min-w-0 flex-1 truncate text-sm text-ink', entry.unread && 'font-medium')}>
          {entry.conversation.title}
        </span>
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
        {/* Le point dit l'état en couleur ; le texte, plus précis, reste ce qu'entend un
            lecteur d'écran. */}
        {state ? <StateDot state={state} labelled={!label} /> : null}
        {label ? <span className="sr-only">{label}</span> : null}
      </NavLink>
    </li>
  )
}
