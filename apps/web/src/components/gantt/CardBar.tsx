import { useRef } from 'react'
import type { CardDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { awaitsMe, cardState, isLate, lateDays, liveSessions, loadedStatus, type StatusOf } from '../../lib/card-state'
import { formatDay } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { FloatingTip } from './FloatingTip'
import { BAR_PAD, LABEL_GAP, barOf, labelPlacement, type Scale } from './scale'
import { STATE_BAR, STATE_DOT } from './tones'

export const BAR_H = 20
/** Une barre plus courte ne se verrait plus. */
const BAR_MIN_W = 8
/** La place que prend le repère d'une session devant le titre : le point (8 px si elle
    attend, 6 px si elle tourne) et l'écart de 4 px qui le suit. */
const ASKING_DOT_W = 12
const LIVE_DOT_W = 10
/** L'écart entre le numéro et le titre, dans la barre (`gap-1`). */
const NUMBER_GAP = 4
/** Le prolongement du retard ne disparaît pas même quand il ne fait que quelques heures. */
const OVERDUE_MIN_W = 2
const LATE_HATCH =
  'repeating-linear-gradient(135deg, color-mix(in oklab, var(--color-critical) 55%, transparent) 0 3px, transparent 3px 6px)'

let measureContext: CanvasRenderingContext2D | null = null

/** Largeur d'un libellé en `text-xs`, pour décider s'il tient dans sa barre. */
function textWidth(text: string): number {
  if (!measureContext) {
    measureContext = document.createElement('canvas').getContext('2d')
    if (measureContext) measureContext.font = `12px ${getComputedStyle(document.body).fontFamily}`
  }
  return measureContext ? measureContext.measureText(text).width : text.length * 6.5
}

/**
 * Une barre de carte : de sa création à son échéance, à la teinte de son état ; sans
 * échéance, jusqu'à aujourd'hui, en pointillé et estompée vers la droite.
 *
 * Le titre se loge dans la barre quand il y tient en entier, sinon il passe à côté,
 * entier lui aussi (`labelPlacement`). Le retard ne peint pas la barre : un cran rouge
 * sur l'échéance et un prolongement hachuré jusqu'à aujourd'hui suffisent à le voir
 * sans que tout vire au rouge. Une session qui attend cerne la barre d'ambre, une
 * session qui tourne y met un point qui pulse. Au survol, l'infobulle de la carte.
 */
export function CardBar({
  card,
  scale,
  top,
  height = BAR_H,
  onOpen,
  labelInside = true,
  now = Date.now(),
  hovered = false,
  dimmed = false,
  onHover,
  statusOf = loadedStatus,
}: {
  card: CardDto
  scale: Scale
  top: number
  height?: number
  onOpen: () => void
  /** Faux : pas de titre du tout (la liste à gauche le porte déjà). */
  labelInside?: boolean
  now?: number
  hovered?: boolean
  /** Hors de la chaîne survolée : la barre s'efface à 30 %. */
  dimmed?: boolean
  onHover?: (id: string | null) => void
  /** Le statut vivant des sessions (`useLiveCardStatuses`) ; celui du chargement sinon. */
  statusOf?: StatusOf
}) {
  const t = useTranslate()
  const anchor = useRef<HTMLDivElement>(null)
  const state = cardState(card)
  const { start, end, loose } = barOf(card, now)
  const left = scale.x(start)
  const width = Math.max(scale.x(end) - left, BAR_MIN_W)
  const late = isLate(card, now)
  const overdue = late && card.dueAt !== null ? Math.max(scale.x(now) - scale.x(card.dueAt), OVERDUE_MIN_W) : 0
  const live = liveSessions(card, statusOf)
  const asking = awaitsMe(card, statusOf)
  const label = `#${card.number} ${card.title}`
  // Mesuré comme il s'affiche dans la barre : le numéro et le titre séparés par `gap-1`.
  const labelWidth = textWidth(`#${card.number}`) + NUMBER_GAP + textWidth(card.title)
  const marker = asking ? ASKING_DOT_W : live.length > 0 ? LIVE_DOT_W : 0
  const placement = labelInside
    ? labelPlacement({ left, width, overdue, labelWidth, marker, axisWidth: scale.width })
    : null

  return (
    <div
      ref={anchor}
      // Survolée, au-dessus des barres voisines et de leurs titres, mais sous la liste
      // collée à gauche (z-10) : à z-30, elle passait par-dessus en défilant.
      className={cx('absolute transition-opacity duration-150', dimmed && 'opacity-30', hovered && 'z-[3]')}
      style={{ left, top, height, width }}
      onMouseEnter={() => onHover?.(card.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {overdue > 0 ? (
        <span
          aria-hidden
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-r-full"
          style={{ left: width, width: overdue, background: LATE_HATCH }}
        />
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        // Au clavier aussi : le focus montre l'infobulle et éclaire la chaîne, comme le survol.
        onFocus={() => onHover?.(card.id)}
        onBlur={() => onHover?.(null)}
        aria-label={t('gantt.barLabel', { card: label, state: t(`card.state.${state}`) })}
        className={cx(
          'absolute inset-0 flex items-center gap-1 overflow-hidden rounded-sm text-left text-xs whitespace-nowrap',
          'transition-[filter,box-shadow] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-accent',
          STATE_BAR[state],
          loose && 'border-dashed opacity-75 [mask-image:linear-gradient(to_right,black_70%,transparent)]',
          hovered && 'shadow-[0_0_0_2px_var(--color-accent)]',
          asking && 'ring-2 ring-caution',
        )}
        style={{ paddingInline: BAR_PAD }}
      >
        {asking ? (
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-caution ring-2 ring-canvas" />
        ) : live.length > 0 ? (
          <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        ) : null}
        {placement === 'inside' ? (
          <>
            <span className="shrink-0 tabular-nums opacity-60">#{card.number}</span>
            <span>{card.title}</span>
          </>
        ) : null}
      </button>
      {/* Le cran de l'échéance dépassée, sur le bord droit de la barre. */}
      {late ? <span aria-hidden className="absolute -top-0.5 -bottom-0.5 right-0 w-0.5 rounded-full bg-critical" /> : null}
      {placement === 'right' || placement === 'left' ? (
        <span
          className={cx('pointer-events-none absolute top-0 text-xs whitespace-nowrap', hovered ? 'text-ink' : 'text-ink-soft')}
          style={
            placement === 'left'
              ? { right: width + LABEL_GAP, lineHeight: `${height}px` }
              : { left: width + overdue + LABEL_GAP, lineHeight: `${height}px` }
          }
        >
          <span className="text-ink-faint tabular-nums">#{card.number}</span> {card.title}
        </span>
      ) : null}
      {hovered ? (
        <FloatingTip anchor={anchor}>
          <CardTip card={card} now={now} statusOf={statusOf} />
        </FloatingTip>
      ) : null}
    </div>
  )
}

/** L'infobulle d'une carte : titre, état, création, échéance, sessions vivantes. */
function CardTip({ card, now, statusOf }: { card: CardDto; now: number; statusOf: StatusOf }) {
  const t = useTranslate()
  const state = cardState(card)
  const lateBy = lateDays(card, now)
  const late = lateBy > 0
  const live = liveSessions(card, statusOf)
  return (
    <div className="surface w-64 rounded-lg border border-line p-2.5 text-xs shadow-pop">
      <p className="flex items-start gap-1.5 text-sm leading-snug font-medium text-ink">
        <span className="shrink-0 font-normal text-ink-faint tabular-nums">#{card.number}</span>
        <span className="min-w-0">{card.title}</span>
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-soft">
        <dt className="text-ink-faint">{t('gantt.tip.state')}</dt>
        <dd className="flex items-center gap-1.5">
          <span className={cx('size-2 rounded-full', STATE_DOT[state])} />
          {t(`card.state.${state}`)}
        </dd>
        <dt className="text-ink-faint">{t('gantt.tip.created')}</dt>
        <dd className="tabular-nums">{formatDay(card.createdAt)}</dd>
        <dt className="text-ink-faint">{t('gantt.tip.due')}</dt>
        <dd className={cx('tabular-nums', late && 'font-medium text-critical')}>
          {card.dueAt === null
            ? t('gantt.tip.noDue')
            : late
              ? t('gantt.tip.dueLate', { due: formatDay(card.dueAt), days: lateBy })
              : formatDay(card.dueAt)}
        </dd>
        {live.length > 0 ? (
          <>
            <dt className="text-ink-faint">{t('gantt.tip.sessions')}</dt>
            <dd className="flex flex-col gap-0.5">
              {live.map((session) => (
                <span key={session.id} className="flex min-w-0 items-center gap-1.5">
                  <AgentIcon agent={session.agent} size={12} />
                  {statusOf(session) === 'awaiting_input' ? (
                    <span className="text-caution">{t('gantt.tip.awaiting')}</span>
                  ) : (
                    <span className="text-accent">{t('gantt.tip.running')}</span>
                  )}
                </span>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
      <p className="mt-2 text-meta text-ink-faint">{t('gantt.tip.openHint')}</p>
    </div>
  )
}
