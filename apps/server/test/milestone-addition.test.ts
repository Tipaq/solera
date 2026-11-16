import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardDraft, CardFilingChangeDto, CardRefinementDetailDto } from '@solera/protocol'

const { additionHref, additionPrompt, proposedAdditions } = await import('../../web/src/lib/refinement.js')

/**
 * « Ajouter au jalon » (#196, spec jalons ADD-1..4, AFF-7) : ce qui part à la session
 * d'affinage, et la proposition qu'elle rend, lue sur la page du jalon.
 */

/* ------------------------------------------------------------------ le message */

test('à la session qui vit, l’ajout part tel quel, ses liens à la suite', () => {
  assert.equal(
    additionPrompt({ number: 370, text: '  Gérer les pièces jointes hors ligne (#156)\n', links: ['https://github.com/Tipaq/solera/pull/212'], session: true }),
    'Ajout au jalon : Gérer les pièces jointes hors ligne (#156)\n\nLiens :\n- https://github.com/Tipaq/solera/pull/212',
  )
})

test('sans session, il invoque le skill sur le jalon et nomme les fichiers joints au jalon', () => {
  assert.equal(
    additionPrompt({ number: 370, text: 'Une file d’envoi', files: ['maquette.png', 'notes.pdf'], session: false }),
    '/affiner-un-jalon #370\n\nAjout au jalon : Une file d’envoi\n\nFichiers joints au jalon : maquette.png, notes.pdf',
  )
})

test('sans session, l’ajout ouvre un brouillon de découpage du jalon, pré-rempli', () => {
  const url = new URL(additionHref('p1', 'card-370', 'Ajout au jalon : x'), 'http://solera')
  assert.equal(url.pathname, '/p/p1/c/new')
  assert.equal(url.searchParams.get('split'), 'card-370')
  assert.equal(url.searchParams.get('mode'), null)
  assert.equal(url.searchParams.get('prompt'), 'Ajout au jalon : x')
})

/* ------------------------------------------------------------------ la proposition */

const line = (number: number, extra: Partial<CardFilingChangeDto> = {}): CardFilingChangeDto => ({
  cardId: `card-${number}`,
  number,
  title: `Carte ${number}`,
  fromColumn: 'todo',
  reason: 'Elle en parle déjà.',
  ...extra,
})

const changeOf = (...changes: CardFilingChangeDto[]): CardRefinementDetailDto['change'] => ({ requestId: 'c1', conversationId: 'split', changes })

const DRAFT: CardDraft = {
  parent: { kind: 'existing', card: { cardId: 'card-370', number: 370, title: 'Hors ligne' } },
  cards: [
    { key: 'a', title: 'Pièces jointes hors ligne', description: '', subtasks: [], after: [], blockedBy: [{ cardId: 'card-372', number: 372, title: 'Cache' }], related: [] },
    { key: 'b', title: 'Vignettes en cache', description: '', subtasks: [], after: ['a'], blockedBy: [], related: [] },
    { key: 'c', title: 'Bandeau', description: '', subtasks: [], after: [], blockedBy: [], related: [] },
  ],
}

const CARDS = [{ id: 'card-372', description: '## Sous-tâches\n- [x] Lire les fils\n- [ ] Écrire hors ligne' }]

test('des sous-tâches dans une carte du jalon : « Ranger dans #N », celles qu’elle a déjà repérées', () => {
  const additions = proposedAdditions({ change: changeOf(line(372, { addSubtasks: ['Lire les fils', 'Pièces jointes'] })), draft: null }, true, CARDS)
  assert.deepEqual(additions, [
    {
      kind: 'subtasks',
      conversationId: 'split',
      requestId: 'c1',
      targets: [
        {
          cardId: 'card-372',
          number: 372,
          title: 'Carte 372',
          subtasks: [
            { label: 'Lire les fils', present: true },
            { label: 'Pièces jointes', present: false },
          ],
        },
      ],
    },
  ])
})

test('un changement qui fait autre chose que des sous-tâches reste à décider dans la session', () => {
  const moved = changeOf(line(372, { addSubtasks: ['Pièces jointes'] }), line(373, { toColumn: 'done' }))
  assert.deepEqual(proposedAdditions({ change: moved, draft: null }, true, CARDS), [])
})

test('de nouvelles cartes dans un jalon déjà découpé : la liste, et après quoi chacune part', () => {
  const additions = proposedAdditions({ change: null, draft: { requestId: 'd2', conversationId: 'split', draft: DRAFT } }, true, CARDS)
  assert.equal(additions.length, 1)
  const [cards] = additions
  assert.equal(cards?.kind, 'cards')
  if (cards?.kind !== 'cards') return
  assert.equal(cards.requestId, 'd2')
  assert.deepEqual(cards.cards, [
    { key: 'a', title: 'Pièces jointes hors ligne', after: { number: 372 } },
    { key: 'b', title: 'Vignettes en cache', after: { title: 'Pièces jointes hors ligne' } },
    { key: 'c', title: 'Bandeau', after: null },
  ])
})

test('le premier découpage n’est pas un ajout : il reste au brouillon éditable', () => {
  assert.deepEqual(proposedAdditions({ change: null, draft: { requestId: 'd1', conversationId: 'split', draft: DRAFT } }, false, CARDS), [])
  assert.deepEqual(proposedAdditions(undefined, true, CARDS), [])
})
