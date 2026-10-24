import type { CardDto } from '@solera/protocol'

const DAY = 86_400_000

/** Ce qu'une barre occupe sur l'axe, en pourcentage de la fenêtre. */
export interface Span {
  left: number
  width: number
}

/**
 * Une carte parente, avec ses enfants : ce que la chronologie appelle un jalon.
 *
 * Un jalon n'est pas un type (carte #83) : c'est une carte qui a des enfants, et une
 * échéance le plus souvent. Le jeu des jalons se déduit donc de la liste des cartes,
 * sans second appel. Chaque parente fait sa ligne, quelle que soit sa profondeur.
 */
export interface Milestone {
  card: CardDto
  /** Les cartes qui s'y rattachent, les plus urgentes d'abord. */
  cards: CardDto[]
  /** Avancement : combien de ses cartes sont sorties du board. */
  done: number
}

/**
 * Les identifiants des cartes qui ont des enfants.
 *
 * Les vues qui les montrent **en tant que jalon** doivent les retirer de leurs listes
 * de cartes, sinon elles s'y lisent deux fois : une ligne de la chronologie *et* une
 * barre dedans, un titre de tuile *et* une échéance en dessous.
 */
export function milestoneIdsOf(cards: CardDto[]): Set<string> {
  const ids = new Set<string>()
  for (const card of cards) if (card.parent !== null) ids.add(card.parent.id)
  return ids
}

/** Les jalons d'un jeu de cartes, dans l'ordre de leur date, les sans-date en dernier. */
export function milestonesOf(cards: CardDto[]): Milestone[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const grouped = new Map<string, CardDto[]>()
  for (const card of cards) {
    // `card.parent` est la parente résolue par le serveur — titre et numéro compris, ce
    // qui évite d'avoir à la retrouver quand elle n'est pas dans ce jeu.
    if (card.parent === null) continue
    const bucket = grouped.get(card.parent.id)
    if (bucket) bucket.push(card)
    else grouped.set(card.parent.id, [card])
  }

  return [...grouped.entries()]
    .flatMap(([id, attached]) => {
      const card = byId.get(id)
      // Un jalon d'un autre projet, ou supprimé : la désignation survit à la cascade,
      // la ligne non. Sans ce garde, la chronologie afficherait une ligne sans titre.
      if (!card) return []
      return [{
        card,
        cards: [...attached].sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)),
        done: attached.filter((entry) => entry.column === 'done').length,
      }]
    })
    .sort((a, b) => (a.card.dueAt ?? Infinity) - (b.card.dueAt ?? Infinity))
}

/**
 * La fenêtre de l'axe : une semaine avant la première date, une semaine après la
 * dernière, et au moins six semaines.
 *
 * Bornée par les données et non fixée à « les huit prochaines semaines » : un projet
 * dont tout est en retard ne doit pas ouvrir sa chronologie sur un axe vide à droite de
 * ce qu'il y a à voir. Le minimum évite l'inverse — deux cartes datées du même jour
 * donneraient une fenêtre d'un jour, où tout se superpose.
 */
export function windowOf(dates: number[]): { from: number; to: number } {
  const now = Date.now()
  const known = dates.filter((date) => Number.isFinite(date))
  const first = Math.min(now, ...known)
  const last = Math.max(now, ...known)
  const from = first - 7 * DAY
  const to = Math.max(last + 7 * DAY, from + 42 * DAY)
  return { from, to }
}

/** Place un intervalle sur la fenêtre, rogné à ses bords. */
export function spanOf(from: number, to: number, start: number, end: number): Span {
  const total = to - from
  const left = Math.max(0, Math.min(100, ((start - from) / total) * 100))
  const right = Math.max(0, Math.min(100, ((end - from) / total) * 100))
  // Une largeur plancher : une carte créée et due le même jour donnerait une barre de
  // zéro pixel, c'est-à-dire rien — et « rien » se lit comme « pas de carte ».
  return { left, width: Math.max(right - left, 1.5) }
}

/**
 * Les deux bouts d'une carte sur l'axe.
 *
 * Une carte n'a **qu'une** date, son échéance : il n'y a pas de date de début, et on ne
 * va pas en inventer une. Le début est donc sa création, qui est un fait, et la barre
 * dit « depuis quand ce travail existe, et pour quand il est promis ».
 *
 * Sans échéance, la barre court jusqu'à aujourd'hui et se dessine en pointillé : elle ne
 * promet rien, elle constate. C'est la lecture que la maquette F4 demande.
 */
export function cardSpan(card: CardDto, at = Date.now()): {
  start: number
  end: number
  /** Sans échéance : la barre ne promet rien. */
  loose: boolean
  /** Échéance dépassée, et la carte est encore ouverte. */
  late: boolean
} {
  const open = card.column !== 'done' && card.column !== 'abandoned'
  if (card.dueAt === null) {
    return { start: card.createdAt, end: Math.max(card.createdAt, at), loose: true, late: false }
  }
  return {
    start: Math.min(card.createdAt, card.dueAt),
    end: card.dueAt,
    loose: false,
    late: open && card.dueAt < at,
  }
}

/**
 * Les bouts d'un jalon : du plus ancien de ses travaux à sa propre échéance.
 *
 * Le portefeuille montre des jalons et non des cartes (F10), et un jalon qui n'aurait
 * que sa date serait un point, pas une barre — or ce qu'on veut lire là est « lequel est
 * chargé, et si deux livraisons tombent la même semaine ».
 */
export function milestoneSpan(milestone: Milestone, at = Date.now()): {
  start: number
  end: number
  loose: boolean
  late: boolean
  /** Toutes ses cartes sont sorties : la livraison est faite. */
  delivered: boolean
} {
  const starts = [milestone.card.createdAt, ...milestone.cards.map((card) => card.createdAt)]
  const start = Math.min(...starts)
  const delivered = milestone.cards.length > 0 && milestone.done === milestone.cards.length
  const due = milestone.card.dueAt
  if (due === null) return { start, end: Math.max(start, at), loose: true, late: false, delivered }
  return { start, end: Math.max(due, start), loose: false, late: !delivered && due < at, delivered }
}

/**
 * Les graduations de l'axe, par semaine, calées sur un lundi.
 *
 * Par semaine et pas par jour : à six semaines de fenêtre, quarante-deux étiquettes de
 * date ne se lisent plus, et l'œil n'a pas besoin du jour pour situer une barre.
 */
export function ticksOf(from: number, to: number): number[] {
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  // `getDay()` rend 0 pour dimanche : le décalage ramène au lundi précédent.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const ticks: number[] = []
  for (let at = start.getTime(); at <= to; at += 7 * DAY) {
    if (at >= from) ticks.push(at)
  }
  return ticks
}

/**
 * Les cartes qu'aucune chronologie ne peut montrer : ni jalon, ni échéance.
 *
 * Comptées en pied de vue plutôt que tues. Une chronologie qui les omet en silence ment
 * par omission — on y lit « voilà le travail », alors qu'on n'en voit qu'une part.
 */
export function unplacedOf(cards: CardDto[]): CardDto[] {
  return cards.filter(
    (card) =>
      card.parent === null &&
      card.dueAt === null &&
      card.column !== 'done' &&
      card.column !== 'abandoned',
  )
}
