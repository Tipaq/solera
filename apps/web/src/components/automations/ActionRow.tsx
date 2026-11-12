import { AlarmClock, ArrowUpRight, ShieldQuestion, Square, SquareTerminal, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, RunStrip, cx } from '@solera/ui'
import { stripOf } from '../../lib/action-panel'
import { cadenceText, inShort, liveText, natureOf, reviewReason, type Automation, type Section } from '../../lib/automations'
import { conversationPath } from '../../lib/conversation-route'
import { locale, useTranslate } from '../../lib/i18n'
import type { ServedVersion } from '../../lib/served'
import { useServerTimeZone } from '../../lib/schedules'
import { WebLink } from '../WebLink'
import { LaunchButton } from './ActionGestures'
import { KindChip, NatureIcon } from './ActionMarks'
import type { TileHandlers } from './ActionTile'
import { ServedLine } from './served/ServedLine'

/** Un lien vers ce qui tourne : « Ouvrir ↗ », « Session ↗ ». */
const LINK =
  'inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-accent transition-colors hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:h-11'

/** Les passages qu'une ligne montre en pastilles (LST-4). */
const ROW_RUNS = 10

/**
 * Une section de la Liste (LST-1) : titre, compte et aide, puis ses lignes. Vide, elle
 * se tait.
 */
export function ActionSection({
  title,
  hint,
  count,
  tone,
  children,
}: {
  title: string
  hint: string
  count: number
  tone?: 'caution'
  children: ReactNode
}) {
  if (count === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2">
        <h2 className={cx('text-sm font-semibold', tone === 'caution' ? 'text-caution' : 'text-ink')}>{title}</h2>
        <span className="text-xs tabular-nums text-ink-faint">{count}</span>
        <span className="hidden min-w-0 truncate text-xs text-ink-faint md:inline">— {hint}</span>
      </header>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">{children}</ul>
    </section>
  )
}

/**
 * La ligne d'une action dans la Liste (LST-2, LST-3) : sa nature, son libellé et sa puce,
 * dessous ce qu'elle fait (ce qui tourne, la raison de la relecture, sinon le prompt ou
 * la commande), ce qu'elle sert ; à droite, les gestes de sa section.
 */
export function ActionRow({
  item,
  section,
  served,
  handlers,
}: {
  item: Automation
  section: Section
  served: ServedVersion | null
  handlers: TileHandlers
}) {
  const t = useTranslate()
  const live = liveText(item, Date.now(), t)
  const detail = live ?? (item.review ? reviewReason(item.review, t) : item.what === 'agent' ? item.prompt : item.command)
  const mono = item.what === 'command' && !live && !item.review
  return (
    <li data-action-row={item.id} className="flex min-h-14 items-center gap-3 px-3.5 py-2.5 hover:bg-surface-high/40">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-high/70">
        <NatureIcon nature={natureOf(item)} />
      </span>
      <button
        type="button"
        onClick={() => handlers.onOpen(item)}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex max-w-full min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{item.label}</span>
          <span className="hidden min-w-0 sm:inline-flex">
            <KindChip item={item} />
          </span>
        </span>
        {detail ? <span className={cx('max-w-full truncate text-xs text-ink-faint', mono && 'font-mono')}>{detail}</span> : null}
        {served ? <ServedLine served={served} className="max-w-full" /> : null}
      </button>
      <span className="flex shrink-0 items-center gap-2">
        <RowGestures item={item} section={section} handlers={handlers} />
      </span>
    </li>
  )
}

function RowGestures({ item, section, handlers }: { item: Automation; section: Section; handlers: TileHandlers }) {
  const t = useTranslate()
  switch (section) {
    case 'live':
      return <LiveGestures item={item} handlers={handlers} />
    case 'review':
      return (
        <Button size="sm" variant="secondary" icon={<ShieldQuestion size={13} />} aria-label={t('launcher.review.named', { label: item.label })} onClick={() => handlers.onOpen(item, true)}>
          {t('launcher.review.button')}
        </Button>
      )
    case 'scheduled':
      return <ScheduleFacts item={item} />
    case 'demand':
      return (
        <span className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={<AlarmClock size={13} />} onClick={() => handlers.onEdit({ from: item, schedule: true })}>
            <span className="hidden sm:inline">{t('actionsTab.row.schedule')}</span>
            <span className="sr-only sm:hidden">{t('actionsTab.row.scheduleNamed', { label: item.label })}</span>
          </Button>
          <LaunchButton item={item} onLaunch={(worktreeId) => handlers.onLaunch(item, worktreeId)} />
        </span>
      )
  }
}

/** Ce qui tourne : « Ouvrir ↗ » et « Arrêter » d'un service, « Terminal » d'une commande, « Session ↗ » d'un agent. */
function LiveGestures({ item, handlers }: { item: Automation; handlers: TileHandlers }) {
  const t = useTranslate()
  const { live } = item
  if (live?.kind === 'service') {
    return (
      <span className="flex items-center gap-1">
        {live.href ? (
          <WebLink href={live.href} className={LINK}>
            {t('launcher.gesture.open')} <ArrowUpRight size={12} aria-hidden />
          </WebLink>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon={<Square size={12} />}
          aria-label={t('launcher.switch.stop', { label: item.label })}
          onClick={() => handlers.onToggle(item, false)}
        >
          {t('actionsTab.row.stop')}
        </Button>
      </span>
    )
  }
  if (live?.kind === 'terminal') {
    return (
      <Button size="sm" variant="ghost" icon={<SquareTerminal size={13} />} onClick={() => handlers.onTerminal(item, live.terminalId)}>
        {t('launcher.gesture.terminal')}
      </Button>
    )
  }
  if (live?.kind === 'run' && live.conversationId) {
    return (
      <Link to={conversationPath({ id: live.conversationId, projectId: item.projectId })} className={LINK}>
        {t('launcher.gesture.session')} <ArrowUpRight size={12} aria-hidden />
      </Link>
    )
  }
  return null
}

/**
 * Une action planifiée (LST-4) : ses échecs d'affilée, sa cadence, sa prochaine échéance,
 * et ses dix derniers passages, le plus récent à droite.
 */
function ScheduleFacts({ item }: { item: Automation }) {
  const t = useTranslate()
  const lang = locale()
  const timeZone = useServerTimeZone()
  const schedule = item.schedule!
  const next = !schedule.enabled
    ? t('actionsTab.row.paused')
    : schedule.nextRunAt !== null
      ? inShort(schedule.nextRunAt, Date.now(), t)
      : '—'
  const strip = stripOf(item.runs, t, lang, timeZone).slice(-ROW_RUNS)
  return (
    <>
      {item.failStreak >= 2 ? (
        <span className="hidden items-center gap-1 text-xs text-critical lg:inline-flex">
          <TriangleAlert size={12} aria-hidden /> {t('automation.state.failStreak', { count: item.failStreak })}
        </span>
      ) : null}
      <span className="hidden w-40 truncate text-right text-xs text-ink-soft lg:block">{cadenceText(item, t, lang)}</span>
      <span className="w-20 text-right text-xs tabular-nums text-ink-faint">{next}</span>
      <span className="hidden md:flex">
        <RunStrip runs={strip} slots={ROW_RUNS} label={t('actionsTab.row.runs', { count: strip.length })} />
      </span>
    </>
  )
}
