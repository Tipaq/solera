import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_DRAFT_CARDS, cardDraftProblems, type CardDraft, type CardDraftCard } from '@solera/protocol'

const { addDraftCard, draftLetter, moveDraftCard, removeDraftCard, renameDraftCard, toggleDraftAfter } = await import(
  '../../web/src/lib/card-draft-edit.js'
)

/* ------------------------------------------------------------------ fixtures */

const card = (key: string, title: string, after: string[] = [], extra: Partial<CardDraftCard> = {}): CardDraftCard => ({
  key,
  title,
  description: '',
  subtasks: [],
  after,
  blockedBy: [],
  related: [],
  ...extra,
})

const milestone = { cardId: 'm', number: 182, title: 'Page projet v2 · Jalons' }

/** A, puis B après A, puis C après A et B. */
const draft = (): CardDraft => ({
  parent: { kind: 'existing', card: milestone },
  cards: [card('a', 'Échelle'), card('b', 'Barres', ['a']), card('c', 'Infobulle', ['a', 'b'])],
})

const keys = (value: CardDraft) => value.cards.map((entry) => entry.key)
const afterOf = (value: CardDraft, key: string) => value.cards.find((entry) => entry.key === key)?.after

/* ------------------------------------------------------------------ lettres */

test('chaque carte du brouillon se nomme par sa lettre, dans l’ordre', () => {
  assert.equal(draftLetter(0), 'A')
  assert.equal(draftLetter(2), 'C')
  assert.equal(draftLetter(25), 'Z')
  // Vingt cartes au plus : la borne n'est jamais franchie, mais un rang hors alphabet reste lisible.
  assert.equal(draftLetter(26), '27')
})

/* ------------------------------------------------------------------ renommer */

test('renommer remplace le titre, sans espaces autour', () => {
  const next = renameDraftCard(draft(), 'b', '  Barres de cartes ')
  assert.equal(next.cards[1]?.title, 'Barres de cartes')
  assert.deepEqual(keys(next), ['a', 'b', 'c'])
})

test('un titre vide ou inchangé laisse le brouillon tel quel', () => {
  const before = draft()
  assert.equal(renameDraftCard(before, 'b', '   '), before)
  assert.equal(renameDraftCard(before, 'b', 'Barres'), before)
  assert.equal(renameDraftCard(before, 'inconnue', 'Autre'), before)
})

/* ------------------------------------------------------------------ retirer */

test('retirer une carte retire aussi les liens qui la citaient', () => {
  const next = removeDraftCard(draft(), 'a')
  assert.deepEqual(keys(next), ['b', 'c'])
  assert.deepEqual(afterOf(next, 'b'), [])
  assert.deepEqual(afterOf(next, 'c'), ['b'])
  assert.deepEqual(cardDraftProblems(next), [])
})

/* ------------------------------------------------------------------ déplacer */

test('monter et descendre échangent une carte avec sa voisine', () => {
  const independent: CardDraft = { parent: null, cards: [card('a', 'A'), card('b', 'B'), card('c', 'C')] }
  assert.deepEqual(keys(moveDraftCard(independent, 'c', -1)), ['a', 'c', 'b'])
  assert.deepEqual(keys(moveDraftCard(independent, 'a', 1)), ['b', 'a', 'c'])
})

test('rien ne bouge au bord, ni pour une clé inconnue', () => {
  const before = draft()
  assert.equal(moveDraftCard(before, 'a', -1), before)
  assert.equal(moveDraftCard(before, 'c', 1), before)
  assert.equal(moveDraftCard(before, 'z', 1), before)
})

test('passer une carte au-dessus de celle qu’elle attend défait ce lien, et lui seul', () => {
  // Les pastilles « après » ne montrent que les cartes du dessus : un lien vers le
  // dessous serait invisible, et ne se défairait plus.
  const next = moveDraftCard(draft(), 'b', -1)
  assert.deepEqual(keys(next), ['b', 'a', 'c'])
  assert.deepEqual(afterOf(next, 'b'), [])
  assert.deepEqual(afterOf(next, 'c'), ['a', 'b'])
  // Dans l'autre sens : A descend sous B, qui l'attendait.
  assert.deepEqual(afterOf(moveDraftCard(draft(), 'a', 1), 'b'), [])
  assert.deepEqual(cardDraftProblems(next), [])
})

test('les cartes existantes qu’une carte attend la suivent quand elle bouge', () => {
  const blocker = { cardId: 'x', number: 161, title: 'Tiroir commun' }
  const before: CardDraft = { parent: null, cards: [card('a', 'A'), card('b', 'B', [], { blockedBy: [blocker] })] }
  assert.deepEqual(moveDraftCard(before, 'b', -1).cards[0]?.blockedBy, [blocker])
})

/* ------------------------------------------------------------------ lier */

test('une pastille éteint puis rallume le lien vers une carte du dessus', () => {
  const off = toggleDraftAfter(draft(), 'b', 'a')
  assert.deepEqual(afterOf(off, 'b'), [])
  const on = toggleDraftAfter(off, 'b', 'a')
  assert.deepEqual(afterOf(on, 'b'), ['a'])
})

test('une carte ne peut attendre ni elle-même, ni une carte du dessous', () => {
  const before = draft()
  assert.equal(toggleDraftAfter(before, 'b', 'b'), before)
  assert.equal(toggleDraftAfter(before, 'a', 'c'), before)
  assert.equal(toggleDraftAfter(before, 'b', 'inconnue'), before)
})

/* ------------------------------------------------------------------ ajouter */

test('ajouter pose une carte à la fin, après la dernière, sous une clé libre', () => {
  const next = addDraftCard(draft(), '  Horizon des jalons ')
  assert.equal(next.cards.length, 4)
  assert.deepEqual(next.cards[3], card('k1', 'Horizon des jalons', ['c']))
  // La clé suivante ne reprend pas celle que l'agent aurait déjà donnée.
  const taken: CardDraft = { parent: null, cards: [card('k1', 'Déjà là')] }
  assert.equal(addDraftCard(taken, 'Autre').cards[1]?.key, 'k2')
  assert.deepEqual(cardDraftProblems(next), [])
})

test('ajouter un titre vide, ou au-delà de la borne, ne change rien', () => {
  const before = draft()
  assert.equal(addDraftCard(before, '   '), before)
  const full: CardDraft = { parent: null, cards: Array.from({ length: MAX_DRAFT_CARDS }, (_, index) => card(`c${index}`, `Carte ${index}`)) }
  assert.equal(addDraftCard(full, 'Une de trop'), full)
})
