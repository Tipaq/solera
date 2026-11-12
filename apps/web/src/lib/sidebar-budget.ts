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

/** Un budget essayé, et le débord qu'il a donné. */
export interface FitProbe {
  budget: number
  overflow: number
}

/** Ce que la colonne retient d'une mesure à l'autre, sans rendre pour autant. */
export interface FitMemory {
  /** Le plus grand budget essayé qui tient, et le plus petit qui déborde. */
  fits: FitProbe | null
  overflows: FitProbe | null
  /** La hauteur de l'Activité dépliée, mesurée la dernière fois qu'elle l'était. */
  fullActivity: number
  /** La hauteur de colonne où l'Activité vient de se redéplier. */
  reopenedAt: number | null
  /**
   * La hauteur de colonne où, redépliée, elle a dû se replier aussitôt. Oubliée dès que
   * la colonne mesure autrement : une autre hauteur, d'autres sessions.
   */
  stuckAt: number | null
}

export const FIT_MEMORY: FitMemory = { fits: null, overflows: null, fullActivity: 0, reopenedAt: null, stuckAt: null }

/** Une mesure de la colonne, avec l'état de l'Activité qui l'a produite. */
export interface FitReading extends FitMeasure {
  collapsed: boolean
  /** La hauteur de la colonne : elle change, et ce qu'on en savait ne vaut plus. */
  column: number
  /** La hauteur de l'Activité telle que rendue, `null` si la colonne n'en a pas. */
  activity: number | null
}

/**
 * Le budget suivant, borné par ce qu'on a déjà essayé : jamais au-dessus d'un budget
 * qui a débordé, jamais en dessous d'un budget qui a tenu.
 *
 * `fitStep` suppose qu'un cran coûte une ligne. Il en coûte souvent plus : une session
 * peut ouvrir une tranche de jour, avec son en-tête (#262). Sans bornes, la mesure
 * oscille alors entre un budget qui déborde et un autre qui laisse une ligne libre ;
 * avec elles, l'intervalle se resserre à chaque passe et la recherche s'arrête.
 *
 * Les bornes valent pour une colonne donnée. Un budget déjà essayé qui ne donne plus le
 * même débord, ou un budget hors des bornes, dit qu'elle a changé (redimensionnée, des
 * sessions en plus) : la recherche repart de cette mesure seule, et `changed` le dit.
 */
function fitSearch(
  memory: FitMemory,
  measure: FitMeasure,
): Pick<FitMemory, 'fits' | 'overflows'> & { budget: number; changed: boolean } {
  const { budget, overflow } = measure
  if (measure.lists === 0 || measure.rowHeight <= 0) return { budget, fits: null, overflows: null, changed: false }
  const { fits, overflows } = memory
  const known = [fits, overflows].find((probe) => probe?.budget === budget)
  const inside = (!fits || budget >= fits.budget) && (!overflows || budget <= overflows.budget)
  const changed = !inside || (!!known && known.overflow !== overflow)
  const kept = changed ? { fits: null, overflows: null } : { fits, overflows }
  const probe = { budget, overflow }
  const bounds = overflow > 0 ? { ...kept, overflows: probe } : { ...kept, fits: probe }
  const low = bounds.fits?.budget ?? 0
  const high = bounds.overflows ? bounds.overflows.budget - 1 : Infinity
  return { ...bounds, changed, budget: Math.max(0, Math.min(Math.max(fitStep(measure), low), high)) }
}

/**
 * « Ajuster à la hauteur », une passe : le budget et le repli de l'Activité à rendre
 * après cette mesure, et ce qu'il faut en retenir. Rendus tels quels, la colonne est
 * stable.
 *
 * L'Activité ne se décide qu'une fois le budget stable. Replier ou déplier change la
 * colonne : la recherche du budget repart de zéro. Et si, redépliée, elle doit se
 * replier aussitôt — `activityFold` estime en crans ce que coûte la place rendue, et des
 * sessions qui attendent n'en libèrent aucune —, elle reste repliée tant que la colonne
 * mesure pareil.
 */
export function fitNext(memory: FitMemory, reading: FitReading): { budget: number; collapsed: boolean; memory: FitMemory } {
  const { budget, fits, overflows, changed } = fitSearch(memory, reading)
  const searched = { ...memory, fits, overflows, stuckAt: changed ? null : memory.stuckAt }
  if (budget !== reading.budget || reading.activity === null) {
    return { budget, collapsed: reading.collapsed, memory: searched }
  }

  const fullActivity = reading.collapsed ? memory.fullActivity : reading.activity
  const gain = reading.collapsed ? fullActivity - reading.activity : 0
  let collapsed = activityFold({ ...reading, gain })
  let { reopenedAt, stuckAt } = searched
  if (reading.collapsed && !collapsed) {
    if (stuckAt === reading.column) collapsed = true
    else reopenedAt = reading.column
  } else if (!reading.collapsed) {
    if (collapsed && reopenedAt === reading.column) stuckAt = reading.column
    reopenedAt = null
  }
  const moved = collapsed !== reading.collapsed
  return {
    budget,
    collapsed,
    memory: { fits: moved ? null : fits, overflows: moved ? null : overflows, fullActivity, reopenedAt, stuckAt },
  }
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
