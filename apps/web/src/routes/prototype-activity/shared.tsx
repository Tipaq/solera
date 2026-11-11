/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { Flag, Search } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { JOURNAL_DEFAULT_DAYS, type CardDto, type ConversationDto, type JournalEntryDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { isActiveFilter, matchesActivity, parseActivityFilter, type ActivityGroup } from '../../lib/activity-groups'
import { useActivityRows, type ActivityRow } from '../../lib/activity-rows'
import { useCards } from '../../lib/cards'
import { useAllConversations } from '../../lib/conversations'
import { locale, useTranslate } from '../../lib/i18n'
import {
  JOURNAL_FILTERS,
  JOURNAL_FILTER_LABELS,
  countByFilter,
  useJournal,
  useJournalDays,
  type JournalDay,
  type JournalFilter,
} from '../../lib/journal'
import { useActiveMilestones } from '../../lib/milestones'
import { useProjects } from '../../lib/projects'
import { useProtoHref } from '../prototype-milestones/model'

/**
 * Le contenu de l'Activité fusionnée, commun aux trois rendus : le vivant (sans les
 * terminées), l'historique par jour (sans les sessions vivantes), une recherche qui
 * filtre les deux, et les filtres par nature du Journal. Seul le rendu change d'une
 * variante à l'autre ; c'est ce que Tim juge.
 */

/** Au-delà, l'historique ne s'allonge plus : un `git log` d'un an suffit à tout fil. */
const MAX_JOURNAL_DAYS = 365

export const LIVE_GROUPS: { group: Exclude<ActivityGroup, 'done'>; label: string }[] = [
  { group: 'asking', label: 'À toi' },
  { group: 'review', label: 'À relire' },
  { group: 'running', label: 'En cours' },
]

export interface MilestoneRef {
  number: number
  title: string
}

export function useActivityModel() {
  const { projectId } = useParams()
  const { data: projects, isPending } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  const rows = useActivityRows(projectId, project)
  const { data: runs } = useActiveMilestones(projectId)
  // « Plus ancien » élargit la fenêtre ; la lecture précédente reste affichée pendant
  // que la suivante arrive, pour que le fil ne se vide pas sous les yeux.
  const [windowDays, setWindowDays] = useState(JOURNAL_DEFAULT_DAYS)
  const { data: fresh, isFetching: journalFetching } = useJournal(projectId, windowDays)
  const lastJournal = useRef(fresh)
  if (fresh) lastJournal.current = fresh
  const journal = fresh ?? lastJournal.current
  const { data: cards } = useCards(projectId)
  const { data: conversations } = useAllConversations()
  const href = useProtoHref()

  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<JournalFilter>('all')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const filter = useMemo(() => parseActivityFilter(query), [query])
  const live = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.group !== 'done' &&
          matchesActivity(filter, {
            group: row.group,
            title: row.entry.conversation.title,
            branch: row.place.branch,
            card: row.entry.conversation.card,
          }),
      ),
    [rows, filter],
  )

  const liveIds = useMemo(
    () => new Set(rows.filter((row) => row.group !== 'done').map((row) => row.entry.conversation.id)),
    [rows],
  )
  const entries = useMemo(() => {
    const words = filter.words
    return (journal?.entries ?? []).filter((entry) => {
      if (entry.conversationId && liveIds.has(entry.conversationId)) return false
      if (filter.cards.length > 0 && !filter.cards.includes(entry.cardNumber ?? -1)) return false
      if (words.length === 0) return true
      const haystack = `${entry.title} ${entry.source ?? ''} ${entry.cardNumber ? `#${entry.cardNumber}` : ''}`.toLowerCase()
      return words.every((word) => haystack.includes(word))
    })
  }, [journal, liveIds, filter])
  const days = useJournalDays(entries, kind)
  const totals = countByFilter(entries)

  // Le jalon d'une carte : sa parente. Un jalon *est* une carte qui a des enfants.
  const byNumber = useMemo(() => new Map((cards ?? []).map((card) => [card.number, card])), [cards])
  const byId = useMemo(() => new Map((cards ?? []).map((card) => [card.id, card])), [cards])
  const conversationsById = useMemo(
    () => new Map((conversations ?? []).map((conversation) => [conversation.id, conversation])),
    [conversations],
  )

  const milestoneOfCard = (card: CardDto | undefined): MilestoneRef | null =>
    card?.parent ? { number: card.parent.number, title: card.parent.title } : null

  return {
    projectId,
    project,
    isPending,
    runs: runs ?? [],
    journalDays: journal?.days ?? 0,
    /** Élargit la fenêtre du journal : le double, un an au plus. */
    loadOlder: () => setWindowDays((current) => Math.min(current * 2, MAX_JOURNAL_DAYS)),
    canLoadOlder: windowDays < MAX_JOURNAL_DAYS,
    loadingOlder: journalFetching && !fresh,
    /** Une carte-jalon, c'est-à-dire une carte qui a des enfants. */
    isMilestoneCard: (number: number | null): boolean => number !== null && (byNumber.get(number)?.children.length ?? 0) > 0,
    query,
    setQuery,
    kind,
    setKind,
    searching: isActiveFilter(filter),
    live,
    liveByGroup: (group: ActivityGroup) => live.filter((row) => row.group === group),
    days,
    entries,
    totals,
    isExpanded: (id: string) => expanded.has(id),
    toggle: (id: string) =>
      setExpanded((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    /** Le jalon d'une session vivante, par sa carte. */
    milestoneOfRow: (row: ActivityRow): MilestoneRef | null => {
      const link = row.entry.conversation.card
      return link ? milestoneOfCard(byId.get(link.id)) : null
    },
    /** Le jalon d'une ligne d'historique, par le numéro de sa carte. */
    milestoneOfEntry: (entry: JournalEntryDto): MilestoneRef | null =>
      entry.cardNumber === null ? null : milestoneOfCard(byNumber.get(entry.cardNumber)),
    /** La session d'une ligne d'historique, pour son agent. */
    conversationOf: (entry: JournalEntryDto): ConversationDto | undefined =>
      entry.conversationId ? conversationsById.get(entry.conversationId) : undefined,
    /** Où mène une ligne d'historique : sa session, sinon la fiche de sa carte, sur place. */
    entryHref: (entry: JournalEntryDto): string | null => {
      if (entry.conversationId) return href(`/p/${entry.projectId}/c/${entry.conversationId}`)
      if (entry.cardNumber !== null) return href(`?fiche=${entry.cardNumber}`)
      return null
    },
  }
}

export type ActivityModel = ReturnType<typeof useActivityModel>
export type { ActivityRow, JournalDay }

/* ------------------------------------------------------------------ petites pièces */

export function SearchField({ model, className }: { model: ActivityModel; className?: string }) {
  return (
    <label className={cx('flex h-9 min-w-0 items-center gap-2 rounded-lg bg-sunken px-3 text-sm', className)}>
      <Search size={15} aria-hidden className="shrink-0 text-ink-faint" />
      <input
        type="search"
        value={model.query}
        onChange={(event) => model.setQuery(event.target.value)}
        aria-label="Chercher dans l'activité"
        placeholder="Session, carte (#12), branche…"
        className="h-full w-full min-w-0 bg-transparent outline-none placeholder:text-ink-faint"
      />
    </label>
  )
}

/** Les natures du Journal, en segmenté discret : le choix courant seul est appuyé. */
export function KindFilter({ model, className }: { model: ActivityModel; className?: string }) {
  const t = useTranslate()
  return (
    <div role="radiogroup" aria-label="Nature" className={cx('flex min-w-0 items-center gap-1 overflow-x-auto', className)}>
      {JOURNAL_FILTERS.map((entry) => {
        const active = entry === model.kind
        const empty = model.totals[entry] === 0
        return (
          <button
            key={entry}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => model.setKind(entry)}
            className={cx(
              'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap transition-colors',
              active ? 'bg-surface-high font-medium text-ink' : empty ? 'text-ink-faint/50' : 'text-ink-faint hover:text-ink',
            )}
          >
            {t(JOURNAL_FILTER_LABELS[entry])}
            <span className="tabular-nums opacity-60">{model.totals[entry]}</span>
          </button>
        )
      })}
    </div>
  )
}

/** « Jalon #901 » : le repère d'une session ou d'une ligne qui fait partie d'un jalon. */
export function MilestoneTag({ milestone, projectId, className }: { milestone: MilestoneRef; projectId: string; className?: string }) {
  const href = useProtoHref()
  const navigate = useNavigate()
  const to = href(`/p/${projectId}/timeline/${milestone.number}`)
  // Un `span` qui navigue, et non un lien : il vit souvent dans une ligne qui en est
  // déjà un, et un `<a>` dans un `<a>` n'est pas du HTML.
  const go = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault()
    event.stopPropagation()
    navigate(to)
  }
  return (
    <span
      role="link"
      tabIndex={0}
      title={milestone.title}
      onClick={go}
      onKeyDown={(event) => {
        if (event.key === 'Enter') go(event)
      }}
      className={cx(
        'inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-4 text-accent hover:bg-accent-wash/50',
        className,
      )}
    >
      <Flag size={11} aria-hidden className="shrink-0" />
      <span className="shrink-0 tabular-nums">Jalon #{milestone.number}</span>
      <span className="min-w-0 truncate text-ink-faint">{milestone.title}</span>
    </span>
  )
}

export function dayLabel(at: number): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const gap = Math.round((today.getTime() - at) / 86_400_000)
  if (gap === 0) return 'Aujourd’hui'
  if (gap === 1) return 'Hier'
  return new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(at)
}

export function timeOf(at: number): string {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(at)
}

/** Un état vide sobre : une phrase, pas un cadre. */
export function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-sm text-ink-faint', className)}>{children}</p>
}
