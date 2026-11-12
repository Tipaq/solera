import type { CardDraft } from '@solera/protocol'
import { pullRequestItemKey, sessionItemKey, type HeavyInboxItem, type InboxExtra, type InboxMilestone } from './inbox'
import type { MilestoneAsk } from './milestone-model'

/*
 * Les demandes des jalons dans « Ce qui t'attend » (#255, coque INB-8..10) : ce que
 * `milestoneAsks` relève devient une ligne qui porte son geste et le lien du jalon. Pur :
 * `useMilestoneInbox` lui passe les gestes, les brouillons lus et les réponses gardées.
 *
 * Une demande ne paraît qu'à un seul endroit. La ligne d'affinage prend la place de la
 * session qui pose les questions ou dépose le brouillon ; celle de la PR finale, de la PR
 * prête qui la montrerait une seconde fois en « à relire ».
 */

type Ask<K extends MilestoneAsk['kind']> = Extract<MilestoneAsk, { kind: K }>

export interface MilestoneInboxInput {
  projectId: string
  asks: readonly MilestoneAsk[]
  /** Le brouillon de chaque jalon qui en attend un, par id du jalon, une fois lu. */
  drafts: ReadonlyMap<string, CardDraft>
  /** Les réponses gardées, par demande : une demande du CLI se répond en une fois. */
  answers: Readonly<Record<string, Readonly<Record<string, string[]>>>>
  /** Seul le propriétaire d'une session lui répond. */
  owns: (conversationId: string) => boolean
  /** La base d'une PR que Solera n'a pas encore relevée sur la forge. */
  defaultBase: string
  /** Le refus de la dernière fusion tentée pour ce jalon. */
  mergeError: (cardId: string) => string | null
  gestures: {
    answer: (ask: Ask<'refine'>, id: string, text: string) => void
    validate: (ask: Ask<'draft'>, draft: CardDraft) => void
    merge: (ask: Ask<'merge'>) => void
  }
}

export function milestoneInbox(input: MilestoneInboxInput): InboxExtra {
  const { projectId, gestures } = input
  const link = (card: Ask<'merge'>['milestone']): InboxMilestone => ({
    number: card.number,
    title: card.title,
    to: `/p/${projectId}/timeline/${card.number}`,
  })
  // Un brouillon ne se valide pas tant que la session a des questions ouvertes (AFF-6).
  const asking = new Set(input.asks.flatMap((ask) => (ask.kind === 'refine' ? [ask.milestone.id] : [])))
  const items: HeavyInboxItem[] = []
  const replaces: string[] = []

  for (const ask of input.asks) {
    switch (ask.kind) {
      case 'refine': {
        // La session d'un autre garde sa ligne : il n'y a que lui pour y répondre.
        if (!input.owns(ask.conversationId)) break
        replaces.push(sessionItemKey(ask.conversationId))
        const kept = input.answers[ask.requestId] ?? {}
        const questions = ask.questions.filter((question) => !kept[question.id]?.length)
        // Toutes répondues, la réponse part : la ligne s'en va, la session reste cachée.
        if (questions.length === 0) break
        items.push({
          kind: 'refine',
          key: ask.key,
          milestone: link(ask.milestone),
          questions,
          onAnswer: (id, text) => gestures.answer(ask, id, text),
        })
        break
      }
      case 'draft': {
        if (!input.owns(ask.conversationId)) break
        replaces.push(sessionItemKey(ask.conversationId))
        const draft = input.drafts.get(ask.milestone.id)
        // Pas encore lu, il ferait une ligne vide : elle paraît avec ses cartes.
        if (!draft || asking.has(ask.milestone.id)) break
        items.push({
          kind: 'draft',
          key: ask.key,
          milestone: link(ask.milestone),
          cards: draft.cards.map((card) => ({ key: card.key, title: card.title, after: card.after })),
          onValidate: () => gestures.validate(ask, draft),
        })
        break
      }
      case 'merge':
        replaces.push(pullRequestItemKey(projectId, ask.pr.number))
        items.push({
          kind: 'merge',
          key: ask.key,
          milestone: link(ask.milestone),
          branch: ask.branch,
          base: ask.pr.base ?? input.defaultBase,
          error: input.mergeError(ask.milestone.id),
          onMerge: () => gestures.merge(ask),
        })
        break
    }
  }
  return { items, replaces }
}
