import type { ToolItem } from '@solera/protocol/chat-state'
import {
  refinementState,
  type CardDraft,
  type CardDto,
  type CardRefinementDto,
  type ConversationStatus,
  type RefinementActivityDto,
  type RefinementState,
  type SplitMode,
} from '@solera/protocol'

/**
 * Le premier message d'une session d'affinage (#184) : il invoque le skill
 * `affiner-un-jalon` sur le jalon, `--decouper` pour un découpage direct, puis le brief et
 * ses pièces jointes — les cartes citées, à inclure dans le jalon ou en référence, et les
 * liens. Les fichiers partent à part, en pièces jointes du message.
 *
 * Écrit pour l'agent et non traduit : c'est la ligne d'appel du skill, que l'utilisateur
 * voit et peut retoucher avant l'envoi.
 */
export function refinePrompt({
  number,
  mode,
  brief,
  cards = [],
  links = [],
}: {
  number: number
  mode: SplitMode
  brief: string
  cards?: { number: number; include: boolean }[]
  links?: string[]
}): string {
  const parts = [`/affiner-un-jalon #${number}${mode === 'direct' ? ' --decouper' : ''}`]
  if (brief.trim()) parts.push(brief.trim())
  if (cards.length > 0) {
    parts.push(
      `Cartes jointes : ${cards.map((card) => `#${card.number}${card.include ? ' (à inclure dans le jalon)' : ' (référence)'}`).join(', ')}`,
    )
  }
  if (links.length > 0) parts.push(`Liens :\n${links.map((link) => `- ${link}`).join('\n')}`)
  return parts.join('\n\n')
}

/**
 * Où mène « Affiner » (#195, AFF-2) : la session d'affinage de la carte si elle en a une,
 * sinon un brouillon de découpage rattaché au jalon, son premier message pré-rempli du
 * titre et de la description. `mode` ne s'écrit que s'il change du défaut du serveur.
 */
export function refineHref(
  projectId: string,
  card: Pick<CardDto, 'id' | 'number' | 'title' | 'description' | 'refinement'>,
  mode: SplitMode,
): string {
  const brief = [card.title.trim(), card.description.trim()].filter(Boolean).join('\n\n')
  return refineSessionHref(projectId, card, mode, refinePrompt({ number: card.number, mode, brief }))
}

/**
 * La session d'affinage d'une carte si elle en a une, sinon un brouillon de découpage
 * rattaché à elle, son premier message pré-rempli de `prompt`.
 */
export function refineSessionHref(
  projectId: string,
  card: { id: string; refinement: Pick<CardRefinementDto, 'conversationId'> | null },
  mode: SplitMode,
  prompt: string,
): string {
  if (card.refinement) return `/p/${projectId}/c/${card.refinement.conversationId}`
  const params = new URLSearchParams({ split: card.id })
  if (mode === 'direct') params.set('mode', mode)
  params.set('prompt', prompt)
  return `/p/${projectId}/c/new?${params.toString()}`
}

/**
 * L'état que montre le résumé d'affinage (AFF-1) : celui de la carte (`refinementState`),
 * à deux écarts près. Une question qu'on lit ici l'emporte : une question asynchrone de
 * Codex laisse la session tourner, et la carte la dit au travail ; la page, elle, la
 * montre. Et un jalon qui a ses cartes sans session d'affinage est découpé : il n'y a
 * plus rien à lancer ici, « Ajouter au jalon » relance l'agent.
 */
export function refinePanelState(
  refinement: CardRefinementDto | null,
  hasChildren: boolean,
  liveStatus: ConversationStatus | undefined,
  hasQuestions: boolean,
): RefinementState {
  const state = refinementState(refinement, hasChildren, liveStatus)
  if (state === 'none') return hasChildren ? 'done' : 'none'
  return hasQuestions ? 'waiting' : state
}

/**
 * Garde la réponse à une question d'une demande (AFF-5) : une demande du CLI se répond
 * en une fois, donc chaque champ garde la sienne et l'envoi part quand toutes en ont une.
 * Une réponse vide ne compte pas ; celles des questions qui ne sont plus ouvertes tombent.
 */
export function collectAnswer(
  answers: Readonly<Record<string, string[]>>,
  questions: readonly { id: string }[],
  id: string,
  text: string,
): { answers: Record<string, string[]>; complete: boolean } {
  const value = text.trim()
  const next: Record<string, string[]> = {}
  for (const question of questions) {
    const kept = question.id === id && value ? [value] : answers[question.id]
    if (kept?.length) next[question.id] = kept
  }
  return { answers: next, complete: questions.every((question) => (next[question.id]?.length ?? 0) > 0) }
}

/**
 * Le brouillon tel qu'il part de la page d'un jalon : ses cartes naissent enfants de ce
 * jalon (AFF-6), quelle que soit la parente que l'agent a écrite.
 */
export function draftUnderMilestone(draft: CardDraft, milestone: Pick<CardDto, 'id' | 'number' | 'title'>): CardDraft {
  return { ...draft, parent: { kind: 'existing', card: { cardId: milestone.id, number: milestone.number, title: milestone.title } } }
}

/** L'outil en cours de la session d'affinage, sous la forme d'un appel du fil : `toolSummary` le résume. */
export function activityTool(activity: RefinementActivityDto): ToolItem {
  return {
    kind: 'tool',
    id: activity.toolCallId,
    ts: activity.startedAt,
    name: activity.toolName,
    input: activity.input,
    output: null,
    outputBytes: null,
    status: 'running',
    durationMs: null,
    parentToolCallId: null,
  }
}
