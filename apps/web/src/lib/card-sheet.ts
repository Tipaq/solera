import type { CardConversationDto, CardDto, CardNoteDto, ConversationStatus } from '@solera/protocol'
import type { StatusOf } from './card-state'

/*
 * La fiche d'une carte **sur place** (#199, spec jalons FCH) : ce que les vues hors du
 * board ouvrent par-dessus elles, sans quitter la page. Ici, ce qui se décide sans React —
 * l'adresse, les sessions qu'elle montre, la case « C'est un jalon ».
 */

/** L'état de la fiche est dans l'adresse, comme `?carte=` au board : un lien partagé la rouvre. */
export const CARD_SHEET_PARAM = 'fiche'

/** Le numéro de la carte dont la fiche est ouverte, ou `null`. */
export function sheetNumber(params: URLSearchParams): number | null {
  const raw = params.get(CARD_SHEET_PARAM)
  if (!raw || !/^\d+$/.test(raw)) return null
  const number = Number(raw)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

/** Ouvre la fiche de `number`, ou la ferme avec `null`, sans toucher aux autres paramètres. */
export function withSheet(params: URLSearchParams, number: number | null): URLSearchParams {
  const next = new URLSearchParams(params)
  if (number === null) next.delete(CARD_SHEET_PARAM)
  else next.set(CARD_SHEET_PARAM, String(number))
  return next
}

/** Les sessions que la fiche montre : les archivées n'y sont pas, la plus récente vient d'abord. */
export function sheetSessions(card: Pick<CardDto, 'conversations'>): CardConversationDto[] {
  return card.conversations.filter((entry) => entry.archivedAt === null).sort((a, b) => b.createdAt - a.createdAt)
}

export type { StatusOf }

/** La session qui attend une réponse, à laquelle la fiche répond sur place. */
export function waitingSession(sessions: CardConversationDto[], statusOf: StatusOf): CardConversationDto | undefined {
  return sessions.find((entry) => statusOf(entry) === 'awaiting_input')
}

/** Ce qui réclame le plus d'abord : t'attend, puis en erreur, puis tourne. */
const ACTIVITY: Partial<Record<ConversationStatus, number>> = { awaiting_input: 0, error: 1, running: 2 }

/**
 * La session qu'« Ouvrir la session » ouvre : la plus active, sinon la plus récente.
 * `sessions` est dans l'ordre de `sheetSessions`, la plus récente d'abord.
 */
export function leadSession(sessions: CardConversationDto[], statusOf: StatusOf): CardConversationDto | undefined {
  let lead: CardConversationDto | undefined
  let rank = Number.POSITIVE_INFINITY
  for (const entry of sessions) {
    const own = ACTIVITY[statusOf(entry)] ?? Number.POSITIVE_INFINITY
    if (own < rank) {
      lead = entry
      rank = own
    }
  }
  return lead ?? sessions[0]
}

/**
 * La case « C'est un jalon » (FLG-1). Le serveur tient la règle — un jalon n'a jamais de
 * parente, et une carte qui a des enfants en est un d'office — et refuse en 409 ce qui
 * la contredit ; la case ne fait que ne pas le proposer.
 */
export interface MilestoneFlagState {
  checked: boolean
  disabled: boolean
  /** Pourquoi la case est ce qu'elle est : l'infobulle le dit. */
  reason: 'children' | 'parent' | 'free'
}

export function milestoneFlag(card: Pick<CardDto, 'parent' | 'children' | 'milestone'>): MilestoneFlagState {
  if (card.children.length > 0) return { checked: true, disabled: true, reason: 'children' }
  if (card.parent !== null) return { checked: false, disabled: true, reason: 'parent' }
  return { checked: card.milestone, disabled: false, reason: 'free' }
}

/* Les mêmes expressions que `parseSubtasks` : une ligne que la section Sous-tâches montre
   est une ligne que la description ne montre plus, ni plus ni moins. */
const SUBTASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+/
const CODE_FENCE = /^\s*(?:```|~~~)/

/** La description sans ses cases à cocher, blocs de code gardés tels quels. */
export function descriptionProse(text: string): string {
  let inCode = false
  return text
    .split('\n')
    .filter((line) => {
      if (CODE_FENCE.test(line)) {
        inCode = !inCode
        return true
      }
      return inCode || !SUBTASK_LINE.test(line)
    })
    .join('\n')
    .trim()
}

/** Les notes que la fiche montre, les plus récentes d'abord, et combien la carte en a. */
export function recentNotes(notes: CardNoteDto[] | undefined, count = 3): { shown: CardNoteDto[]; total: number } {
  const all = notes ?? []
  return { shown: [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, count), total: all.length }
}
