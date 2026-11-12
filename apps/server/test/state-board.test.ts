import assert from 'node:assert/strict'
import { test } from 'node:test'

const { stateColumns, RECENT_DONE_MAX } = await import('../../web/src/lib/state-board.js')

const DAY = 86_400_000
const NOW = 1_800_000_000_000

type Group = 'asking' | 'review' | 'running' | 'done'
const row = (id: string, group: Group, updatedAt = NOW - 60_000, archivedAt: number | null = null) => ({
  group,
  entry: { conversation: { id, updatedAt, archivedAt } },
})
const ids = (rows: { entry: { conversation: { id: string } } }[]) => rows.map((entry) => entry.entry.conversation.id)

test('Travaille et À relire suivent le groupe de la session, dans l’ordre reçu', () => {
  const columns = stateColumns([row('a', 'running'), row('b', 'review'), row('c', 'asking'), row('d', 'running')], NOW)
  assert.deepEqual(ids(columns.working), ['a', 'd'])
  assert.deepEqual(ids(columns.review), ['b'])
  // Ce qui t'attend vit dans la liste des demandes, pas dans une colonne de sessions.
  assert.deepEqual(ids(columns.done), [])
})

test('Terminées récemment : les trois derniers jours, la plus récente d’abord, sans les archivées', () => {
  const columns = stateColumns(
    [
      row('vieille', 'done', NOW - 4 * DAY),
      row('hier', 'done', NOW - DAY),
      row('archivée', 'done', NOW - DAY, NOW - 1000),
      row('ce-matin', 'done', NOW - 3_600_000),
      row('limite', 'done', NOW - 3 * DAY),
    ],
    NOW,
  )
  assert.deepEqual(ids(columns.done), ['ce-matin', 'hier', 'limite'])
})

test('Terminées récemment s’arrête à douze', () => {
  const many = Array.from({ length: 20 }, (_, index) => row(`s${index}`, 'done', NOW - index * 60_000))
  const { done } = stateColumns(many, NOW)
  assert.equal(RECENT_DONE_MAX, 12)
  assert.equal(done.length, 12)
  assert.equal(done[0]!.entry.conversation.id, 's0')
})
