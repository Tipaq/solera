import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AwaitingRequestDto, DecisionDto, InAppNotification } from '@solera/protocol'
import { AWAITING_KEY, openDecision } from '../../lib/decisions'
import { dismissToast, pushToast } from '../../lib/toasts'

/**
 * Les décisions de démonstration du catalogue : une session qui demande, une réponse
 * déjà donnée, et la colonne « À décider » qui les résume avec deux rangements.
 */

const HOUR = 3_600_000
const now = Date.now()

/** Le cas complet : un contexte en markdown, trois choix, un défaut. */
export const PENDING: DecisionDto = {
  id: 'd1',
  projectId: 'p1',
  projectName: 'Solera',
  conversationId: 'c1',
  conversationTitle: 'Monter vite en 7.0',
  card: { number: 77, title: 'Porter les décisions de Sillage' },
  question: 'Monter vite en 7.0 maintenant, ou attendre la 7.0.1 ?',
  context:
    "Les tests passent sur la branche, mais deux plugins affichent un **avertissement de dépréciation** :\n\n- `@vitejs/plugin-react` ;\n- `vite-plugin-pwa`.\n\nLa 7.0.1 est annoncée pour la semaine prochaine.",
  options: ['Monter maintenant', 'Attendre la 7.0.1', 'Abandonner la montée'],
  defaultOption: 'Attendre la 7.0.1',
  expiresAt: now + 11 * HOUR,
  status: 'pending',
  answer: null,
  createdAt: now - HOUR,
}

/** Une question ouverte : ni choix, ni défaut, la réponse s'écrit. */
export const OPEN_QUESTION: DecisionDto = {
  ...PENDING,
  id: 'd2',
  conversationTitle: 'Relire le site',
  card: null,
  question: 'Quelle phrase pour présenter Solera en tête du site ?',
  context: '',
  options: [],
  defaultOption: null,
  expiresAt: now + 40 * 60_000,
}

export const ANSWERED: DecisionDto = {
  ...PENDING,
  id: 'd3',
  status: 'user',
  answer: {
    option: 'Monter maintenant',
    text: 'Vérifie les avertissements des plugins avant de pousser.',
    byName: 'Tim',
    at: now - 20 * 60_000,
  },
}

export const DEFAULTED: DecisionDto = {
  ...PENDING,
  id: 'd4',
  status: 'default',
  answer: { option: 'Attendre la 7.0.1', text: null, byName: null, at: now - 2 * HOUR },
}

export const EXPIRED: DecisionDto = {
  ...OPEN_QUESTION,
  id: 'd5',
  status: 'expired',
  answer: { option: null, text: null, byName: null, at: now - 2 * HOUR },
}

export const WITHDRAWN: DecisionDto = { ...PENDING, id: 'd6', status: 'withdrawn', answer: null }

export const DECISIONS = [PENDING, OPEN_QUESTION, ANSWERED, DEFAULTED, EXPIRED, WITHDRAWN]

/** Ce que la colonne liste : deux décisions, un rangement de cartes, un de conversation. */
export const AWAITING: AwaitingRequestDto[] = [
  {
    kind: 'decision', id: PENDING.id, conversationId: PENDING.conversationId, projectId: 'p1',
    question: PENDING.question, expiresAt: PENDING.expiresAt, createdAt: PENDING.createdAt,
  },
  {
    kind: 'decision', id: OPEN_QUESTION.id, conversationId: 'c2', projectId: 'p1',
    question: OPEN_QUESTION.question, expiresAt: OPEN_QUESTION.expiresAt, createdAt: now - 2 * HOUR,
  },
  {
    kind: 'request_card_move', id: 'r1', conversationId: 'c3', projectId: 'p1',
    conversationTitle: 'Ranger le board après la release', count: 3, createdAt: now - 3 * HOUR,
  },
  {
    kind: 'move_conversation', id: 'r2', conversationId: 'c4', projectId: null,
    conversationTitle: 'Idées pour le lot 3', createdAt: now - 5 * HOUR,
  },
]

/** De quoi faire déborder la colonne : sept demandes. */
export const AWAITING_MANY: AwaitingRequestDto[] = [
  ...AWAITING,
  ...[1, 2, 3].map((n): AwaitingRequestDto => ({
    kind: 'decision', id: `extra-${n}`, conversationId: `c-extra-${n}`, projectId: 'p1',
    question: `Question ${n} d'une tâche planifiée de nuit`, expiresAt: now + (n + 2) * HOUR, createdAt: now - n * HOUR,
  })),
]

export const DECISION_TOAST: InAppNotification = {
  kind: 'decision',
  decisionId: PENDING.id,
  question: PENDING.question,
  conversationId: PENDING.conversationId,
  conversationTitle: PENDING.conversationTitle,
  projectName: PENDING.projectName,
}

export const CLI_TOAST: InAppNotification = {
  kind: 'cliRequest',
  request: 'permission',
  conversationId: 'c5',
  projectId: 'p1',
  conversationTitle: 'Nettoyer les worktrees',
  detail: 'Bash · git worktree prune',
}

export const QUESTION_TOAST: InAppNotification = {
  kind: 'cliRequest',
  request: 'question',
  conversationId: 'c6',
  projectId: null,
  conversationTitle: 'Préparer la note de version',
  detail: 'Quel ton pour la note : sobre ou enjoué ?',
}

const TOAST_IDS = ['decision:d1', 'cli:c5', 'cli:c6']

/**
 * Pose les décisions et la colonne dans le cache, les toasts dans leur pile, et ouvre
 * un dialogue, avant le premier rendu de la story. Les deux magasins hors de React
 * (toasts, décision ouverte) survivent d'une story à l'autre : on les remet à zéro.
 */
export function SeededDecisions({ awaiting = AWAITING, open = null, toasts = [], children }: {
  awaiting?: AwaitingRequestDto[]
  open?: string | null
  toasts?: InAppNotification[]
  children: ReactNode
}) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(AWAITING_KEY, awaiting)
    for (const decision of DECISIONS) client.setQueryData(['decision', decision.id], decision)
    for (const id of TOAST_IDS) dismissToast(id)
    for (const toast of toasts) pushToast(toast)
    openDecision(open)
    return null
  })
  useEffect(() => () => openDecision(null), [])
  return <>{children}</>
}
