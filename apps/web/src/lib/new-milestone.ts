import type { CardRefinementDto } from '@solera/protocol'
import { announce, type BriefReading } from './brief'
import type { MessageKey } from './i18n'
import type { Maturity } from './milestone-model'
import { refinePrompt, refineSessionHref } from './refinement'

/**
 * Le tiroir « Nouveau jalon » (#193, spec jalons CMP) sans son rendu : ce que chacun de
 * ses trois gestes fait du jalon, ce qui les retient, et ce que la création écrit.
 */

/** Les trois gestes : noter l'idée, l'affiner avec un agent, la découper directement. */
export type MilestoneIntent = 'note' | 'refine' | 'split'

/** L'étape où le jalon entre selon le geste (CMP-6, CMP-9). */
export const ENTRY_STAGE: Record<MilestoneIntent, Maturity> = { note: 'idea', refine: 'refine', split: 'refine' }

/** Le geste principal, celui de `⌘/Ctrl+Entrée` : découper si le brief suffit, sinon affiner (CMP-7). */
export function primaryIntent(reading: BriefReading): MilestoneIntent {
  return reading.sufficient ? 'split' : 'refine'
}

/** Ce qui retient un geste, en clé à traduire ; `null` s'il peut partir (CMP-8). */
export function gestureBlock(intent: MilestoneIntent, reading: BriefReading): MessageKey | null {
  if (reading.words === 0) return 'milestones.composer.why.empty'
  if (intent === 'split' && !reading.sufficient) return 'milestones.composer.why.insufficient'
  return null
}

const AGENT_LINE: Record<'phrase' | 'brief' | 'briefOpen', MessageKey> = {
  phrase: 'milestones.composer.agent.phrase',
  brief: 'milestones.composer.agent.brief',
  briefOpen: 'milestones.composer.agent.briefOpen',
}

/**
 * Ce que fera l'agent, en une ligne du pied (CMP-9, CMP-10) : l'annonce du brief sans son
 * en-tête (« Une phrase : »), puisque la pastille d'étape la précède ; rien ne part d'une
 * idée notée ; sans texte, l'invitation à écrire.
 */
export function agentLine(intent: MilestoneIntent, reading: BriefReading): MessageKey {
  const said = announce(reading)
  if (said.mode === 'empty') return said.key
  if (intent === 'note') return 'milestones.composer.agent.note'
  return AGENT_LINE[said.mode === 'phrase' ? 'phrase' : reading.openPoints.length ? 'briefOpen' : 'brief']
}

/**
 * La description du jalon créé (CMP-15) : le texte sans sa première ligne si c'est un
 * titre `#` — il est devenu le titre de la carte —, puis ses liens sous `heading`.
 */
export function milestoneDescription(text: string, links: readonly string[], heading: string): string {
  const lines = text.split('\n')
  const first = lines.findIndex((line) => line.trim())
  if (first >= 0 && /^#\s/.test(lines[first]!.trim())) lines.splice(first, 1)
  const body = lines.join('\n').trim()
  if (links.length === 0) return body
  const list = `**${heading}**\n${links.map((link) => `- ${link}`).join('\n')}`
  return body ? `${body}\n\n${list}` : list
}

/**
 * Où mène « Affiner » ou « Découper » une fois le jalon créé (CMP-14) : un brouillon de
 * découpage rattaché à la carte, dont le premier message invoque le skill avec le brief
 * et ce qu'on y a joint — ou sa session d'affinage, si elle en a déjà une.
 */
export function milestoneHref(
  projectId: string,
  card: { id: string; number: number; refinement: Pick<CardRefinementDto, 'conversationId'> | null },
  intent: Exclude<MilestoneIntent, 'note'>,
  joined: { brief: string; cards?: { number: number; include: boolean }[]; links?: string[] },
): string {
  const mode = intent === 'split' ? 'direct' : 'questions'
  return refineSessionHref(projectId, card, mode, refinePrompt({ number: card.number, mode, ...joined }))
}
