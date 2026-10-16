import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  JOURNAL_DEFAULT_DAYS,
  JOURNAL_FAMILIES,
  JOURNAL_FAMILY_OF,
  type JournalDto,
  type JournalEntryDto,
  type JournalFamily,
  type JournalKind,
} from '@solera/protocol'
import { api } from './api'

/**
 * Le Journal, d'un projet ou de tous.
 *
 * Une seule requête, et c'est le point : les sept sources sont assemblées et triées par
 * le serveur, parce que deux d'entre elles — les fusions de branche et les audits versés
 * — ne se lisent ni en base ni depuis le navigateur. Les rassembler ici aurait demandé
 * cinq appels, un tri local, et aurait tronqué la fenêtre différemment à chaque fois.
 */
export function useJournal(projectId: string | undefined, days = JOURNAL_DEFAULT_DAYS) {
  const scope = projectId ?? 'all'
  return useQuery({
    queryKey: ['journal', scope, days],
    queryFn: () =>
      api.get<JournalDto>(
        projectId
          ? `/api/projects/${projectId}/journal?days=${days}`
          : `/api/journal?days=${days}`,
      ),
    // Un journal n'est pas un tableau de bord : il regarde en arrière, et la ligne qui
    // vient d'apparaître peut attendre la prochaine ouverture. Plus long que le board
    // (15 s), parce qu'un `git log` par projet se paie à chaque relecture.
    staleTime: 60_000,
  })
}

/**
 * Le filtre bas, en pilules. *Tout* d'abord, puis les quatre familles.
 *
 * Pas de pilule *Décisions*, que la maquette F5 montrait : `card_notes.body` est un
 * champ libre et la carte #32 a refusé de lui donner un type, le 2026-10-15. Un filtre
 * qui prétendrait trier les décisions trierait en réalité ce que les agents auraient
 * bien voulu étiqueter, et un tri auquel on ne peut pas se fier est pire qu'un tri
 * absent. *Notes* la remplace : même source, nom honnête, et c'est bien là que les
 * sessions écrivent ce qu'elles ont tranché.
 *
 * *Dépôt* est la pilule en plus. Sans elle, les fusions et les audits — les deux seules
 * sources qui ne sont pas en base — seraient joignables par *Tout* et par rien d'autre.
 */
export type JournalFilter = 'all' | JournalFamily

export const JOURNAL_FILTERS: readonly JournalFilter[] = ['all', ...JOURNAL_FAMILIES]

export const JOURNAL_FILTER_LABELS = {
  all: 'journal.filter.all',
  notes: 'journal.filter.notes',
  cards: 'journal.filter.cards',
  sessions: 'journal.filter.sessions',
  repo: 'journal.filter.repo',
} as const satisfies Record<JournalFilter, string>

/** Le libellé en petites capitales qui ouvre une ligne, un par nature. */
export const JOURNAL_KIND_LABELS = {
  note: 'journal.kind.note',
  cardOpened: 'journal.kind.cardOpened',
  cardClosed: 'journal.kind.cardClosed',
  session: 'journal.kind.session',
  run: 'journal.kind.run',
  branch: 'journal.kind.branch',
  audit: 'journal.kind.audit',
} as const satisfies Record<JournalKind, string>

/** Un jour de journal, tel que la page l'écrit : un en-tête, puis ses lignes. */
export interface JournalDay {
  /** Minuit local, qui sert de clé et de date à écrire. */
  at: number
  entries: JournalEntryDto[]
}

/**
 * Les lignes retenues, groupées par jour.
 *
 * Le découpage se fait **chez le lecteur** et non au serveur : « aujourd'hui » dépend du
 * fuseau de qui regarde, et un journal rendu avec les jours du serveur ferait commencer
 * la veille à 2 h du matin pour qui voyage. Le serveur ne rend que des instants.
 */
export function useJournalDays(
  entries: JournalEntryDto[] | undefined,
  filter: JournalFilter,
): JournalDay[] {
  return useMemo(() => {
    const kept = (entries ?? []).filter(
      (entry) => filter === 'all' || JOURNAL_FAMILY_OF[entry.kind] === filter,
    )

    const days: JournalDay[] = []
    for (const entry of kept) {
      const at = midnight(entry.at)
      const last = days[days.length - 1]
      // Les lignes arrivent déjà triées du plus récent au plus ancien : comparer au
      // dernier groupe suffit, et aucune table intermédiaire n'est nécessaire.
      if (last && last.at === at) last.entries.push(entry)
      else days.push({ at, entries: [entry] })
    }
    return days
  }, [entries, filter])
}

/** Combien de lignes chaque pilule montrerait : une pilule à zéro s'éteint sans partir. */
export function countByFilter(entries: JournalEntryDto[] | undefined): Record<JournalFilter, number> {
  const totals = { all: 0, notes: 0, cards: 0, sessions: 0, repo: 0 }
  for (const entry of entries ?? []) {
    totals.all += 1
    totals[JOURNAL_FAMILY_OF[entry.kind]] += 1
  }
  return totals
}

function midnight(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
