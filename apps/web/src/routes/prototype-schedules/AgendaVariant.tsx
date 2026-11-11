/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { formatDateTime } from '../../lib/schedules'
import { DAY, HOUR, MINUTE, formatCost, formatDuration, plannedRuns, typicalDuration, type ScheduleProto } from './data'
import { RUN_BLOCK, RUN_WORD, Summary, type Task } from './shared'

/** Hauteur d'une heure, en pixels : 24 h tiennent en 1 152 px, on ouvre sur 6 h. */
const HOUR_PX = 48
/** Un bloc trop court pour son texte garde une hauteur lisible. */
const MIN_BLOCK = 18

export type AgendaMode = 'semaine' | 'jour'
type Mode = AgendaMode

interface Block {
  key: string
  task: Task
  start: number
  end: number
  /** Null : un tir à venir, dessiné en pointillé avec la durée habituelle. */
  status: Task['runs'][number]['status'] | null
  cost: number | null
  /** Rang dans sa grappe de chevauchements, pour poser les blocs côte à côte. */
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
  const date = new Date(startOfDay(ts))
  const offset = (date.getDay() + 6) % 7 // lundi
  date.setDate(date.getDate() - offset)
  return date.getTime()
}

/**
 * `agenda` : les tirs passés et à venir sur une grille de semaine (ou de jour), la
 * couleur pour le verdict. Ce que la liste ne montre pas : deux tâches qui tombent à la
 * même heure, ou une nuit chargée.
 */
/** `mode` : tenu par la page (le menu « Affichage » de l'onglet Actions) ; le bascule interne disparaît alors. */
export function AgendaVariant({ proto, mode: controlled }: { proto: ScheduleProto; mode?: Mode }) {
  const [own, setMode] = useState<Mode>('semaine')
  const mode = controlled ?? own
  const [anchor, setAnchor] = useState(() => Date.now())
  const now = Date.now()
  const from = mode === 'semaine' ? startOfWeek(anchor) : startOfDay(anchor)
  const days = mode === 'semaine' ? 7 : 1
  const to = from + days * DAY

  const columns = useMemo(() => {
    const blocks: Omit<Block, 'lane' | 'lanes' | 'overlaps'>[] = []
    for (const task of proto.tasks) {
      for (const run of task.runs) {
        const end = run.finishedAt ?? Math.max(now, run.startedAt + 15 * MINUTE)
        if (end < from || run.startedAt > to) continue
        blocks.push({ key: run.id, task, start: run.startedAt, end, status: run.status, cost: proto.costOf(run) })
      }
      const typical = typicalDuration(task)
      for (const at of plannedRuns(task, from, to)) {
        blocks.push({ key: `${task.id}-${at}`, task, start: at, end: at + typical, status: null, cost: null })
      }
    }
    return Array.from({ length: days }, (_, index) => {
      const dayStart = from + index * DAY
      const mine = blocks
        .filter((block) => block.start < dayStart + DAY && block.end > dayStart)
        .map((block) => ({ ...block, start: Math.max(block.start, dayStart), end: Math.min(block.end, dayStart + DAY) }))
        .sort((a, b) => a.start - b.start)
      return { dayStart, blocks: layout(mine) }
    })
  }, [proto, from, to, days, now])

  const clashes = columns.flatMap((column) => column.blocks.filter((block) => block.overlaps && block.lane === 0))

  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 6 * HOUR_PX
  }, [mode])

  const title =
    mode === 'semaine'
      ? `Semaine du ${new Date(from).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
      : new Date(from).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="flex flex-col gap-4">
      <Summary proto={proto}>
        {controlled ? null : <span className="flex overflow-hidden rounded-lg border border-line text-xs">
          {(['semaine', 'jour'] as Mode[]).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setMode(entry)}
              className={cx('px-2.5 py-1 capitalize', mode === entry ? 'bg-surface-high text-ink' : 'text-ink-faint hover:text-ink')}
            >
              {entry}
            </button>
          ))}
        </span>}
      </Summary>

      {/* La grille reste là même vide : un agenda sans passage est encore un agenda, et
          c'est lui qui montre où poser la première tâche. */}
      <>
          {proto.tasks.length === 0 ? (
            <p className="text-sm text-ink-faint">Rien de planifié pour l'instant. « + Action » pour en planifier une.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-label="Précédent" onClick={() => setAnchor(anchor - days * DAY)} className="grid size-8 place-items-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink">
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={() => setAnchor(Date.now())} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-soft hover:border-line-strong">
              Aujourd'hui
            </button>
            <button type="button" aria-label="Suivant" onClick={() => setAnchor(anchor + days * DAY)} className="grid size-8 place-items-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink">
              <ChevronRight size={16} />
            </button>
            <h2 className="text-sm font-medium first-letter:uppercase">{title}</h2>
            <Legend />
          </div>

          {clashes.length > 0 ? (
            <p className="flex items-start gap-2 rounded-lg bg-caution/10 px-3 py-2 text-xs text-caution">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                {clashes.length} chevauchement{clashes.length > 1 ? 's' : ''} sur la période : deux tâches qui tournent en même temps se disputent le quota.
                {' '}
                {clashes.slice(0, 3).map((block) => `${new Date(block.start).toLocaleDateString('fr-FR', { weekday: 'short' })} ${new Date(block.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`).join(', ')}
              </span>
            </p>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-line">
            {/* En-tête des jours, collé à la grille. */}
            <div className="grid border-b border-line bg-surface/60" style={{ gridTemplateColumns: `3rem repeat(${days}, minmax(0, 1fr))` }}>
              <span />
              {columns.map(({ dayStart }) => {
                const today = dayStart === startOfDay(now)
                return (
                  <span key={dayStart} className={cx('border-l border-line px-2 py-1.5 text-xs', today ? 'font-medium text-accent' : 'text-ink-faint')}>
                    {new Date(dayStart).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
                  </span>
                )
              })}
            </div>

            <div ref={scroller} className="max-h-[34rem] overflow-y-auto">
              <div className="relative grid" style={{ gridTemplateColumns: `3rem repeat(${days}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
                {/* Les heures, et leurs traits en travers de la grille. */}
                <div className="relative">
                  {Array.from({ length: 24 }, (_, hour) => (
                    <span key={hour} className="absolute right-2 -translate-y-1/2 text-meta tabular-nums text-ink-faint" style={{ top: hour * HOUR_PX }}>
                      {hour === 0 ? '' : `${String(hour).padStart(2, '0')}h`}
                    </span>
                  ))}
                </div>
                {columns.map(({ dayStart, blocks }) => (
                  <div key={dayStart} className="relative border-l border-line">
                    {Array.from({ length: 24 }, (_, hour) => (
                      <span key={hour} className="absolute inset-x-0 border-t border-line/50" style={{ top: hour * HOUR_PX }} />
                    ))}
                    {now >= dayStart && now < dayStart + DAY ? (
                      <span className="absolute inset-x-0 z-10 border-t-2 border-accent" style={{ top: ((now - dayStart) / HOUR) * HOUR_PX }}>
                        <span className="absolute -top-1 -left-1 size-2 rounded-full bg-accent" />
                      </span>
                    ) : null}
                    {blocks.map((block) => (
                      <AgendaBlock key={block.key} block={block} dayStart={dayStart} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
    </div>
  )
}

function AgendaBlock({ block, dayStart }: { block: Block; dayStart: number }) {
  const top = ((block.start - dayStart) / HOUR) * HOUR_PX
  const height = Math.max(((block.end - block.start) / HOUR) * HOUR_PX, MIN_BLOCK)
  const width = 100 / block.lanes
  const planned = block.status === null
  const time = new Date(block.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const title = [
    block.task.name,
    `${formatDateTime(block.start)}${planned ? ' · prévu' : ` · ${RUN_WORD[block.status!]}`}`,
    planned ? `durée habituelle ${formatDuration(block.end - block.start)}` : `durée ${formatDuration(block.end - block.start)} · ${formatCost(block.cost)}`,
    block.overlaps ? 'chevauche une autre tâche' : '',
  ].filter(Boolean).join('\n')

  return (
    <div
      title={title}
      className={cx(
        'absolute flex min-w-0 items-start gap-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-meta leading-tight',
        planned ? 'border-dashed border-line-strong bg-canvas/80 text-ink-soft' : RUN_BLOCK[block.status!],
        block.status === 'running' && 'animate-pulse',
        block.overlaps && 'ring-2 ring-caution/70',
      )}
      style={{ top, height, left: `calc(${block.lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
    >
      <AgentIcon agent={block.task.agent} size={11} />
      <span className="min-w-0 truncate">
        <span className="tabular-nums opacity-70">{time}</span> {block.task.name}
      </span>
    </div>
  )
}

function Legend() {
  const items: [string, string][] = [
    ['border-positive/50 bg-positive/12', 'réussi'],
    ['border-critical/60 bg-critical/12', 'échoué'],
    ['border-caution/60 bg-caution/12', 'trop long'],
    ['border-dashed border-line-strong bg-canvas', 'prévu'],
  ]
  return (
    <span className="ml-auto flex flex-wrap items-center gap-3 text-meta text-ink-faint">
      {items.map(([shape, label]) => (
        <span key={label} className="flex items-center gap-1">
          <span className={cx('h-2.5 w-3.5 rounded-sm border', shape)} />
          {label}
        </span>
      ))}
    </span>
  )
}

/**
 * Range les blocs d'une journée en grappes qui se chevauchent, et chaque grappe en
 * couloirs : deux tirs à la même heure s'affichent côte à côte, signalés.
 */
function layout(blocks: Omit<Block, 'lane' | 'lanes' | 'overlaps'>[]): Block[] {
  const out: Block[] = []
  let cluster: Block[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((block) => block.lane + 1))
    // Un chevauchement entre deux tirs d'une même tâche n'en est pas un : elle ne
    // tourne jamais deux fois à la fois.
    const tasks = new Set(cluster.map((block) => block.task.id))
    for (const block of cluster) out.push({ ...block, lanes, overlaps: tasks.size > 1 })
    cluster = []
  }
  for (const block of blocks) {
    const visualEnd = Math.max(block.end, block.start + (MIN_BLOCK / HOUR_PX) * HOUR)
    if (block.start >= clusterEnd && cluster.length) flush()
    const used = new Set(cluster.filter((entry) => entry.end > block.start).map((entry) => entry.lane))
    let lane = 0
    while (used.has(lane)) lane += 1
    cluster.push({ ...block, lane, lanes: 1, overlaps: false })
    clusterEnd = Math.max(clusterEnd === -Infinity ? 0 : clusterEnd, visualEnd)
  }
  if (cluster.length) flush()
  return out
}

