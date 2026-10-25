import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { CardConversationDto, CardDto, CardIssueCommentsDto, CardNoteDto, ProjectDto } from '@solera/protocol'

/**
 * Un petit board de démonstration, pour les stories de la fiche et de la vue *Projet*.
 *
 * Les deux composants lisent le board par React Query plutôt que par leurs props : la
 * fiche relit la liste pour proposer un jalon, la vue pour dessiner le projet. Les
 * stories préremplissent donc le cache au lieu de simuler le réseau — rien ne part.
 */
export const PROJECT_ID = '00000000-0000-4000-8000-000000000001'
const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 19, 10, 0)

const link = (card: CardDto) => ({ id: card.id, number: card.number, title: card.title, column: card.column })

function session(id: string, title: string, agent: CardConversationDto['agent'], status: CardConversationDto['status'], ago: number): CardConversationDto {
  return { id, title, agent, status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: now - ago }
}

function card(number: number, title: string, column: CardDto['column'], extra: Partial<CardDto> = {}): CardDto {
  return {
    id: `card-${number}`, projectId: PROJECT_ID, number, title, description: '', column, position: number,
    dueAt: null, parent: null, children: [], acceptedAt: now - 3 * DAY, toClarifySince: null, createdBy: 'u1', createdByName: 'Tim', createdAt: now - 3 * DAY, updatedAt: now - DAY, columnSince: now - 2 * DAY,
    conversations: [], attachmentCount: 0, noteCount: 0, references: [], referencedBy: [], blocks: [], blockedBy: [], related: [], duplicateOf: null, duplicates: [], issue: null,
    ...extra,
  }
}

const parent = card(42, 'Gestion de projet', 'in_progress')
const fils = card(21, 'Cliquer « Fils » devrait ouvrir une conversation neuve', 'todo', { toClarifySince: now - DAY })
const gitView = card(29, 'Développer la vue Git du panneau', 'done', { columnSince: now - 2 * DAY })

export const CURRENT = card(27, 'Lire la carte traitée sans quitter la session', 'in_progress', {
  description: 'La carte qu’une session traite n’était qu’une puce `#27` dans le bandeau, et la suivre renvoyait au board — donc hors de la session.\n\n- [x] Rebaser `wip/carte-panneau` sur main\n- [x] typecheck, lint, board-ui\n- [ ] Élargir l’onglet aux tâches du projet\n- [ ] Stories de CardDetail et ProjectPane',
  parent: link(parent),
  blocks: [link(fils)],
  referencedBy: [link(gitView)],
  related: [link(gitView)],
  noteCount: 1,
  conversations: [
    session('c-old', 'Card display dans le right panel', 'claude', 'idle', 6 * DAY),
    session('c-here', 'Onglet projet du panneau', 'claude', 'running', 2 * 60 * 60 * 1000),
  ],
})

/** Un doublon encore ouvert : sa fiche propose de l'abandonner. */
export const DUPLICATE = card(58, 'Ouvrir une conversation neuve depuis « Fils »', 'todo', { duplicateOf: link(fils) })

/** Venue d'une issue GitHub (#84), pas encore triée : elle attend Accepter, Rattacher ou Refuser. */
export const FROM_ISSUE = card(62, 'Le menu du compte déborde sur mobile', 'todo', {
  acceptedAt: null,
  description: 'Sur un écran de 360 px, le menu du compte sort de l’écran. Voir aussi tipaq/solera#12.\n\n*Issue [tipaq/solera#31](https://github.com/tipaq/solera/issues/31), ouverte par @ana.*',
  issue: { provider: 'github', number: '31', url: 'https://github.com/tipaq/solera/issues/31', state: 'open', pending: null, pushError: null },
})

export const ISSUE_COMMENTS: CardIssueCommentsDto = {
  error: null,
  comments: [
    { id: '1', author: 'ana', body: 'Même chose sur iPad en portrait.', url: 'https://github.com/tipaq/solera/issues/31#issuecomment-1', createdAt: now - 2 * DAY },
    { id: '2', author: 'tipaq', body: 'Merci, je regarde avec la refonte du menu.', url: 'https://github.com/tipaq/solera/issues/31#issuecomment-2', createdAt: now - DAY },
  ],
}

export const CARDS: CardDto[] = [
  { ...parent, children: [link(CURRENT), link(fils)] }, CURRENT, { ...fils, duplicates: [link(DUPLICATE)] }, gitView, DUPLICATE,
  card(57, 'Vue Git : trois dettes relevées à la relecture du lot 4', 'review', {
    conversations: [session('c-57', 'Lot 4 : trois dettes', 'codex', 'idle', DAY)],
  }),
  card(1, 'Rendre le design system vérifiable', 'in_progress', {
    conversations: [session('c-1', 'Jetons générés', 'claude', 'running', 3 * 60 * 60 * 1000)],
  }),
  card(19, 'Porter le contexte Savoir', 'in_progress'),
  card(40, 'Dire toujours quelle branche le serveur de dev sert', 'todo'),
  card(41, 'Un CLI introuvable tue le tir en silence', 'todo', { acceptedAt: null }),
  card(56, 'Les modales ouvrent une infobulle qu’on n’a pas demandée', 'todo'),
  FROM_ISSUE,
  card(9, 'Réparer schedule-ui-check', 'done', { columnSince: now - 30 * DAY, updatedAt: now - DAY }),
]

const NOTES: CardNoteDto[] = [{
  id: 'n1', createdAt: now - 5 * DAY,
  body: 'Mis à l’abri sur `wip/carte-panneau` (a093fcd), tel quel : rien n’a été relu ni compilé.',
  author: { kind: 'agent', agent: 'claude', conversationId: 'c-old', conversationTitle: 'Card display dans le right panel' },
}]

const PROJECT = {
  id: PROJECT_ID, name: 'Solera', image: null, workspacePath: '/srv/solera', ownerId: 'u1', ownerName: 'Tim',
  visibility: 'private', color: null, isOwner: true, position: 0, archivedAt: null, createdAt: now - 60 * DAY,
  conversationCount: 12, defaultConfig: {}, instructionsMode: null, activeTerminals: 0, git: null,
} as unknown as ProjectDto

/** Pose le board de démonstration dans le cache avant le premier rendu de la story. */
export function SeededBoard({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(['cards', PROJECT_ID], CARDS)
    client.setQueryData(['projects'], [PROJECT])
    client.setQueryData(['auth', 'me'], { id: 'u1', username: 'tim', displayName: 'Tim', isAdmin: true })
    for (const entry of CARDS) {
      client.setQueryData(['card-notes', entry.id], entry.id === CURRENT.id ? NOTES : [])
      client.setQueryData(['card-attachments', entry.id], [])
      if (entry.issue) client.setQueryData(['card-issue-comments', entry.id], ISSUE_COMMENTS)
    }
    return null
  })
  return <>{children}</>
}
