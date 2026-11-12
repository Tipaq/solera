import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ScheduleCadence } from '@solera/protocol'
import type { Automation, UnifiedRun } from '../../web/src/lib/automations.js'
import type { AgendaColumn, Shot } from '../../web/src/lib/agenda-layout.js'

const {
  FOLD_PX,
  HOUR_PX,
  clashCount,
  columnsOf,
  layoutDay,
  liveServices,
  periodOf,
  rowsOf,
  shiftAnchor,
  shotsOf,
  shownHours,
  typicalDuration,
  yOf,
} = await import('../../web/src/lib/agenda-layout.js')
const { zonedParts } = await import('../../web/src/lib/schedule-rule.js')

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** Mercredi 11 novembre 2026, 10:00 à Paris (UTC+1). */
const PARIS = 'Europe/Paris'
const NOW = Date.UTC(2026, 10, 11, 9, 0)
/** Une heure murale de Paris en novembre (UTC+1). */
const paris = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour - 1, minute)

const cron = (expression: string): ScheduleCadence => ({ kind: 'cron', expression })

function item(id: string, over: Partial<Automation> = {}): Automation {
  return {
    id,
    projectId: 'p1',
    label: id,
    description: null,
    what: 'command',
    commandKind: 'task',
    command: 'pnpm test',
    onDemand: true,
    schedule: { cadence: cron('0 3 * * *'), enabled: true, nextRunAt: null },
    runs: [],
    live: null,
    review: null,
    failStreak: 0,
    source: { kind: 'action' } as Automation['source'],
    ...over,
  }
}

const run = (id: string, startedAt: number, minutes: number | null, status: UnifiedRun['status'] = 'succeeded'): UnifiedRun => ({
  id,
  status,
  startedAt,
  finishedAt: minutes === null ? null : startedAt + minutes * MIN,
})

const shot = (key: string, owner: string, start: number, minutes: number): Shot => ({
  key,
  item: item(owner),
  start,
  end: start + minutes * MIN,
  status: 'succeeded',
})

/* ------------------------------------------------------------------ la période */

test('periodOf : la semaine part du lundi minuit, au fuseau du serveur', () => {
  const week = periodOf(NOW, 'week', PARIS)
  assert.equal(week.length, 7)
  assert.deepEqual(week[0]!.day, { year: 2026, month: 11, day: 9 })
  assert.equal(week[0]!.start, paris(9, 0))
  assert.equal(week[6]!.end, paris(16, 0))
  // Un poste à New York voit le même agenda : le jour est celui du serveur.
  const late = Date.UTC(2026, 10, 15, 23, 30) // dimanche 23:30 UTC = lundi 00:30 à Paris
  assert.deepEqual(periodOf(late, 'week', PARIS)[0]!.day, { year: 2026, month: 11, day: 16 })
  assert.deepEqual(periodOf(late, 'week', 'America/New_York')[0]!.day, { year: 2026, month: 11, day: 9 })
})

test('periodOf : un jour, de minuit à minuit, et 25 h le jour du passage à l’heure d’hiver', () => {
  const [today] = periodOf(NOW, 'day', PARIS)
  assert.deepEqual(today!.day, { year: 2026, month: 11, day: 11 })
  assert.equal(today!.end - today!.start, DAY)
  const [fallBack] = periodOf(Date.UTC(2026, 9, 25, 12), 'day', PARIS)
  assert.equal(fallBack!.end - fallBack!.start, 25 * HOUR)
  const [springForward] = periodOf(Date.UTC(2026, 2, 29, 12), 'day', PARIS)
  assert.equal(springForward!.end - springForward!.start, 23 * HOUR)
})

test('shiftAnchor avance d’une semaine ou d’un jour du calendrier, changement d’heure compris', () => {
  const next = shiftAnchor(NOW, 'week', 1, PARIS)
  assert.deepEqual(periodOf(next, 'week', PARIS)[0]!.day, { year: 2026, month: 11, day: 16 })
  const back = shiftAnchor(NOW, 'day', -1, PARIS)
  assert.deepEqual(periodOf(back, 'day', PARIS)[0]!.day, { year: 2026, month: 11, day: 10 })
  // Du lundi 26 octobre (heure d'hiver) au lundi 19 (heure d'été) : toujours un lundi.
  const autumn = shiftAnchor(Date.UTC(2026, 9, 26, 12), 'week', -1, PARIS)
  assert.deepEqual(periodOf(autumn, 'week', PARIS)[0]!.day, { year: 2026, month: 10, day: 19 })
})

/* ------------------------------------------------------------------ les passages */

test('typicalDuration : la médiane des passages finis, au moins 5 min, 20 min sans rien', () => {
  assert.equal(typicalDuration(item('a')), 20 * MIN)
  assert.equal(typicalDuration(item('a', { runs: [run('1', NOW, 2)] })), 5 * MIN)
  assert.equal(typicalDuration(item('a', { runs: [run('1', NOW, 10), run('2', NOW, 40), run('3', NOW, 12), run('4', NOW, null, 'running')] })), 12 * MIN)
})

test('shotsOf : les passages réels de la période, puis ceux à venir, en pointillé (statut nul)', () => {
  const week = periodOf(NOW, 'week', PARIS)
  const from = week[0]!.start
  const to = week[6]!.end
  const nightly = item('nightly', {
    runs: [run('r2', paris(11, 3), 15), run('r1', paris(10, 3), 25, 'failed'), run('old', paris(2, 3), 15)],
  })
  const shots = shotsOf([nightly], from, to, NOW, PARIS)
  const past = shots.filter((entry) => entry.status !== null)
  assert.deepEqual(past.map((entry) => entry.key), ['r2', 'r1'])
  // À venir : du 12 au 15 à 03:00, chacun de la durée typique (médiane de 15, 25, 15).
  const planned = shots.filter((entry) => entry.status === null)
  assert.deepEqual(planned.map((entry) => entry.start), [12, 13, 14, 15].map((day) => paris(day, 3)))
  assert.ok(planned.every((entry) => entry.end - entry.start === 15 * MIN))
})

test('shotsOf : une action sans cadence ou en pause ne prévoit rien, mais garde ses passages', () => {
  const from = paris(9, 0)
  const to = paris(16, 0)
  assert.deepEqual(shotsOf([item('demand', { schedule: null, runs: [run('x', paris(10, 9), 5)] })], from, to, NOW, PARIS), [])
  const paused = item('paused', { schedule: { cadence: cron('0 3 * * *'), enabled: false, nextRunAt: null }, runs: [run('p', paris(10, 3), 5)] })
  assert.deepEqual(shotsOf([paused], from, to, NOW, PARIS).map((entry) => entry.key), ['p'])
})

test('shotsOf : un passage en cours va jusqu’à maintenant, un passage sans fin connue a sa durée typique', () => {
  const live = item('live', { runs: [run('now', NOW - 3 * MIN, null, 'running')] })
  const [running] = shotsOf([live], paris(11, 0), paris(12, 0), NOW, PARIS)
  // Au moins 10 min, pour qu'il se voie.
  assert.equal(running!.end, NOW - 3 * MIN + 10 * MIN)
  const long = item('long', { runs: [run('now', NOW - 40 * MIN, null, 'running')] })
  assert.equal(shotsOf([long], paris(11, 0), paris(12, 0), NOW, PARIS)[0]!.end, NOW)
  // Un vieux passage arrêté sans heure de fin ne s'étire pas jusqu'à maintenant.
  const stopped = item('stopped', { schedule: { cadence: cron('0 3 * * *'), enabled: false, nextRunAt: null }, runs: [run('s', paris(10, 3), null, 'stopped')] })
  const [old] = shotsOf([stopped], paris(9, 0), paris(16, 0), NOW, PARIS)
  assert.equal(old!.end - old!.start, 20 * MIN)
})

test('shotsOf : les passages à venir se lisent au fuseau du serveur, d’une semaine future aussi', () => {
  // Toutes les heures : 200 passages depuis maintenant n'atteindraient pas la semaine d'après.
  const hourly = item('hourly', { schedule: { cadence: cron('0 * * * *'), enabled: true, nextRunAt: null } })
  const from = paris(23, 0)
  const to = paris(30, 0)
  const shots = shotsOf([hourly], from, to, NOW, PARIS)
  assert.equal(shots.length, 7 * 24)
  assert.equal(shots[0]!.start, from)
  // Un motif de 03:00 lu à New York tombe à 09:00 à Paris.
  const ny = item('ny', { schedule: { cadence: cron('0 3 * * *'), enabled: true, nextRunAt: null } })
  const [first] = shotsOf([ny], paris(12, 0), paris(13, 0), NOW, 'America/New_York')
  assert.equal(first!.start, paris(12, 9))
})

test('shotsOf : un intervalle part du prochain passage connu, pas de maintenant', () => {
  const every = item('every', { schedule: { cadence: { kind: 'interval', minutes: 180 }, enabled: true, nextRunAt: NOW + 50 * MIN } })
  const shots = shotsOf([every], paris(11, 0), paris(12, 0), NOW, PARIS)
  assert.deepEqual(shots.map((entry) => entry.start), [50, 230, 410, 590, 770].map((minutes) => NOW + minutes * MIN))
  // Une semaine plus tard, il garde son pas.
  const later = shotsOf([every], paris(18, 0), paris(19, 0), NOW, PARIS)
  assert.ok(later.every((entry) => (entry.start - (NOW + 50 * MIN)) % (180 * MIN) === 0))
  assert.equal(later.length, 8)
})

test('liveServices : les services en marche, pas une commande dans un terminal', () => {
  const on = item('on', { commandKind: 'service', live: { kind: 'service', ports: [5173], since: NOW - HOUR, href: null } })
  const term = item('term', { live: { kind: 'terminal', terminalId: 't', since: NOW } })
  assert.deepEqual(liveServices([on, term, item('idle')]).map((entry) => entry.id), ['on'])
})

/* ------------------------------------------------------------------ les couloirs */

test('layoutDay : des passages qui se recouvrent se rangent côte à côte', () => {
  const placed = layoutDay([shot('a', 'backup', paris(11, 3), 40), shot('b', 'purge', paris(11, 3, 20), 30), shot('c', 'report', paris(11, 9), 10)])
  assert.deepEqual(placed.map((entry) => [entry.key, entry.lane, entry.lanes]), [['a', 0, 2], ['b', 1, 2], ['c', 0, 1]])
  assert.deepEqual(placed.map((entry) => entry.overlaps), [true, true, false])
})

test('layoutDay : deux passages d’une même action ne se chevauchent pas', () => {
  const placed = layoutDay([shot('a', 'tests', paris(11, 3), 40), shot('b', 'tests', paris(11, 3, 20), 30)])
  assert.deepEqual(placed.map((entry) => entry.lanes), [2, 2])
  assert.ok(placed.every((entry) => !entry.overlaps))
})

test('layoutDay : deux blocs courts trop proches pour tenir l’un sous l’autre se décalent, sans chevauchement réel', () => {
  // 5 min chacun à 10 min d'écart : un bloc fait au moins une demi-heure de haut.
  const placed = layoutDay([shot('a', 'lint', paris(11, 3), 5), shot('b', 'tests', paris(11, 3, 10), 5)])
  assert.deepEqual(placed.map((entry) => entry.lane), [0, 1])
  assert.ok(placed.every((entry) => !entry.overlaps))
})

test('clashCount compte les grappes où deux actions différentes se chevauchent', () => {
  const day = periodOf(NOW, 'day', PARIS)
  const columns = columnsOf(day, [
    shot('a', 'backup', paris(11, 3), 60),
    shot('b', 'purge', paris(11, 3, 10), 10),
    shot('c', 'report', paris(11, 3, 40), 10),
    shot('d', 'tests', paris(11, 14), 10),
    shot('e', 'tests', paris(11, 14, 5), 10),
  ])
  assert.equal(clashCount(columns), 1)
})

test('columnsOf coupe un passage qui passe minuit et le montre les deux jours', () => {
  const days = periodOf(NOW, 'week', PARIS)
  const columns = columnsOf(days, [shot('late', 'backup', paris(11, 23, 30), 60)])
  const wednesday = columns[2]!
  const thursday = columns[3]!
  assert.equal(wednesday.shots[0]!.end, paris(12, 0))
  assert.equal(thursday.shots[0]!.start, paris(12, 0))
  assert.equal(thursday.shots[0]!.end, paris(12, 0, 30))
})

/* ------------------------------------------------------------------ les heures montrées */

const columnOf = (shots: Shot[]): AgendaColumn[] => columnsOf(periodOf(NOW, 'day', PARIS), shots)

test('shownHours : les heures qui portent quelque chose ± 1 h, et l’heure courante', () => {
  const columns = columnOf([shot('a', 'backup', paris(11, 3, 30), 70)])
  assert.deepEqual([...shownHours(columns, NOW, false, PARIS)].sort((a, b) => a - b), [2, 3, 4, 5, 9, 10, 11])
})

test('shownHours : sans rien et hors de la période, de 8 h à 19 h ; déplié, toutes', () => {
  const empty = columnOf([])
  assert.deepEqual([...shownHours(empty, NOW + 7 * DAY, false, PARIS)].sort((a, b) => a - b), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  assert.equal(shownHours(empty, NOW, true, PARIS).size, 24)
})

test('shownHours : un passage qui finit à minuit pile ne réveille pas l’heure 0', () => {
  const columns = columnOf([shot('late', 'backup', paris(11, 23, 30), 30)])
  const hours = shownHours(columns, NOW + 7 * DAY, false, PARIS)
  assert.ok(!hours.has(0))
  assert.ok(hours.has(22) && hours.has(23))
})

/* ------------------------------------------------------------------ la géométrie */

test('rowsOf : chaque heure montrée prend sa hauteur, chaque plage cachée une bande', () => {
  const rows = rowsOf(new Set([2, 3, 4, 9, 10]))
  assert.deepEqual(
    rows.list.map((row) => (row.kind === 'hour' ? row.hour : `${row.from}-${row.to}`)),
    ['0-2', 2, 3, 4, '5-9', 9, 10, '11-24'],
  )
  assert.equal(rows.height, 5 * HOUR_PX + 3 * FOLD_PX)
})

test('yOf place un instant à son heure murale, une plage cachée en son milieu', () => {
  const [day] = periodOf(NOW, 'day', PARIS)
  const rows = rowsOf(new Set([2, 3, 4, 9, 10]))
  assert.equal(yOf(paris(11, 3, 30), day!, rows, PARIS), FOLD_PX + HOUR_PX + HOUR_PX / 2)
  assert.equal(yOf(paris(11, 6), day!, rows, PARIS), FOLD_PX + 3 * HOUR_PX + FOLD_PX / 2)
  assert.equal(yOf(day!.start, day!, rows, PARIS), FOLD_PX / 2)
  assert.equal(yOf(day!.end, day!, rows, PARIS), rows.height)
})

test('yOf : le jour du passage à l’heure d’hiver, 04:00 reste à la ligne de 4 h', () => {
  const [day] = periodOf(Date.UTC(2026, 9, 25, 12), 'day', PARIS)
  const rows = rowsOf(new Set(Array.from({ length: 24 }, (_, hour) => hour)))
  const four = Date.UTC(2026, 9, 25, 3) // 04:00 à Paris, déjà en UTC+1
  assert.equal(zonedParts(four, PARIS).hour, 4)
  assert.equal(yOf(four, day!, rows, PARIS), 4 * HOUR_PX)
})
