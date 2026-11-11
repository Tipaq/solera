import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardColumn, CardDto } from '@solera/protocol'

const { openLeafCount, movedView } = await import('../../web/src/lib/place.js')

const card = (column: CardColumn, children = 0) =>
  ({ column, children: Array.from({ length: children }, (_, i) => ({ id: `c${i}` })) }) as unknown as CardDto

test("le compte du Tableau ne garde que les feuilles ouvertes", () => {
  assert.equal(openLeafCount([]), 0)
  assert.equal(openLeafCount(undefined), 0)
  assert.equal(
    openLeafCount([card('todo'), card('in_progress'), card('review'), card('done'), card('abandoned')]),
    3,
    'Une carte terminée ou abandonnée ne reste pas à faire',
  )
  // Une parente compterait deux fois le travail de ses enfants.
  assert.equal(openLeafCount([card('in_progress', 2), card('todo'), card('todo')]), 2)
})

test("une ancienne adresse garde sa requête en rejoignant la nouvelle vue", () => {
  assert.equal(movedView('/p/a/travail', ''), '/p/a/travail')
  assert.equal(movedView('/p/a/travail', '?groupe=worktree'), '/p/a/travail?groupe=worktree')
  assert.equal(movedView('/p/a/travail', '', { vue: 'moment' }), '/p/a/travail?vue=moment')
  // Le paramètre imposé l'emporte sur celui de l'ancienne adresse, les autres restent.
  assert.equal(
    movedView('/p/a/travail', '?vue=liste&source=git', { vue: 'moment' }),
    '/p/a/travail?vue=moment&source=git',
  )
})
