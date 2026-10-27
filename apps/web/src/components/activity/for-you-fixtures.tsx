import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AwaitingRequestEntryDto, ConversationDto, ProjectDto } from '@solera/protocol'
import type { LiveConversation } from '../../lib/activity'
import type { ForYouRequest } from '../../lib/for-you'
import { PENDING } from '../decisions/decision-fixtures'

/**
 * Ce qui t'attend, pour le catalogue : un fil bloqué sur une permission, un autre sur une
 * question, un plan, une décision et deux accords, dans deux projets et un fil libre.
 */

const MINUTE = 60_000
const now = Date.now()

/** Les champs que la ligne lit ; le reste du DTO n'y paraît pas. */
function project(id: string, name: string, color: string): ProjectDto {
  return { id, name, color, image: null, isOwner: true } as unknown as ProjectDto
}

export const PROJECTS = [project('p1', 'Solera', '#7c8cff'), project('p2', 'Nimbus', '#3fb7c9')]

function conversation(id: string, projectId: string | null, title: string, ago: number): ConversationDto {
  return {
    id, projectId, title, agent: 'claude', status: 'idle', archivedAt: null, isOwner: true,
    updatedAt: now - ago * MINUTE, lastNotableSeq: 0,
  } as unknown as ConversationDto
}

function live(entry: ConversationDto, state: Partial<LiveConversation>): LiveConversation {
  return {
    conversation: entry, status: 'idle', running: false, awaiting: false, unread: false,
    settledAt: entry.updatedAt, since: entry.updatedAt, seq: 0, ...state,
  }
}

const PERMISSION = conversation('c-perm', 'p1', 'Réglages et permissions à trois niveaux', 4)
const QUESTION = conversation('c-question', 'p2', 'Dessiner l’onglet Agents', 12)
const PLAN = conversation('c-plan', null, 'Préparer la note de version', 30)

export const ENTRIES: LiveConversation[] = [
  live(PERMISSION, { status: 'awaiting_input', awaiting: true }),
  live(QUESTION, { status: 'awaiting_input', awaiting: true }),
  live(PLAN, { status: 'awaiting_input', awaiting: true }),
  live(conversation('c-run', 'p1', 'Réécrire « Where Solera comes from »', 2), { status: 'running', running: true }),
  live(conversation('c-run2', 'p2', 'Mesurer le temps de réponse', 8), { status: 'running', running: true }),
  live(conversation('c-unread', 'p1', 'Répondre à une session depuis l’Activité', 3), { unread: true }),
]

export const FOR_YOU: ForYouRequest[] = [
  {
    tier: 'blocked', key: 'blocked:c-perm', conversationId: PERMISSION.id, conversationTitle: PERMISSION.title,
    projectId: 'p1', since: now - 4 * MINUTE, conversation: PERMISSION,
    request: {
      kind: 'permission', requestId: 'perm-1', requestedAt: now - 4 * MINUTE,
      event: {
        type: 'permission.requested', requestId: 'perm-1', toolName: 'Bash',
        input: { command: 'pnpm --filter @solera/web test:places-ui' }, suggestions: [],
      },
    },
  },
  {
    tier: 'blocked', key: 'blocked:c-question', conversationId: QUESTION.id, conversationTitle: QUESTION.title,
    projectId: 'p2', since: now - 12 * MINUTE, conversation: QUESTION,
    request: {
      kind: 'question', requestId: 'q-1', requestedAt: now - 12 * MINUTE,
      event: {
        type: 'question.requested', requestId: 'q-1',
        questions: [{
          id: 'q', header: 'Onglets', question: 'Garder la barre d’onglets en haut ?', multiSelect: false,
          allowOther: true, secret: false,
          options: [{ label: 'En haut', description: '', preview: null }, { label: 'En bas, au pouce', description: '', preview: null }],
        }],
      },
    },
  },
  {
    tier: 'blocked', key: 'blocked:c-plan', conversationId: PLAN.id, conversationTitle: PLAN.title,
    projectId: null, since: now - 30 * MINUTE, conversation: PLAN,
    request: {
      kind: 'plan', requestId: 'plan-1', requestedAt: now - 30 * MINUTE,
      event: { type: 'plan.review_requested', requestId: 'plan-1', plan: '1. Relire\n2. Publier' },
    } as Extract<ForYouRequest, { tier: 'blocked' }>['request'],
  },
  {
    tier: 'decision', key: PENDING.id, conversationId: PENDING.conversationId, conversationTitle: PENDING.conversationTitle,
    projectId: 'p1', since: PENDING.createdAt,
    awaiting: {
      kind: 'decision', id: PENDING.id, conversationId: PENDING.conversationId, projectId: 'p1',
      conversationTitle: PENDING.conversationTitle, question: PENDING.question, worktreeBranch: null,
      expiresAt: PENDING.expiresAt, createdAt: PENDING.createdAt,
    },
  },
  {
    tier: 'accord', key: 'r-cards', conversationId: 'c-cards', conversationTitle: 'Historique de la conversation',
    projectId: 'p1', since: now - 2 * MINUTE,
    awaiting: {
      kind: 'request_card_change', id: 'r-cards', conversationId: 'c-cards', projectId: 'p1',
      conversationTitle: 'Historique de la conversation', count: 2, createdAt: now - 2 * MINUTE,
    },
  },
  {
    tier: 'accord', key: 'r-move', conversationId: 'c-move', conversationTitle: 'Idées pour le lot 3',
    projectId: null, since: now - 50 * MINUTE,
    awaiting: {
      kind: 'move_conversation', id: 'r-move', conversationId: 'c-move', projectId: null,
      conversationTitle: 'Idées pour le lot 3', createdAt: now - 50 * MINUTE,
    },
  },
]

/** L'événement que le serveur rend pour déplier un accord. */
const CARD_FILING: AwaitingRequestEntryDto = {
  conversationId: 'c-cards',
  seq: 12,
  ts: now - 2 * MINUTE,
  event: {
    type: 'card_filing.requested',
    requestId: 'r-cards',
    cards: [
      { cardId: 'k118', number: 118, title: 'Ranger une conversation', fromColumn: 'review', toColumn: 'done', reason: 'PR fusionnée et publiée.' },
      { cardId: 'k119', number: 119, title: 'Cycle de vie des demandes', fromColumn: 'review', toColumn: 'done', reason: 'PR fusionnée et publiée.' },
    ],
  },
}

const FILING: AwaitingRequestEntryDto = {
  conversationId: 'c-move',
  seq: 4,
  ts: now - 50 * MINUTE,
  event: {
    type: 'filing.requested', requestId: 'r-move', conversationId: 'c-move', conversationTitle: 'Idées pour le lot 3',
    projectId: 'p1', projectName: 'Solera', worktree: null, card: null, resumable: true,
  },
}

/** Pose la décision et les accords dans le cache avant le premier rendu. */
export function SeededForYou({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(['decision', PENDING.id], PENDING)
    client.setQueryData(['awaiting-request', 'r-cards'], CARD_FILING)
    client.setQueryData(['awaiting-request', 'r-move'], FILING)
    return null
  })
  return <>{children}</>
}
