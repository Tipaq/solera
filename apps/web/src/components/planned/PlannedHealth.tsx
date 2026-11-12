import type { ReactNode } from 'react'
import { RunStrip, cx } from '@solera/ui'
import { formatCost, healthOf, inShort, natureOf, type UnifiedRun } from '../../lib/automations'
import { stripOf } from '../../lib/action-panel'
import { locale, useTranslate, type MessageKey } from '../../lib/i18n'
import {
  HEALTH_SECTIONS,
  groupByScope,
  healthMotive,
  healthSectionOf,
  healthSummary,
  scopeOptions,
  type HealthSection,
  type PlannedItem,
} from '../../lib/planned'
import { useServerTimeZone } from '../../lib/schedules'
import { NatureIcon } from '../automations/ActionMarks'
import { ScopePip } from './ScopeMarks'

/** Les dix derniers passages d'une ligne, alignés d'une ligne à l'autre. */
const ROW_RUNS = 10

const SECTION_TEXT: Record<HealthSection, { title: MessageKey; tone: string }> = {
  watch: { title: 'planned.health.watch', tone: 'text-critical' },
  healthy: { title: 'planned.health.healthy', tone: 'text-ink' },
  paused: { title: 'planned.health.paused', tone: 'text-ink-soft' },
}

/**
 * La **Liste** des Planifiées (PLF-7), l'ancienne vue Santé : quatre chiffres, puis les
 * tâches à regarder (échecs, relecture) d'abord, ou par portée, les plus en échec en tête.
 * Une ligne : nature, libellé et motif, portée, réussite, coût, dix derniers passages.
 */
export function PlannedHealth({
  items,
  group,
  costOf,
  onOpen,
}: {
  items: readonly PlannedItem[]
  group: 'due' | 'scope'
  costOf: (run: UnifiedRun) => number | null
  onOpen: (item: PlannedItem) => void
}) {
  const t = useTranslate()
  const lang = locale()
  const now = Date.now()
  const summary = healthSummary(items, costOf, now)

  const sections: { key: string; title: ReactNode; items: PlannedItem[] }[] =
    group === 'scope'
      ? groupByScope(items, scopeOptions(items, t)).map((entry) => ({
          key: entry.key,
          title: <ScopePip scope={entry.scope} />,
          items: [...entry.items].sort((a, b) => b.failStreak - a.failStreak),
        }))
      : HEALTH_SECTIONS.map((section) => ({
          key: section,
          title: <span className={cx('text-sm font-semibold', SECTION_TEXT[section].tone)}>{t(SECTION_TEXT[section].title)}</span>,
          items: items.filter((item) => healthSectionOf(item) === section),
        }))

  return (
    <div className="flex flex-col gap-7" data-planned-health>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        <Figure label={t('planned.health.rate')} value={summary.rate === null ? '—' : `${Math.round(summary.rate * 100)} %`} />
        <Figure label={t('planned.health.failing')} value={String(summary.failing)} critical={summary.failing > 0} />
        <Figure label={t('planned.health.cost')} value={formatCost(summary.cost, t, lang)} />
        <Figure label={t('planned.health.next')} value={summary.next === null ? '—' : inShort(summary.next, now, t)} />
      </dl>
      {sections.map((section) =>
        section.items.length === 0 ? null : (
          <section key={section.key} className="flex flex-col gap-1" data-health-section={section.key}>
            <header className="flex items-center gap-2 pb-1">
              {section.title}
              <span className="text-xs tabular-nums text-ink-faint">{section.items.length}</span>
            </header>
            <ul className="flex flex-col divide-y divide-line">
              {section.items.map((item) => (
                <HealthRow key={item.id} item={item} costOf={costOf} now={now} scoped={group === 'scope'} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  )
}

function HealthRow({
  item,
  costOf,
  now,
  scoped,
  onOpen,
}: {
  item: PlannedItem
  costOf: (run: UnifiedRun) => number | null
  now: number
  /** Rangée par portée : la colonne portée redirait le titre de sa section. */
  scoped: boolean
  onOpen: (item: PlannedItem) => void
}) {
  const t = useTranslate()
  const lang = locale()
  const timeZone = useServerTimeZone()
  const health = healthOf(item, costOf, now)
  const motive = healthMotive(item, now, t)
  const strip = stripOf(item.runs, t, lang, timeZone).slice(-ROW_RUNS)
  return (
    <li data-health-row={item.id}>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2.5 text-left transition-colors hover:bg-surface-high/40 focus-visible:outline-2 focus-visible:outline-accent md:grid-cols-[minmax(0,1.4fr)_11rem_4rem_5rem_auto]"
      >
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <NatureIcon nature={natureOf(item)} />
            <span className="truncate text-sm font-medium text-ink">{item.label}</span>
          </span>
          {motive ? <span className={cx('truncate pl-[23px] text-xs', item.review ? 'text-caution' : 'text-ink-soft')}>{motive}</span> : null}
        </span>
        <span className="hidden min-w-0 md:block">{scoped ? null : <ScopePip scope={item.scope} plain />}</span>
        <span className="hidden text-right text-xs tabular-nums text-ink-soft md:block">
          {health.rate === null ? '—' : `${Math.round(health.rate * 100)} %`}
        </span>
        <span className="hidden text-right text-xs tabular-nums text-ink-faint md:block">{formatCost(health.cost30, t, lang)}</span>
        <RunStrip runs={strip} slots={ROW_RUNS} label={t('planned.health.runs', { count: strip.length })} />
      </button>
    </li>
  )
}

function Figure({ label, value, critical = false }: { label: string; value: string; critical?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className={cx('text-xl font-semibold tabular-nums', critical ? 'text-critical' : 'text-ink')}>{value}</dd>
    </div>
  )
}
