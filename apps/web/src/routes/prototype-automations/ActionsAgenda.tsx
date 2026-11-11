/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * L'agenda de l'onglet Actions : les passages passés et à venir des actions planifiées,
 * sur une semaine ou un jour. Ce que la liste ne montre pas : ce qui tombe en même temps,
 * une nuit chargée, un trou.
 *
 * - les heures sans rien sont **resserrées** (une heure de marge autour de ce qui existe),
 *   un « ⋯ » les déplie ;
 * - un bloc a la couleur de sa **nature** (agent, commande, service), et son **verdict**
 *   en bord gauche quand il est passé ; un passage à venir est en pointillé ;
 * - un clic sur un bloc ouvre le tiroir de l'action ;
 * - au téléphone, une liste par jour.
 */
import { ChevronLeft, ChevronRight, MoreHorizontal, Server, SquareTerminal, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { formatDateTime } from '../../lib/schedules'
import { upcoming } from './ScheduleBuilder'
import type { Automation, RunStatus } from './model'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** Hauteur d'une heure dépliée, et d'une plage resserrée. */
const HOUR_PX = 44
const FOLD_PX = 22
const MIN_BLOCK = 20

export type ActionsAgendaMode = 'semaine' | 'jour'

type Row = { kind: 'hour'; hour: number; top: number } | { kind: 'fold'; from: number; to: number; top: number }

interface Shot {
  key: string
  item: Automation
  start: number
  end: number
  /** Null : un passage à venir. */
  status: RunStatus | null
}

interface Placed extends Shot {
  lane: number
  lanes: number
  overlaps: boolean
}

function startOfDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function startOfWeek(ts: number): number {
  const day = startOfDay(ts)
  return day - ((new Date(day).getDay() + 6) % 7) * DAY
}

/** La durée habituelle d'une action : la médiane de ses passages finis, sinon 20 min. */
function typical(item: Automation): number {
  const durations = item.runs.filter((run) => run.finishedAt).map((run) => run.finishedAt! - run.startedAt).sort((a, b) => a - b)
  return durations.length ? Math.max(5 * MIN, durations[Math.floor(durations.length / 2)]!) : 20 * MIN
}

const NATURE: Record<'agent' | 'task' | 'service', { fill: string; label: string }> = {
  agent: { fill: 'bg-accent/12 border-accent/35 text-ink', label: 'agent' },
  task: { fill: 'bg-surface-high border-line-strong text-ink', label: 'commande' },
  service: { fill: 'bg-positive/10 border-positive/35 text-ink', label: 'service' },
}

const VERDICT_EDGE: Partial<Record<RunStatus, string>> = {
  succeeded: 'before:bg-positive',
  failed: 'before:bg-critical',
  timed_out: 'before:bg-caution',
  running: 'before:bg-accent before:animate-pulse',
  checking: 'before:bg-accent',
  skipped: 'before:bg-line-strong',
}

const natureOf = (item: Automation): 'agent' | 'task' | 'service' => (item.what === 'agent' ? 'agent' : item.commandKind === 'service' ? 'service' : 'task')

function NatureIcon({ item, size = 12 }: { item: Automation; size?: number }) {
  if (item.what === 'agent' && item.agent) return <AgentIcon agent={item.agent} size={size} />
  return item.commandKind === 'service' ? <Server size={size} className="shrink-0 text-ink-faint" /> : <SquareTerminal size={size} className="shrink-0 text-ink-faint" />
}

export function ActionsAgenda({ items, mode, onMode, onOpen }: {
  items: Automation[]
  mode: ActionsAgendaMode
  onMode: (mode: ActionsAgendaMode) => void
  onOpen: (item: Automation) => void
}) {
  const [anchor, setAnchor] = useState(() => Date.now())
  const [unfolded, setUnfolded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const days = mode === 'semaine' ? 7 : 1
  const from = mode === 'semaine' ? startOfWeek(anchor) : startOfDay(anchor)
  const to = from + days * DAY

  const planned = items.filter((item) => item.schedule)

  /* Les passages de la période : passés (les vrais) et à venir (calculés). */
  const shots = useMemo(() => {
    const out: Shot[] = []
    for (const item of planned) {
      for (const run of item.runs) {
        const end = run.finishedAt ?? Math.max(now, run.startedAt + 10 * MIN)
        if (end < from || run.startedAt > to) continue
        out.push({ key: run.id, item, start: run.startedAt, end, status: run.status })
      }
      if (item.schedule?.enabled) {
        const length = typical(item)
        for (const at of upcoming(item.schedule.cadence, 200, to)) {
          if (at >= from && at > now) out.push({ key: `${item.id}-${at}`, item, start: at, end: at + length, status: null })
        }
      }
    }
    return out
  }, [planned, from, to, now])

  const columns = useMemo(
    () =>
      Array.from({ length: days }, (_, index) => {
        const dayStart = from + index * DAY
        const mine = shots
          .filter((shot) => shot.start < dayStart + DAY && shot.end > dayStart)
          .map((shot) => ({ ...shot, start: Math.max(shot.start, dayStart), end: Math.min(shot.end, dayStart + DAY) }))
          .sort((a, b) => a.start - b.start)
        return { dayStart, shots: layout(mine) }
      }),
    [shots, from, days],
  )

  /* Les heures montrées : celles qui portent quelque chose, plus une heure de marge, et
     l'heure courante si elle est dans la période. Le reste se resserre. */
  const shownHours = useMemo(() => {
    if (unfolded) return new Set(Array.from({ length: 24 }, (_, hour) => hour))
    const set = new Set<number>()
    const mark = (hour: number) => {
      for (const h of [hour - 1, hour, hour + 1]) if (h >= 0 && h < 24) set.add(h)
    }
    for (const column of columns) {
      for (const shot of column.shots) {
        const first = new Date(shot.start).getHours()
        const last = new Date(Math.max(shot.start, shot.end - 1)).getHours()
        for (let hour = first; hour <= last; hour += 1) mark(hour)
      }
    }
    if (now >= from && now < to) mark(new Date(now).getHours())
    if (set.size === 0) for (let hour = 8; hour <= 19; hour += 1) set.add(hour)
    return set
  }, [columns, unfolded, now, from, to])

  /* La géométrie verticale : chaque heure montrée prend HOUR_PX, chaque plage cachée FOLD_PX. */
  const rows = useMemo(() => {
    const list: Row[] = []
    let top = 0
    let hour = 0
    while (hour < 24) {
      if (shownHours.has(hour)) {
        list.push({ kind: 'hour', hour, top })
        top += HOUR_PX
        hour += 1
      } else {
        const start = hour
        while (hour < 24 && !shownHours.has(hour)) hour += 1
        list.push({ kind: 'fold', from: start, to: hour, top })
        top += FOLD_PX
      }
    }
    return { list, height: top }
  }, [shownHours])

  const yOf = (ts: number, dayStart: number): number => {
    const minutes = (ts - dayStart) / MIN
    const hour = Math.floor(minutes / 60)
    for (const row of rows.list) {
      if (row.kind === 'hour' && row.hour === hour) return row.top + ((minutes - hour * 60) / 60) * HOUR_PX
      if (row.kind === 'fold' && hour >= row.from && hour < row.to) return row.top + FOLD_PX / 2
    }
    return rows.height
  }

  const clashes = columns.reduce((count, column) => count + column.shots.filter((shot) => shot.overlaps && shot.lane === 0).length, 0)
  const live = items.filter((item) => item.live)
  const title =
    mode === 'semaine'
      ? new Date(from).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      : new Date(from).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    /* La grille ou la liste suivent la largeur du conteneur, pas celle de l'écran : dans
       le panneau d'une conversation, l'agenda est étroit même sur un grand écran. */
    <div className="@container/agenda flex flex-col gap-3">
      {/* En-tête : le mois, la navigation, la portée. */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-base font-semibold text-ink first-letter:uppercase">{title}</h2>
        <span className="inline-flex items-center rounded-md border border-line">
          <button type="button" aria-label="Précédent" onClick={() => setAnchor(anchor - days * DAY)} className="grid size-8 place-items-center text-ink-faint hover:text-ink"><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => setAnchor(Date.now())} className="h-8 border-x border-line px-2.5 text-xs text-ink-soft hover:text-ink">Aujourd'hui</button>
          <button type="button" aria-label="Suivant" onClick={() => setAnchor(anchor + days * DAY)} className="grid size-8 place-items-center text-ink-faint hover:text-ink"><ChevronRight size={16} /></button>
        </span>
        <span role="radiogroup" aria-label="Portée" className="inline-flex rounded-md border border-line p-0.5">
          {(['semaine', 'jour'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={mode === entry}
              onClick={() => onMode(entry)}
              className={cx('h-7 rounded px-2.5 text-xs capitalize', mode === entry ? 'bg-surface-high font-medium text-ink' : 'text-ink-faint hover:text-ink')}
            >
              {entry}
            </button>
          ))}
        </span>
        {clashes > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-caution"><TriangleAlert size={12} /> {clashes} chevauchement{clashes > 1 ? 's' : ''}</span>
        ) : null}
        <Legend />
      </div>

      {planned.length === 0 ? <p className="text-sm text-ink-faint">Rien de planifié pour l'instant. « + Action » pour en planifier une.</p> : null}

      {/* Au large : la grille. */}
      <div className="hidden overflow-hidden rounded-lg border border-line @min-[44rem]/agenda:block">
        <div className="grid border-b border-line" style={{ gridTemplateColumns: `3.5rem repeat(${days}, minmax(0, 1fr))` }}>
          <span />
          {columns.map(({ dayStart }) => {
            const today = dayStart === startOfDay(now)
            const date = new Date(dayStart)
            return (
              <div key={dayStart} className="flex flex-col gap-1 border-l border-line px-2 py-2">
                <span className="flex items-baseline gap-1.5">
                  <span className={cx('text-[11px] uppercase', today ? 'text-accent' : 'text-ink-faint')}>{date.toLocaleDateString('fr-FR', { weekday: 'short' })}</span>
                  <span className={cx('grid size-7 place-items-center rounded-full text-sm tabular-nums', today ? 'bg-accent font-semibold text-accent-ink' : 'text-ink')}>{date.getDate()}</span>
                </span>
                {/* Ce qui tourne en continu, en bandeau du jour : un service n'a pas d'heure. */}
                {today && live.length ? (
                  <span className="flex flex-col gap-0.5">
                    {live.map((item) => (
                      <button key={item.id} type="button" onClick={() => onOpen(item)} className="flex min-w-0 items-center gap-1 rounded bg-positive/10 px-1.5 py-0.5 text-left text-[11px] text-ink hover:bg-positive/20">
                        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-positive" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="max-h-[36rem] overflow-y-auto">
          <div className="relative grid" style={{ gridTemplateColumns: `3.5rem repeat(${days}, minmax(0, 1fr))`, height: rows.height }}>
            <div className="relative">
              {rows.list.map((row) =>
                row.kind === 'hour' ? (
                  <span key={`h${row.hour}`} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-ink-faint" style={{ top: row.top }}>
                    {row.hour === 0 ? '' : `${String(row.hour).padStart(2, '0')}:00`}
                  </span>
                ) : (
                  <button
                    key={`f${row.from}`}
                    type="button"
                    onClick={() => setUnfolded(true)}
                    title={`Déplier ${row.from} h – ${row.to} h`}
                    className="absolute inset-x-1 grid place-items-center rounded text-ink-faint hover:bg-surface-high hover:text-ink"
                    style={{ top: row.top + 2, height: FOLD_PX - 4 }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                ),
              )}
            </div>
            {columns.map(({ dayStart, shots: placed }) => (
              <div key={dayStart} className={cx('relative border-l border-line', dayStart === startOfDay(now) && 'bg-accent/[0.03]')}>
                {rows.list.map((row) =>
                  row.kind === 'hour' ? (
                    <span key={`h${row.hour}`} className="absolute inset-x-0 border-t border-line/50" style={{ top: row.top }} />
                  ) : (
                    <span key={`f${row.from}`} className="absolute inset-x-0 border-y border-dashed border-line/60 bg-surface/40" style={{ top: row.top, height: FOLD_PX }} />
                  ),
                )}
                {now >= dayStart && now < dayStart + DAY ? (
                  <span className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-accent" style={{ top: yOf(now, dayStart) }}>
                    <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-accent" />
                  </span>
                ) : null}
                {placed.map((shot) => {
                  const top = yOf(shot.start, dayStart)
                  const height = Math.max(yOf(shot.end, dayStart) - top, MIN_BLOCK)
                  return <Block key={shot.key} shot={shot} top={top} height={height} onOpen={() => onOpen(shot.item)} />
                })}
              </div>
            ))}
          </div>
        </div>
        {unfolded ? (
          <button type="button" onClick={() => setUnfolded(false)} className="w-full border-t border-line py-1.5 text-xs text-ink-faint hover:text-ink">
            Resserrer les heures vides
          </button>
        ) : null}
      </div>

      {/* Au téléphone : une liste par jour. */}
      <div className="flex flex-col gap-4 @min-[44rem]/agenda:hidden">
        {columns.map(({ dayStart, shots: placed }) => (
          <section key={dayStart} className="flex flex-col gap-1">
            <h3 className={cx('text-sm font-medium first-letter:uppercase', dayStart === startOfDay(now) ? 'text-accent' : 'text-ink')}>
              {new Date(dayStart).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
            {placed.length === 0 ? (
              <span className="text-xs text-ink-faint">Rien.</span>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {placed.map((shot) => (
                  <li key={shot.key}>
                    <button type="button" onClick={() => onOpen(shot.item)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
                      <span className="w-11 shrink-0 text-xs tabular-nums text-ink-faint">{new Date(shot.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      <NatureIcon item={shot.item} />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{shot.item.label}</span>
                      <span className={cx('text-xs', shot.status === 'failed' ? 'text-critical' : 'text-ink-faint')}>{shot.status ? VERDICT_WORD[shot.status] : 'prévu'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

const VERDICT_WORD: Record<RunStatus, string> = {
  checking: 'vérification',
  running: 'en cours',
  succeeded: 'réussi',
  failed: 'échoué',
  timed_out: 'trop long',
  skipped: 'sauté',
}

function Block({ shot, top, height, onOpen }: { shot: Placed; top: number; height: number; onOpen: () => void }) {
  const nature = natureOf(shot.item)
  const width = 100 / shot.lanes
  const time = new Date(shot.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const planned = shot.status === null
  const tall = height >= 36
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${shot.item.label}\n${formatDateTime(shot.start)} · ${planned ? 'prévu' : VERDICT_WORD[shot.status!]} · ${NATURE[nature].label}${shot.overlaps ? '\nchevauche une autre action' : ''}`}
      className={cx(
        'absolute flex min-w-0 overflow-hidden rounded-md border text-left text-[11px] leading-tight transition-[filter] hover:brightness-110',
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        NATURE[nature].fill,
        planned ? 'border-dashed bg-canvas/70 before:bg-transparent' : VERDICT_EDGE[shot.status!],
        shot.overlaps && 'ring-1 ring-caution/70',
        tall ? 'flex-col gap-0.5 py-1 pr-1.5 pl-2' : 'items-center gap-1 pr-1.5 pl-2',
      )}
      style={{ top, height, left: `calc(${shot.lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
    >
      <span className="flex min-w-0 items-center gap-1">
        <NatureIcon item={shot.item} size={11} />
        <span className="min-w-0 truncate font-medium">{shot.item.label}</span>
      </span>
      <span className="shrink-0 tabular-nums text-ink-faint">{time}</span>
    </button>
  )
}

function Legend() {
  return (
    <span className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
      <span className="flex items-center gap-1"><span className="h-2.5 w-3.5 rounded-sm border border-accent/35 bg-accent/12" />agent</span>
      <span className="flex items-center gap-1"><span className="h-2.5 w-3.5 rounded-sm border border-line-strong bg-surface-high" />commande</span>
      <span className="flex items-center gap-1"><span className="h-2.5 w-3.5 rounded-sm border border-dashed border-line-strong" />prévu</span>
      <span className="flex items-center gap-1"><span className="h-2.5 w-[3px] rounded-sm bg-positive" /><span className="h-2.5 w-[3px] rounded-sm bg-critical" />verdict</span>
    </span>
  )
}

/** Range les passages d'un jour en grappes qui se chevauchent, côte à côte. */
function layout(shots: Shot[]): Placed[] {
  const out: Placed[] = []
  let cluster: Placed[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((shot) => shot.lane + 1))
    // Deux passages d'une même action ne se chevauchent pas : elle ne tourne jamais deux fois.
    const owners = new Set(cluster.map((shot) => shot.item.id))
    for (const shot of cluster) out.push({ ...shot, lanes, overlaps: owners.size > 1 })
    cluster = []
  }
  for (const shot of shots) {
    const visualEnd = Math.max(shot.end, shot.start + 30 * MIN)
    if (shot.start >= clusterEnd && cluster.length) flush()
    const used = new Set(cluster.filter((entry) => entry.end > shot.start).map((entry) => entry.lane))
    let lane = 0
    while (used.has(lane)) lane += 1
    cluster.push({ ...shot, lane, lanes: 1, overlaps: false })
    clusterEnd = Math.max(clusterEnd === -Infinity ? 0 : clusterEnd, visualEnd)
  }
  if (cluster.length) flush()
  return out
}
