import assert from 'node:assert/strict'
import { test } from 'node:test'

const { toggled } = await import('../../web/src/lib/filters.js')

test('toggled ajoute ou retire une valeur sans toucher à l’ensemble reçu', () => {
  const start = new Set(['a'])
  const added = toggled(start, 'b')
  assert.deepEqual([...added].sort(), ['a', 'b'])
  assert.deepEqual([...toggled(added, 'a')], ['b'])
  assert.deepEqual([...start], ['a'])
})
