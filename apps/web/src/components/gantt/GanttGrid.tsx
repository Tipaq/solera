import { daysOf, isWeekend, type Scale, type Zoom } from './scale'

/**
 * Le fond des lignes : week-ends teintés en zoom semaine, lundis tracés fins, débuts de
 * mois plus marqués. Le trait d'aujourd'hui peut en sortir (`today={false}` et
 * `TodayLine`) pour passer au-dessus des barres.
 */
export function GanttGrid({
  scale,
  zoom,
  height,
  now = Date.now(),
  today = true,
}: {
  scale: Scale
  zoom: Zoom
  height: number
  now?: number
  today?: boolean
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute top-0 left-0" style={{ width: scale.width, height }}>
      {daysOf(scale).map((at) => {
        const date = new Date(at)
        if (zoom === 'week' && isWeekend(at)) {
          return <span key={at} className="absolute top-0 bottom-0 bg-surface-high/35" style={{ left: scale.x(at), width: scale.ppd }} />
        }
        if (date.getDate() === 1) return <span key={at} className="absolute top-0 bottom-0 w-px bg-line" style={{ left: scale.x(at) }} />
        if (date.getDay() === 1) return <span key={at} className="absolute top-0 bottom-0 w-px bg-line/45" style={{ left: scale.x(at) }} />
        return null
      })}
      {today ? <span className="absolute top-0 bottom-0 w-px bg-accent" style={{ left: scale.x(now) }} /> : null}
    </div>
  )
}

/** Le trait d'aujourd'hui, en surcouche : net, au-dessus des barres, sans capter la souris. */
export function TodayLine({ scale, height, now = Date.now() }: { scale: Scale; height: number; now?: number }) {
  return <span aria-hidden className="pointer-events-none absolute top-0 w-px bg-accent" style={{ left: scale.x(now), height }} />
}
