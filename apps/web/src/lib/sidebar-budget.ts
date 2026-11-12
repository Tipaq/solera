import type { ConversationDto } from '@solera/protocol'

/**
 * Combien de sessions la colonne montre par liste — le réglage « Sessions dans la
 * sidebar » (SID-6 à SID-8) et les calculs qui le servent. Tout est pur ici : la colonne
 * mesure, ce module décide.
 *
 * - `fit` (défaut) : autant qu'il en tient sans faire défiler la colonne, au large ; le
 *   reste se compte dans la ligne « Toutes les sessions… » de chaque groupe ;
 * - 10 / 20 / 50 : ce nombre, et le bloc qui défile prend le relais.
 *
 * Dans tous les cas, la session ouverte et celles qui t'attendent restent affichées.
 */
export type SessionLimit = 'fit' | 10 | 20 | 50

export const SESSION_LIMITS: readonly SessionLimit[] = ['fit', 10, 20, 50]

/** Le budget d'une liste quand on ne mesure pas : au téléphone, et avant la première mesure. */
export const DEFAULT_BUDGET = 10

/** Sous ce nombre de sessions visibles, l'Activité se replie pour leur rendre la place. */
export const MIN_SESSIONS = 5

/** Ce que vaut la valeur stockée ; une valeur inconnue retombe sur le défaut. */
export function parseSessionLimit(raw: string | null): SessionLimit {
  if (raw === '10' || raw === '20' || raw === '50') return Number(raw) as SessionLimit
  return 'fit'
}

/** Une session qui ne se cache jamais : l'ouverte, et celles qui attendent une réponse. */
export function mustShow(entry: Pick<ConversationDto, 'id' | 'status'>, openId: string | null | undefined): boolean {
  return entry.id === openId || entry.status === 'awaiting_input' || entry.status === 'error'
}

/**
 * Coupe une liste ordonnée au budget, sans jamais retirer une session à garder : elles
 * comptent dans le budget, et le reste se remplit dans l'ordre.
 */
export function cutToBudget<T extends Pick<ConversationDto, 'id' | 'status'>>(
  entries: readonly T[],
  budget: number,
  openId: string | null | undefined,
): T[] {
  const kept = entries.filter((entry) => mustShow(entry, openId)).length
  let room = Math.max(0, budget - kept)
  return entries.filter((entry) => {
    if (mustShow(entry, openId)) return true
    if (room <= 0) return false
    room -= 1
    return true
  })
}

/** Une mesure de la colonne, prise après un rendu. */
export interface FitMeasure {
  /** Le budget avec lequel la colonne vient d'être rendue. */
  budget: number
  /** La hauteur du contenu moins celle de la colonne : positive quand elle déborde. */
  overflow: number
  /** La hauteur d'une ligne de session (36 px, 44 au doigt). */
  rowHeight: number
  /** Les listes de sessions affichées, et parmi elles celles que le budget coupe. */
  lists: number
  cutLists: number
}

/**
 * « Ajuster à la hauteur » : le budget suivant. Mesuré et non calculé — on retire autant
 * de lignes que le débord en couvre, ou l'on en rajoute autant que la place en laisse,
 * partagées entre les listes coupées ; puis la colonne se remesure. Un budget rendu tel
 * quel veut dire que la mesure est stable.
 *
 * Rajouter ne se fait que si une liste est coupée : sinon tout est déjà là. Et sans liste
 * de sessions (un lieu qui n'en montre pas), le débord n'est pas l'affaire du budget.
 */
export function fitStep({ budget, overflow, rowHeight, lists, cutLists }: FitMeasure): number {
  if (lists === 0 || rowHeight <= 0) return budget
  if (overflow > 0) return Math.max(0, budget - Math.ceil(overflow / rowHeight))
  if (cutLists > 0 && -overflow >= rowHeight) return budget + Math.floor(-overflow / rowHeight / cutLists)
  return budget
}

/**
 * Le repli de l'Activité, une fois le budget stable. Dépliée, elle garde son quart de
 * colonne tant qu'au moins `MIN_SESSIONS` sessions tiennent sous elle ; sinon elle se
 * réduit à son en-tête, comme au téléphone. Repliée, elle se redéplie quand la place
 * qu'elle reprendrait (`gain`) laisserait encore `MIN_SESSIONS` sessions — l'écart entre
 * les deux seuils évite le clignotement.
 */
export function activityFold({ collapsed, budget, cutLists, overflow, rowHeight, gain }: Omit<FitMeasure, 'lists'> & {
  collapsed: boolean
  /** Ce que l'Activité dépliée prend de plus que repliée ; 0 quand elle est dépliée. */
  gain: number
}): boolean {
  if (!collapsed) return cutLists > 0 && budget < MIN_SESSIONS
  // Rien de coupé : il suffit que la place libre couvre l'Activité dépliée.
  const fits = cutLists === 0
    ? -overflow >= gain
    : budget - Math.ceil(gain / rowHeight) >= MIN_SESSIONS
  return !fits
}
