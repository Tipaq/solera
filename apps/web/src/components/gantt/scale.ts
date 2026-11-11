/**
 * La géométrie du Gantt, sans React ni DOM : la fenêtre de temps, où tombe un instant,
 * l'étendue d'une barre, le tracé des flèches « bloque » et la chaîne qu'on éclaire au
 * survol. Partagée par l'horizon des jalons, le Gantt détaillé et le portefeuille, et
 * testée seule (`apps/server/test/gantt-scale.test.ts`).
 */

export const DAY = 86_400_000

/** L'échelle du temps : un jour par colonne, ou une vue d'ensemble qui tient dans la largeur. */
export type Zoom = 'week' | 'month'

/** Pixels par jour du zoom, avant étirement. Le zoom mois n'y revient que non mesuré. */
const PX_PER_DAY: Record<Zoom, number> = { week: 30, month: 8 }
/** En zoom mois, en deçà, les jours deviennent illisibles : on défile plutôt. */
const MONTH_MIN_PPD = 3
/** Marge après la plus lointaine échéance, avant d'arrondir au lundi. */
const END_MARGIN: Record<Zoom, number> = { week: 2, month: 4 }

export interface Scale {
  /** Lundi, minuit local : le bord gauche. */
  from: number
  /** Lundi, minuit local : le bord droit, exclu. */
  to: number
  /** Pixels par jour. */
  ppd: number
  width: number
  /** L'abscisse d'un instant. */
  x: (at: number) => number
}

/** Ce qu'une barre a besoin de savoir d'une carte. */
export interface Span {
  createdAt: number
  dueAt: number | null
}

export function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** `days` jours de calendrier plus tard : un jour de 23 h ou de 25 h reste un jour. */
function addDays(at: number, days: number): number {
  const date = new Date(at)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

/** Le lundi de la semaine de `at`, à minuit. */
function mondayOf(at: number): number {
  const date = new Date(startOfDay(at))
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.getTime()
}

/**
 * L'écart entre deux instants tel que l'horloge murale le lit, en jours : au passage à
 * l'heure d'hiver, le dimanche dure 25 h, et un écart brut placerait chaque minuit
 * suivant une heure trop à droite, entre deux colonnes.
 */
function wallDays(from: number, at: number): number {
  const shift = (new Date(from).getTimezoneOffset() - new Date(at).getTimezoneOffset()) * 60_000
  return (at - from + shift) / DAY
}

/**
 * La fenêtre : de la plus ancienne création à la plus lointaine échéance, aujourd'hui
 * compris, calée sur des semaines entières — et serrée à droite : une semaine de marge
 * au plus, pour qu'il ne reste pas un mois de vide après la dernière date.
 *
 * Au moins `minWidth` : une fenêtre courte s'étire au lieu de laisser un vide à droite.
 * Le zoom semaine garde ses 30 px par jour et défile si la période est longue ; le zoom
 * mois est la vue d'ensemble, il tient dans la largeur tant qu'un jour garde 3 px.
 */
export function scaleOf(cards: readonly Span[], zoom: Zoom, now = Date.now(), minWidth = 0): Scale {
  const starts = cards.map((card) => card.createdAt)
  const ends = cards.flatMap((card) => (card.dueAt === null ? [] : [card.dueAt]))
  const from = mondayOf(addDays(Math.min(now, ...starts), -1))
  const to = addDays(mondayOf(addDays(Math.max(now, ...ends), END_MARGIN[zoom])), 7)
  const days = Math.round(wallDays(from, to))
  const fit = minWidth > 0 ? minWidth / days : 0
  const ppd = zoom === 'month' && fit > 0 ? Math.max(MONTH_MIN_PPD, fit) : Math.max(PX_PER_DAY[zoom], fit)
  return { from, to, ppd, width: Math.round(days * ppd), x: (at: number) => wallDays(from, at) * ppd }
}

/**
 * Les minuits de la fenêtre, un par jour. Par le calendrier et non par pas de 24 h : au
 * passage à l'heure d'hiver, un pas de 24 h retombe à 23 h la veille, et la boucle
 * comptait un jour de trop — une semaine entière dessinée après la fin de l'axe.
 */
export function daysOf(scale: Pick<Scale, 'from' | 'to'>): number[] {
  const days: number[] = []
  for (let day = startOfDay(scale.from); day < scale.to; day = addDays(day, 1)) days.push(day)
  return days
}

/** Les mois que couvrent ces jours : du premier jour visible au lendemain du dernier. */
export function monthsOf(days: readonly number[]): { at: number; end: number }[] {
  const months: { at: number; end: number }[] = []
  for (const day of days) {
    const last = months[months.length - 1]
    if (!last || new Date(day).getDate() === 1) months.push({ at: day, end: addDays(day, 1) })
    else last.end = addDays(day, 1)
  }
  return months
}

export function isWeekend(at: number): boolean {
  const day = new Date(at).getDay()
  return day === 0 || day === 6
}

/** Numéro de semaine ISO : celle qui contient le premier jeudi de l'année est la 1re. */
export function isoWeek(at: number): number {
  const thursday = new Date(startOfDay(at))
  thursday.setDate(thursday.getDate() + 3 - ((thursday.getDay() + 6) % 7))
  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7))
  return 1 + Math.round(wallDays(firstThursday.getTime(), thursday.getTime()) / 7)
}

/** Début et fin d'une carte : création → échéance, ou → aujourd'hui sans échéance. */
export function barOf(card: Span, now = Date.now()): { start: number; end: number; loose: boolean } {
  if (card.dueAt === null) return { start: card.createdAt, end: Math.max(card.createdAt + DAY, now), loose: true }
  return { start: Math.min(card.createdAt, card.dueAt - DAY), end: card.dueAt, loose: false }
}

/* ------------------------------------------------------------------ étiquette */

/** Marge intérieure d'une barre, de chaque côté du titre. */
export const BAR_PAD = 8
/** Écart entre la barre (ou son retard) et un titre posé à côté. */
export const LABEL_GAP = 6

/**
 * Où poser le titre d'une barre : dedans s'il y tient en entier, sinon à droite, entier
 * lui aussi — un libellé tronqué en « … » ne se lit pas. À droite, il ne doit pas sortir
 * de l'axe (il élargirait le conteneur qui défile) : quand il déborderait, il passe à
 * gauche de la barre.
 */
export function labelPlacement({
  left,
  width,
  overdue,
  label,
  extra,
  axisWidth,
}: {
  left: number
  width: number
  /** Le prolongement hachuré du retard, après la barre. */
  overdue: number
  /** Largeur mesurée du titre. */
  label: number
  /** Ce que la barre porte déjà devant le titre (le point d'une session vivante). */
  extra: number
  axisWidth: number
}): 'inside' | 'right' | 'left' {
  if (label + BAR_PAD * 2 + extra <= width) return 'inside'
  return left + width + overdue + LABEL_GAP + label > axisWidth ? 'left' : 'right'
}

/* ------------------------------------------------------------------ flèches */

export interface Anchor {
  x1: number
  y1: number
  x2: number
  y2: number
  /** La carte qui bloque, et celle qui attend : de quoi éclairer une chaîne au survol. */
  from: string
  to: string
}

/** Ce que les flèches et la chaîne lisent d'une carte. */
export interface Linked extends Span {
  id: string
  blockedBy: readonly { id: string }[]
}

/** Les ancres des liens entre cartes visibles, à partir de leur ligne (centre vertical). */
export function anchorsOf(cards: readonly Linked[], centerY: ReadonlyMap<string, number>, scale: Pick<Scale, 'x'>, now = Date.now()): Anchor[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const anchors: Anchor[] = []
  for (const card of cards) {
    const y2 = centerY.get(card.id)
    if (y2 === undefined) continue
    for (const blocker of card.blockedBy) {
      const source = byId.get(blocker.id)
      const y1 = centerY.get(blocker.id)
      if (!source || y1 === undefined) continue
      anchors.push({ x1: scale.x(barOf(source, now).end), y1, x2: scale.x(barOf(card, now).start), y2, from: source.id, to: card.id })
    }
  }
  return anchors
}

/** Sortie horizontale de la bloquante avant le premier coude. */
const ARROW_OUT = 8
/** Recul avant la bloquée quand la flèche fait le tour. */
const ARROW_BACK = 10
/** En deçà, pas la place de descendre droit entre les deux barres. */
const ARROW_ROOM = 18

/**
 * Les points d'une flèche, en coudes : de la fin de la bloquante au début de la
 * bloquée. Quand la bloquée commence avant la fin de sa bloquante, la flèche fait le
 * tour par l'interligne plutôt que de traverser les barres. La pointe s'arrête un pixel
 * avant la barre.
 */
export function arrowPoints({ x1, y1, x2, y2 }: Pick<Anchor, 'x1' | 'y1' | 'x2' | 'y2'>): [number, number][] {
  const out = x1 + ARROW_OUT
  if (x2 - x1 >= ARROW_ROOM) return [[x1, y1], [out, y1], [out, y2], [x2 - 1, y2]]
  const middle = (y1 + y2) / 2
  const back = x2 - ARROW_BACK
  return [[x1, y1], [out, y1], [out, middle], [back, middle], [back, y2], [x2 - 1, y2]]
}

/** Un tracé SVG orthogonal à coins arrondis, à travers les points donnés. */
export function elbow(points: readonly [number, number][], radius = 5): string {
  let d = `M${points[0]![0]},${points[0]![1]}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const [px, py] = points[index - 1]!
    const [x, y] = points[index]!
    const [nx, ny] = points[index + 1]!
    const r = Math.min(radius, Math.abs(x - px + y - py) / 2, Math.abs(nx - x + ny - y) / 2)
    d += ` L${x - Math.sign(x - px) * r},${y - Math.sign(y - py) * r} Q${x},${y} ${x + Math.sign(nx - x) * r},${y + Math.sign(ny - y) * r}`
  }
  const last = points[points.length - 1]!
  return `${d} L${last[0]},${last[1]}`
}

/**
 * La chaîne d'une carte : elle, tout ce qui la bloque en remontant, tout ce qu'elle
 * bloque en descendant — pas ses voisines par un bloqueur commun. C'est ce qui
 * s'éclaire au survol. `null` au repos.
 */
export function chainOf(cards: readonly Pick<Linked, 'id' | 'blockedBy'>[], id: string | null): ReadonlySet<string> | null {
  if (id === null) return null
  const byId = new Map(cards.map((card) => [card.id, card]))
  const blocks = new Map<string, string[]>()
  for (const card of cards) {
    for (const blocker of card.blockedBy) blocks.set(blocker.id, [...(blocks.get(blocker.id) ?? []), card.id])
  }
  const seen = new Set<string>([id])
  const walk = (next: (at: string) => string[]) => {
    const stack = [id]
    while (stack.length) {
      for (const other of next(stack.pop()!)) {
        if (seen.has(other)) continue
        seen.add(other)
        stack.push(other)
      }
    }
  }
  walk((at) => (byId.get(at)?.blockedBy ?? []).map((blocker) => blocker.id).filter((other) => byId.has(other)))
  walk((at) => blocks.get(at) ?? [])
  return seen
}
