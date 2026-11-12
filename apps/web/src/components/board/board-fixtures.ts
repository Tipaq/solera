import type { CardConversationDto, CardDto } from '@solera/protocol'
import { boardModel } from '../../lib/board-model'
import { PROJECT_ID, fixtureCard } from './card-fixtures'

/*
 * Un Tableau de démonstration pour les stories de la tuile et du Kanban : trois jalons,
 * des cartes sans jalon, chaque drapeau qu'une tuile sait montrer, et une carte bloquée.
 */

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()

const link = (card: CardDto) => ({ id: card.id, number: card.number, title: card.title, column: card.column })

const session = (id: string, agent: CardConversationDto['agent'], status: CardConversationDto['status']): CardConversationDto => ({
  id, title: `Session ${id}`, agent, status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: now - DAY,
})

/** `parent` reçoit `kids`, liés dans les deux sens comme le serveur les rend. */
function adopt(parent: CardDto, kids: CardDto[]): CardDto[] {
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  parent.milestone = true
  return [parent, ...kids]
}

const card = (number: number, title: string, column: CardDto['column'], extra: Partial<CardDto> = {}) =>
  fixtureCard(number, title, column, { columnSince: now - number * 3600_000, updatedAt: now - number * 3600_000, ...extra })

export const BOARD_CARDS: CardDto[] = [
  ...adopt(card(136, 'Jalon — Environnements d’exécution : dev container et confinement des sessions', 'in_progress', { dueAt: now + 9 * DAY }), [
    card(137, 'Lire le devcontainer.json du dépôt', 'done'),
    card(138, 'Lancer une session dans le conteneur', 'in_progress', {
      description: '- [x] Image\n- [x] Montage du worktree\n- [ ] Réseau\n- [ ] Ports',
      conversations: [session('a', 'claude', 'awaiting_input')],
    }),
    card(139, 'Confiner les services du projet', 'todo', { toClarifySince: now - DAY }),
    card(140, 'Documenter les limites du confinement', 'review', { conversations: [session('b', 'codex', 'running')] }),
  ]),
  ...adopt(card(164, 'Page projet v2 · 2 — Aperçu, Travail, Tableau', 'in_progress'), [
    card(180, 'Tableau : barre une ligne, Kanban réel, couloirs par jalon', 'in_progress', {
      description: '- [x] Modèle\n- [ ] Kanban\n- [ ] Couloirs',
      conversations: [session('c', 'claude', 'running'), session('d', 'grok', 'running')],
    }),
    card(181, 'Tableau : vues « Liste » et « Par geste »', 'todo', { dueAt: now - 2 * DAY }),
    card(174, 'Aperçu : phare des jalons', 'done'),
    card(175, 'Travail : l’onglet, la barre et la vue « Par moment »', 'done'),
    card(176, 'Travail : arbres et branches', 'done'),
  ]),
  ...adopt(card(157, 'Page projet v2 · 1 — Socle commun', 'done'), [card(160, 'Coque commune', 'done'), card(162, 'Barre d’outils sur une ligne', 'done')]),
  card(201, 'Le menu du compte déborde sur mobile', 'todo', { acceptedAt: null }),
  card(202, 'Le test des téléchargements est instable', 'review'),
  card(203, 'Renommer « Board » en « Tableau » dans l’aide', 'done'),
  card(204, 'Idée : un tableau par personne', 'abandoned'),
  card(205, 'Idée de jalon : mode hors ligne', 'todo', { milestone: true }),
  card(206, 'Montrer les vues du Tableau dans l’aide', 'todo', {
    blockedBy: [{ id: 'card-180', number: 180, title: 'Tableau : barre une ligne, Kanban réel, couloirs par jalon', column: 'in_progress' }],
  }),
]

export const BOARD = boardModel(BOARD_CARDS)

export const boardEntry = (number: number) => BOARD.cards.find((entry) => entry.card.number === number)!

export { PROJECT_ID }
