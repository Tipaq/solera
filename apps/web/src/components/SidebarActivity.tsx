import * as Dialog from '@radix-ui/react-dialog'
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowUpRight, Check, ChevronRight, Inbox, MessageCircleQuestion, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { conversationPath, useOpenConversationId } from '../lib/conversation-route'
import type { ConversationDto, ConversationStatus, ProjectDto } from '@solera/protocol'
import { liveBackground, liveSeq, liveSettledAt, liveStatus, subscribeStatus } from '../lib/conversation-status'
import { isUnread } from '../lib/reads'
import { useTranslate } from '../lib/i18n'
import { AgentIcon } from './AgentIcon'
import { ProjectAvatar } from './ProjectAvatar'
import { cx, IconButton, Tabs } from '@solera/ui'

type ActivityEntry = {
  conversation: ConversationDto
  status: ConversationStatus
  running: boolean
  awaiting: boolean
  unread: boolean
  settledAt: number
}
type View = 'all' | 'awaiting' | 'unread'
const EMPTY: ConversationDto[] = []

export function SidebarActivity({ conversations = EMPTY, projects = [], onNavigate, children }: {
  conversations?: ConversationDto[]
  projects?: ProjectDto[]
  onNavigate: () => void
  children: ReactNode
}) {
  const t = useTranslate()
  const [collapsed, setCollapsed] = useState(false)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('all')
  const returnFocus = useRef<HTMLElement | null>(null)
  const openId = useOpenConversationId()
  // Un instantané primitif évite un rendu pour chaque jeton ou métrique reçue.
  const snapshot = () => JSON.stringify(conversations.map((entry) => ({
    status: liveStatus(entry.id) ?? entry.status,
    background: liveBackground(entry.id) > 0,
    unread: entry.id !== openId && isUnread(entry, liveSeq(entry.id)),
    settledAt: liveSettledAt(entry.id),
  })))
  const serialized = useSyncExternalStore(subscribeStatus, snapshot, snapshot)
  const entries = useMemo((): ActivityEntry[] => {
    const states = JSON.parse(serialized) as { status: ConversationStatus; background: boolean; unread: boolean; settledAt: number }[]
    return conversations.flatMap((conversation, index) => {
      const state = states[index]!
      const awaiting = state.status === 'awaiting_input'
      const running = !awaiting && (state.status === 'running' || state.background)
      // Une session archivée qui travaille encore compte bien dans le total global.
      if (conversation.archivedAt && !running && !awaiting) return []
      return [{ conversation, ...state, running, awaiting }]
    })
  }, [conversations, serialized])
  const running = entries.filter((entry) => entry.running)
  const awaiting = entries.filter((entry) => entry.awaiting)
  const unread = entries.filter((entry) => entry.unread)
  const recent = entries.filter((entry) => entry.settledAt > 0 && !entry.running && !entry.awaiting)
    .sort((a, b) => b.settledAt - a.settledAt).slice(0, 8)
  // Les attentes précèdent le travail en cours, sans clic pour découvrir les sessions.
  const active = [...awaiting, ...running]
  const show = (next: View = 'all') => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setView(next)
    setOpen(true)
  }
  const navigate = () => { returnFocus.current = null; setOpen(false); onNavigate() }
  const rows = (items: ActivityEntry[], compact = false) => <ul className="divide-y divide-line/50">
    {items.map((entry) => <ActivityRow key={entry.conversation.id} entry={entry} project={projects.find((project) => project.id === entry.conversation.projectId)} onNavigate={compact ? onNavigate : navigate} compact={compact} />)}
  </ul>

  return (
    <>
      <div className="mb-2 flex shrink-0 flex-col border-b border-line pb-2" role="group" aria-label={t('shell.activity.label')}>
        <div className="flex items-center gap-1">
          <IconButton size="sm" label={t(collapsed ? 'shell.overview.expand' : 'shell.overview.collapse')} onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-controls="global-activity-projects">
            <ChevronRight size={14} className={cx('transition-transform', !collapsed && 'rotate-90')} />
          </IconButton>
          <button type="button" onClick={() => show()} aria-haspopup="dialog" className="flex min-h-11 md:min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-xs hover:bg-surface-high">
            <span className="font-semibold text-ink-soft">{t('shell.overview.heading')}</span>
            <span className={cx('ml-auto flex items-center gap-1.5 rounded-full px-2 py-1 tabular-nums', running.length > 0 ? 'bg-accent-wash text-accent' : 'text-ink-faint')}>
              {running.length > 0 && <RunningDot />}{t('shell.overview.runningCount', { count: running.length })}
            </span>
            <ArrowUpRight size={14} className="shrink-0 text-ink-faint" />
          </button>
        </div>
        {awaiting.length > 0 && <button type="button" onClick={() => show('awaiting')} className="flex min-h-11 md:min-h-9 items-center gap-2 rounded-md px-2 text-xs text-caution hover:bg-surface-high">
          <MessageCircleQuestion size={14} />{t('shell.overview.awaitingCount', { count: awaiting.length })}<ChevronRight size={14} className="ml-auto" />
        </button>}
        {!collapsed && <div id="global-activity-projects" className="max-h-[32dvh] overflow-y-auto">
          {rows(active.slice(0, 4), true)}
          {active.length === 0 && <p className="px-2 py-2 text-xs text-ink-faint">{t('shell.overview.quiet')}</p>}
        </div>}
        <div className="flex items-center justify-between gap-1 px-1">
          <button type="button" onClick={() => show()} className="min-h-11 md:min-h-8 rounded px-1 text-left text-meta text-ink-faint hover:bg-surface-high hover:text-ink">
            {t(!collapsed && active.length > 4 ? 'shell.overview.moreActive' : 'shell.overview.show', { count: active.length - 4 })}
          </button>
          <button type="button" onClick={() => show('unread')} aria-label={t('shell.overview.unreadCount', { count: unread.length })} className="flex min-h-11 md:min-h-8 items-center gap-1 rounded px-1 text-xs tabular-nums text-ink-faint hover:bg-surface-high hover:text-ink"><Inbox size={14} />{t('shell.overview.unreadCount', { count: unread.length })}</button>
        </div>
      </div>
      <div id="sidebar-activity-results" className="min-h-0 flex-1 overflow-y-auto pb-4">{children}</div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="scrim z-40" />
          <Dialog.Content onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus.current?.focus()
          }}
          /* Le gabarit de dialogue du §9 : feuille en bas au doigt, boîte centrée au
             large. Il était centré même au doigt, et en `bg-surface` — donc sans le
             dégradé signature que porte `.surface`. */
          className="surface fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-xl border border-line shadow-pop sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(672px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
            <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-3">
              <div><Dialog.Title className="text-heading font-semibold">{t('shell.overview.overview')}</Dialog.Title><Dialog.Description className="mt-1 text-xs text-ink-faint">{t('shell.overview.scope')}</Dialog.Description></div>
              <Dialog.Close asChild><IconButton label={t('common.close')}><X size={16} /></IconButton></Dialog.Close>
            </div>
            <Tabs label={t('shell.overview.overview')} value={view} onChange={setView} layout="fill" className="px-4" tabs={[
              { value: 'all', label: t('shell.overview.all') },
              { value: 'awaiting', label: t('shell.activity.awaiting'), count: awaiting.length, tone: awaiting.length > 0 ? 'caution' : 'neutral' },
              { value: 'unread', label: t('shell.activity.unread'), count: unread.length },
            ]} />
            <div className="min-h-0 overflow-y-auto px-4 py-4 space-y-5">
              {view !== 'unread' && awaiting.length > 0 && <section aria-label={t('shell.activity.awaiting')}>
                <h2 className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-caution"><MessageCircleQuestion size={14} />{t('shell.overview.awaitingCount', { count: awaiting.length })}</h2>
                {rows(awaiting)}
              </section>}
              {view === 'all' && running.length > 0 && <section aria-label={t('shell.activity.running')}>
                <h2 className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-accent"><RunningDot />{t('shell.overview.runningCount', { count: running.length })}</h2>
                {rows(running)}
              </section>}
              {view === 'unread' && rows(unread)}
              {(view === 'all' ? active.length === 0 : view === 'awaiting' ? awaiting.length === 0 : unread.length === 0) && <p role="status" className="px-2 py-8 text-center text-sm text-ink-faint">{t(view === 'all' ? 'shell.overview.quiet' : view === 'awaiting' ? 'shell.activity.empty.awaiting' : 'shell.activity.empty.unread')}</p>}
              {view === 'all' && recent.length > 0 && <section aria-label={t('shell.overview.recent')} className="border-t border-line pt-4" title={t('shell.overview.recentHint')}>
                <h2 className="mb-2 px-2 text-xs font-semibold text-ink-faint">{t('shell.overview.recent')}</h2>
                {rows(recent)}
              </section>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

function RunningDot() {
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
}

function ActivityRow({ entry, project, onNavigate, compact = false }: { entry: ActivityEntry; project?: ProjectDto; onNavigate: () => void; compact?: boolean }) {
  const t = useTranslate()
  const label = entry.awaiting ? t('shell.activity.awaiting')
    : entry.running ? t(entry.status === 'running' ? 'shell.activity.running' : 'shell.overview.background')
      : entry.status === 'error' ? t('shell.overview.error')
        : entry.status === 'interrupted' ? t('shell.overview.interrupted') : entry.settledAt ? t('shell.overview.done') : null
  const status = label && <span className={cx('inline-flex shrink-0 items-center gap-1.5 text-meta', entry.awaiting ? 'text-caution' : entry.status === 'error' ? 'text-critical' : entry.running ? 'text-accent' : 'text-ink-faint')}>
    {entry.awaiting ? <MessageCircleQuestion size={11} /> : entry.running ? <RunningDot /> : entry.settledAt && entry.status === 'idle' ? <Check size={11} /> : null}{label}
  </span>
  return <li>
    <NavLink to={conversationPath(entry.conversation)} onClick={onNavigate} className={({ isActive }) => cx('flex items-start gap-2 border-l-2 px-2 py-2.5 hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent', entry.awaiting ? 'border-caution' : isActive ? 'border-accent' : 'border-transparent', isActive && 'bg-surface-high')}>
      <span className="mt-0.5 shrink-0 text-ink-faint"><AgentIcon agent={entry.conversation.agent} size={compact ? 13 : 15} /></span>
      <span className="min-w-0 flex-1">
        <span className={cx('block break-words font-medium leading-snug text-ink', compact ? 'line-clamp-2 text-xs' : 'text-sm')}>{entry.conversation.title}</span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-faint">
          <span className="flex min-w-0 items-center gap-1"><ProjectAvatar project={project} className="size-3" /><span className="truncate">{project?.name ?? t('shell.overview.unknown')}</span></span>
          {!compact && <span className="sm:hidden">{status}</span>}
          {compact && <span className={entry.running && entry.status !== 'running' ? '' : 'sr-only'}>{status}</span>}
        </span>
      </span>
      {compact ? <span className="mt-1 shrink-0" title={label ?? undefined}>{entry.awaiting ? <MessageCircleQuestion size={11} className="text-caution" /> : <RunningDot />}</span> : <span className="hidden pt-0.5 sm:block">{status}</span>}
    </NavLink>
  </li>
}
