import type { ActivityGroup } from './activity-groups'

/**
 * La vue « Par état » de Travail (`projet.md` T-8) : les sessions rangées en colonnes.
 * « T'attend » est la liste des demandes, tenue à part ; restent Travaille, À relire et
 * Terminées récemment, que ce module tire des sessions déjà filtrées par la page.
 *
 * Pur : les tests le lisent seul.
 */

/** Trois jours : au-delà, une session finie n'est plus « récente ». */
export const RECENT_DONE_DAYS = 3
/** Une colonne de terminées qui défilerait sans fin ne se lirait plus. */
export const RECENT_DONE_MAX = 12

const DAY = 86_400_000

/** Ce que la vue lit d'une session : son groupe, sa dernière activité, son archivage. */
export interface BoardFacts {
  group: ActivityGroup
  entry: { conversation: { updatedAt: number; archivedAt: number | null } }
}

/**
 * Les trois colonnes de sessions, dans l'ordre reçu (la plus récente d'abord) ; les
 * terminées sont celles des trois derniers jours, non archivées, douze au plus.
 */
export function stateColumns<R extends BoardFacts>(rows: R[], now: number): { working: R[]; review: R[]; done: R[] } {
  const since = now - RECENT_DONE_DAYS * DAY
  const done = rows
    .filter((row) => row.group === 'done' && row.entry.conversation.archivedAt === null && row.entry.conversation.updatedAt >= since)
    .sort((a, b) => b.entry.conversation.updatedAt - a.entry.conversation.updatedAt)
    .slice(0, RECENT_DONE_MAX)
  return {
    working: rows.filter((row) => row.group === 'running'),
    review: rows.filter((row) => row.group === 'review'),
    done,
  }
}
