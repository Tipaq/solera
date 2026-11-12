import assert from 'node:assert/strict'
import { test } from 'node:test'

// Les graduations tombent sur les minuits du lecteur : un fuseau fixe les rend lisibles.
process.env.TZ = 'Europe/Paris'

const { timelineWindow, positionOf, timelineTicks, sessionBars, TIMELINE_MAX_TICKS } = await import('../../web/src/lib/activity-timeline.js')

const DAY = 86_400_000
const HOUR = 3_600_000
/** Le jeudi 12 novembre 2026, 14 h 30 à Paris. */
const NOW = new Date(2026, 10, 12, 14, 30).getTime()
const midnight = (year: number, month: number, day: number) => new Date(year, month, day).getTime()

/* ------------------------------------------------------------------ la fenêtre */

test('sans période, la fenêtre couvre les sept derniers jours jusqu’à maintenant', () => {
  assert.deepEqual(timelineWindow(null, NOW), { from: NOW - 7 * DAY, to: NOW })
})

test('la période du filtre fait la fenêtre', () => {
  assert.deepEqual(timelineWindow(NOW - 30 * DAY, NOW), { from: NOW - 30 * DAY, to: NOW })
  const today = midnight(2026, 10, 12)
  assert.deepEqual(timelineWindow(today, NOW), { from: today, to: NOW })
})

test('juste après minuit, « Aujourd’hui » garde une heure de large', () => {
  const today = midnight(2026, 10, 12)
  assert.deepEqual(timelineWindow(today, today + 60_000), { from: today, to: today + HOUR })
})

test('une position se lit en fraction de la fenêtre, bornée aux deux bouts', () => {
  const window = { from: 0, to: 100 }
  assert.equal(positionOf(25, window), 0.25)
  assert.equal(positionOf(-10, window), 0)
  assert.equal(positionOf(150, window), 1)
})

/* ------------------------------------------------------------------ les graduations */

test('sept jours : une graduation par minuit, datée', () => {
  const ticks = timelineTicks(timelineWindow(null, NOW))
  assert.deepEqual(
    ticks.map((tick) => tick.at),
    [6, 7, 8, 9, 10, 11, 12].map((day) => midnight(2026, 10, day)),
  )
  assert.ok(ticks.every((tick) => tick.left > 0 && tick.left < 1))
  // Le minuit du jour, à 14 h 30, tomberait sous « maintenant ».
  assert.deepEqual(ticks.map((tick) => tick.labelled), [true, true, true, true, true, true, false])
})

test('trente jours : au plus quatorze graduations, la plus récente gardée', () => {
  const ticks = timelineTicks(timelineWindow(NOW - 30 * DAY, NOW))
  assert.ok(ticks.length <= TIMELINE_MAX_TICKS)
  assert.ok(ticks.length >= 10)
  assert.equal(ticks.at(-1)!.at, midnight(2026, 10, 12))
  // Un pas régulier, en jours entiers : un minuit sur trois.
  const gaps = new Set(ticks.slice(1).map((tick, index) => Math.round((tick.at - ticks[index]!.at) / DAY)))
  assert.deepEqual([...gaps], [3])
})

test('aujourd’hui : une graduation, au minuit qui ouvre la fenêtre', () => {
  const today = midnight(2026, 10, 12)
  const ticks = timelineTicks(timelineWindow(today, NOW))
  assert.deepEqual(ticks, [{ at: today, left: 0, labelled: true, compact: true }])
})

test('une graduation trop près de « maintenant » se tait, sa ligne reste', () => {
  // 0 h 20 : le minuit du jour est à quelques minutes du bord droit.
  const now = midnight(2026, 10, 12) + 20 * 60_000
  const last = timelineTicks(timelineWindow(null, now)).at(-1)!
  assert.equal(last.at, midnight(2026, 10, 12))
  assert.equal(last.labelled, false)
})

test('au téléphone, trois dates au plus, loin de « maintenant »', () => {
  const ticks = timelineTicks(timelineWindow(NOW - 30 * DAY, NOW))
  const compact = ticks.filter((tick) => tick.compact)
  assert.ok(compact.length >= 2 && compact.length <= 3)
  assert.ok(compact.every((tick) => tick.labelled && tick.left <= 0.65))
  // Les sept jours aussi : jamais deux dates collées.
  const week = timelineTicks(timelineWindow(null, NOW)).filter((tick) => tick.compact)
  assert.ok(week.length >= 2 && week.length <= 3)
  for (let index = 1; index < week.length; index++) assert.ok(week[index]!.left - week[index - 1]!.left >= 0.25)
})

test('le passage à l’heure d’hiver ne décale pas les minuits', () => {
  // Le 25 octobre 2026 dure 25 h à Paris.
  const now = midnight(2026, 9, 27) + 12 * HOUR
  const ticks = timelineTicks(timelineWindow(null, now))
  assert.ok(ticks.every((tick) => new Date(tick.at).getHours() === 0))
  assert.equal(ticks.length, 7)
})

/* ------------------------------------------------------------------ les barres de sessions */

const session = (over: Partial<{ id: string; group: 'asking' | 'review' | 'running' | 'done'; createdAt: number; updatedAt: number }> = {}) => ({
  id: over.id ?? 's1',
  title: `Session ${over.id ?? 's1'}`,
  agent: 'claude' as const,
  group: over.group ?? 'done',
  createdAt: over.createdAt ?? NOW - 2 * DAY,
  updatedAt: over.updatedAt ?? NOW - DAY,
})

test('une barre va de la création à la dernière mise à jour ; vivante, jusqu’à maintenant', () => {
  const window = timelineWindow(null, NOW)
  const [done] = sessionBars([session()], window, NOW)
  assert.deepEqual({ start: done!.start, end: done!.end, tone: done!.tone }, { start: NOW - 2 * DAY, end: NOW - DAY, tone: 'done' })
  const [running] = sessionBars([session({ group: 'running' })], window, NOW)
  assert.deepEqual({ end: running!.end, tone: running!.tone }, { end: NOW, tone: 'running' })
  const [waiting] = sessionBars([session({ group: 'asking' })], window, NOW)
  assert.deepEqual({ end: waiting!.end, tone: waiting!.tone }, { end: NOW, tone: 'awaiting' })
  // À relire : la session s'est posée, sa barre aussi.
  const [review] = sessionBars([session({ group: 'review' })], window, NOW)
  assert.deepEqual({ end: review!.end, tone: review!.tone }, { end: NOW - DAY, tone: 'done' })
})

test('une session née avant la fenêtre y entre par son bord ; finie avant, elle n’y est pas', () => {
  const window = timelineWindow(null, NOW)
  const [early] = sessionBars([session({ createdAt: NOW - 20 * DAY })], window, NOW)
  assert.equal(early!.start, window.from)
  assert.deepEqual(sessionBars([session({ createdAt: NOW - 20 * DAY, updatedAt: NOW - 10 * DAY })], window, NOW), [])
  // Vivante depuis longtemps : elle traverse toute la fenêtre.
  assert.equal(sessionBars([session({ group: 'running', createdAt: NOW - 20 * DAY, updatedAt: NOW - 10 * DAY })], window, NOW).length, 1)
})

test('huit barres au plus, les plus récentes, alternées sur deux lignes dans l’ordre du temps', () => {
  const window = timelineWindow(null, NOW)
  const many = Array.from({ length: 10 }, (_, index) =>
    session({ id: `s${index}`, createdAt: NOW - (6 - index * 0.5) * DAY, updatedAt: NOW - (5 - index * 0.5) * DAY }),
  )
  const bars = sessionBars(many, window, NOW)
  assert.equal(bars.length, 8)
  // Les deux plus anciennes partent.
  assert.deepEqual(bars.map((bar) => bar.id), ['s2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'])
  assert.deepEqual(bars.map((bar) => bar.lane), [0, 1, 0, 1, 0, 1, 0, 1])
})
