import { useMemo, useState } from 'react'
import type { CardDraft } from '@solera/protocol'
import { useAllConversations } from './conversations'
import { useTranslate } from './i18n'
import type { InboxExtra } from './inbox'
import { milestoneInbox } from './milestone-inbox'
import { milestoneAsks } from './milestone-model'
import { useAnswerRefinement, useMilestones, useRefinementDrafts, useValidateRefinementDraft } from './milestones'
import { useMergeBranchPullRequest } from './pull-requests'
import { collectAnswer, draftUnderMilestone } from './refinement'

const NO_INBOX: InboxExtra = { items: [], replaces: [] }

/**
 * Les demandes des jalons d'un projet pour « Ce qui t'attend » (#255), à passer en
 * `extra` à `useInbox` : les questions d'affinage, le brouillon à valider, la PR finale,
 * avec les gestes de la page du jalon (#195, #198).
 *
 * Les requêtes sont celles de la page Jalons et du phare : React Query les partage.
 * Seul le brouillon se lit en plus, et seulement pour un jalon qui en attend un.
 */
export function useMilestoneInbox(projectId: string | undefined): InboxExtra {
  const t = useTranslate()
  const { entries } = useMilestones(projectId)
  const { data: conversations } = useAllConversations()
  const asks = useMemo(() => entries.flatMap(milestoneAsks), [entries])
  const draftIds = useMemo(() => asks.flatMap((ask) => (ask.kind === 'draft' ? [ask.milestone.id] : [])), [asks])
  const details = useRefinementDrafts(draftIds)

  // Une demande du CLI se répond en une fois : les réponses se gardent jusqu'à la dernière.
  const [answers, setAnswers] = useState<Record<string, Record<string, string[]>>>({})
  const forget = (requestId: string) =>
    setAnswers(({ [requestId]: _dropped, ...rest }) => rest)
  const answer = useAnswerRefinement(projectId ?? '')
  const validate = useValidateRefinementDraft(projectId ?? '')
  const merge = useMergeBranchPullRequest(projectId ?? '')
  const mergeError = merge.isError ? { cardId: merge.variables, message: merge.error.message } : null

  return useMemo(() => {
    if (!projectId || asks.length === 0) return NO_INBOX
    const owners = new Set((conversations ?? []).flatMap((entry) => (entry.isOwner ? [entry.id] : [])))
    const drafts = new Map<string, CardDraft>()
    for (const ask of asks) {
      const detail = ask.kind === 'draft' ? details.get(ask.milestone.id) : null
      // Le brouillon lu doit être celui de la demande : un redépôt le remplace.
      if (ask.kind === 'draft' && detail?.requestId === ask.requestId) drafts.set(ask.milestone.id, detail.draft)
    }
    return milestoneInbox({
      projectId,
      asks,
      drafts,
      answers,
      owns: (id) => owners.has(id),
      defaultBase: t('milestone.run.defaultBase'),
      mergeError: (cardId) => (mergeError?.cardId === cardId ? mergeError.message : null),
      gestures: {
        answer: (ask, id, text) => {
          const next = collectAnswer(answers[ask.requestId] ?? {}, ask.questions, id, text)
          setAnswers((current) => ({ ...current, [ask.requestId]: next.answers }))
          if (!next.complete) return
          // Refusée, la réponse rend ses questions à la ligne.
          answer.mutate(
            { cardId: ask.milestone.id, conversationId: ask.conversationId, requestId: ask.requestId, answers: next.answers },
            { onError: () => forget(ask.requestId) },
          )
        },
        validate: (ask, draft) =>
          validate.mutate({
            cardId: ask.milestone.id,
            conversationId: ask.conversationId,
            requestId: ask.requestId,
            draft: draftUnderMilestone(draft, ask.milestone),
          }),
        merge: (ask) => merge.mutate(ask.milestone.id),
      },
    })
    // Les `mutate` de React Query sont stables : seul l'état de la fusion compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, asks, conversations, details, answers, t, mergeError?.cardId, mergeError?.message])
}
