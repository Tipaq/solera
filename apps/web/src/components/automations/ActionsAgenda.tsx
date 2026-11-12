import { ChevronLeft, ChevronRight, MoreHorizontal, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button, IconButton, SegmentedControl, TooltipButton, cx } from '@solera/ui'
import {
  FOLD_PX,
  MIN_BLOCK,
  clashCount,
  columnsOf,
  liveServices,
  periodOf,
  rowsOf,
  shiftAnchor,
  shotsOf,
  shownHours,
  yOf,
  type AgendaColumn,
  type AgendaScope,
  type Placed,
  type Rows,
} from '../../lib/agenda-layout'
import {
  RUN_VERDICTS,
  formatDateTime,
  launcherGroupOf,
  liveText,
  natureOf,
  natureWord,
  type Automation,
  type LauncherGroup,
  type VerdictTone,
} from '../../lib/automations'
import { useLocale, useTranslate, type MessageKey } from '../../lib/i18n'
import { pluralKey } from '../../lib/schedule-rule'
import { useServerTimeZone } from '../../lib/schedules'
import { NatureIcon } from './ActionMarks'

/**
 * L'Agenda des actions (`actions.md` §1.G) : les passages passés et à venir des actions
 * planifiées, sur une semaine ou un jour. Ce que la liste ne montre pas : ce qui tombe en
 * même temps, une nuit chargée, un trou.
 *
 * - la grille est toujours là, même vide ; les heures sans rien se **resserrent** en
 *   bandes `⋯` qui déplient tout ;
 * - un bloc a la couleur de sa **nature** (agent, commande, service), son **verdict** en
 *   liseré gauche quand il est passé ; un passage à venir est en pointillé ;
 * - deux actions qui se recouvrent se rangent côte à côte, cerclées d'ambre ;
 * - un clic sur un bloc ouvre l'action (`onOpen`) ;
 * - sous 44 rem **de conteneur** (téléphone, panneau d'une conversation), une liste par jour.
 *
 * Tout se lit à l'heure du serveur, celle où le daemon lit un motif cron
 * (`lib/agenda-layout.ts`).
 */
export function ActionsAgenda({
  items,
  onOpen,
  scope: controlled,
  onScope,
  defaultScope = 'week',
  timeZone: zone,
  now: fixedNow,
}: {
  items: readonly Automation[]
  onOpen: (item: Automation) => void
  /** La portée, quand le parent la garde (la vue choisie se retient) ; sinon `defaultScope`. */
  scope?: AgendaScope
  onScope?: (scope: AgendaScope) => void
  defaultScope?: AgendaScope
  /** Le fuseau du serveur ; lu de l'instance par défaut. Pour les stories et les tests. */
  timeZone?: string
  /** L'instant présent, figé ; sinon l'horloge, relue chaque minute. Pour les stories et les tests. */
  now?: number
}) {
  const t = useTranslate()
  const locale = useLocale()
  const serverZone = useServerTimeZone()
  const timeZone = zone ?? serverZone
  const clock = useClock(fixedNow)
  const now = fixedNow ?? clock

  const [ownScope, setOwnScope] = useState(defaultScope)
  const scope = controlled ?? ownScope
  const setScope = (next: AgendaScope) => {
    setOwnScope(next)
    onScope?.(next)
  }
  const [anchor, setAnchor] = useState(now)
  const [unfolded, setUnfolded] = useState(false)

  const days = useMemo(() => periodOf(anchor, scope, timeZone), [anchor, scope, timeZone])
  const from = days[0]!.start
  const to = days[days.length - 1]!.end
  const anySchedule = items.some((item) => item.schedule)
  const columns = useMemo(() => columnsOf(days, shotsOf(items, from, to, now, timeZone)), [days, items, from, to, now, timeZone])
  const rows = useMemo(() => rowsOf(shownHours(columns, now, unfolded, timeZone)), [columns, now, unfolded, timeZone])
  const clashes = clashCount(columns)
  const live = liveServices(items)

  const date = (ts: number, options: Intl.DateTimeFormatOptions) => new Date(ts).toLocaleDateString(locale, { ...options, timeZone })
  const title =
    scope === 'week'
      ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone }).formatRange(from, to - 1)
      : date(from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const isToday = (column: AgendaColumn) => now >= column.start && now < column.end
  const template = { gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(0, 1fr))` }

  return (
    /* La grille ou la liste suivent la largeur du conteneur, pas celle de l'écran : dans
       le panneau d'une conversation, l'agenda est étroit même sur un grand écran. */
    <div className="@container/agenda flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-base font-semibold text-ink first-letter:uppercase">{title}</h2>
        <span className="inline-flex items-center gap-0.5">
          <IconButton size="sm" label={t('agenda.previous')} onClick={() => setAnchor(shiftAnchor(anchor, scope, -1, timeZone))}>
            <ChevronLeft size={16} aria-hidden />
          </IconButton>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(now)}>
            {t('agenda.today')}
          </Button>
          <IconButton size="sm" label={t('agenda.next')} onClick={() => setAnchor(shiftAnchor(anchor, scope, 1, timeZone))}>
            <ChevronRight size={16} aria-hidden />
          </IconButton>
        </span>
        <SegmentedControl
          label={t('agenda.scope.label')}
          value={scope}
          onChange={setScope}
          segments={[
            { value: 'week', label: t('agenda.scope.week') },
            { value: 'day', label: t('agenda.scope.day') },
          ]}
        />
        {clashes > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-caution">
            <TriangleAlert size={12} aria-hidden />
            {t(`agenda.overlaps.${pluralKey(clashes, locale)}`, { count: clashes })}
          </span>
        ) : null}
        <Legend />
      </div>

      {anySchedule ? null : <p className="text-sm text-ink-faint">{t('agenda.empty')}</p>}

      {/* Au large : la grille, toujours, même vide. */}
      <div className="hidden overflow-hidden rounded-lg border border-line @min-[44rem]/agenda:block">
        <div className="grid border-b border-line" style={template}>
          <span />
          {columns.map((column) => {
            const today = isToday(column)
            return (
              <div key={column.start} className="flex min-w-0 flex-col gap-1 border-l border-line px-2 py-2">
                <span className="flex items-baseline gap-1.5">
                  <span className={cx('text-meta uppercase', today ? 'text-accent' : 'text-ink-faint')}>
                    {date(column.start, { weekday: 'short' })}
                  </span>
                  <span
                    className={cx(
                      'grid size-7 place-items-center rounded-full text-sm tabular-nums',
                      today ? 'bg-accent font-semibold text-accent-ink' : 'text-ink',
                    )}
                  >
                    {column.day.day}
                  </span>
                </span>
                {/* Ce qui tourne en continu, en bandeau du jour : un service n'a pas d'heure. */}
                {today && live.length ? (
                  <span className="flex flex-col gap-0.5">
                    {live.map((item) => (
                      <TooltipButton
                        key={item.id}
                        type="button"
                        aria-label={`${item.label} · ${liveText(item, now, t)}`}
                        onClick={() => onOpen(item)}
                        className="flex min-w-0 items-center gap-1 rounded bg-positive/10 px-1.5 py-0.5 text-left text-meta text-ink hover:bg-positive/20"
                      >
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-positive motion-safe:animate-pulse" />
                        <span className="truncate">{item.label}</span>
                      </TooltipButton>
                    ))}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="max-h-144 overflow-y-auto">
          <div className="relative grid" style={{ ...template, height: rows.height }}>
            <div className="relative">
              {rows.list.map((row) =>
                row.kind === 'hour' ? (
                  <span
                    key={`h${row.hour}`}
                    className="absolute right-2 -translate-y-1/2 text-meta tabular-nums text-ink-faint"
                    style={{ top: row.top }}
                  >
                    {row.hour === 0 ? '' : hourLabel(row.hour, locale)}
                  </span>
                ) : (
                  <TooltipButton
                    key={`f${row.from}`}
                    type="button"
                    aria-label={t('agenda.unfold', { from: row.from, to: row.to })}
                    onClick={() => setUnfolded(true)}
                    className="absolute inset-x-1 grid place-items-center rounded text-ink-faint hover:bg-surface-high hover:text-ink"
                    style={{ top: row.top + 2, height: FOLD_PX - 4 }}
                  >
                    <MoreHorizontal size={14} aria-hidden />
                  </TooltipButton>
                ),
              )}
            </div>
            {columns.map((column) => (
              <div key={column.start} className={cx('relative border-l border-line', isToday(column) && 'bg-accent/3')}>
                {rows.list.map((row) =>
                  row.kind === 'hour' ? (
                    <span key={`h${row.hour}`} className="absolute inset-x-0 border-t border-line/50" style={{ top: row.top }} />
                  ) : (
                    <span
                      key={`f${row.from}`}
                      className="absolute inset-x-0 border-y border-dashed border-line/60 bg-surface/40"
                      style={{ top: row.top, height: FOLD_PX }}
                    />
                  ),
                )}
                {isToday(column) ? (
                  <span
                    aria-hidden
                    data-agenda-now
                    className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-accent"
                    style={{ top: yOf(now, column, rows, timeZone) }}
                  >
                    <span className="absolute -top-1 -left-1 size-2 rounded-full bg-accent" />
                  </span>
                ) : null}
                {column.shots.map((shot) => (
                  <Block key={shot.key} shot={shot} column={column} rows={rows} timeZone={timeZone} onOpen={onOpen} />
                ))}
              </div>
            ))}
          </div>
        </div>
        {unfolded ? (
          <div className="border-t border-line p-1">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setUnfolded(false)}>
              {t('agenda.fold')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* À l'étroit : une liste par jour. */}
      <div className="flex flex-col gap-4 @min-[44rem]/agenda:hidden">
        {columns.map((column) => (
          <section key={column.start} className="flex flex-col gap-1">
            <h3 className={cx('text-sm font-medium first-letter:uppercase', isToday(column) ? 'text-accent' : 'text-ink')}>
              {date(column.start, { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
            {column.shots.length === 0 ? (
              <span className="text-xs text-ink-faint">{t('agenda.nothing')}</span>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {column.shots.map((shot) => (
                  <li key={shot.key}>
                    <button
                      type="button"
                      onClick={() => onOpen(shot.item)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-high/60 pointer-coarse:min-h-11"
                    >
                      <span className="w-11 shrink-0 text-xs tabular-nums text-ink-faint">{timeOf(shot.start, locale, timeZone)}</span>
                      <NatureIcon nature={natureOf(shot.item)} size={12} />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{shot.item.label}</span>
                      <span className={cx('text-xs', shot.status === 'failed' ? 'text-critical' : 'text-ink-faint')}>
                        {shot.status ? t(RUN_VERDICTS[shot.status].label) : t('agenda.planned')}
                      </span>
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

/** L'horloge, relue chaque minute : la ligne « maintenant » avance, les passages à venir passent. */
function useClock(fixed: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (fixed !== undefined) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [fixed])
  return now
}

const timeOf = (ts: number, locale: string, timeZone: string) =>
  new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone })

/** L'étiquette d'une ligne d'heure, au format des heures des blocs. */
const hourLabel = (hour: number, locale: string) => timeOf(Date.UTC(2026, 0, 1, hour), locale, 'UTC')

/** La couleur d'un bloc : sa nature, et le mot qui la dit dans la légende. */
const TINT: Record<LauncherGroup, { fill: string; legend: MessageKey }> = {
  agents: { fill: 'bg-accent/12 border-accent/35', legend: 'agenda.legend.agent' },
  commands: { fill: 'bg-surface-high border-line-strong', legend: 'agenda.legend.command' },
  services: { fill: 'bg-positive/10 border-positive/35', legend: 'agenda.legend.service' },
}

/** Le liseré gauche d'un passage fini : son verdict. */
const EDGE: Record<VerdictTone, string> = {
  neutral: 'before:bg-line-strong',
  accent: 'before:bg-accent',
  positive: 'before:bg-positive',
  caution: 'before:bg-caution',
  critical: 'before:bg-critical',
}

function Block({
  shot,
  column,
  rows,
  timeZone,
  onOpen,
}: {
  shot: Placed
  column: AgendaColumn
  rows: Rows
  timeZone: string
  onOpen: (item: Automation) => void
}) {
  const t = useTranslate()
  const locale = useLocale()
  const nature = natureOf(shot.item)
  const top = yOf(shot.start, column, rows, timeZone)
  const height = Math.max(yOf(shot.end, column, rows, timeZone) - top, MIN_BLOCK)
  const width = 100 / shot.lanes
  const verdict = shot.status ? RUN_VERDICTS[shot.status] : null
  const title = [
    shot.item.label,
    formatDateTime(shot.start, locale, timeZone),
    verdict ? t(verdict.label) : t('agenda.planned'),
    natureWord(nature, t),
    ...(shot.overlaps ? [t('agenda.overlapsTitle')] : []),
  ].join(' · ')
  return (
    <TooltipButton
      type="button"
      aria-label={title}
      onClick={() => onOpen(shot.item)}
      data-agenda-shot={shot.status ?? 'planned'}
      data-overlaps={shot.overlaps || undefined}
      className={cx(
        'absolute flex min-w-0 overflow-hidden rounded-md border text-left text-meta leading-tight text-ink transition-[filter] hover:brightness-110',
        "before:absolute before:inset-y-0 before:left-0 before:w-0.75 before:content-['']",
        TINT[launcherGroupOf(shot.item)].fill,
        verdict ? EDGE[verdict.tone] : 'border-dashed bg-canvas/70 before:bg-transparent',
        shot.status === 'running' && 'before:motion-safe:animate-pulse',
        shot.overlaps && 'ring-1 ring-caution/70',
        height >= 36 ? 'flex-col gap-0.5 py-1 pr-1.5 pl-2' : 'items-center gap-1 pr-1.5 pl-2',
      )}
      style={{ top, height, left: `calc(${shot.lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
    >
      <span className="flex min-w-0 items-center gap-1">
        <NatureIcon nature={nature} size={11} />
        <span className="min-w-0 truncate font-medium">{shot.item.label}</span>
      </span>
      <span className="shrink-0 tabular-nums text-ink-faint">{timeOf(shot.start, locale, timeZone)}</span>
    </TooltipButton>
  )
}

/** La légende, discrète : ce que disent les couleurs, le pointillé et le liseré. */
function Legend() {
  const t = useTranslate()
  const swatch = 'h-2.5 w-3.5 rounded-sm border'
  return (
    <span className="ml-auto flex flex-wrap items-center gap-3 text-meta text-ink-faint">
      {(['agents', 'commands', 'services'] as const).map((group) => (
        <span key={group} className="flex items-center gap-1"><span className={cx(swatch, TINT[group].fill)} />{t(TINT[group].legend)}</span>
      ))}
      <span className="flex items-center gap-1"><span className={cx(swatch, 'border-dashed border-line-strong')} />{t('agenda.legend.planned')}</span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-0.75 rounded-sm bg-positive" />
        <span className="h-2.5 w-0.75 rounded-sm bg-critical" />
        {t('agenda.legend.verdict')}
      </span>
    </span>
  )
}
