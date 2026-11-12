import { RUN_VERDICTS, type Automation, type AutomationSchedule, type RunStatus } from './automations'
import { upcoming, zonedParts, zonedTime, type CalendarDay } from './schedule-rule'

/**
 * La géométrie de l'Agenda des actions (`actions.md` §1.G) : les passages passés et à
 * venir des actions planifiées, sur une semaine ou un jour, rangés en couloirs quand ils
 * se recouvrent, sur une grille dont les heures vides se resserrent.
 *
 * **Tout se lit à l'heure du serveur**, comme la planification (`lib/schedule-rule.ts`) :
 * un passage de 03:00 tombe à la ligne de 3 h même quand le navigateur est ailleurs. Un
 * jour va de minuit à minuit dans ce fuseau, et fait 23 ou 25 heures quand l'heure change.
 *
 * Pur : l'heure et le fuseau viennent de l'appelant. `components/automations/ActionsAgenda`
 * l'affiche ; les tests le lisent seul.
 */

const MIN = 60_000

/** Hauteur d'une heure montrée, et d'une plage d'heures resserrée. */
export const HOUR_PX = 44
export const FOLD_PX = 22
/** Hauteur minimale d'un bloc : de quoi lire une ligne. */
export const MIN_BLOCK = 20
/** Ce qu'un bloc occupe au moins, en temps : sa hauteur minimale, arrondie. */
const VISUAL_SPAN = 30 * MIN
/** Un passage en cours dure au moins ça à l'écran, pour qu'il se voie. */
const LIVE_SPAN = 10 * MIN
/** Plafond des passages prévus d'une action sur la période. */
const MAX_PLANNED = 1000

export type AgendaScope = 'week' | 'day'

/** Un jour de la période, et l'intervalle `[start, end)` qu'il couvre. */
export interface AgendaDay {
  day: CalendarDay
  start: number
  end: number
}

/** Un passage dans l'agenda. */
export interface Shot {
  key: string
  item: Automation
  start: number
  end: number
  /** Null : un passage à venir. */
  status: RunStatus | null
}

/** Un passage placé dans sa colonne. */
export interface Placed extends Shot {
  /** Son couloir, parmi les `lanes` de sa grappe. */
  lane: number
  lanes: number
  /** Il recouvre, dans le temps, un passage d'une autre action. */
  overlaps: boolean
  /** Sa grappe dans la journée : les passages qui se touchent à l'écran. */
  cluster: number
}

export interface AgendaColumn extends AgendaDay {
  shots: Placed[]
}

export type Row = { kind: 'hour'; hour: number; top: number } | { kind: 'fold'; from: number; to: number; top: number }

export interface Rows {
  list: Row[]
  height: number
}

/* ------------------------------------------------------------------ la période */

function addDays(day: CalendarDay, count: number): CalendarDay {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + count))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

function agendaDay(day: CalendarDay, timeZone: string): AgendaDay {
  return { day, start: zonedTime(day, 0, 0, timeZone), end: zonedTime(addDays(day, 1), 0, 0, timeZone) }
}

/** Les jours montrés autour de `anchor` : sa semaine, du lundi au dimanche, ou son jour. */
export function periodOf(anchor: number, scope: AgendaScope, timeZone: string): AgendaDay[] {
  const { year, month, day, weekday } = zonedParts(anchor, timeZone)
  if (scope === 'day') return [agendaDay({ year, month, day }, timeZone)]
  const monday = addDays({ year, month, day }, -((weekday + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => agendaDay(addDays(monday, index), timeZone))
}

/** La période d'avant ou d'après : midi du jour visé, loin des minuits qui changent d'heure. */
export function shiftAnchor(anchor: number, scope: AgendaScope, step: -1 | 1, timeZone: string): number {
  const { year, month, day } = zonedParts(anchor, timeZone)
  return zonedTime(addDays({ year, month, day }, step * (scope === 'week' ? 7 : 1)), 12, 0, timeZone)
}

/* ------------------------------------------------------------------ les passages */

/** La durée habituelle d'une action : la médiane de ses passages finis, sinon 20 min. */
export function typicalDuration(item: Automation): number {
  const durations = item.runs
    .flatMap((run) => (run.finishedAt === null ? [] : [run.finishedAt - run.startedAt]))
    .sort((a, b) => a - b)
  return durations.length ? Math.max(5 * MIN, durations[Math.floor(durations.length / 2)]!) : 20 * MIN
}

/**
 * Les passages prévus dans `[from, to)` et après `now`. Un intervalle se compte de son
 * prochain passage connu, comme le daemon ; un motif se lit dans le fuseau du serveur, à
 * partir du début de la période et pas de maintenant, pour qu'une semaine lointaine ne
 * soit pas vide faute d'avoir compté assez loin.
 */
function plannedIn(schedule: AutomationSchedule, from: number, to: number, now: number, timeZone: string): number[] {
  const start = Math.max(now, from)
  const { cadence, nextRunAt } = schedule
  if (cadence.kind === 'interval') {
    const step = cadence.minutes * MIN
    let at = nextRunAt !== null && nextRunAt > now ? nextRunAt : now + step
    if (at < start) at += Math.ceil((start - at) / step) * step
    const out: number[] = []
    for (; at < to && out.length < MAX_PLANNED; at += step) out.push(at)
    return out
  }
  return upcoming(cadence, MAX_PLANNED, { after: start - 1, horizon: to - 1, timeZone }).filter((at) => at > now && at >= from)
}

/**
 * Les passages de la période des actions planifiées : les vrais, puis ceux à venir, d'une
 * durée typique. Un passage en cours s'étend jusqu'à maintenant ; un passage fini dont on
 * ignore la fin prend la durée typique, plutôt que de s'étirer jusqu'à maintenant.
 */
export function shotsOf(items: readonly Automation[], from: number, to: number, now: number, timeZone: string): Shot[] {
  const out: Shot[] = []
  for (const item of items) {
    if (!item.schedule) continue
    const length = typicalDuration(item)
    for (const run of item.runs) {
      const end =
        run.finishedAt ?? (RUN_VERDICTS[run.status].live ? Math.max(now, run.startedAt + LIVE_SPAN) : run.startedAt + length)
      if (end <= from || run.startedAt >= to) continue
      out.push({ key: run.id, item, start: run.startedAt, end, status: run.status })
    }
    if (!item.schedule.enabled) continue
    for (const at of plannedIn(item.schedule, from, to, now, timeZone)) {
      out.push({ key: `${item.id}-${at}`, item, start: at, end: at + length, status: null })
    }
  }
  return out
}

/** Ce qui tourne en continu, pour le bandeau du jour : un service n'a pas d'heure. */
export function liveServices(items: readonly Automation[]): Automation[] {
  return items.filter((item) => item.live?.kind === 'service')
}

/* ------------------------------------------------------------------ les couloirs */

const visualEnd = (shot: Shot) => Math.max(shot.end, shot.start + VISUAL_SPAN)

/**
 * Range les passages d'un jour, triés par début, en grappes qui se touchent à l'écran :
 * chacun prend le premier couloir libre, et une grappe partage sa largeur entre ses
 * couloirs. Un bloc fait au moins une demi-heure de haut, donc deux passages courts
 * trop proches se décalent aussi. Mais ne **chevauche** que celui qui recouvre, dans le
 * temps, un passage d'une autre action : une action ne tourne jamais deux fois.
 */
export function layoutDay(shots: readonly Shot[]): Placed[] {
  const out: Placed[] = []
  let cluster: Placed[] = []
  let clusterEnd = -Infinity
  let index = 0
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((shot) => shot.lane + 1))
    for (const shot of cluster) {
      const overlaps = cluster.some((other) => other.item.id !== shot.item.id && other.start < shot.end && shot.start < other.end)
      out.push({ ...shot, lanes, overlaps })
    }
    cluster = []
    index += 1
  }
  for (const shot of shots) {
    if (shot.start >= clusterEnd && cluster.length) flush()
    const used = new Set(cluster.filter((entry) => visualEnd(entry) > shot.start).map((entry) => entry.lane))
    let lane = 0
    while (used.has(lane)) lane += 1
    cluster.push({ ...shot, lane, lanes: 1, overlaps: false, cluster: index })
    clusterEnd = Math.max(clusterEnd, visualEnd(shot))
  }
  if (cluster.length) flush()
  return out
}

/** Les colonnes de la période : les passages de chaque jour, coupés à minuit, rangés. */
export function columnsOf(days: readonly AgendaDay[], shots: readonly Shot[]): AgendaColumn[] {
  return days.map((day) => {
    const mine = shots
      .filter((shot) => shot.start < day.end && shot.end > day.start)
      .map((shot) => ({ ...shot, start: Math.max(shot.start, day.start), end: Math.min(shot.end, day.end) }))
      .sort((a, b) => a.start - b.start || a.key.localeCompare(b.key))
    return { ...day, shots: layoutDay(mine) }
  })
}

/** Les grappes où deux actions différentes se recouvrent : « ⚠ N chevauchements ». */
export function clashCount(columns: readonly AgendaColumn[]): number {
  return columns.reduce(
    (count, column) => count + new Set(column.shots.filter((shot) => shot.overlaps).map((shot) => shot.cluster)).size,
    0,
  )
}

/* ------------------------------------------------------------------ les heures */

const wallHour = (ts: number, timeZone: string) => zonedParts(ts, timeZone).hour

/**
 * Les heures montrées : celles qui portent un passage, une heure de marge autour, et
 * l'heure courante si elle est dans la période. Sans rien, la journée de travail.
 */
export function shownHours(columns: readonly AgendaColumn[], now: number, unfolded: boolean, timeZone: string): Set<number> {
  if (unfolded) return new Set(Array.from({ length: 24 }, (_, hour) => hour))
  const set = new Set<number>()
  const mark = (hour: number) => {
    for (const near of [hour - 1, hour, hour + 1]) if (near >= 0 && near < 24) set.add(near)
  }
  for (const column of columns) {
    for (const shot of column.shots) {
      const first = wallHour(shot.start, timeZone)
      // La fin est exclue : un passage qui finit à 4:00 pile n'occupe pas l'heure de 4 h.
      const last = Math.max(first, wallHour(Math.max(shot.start, shot.end - 1), timeZone))
      for (let hour = first; hour <= last; hour += 1) mark(hour)
    }
  }
  if (columns.some((column) => now >= column.start && now < column.end)) mark(wallHour(now, timeZone))
  if (set.size === 0) for (let hour = 8; hour <= 19; hour += 1) set.add(hour)
  return set
}

/** La géométrie verticale : chaque heure montrée prend `HOUR_PX`, chaque plage cachée `FOLD_PX`. */
export function rowsOf(hours: ReadonlySet<number>): Rows {
  const list: Row[] = []
  let top = 0
  let hour = 0
  while (hour < 24) {
    if (hours.has(hour)) {
      list.push({ kind: 'hour', hour, top })
      top += HOUR_PX
      hour += 1
    } else {
      const from = hour
      while (hour < 24 && !hours.has(hour)) hour += 1
      list.push({ kind: 'fold', from, to: hour, top })
      top += FOLD_PX
    }
  }
  return { list, height: top }
}

/** La hauteur d'un instant dans sa colonne, à son heure murale ; dans une plage cachée, en son milieu. */
export function yOf(ts: number, day: AgendaDay, rows: Rows, timeZone: string): number {
  if (ts >= day.end) return rows.height
  const { hour, minute } = zonedParts(Math.max(ts, day.start), timeZone)
  for (const row of rows.list) {
    if (row.kind === 'hour' && row.hour === hour) return row.top + (minute / 60) * HOUR_PX
    if (row.kind === 'fold' && hour >= row.from && hour < row.to) return row.top + FOLD_PX / 2
  }
  return rows.height
}
