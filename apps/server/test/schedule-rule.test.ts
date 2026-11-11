import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ScheduleCadence } from '@solera/protocol'
import type { BuilderState, Clock } from '../../web/src/lib/schedule-rule.js'
import type { MessageKey, MessageParams } from '../../web/src/lib/i18n/index.js'

const {
  cadenceFromState,
  defaultState,
  localDayOf,
  marksOf,
  problemOf,
  relativeDay,
  sentenceOf,
  stateFromCadence,
  upcoming,
  withFrequency,
  withRange,
  zonedParts,
  zonedTime,
} = await import('../../web/src/lib/schedule-rule.js')
const { en } = await import('../../web/src/lib/i18n/catalog-en.js')
const { fr } = await import('../../web/src/lib/i18n/catalog-fr.js')

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function translator(catalog: Record<string, string>) {
  return (key: MessageKey, params?: MessageParams) =>
    catalog[key]!.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
const t = translator(fr)
const tEn = translator(en)

/** Mercredi 11 novembre 2026, 10:00 à Paris (UTC+1). */
const PARIS = 'Europe/Paris'
const NOW = Date.UTC(2026, 10, 11, 9, 0)
const clock: Clock = { now: NOW, timeZone: PARIS }

const cron = (expression: string): ScheduleCadence => ({ kind: 'cron', expression })
const state = (over: Partial<BuilderState>): BuilderState => ({ ...defaultState(clock), ...over })

/* ------------------------------------------------------------------ le fuseau */

test('zonedParts lit une date dans le fuseau donné, pas dans celui du poste', () => {
  assert.deepEqual(zonedParts(NOW, PARIS), { year: 2026, month: 11, day: 11, hour: 10, minute: 0, weekday: 3 })
  assert.deepEqual(zonedParts(NOW, 'America/New_York'), { year: 2026, month: 11, day: 11, hour: 4, minute: 0, weekday: 3 })
  assert.deepEqual(zonedParts(NOW, 'Asia/Tokyo'), { year: 2026, month: 11, day: 11, hour: 18, minute: 0, weekday: 3 })
})

test('zonedTime pose une heure murale dans le fuseau, de part et d’autre d’un changement d’heure', () => {
  assert.equal(zonedTime({ year: 2026, month: 11, day: 12 }, 3, 0, PARIS), Date.UTC(2026, 10, 12, 2, 0))
  // Heure d'été à Paris : UTC+2.
  assert.equal(zonedTime({ year: 2026, month: 7, day: 1 }, 3, 0, PARIS), Date.UTC(2026, 6, 1, 1, 0))
  // Le jour du passage à l'heure d'été (29 mars 2026), 10:00 est déjà en UTC+2.
  assert.equal(zonedTime({ year: 2026, month: 3, day: 29 }, 10, 0, PARIS), Date.UTC(2026, 2, 29, 8, 0))
  // Et la veille du passage à l'heure d'hiver (25 octobre 2026), 10:00 est encore en UTC+2.
  assert.equal(zonedTime({ year: 2026, month: 10, day: 24 }, 10, 0, PARIS), Date.UTC(2026, 9, 24, 8, 0))
  assert.equal(zonedTime({ year: 2026, month: 10, day: 26 }, 10, 0, PARIS), Date.UTC(2026, 9, 26, 9, 0))
})

test('localDayOf rend le minuit du poste du jour vu dans le fuseau, celui que MonthGrid attend', () => {
  // 23:30 à Paris le 11, mais déjà le 12 à Tokyo.
  const late = Date.UTC(2026, 10, 11, 22, 30)
  assert.equal(localDayOf(late, PARIS), new Date(2026, 10, 11).getTime())
  assert.equal(localDayOf(late, 'Asia/Tokyo'), new Date(2026, 10, 12).getTime())
})

/* ------------------------------------------------------------------ règle ↔ cadence */

test('la règle par défaut : chaque jour à 03:00, la date du lendemain dans le fuseau', () => {
  const base = defaultState(clock)
  assert.equal(base.frequency, 'daily')
  assert.deepEqual(base.date, { year: 2026, month: 11, day: 12 })
  assert.deepEqual(cadenceFromState(base, clock), cron('0 3 * * *'))
})

test('chaque fréquence produit sa cadence, et la relit à l’identique', () => {
  const cases: [Partial<BuilderState>, ScheduleCadence][] = [
    [{ frequency: 'hours', every: 6 }, cron('0 */6 * * *')],
    [{ frequency: 'hours', every: 1 }, cron('0 * * * *')],
    [{ frequency: 'hours', every: 2, rangeOn: true, from: 8, to: 20 }, cron('0 8-20/2 * * *')],
    [{ frequency: 'daily', hour: 9, minute: 30 }, cron('30 9 * * *')],
    [{ frequency: 'daily', hour: 9, minute: 0, workdays: true }, cron('0 9 * * 1-5')],
    [{ frequency: 'weekly', hour: 3, minute: 0, days: [4, 1] }, cron('0 3 * * 1,4')],
    [{ frequency: 'weekly', hour: 7, minute: 15, days: [0, 6] }, cron('15 7 * * 0,6')],
    [{ frequency: 'monthly', hour: 3, minute: 0, monthDay: 1 }, cron('0 3 1 * *')],
    [{ frequency: 'monthly', hour: 23, minute: 45, monthDay: 31 }, cron('45 23 31 * *')],
    [{ frequency: 'monthly', hour: 3, minute: 0, monthDay: 'L' }, cron('0 3 L * *')],
    [{ frequency: 'custom', cron: ' 5 4 * * 2 ' }, cron('5 4 * * 2')],
  ]
  for (const [over, expected] of cases) {
    const built = cadenceFromState(state(over), clock)
    assert.deepEqual(built, expected, JSON.stringify(over))
    const reread = stateFromCadence(built, clock)
    assert.deepEqual(cadenceFromState(reread, clock), expected, `relu : ${JSON.stringify(expected)}`)
  }
})

test('relire une cadence retrouve la fréquence et ses morceaux', () => {
  assert.deepEqual(
    pick(stateFromCadence(cron('0 8-20/2 * * *'), clock), ['frequency', 'every', 'rangeOn', 'from', 'to']),
    { frequency: 'hours', every: 2, rangeOn: true, from: 8, to: 20 },
  )
  assert.deepEqual(pick(stateFromCadence(cron('30 9 * * 1-5'), clock), ['frequency', 'hour', 'minute', 'workdays']), {
    frequency: 'daily',
    hour: 9,
    minute: 30,
    workdays: true,
  })
  // 7 est aussi dimanche, et un doublon ne compte qu'une fois.
  assert.deepEqual(stateFromCadence(cron('0 3 * * 1,7,0'), clock).days, [1, 0])
  assert.equal(stateFromCadence(cron('0 3 L * *'), clock).monthDay, 'L')
})

test('une fois : l’heure est celle du fuseau du serveur, à l’aller comme au retour', () => {
  const once = state({ frequency: 'once', date: { year: 2026, month: 11, day: 20 }, hour: 14, minute: 30 })
  const cadence = cadenceFromState(once, clock)
  assert.deepEqual(cadence, { kind: 'once', at: Date.UTC(2026, 10, 20, 13, 30) })
  const reread = stateFromCadence(cadence, clock)
  assert.deepEqual(pick(reread, ['frequency', 'date', 'hour', 'minute']), {
    frequency: 'once',
    date: { year: 2026, month: 11, day: 20 },
    hour: 14,
    minute: 30,
  })
  // Le même instant, relu à New York, tombe à 08:30.
  assert.equal(stateFromCadence(cadence, { now: NOW, timeZone: 'America/New_York' }).hour, 8)
})

test('un intervalle d’heures du menu se relit en « toutes les N heures »', () => {
  const hours = stateFromCadence({ kind: 'interval', minutes: 360 }, clock)
  assert.deepEqual(pick(hours, ['frequency', 'every']), { frequency: 'hours', every: 6 })
})

test('ce qui ne se relit pas passe en Personnalisé, le cron tel quel', () => {
  for (const expression of ['0 9 1 1 *', '*/10 * * * *', '0 9 * * 1-3', '0 9 1 * 1', '30 */6 * * *', '0 9-17 * * *', '0 0 12 * * 1']) {
    const read = stateFromCadence(cron(expression), clock)
    assert.equal(read.frequency, 'custom', expression)
    assert.equal(read.cron, expression)
  }
})

test('un intervalle hors du menu passe en Personnalisé, au cron le plus proche', () => {
  assert.deepEqual(pick(stateFromCadence({ kind: 'interval', minutes: 30 }, clock), ['frequency', 'cron']), {
    frequency: 'custom',
    cron: '*/30 * * * *',
  })
  assert.equal(stateFromCadence({ kind: 'interval', minutes: 1440 }, clock).cron, '0 0 * * *')
  assert.equal(stateFromCadence({ kind: 'interval', minutes: 2 * 1440 }, clock).cron, '0 0 */2 * *')
})

test('passer en Personnalisé garde le cron équivalent de ce qu’on voyait', () => {
  const weekly = state({ frequency: 'weekly', hour: 3, minute: 0, days: [1, 4] })
  assert.equal(withFrequency(weekly, 'custom', clock).cron, '0 3 * * 1,4')
  // Une règle incomplète ne fabrique pas de cron : on garde le dernier.
  const empty = state({ frequency: 'weekly', days: [], cron: '0 3 * * *' })
  assert.equal(withFrequency(empty, 'custom', clock).cron, '0 3 * * *')
  assert.equal(withFrequency(weekly, 'monthly', clock).frequency, 'monthly')
})

test('la plage horaire garde une fin après le début', () => {
  const ranged = state({ frequency: 'hours', rangeOn: true, from: 8, to: 20 })
  assert.deepEqual(pick(withRange(ranged, { from: 21 }), ['from', 'to']), { from: 21, to: 21 + 1 })
  assert.deepEqual(pick(withRange(ranged, { to: 5 }), ['from', 'to']), { from: 8, to: 9 })
  // 23 h ne laisse plus d'heure après lui : le début s'arrête à 22 h.
  assert.deepEqual(pick(withRange(ranged, { from: 23 }), ['from', 'to']), { from: 22, to: 23 })
})

/* ------------------------------------------------------------------ ce qui manque */

test('une règle incomplète n’a pas de cadence, et dit pourquoi', () => {
  const noDay = state({ frequency: 'weekly', days: [] })
  assert.equal(problemOf(noDay, clock), 'weekdays')
  assert.equal(cadenceFromState(noDay, clock), null)

  for (const bad of ['', 'nope', '0 9 * *', '0 0 30 2 *', '0 0 12 * * 1', '61 9 * * *']) {
    const custom = state({ frequency: 'custom', cron: bad })
    assert.equal(problemOf(custom, clock), 'cron', bad)
    assert.equal(cadenceFromState(custom, clock), null, bad)
  }

  const past = state({ frequency: 'once', date: { year: 2026, month: 11, day: 11 }, hour: 9, minute: 0 })
  assert.equal(problemOf(past, clock), 'past')
  assert.equal(cadenceFromState(past, clock), null)
  assert.equal(problemOf(state({ frequency: 'once', date: { year: 2026, month: 11, day: 11 }, hour: 11, minute: 0 }), clock), null)
})

/* ------------------------------------------------------------------ la phrase */

test('la phrase en clair, en français', () => {
  const say = (over: Partial<BuilderState>) => {
    const rule = state(over)
    return sentenceOf(rule, cadenceFromState(rule, clock), t, 'fr')
  }
  assert.equal(say({ frequency: 'hours', every: 1 }), 'Toutes les heures')
  assert.equal(say({ frequency: 'hours', every: 6 }), 'Toutes les 6 heures')
  assert.equal(say({ frequency: 'hours', every: 2, rangeOn: true, from: 8, to: 20 }), 'Toutes les 2 heures, entre 8 h et 20 h')
  assert.equal(say({ frequency: 'daily', hour: 3, minute: 0 }), 'Chaque jour à 3 h 00')
  assert.equal(say({ frequency: 'daily', hour: 9, minute: 30, workdays: true }), 'Chaque jour ouvré (lundi à vendredi) à 9 h 30')
  assert.equal(say({ frequency: 'weekly', hour: 3, minute: 0, days: [4, 1] }), 'Chaque lundi et jeudi à 3 h 00')
  assert.equal(say({ frequency: 'weekly', hour: 3, minute: 0, days: [0, 1, 3] }), 'Chaque lundi, mercredi et dimanche à 3 h 00')
  assert.equal(say({ frequency: 'monthly', hour: 3, minute: 0, monthDay: 1 }), 'Le 1er de chaque mois à 3 h 00')
  assert.equal(say({ frequency: 'monthly', hour: 3, minute: 0, monthDay: 15 }), 'Le 15 de chaque mois à 3 h 00')
  assert.equal(say({ frequency: 'monthly', hour: 3, minute: 0, monthDay: 'L' }), 'Le dernier jour de chaque mois à 3 h 00')
  assert.equal(
    say({ frequency: 'once', date: { year: 2026, month: 11, day: 20 }, hour: 14, minute: 30 }),
    'Une seule fois, le vendredi 20 novembre à 14 h 30',
  )
  assert.match(say({ frequency: 'custom', cron: '0 9 * * 1' }) ?? '', /09:00/)
  assert.equal(say({ frequency: 'weekly', days: [] }), null)
})

test('la phrase en clair, en anglais', () => {
  const say = (over: Partial<BuilderState>) => {
    const rule = state(over)
    return sentenceOf(rule, cadenceFromState(rule, clock), tEn, 'en')
  }
  assert.equal(say({ frequency: 'hours', every: 1 }), 'Every hour')
  assert.equal(say({ frequency: 'hours', every: 2, rangeOn: true, from: 8, to: 20 }), 'Every 2 hours, between 8:00 and 20:00')
  assert.equal(say({ frequency: 'weekly', hour: 3, minute: 0, days: [4, 1] }), 'Every Monday and Thursday at 3:00')
  assert.equal(say({ frequency: 'monthly', hour: 3, minute: 0, monthDay: 2 }), 'On the 2nd of each month at 3:00')
  assert.equal(say({ frequency: 'monthly', hour: 3, minute: 0, monthDay: 23 }), 'On the 23rd of each month at 3:00')
  assert.equal(say({ frequency: 'monthly', hour: 3, minute: 0, monthDay: 11 }), 'On the 11th of each month at 3:00')
  assert.equal(
    say({ frequency: 'once', date: { year: 2026, month: 11, day: 20 }, hour: 14, minute: 30 }),
    'Once, on Friday, November 20 at 14:30',
  )
})

/* ------------------------------------------------------------------ les passages */

test('les prochains passages se calculent à l’heure du serveur', () => {
  const daily = cron('0 3 * * *')
  assert.deepEqual(upcoming(daily, 2, { after: NOW, timeZone: PARIS }), [Date.UTC(2026, 10, 12, 2), Date.UTC(2026, 10, 13, 2)])
  assert.deepEqual(upcoming(daily, 1, { after: NOW, timeZone: 'America/New_York' }), [Date.UTC(2026, 10, 12, 8)])
})

test('les passages suivent le changement d’heure', () => {
  // Paris passe à l'heure d'hiver le 25 octobre 2026 : 03:00 reste 03:00 au mur.
  const runs = upcoming(cron('0 3 * * *'), 3, { after: Date.UTC(2026, 9, 23, 12), timeZone: PARIS })
  assert.deepEqual(runs, [Date.UTC(2026, 9, 24, 1), Date.UTC(2026, 9, 25, 2), Date.UTC(2026, 9, 26, 2)])
})

test('l’horizon borne les passages, et une date unique n’en a qu’un', () => {
  const hourly = upcoming(cron('0 * * * *'), 1000, { after: NOW, horizon: NOW + DAY, timeZone: PARIS })
  assert.equal(hourly.length, 24)
  assert.ok(hourly.every((at) => at <= NOW + DAY))
  assert.deepEqual(upcoming({ kind: 'once', at: NOW + HOUR }, 5, { after: NOW, timeZone: PARIS }), [NOW + HOUR])
  assert.deepEqual(upcoming({ kind: 'once', at: NOW - HOUR }, 5, { after: NOW, timeZone: PARIS }), [])
  assert.deepEqual(upcoming(null, 5, { after: NOW, timeZone: PARIS }), [])
  assert.deepEqual(upcoming({ kind: 'interval', minutes: 90 }, 2, { after: NOW, timeZone: PARIS }), [NOW + 90 * MIN, NOW + 180 * MIN])
})

test('le dernier jour du mois suit la longueur du mois', () => {
  const runs = upcoming(cron('0 3 L * *'), 3, { after: Date.UTC(2027, 0, 1), timeZone: PARIS })
  assert.deepEqual(runs.map((at) => zonedParts(at, PARIS).day), [31, 28, 31])
})

test('les jours marqués comptent les passages par jour du fuseau', () => {
  const runs = upcoming(cron('0 8-20/6 * * *'), 6, { after: NOW, timeZone: PARIS })
  const marks = marksOf(runs, PARIS)
  assert.equal(marks.get(new Date(2026, 10, 11).getTime()), 2)
  assert.equal(marks.get(new Date(2026, 10, 12).getTime()), 3)
  assert.equal(marks.get(new Date(2026, 10, 13).getTime()), 1)
})

test('l’écart d’un passage : minutes, heures le jour même, demain, puis en jours', () => {
  assert.equal(relativeDay(NOW + 20 * MIN, NOW, t, PARIS), 'dans 20 min')
  assert.equal(relativeDay(NOW + 20_000, NOW, t, PARIS), 'dans 1 min')
  assert.equal(relativeDay(NOW + 5 * HOUR, NOW, t, PARIS), 'dans 5 h')
  // 01:00 le lendemain, à Paris : c'est demain même si c'est dans 15 h.
  assert.equal(relativeDay(Date.UTC(2026, 10, 12, 0), NOW, t, PARIS), 'demain')
  assert.equal(relativeDay(Date.UTC(2026, 10, 14, 2), NOW, t, PARIS), 'dans 3 j')
  assert.equal(relativeDay(Date.UTC(2026, 10, 14, 2), NOW, tEn, PARIS), 'in 3 d')
})

function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>
}
