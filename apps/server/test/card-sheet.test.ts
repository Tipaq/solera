import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardConversationDto, CardDto, CardLinkDto, CardNoteDto } from '@solera/protocol'

const { descriptionProse, leadSession, milestoneFlag, recentNotes, sheetNumber, sheetSessions, waitingSession, withSheet } =
  await import('../../web/src/lib/card-sheet.js')

const link = (number: number): CardLinkDto => ({ id: `c-${number}`, number, title: `carte ${number}`, column: 'todo' })
const session = (id: string, status: CardConversationDto['status'], createdAt: number, archivedAt: number | null = null) =>
  ({ id, status, createdAt, archivedAt }) as CardConversationDto
const card = (extra: Partial<CardDto> = {}) =>
  ({ parent: null, children: [], milestone: false, conversations: [], ...extra }) as CardDto
const loaded = (entry: CardConversationDto) => entry.status

test('fiche : l’adresse porte le numéro de la carte, et rien d’autre n’en sort', () => {
  assert.equal(sheetNumber(new URLSearchParams('fiche=12')), 12)
  assert.equal(sheetNumber(new URLSearchParams('vue=gantt')), null)
  assert.equal(sheetNumber(new URLSearchParams('fiche=')), null)
  assert.equal(sheetNumber(new URLSearchParams('fiche=0')), null)
  assert.equal(sheetNumber(new URLSearchParams('fiche=-3')), null)
  assert.equal(sheetNumber(new URLSearchParams('fiche=1.5')), null)
  assert.equal(sheetNumber(new URLSearchParams('fiche=abc')), null)

  const opened = withSheet(new URLSearchParams('vue=gantt'), 7)
  assert.equal(opened.toString(), 'vue=gantt&fiche=7', 'Les autres paramètres restent')
  assert.equal(withSheet(opened, 9).get('fiche'), '9', 'Une autre fiche remplace la première')
  assert.equal(withSheet(opened, null).toString(), 'vue=gantt', 'Fermer retire le paramètre')
})

test('fiche : les sessions de la carte, archivées exclues, la plus récente d’abord', () => {
  const sessions = sheetSessions(
    card({ conversations: [session('a', 'idle', 1), session('b', 'running', 3), session('c', 'idle', 2, 10)] }),
  )
  assert.deepEqual(sessions.map((entry) => entry.id), ['b', 'a'])
})

test('fiche : la session à ouvrir est la plus active, sinon la plus récente', () => {
  const idle = session('idle', 'idle', 5)
  const running = session('running', 'running', 4)
  const error = session('error', 'error', 3)
  const awaiting = session('awaiting', 'awaiting_input', 2)
  const interrupted = session('interrupted', 'interrupted', 1)
  assert.equal(leadSession([idle, running, error, awaiting], loaded)?.id, 'awaiting', 't’attend passe devant')
  assert.equal(leadSession([idle, running, error], loaded)?.id, 'error', 'puis en erreur')
  assert.equal(leadSession([idle, running, interrupted], loaded)?.id, 'running', 'puis tourne')
  assert.equal(leadSession([idle, interrupted], loaded)?.id, 'idle', 'sinon la plus récente')
  assert.equal(leadSession([], loaded), undefined)
})

test('fiche : l’état vivant du socket prime sur celui du chargement', () => {
  const first = session('first', 'idle', 2)
  const second = session('second', 'running', 1)
  const live = (entry: CardConversationDto) => (entry.id === 'first' ? 'awaiting_input' : 'idle')
  assert.equal(waitingSession([first, second], live)?.id, 'first')
  assert.equal(waitingSession([first, second], loaded), undefined)
  assert.equal(leadSession([first, second], live)?.id, 'first')
})

test('case « C’est un jalon » : d’office avec des enfants, impossible sous une parente, libre sinon', () => {
  assert.deepEqual(milestoneFlag(card({ milestone: true, children: [link(2), link(3)] })), {
    checked: true,
    disabled: true,
    reason: 'children',
  })
  assert.deepEqual(milestoneFlag(card({ parent: link(1) })), { checked: false, disabled: true, reason: 'parent' })
  assert.deepEqual(milestoneFlag(card({ milestone: true })), { checked: true, disabled: false, reason: 'free' })
  assert.deepEqual(milestoneFlag(card()), { checked: false, disabled: false, reason: 'free' })
  // Un drapeau incohérent venu d'ailleurs ne coche pas la case d'une enfant.
  assert.equal(milestoneFlag(card({ parent: link(1), milestone: true })).checked, false)
})

test('fiche : la description sans ses cases, que la section Sous-tâches montre déjà', () => {
  const text = [
    'Le contexte.',
    '',
    '- [ ] une',
    '* [x] deux',
    '  1. [X] trois',
    '- une puce ordinaire',
    '```md',
    '- [ ] un exemple, pas une tâche',
    '```',
    '',
  ].join('\n')
  assert.equal(
    descriptionProse(text),
    ['Le contexte.', '', '- une puce ordinaire', '```md', '- [ ] un exemple, pas une tâche', '```'].join('\n'),
  )
  assert.equal(descriptionProse('- [ ] seule\n- [x] cases'), '')
})

test('fiche : les trois notes les plus récentes, et combien il y en a', () => {
  const note = (id: string, createdAt: number) => ({ id, createdAt }) as CardNoteDto
  const { shown, total } = recentNotes([note('a', 1), note('b', 4), note('c', 2), note('d', 3)])
  assert.deepEqual(shown.map((entry) => entry.id), ['b', 'd', 'c'])
  assert.equal(total, 4)
  assert.deepEqual(recentNotes(undefined), { shown: [], total: 0 })
})
