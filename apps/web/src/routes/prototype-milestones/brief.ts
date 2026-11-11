/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Ce que l'agent d'affinage « voit » dans ce que Tim écrit pour un jalon : une lecture
 * simple et visible, pour que le pied du champ dise ce qui va se passer. En vrai, c'est
 * l'agent qui juge (il lit aussi le projet) ; ici, une heuristique tient sa place :
 *
 * - les **étapes** : les lignes de liste (`-`, `*`, `1.`) et les titres `##`, hors des
 *   sections « contraintes » et « hors champ » ;
 * - les **contraintes** : les lignes d'une section « contraintes », ou qui disent « doit »,
 *   « ne pas », « sans » ;
 * - le **hors champ** : les lignes d'une section « hors champ » / « pas dans ce jalon » ;
 * - un **objectif** : une ligne ou une section qui commence par « objectif » / « but » ;
 * - les **points ouverts** : les lignes qui finissent par « ? » ou disent « à décider ».
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

type Section = 'steps' | 'constraints' | 'out' | 'objective' | 'other'

const SECTION_PATTERNS: [Section, RegExp][] = [
  ['constraints', /^(contraintes?|exigences?|r[eè]gles?)\b/i],
  ['out', /^(hors[- ]champ|hors p[ée]rim[eè]tre|pas dans ce jalon|non[- ]objectifs?)\b/i],
  ['objective', /^(objectifs?|but|cible)\b/i],
  ['steps', /^([ée]tapes?|plan|t[âa]ches?|livrables?|d[ée]coupage)\b/i],
]

function clean(line: string): string {
  return line
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '')
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .trim()
}

export function readBrief(text: string): BriefReading {
  const lines = text.split('\n').map((line) => line.trimEnd())
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const steps: string[] = []
  const constraints: string[] = []
  const outOfScope: string[] = []
  const openPoints: string[] = []
  let objective: string | null = null
  let section: Section = 'other'

  // Le premier titre est celui du jalon, pas une étape.
  const firstIndex = lines.findIndex((line) => line.trim())
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (!line) continue
    if (index === firstIndex && /^#\s|^##\s/.test(line)) continue
    const content = clean(line)
    const heading = /^#+\s/.test(line) || /:\s*$/.test(line)
    const headingText = content.replace(/:\s*$/, '')
    const matched = SECTION_PATTERNS.find(([, pattern]) => pattern.test(headingText))

    if (matched && (heading || headingText.length < 40)) {
      section = matched[0]
      // « Objectif : rendre X » sur une seule ligne.
      const rest = content.replace(matched[1], '').replace(/^\s*[:—-]\s*/, '').trim()
      if (matched[0] === 'objective' && rest) objective = rest
      if (rest && matched[0] !== 'objective') (matched[0] === 'constraints' ? constraints : matched[0] === 'out' ? outOfScope : steps).push(rest)
      continue
    }

    if (/\?\s*$/.test(content) || /\b[àa] d[ée]cider\b/i.test(content)) {
      // Un point ouvert n'est ni une étape, ni une contrainte, ni du hors champ.
      openPoints.push(content)
      continue
    }

    const listItem = /^\s*(?:[-*+•]|\d+[.)])\s+/.test(raw)
    const subHeading = /^#{2,}\s/.test(line)
    if (section === 'constraints' && listItem) constraints.push(content)
    else if (section === 'out' && listItem) outOfScope.push(content)
    else if (section === 'objective' && !objective) objective = content
    else if (listItem || subHeading) {
      if (/\b(doit|ne (?:doit|pas)|sans)\b/i.test(content) && section !== 'steps') constraints.push(content)
      else if (!/\?\s*$/.test(content)) steps.push(content)
    } else if (/^(objectif|but)\b/i.test(content)) objective = content.replace(/^(objectif|but)\s*[:—-]?\s*/i, '')
  }

  const sufficient = steps.length >= 2 || (objective !== null && words >= 60)
  return { words, steps, constraints, outOfScope, objective, openPoints, sufficient }
}

/** Le titre d'un jalon tiré de ce qu'on a écrit : le premier titre, sinon la première phrase. */
export function titleFromBrief(text: string): string {
  const first = text.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  const title = first.replace(/^#+\s*/, '').replace(/\*\*/g, '').split(/(?<=[.!?])\s/)[0]!.replace(/[.:]\s*$/, '')
  return title.length > 70 ? `${title.slice(0, 67).trimEnd()}…` : title || 'Nouveau jalon'
}

/** Ce que le pied du champ annonce, en une phrase et ce qui a été repéré. */
export function announce(reading: BriefReading): { mode: 'empty' | 'phrase' | 'brief'; line: string; spotted: string | null } {
  if (reading.words === 0) return { mode: 'empty', line: 'Écris une phrase, ou colle ton brief.', spotted: null }
  const parts: string[] = []
  if (reading.objective) parts.push('un objectif')
  if (reading.steps.length) parts.push(`${reading.steps.length} étape${reading.steps.length > 1 ? 's' : ''}`)
  if (reading.constraints.length) parts.push(`${reading.constraints.length} contrainte${reading.constraints.length > 1 ? 's' : ''}`)
  if (reading.outOfScope.length) parts.push(`${reading.outOfScope.length} hors champ`)
  if (reading.openPoints.length) parts.push(`${reading.openPoints.length} point${reading.openPoints.length > 1 ? 's' : ''} ouvert${reading.openPoints.length > 1 ? 's' : ''}`)
  const spotted = parts.length ? `Repéré : ${parts.join(', ')}.` : null
  if (reading.sufficient) {
    return {
      mode: 'brief',
      line: reading.openPoints.length
        ? 'Brief détaillé : l’agent proposera directement un découpage, après une question sur ce qui reste ouvert.'
        : 'Brief détaillé : l’agent proposera directement un découpage.',
      spotted,
    }
  }
  return { mode: 'phrase', line: 'Une phrase : l’agent lira le projet, puis te posera d’abord quelques questions.', spotted }
}

/** Les questions qu'un agent poserait sur une phrase seule, accordées à ce qu'elle dit. */
export function questionsForPhrase(title: string): { id: string; text: string }[] {
  const lower = title.toLocaleLowerCase('fr')
  const subject = title.replace(/[.!?]\s*$/, '')
  const questions: { id: string; text: string }[] = [
    { id: 'cible', text: `« ${subject} » : à quoi verras-tu que c'est fini ? Le cas d'usage qui doit marcher de bout en bout.` },
  ]
  if (/hors[- ]?ligne|offline|sync/.test(lower)) {
    questions.push({ id: 'portee', text: 'Hors ligne pour quoi exactement : lire seulement, ou aussi écrire et resynchroniser après ?' })
  } else if (/partag|équipe|equipe|collab|membre/.test(lower)) {
    questions.push({ id: 'portee', text: 'Qui partage quoi : tout le projet, ou seulement certaines vues ? Avec quels droits ?' })
  } else if (/ui|page|écran|ecran|interface|vue/.test(lower)) {
    questions.push({ id: 'portee', text: 'Quelles pages sont concernées, et y a-t-il une maquette ou un prototype à suivre ?' })
  } else {
    questions.push({ id: 'portee', text: 'Qu’est-ce qui est dans le périmètre, et qu’est-ce qui ne l’est pas ?' })
  }
  questions.push({ id: 'ordre', text: 'Une échéance à tenir, ou une partie à livrer d’abord ?' })
  return questions
}

export interface DraftSeed {
  key: string
  title: string
  after: string[]
  subtasks?: string[]
}

/** Un découpage tiré des étapes du brief, enchaînées dans l'ordre où elles sont écrites. */
export function draftFromSteps(steps: string[], constraints: string[]): DraftSeed[] {
  const keys = 'abcdefghijklmnopqrstuvwxyz'
  const seeds = steps.slice(0, 8).map((step, index) => ({
    key: keys[index]!,
    title: step.length > 80 ? `${step.slice(0, 77).trimEnd()}…` : step,
    // La première part seule ; les suivantes attendent la précédente, sauf si l'étape se
    // dit parallèle (« en parallèle », « indépendamment »).
    after: index === 0 || /parall[eè]le|ind[ée]pendam/i.test(step) ? [] : [keys[index - 1]!],
    subtasks: [] as string[],
  }))
  // Les contraintes deviennent des sous-tâches de vérification de la dernière carte.
  if (seeds.length && constraints.length) seeds[seeds.length - 1]!.subtasks = constraints.slice(0, 5).map((line) => `Vérifier : ${line}`)
  return seeds
}

/** Un découpage tiré d'une phrase et des réponses aux questions. */
export function draftFromAnswers(title: string, answers: Record<string, string>): DraftSeed[] {
  const subject = title.replace(/[.!?]\s*$/, '')
  const cible = answers.cible?.trim()
  return [
    { key: 'a', title: `Modèle et données : ${subject}`, after: [], subtasks: cible ? [`Couvrir : ${cible}`] : [] },
    { key: 'b', title: `Serveur et API : ${subject}`, after: ['a'] },
    { key: 'c', title: `Interface : ${subject}`, after: ['b'], subtasks: answers.portee ? [`Périmètre : ${answers.portee}`] : [] },
    { key: 'd', title: 'Tests de bout en bout et documentation', after: ['c'], subtasks: cible ? [`Scénario : ${cible}`] : [] },
  ]
}

/** Les mots qui comptent d'un texte, pour rapprocher un ajout des cartes d'un jalon. */
export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase('fr')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3 && !STOP.has(word)),
  )
}

const STOP = new Set(['avec', 'pour', 'dans', 'plus', 'faut', 'faire', 'cette', 'carte', 'cartes', 'jalon', 'aussi', 'quand', 'sans', 'tout', 'tous', 'etre', 'avoir', 'comme', 'mais', 'donc', 'leur'])
