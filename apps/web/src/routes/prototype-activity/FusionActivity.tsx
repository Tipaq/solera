/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { CalendarDays, ChevronDown, ChevronRight, History, Layers, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { JournalEntryDto } from '@solera/protocol'
import { EmptyState, cx } from '@solera/ui'
import { JournalRow } from '../../components/journal/JournalView'
import { MilestoneBanner } from '../../components/project/MilestoneBanner'
import { Marker, SessionRow, type SessionMarker } from '../../components/project/SessionRow'
import { isActiveFilter, matchesActivity, parseActivityFilter, type ActivityGroup } from '../../lib/activity-groups'
import { useActivityRows, type ActivityRow } from '../../lib/activity-rows'
import { locale, useTranslate } from '../../lib/i18n'
import {
  JOURNAL_FILTERS,
  JOURNAL_FILTER_LABELS,
  countByFilter,
  useJournal,
  useJournalDays,
  type JournalFilter,
} from '../../lib/journal'
import { useActiveMilestones } from '../../lib/milestones'
import { useProjects } from '../../lib/projects'

/** Le vivant : ce qui te demande quelque chose, ce qui est à relire, ce qui tourne. */
const LIVE_GROUPS: { group: ActivityGroup; label: string; marker: SessionMarker }[] = [
  { group: 'asking', label: 'À toi', marker: 'awaiting' },
  { group: 'review', label: 'À relire', marker: 'review' },
  { group: 'running', label: 'En cours', marker: 'working' },
]

/**
 * L'Activité fusionnée avec le Journal : **le vivant, puis l'historique**.
 *
 * En haut les sessions vivantes, groupées par ce qu'elles attendent de toi ; dessous
 * l'historique par jour, celui du Journal, avec ses filtres par nature. Une session
 * terminée n'est plus un groupe du haut : elle n'apparaît qu'une fois, dans
 * l'historique. Une session vivante, à l'inverse, ne s'y redit pas. La recherche en tête
 * filtre les deux.
 */
export function FusionActivity() {
  const { projectId } = useParams()
  const t = useTranslate()
  const { data: projects, isPending } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  const rows = useActivityRows(projectId, project)
  const { data: runs } = useActiveMilestones(projectId)
  const { data: journal } = useJournal(projectId)

  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<JournalFilter>('all')
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
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

  // Une session vivante est en haut : sa ligne d'historique la redirait.
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

  if (isPending) return null
  if (!projectId || !project) return <EmptyState title={t('project.notFound')} />

  const toggleGroup = (key: string) =>
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleRow = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const searching = isActiveFilter(filter)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Une seule recherche, qui filtre le vivant et l'historique. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-sunken px-3 sm:max-w-md">
          <Search size={16} aria-hidden className="shrink-0 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Chercher dans l'activité"
            placeholder="Chercher une session, une carte (#12), une branche…"
            className="min-h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
        </div>
        <span className="ml-auto hidden text-xs text-ink-faint sm:block">
          {live.length} en direct · {entries.length} dans l'historique ({journal?.days ?? 0} j)
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        {/* ---------------------------------------------------------------- le vivant */}
        <section aria-labelledby="fusion-live" className="flex flex-col">
          <h2 id="fusion-live" className="flex items-center gap-2 px-4 pt-4 pb-2 text-xs font-medium tracking-wide text-ink-faint uppercase">
            <Layers size={13} /> En direct
          </h2>

          {(runs ?? []).map((run) => (
            <div key={run.id} className="px-4 pb-3">
              <MilestoneBanner projectId={projectId} run={run} />
            </div>
          ))}

          {live.length === 0 ? (
            <p className="mx-4 mb-2 rounded-lg border border-dashed border-line px-3 py-3 text-sm text-ink-faint">
              {searching ? 'Aucune session vivante ne correspond.' : 'Aucune session ne tourne. Tout ce qui s’est passé est dessous.'}
            </p>
          ) : (
            <div className="mx-4 overflow-hidden rounded-xl border border-line">
              {LIVE_GROUPS.map(({ group, label, marker }) => {
                const members = live.filter((row) => row.group === group)
                if (members.length === 0) return null
                const open = !folded.has(group)
                return (
                  <section key={group} className="border-t border-line first:border-t-0">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleGroup(group)}
                      className={cx(
                        'flex w-full items-center gap-2.5 bg-sunken px-4 py-1.5 text-left text-sm hover:text-ink',
                        group === 'asking' ? 'text-caution' : 'text-ink-soft',
                      )}
                    >
                      {open ? <ChevronDown size={14} className="shrink-0 text-ink-faint" /> : <ChevronRight size={14} className="shrink-0 text-ink-faint" />}
                      <Marker marker={marker} decorative />
                      {label}
                      <span className="text-xs text-ink-faint tabular-nums">{members.length}</span>
                    </button>
                    {open ? (
                      <ul className="divide-y divide-line border-t border-line">
                        {members.map((row: ActivityRow) => (
                          <SessionRow
                            key={row.entry.conversation.id}
                            conversation={row.entry.conversation}
                            marker={row.marker}
                            summary={row.summary}
                            place={row.place}
                            pr={row.pr}
                            request={row.request}
                            expanded={expanded.has(row.entry.conversation.id)}
                            onToggle={() => toggleRow(row.entry.conversation.id)}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </section>
                )
              })}
            </div>
          )}
        </section>

        {/* ----------------------------------------------------------- l'historique */}
        <section aria-labelledby="fusion-history" className="mt-6 flex flex-col">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-line bg-canvas/95 px-4 py-1.5 backdrop-blur">
            <h2 id="fusion-history" className="flex items-center gap-2 text-xs font-medium tracking-wide text-ink-faint uppercase">
              <History size={13} /> Historique
            </h2>
            <div role="radiogroup" aria-label="Nature" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {JOURNAL_FILTERS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="radio"
                  aria-checked={entry === kind}
                  onClick={() => setKind(entry)}
                  className={cx(
                    'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors',
                    entry === kind ? 'bg-surface-high text-ink' : totals[entry] === 0 ? 'text-ink-faint/60' : 'text-ink-faint hover:text-ink',
                  )}
                >
                  {t(JOURNAL_FILTER_LABELS[entry])}
                  <span className="text-xs tabular-nums opacity-70">{totals[entry]}</span>
                </button>
              ))}
            </div>
          </div>

          {days.length === 0 ? (
            <p className="mx-4 mt-3 text-sm text-ink-faint">
              {searching || kind !== 'all' ? 'Rien dans l’historique ne correspond.' : 'Rien ne s’est passé ces derniers jours.'}
            </p>
          ) : (
            <div className="flex flex-col gap-4 px-4 pt-3">
              {days.map((day) => (
                <section key={day.at} className="flex min-w-0 flex-col gap-1.5">
                  <h3 className="flex items-center gap-2 px-1 text-sm text-ink-soft">
                    <CalendarDays size={14} className="shrink-0 text-ink-faint" />
                    <span className="shrink-0">{dayLabel(day.at)}</span>
                    <span aria-hidden className="h-px min-w-0 flex-1 bg-line" />
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {day.entries.map((entry: JournalEntryDto) => (
                      <JournalRow key={entry.id} entry={entry} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function dayLabel(at: number): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const gap = Math.round((today.getTime() - at) / 86_400_000)
  if (gap === 0) return 'Aujourd’hui'
  if (gap === 1) return 'Hier'
  return new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(at)
}
