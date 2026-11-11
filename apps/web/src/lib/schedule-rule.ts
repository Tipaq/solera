import { Cron } from 'croner'
import { cronScheduleSchema, nextScheduleRun, type ScheduleCadence } from '@solera/protocol'
import { cadenceWords, type Translate } from './automations'
import { cronToHuman } from './cron'

/**
 * La planification pour un humain, à la place du cron brut (`actions.md` §1.F) : une
 * **règle** qui se lit comme une phrase (« Répéter chaque semaine le L J à 03:00 »),
 * traduite en cadence du protocole (`ScheduleCadence` : cron, intervalle, une fois) et
 * relue depuis elle. Ce qui ne se relit pas passe en Personnalisé, le cron tel quel.
 *
 * **Tout se lit à l'heure du serveur** : c'est dans son fuseau que le daemon lit un motif
 * cron. La date d'une règle « une fois » est donc un jour du calendrier du serveur, pas
 * un minuit du poste, et les passages se comptent par jour de ce même calendrier.
 *
 * Pur : l'heure et le fuseau passent par `Clock`, le texte par le `t` de l'appelant.
 * `components/automations/ScheduleBuilder` l'affiche ; les tests le lisent seul.
 */

const MIN = 60_000
const DAY = 24 * 60 * MIN

export type Frequency = 'once' | 'hours' | 'daily' | 'weekly' | 'monthly' | 'custom'

/** Le menu des fréquences, en trois groupes : une fois, ce qui se répète, le cron. */
export const FREQUENCY_GROUPS: Frequency[][] = [['once'], ['hours', 'daily', 'weekly', 'monthly'], ['custom']]

/** Les pas de « toutes les N heures » : ceux qui divisent la journée. */
export const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12]

/** Les jours du cron (0 = dimanche), lundi d'abord, comme on lit une semaine. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0]

/** Un jour du calendrier, `month` de 1 à 12. */
export interface CalendarDay {
  year: number
  month: number
  day: number
}

/** L'instant présent et le fuseau où le serveur lit un motif cron. */
export interface Clock {
  now: number
  timeZone: string
}

export interface BuilderState {
  frequency: Frequency
  hour: number
  minute: number
  /** Une fois : le jour, dans le calendrier du serveur. */
  date: CalendarDay
  /** Toutes les N heures. */
  every: number
  rangeOn: boolean
  from: number
  to: number
  /** Chaque jour : jours ouvrés seulement. */
  workdays: boolean
  /** Chaque semaine : jours du cron. */
  days: number[]
  /** Chaque mois : 1–31, ou 'L' pour le dernier jour. */
  monthDay: number | 'L'
  cron: string
  /**
   * L'intervalle relu, rendu tel quel tant qu'on n'a rien touché : il se compte depuis
   * le dernier tir, et le motif qui le montre s'aligne sur l'horloge. Ouvrir puis
   * enregistrer ne change pas l'un en l'autre. Toute modification passe par `edit`, qui
   * l'efface.
   */
  kept: Extract<ScheduleCadence, { kind: 'interval' }> | null
}

/** Ce qui empêche une règle de donner une cadence. */
export type RuleProblem = 'weekdays' | 'cron' | 'past'

/* ------------------------------------------------------------------ le fuseau */

const formatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    })
    formatters.set(timeZone, format)
  }
  return format
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Le jour, l'heure murale et le jour de la semaine (0 = dimanche) de `ts` dans le fuseau. */
export function zonedParts(ts: number, timeZone: string): CalendarDay & { hour: number; minute: number; weekday: number } {
  const parts = Object.fromEntries(partsFormatter(timeZone).formatToParts(ts).map((part) => [part.type, part.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday!]!,
  }
}

/** L'écart du fuseau sur l'UTC à l'instant `ts`. */
function offsetAt(ts: number, timeZone: string): number {
  const wall = zonedParts(ts, timeZone)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  return asUtc - (ts - (ts % MIN))
}

/** L'instant où il est `hour:minute` au mur, le jour `day`, dans le fuseau. */
export function zonedTime(day: CalendarDay, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(day.year, day.month - 1, day.day, hour, minute)
  const first = guess - offsetAt(guess, timeZone)
  // Un changement d'heure entre la supposition et le résultat : on relit l'écart là.
  const second = offsetAt(first, timeZone)
  return guess - second
}

function dayOf(ts: number, timeZone: string): CalendarDay {
  const { year, month, day } = zonedParts(ts, timeZone)
  return { year, month, day }
}

/**
 * Le minuit **du poste** qui porte le jour que `ts` a dans le fuseau : la clé d'un jour
 * pour `MonthGrid`, qui compte en jours locaux.
 */
export function localDayOf(ts: number, timeZone: string): number {
  const { year, month, day } = dayOf(ts, timeZone)
  return new Date(year, month - 1, day).getTime()
}

/** Le jour d'un minuit du poste, tel que `MonthGrid` le rend quand on choisit. */
export function calendarDayOfLocal(localMidnight: number): CalendarDay {
  const date = new Date(localMidnight)
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}

export function localMidnightOf(day: CalendarDay): number {
  return new Date(day.year, day.month - 1, day.day).getTime()
}

const dayNumber = (day: CalendarDay) => Date.UTC(day.year, day.month - 1, day.day) / DAY

/* ------------------------------------------------------------------ règle ↔ cadence */

export function defaultState(clock: Clock): BuilderState {
  return {
    frequency: 'daily',
    hour: 3,
    minute: 0,
    date: dayOf(clock.now + DAY, clock.timeZone),
    every: 6,
    rangeOn: false,
    from: 8,
    to: 20,
    workdays: false,
    days: [1],
    monthDay: 1,
    cron: '0 3 * * *',
    kept: null,
  }
}

const isInt = (value: string) => /^\d+$/.test(value)

/**
 * Le cron le plus proche d'un intervalle que le menu n'offre pas : un intervalle se
 * compte depuis le dernier tir, un motif s'aligne sur l'horloge, l'équivalence n'est
 * qu'approchée.
 */
function cronOfInterval(minutes: number): string {
  if (minutes < 60) return `*/${minutes} * * * *`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `0 */${hours} * * *`
  const days = Math.round(minutes / 1440)
  if (days === 1) return '0 0 * * *'
  return days < 28 ? `0 0 */${days} * *` : '0 0 1 * *'
}

/** Relit une cadence pour pré-remplir la règle ; ce qui ne se relit pas passe en Personnalisé. */
export function stateFromCadence(cadence: ScheduleCadence | null | undefined, clock: Clock): BuilderState {
  const base = defaultState(clock)
  if (!cadence) return base
  if (cadence.kind === 'once') {
    const { year, month, day, hour, minute } = zonedParts(cadence.at, clock.timeZone)
    return { ...base, frequency: 'once', date: { year, month, day }, hour, minute }
  }
  if (cadence.kind === 'interval') {
    const hours = cadence.minutes / 60
    if (EVERY_HOURS.includes(hours)) return { ...base, frequency: 'hours', every: hours, kept: cadence }
    return { ...base, frequency: 'custom', cron: cronOfInterval(cadence.minutes), kept: cadence }
  }
  const expression = cadence.expression.trim()
  const custom: BuilderState = { ...base, frequency: 'custom', cron: expression }
  const parts = expression.split(/\s+/)
  if (parts.length !== 5) return custom
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string]
  if (month !== '*') return custom

  // Toutes les N heures, sur une plage ou non : « 0 */6 * * * », « 0 8-20/2 * * * ».
  const step = hour.match(/^(?:\*|(\d+)-(\d+))\/(\d+)$/)
  if (hour === '*' && min === '0' && dom === '*' && dow === '*') return { ...base, frequency: 'hours', every: 1 }
  if (step && min === '0' && dom === '*' && dow === '*') {
    const every = Number(step[3])
    if (!EVERY_HOURS.includes(every)) return custom
    if (step[1] === undefined) return { ...base, frequency: 'hours', every }
    const from = Number(step[1])
    const to = Number(step[2])
    return to > from && to < 24 ? { ...base, frequency: 'hours', every, rangeOn: true, from, to } : custom
  }

  if (!isInt(min) || !isInt(hour) || Number(min) > 59 || Number(hour) > 23) return custom
  const time = { hour: Number(hour), minute: Number(min) }
  if (dom === '*' && dow === '*') return { ...base, ...time, frequency: 'daily' }
  if (dom === '*' && dow === '1-5') return { ...base, ...time, frequency: 'daily', workdays: true }
  if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow)) {
    return { ...base, ...time, frequency: 'weekly', days: [...new Set(dow.split(',').map((day) => Number(day) % 7))] }
  }
  if (dow === '*' && dom === 'L') return { ...base, ...time, frequency: 'monthly', monthDay: 'L' }
  if (dow === '*' && isInt(dom) && Number(dom) >= 1 && Number(dom) <= 31) {
    return { ...base, ...time, frequency: 'monthly', monthDay: Number(dom) }
  }
  return custom
}

/** Un motif à cinq champs que le serveur acceptera, et qui tombe un jour. */
function validCron(expression: string): boolean {
  return expression.split(/\s+/).length === 5 && cronScheduleSchema.safeParse(expression).success
}

/** Ce qui manque à la règle pour donner une cadence ; null si elle est complète. */
export function problemOf(state: BuilderState, clock: Clock): RuleProblem | null {
  if (state.kept) return null
  if (state.frequency === 'weekly' && state.days.length === 0) return 'weekdays'
  if (state.frequency === 'custom' && !validCron(state.cron.trim())) return 'cron'
  if (state.frequency === 'once' && zonedTime(state.date, state.hour, state.minute, clock.timeZone) <= clock.now) return 'past'
  return null
}

/** La cadence du protocole ; null si la règle est incomplète (`problemOf`). */
export function cadenceFromState(state: BuilderState, clock: Clock): ScheduleCadence | null {
  if (state.kept) return state.kept
  if (problemOf(state, clock)) return null
  const time = `${state.minute} ${state.hour}`
  switch (state.frequency) {
    case 'once':
      return { kind: 'once', at: zonedTime(state.date, state.hour, state.minute, clock.timeZone) }
    case 'hours': {
      // Un motif plutôt qu'un intervalle : il tombe à heures fixes, celles que l'aperçu montre.
      if (state.rangeOn) return cron(`0 ${state.from}-${state.to}/${state.every} * * *`)
      return cron(state.every === 1 ? '0 * * * *' : `0 */${state.every} * * *`)
    }
    case 'daily':
      return cron(`${time} * * ${state.workdays ? '1-5' : '*'}`)
    case 'weekly':
      return cron(`${time} * * ${[...state.days].sort((a, b) => a - b).join(',')}`)
    case 'monthly':
      return cron(`${time} ${state.monthDay} * *`)
    case 'custom':
      return cron(state.cron.trim())
  }
}

const cron = (expression: string): ScheduleCadence => ({ kind: 'cron', expression })

/** Une modification de la règle : dès lors, c'est elle qui est rendue, plus l'intervalle relu. */
export function edit(state: BuilderState, patch: Partial<Omit<BuilderState, 'kept'>>): BuilderState {
  return { ...state, ...patch, kept: null }
}

/** Change de fréquence ; passer en Personnalisé part du cron de ce qu'on voyait. */
export function withFrequency(state: BuilderState, frequency: Frequency, clock: Clock): BuilderState {
  const shown = cadenceFromState(edit(state, {}), clock)
  if (frequency === 'custom' && shown?.kind === 'cron') return edit(state, { frequency, cron: shown.expression })
  return edit(state, { frequency })
}

/** Déplace la plage horaire en gardant une fin après le début. */
export function withRange(state: BuilderState, change: { from?: number; to?: number }): BuilderState {
  const from = Math.min(change.from ?? state.from, 22)
  const to = Math.min(Math.max(change.to ?? state.to, from + 1), 23)
  return edit(state, { from, to })
}

/* ------------------------------------------------------------------ les mots */

/** « lundi », « Monday » ; `narrow` donne l'initiale (« L », « M »). */
export function weekdayName(cronDay: number, locale: string, style: 'long' | 'narrow' = 'long'): string {
  // Le 7 janvier 2024 est un dimanche.
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(Date.UTC(2024, 0, 7 + cronDay))
}

/** « 1er », « 15 » ; « 1st », « 23rd ». */
export function ordinalWords(day: number, t: Translate, locale: string): string {
  const rule = new Intl.PluralRules(locale, { type: 'ordinal' }).select(day)
  const key = rule === 'one' || rule === 'two' || rule === 'few' ? rule : 'other'
  return t(`scheduleRule.ordinal.${key}`, { n: day })
}

/** L'heure dans une phrase : « 3 h 00 », « 3:00 ». */
export function clockWords(hour: number, minute: number, t: Translate): string {
  return t('scheduleRule.clock', { hour, minute: String(minute).padStart(2, '0') })
}

/** Une heure pleine : « 8 h », « 8:00 ». */
export function hourWords(hour: number, t: Translate): string {
  return t('scheduleRule.hour', { hour })
}

/** Un jour du calendrier en toutes lettres, sans fuseau à appliquer : c'en est déjà un. */
export function dayWords(day: CalendarDay, locale: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(locale, { weekday: style, day: 'numeric', month: style, timeZone: 'UTC' }).format(
    Date.UTC(day.year, day.month - 1, day.day),
  )
}

export function pluralKey(count: number, locale: string): 'one' | 'other' {
  return new Intl.PluralRules(locale).select(count) === 'one' ? 'one' : 'other'
}

/** La phrase en clair de la règle ; null quand elle n'a pas de cadence. */
export function sentenceOf(state: BuilderState, cadence: ScheduleCadence | null, t: Translate, locale: string): string | null {
  if (!cadence) return null
  if (cadence.kind === 'interval') return cadenceWords(cadence, t, locale)
  const time = clockWords(state.hour, state.minute, t)
  switch (state.frequency) {
    case 'once':
      return t('scheduleRule.sentence.once', { date: dayWords(state.date, locale), time })
    case 'hours': {
      const count = pluralKey(state.every, locale)
      return state.rangeOn
        ? t(`scheduleRule.sentence.hoursRange.${count}`, {
            count: state.every,
            from: hourWords(state.from, t),
            to: hourWords(state.to, t),
          })
        : t(`scheduleRule.sentence.hours.${count}`, { count: state.every })
    }
    case 'daily':
      return t(state.workdays ? 'scheduleRule.sentence.workdays' : 'scheduleRule.sentence.daily', { time })
    case 'weekly': {
      const names = WEEK.filter((day) => state.days.includes(day)).map((day) => weekdayName(day, locale))
      const days = new Intl.ListFormat(locale, { type: 'conjunction' }).format(names)
      return t('scheduleRule.sentence.weekly', { days, time })
    }
    case 'monthly':
      return state.monthDay === 'L'
        ? t('scheduleRule.sentence.monthlyLast', { time })
        : t('scheduleRule.sentence.monthly', { day: ordinalWords(state.monthDay, t, locale), time })
    case 'custom':
      return cadence.kind === 'cron' ? (cronToHuman(cadence.expression, locale) ?? cadence.expression) : null
  }
}

/* ------------------------------------------------------------------ les passages */

/**
 * Les `count` prochains passages après `after`, jusqu'à `horizon`, avec la règle du
 * daemon : un motif se lit dans `timeZone`, un intervalle se compte du passage précédent.
 */
export function upcoming(
  cadence: ScheduleCadence | null,
  count: number,
  { after, horizon = Infinity, timeZone }: { after: number; horizon?: number; timeZone: string },
): number[] {
  if (!cadence) return []
  // Un seul motif pour toute la boucle : l'aperçu en demande des centaines par mois.
  let pattern: Cron | null = null
  if (cadence.kind === 'cron') {
    try {
      pattern = new Cron(cadence.expression, { paused: true, timezone: timeZone })
    } catch {
      return []
    }
  }
  const runs: number[] = []
  let cursor = after
  let last: number | null = null
  while (runs.length < count) {
    const next: number | null = pattern
      ? (pattern.nextRun(new Date(cursor))?.getTime() ?? null)
      : nextScheduleRun(cadence, cursor, last, timeZone)
    if (next === null || next > horizon) break
    runs.push(next)
    last = next
    cursor = next
  }
  return runs
}

/** Les passages par jour du fuseau, en clés de `MonthGrid` (`localDayOf`). */
export function marksOf(runs: number[], timeZone: string): Map<number, number> {
  const marks = new Map<number, number>()
  for (const at of runs) {
    const day = localDayOf(at, timeZone)
    marks.set(day, (marks.get(day) ?? 0) + 1)
  }
  return marks
}

/** « dans 20 min », « dans 5 h » le jour même, « demain », « dans 3 j » : en jours du fuseau. */
export function relativeDay(at: number, now: number, t: Translate, timeZone: string): string {
  const delta = at - now
  if (delta < 60 * MIN) return t('scheduleRule.relative.minutes', { count: Math.max(1, Math.round(delta / MIN)) })
  const days = dayNumber(dayOf(at, timeZone)) - dayNumber(dayOf(now, timeZone))
  if (days <= 0) return t('scheduleRule.relative.hours', { count: Math.round(delta / (60 * MIN)) })
  if (days === 1) return t('scheduleRule.relative.tomorrow')
  return t('scheduleRule.relative.days', { count: days })
}
