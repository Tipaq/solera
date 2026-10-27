import { useLayoutEffect, useRef, useState } from 'react'
import { Activity, ArrowUpRight, MessagesSquare } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { ConversationDto, ProjectDto } from '@solera/protocol'
import { useLiveConversations, type LiveConversation } from '../lib/activity'
import { conversationPath, useOpenConversationId } from '../lib/conversation-route'
import { shortAge } from '../lib/dates'
import { useDisplaySettings } from '../lib/display-settings'
import { useForYou, type ForYouRequest } from '../lib/for-you'
import { useTranslate } from '../lib/i18n'
import { formatAgo } from '../lib/loops'
import { threadState } from '../lib/signals'
import { ActivityDialog, activityGroups, entryFilter, type ActivityFilter } from './activity/ActivityDialog'
import { accordText, forYouTitle } from './activity/ForYouItem'
import { ProjectAvatar } from './ProjectAvatar'
import { StateDot } from './chat/Signals'
import { cx } from '@solera/ui'

/** Jamais plus, quelle que soit la hauteur : la colonne ne doit pas devenir la file. */
const MAX_LINES = 7
/** Une ligne, et la ligne « + N » : 32 px au pointeur fin. */
const LINE = 32
/** L'en-tête, les marges du bloc et son filet. */
const CHROME = 32 + 12 + 1
/** Le simple espace entre ce qui t'attend et le reste. */
const GAP = 6

const EMPTY: ConversationDto[] = []

/**
 * Combien de lignes tiennent sous le quart de la hauteur de la colonne (#121), en-tête,
 * marges et ligne « + N » comprises. `requests` et `sessions` disent ce qu'il y a à
 * montrer, dans l'ordre : l'espace entre les deux ne compte que s'il est visible.
 */
export function activityCapacity(height: number, requests: number, sessions: number): number {
  const total = requests + sessions
  const budget = height / 4
  for (let lines = Math.min(MAX_LINES, total); lines > 0; lines--) {
    const more = lines < total ? LINE : 0
    const gap = requests > 0 && lines > requests ? GAP : 0
    if (CHROME + lines * LINE + more + gap < budget) return lines
  }
  return 0
}

/**
 * L'Activité : ce qui t'attend, puis ce qui a fini sans être lu, puis ce qui tourne
 * (#121). Un seul bloc, entre les lieux et la zone basse.
 *
 * **Ce qui t'attend passe en tête** : les fils bloqués, les décisions, les accords, dans
 * cet ordre et quel que soit le projet. Une ligne par demande — un fil qui tourne et
 * attend un accord est donc une fois dans chaque groupe.
 *
 * Elle ne défile pas et ne se replie pas : la zone basse est la seule partie mobile de
 * la colonne. Le bloc entier tient sous **le quart de la hauteur de la colonne**, et ce
 * qui dépasse est compté sur une ligne ; la modale porte le reste. Au doigt, l'en-tête
 * seul : ses deux compteurs disent l'état, et la zone basse garde toute la hauteur.
 */
export function SidebarActivity({
  conversations = EMPTY,
  projects = [],
  onNavigate,
  coarse = false,
  focus,
}: {
  conversations?: ConversationDto[]
  projects?: ProjectDto[]
  onNavigate: () => void
  /** Vrai au doigt : l'en-tête seul, sans aucune ligne. */
  coarse?: boolean
  /** Le projet que montre la colonne en mode projet (#51) : ses demandes passent devant. */
  focus?: string | null
}) {
  const t = useTranslate()
  const display = useDisplaySettings()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  /**
   * Trois états et non deux : `undefined` ne filtre rien, `null` ne garde que les fils
   * libres. Il vit ici, et non dans la modale qui le montre, parce que c'est l'ouverture
   * qui le décide : la modale n'est jamais démontée, et son état y survivrait.
   */
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined)
  const [expanded, setExpanded] = useState<string | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [block, setBlock] = useState<HTMLDivElement | null>(null)
  const height = useColumnHeight(block)
  const openId = useOpenConversationId()
  const entries = useLiveConversations(conversations, openId)
  const forYou = useForYou(entries, focus)
  const groups = activityGroups(entries, forYou)

  // L'Activité éteinte dans l'affichage ne cache pas ce qui t'attend : c'était la place
  // de « À décider », qui ne se retirait pas. Seules les sessions disparaissent.
  const sessions = display.activity ? [...groups.unread, ...groups.running] : []
  if (!display.activity && forYou.length === 0) return null

  const capacity = coarse ? 0 : activityCapacity(height, forYou.length, sessions.length)
  const shownRequests = forYou.slice(0, capacity)
  const shownSessions = sessions.slice(0, Math.max(0, capacity - shownRequests.length))
  const restRequests = forYou.length - shownRequests.length
  const restSessions = sessions.length - shownSessions.length

  /**
   * **Rien ne se retient entre deux ouvertures.** Le filtre d'entrée est le premier
   * groupe non vide, calculé tous projets confondus : une portée gardée de la fois
   * d'avant ouvrirait sur un onglet qui annonce des demandes au-dessus d'une liste vide.
   */
  const show = (request?: ForYouRequest) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFilter(request ? 'forYou' : entryFilter(groups))
    setExpanded(request?.key ?? null)
    setProjectId(undefined)
    setOpen(true)
  }
  const navigate = () => { returnFocus.current = null; setOpen(false); onNavigate() }
  const more = [
    restRequests > 0 ? t(restRequests > 1 ? 'forYou.more.requests.other' : 'forYou.more.requests.one', { count: restRequests }) : null,
    restSessions > 0 ? t(restSessions > 1 ? 'forYou.more.sessions.other' : 'forYou.more.sessions.one', { count: restSessions }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <div ref={setBlock} className="shrink-0 border-b border-line px-2 py-1.5" role="group" aria-label={t('shell.activity.label')}>
        {/* L'en-tête porte les compteurs et le « ↗ » vers la modale. Un seul bouton :
            trois cibles voisines pour une seule destination ne font qu'un piège au doigt. */}
        <button
          type="button"
          onClick={() => show()}
          aria-haspopup="dialog"
          className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-surface-high pointer-coarse:h-11"
        >
          <Activity size={14} className="shrink-0 text-ink-faint" />
          <span className="flex-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">
            {t('shell.overview.heading')}
          </span>
          {forYou.length > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-caution/12 px-1.5 py-px text-meta font-medium tabular-nums text-caution">
              <StateDot state="awaiting" labelled={false} />
              {/* Le chiffre est l'écriture visible du libellé qui suit : annoncé deux
                  fois, le bouton se lirait « Activité 2 2 pour toi ». */}
              <span aria-hidden>{forYou.length}</span>
              <span className="sr-only">{t('shell.overview.awaitingCount', { count: forYou.length })}</span>
            </span>
          ) : null}
          {display.activity && groups.running.length > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-accent-wash px-1.5 py-px text-meta font-medium tabular-nums text-accent">
              <StateDot state="working" labelled={false} />
              <span aria-hidden>{groups.running.length}</span>
              <span className="sr-only">{t('shell.overview.runningCount', { count: groups.running.length })}</span>
            </span>
          ) : null}
          <ArrowUpRight size={14} className="shrink-0 text-ink-faint" />
        </button>

        {coarse ? null : forYou.length === 0 && sessions.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-ink-faint">{t('shell.overview.quiet')}</p>
        ) : (
          <>
            {shownRequests.length > 0 ? (
              <ul>
                {shownRequests.map((entry) => (
                  <ForYouLine
                    key={entry.key}
                    entry={entry}
                    project={projects.find((project) => project.id === entry.projectId)}
                    onOpen={() => show(entry)}
                  />
                ))}
              </ul>
            ) : null}
            {shownSessions.length > 0 ? (
              <ul className={cx(shownRequests.length > 0 && 'mt-1.5')}>
                {shownSessions.map((entry) => (
                  <ActivityLine
                    key={entry.conversation.id}
                    entry={entry}
                    project={projects.find((project) => project.id === entry.conversation.projectId)}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            ) : null}
            {more ? (
              <button
                type="button"
                onClick={() => show()}
                className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs text-ink-faint transition-colors hover:bg-surface-high hover:text-ink"
              >
                <Activity size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t('forYou.more', { rest: more })}</span>
                {restRequests > 0 ? <StateDot state="awaiting" labelled={false} /> : null}
              </button>
            ) : null}
          </>
        )}
      </div>

      <ActivityDialog
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={() => returnFocus.current?.focus()}
        filter={filter}
        onFilter={setFilter}
        projectId={projectId}
        onProjectId={setProjectId}
        expanded={expanded}
        onExpanded={setExpanded}
        entries={display.activity ? entries : entries.filter((entry) => entry.awaiting)}
        forYou={forYou}
        projects={projects}
        onNavigate={navigate}
      />
    </>
  )
}

/**
 * La hauteur de la colonne qui porte le bloc, suivie au redimensionnement. Mesurée
 * avant la peinture : un premier rendu à sept lignes ferait sauter la zone basse.
 */
function useColumnHeight(block: HTMLElement | null): number {
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const column = block?.parentElement
    if (!column) return
    setHeight(column.getBoundingClientRect().height)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(column)
    return () => observer.disconnect()
  }, [block])
  return height
}

/**
 * Le repère d'une ligne : son projet, ou l'icône des fils libres. Dans l'activité, on
 * cherche *où* ça se passe.
 */
function EntryMark({ project, free }: { project?: ProjectDto; free: boolean }) {
  return free
    ? <MessagesSquare size={14} className="shrink-0 text-ink-faint" />
    : <ProjectAvatar project={project} className="size-3.5" />
}

/**
 * Une demande en 32 px : projet, titre — la question pour une décision —, et à droite
 * un seul repère. Le point ambre pour un fil bloqué, l'échéance pour une décision, ce
 * qu'il y a à ranger pour un accord. Un clic ouvre la modale dépliée sur elle.
 */
function ForYouLine({ entry, project, onOpen }: {
  entry: ForYouRequest
  project?: ProjectDto
  onOpen: () => void
}) {
  const t = useTranslate()
  const title = entry.tier === 'decision' ? forYouTitle(entry, t) : entry.conversationTitle
  const mark = entry.tier === 'blocked'
    ? <StateDot state="awaiting" />
    : entry.tier === 'decision'
      ? entry.awaiting.expiresAt !== null
        ? <span className="shrink-0 text-meta tabular-nums text-ink-faint">{formatAgo(Math.max(0, entry.awaiting.expiresAt - Date.now()))}</span>
        : null
      : <span className="shrink-0 truncate text-meta text-ink-faint">{accordText(entry.awaiting.kind, 'count' in entry.awaiting ? entry.awaiting.count : 1, 'short', t)}</span>

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        title={forYouTitle(entry, t)}
        className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 pl-2.5 text-left text-sm text-ink transition-colors hover:bg-surface-high"
      >
        <EntryMark project={project} free={entry.projectId === null} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {mark}
      </button>
    </li>
  )
}

/**
 * Une session en 32 px : projet, titre tronqué, ancienneté, état. Le titre est tronqué
 * et non replié : sept sessions tiennent alors dans la hauteur que trois prenaient.
 */
function ActivityLine({ entry, project, onNavigate }: {
  entry: LiveConversation
  project?: ProjectDto
  onNavigate: () => void
}) {
  const display = useDisplaySettings()
  const state = threadState({ status: entry.status, busy: entry.running, unread: entry.unread })

  return (
    <li>
      <NavLink
        to={conversationPath(entry.conversation)}
        onClick={onNavigate}
        title={entry.conversation.title}
        className={({ isActive }) => cx(
          'flex h-8 items-center gap-2 rounded-md px-1.5 pl-2.5 text-sm transition-colors',
          isActive ? 'bg-accent-wash text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
        )}
      >
        <EntryMark project={project} free={entry.conversation.projectId === null} />
        <span className={cx('min-w-0 flex-1 truncate', entry.unread && 'font-medium text-ink')}>
          {entry.conversation.title}
        </span>
        {display.sessionAge ? (
          <span className="shrink-0 text-meta tabular-nums text-ink-faint">
            {shortAge(entry.settledAt || entry.conversation.updatedAt)}
          </span>
        ) : null}
        {state ? <StateDot state={state} /> : null}
      </NavLink>
    </li>
  )
}
