import { ChevronDown, ChevronRight, Flag } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { Badge, EmptyState, cx, useMediaQuery } from '@solera/ui'
import { cardDestinationHref } from '../../lib/card-destination'
import { awaitsMe, cardState, isLate, liveSessions, loadedStatus, type CardState, type StatusOf } from '../../lib/card-state'
import { formatDay } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import {
  GANTT_HEAD,
  GANTT_ROW,
  deliveredIds,
  ganttGroups,
  ganttRows,
  milestoneSpan,
  plottedCards,
  stateMix,
} from '../../lib/milestone-gantt'
import { milestoneBar } from '../../lib/milestone-horizon'
import type { MilestoneEntry } from '../../lib/milestone-model'
import { CardInfoButton } from '../cards/CardInfoButton'
import { BAR_H, CardBar } from '../gantt/CardBar'
import { GanttArrows } from '../gantt/GanttArrows'
import { AXIS_H, GanttAxis } from '../gantt/GanttAxis'
import { GanttGrid, TodayLine } from '../gantt/GanttGrid'
import { useAxisWidth, useScrollToNow } from '../gantt/hooks'
import { anchorsOf, chainOf, scaleOf, type Scale, type Zoom } from '../gantt/scale'
import { STATE_DOT } from '../gantt/tones'

/** La colonne des libellés ; plus étroite au téléphone, pour laisser l'axe se lire. */
const LIST_WIDE = 296
const LIST_NARROW = 170
/** La gouttière de la page : la colonne part du même bord que la barre d'outils. */
const GUTTER = 16
const GUTTER_MD = 24
/** Le retrait d'une carte sous son jalon. */
const INDENT = 20
const GAUGE_H = 12

/** Le remplissage de la jauge d'un jalon, par état de ses cartes. */
const MIX_FILL: Record<CardState, string> = {
  done: 'bg-positive/70',
  review: 'bg-positive/35',
  running: 'bg-accent/60',
  blocked: 'bg-caution/60',
  todo: 'bg-ink-faint/25',
  abandoned: 'bg-transparent',
}

/**
 * Le **Gantt détaillé** des Jalons (GNT) : la liste à gauche, jalons repliables et cartes
 * en retrait, l'axe à droite, un seul conteneur qui défile dans les deux sens.
 *
 * Chaque jalon est un groupe, avec son fond et un en-tête qui reste collé sous l'axe tant
 * qu'on lit ses cartes ; les livrés sont repliés au départ. Le survol d'une ligne — dans
 * la liste ou sur sa barre — la surligne sur toute la largeur, éclaire sa chaîne de
 * dépendances et ouvre son infobulle.
 *
 * `entries` arrivent filtrés par la barre (BAR-8) ; `cards` sont toutes celles du projet,
 * pour le groupe « Hors jalon ».
 */
export function MilestoneGantt({
  projectId,
  entries,
  cards,
  zoom,
  statusOf = loadedStatus,
  now = Date.now(),
}: {
  projectId: string
  entries: MilestoneEntry[]
  cards: CardDto[]
  zoom: Zoom
  statusOf?: StatusOf
  now?: number
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const scroller = useRef<HTMLDivElement>(null)
  const narrow = !useMediaQuery('(min-width: 40rem)')
  const wide = useMediaQuery('(min-width: 48rem)')
  const listWidth = narrow ? LIST_NARROW : LIST_WIDE
  const gutter = wide ? GUTTER_MD : GUTTER
  // Repliés au départ : les livrés. Dès le premier geste, le choix est celui de l'utilisateur.
  const [folded, setFolded] = useState<ReadonlySet<string> | null>(null)
  const foldedSet = folded ?? deliveredIds(entries)
  const [hovered, setHovered] = useState<string | null>(null)

  // Peu de cartes : recalculé à chaque rendu, sans mémo que `now` invaliderait de toute façon.
  const groups = ganttGroups(entries, cards, foldedSet, now)
  const plotted = plottedCards(groups)
  const axisWidth = useAxisWidth(scroller, listWidth)
  const scale = scaleOf(plotted, zoom, now, axisWidth)
  useScrollToNow(scroller, scale, listWidth, now)
  const chain = chainOf(plotted, hovered)
  const { centers, height } = ganttRows(groups)
  const anchors = anchorsOf(plotted, centers, scale, now)

  if (groups.length === 0) {
    return <EmptyState icon={<Flag size={22} />} title={t('gantt.empty')} />
  }

  const toggle = (id: string) => {
    const next = new Set(foldedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setFolded(next)
  }
  const hrefOf = (card: CardDto) => cardDestinationHref(projectId, card, { statusOf, search })
  const milestoneHref = (number: number) => `/p/${projectId}/timeline/${number}`

  return (
    <div ref={scroller} data-gantt className="h-full min-h-0 overflow-auto overscroll-contain">
      <div className="relative" style={{ width: listWidth + scale.width, minHeight: '100%' }}>
        {/* l'axe, collé en haut */}
        <div className="sticky top-0 z-20 flex">
          <div
            className="sticky left-0 z-30 flex shrink-0 items-end justify-between border-r border-b border-line bg-canvas pr-3 pb-1.5 text-xs font-medium text-ink-faint"
            style={{ width: listWidth, height: AXIS_H, paddingLeft: gutter }}
          >
            <span>{t('gantt.headList')}</span>
            <span>{t('gantt.headDue')}</span>
          </div>
          <GanttAxis scale={scale} zoom={zoom} now={now} inset={listWidth} />
        </div>

        <div className="relative" onMouseLeave={() => setHovered(null)}>
          <div className="absolute top-0" style={{ left: listWidth }}>
            <GanttGrid scale={scale} zoom={zoom} height={height} now={now} today={false} />
          </div>

          {groups.map((group) => {
            const entry = group.entry
            const open = entry ? !foldedSet.has(entry.card.id) : true
            const bar = entry ? milestoneBar(entry, now) : null
            return (
              <section
                key={group.key}
                data-gantt-group={entry ? entry.card.number : 'loose'}
                aria-label={entry ? `#${entry.card.number} ${entry.card.title}` : t('gantt.outside')}
                className={cx('relative', entry && 'bg-surface-high/20')}
              >
                {/* l'en-tête du groupe, collé sous l'axe tant qu'on lit ses cartes */}
                <div
                  className="sticky z-[12] flex border-t border-b border-t-line border-b-line/60 bg-surface"
                  style={{ top: AXIS_H, height: GANTT_HEAD }}
                >
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface pr-2"
                    style={{ width: listWidth, paddingLeft: gutter - 2 }}
                  >
                    {entry && bar ? (
                      <>
                        <button
                          type="button"
                          onClick={() => toggle(entry.card.id)}
                          aria-expanded={open}
                          aria-label={open ? t('gantt.fold') : t('gantt.unfold')}
                          className="rounded p-0.5 text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                        <Flag size={13} aria-hidden className={cx('shrink-0', entry.run ? 'text-accent' : 'text-ink-faint')} />
                        <Link to={milestoneHref(entry.card.number)} className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-accent">
                          {entry.card.title}
                        </Link>
                        {entry.run ? <Badge tone="accent">{t('gantt.launched')}</Badge> : null}
                        <span className="shrink-0 text-xs text-ink-faint tabular-nums">
                          {bar.done}/{bar.total}
                        </span>
                      </>
                    ) : (
                      <span className="pl-0.5 text-sm font-semibold text-ink-soft">{t('gantt.outside')}</span>
                    )}
                  </div>
                  <div className="relative flex-1">
                    {entry ? (
                      <MilestoneGauge
                        entry={entry}
                        members={group.members}
                        scale={scale}
                        now={now}
                        onOpen={() => navigate(milestoneHref(entry.card.number))}
                      />
                    ) : null}
                  </div>
                </div>

                {group.cards.map((card) => {
                  const late = isLate(card, now)
                  const lit = hovered === card.id
                  const dim = chain !== null && !chain.has(card.id)
                  return (
                    <div
                      key={card.id}
                      data-gantt-row={card.number}
                      className={cx('flex transition-colors', lit && 'bg-accent/[0.07]')}
                      style={{ height: GANTT_ROW }}
                      onMouseOver={() => setHovered(card.id)}
                    >
                      <Link
                        to={hrefOf(card)}
                        className={cx(
                          'sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line pr-3 text-left text-sm transition-colors',
                          lit ? 'bg-surface-high' : 'bg-canvas',
                          dim && 'text-ink-faint',
                        )}
                        style={{ width: listWidth, paddingLeft: gutter + (entry ? INDENT : 0) }}
                      >
                        <span aria-hidden className={cx('size-2 shrink-0 rounded-full', STATE_DOT[cardState(card)])} />
                        <span className="shrink-0 text-xs text-ink-faint tabular-nums">#{card.number}</span>
                        <span className="min-w-0 flex-1 truncate">{card.title}</span>
                        <CardInfoButton card={card} />
                        {awaitsMe(card, statusOf) ? (
                          <span
                            title={t('gantt.tip.awaiting')}
                            aria-label={t('gantt.tip.awaiting')}
                            className="size-2 shrink-0 rounded-full bg-caution ring-2 ring-caution/25"
                          />
                        ) : liveSessions(card, statusOf).length > 0 ? (
                          <span
                            title={t('gantt.tip.running')}
                            aria-label={t('gantt.tip.running')}
                            className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                          />
                        ) : null}
                        <span data-row-due className={cx('w-12 shrink-0 text-right text-xs tabular-nums', late ? 'font-medium text-critical' : 'text-ink-faint')}>
                          {card.dueAt === null ? '—' : formatDay(card.dueAt)}
                        </span>
                      </Link>
                      <div className="relative flex-1">
                        <CardBar
                          card={card}
                          scale={scale}
                          top={(GANTT_ROW - BAR_H) / 2}
                          onOpen={() => navigate(hrefOf(card))}
                          now={now}
                          hovered={lit}
                          dimmed={dim}
                          onHover={setHovered}
                          statusOf={statusOf}
                        />
                      </div>
                    </div>
                  )
                })}
              </section>
            )
          })}

          {/* surcouches : aujourd'hui, puis les flèches — sous la liste collée (z-10) */}
          <div className="pointer-events-none absolute top-0 z-[4]" style={{ left: listWidth, height }}>
            <TodayLine scale={scale} height={height} now={now} />
          </div>
          <div className="pointer-events-none absolute top-0 z-[5]" style={{ left: listWidth }}>
            <GanttArrows anchors={anchors} width={scale.width} height={height} chain={chain} />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * La barre d'un jalon dans son en-tête (GNT-8) : son étendue, remplie de gauche à droite
 * par l'état de ses cartes (faites d'abord, puis à relire, en cours…), un losange sur
 * l'échéance et le pourcentage livré juste après. Bord rouge en retard, pointillé sans
 * échéance, halo d'accent une fois lancé.
 */
function MilestoneGauge({
  entry,
  members,
  scale,
  now,
  onOpen,
}: {
  entry: MilestoneEntry
  members: CardDto[]
  scale: Scale
  now: number
  onOpen: () => void
}) {
  const t = useTranslate()
  const span = milestoneSpan(entry, now)
  const bar = milestoneBar(entry, now)
  const mix = stateMix(members)
  const late = bar.lateDays > 0
  const due = entry.card.dueAt
  const left = scale.x(span.start)
  const width = Math.max(scale.x(span.end) - left, 12)
  const top = (GANTT_HEAD - GAUGE_H) / 2
  const diamond = GAUGE_H + 2

  return (
    <>
      <button
        type="button"
        data-milestone-gauge={entry.card.number}
        onClick={onOpen}
        title={t('gantt.gaugeTip', { title: entry.card.title, done: bar.done, total: bar.total })}
        aria-label={t('gantt.gaugeTip', { title: entry.card.title, done: bar.done, total: bar.total })}
        className={cx(
          'absolute flex overflow-hidden rounded-full border bg-surface-high/60 hover:brightness-105 focus-visible:outline-2 focus-visible:outline-accent',
          late ? 'border-critical/70' : 'border-line-strong',
          due === null && 'border-dashed',
          entry.run && 'shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-accent)_55%,transparent)]',
        )}
        style={{ left, width, top, height: GAUGE_H }}
      >
        {mix.map((part) => (
          <span key={part.state} data-state={part.state} className={MIX_FILL[part.state]} style={{ width: `${(part.count / members.length) * 100}%` }} />
        ))}
      </button>
      {due !== null ? (
        <span
          aria-hidden
          data-due
          title={t('gantt.dueTip', { date: formatDay(due) })}
          className={cx('absolute rotate-45 rounded-[2px] border-2 bg-canvas', late ? 'border-critical' : 'border-ink-soft')}
          style={{ left: scale.x(due) - diamond / 2, top: top + GAUGE_H / 2 - diamond / 2, width: diamond, height: diamond }}
        />
      ) : null}
      <span
        className="pointer-events-none absolute text-xs font-medium whitespace-nowrap text-ink-faint tabular-nums"
        style={{ left: left + width + (due !== null ? diamond / 2 + 6 : 6), top, lineHeight: `${GAUGE_H}px` }}
      >
        {bar.total === 0 ? '—' : t('gantt.percent', { value: Math.round(bar.share * 100) })}
      </span>
    </>
  )
}
