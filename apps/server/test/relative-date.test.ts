import assert from 'node:assert/strict'
import { test } from 'node:test'

const { relativeDate } = await import('../../web/src/lib/dates.js')

/** Le 12 novembre 2026 à l'heure dite, dans le fuseau du poste qui lance les tests. */
const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime()

test('relativeDate : une échéance à minuit garde son nombre de jours toute la journée (#271)', () => {
  const due = at(21, 0)
  assert.equal(relativeDate(due, at(12, 9)), 'in 9 days')
  assert.equal(relativeDate(due, at(12, 15)), 'in 9 days')
  assert.equal(relativeDate(due, at(12, 23)), 'in 9 days')
})

test('relativeDate : demain et hier se lisent au calendrier, pas en tranches de 24 h', () => {
  assert.equal(relativeDate(at(14, 0), at(12, 20)), 'in 2 days')
  assert.equal(relativeDate(at(10, 12), at(12, 18)), '2 days ago')
  assert.equal(relativeDate(at(13, 20), at(12, 9)), 'tomorrow')
})

test('relativeDate : sous un jour, les heures et les minutes restent', () => {
  assert.equal(relativeDate(at(12, 18), at(12, 9)), 'in 9 hours')
  assert.equal(relativeDate(at(12, 9) - 5 * 60_000, at(12, 9)), '5 minutes ago')
})
