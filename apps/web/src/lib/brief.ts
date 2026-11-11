import type { MessageKey } from './i18n'

/**
 * Ce que l'agent d'affinage « voit » dans ce qu'on écrit pour un jalon : une lecture
 * simple et visible, pour que le pied du champ dise ce qui va se passer. C'est l'agent
 * qui juge en vrai (il lit aussi le projet) ; cette lecture ne sert qu'à l'annoncer.
 *
 * - les **étapes** : les lignes de liste (`-`, `*`, `1.`) et les sous-titres `##`, hors
 *   des sections « contraintes » et « hors champ » ;
 * - les **contraintes** : les lignes d'une section « Contraintes », ou les lignes de
 *   liste qui disent « doit », « ne pas », « sans » ;
 * - le **hors champ** : les lignes d'une section « Hors champ » / « Pas dans ce jalon » ;
 * - un **objectif** : une section ou une ligne qui commence par « Objectif » / « But » ;
 * - les **points ouverts** : les lignes qui finissent par « ? » ou disent « à décider ».
 *
 * Les motifs sont français **et** anglais, toujours les deux : on colle souvent un brief
 * écrit ailleurs, dans l'autre langue que celle de l'interface.
 *
 * Un brief **suffit** pour découper sans questions s'il porte au moins deux étapes, ou
 * un objectif et assez de matière (60 mots).
 */

export interface BriefReading {
  words: number
  steps: string[]
  constraints: string[]
  outOfScope: string[]
  objective: string | null
  openPoints: string[]
  /** Assez de matière pour proposer un découpage sans questions préalables. */
  sufficient: boolean
}

type Section = 'steps' | 'constraints' | 'out' | 'objective'

const SECTION_PATTERNS: [Section, RegExp][] = [
  ['constraints', /^(contraintes?|exigences?|r[eè]gles?|constraints?|requirements?|rules?)\b/i],
  ['out', /^(hors[- ]champ|hors p[ée]rim[eè]tre|pas dans ce jalon|non[- ]objectifs?|out[- ]of[- ]scope|non[- ]goals?|not in this milestone)\b/i],
  ['objective', /^(objectifs?|but|cible|goals?|objectives?|aim)\b/i],
  ['steps', /^([ée]tapes?|plan|t[âa]ches?|livrables?|d[ée]coupage|steps?|tasks?|deliverables?|breakdown)\b/i],
]

/** « doit », « ne pas », « sans » ; « must », « do not », « without ». */
const MUST = /\b(doit|doivent|ne (?:doit|pas)|sans|must|do(?:es)? not|don't|without)\b/i
/** `\b` ne voit pas le bord d'un « à » : la limite de mot se dit en lettres Unicode. */
const UNDECIDED = /(?<![\p{L}\p{N}])([àa] d[ée]cider|to be decided|tbd)(?![\p{L}\p{N}])/iu
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/
const WORDS_FOR_OBJECTIVE = 60

function clean(line: string): string {
  return line.replace(LIST_ITEM, '').replace(/^#+\s*/, '').replace(/\*\*/g, '').trim()
}

/** La section qu'une ligne ouvre, et ce qui la suit sur la même ligne. */
function sectionOf(raw: string): { section: Section; rest: string } | null {
  const line = raw.trim()
  if (LIST_ITEM.test(raw)) return null
  const content = clean(line)
  const heading = /^#+\s/.test(line) || /:\s*$/.test(line)
  const text = content.replace(/:\s*$/, '')
  const matched = SECTION_PATTERNS.find(([, pattern]) => pattern.test(text))
  // Une phrase qui commence par « Plan » n'ouvre pas une section : il faut un titre, ou
  // une ligne courte (« Objectif : tenir la charge »).
  if (!matched || !(heading || text.length < 40)) return null
  const rest = text.replace(matched[1], '').replace(/^\s*[:—–-]\s*/, '').trim()
  return { section: matched[0], rest }
}

export function readBrief(text: string): BriefReading {
  const lines = text.split('\n').map((line) => line.trimEnd())
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const steps: string[] = []
  const constraints: string[] = []
  const outOfScope: string[] = []
  const openPoints: string[] = []
  let objective: string | null = null
  let section: Section | null = null

  // Le premier titre est celui du jalon, pas une étape — sauf s'il ouvre une section :
  // un brief qui commence par « ## Objectif » n'a pas de titre.
  const firstIndex = lines.findIndex((line) => line.trim())
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (!line) continue
    const opened = sectionOf(raw)
    if (index === firstIndex && /^#{1,2}\s/.test(line) && !opened) continue
    const content = clean(line)

    if (opened) {
      section = opened.section
      const { rest } = opened
      if (rest && section === 'objective') objective = rest
      else if (rest) (section === 'constraints' ? constraints : section === 'out' ? outOfScope : steps).push(rest)
      continue
    }

    if (/\?\s*$/.test(content) || UNDECIDED.test(content)) {
      // Un point ouvert n'est ni une étape, ni une contrainte, ni du hors champ.
      openPoints.push(content)
      continue
    }

    const listItem = LIST_ITEM.test(raw)
    const subHeading = /^#{2,}\s/.test(line)
    if (section === 'constraints' && listItem) constraints.push(content)
    else if (section === 'out' && listItem) outOfScope.push(content)
    else if (section === 'objective' && !objective) objective = content
    else if (listItem || subHeading) {
      if (section !== 'steps' && MUST.test(content)) constraints.push(content)
      else steps.push(content)
    }
  }

  const sufficient = steps.length >= 2 || (objective !== null && words >= WORDS_FOR_OBJECTIVE)
  return { words, steps, constraints, outOfScope, objective, openPoints, sufficient }
}

const TITLE_MAX = 70

/**
 * Le titre d'un jalon tiré de ce qu'on a écrit : le premier titre, sinon la première
 * phrase ; une ligne qui ouvre une section (« ## Objectif ») est passée. Vide sans texte.
 */
export function titleFromBrief(text: string): string {
  const first = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !sectionOf(line)) ?? ''
  const title = first
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .split(/(?<=[.!?])\s/)[0]!
    .replace(/[.:]\s*$/, '')
    .trim()
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 3).trimEnd()}…` : title
}

export type AnnounceMode = 'empty' | 'phrase' | 'brief'

/** Ce que le pied du champ annonce : une clé, que le composant traduit. */
export function announce(reading: BriefReading): { mode: AnnounceMode; key: MessageKey } {
  if (reading.words === 0) return { mode: 'empty', key: 'brief.announce.empty' }
  if (reading.sufficient) {
    return { mode: 'brief', key: reading.openPoints.length ? 'brief.announce.briefOpen' : 'brief.announce.brief' }
  }
  return { mode: 'phrase', key: 'brief.announce.phrase' }
}

export interface SpottedChip {
  key: MessageKey
  count: number
}

/** Les puces « Repéré » : ce que la lecture a trouvé, puis ce qui est joint. */
export function spottedChips(reading: BriefReading, joined: { cards: number; links: number; files: number }): SpottedChip[] {
  const chips: SpottedChip[] = []
  const plural = (prefix: 'steps' | 'constraints' | 'openPoints' | 'cards' | 'links' | 'files', count: number) => {
    if (count > 0) chips.push({ key: `brief.chip.${prefix}.${count > 1 ? 'many' : 'one'}`, count })
  }
  if (reading.objective) chips.push({ key: 'brief.chip.objective', count: 1 })
  plural('steps', reading.steps.length)
  plural('constraints', reading.constraints.length)
  if (reading.outOfScope.length) chips.push({ key: 'brief.chip.outOfScope', count: reading.outOfScope.length })
  plural('openPoints', reading.openPoints.length)
  plural('cards', joined.cards)
  plural('links', joined.links)
  plural('files', joined.files)
  return chips
}
