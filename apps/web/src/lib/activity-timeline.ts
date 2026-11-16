import type { AgentKind } from '@solera/protocol'
import type { ActivityGroup } from './activity-groups'

/**
 * La Frise de Travail (`projet.md` T-9) : la fenêtre de temps, ses graduations, et les
 * barres des sessions d'un arbre. Les positions sont des fractions de la fenêtre (0 à
 * 1) ; le composant les pose en pourcentage.
 *
 * Pur : les tests le lisent seul.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Sans période dans « Filtrer », la frise montre une semaine. */
export const TIMELINE_DEFAULT_DAYS = 7
/** Au-delà, les dates de l'axe se chevauchent. */
export const TIMELINE_MAX_TICKS = 14
/** Une graduation plus à droite se tairait sous « maintenant ». */
const LABEL_LIMIT = 0.9

export interface TimelineWindow {
  from: number
  to: number
}

/**
 * La fenêtre : du début de la période choisie, sinon d'il y a sept jours, jusqu'à
 * maintenant. Une heure au moins, pour qu'« Aujourd'hui », juste après minuit, ne
 * tienne pas dans un point.
 */
export function timelineWindow(periodFrom: number | null, now: number): TimelineWindow {
  const from = periodFrom ?? now - TIMELINE_DEFAULT_DAYS * DAY
  return { from, to: Math.max(now, from + HOUR) }
}

/** Où tombe un instant dans la fenêtre, borné aux deux bouts. */
export function positionOf(at: number, window: TimelineWindow): number {
  return Math.min(1, Math.max(0, (at - window.from) / (window.to - window.from)))
}

export interface Tick {
  at: number
  left: number
  /** Datée ; sinon sa ligne seule, trop près de « maintenant ». */
  labelled: boolean
  /** Datée aussi au téléphone, où l'axe n'a la place que de trois dates. */
  compact: boolean
}

/** Au téléphone : trois dates, et pas sous « maintenant », qui y prend plus de place. */
const COMPACT_TICKS = 3
const COMPACT_LIMIT = 0.65

/**
 * Les graduations : les minuits du lecteur dans la fenêtre, un sur N pour en garder
 * quatorze au plus, en partant du plus récent. Des jours entiers plutôt que des
 * tranches égales : une date se lit comme une journée qui commence.
 */
export function timelineTicks(window: TimelineWindow, max = TIMELINE_MAX_TICKS): Tick[] {
  const midnights: number[] = []
  const day = new Date(window.to)
  day.setHours(0, 0, 0, 0)
  // Reculer par le calendrier, pas de 24 h : un jour de changement d'heure en dure 23 ou 25.
  while (day.getTime() >= window.from) {
    midnights.unshift(day.getTime())
    day.setDate(day.getDate() - 1)
  }
  const step = Math.max(1, Math.ceil(midnights.length / max))
  const ticks = midnights
    .filter((_, index) => (midnights.length - 1 - index) % step === 0)
    .map((at) => {
      const left = positionOf(at, window)
      return { at, left, labelled: left <= LABEL_LIMIT }
    })
  // Au téléphone, une date sur N parmi celles qui ont la place, en partant de la plus récente.
  const roomy = ticks.filter((tick) => tick.left <= COMPACT_LIMIT)
  const compactStep = Math.max(1, Math.ceil(roomy.length / COMPACT_TICKS))
  const compact = new Set(roomy.filter((_, index) => (roomy.length - 1 - index) % compactStep === 0))
  return ticks.map((tick) => ({ ...tick, compact: compact.has(tick) }))
}

/** Ce qu'une barre lit d'une session. */
export interface BarFacts {
  id: string
  title: string
  agent: AgentKind
  group: ActivityGroup
  createdAt: number
  updatedAt: number
}

export type BarTone = 'running' | 'awaiting' | 'done'

export interface SessionBar {
  id: string
  title: string
  agent: AgentKind
  tone: BarTone
  start: number
  end: number
  /** La ligne, 0 ou 1 : deux barres voisines ne se couvrent pas. */
  lane: 0 | 1
}

/** Au-delà, une rangée de 40 px n'est plus qu'un trait. */
export const MAX_BARS = 8

/**
 * Les barres des sessions d'un arbre : de la création à la dernière mise à jour, ou à
 * maintenant tant qu'elle tourne ou t'attend. Les huit plus récentes qui touchent la
 * fenêtre, rangées dans l'ordre du temps et alternées sur deux lignes.
 */
export function sessionBars(sessions: BarFacts[], window: TimelineWindow, now: number, max = MAX_BARS): SessionBar[] {
  return sessions
    .map((session) => {
      const tone: BarTone = session.group === 'running' ? 'running' : session.group === 'asking' ? 'awaiting' : 'done'
      const end = tone === 'done' ? session.updatedAt : now
      return { session, tone, end }
    })
    .filter(({ end }) => end >= window.from)
    .sort((a, b) => b.end - a.end)
    .slice(0, max)
    .map(({ session, tone, end }) => ({
      id: session.id,
      title: session.title,
      agent: session.agent,
      tone,
      start: Math.max(session.createdAt, window.from),
      end,
    }))
    .sort((a, b) => a.start - b.start)
    .map((bar, index) => ({ ...bar, lane: (index % 2) as 0 | 1 }))
}
