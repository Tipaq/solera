import { ArrowUpRight, Bot, CornerDownLeft, Loader, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { CardDraft, CardDto, CardRefinementDetailDto, RefinementState } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { useLiveStatus } from '../../lib/conversation-status'
import { useAllConversations } from '../../lib/conversations'
import { useTranslate } from '../../lib/i18n'
import type { MilestoneEntry } from '../../lib/milestone-model'
import { useCards } from '../../lib/cards'
import { useAnswerRefinement, useCardRefinement, useDecideAddition, useValidateRefinementDraft } from '../../lib/milestones'
import {
  activityTool,
  collectAnswer,
  draftUnderMilestone,
  proposedAdditions,
  refineHref,
  refinePanelState,
  type ProposedAddition,
} from '../../lib/refinement'
import { toolSummary } from '../../lib/tool-summary'
import { AdditionProposal } from './AdditionProposal'
import { DraftEditor } from './DraftEditor'

const DOT: Record<RefinementState, string> = {
  waiting: 'bg-caution',
  working: 'bg-accent animate-pulse',
  done: 'bg-positive',
  none: 'bg-line-strong',
}

/** Les questions ouvertes de la session, d'une même demande : elles se répondent ensemble. */
interface OpenQuestions {
  conversationId: string
  requestId: string
  items: { id: string; text: string }[]
}

/**
 * La session d'affinage d'un jalon, résumée sur sa page (#195, spec jalons AFF-1..6) :
 * son état et son mode, ce qu'elle fait, ses questions — répondues sur place —, son
 * brouillon de découpage à corriger puis valider, et la session elle-même en geste
 * principal. Le fil complet vit dans la session.
 *
 * Ce qu'un ajout au jalon devient (AFF-7, #196) s'y propose aussi : des sous-tâches dans
 * une carte, ou de nouvelles cartes dans un jalon déjà découpé — un brouillon, mais lu
 * comme un ajout. « À régler avant de partir » est à part (`SettleList`). Une session
 * d'enfant bloquée n'y est pas recopiée (spec §2.6-1) : son repère ambre et « Ce qui
 * t'attend » la portent.
 */
export function RefinementPanel({ projectId, entry }: { projectId: string; entry: MilestoneEntry }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const { card } = entry
  const session = card.refinement
  const live = useLiveStatus(session?.conversationId ?? '')
  const { data, refetch } = useCardRefinement(card.id, session !== null)
  // Le détail d'une autre session (rangée depuis, ou remplacée) ne dit rien de celle-ci.
  const detail = session && data?.session?.conversationId === session.conversationId ? data : undefined
  const { data: conversations } = useAllConversations()
  const canDecide = conversations?.find((conversation) => conversation.id === session?.conversationId)?.isOwner ?? false

  // Le détail ne se relit seul que pendant que la session tourne : un changement d'état,
  // une question ou un brouillon qui arrive par la liste des cartes le fait relire.
  const signal = `${live ?? session?.status}:${session?.draft?.requestId}:${session?.change?.requestId}:${entry.questions?.requestId}`
  const seen = useRef(signal)
  useEffect(() => {
    if (seen.current === signal) return
    seen.current = signal
    void refetch()
  }, [signal, refetch])

  const { data: cards } = useCards(projectId)
  const questions = openQuestions(detail, entry)
  const state = refinePanelState(session, entry.children.length > 0, live, questions !== null)
  const additions = proposedAdditions(detail, entry.children.length > 0, cards ?? entry.children)
  // De nouvelles cartes dans un jalon découpé se lisent en ajout, pas en découpage à refaire.
  const draft = additions.some((addition) => addition.kind === 'cards') ? null : (detail?.draft ?? null)
  // Ce que la session attend sans le proposer ici : une réponse dans le fil, ou un
  // changement de cartes qui n'est pas un ajout.
  const waitingThere = state === 'waiting' && !questions && !draft && additions.length === 0
  const listed = state === 'working' || questions !== null || draft !== null || waitingThere

  return (
    <section aria-label={t('milestone.refine.title')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold text-ink">{t('milestone.refine.title')}</h3>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <span aria-hidden className={cx('size-1.5 rounded-full', DOT[state])} />
          <span>{t(`milestone.refine.state.${state}`)}</span>
          {session ? <span className="text-ink-faint">· {t(`milestone.refine.mode.${session.mode}`)}</span> : null}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {session ? (
            <Link
              to={`/p/${projectId}/c/${session.conversationId}`}
              className="inline-flex h-11 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover md:h-9 pointer-coarse:h-11"
            >
              {t('milestone.refine.open')} <ArrowUpRight size={14} aria-hidden />
            </Link>
          ) : state === 'none' ? (
            <>
              <Link to={refineHref(projectId, card, 'direct')} className="text-xs text-ink-faint hover:text-ink hover:underline">
                {t('milestone.refine.direct')}
              </Link>
              <Button size="sm" icon={<Sparkles size={14} />} onClick={() => navigate(refineHref(projectId, card, 'questions'))}>
                {t('milestone.refine.start')}
              </Button>
            </>
          ) : null}
        </span>
      </div>

      {state === 'none' ? (
        <p className="text-sm text-ink-faint">
          {t('milestone.refine.introBefore')} <code className="text-xs">/affiner-un-jalon</code>
          {t('milestone.refine.introAfter')}
        </p>
      ) : state === 'done' && !draft ? (
        <p className="text-sm text-ink-faint">{t('milestone.refine.doneText')}</p>
      ) : listed ? (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {state === 'working' ? <ActivityLine detail={detail} /> : null}
          {questions ? (
            <QuestionLines key={questions.requestId} projectId={projectId} cardId={card.id} questions={questions} canDecide={canDecide} />
          ) : null}
          {!questions && draft ? (
            <li className="flex min-h-9 items-center gap-2 px-3 py-1.5 text-sm text-ink-soft">
              <Bot size={15} aria-hidden className="shrink-0 text-accent" />
              {t('milestone.refine.draftWaiting')}
            </li>
          ) : null}
          {waitingThere ? (
            <li className="flex min-h-9 items-center gap-2 px-3 py-1.5 text-sm text-ink-soft">
              <Bot size={15} aria-hidden className="shrink-0 text-caution" />
              {t(session?.change ? 'milestone.refine.changeWaiting' : 'milestone.refine.waitingThere')}
            </li>
          ) : null}
        </ul>
      ) : null}

      {draft ? (
        <EditableDraft
          // Un brouillon redéposé remplace le précédent, corrections comprises.
          key={draft.requestId}
          projectId={projectId}
          milestone={card}
          proposal={draft}
          blocked={questions !== null}
          canDecide={canDecide}
        />
      ) : null}

      {additions.map((addition) => (
        <DecidedAddition key={addition.requestId} projectId={projectId} milestone={card} addition={addition} canDecide={canDecide} />
      ))}
    </section>
  )
}

/** L'ajout proposé et son clic : accepté, il s'écrit ; laissé, la demande est refusée. */
function DecidedAddition({
  projectId,
  milestone,
  addition,
  canDecide,
}: {
  projectId: string
  milestone: Pick<CardDto, 'id' | 'number' | 'title'>
  addition: ProposedAddition
  canDecide: boolean
}) {
  const decide = useDecideAddition(projectId, milestone)
  return (
    <AdditionProposal
      addition={addition}
      canDecide={canDecide}
      busy={decide.isPending}
      error={decide.isError ? decide.error.message : null}
      onDecide={(accept) => decide.mutate({ addition, accept })}
    />
  )
}

/**
 * La demande de questions qui tient la session : celle que lit le détail (une question
 * asynchrone de Codex comprise), sinon celle de la liste des demandes du projet, le
 * temps que le détail arrive.
 */
function openQuestions(detail: CardRefinementDetailDto | undefined, entry: MilestoneEntry): OpenQuestions | null {
  const event = detail?.prompt?.event
  if (detail?.session && event?.type === 'question.requested' && event.questions.length > 0) {
    return {
      conversationId: detail.session.conversationId,
      requestId: event.requestId,
      items: event.questions.map((question) => ({ id: question.id, text: question.question })),
    }
  }
  return detail ? null : entry.questions
}

/** Ce que fait la session : son outil en cours, résumé comme dans le fil (AFF-5). */
function ActivityLine({ detail }: { detail: CardRefinementDetailDto | undefined }) {
  const t = useTranslate()
  const activity = detail?.activity ?? null
  const summary = activity ? toolSummary(activityTool(activity)) : null
  const text = summary?.text ?? (activity ? t('activity.toolRunning', { name: activity.toolName }) : t('milestone.refine.working'))
  return (
    <li className="flex min-h-9 items-center gap-2 px-3 text-xs text-ink-faint italic">
      <Loader size={12} aria-hidden className="shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
    </li>
  )
}

/**
 * Les questions d'une demande, chacune répondable sur place (AFF-5). Une demande du CLI
 * se répond en une fois : chaque réponse est gardée, et la dernière envoie le tout.
 */
function QuestionLines({
  projectId,
  cardId,
  questions,
  canDecide,
}: {
  projectId: string
  cardId: string
  questions: OpenQuestions
  canDecide: boolean
}) {
  const t = useTranslate()
  const [answering, setAnswering] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const answer = useAnswerRefinement(projectId)

  const send = (id: string, text: string) => {
    const next = collectAnswer(answers, questions.items, id, text)
    setAnswers(next.answers)
    setAnswering(null)
    if (next.complete) answer.mutate({ cardId, conversationId: questions.conversationId, requestId: questions.requestId, answers: next.answers })
  }

  return (
    <>
      {questions.items.map((question) => {
        const kept = answers[question.id]?.[0]
        return (
          <li key={question.id} className="flex flex-col gap-1.5 px-3 py-2">
            <span className="flex items-start gap-2 text-sm">
              <Bot size={15} aria-hidden className="mt-0.5 shrink-0 text-caution" />
              <span className="min-w-0 flex-1 text-ink">{question.text}</span>
              {answering === question.id || !canDecide || answer.isPending ? null : (
                <button
                  type="button"
                  onClick={() => setAnswering(question.id)}
                  className="shrink-0 text-xs text-ink-faint hover:text-ink hover:underline"
                >
                  {t(kept ? 'milestone.refine.answerAgain' : 'milestone.refine.answerHere')}
                </button>
              )}
            </span>
            {answering === question.id ? (
              <AnswerField label={question.text} initial={kept ?? ''} onSend={(text) => send(question.id, text)} />
            ) : kept ? (
              <p className="ml-6 text-xs text-ink-faint">{t('milestone.refine.kept', { answer: kept })}</p>
            ) : null}
          </li>
        )
      })}
      {answer.isError ? (
        <li role="alert" className="px-3 py-1.5 text-xs text-critical">
          {t('milestone.refine.answerFailed', { error: answer.error.message })}
        </li>
      ) : null}
    </>
  )
}

/** « Ta réponse » + ↵ : le focus y va de lui-même, Entrée envoie, ↵ grisé tant qu'il est vide. */
function AnswerField({ label, initial, onSend }: { label: string; initial: string; onSend: (text: string) => void }) {
  const t = useTranslate()
  const [value, setValue] = useState(initial)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (value.trim()) onSend(value)
      }}
      className="ml-6 flex h-9 items-center gap-2 rounded-md border border-line px-2.5 focus-within:border-line-strong"
    >
      <input
        // Le champ paraît au geste qui le demande : la saisie y va d'elle-même.
        autoFocus
        value={value}
        aria-label={label}
        placeholder={t('milestone.refine.answerPlaceholder')}
        onChange={(event) => setValue(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
      />
      <button
        type="submit"
        aria-label={t('milestone.refine.send')}
        disabled={!value.trim()}
        className="text-ink-faint hover:text-ink disabled:opacity-40"
      >
        <CornerDownLeft size={14} aria-hidden />
      </button>
    </form>
  )
}

/** Le brouillon de l'agent, corrigé ici puis validé : ses cartes naissent enfants du jalon, quoi qu'il ait écrit. */
function EditableDraft({
  projectId,
  milestone,
  proposal,
  blocked,
  canDecide,
}: {
  projectId: string
  milestone: Pick<CardDto, 'id' | 'number' | 'title'>
  proposal: NonNullable<CardRefinementDetailDto['draft']>
  blocked: boolean
  canDecide: boolean
}) {
  const [draft, setDraft] = useState<CardDraft>(proposal.draft)
  const validate = useValidateRefinementDraft(projectId)
  return (
    <DraftEditor
      draft={draft}
      onChange={setDraft}
      blocked={blocked}
      busy={validate.isPending}
      error={validate.isError ? validate.error.message : null}
      readOnly={!canDecide}
      onValidate={() =>
        validate.mutate({ cardId: milestone.id, conversationId: proposal.conversationId, requestId: proposal.requestId, draft: draftUnderMilestone(draft, milestone) })
      }
    />
  )
}
