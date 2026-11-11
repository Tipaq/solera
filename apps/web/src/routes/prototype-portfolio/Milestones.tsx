/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les Jalons du portefeuille : l'horizon de tous les projets (une bande par projet) et
 * le Gantt commun (un axe, une bande par projet, une barre par jalon). La même barre
 * d'outils que les Jalons `vues` d'un projet. Un clic mène au jalon dans son projet.
 */
import { CalendarRange, Rows3 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { FilterChip, MenuCheck, MenuHeading, MenuSegment, useView, type ViewOption } from '../../components/prototype/ViewSwitch'
import { relativeDate } from '../../lib/dates'
import { milestonesOf } from '../../lib/timeline'
import { AXIS_H, GanttAxis, TodayLine, scaleOf, useAxisWidth, type Zoom } from '../prototype-milestones/gantt'
import { inProjects, usePortfolioV2, type PCard } from './data'
import { PortfolioToolbar, ProjectGroupHeader, useNotice } from './parts'

type View = 'horizon' | 'gantt'
const VIEWS: ViewOption<View>[] = [
  { key: 'horizon', label: 'Horizon', icon: <Rows3 size={14} /> },
  { key: 'gantt', label: 'Gantt', icon: <CalendarRange size={14} /> },
]

type Phase = 'idee' | 'encours' | 'avenir' | 'livre'
const PHASE_WORD: Record<Phase, string> = { idee: 'Idée', avenir: 'À venir', encours: 'En cours', livre: 'Livré' }
const PHASE_DOT: Record<Phase, string> = { idee: 'border border-ink-faint', avenir: 'bg-ink-faint', encours: 'bg-accent', livre: 'bg-positive' }

interface Row {
  card: PCard
  project: ProjectDto
  done: number
  total: number
  phase: Phase
  late: boolean
}

const LIST_W = 300
const ROW_H = 40

export function PortfolioMilestones() {
  const data = usePortfolioV2()
  const navigate = useNavigate()
  const [notice, simulate] = useNotice()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [onlyLate, setOnlyLate] = useState(false)
  const [showDelivered, setShowDelivered] = useState(false)
  const [view, setView] = useView<View>('portfolio-jalons', 'all', ['horizon', 'gantt'])
  const [zoom, setZoom] = useState<Zoom>('mois')

  const rows = useMemo<Row[]>(() => {
    const now = Date.now()
    return data.projects.flatMap((project) => {
      const cards = data.cards.filter((card) => card.project.id === project.id)
      return milestonesOf(cards).map((milestone) => {
        const total = milestone.cards.length
        const phase: Phase = total === 0 ? 'idee' : milestone.done >= total ? 'livre' : milestone.done > 0 || milestone.cards.some((card) => card.column === 'in_progress') ? 'encours' : 'avenir'
        return { card: milestone.card as PCard, project, done: milestone.done, total, phase, late: phase !== 'livre' && milestone.card.dueAt !== null && milestone.card.dueAt < now }
      })
    })
  }, [data.projects, data.cards])

  const query = search.trim().toLocaleLowerCase()
  const shown = rows.filter(
    (row) =>
      inProjects(selected, row.project.id) &&
      (showDelivered || row.phase !== 'livre') &&
      (!onlyLate || row.late) &&
      (!query || `${row.card.title} #${row.card.number} ${row.project.name}`.toLocaleLowerCase().includes(query)),
  )
  const projects = data.projects.filter((project) => shown.some((row) => row.project.id === project.id))

  const open = (row: Row) => {
    if (data.demo) return simulate(`ouvrirait le jalon #${row.card.number} dans ${row.project.name}`)
    navigate(`/p/${row.project.id}/timeline/${row.card.number}`)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PortfolioToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Chercher un jalon"
        projects={data.projects}
        selected={selected}
        onSelected={setSelected}
        filterExtra={
          <>
            <MenuHeading>Échéance</MenuHeading>
            <MenuCheck checked={onlyLate} onChange={setOnlyLate}>En retard</MenuCheck>
          </>
        }
        extraActive={onlyLate ? 1 : 0}
        onClearExtra={() => setOnlyLate(false)}
        extraChips={onlyLate ? <FilterChip onClear={() => setOnlyLate(false)}>En retard</FilterChip> : null}
        views={VIEWS}
        view={view}
        onView={setView}
        displayExtra={
          <>
            {view === 'gantt' ? (
              <>
                <MenuHeading>Échelle</MenuHeading>
                <div className="px-3">
                  <MenuSegment<Zoom> options={[{ key: 'semaine', label: 'Semaine' }, { key: 'mois', label: 'Mois' }]} value={zoom} onChange={setZoom} />
                </div>
              </>
            ) : null}
            <MenuHeading>Montrer</MenuHeading>
            <MenuCheck checked={showDelivered} onChange={setShowDelivered}>Jalons livrés</MenuCheck>
          </>
        }
        demo={data.demo}
        meta={`${rows.filter((row) => row.phase !== 'livre').length} jalons ouverts`}
      />
      {notice}
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <p className="p-4 text-sm text-ink-faint md:p-6">Aucun jalon ne correspond.</p>
        ) : view === 'horizon' ? (
          <div className="flex flex-col gap-6 p-4 md:p-6">
            {projects.map((project) => {
              const list = shown.filter((row) => row.project.id === project.id).sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase) || (a.card.dueAt ?? Infinity) - (b.card.dueAt ?? Infinity))
              return (
                <section key={project.id} className="flex flex-col gap-2">
                  <ProjectGroupHeader project={project} count={list.length} />
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {list.map((row) => (
                      <button
                        key={row.card.id}
                        type="button"
                        onClick={() => open(row)}
                        className={cx('flex flex-col gap-2 rounded-xl border bg-surface/40 p-3 text-left hover:border-line-strong', row.late ? 'border-critical/40' : 'border-line')}
                      >
                        <span className="flex items-center gap-2 text-xs text-ink-faint">
                          <span aria-hidden className={cx('size-2 rounded-full', PHASE_DOT[row.phase])} />
                          {PHASE_WORD[row.phase]}
                          <span className="ml-auto tabular-nums">#{row.card.number}</span>
                        </span>
                        <span className="line-clamp-2 text-sm text-ink">{row.card.title}</span>
                        <span className="h-1 overflow-hidden rounded-full bg-surface-high">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${row.total ? Math.round((row.done / row.total) * 100) : 0}%` }} />
                        </span>
                        <span className="flex items-center gap-2 text-xs tabular-nums text-ink-faint">
                          {row.done}/{row.total}
                          {row.card.dueAt ? <span className={cx('ml-auto', row.late && 'text-critical')}>{relativeDate(row.card.dueAt)}</span> : <span className="ml-auto">sans date</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <Gantt rows={shown} projects={projects} zoom={zoom} onOpen={open} />
        )}
      </div>
    </div>
  )
}

function phaseRank(phase: Phase): number {
  return { encours: 0, avenir: 1, idee: 2, livre: 3 }[phase]
}

function Gantt({ rows, projects, zoom, onOpen }: { rows: Row[]; projects: ProjectDto[]; zoom: Zoom; onOpen: (row: Row) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useAxisWidth(ref, LIST_W)
  const now = Date.now()
  const scale = scaleOf(rows.map((row) => row.card), zoom, now, width)
  const lines: ({ kind: 'project'; project: ProjectDto } | { kind: 'row'; row: Row })[] = projects.flatMap((project) => [
    { kind: 'project' as const, project },
    ...rows.filter((row) => row.project.id === project.id).map((row) => ({ kind: 'row' as const, row })),
  ])
  const height = lines.length * ROW_H

  return (
    <div ref={ref} className="overflow-x-auto">
      <div className="flex" style={{ width: LIST_W + scale.width }}>
        <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-canvas" style={{ width: LIST_W }}>
          <div style={{ height: AXIS_H }} className="border-b border-line" />
          {lines.map((line) =>
            line.kind === 'project' ? (
              <div key={line.project.id} style={{ height: ROW_H }} className="flex items-center bg-surface/40 px-4 md:px-6">
                <ProjectGroupHeader project={line.project} />
              </div>
            ) : (
              <button key={line.row.card.id} type="button" onClick={() => onOpen(line.row)} style={{ height: ROW_H }} className="flex w-full items-center gap-2 pr-4 pl-8 text-left text-sm hover:bg-surface-high/50 md:pl-10">
                <span aria-hidden className={cx('size-2 shrink-0 rounded-full', PHASE_DOT[line.row.phase])} />
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{line.row.card.number}</span>
                <span className="min-w-0 truncate">{line.row.card.title}</span>
              </button>
            ),
          )}
        </div>
        <div className="relative shrink-0" style={{ width: scale.width }}>
          <GanttAxis scale={scale} zoom={zoom} now={now} />
          <div className="relative" style={{ height }}>
            {lines.map((line, index) => {
              if (line.kind === 'project') return <div key={line.project.id} className="absolute inset-x-0 bg-surface/40" style={{ top: index * ROW_H, height: ROW_H }} />
              const { row } = line
              const start = scale.x(row.card.createdAt)
              const end = scale.x(row.card.dueAt ?? now)
              const share = row.total ? row.done / row.total : 0
              return (
                <button
                  key={row.card.id}
                  type="button"
                  onClick={() => onOpen(row)}
                  title={`#${row.card.number} ${row.card.title} · ${row.done}/${row.total}`}
                  className={cx(
                    'absolute flex h-5 items-center overflow-hidden rounded-[5px] border text-left',
                    row.card.dueAt === null ? 'border-dashed border-line-strong' : row.late ? 'border-critical/60' : 'border-accent/50',
                  )}
                  style={{ top: index * ROW_H + (ROW_H - 20) / 2, left: start, width: Math.max(end - start, 10) }}
                >
                  <span className={cx('h-full', row.phase === 'livre' ? 'bg-positive/40' : 'bg-accent/30')} style={{ width: `${Math.round(share * 100)}%` }} />
                  <span className="absolute left-2 truncate text-[11px] text-ink">{Math.round(share * 100)} %</span>
                </button>
              )
            })}
            <TodayLine scale={scale} height={height} now={now} />
          </div>
        </div>
      </div>
    </div>
  )
}
