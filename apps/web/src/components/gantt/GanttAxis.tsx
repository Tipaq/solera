import { useMemo } from 'react'
import { cx } from '@solera/ui'
import { locale, useTranslate } from '../../lib/i18n'
import { daysOf, isoWeek, isWeekend, monthsOf, startOfDay, weekLabelStep, type Scale, type Zoom } from './scale'

export const AXIS_H = 48
const AXIS_TOP = 22
/** En deçà, la bande d'un mois ne porte que son nom, sans l'année. */
const MONTH_LONG_MIN = 110

/**
 * L'en-tête de l'axe, sur deux étages : les mois en haut (une bande par mois, son nom
 * collé à gauche pendant qu'on défile), puis les jours (zoom semaine) ou les semaines
 * (zoom mois). Aujourd'hui est une pastille posée sur l'axe, au pied du trait qui
 * descend dans la grille. Mois et jours s'écrivent dans la langue de l'interface.
 *
 * `inset` : la largeur de ce qui est collé à gauche du conteneur qui défile (la liste
 * des libellés). Le nom du mois se colle à son bord ; collé au bord du conteneur, il
 * passait dessous et disparaissait dès qu'on défilait.
 */
export function GanttAxis({ scale, zoom, now = Date.now(), inset = 0 }: { scale: Scale; zoom: Zoom; now?: number; inset?: number }) {
  const t = useTranslate()
  const lang = locale()
  const formats = useMemo(
    () => ({
      month: new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }),
      monthShort: new Intl.DateTimeFormat(lang, { month: 'long' }),
      weekday: new Intl.DateTimeFormat(lang, { weekday: 'narrow' }),
    }),
    [lang],
  )
  const days = daysOf(scale)
  const today = startOfDay(now)
  const weekStep = weekLabelStep(scale.ppd)

  return (
    <div className="relative border-b border-line bg-canvas select-none" style={{ width: scale.width, height: AXIS_H }}>
      {/* étage haut : les mois */}
      {monthsOf(days).map(({ at, end }) => {
        const width = scale.x(end) - scale.x(at)
        return (
          <div
            key={at}
            className="absolute top-0 border-b border-l border-line/70"
            style={{ left: scale.x(at), width, height: AXIS_TOP }}
          >
            <span
              className="sticky inline-block px-2 text-xs font-medium whitespace-nowrap text-ink-soft first-letter:uppercase"
              style={{ left: inset, lineHeight: `${AXIS_TOP}px` }}
            >
              {(width > MONTH_LONG_MIN ? formats.month : formats.monthShort).format(at)}
            </span>
          </div>
        )
      })}

      {/* étage bas : les jours, ou les semaines */}
      {zoom === 'week'
        ? days.map((at) => (
            <span
              key={at}
              className={cx(
                'absolute flex flex-col items-center justify-center text-meta leading-none tabular-nums',
                isWeekend(at) ? 'bg-surface-high/40 text-ink-faint/70' : 'text-ink-faint',
                at === today && 'font-semibold text-accent',
              )}
              style={{ left: scale.x(at), width: scale.ppd, top: AXIS_TOP, height: AXIS_H - AXIS_TOP }}
            >
              <span className="text-micro opacity-70">{formats.weekday.format(at)}</span>
              <span>{new Date(at).getDate()}</span>
            </span>
          ))
        : days
            .filter((at) => new Date(at).getDay() === 1)
            // Trop serrées, une sur n : chacune prend la place des semaines qu'elle saute.
            .filter((_, index) => index % weekStep === 0)
            .map((at) => (
              <span
                key={at}
                data-week-label
                className="absolute flex items-center gap-1 border-l border-line/50 pl-1 text-meta whitespace-nowrap text-ink-faint tabular-nums"
                style={{ left: scale.x(at), width: scale.ppd * 7 * weekStep, top: AXIS_TOP, height: AXIS_H - AXIS_TOP }}
              >
                <span className="opacity-60">{t('gantt.weekShort', { n: isoWeek(at) })}</span>
                <span>{new Date(at).getDate()}</span>
              </span>
            ))}

      <span
        className="absolute top-0.5 z-10 -translate-x-1/2 rounded-md bg-accent px-1.5 py-px text-meta font-semibold whitespace-nowrap text-accent-ink"
        style={{ left: scale.x(now) }}
      >
        {t('gantt.today')}
      </span>
    </div>
  )
}
