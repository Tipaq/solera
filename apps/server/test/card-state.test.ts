import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardConversationDto, CardDto } from '@solera/protocol'

const { awaitsMe, cardState, isLate, liveSessions } = await import('../../web/src/lib/card-state.js')

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

test('état d’une carte : en retard seulement ouverte et l’échéance passée', () => {
  const now = 1_000_000
  assert.equal(isLate(card('todo', { dueAt: now - 1 }), now), true)
  assert.equal(isLate(card('todo', { dueAt: now + 1 }), now), false)
  assert.equal(isLate(card('done', { dueAt: now - 1 }), now), false)
  assert.equal(isLate(card('todo'), now), false)
})

test('état d’une carte : ses sessions vivantes, archivées exclues', () => {
  const conversations = [session('running'), session('awaiting_input'), session('idle'), session('running', 1)]
  assert.deepEqual(liveSessions(card('todo', { conversations })).map((s) => s.status), ['running', 'awaiting_input'])
  assert.equal(awaitsMe(card('todo', { conversations })), true)
  assert.equal(awaitsMe(card('todo', { conversations: [session('awaiting_input', 1), session('running')] })), false)
})
