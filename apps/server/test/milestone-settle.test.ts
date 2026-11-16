import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardLinkDto } from '@solera/protocol'

const { cycleLinks, settleCount } = await import('../../web/src/lib/settle.js')

/**
 * « À régler avant de partir » sur la page d'un jalon (#196, spec jalons RGL-1..6) : ce
 * qui retient un jalon découpé, compté et réglé sur place.
 */

const link = (number: number): CardLinkDto => ({ id: `card-${number}`, number, title: `Carte ${number}`, column: 'todo' })
const card = (number: number, blockedBy: number[] = []) => ({ id: `card-${number}`, number, blockedBy: blockedBy.map(link) })

/* ------------------------------------------------------------------ le cycle */

test('un cycle se dit lien par lien, « #a bloque #b », sans les bloqueurs hors du cycle', () => {
  // 301 → 302 → 303 → 301, et 304 bloque 302 sans en faire partie.
  const cycle = [card(301, [303]), card(302, [301, 304]), card(303, [302])]
  assert.deepEqual(
    cycleLinks(cycle).map(({ blocker, card: blocked }) => [blocker.number, blocked.number]),
    [
      [303, 301],
      [301, 302],
      [302, 303],
    ],
  )
})

test('sans cycle, aucun lien à retirer', () => {
  assert.deepEqual(cycleLinks([]), [])
})

/* ------------------------------------------------------------------ le compte */

test('les points en attente : chaque carte à préciser ou à accepter, et le cycle pour un seul', () => {
  const entry = { toClarify: [card(1), card(2)], notAccepted: [card(3)], cycle: [card(4, [5]), card(5, [4])] }
  assert.equal(settleCount(entry), 4)
  assert.equal(settleCount({ toClarify: [], notAccepted: [], cycle: [] }), 0)
})
