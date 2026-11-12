import { ChevronDown, ChevronRight, Flag } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { Badge, EmptyState, cx, useMediaQuery } from '@solera/ui'
import { cardDestinationHref } from '../../lib/card-destination'
import { awaitsMe, cardState, isLate, liveSessions, loadedStatus, type StatusOf } from '../../lib/card-state'
import { formatDay } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import {
  GANTT_HEAD,
  GANTT_ROW,
  GANTT_ROW_NARROW,
  LOOSE_GROUP,
  deliveredIds,
  ganttGroups,
  ganttRows,
  milestoneSpan,
  plottedCards,
  stateMix,
} from '../../lib/milestone-gantt'
import { milestoneBar, type MilestoneBarGeometry } from '../../lib/milestone-horizon'
import type { MilestoneEntry } from '../../lib/milestone-model'
import { CardInfoButton } from '../cards/CardInfoButton'
import { BAR_H, CardBar } from '../gantt/CardBar'
import { GanttArrows } from '../gantt/GanttArrows'
import { AXIS_H, GanttAxis } from '../gantt/GanttAxis'
import { GanttGrid, TodayLine } from '../gantt/GanttGrid'
import { useAxisWidth, useScrollToNow } from '../gantt/hooks'
import { anchorsOf, chainOf, scaleOf, type Scale, type Zoom } from '../gantt/scale'
import { STATE_DOT } from '../gantt/tones'
import { STATE_MIX } from './tones'

/** La colonne des libellés ; plus étroite au téléphone, pour laisser l'axe se lire. */
const LIST_WIDE = 296
const LIST_NARROW = 170
/** La gouttière de la page : la colonne part du même bord que la barre d'outils. */
const GUTTER = 16
const GUTTER_MD = 24
/** Le retrait d'une carte sous son jalon ; moindre au téléphone, où la colonne est étroite. */
const INDENT = 20
const INDENT_NARROW = 12
const GAUGE_H = 12
const NOTHING_FOLDED: ReadonlySet<string> = new Set()

/**
 * Le **Gantt détaillé** des Jalons (GNT) : la liste à gauche, jalons repliables et cartes
 * en retrait, l'axe à droite, un seul conteneur qui défile dans les deux sens.
 *
 * Chaque jalon est un groupe, avec son fond et un en-tête qui reste collé sous l'axe tant
 * qu'on lit ses cartes ; les livrés sont repliés au départ. Le survol d'une ligne — dans
 * la liste ou sur sa barre — la surligne sur toute la largeur, éclaire sa chaîne de
 * dépendances et ouvre son infobulle.
 *
 * `entries` sont tous les jalons : `keep` dit ceux que la barre garde (BAR-8). L'échelle
 * les englobe tous, pour qu'une recherche ne déplace pas l'axe à chaque frappe. `cards`
 * sont toutes celles du projet, pour le groupe « Hors jalon ».
 */
export function MilestoneGantt({
  projectId,
  entries,
  keep,
  cards,
  zoom,
  statusOf = loadedStatus,
  now = Date.now(),
}: {
  projectId: string
  entries: MilestoneEntry[]
  keep: (entry: MilestoneEntry) => boolean
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
  const groups = ganttGroups(entries.filter(keep), cards, foldedSet, now)
  const everything = ganttGroups(entries, cards, NOTHING_FOLDED, now)
  const plotted = plottedCards(everything)
  const axisWidth = useAxisWidth(scroller, listWidth)
  const scale = scaleOf(plotted, zoom, now, axisWidth)
  useScrollToNow(scroller, scale, listWidth, now)
  const chain = chainOf(plotted, hovered)
  const row = narrow ? GANTT_ROW_NARROW : GANTT_ROW
  const { centers, height } = ganttRows(groups, row)
  const anchors = anchorsOf(plotted, centers, scale, now)

  if (groups.length === 0) {
    // Des jalons que la barre cache tous ne font pas un projet vide.
    return <EmptyState icon={<Flag size={22} />} title={t(everything.length ? 'gantt.noMatch' : 'gantt.empty')} />
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
        {/* L'axe, collé en haut, au-dessus de tout ce qui défile dessous. */}
        <div className="sticky top-0 z-10 flex">
          <div
            className="sticky left-0 z-10 flex shrink-0 items-end justify-between border-r border-b border-line bg-canvas pr-3 pb-1.5 text-xs font-medium text-ink-faint"
            style={{ width: listWidth, height: AXIS_H, paddingLeft: gutter }}
          >
            <span>{t('gantt.headList')}</span>
            {narrow ? null : <span>{t('gantt.headDue')}</span>}
          </div>
          <GanttAxis scale={scale} zoom={zoom} now={now} inset={listWidth} />
        </div>

        {/*
          Deux colonnes sur la même grille : la liste, collée à gauche, et le tracé. Les couches
          s'empilent par l'ordre du document et par `isolate`, avec le seul `z-10` des couches
          locales du DS : le tracé (grille, barres, puis aujourd'hui et les flèches) sous la
          liste ; dans chacun, l'en-tête de groupe au-dessus des lignes qui passent dessous.
        */}
        <div className="relative isolate flex" onMouseLeave={() => setHovered(null)}>
          <div data-gantt-list className="sticky left-0 z-10 shrink-0 border-r border-line bg-canvas" style={{ width: listWidth }}>
            {groups.map((group) => {
              const entry = group.entry
              const open = entry ? !foldedSet.has(entry.card.id) : true
              const bar = entry ? milestoneBar(entry, now) : null
              // Lancé : un pilotage en marche ou en pause, ou sa PR finale ouverte (MAT-2).
              const launched = entry?.maturity === 'launched'
              return (
                <section
                  key={group.key}
                  data-gantt-group={entry ? entry.card.number : LOOSE_GROUP}
                  aria-label={entry ? `#${entry.card.number} ${entry.card.title}` : t('gantt.outside')}
                >
                  <div
                    data-gantt-head
                    className="sticky z-10 flex items-center gap-1.5 border-t border-b border-t-line border-b-line/60 bg-surface pr-2"
                    style={{ top: AXIS_H, height: GANTT_HEAD, paddingLeft: gutter - 2 }}
                  >
                    {entry && bar ? (
                      <>
                        <button
                          type="button"
                          onClick={() => toggle(entry.card.id)}
                          aria-expanded={open}
                          aria-label={open ? t('gantt.fold') : t('gantt.unfold')}
                          className="rounded p-0.5 text-ink-faint hover:text-ink"
                        >
                          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                        <Flag size={13} aria-hidden className={cx('shrink-0', launched ? 'text-accent' : 'text-ink-faint')} />
                        <Link to={milestoneHref(entry.card.number)} className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-accent">
                          {entry.card.title}
                        </Link>
                        {launched ? <Badge tone="accent">{t('gantt.launched')}</Badge> : null}
                        <span className="shrink-0 text-xs text-ink-faint tabular-nums">
                          {bar.done}/{bar.total}
                        </span>
                      </>
                    ) : (
                      <span className="pl-0.5 text-sm font-semibold text-ink-soft">{t('gantt.outside')}</span>
                    )}
                  </div>
                  {group.cards.map((card) => (
                    <CardLabel
                      key={card.id}
                      card={card}
                      href={hrefOf(card)}
                      narrow={narrow}
                      height={row}
                      indent={gutter + (entry ? (narrow ? INDENT_NARROW : INDENT) : 0)}
                      lit={hovered === card.id}
                      dim={chain !== null && !chain.has(card.id)}
                      onHover={setHovered}
                      statusOf={statusOf}
                      now={now}
                    />
                  ))}
                </section>
              )
            })}
          </div>

          <div className="relative isolate shrink-0" style={{ width: scale.width }}>
            <GanttGrid scale={scale} zoom={zoom} height={height} now={now} today={false} />
            {groups.map((group) => {
              const entry = group.entry
              return (
                <div key={group.key} data-gantt-plot={entry ? entry.card.number : LOOSE_GROUP} className={cx('relative', entry && 'bg-surface-high/20')}>
                  <div
                    data-gantt-head
                    className="sticky z-10 border-t border-b border-t-line border-b-line/60 bg-surface"
                    style={{ top: AXIS_H, height: GANTT_HEAD }}
                  >
                    {entry ? (
                      <MilestoneGauge
                        entry={entry}
                        bar={milestoneBar(entry, now)}
                        launched={entry.maturity === 'launched'}
                        members={group.members}
                        scale={scale}
                        now={now}
                        onOpen={() => navigate(milestoneHref(entry.card.number))}
                      />
                    ) : null}
                  </div>
                  {/* Ses lignes, à part : l'en-tête collé passe au-dessus quand elles défilent. */}
                  <div className="relative isolate">
                    {group.cards.map((card) => (
                      <div
                        key={card.id}
                        data-gantt-bar={card.number}
                        className={cx('relative transition-colors', hovered === card.id && 'bg-accent/[0.07]')}
                        style={{ height: row }}
                        onMouseOver={() => setHovered(card.id)}
                      >
                        <CardBar
                          card={card}
                          scale={scale}
                          top={(row - BAR_H) / 2}
                          onOpen={() => navigate(hrefOf(card))}
                          now={now}
                          hovered={hovered === card.id}
                          dimmed={chain !== null && !chain.has(card.id)}
                          onHover={setHovered}
                          statusOf={statusOf}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {/* Les surcouches, après les lignes : au-dessus des barres, sous les en-têtes collés. */}
            <div className="pointer-events-none absolute top-0 left-0" style={{ height }}>
              <TodayLine scale={scale} height={height} now={now} />
            </div>
            <div className="pointer-events-none absolute top-0 left-0">
              <GanttArrows anchors={anchors} width={scale.width} height={height} chain={chain} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Une carte dans la liste collée (GNT-9) : un lien vers sa destination. Pastille d'état,
 * `#N`, titre, `ℹ`, repère de session et échéance sur une ligne ; au téléphone, où la
 * colonne n'a que 170 px, le titre garde la première ligne pour lui (une quinzaine de
 * signes) et le reste passe dessous.
 */
function CardLabel({
  card,
  href,
  narrow,
  height,
  indent,
  lit,
  dim,
  onHover,
  statusOf,
  now,
}: {
  card: CardDto
  href: string
  narrow: boolean
  height: number
  indent: number
  lit: boolean
  dim: boolean
  onHover: (id: string) => void
  statusOf: StatusOf
  now: number
}) {
  const t = useTranslate()
  const late = isLate(card, now)
  const dot = <span aria-hidden className={cx('size-2 shrink-0 rounded-full', STATE_DOT[cardState(card)])} />
  const number = <span className="shrink-0 text-xs text-ink-faint tabular-nums">#{card.number}</span>
  const title = (
    <span data-row-title className="min-w-0 flex-1 truncate">
      {card.title}
    </span>
  )
  const marker = awaitsMe(card, statusOf) ? (
    <span title={t('gantt.tip.awaiting')} aria-label={t('gantt.tip.awaiting')} className="size-2 shrink-0 rounded-full bg-caution ring-2 ring-caution/25" />
  ) : liveSessions(card, statusOf).length > 0 ? (
    <span title={t('gantt.tip.running')} aria-label={t('gantt.tip.running')} className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
  ) : null
  const due = (
    <span
      data-row-due
      className={cx('shrink-0 text-xs tabular-nums', !narrow && 'w-12 text-right', late ? 'font-medium text-critical' : 'text-ink-faint')}
    >
      {card.dueAt === null ? '—' : formatDay(card.dueAt)}
    </span>
  )
  return (
    <Link
      data-gantt-row={card.number}
      to={href}
      onMouseOver={() => onHover(card.id)}
      className={cx(
        'flex pr-3 text-left text-sm transition-colors',
        narrow ? 'flex-col justify-center gap-0.5' : 'items-center gap-1.5',
        lit ? 'bg-surface-high' : 'bg-canvas',
        dim && 'text-ink-faint',
      )}
      style={{ height, paddingLeft: indent }}
    >
      {narrow ? (
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            {dot}
            {title}
          </span>
          {/* Sous le titre, aligné sur lui : la pastille fait 8 px, l'écart 6. */}
          <span className="flex items-center gap-1.5 pl-3.5">
            {number}
            {due}
            {marker}
            <CardInfoButton card={card} className="ml-auto" />
          </span>
        </>
      ) : (
        <>
          {dot}
          {number}
          {title}
          <CardInfoButton card={card} />
          {marker}
          {due}
        </>
      )}
    </Link>
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
  bar,
  launched,
  members,
  scale,
  now,
  onOpen,
}: {
  entry: MilestoneEntry
  bar: MilestoneBarGeometry
  launched: boolean
  members: CardDto[]
  scale: Scale
  now: number
  onOpen: () => void
}) {
  const t = useTranslate()
  const span = milestoneSpan(entry, now)
  const tip = t('gantt.gaugeTip', { title: entry.card.title, done: bar.done, total: bar.total })
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
        title={tip}
        aria-label={tip}
        className={cx(
          'absolute flex overflow-hidden rounded-full border bg-surface-high/60 hover:brightness-105',
          late ? 'border-critical/70' : 'border-line-strong',
          due === null && 'border-dashed',
          launched && 'shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-accent)_55%,transparent)]',
        )}
        style={{ left, width, top, height: GAUGE_H }}
      >
        {mix.map((part) => (
          <span key={part.state} data-state={part.state} className={STATE_MIX[part.state]} style={{ width: `${(part.count / members.length) * 100}%` }} />
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
