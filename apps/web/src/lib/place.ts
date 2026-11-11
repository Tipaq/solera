import { CARD_CLOSED_COLUMNS, type CardDto } from '@solera/protocol'

/**
 * Le paramètre par lequel une vue ouvre son propre dialogue de création.
 *
 * Le bouton qui crée (*+ Carte* dans la barre du Tableau, *+ Tâche* en tête des
 * Planifiées, un lien de la palette) écrit l'intention dans l'adresse, la vue la lit.
 * Une autre voie aurait été de faire remonter un gestionnaire depuis la page, ce qui
 * demande un contexte, un effet et un ordre de montage ; celle-ci survit en plus à un
 * rechargement et se partage par lien.
 */
export const NEW_PARAM = 'nouvelle'

/**
 * Le compte de l'onglet Tableau : les cartes **ouvertes**, pas l'inventaire.
 *
 * « 9 » doit dire ce qui reste à faire, et compter le cimetière ferait monter le nombre
 * à mesure qu'on avance. Les feuilles seulement, comme le kanban : une parente
 * compterait deux fois le travail de ses enfants.
 */
export function openLeafCount(cards: readonly Pick<CardDto, 'children' | 'column'>[] | undefined): number {
  return (cards ?? []).filter((card) => card.children.length === 0 && !CARD_CLOSED_COLUMNS.includes(card.column)).length
}

/**
 * L'adresse où mène une ancienne vue, sa requête gardée : un lien partagé vers
 * `/activity?groupe=worktree` doit ouvrir le même regroupement sous `/travail`.
 * `force` impose des paramètres par-dessus ceux de l'ancienne adresse.
 */
export function movedView(to: string, search: string, force: Record<string, string> = {}): string {
  const params = new URLSearchParams(search)
  for (const [key, value] of Object.entries(force)) params.set(key, value)
  const query = params.toString()
  return query ? `${to}?${query}` : to
}
