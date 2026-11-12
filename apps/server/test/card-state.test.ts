import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardConversationDto, CardDto } from '@solera/protocol'

const { awaitsMe, cardState, isLate, lateDays, liveSessions } = await import('../../web/src/lib/card-state.js')

const link = (column: CardDto['column']) => ({ id: `l-${column}`, number: 1, title: 'bloqueuse', column })
const session = (status: CardConversationDto['status'], archivedAt: number | null = null) =>
  ({ id: `s-${status}`, status, archivedAt }) as CardConversationDto
const card = (column: CardDto['column'], extra: Partial<CardDto> = {}) =>
  ({ column, dueAt: null, blockedBy: [], conversations: [], ...extra }) as CardDto

test('état d’une carte : la colonne, plus « bloquée » déduit d’un bloqueur encore ouvert', () => {
  assert.equal(cardState(card('todo')), 'todo')
  assert.equal(cardState(card('in_progress')), 'running')
  assert.equal(cardState(card('review')), 'review')
  assert.equal(cardState(card('done')), 'done')
  assert.equal(cardState(card('abandoned')), 'abandoned')
  assert.equal(cardState(card('in_progress', { blockedBy: [link('todo')] })), 'blocked')
  assert.equal(cardState(card('todo', { blockedBy: [link('done'), link('abandoned')] })), 'todo')
  // Une carte à relire ne redevient pas bloquée : son travail est fait.
  assert.equal(cardState(card('review', { blockedBy: [link('todo')] })), 'review')
})

test('état d’une carte : en retard une fois le jour de l’échéance passé, et ouverte', () => {
  // Une échéance est un jour : posée le 4, la carte n'est en retard qu'à partir du 5.
  const due = new Date(2026, 10, 4).getTime()
  const morning = new Date(2026, 10, 4, 10).getTime()
  const next = new Date(2026, 10, 5, 0, 1).getTime()
  assert.equal(isLate(card('todo', { dueAt: due }), morning), false)
  assert.equal(isLate(card('todo', { dueAt: due }), next), true)
  assert.equal(isLate(card('done', { dueAt: due }), next), false)
  assert.equal(isLate(card('todo'), next), false)
})

test('état d’une carte : les jours de retard se comptent au calendrier', () => {
  const due = new Date(2026, 10, 4).getTime()
  assert.equal(lateDays(card('todo', { dueAt: due }), new Date(2026, 10, 4, 23).getTime()), 0)
  assert.equal(lateDays(card('todo', { dueAt: due }), new Date(2026, 10, 5, 0, 1).getTime()), 1)
  assert.equal(lateDays(card('todo', { dueAt: due }), new Date(2026, 10, 11, 10).getTime()), 7)
  assert.equal(lateDays(card('done', { dueAt: due }), new Date(2026, 10, 11, 10).getTime()), 0)
})

test('état d’une carte : ses sessions vivantes, archivées exclues', () => {
  const conversations = [session('running'), session('awaiting_input'), session('idle'), session('running', 1)]
  assert.deepEqual(liveSessions(card('todo', { conversations })).map((s) => s.status), ['running', 'awaiting_input'])
  assert.equal(awaitsMe(card('todo', { conversations })), true)
  assert.equal(awaitsMe(card('todo', { conversations: [session('awaiting_input', 1), session('running')] })), false)
})

test('état d’une carte : le statut vivant du socket l’emporte sur celui du chargement', () => {
  const conversations = [session('running'), session('idle')]
  const live = (entry: { id: string; status: CardConversationDto['status'] }) => (entry.id === 's-running' ? 'awaiting_input' : entry.status)
  assert.equal(awaitsMe(card('todo', { conversations })), false)
  assert.equal(awaitsMe(card('todo', { conversations }), live), true)
  assert.deepEqual(liveSessions(card('todo', { conversations }), () => 'idle'), [])
})
