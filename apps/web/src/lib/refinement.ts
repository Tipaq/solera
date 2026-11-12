import type { ToolItem } from '@solera/protocol/chat-state'
import {
  changesBesidesSubtasks,
  parseSubtasks,
  refinementState,
  type CardDraft,
  type CardDto,
  type CardRefinementDetailDto,
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

/**
 * Le message d'un ajout au jalon (#196, ADD-4), écrit pour l'agent et non traduit comme
 * `refinePrompt` : « Ajout au jalon : … » est ce que le skill reconnaît. À la session qui
 * vit, l'ajout part seul, ses fichiers en pièces jointes du message ; sans session, il
 * invoque d'abord le skill sur le jalon, et nomme les fichiers joints au jalon.
 */
export function additionPrompt({
  number,
  text,
  links = [],
  files = [],
  session,
}: {
  number: number
  text: string
  links?: string[]
  files?: string[]
  session: boolean
}): string {
  const parts = session ? [] : [`/affiner-un-jalon #${number}`]
  parts.push(`Ajout au jalon : ${text.trim()}`)
  if (links.length > 0) parts.push(`Liens :\n${links.map((link) => `- ${link}`).join('\n')}`)
  if (files.length > 0 && !session) parts.push(`Fichiers joints au jalon : ${files.join(', ')}`)
  return parts.join('\n\n')
}

/** Sans session d'affinage, l'ajout ouvre un brouillon de découpage du jalon, son message pré-rempli. */
export function additionHref(projectId: string, cardId: string, prompt: string): string {
  return `/p/${projectId}/c/new?${new URLSearchParams({ split: cardId, prompt }).toString()}`
}

/**
 * Ce que la session d'affinage propose de faire d'un ajout au jalon (AFF-7) :
 *
 * - `subtasks`, le ranger en sous-tâches de cartes qui existent (`request_card_change` et
 *   `add_subtasks`, #185) ; chacune dit si la carte la porte déjà, puisque le clic la
 *   sautera ;
 * - `cards`, de nouvelles cartes (`propose_cards`) dans un jalon déjà découpé, chacune
 *   avec ce après quoi elle part.
 *
 * Un changement qui fait autre chose que des sous-tâches n'en est pas : il se décide dans
 * la session. Un brouillon sur un jalon sans cartes est son premier découpage, et reste
 * au brouillon éditable.
 */
export type ProposedAddition =
  | {
      kind: 'subtasks'
      conversationId: string
      requestId: string
      targets: { cardId: string; number: number; title: string; subtasks: { label: string; present: boolean }[] }[]
    }
  | {
      kind: 'cards'
      conversationId: string
      requestId: string
      draft: CardDraft
      cards: { key: string; title: string; after: { number: number } | { title: string } | null }[]
    }

export function proposedAdditions(
  detail: Pick<CardRefinementDetailDto, 'draft' | 'change'> | undefined,
  hasChildren: boolean,
  cards: readonly Pick<CardDto, 'id' | 'description'>[],
): ProposedAddition[] {
  const additions: ProposedAddition[] = []
  const change = detail?.change
  if (change && change.changes.length > 0 && change.changes.every((line) => line.addSubtasks?.length && !changesBesidesSubtasks(line))) {
    const descriptions = new Map(cards.map((card) => [card.id, card.description]))
    additions.push({
      kind: 'subtasks',
      conversationId: change.conversationId,
      requestId: change.requestId,
      targets: change.changes.map((line) => {
        const present = new Set(parseSubtasks(descriptions.get(line.cardId) ?? '').map((subtask) => subtask.label))
        return {
          cardId: line.cardId,
          number: line.number,
          title: line.title,
          subtasks: (line.addSubtasks ?? []).map((label) => ({ label, present: present.has(label) })),
        }
      }),
    })
  }
  const draft = detail?.draft
  if (draft && hasChildren) {
    const titles = new Map(draft.draft.cards.map((card) => [card.key, card.title]))
    additions.push({
      kind: 'cards',
      conversationId: draft.conversationId,
      requestId: draft.requestId,
      draft: draft.draft,
      cards: draft.draft.cards.map((card) => {
        const blocker = card.blockedBy[0]
        const before = card.after.map((key) => titles.get(key)).find((title) => title !== undefined)
        return { key: card.key, title: card.title, after: blocker ? { number: blocker.number } : before ? { title: before } : null }
      }),
    })
  }
  return additions
}
