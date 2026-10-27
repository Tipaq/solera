import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  Columns3,
  FolderInput,
  FormInput,
  Hourglass,
  MessageCircleQuestion,
  MessagesSquare,
  Scale,
  ShieldQuestion,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { AwaitingRequestEntryDto, DecisionDto, ProjectDto } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { api } from '../../lib/api'
import { applyEvent, emptyChatState } from '../../lib/chat-fold'
import { shortAge } from '../../lib/dates'
import { decisionDue, useAnswerDecision, useDecision } from '../../lib/decisions'
import type { ForYouRequest } from '../../lib/for-you'
import { formatAgo } from '../../lib/loops'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { requestLine } from '../../lib/session-requests'
import { CardDraftPrompt } from '../chat/CardDraftPrompt'
import { CardFilingPrompt } from '../chat/CardFilingPrompt'
import { FilingPrompt } from '../chat/FilingPrompt'
import { decisionOption, decisionQuestion } from '../decisions/decision-text'
import { SessionRequestBody } from '../project/SessionRequestPreview'
import { ProjectAvatar } from '../ProjectAvatar'

type Translate = ReturnType<typeof useTranslate>

const TIER_LABEL: Record<ForYouRequest['tier'], MessageKey> = {
  blocked: 'forYou.tier.blocked',
  decision: 'forYou.tier.decision',
  accord: 'forYou.tier.accord',
}

/** L'icône d'une demande : ce qu'elle est, pas d'où elle vient. */
export function forYouIcon(entry: ForYouRequest): LucideIcon {
  if (entry.tier === 'decision') return Scale
  if (entry.tier === 'accord') return entry.awaiting.kind === 'move_conversation' ? FolderInput : Columns3
  switch (entry.request?.kind) {
    case 'permission': return ShieldQuestion
    case 'plan': return ClipboardCheck
    case 'elicitation': return FormInput
    default: return MessageCircleQuestion
  }
}

/** Ce qui est demandé, en une phrase : la question, la commande, ou ce qu'il faut ranger. */
export function forYouTitle(entry: ForYouRequest, t: Translate): string {
  if (entry.tier === 'blocked') return entry.request ? requestLine(entry.request, t) : entry.conversationTitle
  if (entry.tier === 'decision') return decisionQuestion(entry.awaiting.question, entry.awaiting.worktreeBranch, t)
  return accordText(entry.awaiting.kind, 'count' in entry.awaiting ? entry.awaiting.count : 1, 'title', t)
}

export type AccordKind = 'request_card_change' | 'propose_cards' | 'move_conversation'

/**
 * Ce qu'un accord demande : en titre (« 3 cartes à ranger »), pour la modale et
 * l'historique, ou en un mot (« 3 cartes »), pour le repère de la colonne.
 */
export function accordText(kind: AccordKind, count: number, form: 'title' | 'short', t: Translate): string {
  if (kind === 'move_conversation') return t(form === 'title' ? 'forYou.title.move' : 'awaiting.moveConversation')
  const many = count > 1
  if (kind === 'request_card_change') {
    return form === 'title'
      ? t(many ? 'awaiting.cardMove.other' : 'awaiting.cardMove.one', { count })
      : t(many ? 'forYou.short.cards.other' : 'forYou.short.cards.one', { count })
  }
  return form === 'title'
    ? t(many ? 'awaiting.cardDraft.other' : 'awaiting.cardDraft.one', { count })
    : t(many ? 'forYou.short.drafts.other' : 'forYou.short.drafts.one', { count })
}

/** Le genre de la demande, en tête de son dépliage. */
function kindLabel(entry: ForYouRequest, t: Translate): string {
  if (entry.tier === 'decision') return t('projectActivity.preview.decision')
  if (entry.tier === 'accord') {
    return t(entry.awaiting.kind === 'move_conversation' ? 'forYou.kind.move'
      : entry.awaiting.kind === 'request_card_change' ? 'forYou.kind.cards' : 'forYou.kind.drafts')
  }
  switch (entry.request?.kind) {
    case 'permission': return t('projectActivity.preview.permission')
    case 'plan': return t('projectActivity.preview.plan')
    case 'elicitation': return t('projectActivity.preview.elicitation')
    default: return t('projectActivity.preview.question')
  }
}

/**
 * Une demande dans « Pour toi » : **ce qui est demandé** en titre, le fil et son projet
 * dessous, son rang en étiquette, l'âge ou l'échéance. Un clic la déplie sur place,
 * une seule à la fois, pour y répondre sans ouvrir le fil.
 */
export function ForYouItem({ entry, project, open, onToggle, onOpenThread, threadPath, onVerdict }: {
  entry: ForYouRequest
  project?: ProjectDto
  open: boolean
  onToggle: () => void
  /** La réponse est partie d'ici : son verdict, que la ligne dira en partant. */
  onVerdict?: (verdict: string) => void
  /** Appelé avant d'aller au fil : la modale se ferme. */
  onOpenThread: () => void
  threadPath: string
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const openThread = () => {
    onOpenThread()
    navigate(threadPath)
  }
  const Icon = forYouIcon(entry)
  const blocked = entry.tier === 'blocked'
  const expiresAt = entry.tier === 'decision' ? entry.awaiting.expiresAt : null

  return (
    <li className={cx('rounded-md', open && 'bg-sunken/60')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-high"
      >
        <Icon size={15} aria-hidden className={cx('shrink-0', blocked ? 'text-caution' : 'text-ink-faint')} />
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate text-sm text-ink', blocked && 'font-medium')}>{forYouTitle(entry, t)}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-faint">
            {entry.projectId === null
              ? <MessagesSquare size={11} aria-hidden className="shrink-0" />
              : <ProjectAvatar project={project} className="size-3" />}
            <span className="truncate">{entry.conversationTitle}</span>
          </span>
        </span>
        <span className={cx(
          'shrink-0 rounded-full px-1.5 py-px text-meta',
          blocked ? 'bg-caution/12 text-caution' : 'bg-surface-high text-ink-faint',
        )}>
          {t(TIER_LABEL[entry.tier])}
        </span>
        <span className="hidden w-16 shrink-0 items-center justify-end gap-0.5 text-meta tabular-nums text-ink-faint sm:flex">
          {expiresAt !== null
            ? <><Hourglass size={10} aria-hidden />{formatAgo(Math.max(0, expiresAt - Date.now()))}</>
            : shortAge(entry.since)}
        </span>
        <ChevronDown size={14} aria-hidden className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="px-3 pb-3 sm:pl-[2.6rem]">
          <p className="mb-2 flex flex-wrap items-center gap-x-1.5 text-xs">
            <span className={blocked ? 'text-caution' : 'text-ink-soft'}>{kindLabel(entry, t)}</span>
            <span className="text-ink-faint">{t('forYou.detail.since', { age: shortAge(entry.since) })}</span>
            {blocked ? <span className="text-ink-faint">{t('forYou.halted')}</span> : null}
            <button
              type="button"
              onClick={openThread}
              className="ml-auto inline-flex min-h-8 items-center gap-1 text-ink-soft hover:text-ink pointer-coarse:min-h-11"
            >
              {t('projectActivity.preview.open')}
              <ArrowUpRight size={12} aria-hidden />
            </button>
          </p>
          <ForYouAnswer entry={entry} onOpenThread={openThread} onVerdict={onVerdict} />
        </div>
      ) : null}
    </li>
  )
}

/**
 * La seconde où la ligne dit son verdict, avant de partir. Sans verdict connu — la
 * demande a été tranchée ailleurs, dans le fil ou depuis un autre écran —, « Réglé ».
 */
export function ForYouSettled({ entry, verdict }: { entry: ForYouRequest; verdict?: string }) {
  const t = useTranslate()
  return (
    <li role="status" className="flex min-h-14 items-center gap-3 rounded-md bg-positive/10 px-3 py-2 text-sm text-positive">
      <Check size={15} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {t('forYou.settled.line', { verdict: verdict ?? t('forYou.settled'), title: forYouTitle(entry, t) })}
      </span>
    </li>
  )
}

/**
 * De quoi trancher, selon le genre, **par les mêmes routes que le fil** : une permission
 * ou une question par le corps de #112, une décision par sa route de réponse, un accord
 * par le bloc même du fil, replié de son événement. Un plan se relit en entier : il
 * renvoie au fil.
 */
function ForYouAnswer({ entry, onOpenThread, onVerdict }: {
  entry: ForYouRequest
  onOpenThread: () => void
  onVerdict?: (verdict: string) => void
}) {
  const t = useTranslate()
  if (entry.tier === 'decision') return <DecisionAnswer id={entry.awaiting.id} onVerdict={onVerdict} />
  if (entry.tier === 'accord') return <AccordAnswer id={entry.awaiting.id} onVerdict={onVerdict} />

  const { request } = entry
  if (request && (request.kind === 'permission' || request.kind === 'question')) {
    return (
      <SessionRequestBody
        conversationId={entry.conversationId}
        request={request}
        canDecide={entry.conversation.isOwner}
        onAnswered={onVerdict}
      />
    )
  }
  return (
    <>
      <p className="text-sm text-ink-soft">
        {request?.kind === 'plan' ? t('projectActivity.request.plan')
          : request?.kind === 'elicitation'
            ? t('forYou.elicitation', { server: request.event.serverName, message: request.event.message })
            : t('forYou.blocked.open')}
      </p>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={onOpenThread}>{t('forYou.plan.open')}</Button>
      </div>
    </>
  )
}

/** Une décision : ses choix, celui par défaut marqué, un champ libre, et l'échéance. */
function DecisionAnswer({ id, onVerdict }: { id: string; onVerdict?: (verdict: string) => void }) {
  const t = useTranslate()
  const { data: decision, isError } = useDecision(id)
  if (isError) return <p className="text-xs text-ink-faint">{t('forYou.gone')}</p>
  if (!decision) return <p className="text-xs text-ink-faint">{t('forYou.loading')}</p>
  return <DecisionChoices decision={decision} onVerdict={onVerdict} />
}

function DecisionChoices({ decision, onVerdict }: { decision: DecisionDto; onVerdict?: (verdict: string) => void }) {
  const t = useTranslate()
  const answer = useAnswerDecision()
  const [text, setText] = useState('')
  const busy = answer.isPending || decision.status !== 'pending'
  const send = (option: string | null, note: string) => {
    if (busy || (option === null && note.trim() === '')) return
    answer.mutate(
      { id: decision.id, option, text: note.trim() },
      {
        onSuccess: () => onVerdict?.(t('forYou.verdict.answered', {
          answer: option !== null ? decisionOption(decision, option, t) : note.trim(),
        })),
      },
    )
  }

  return (
    <>
      <p className="text-sm text-ink">{decisionQuestion(decision.question, decision.worktree?.branch, t)}</p>
      {decision.options.length > 0 ? (
        <div className="mt-3 grid gap-1.5">
          {decision.options.map((option, index) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => send(option, text)}
              className="flex min-h-11 items-center gap-3 rounded-md border border-line bg-surface px-3 text-left text-sm text-ink transition-colors hover:border-accent disabled:opacity-60 md:min-h-9 pointer-coarse:min-h-11"
            >
              <span className="w-4 shrink-0 text-meta tabular-nums text-ink-faint">{index + 1}</span>
              <span className="min-w-0 flex-1">{decisionOption(decision, option, t)}</span>
              {option === decision.defaultOption
                ? <span className="shrink-0 text-meta text-ink-faint">{t('decision.dialog.default')}</span>
                : null}
            </button>
          ))}
        </div>
      ) : null}
      {decision.worktree ? null : (
        <label className="mt-2 flex min-h-11 items-center gap-3 rounded-md border border-line bg-surface px-3 focus-within:border-accent md:min-h-9 pointer-coarse:min-h-11">
          <input
            value={text}
            disabled={busy}
            aria-label={t(decision.options.length > 0 ? 'decision.dialog.note' : 'decision.dialog.free')}
            placeholder={t('projectActivity.preview.reply')}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              send(null, text)
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">{t('projectActivity.preview.enter')}</span>
        </label>
      )}
      <p className="mt-2 text-xs text-ink-faint">
        {t('forYou.decision.due', {
          due: decisionDue(decision.expiresAt),
          fallback: decision.defaultOption
            ? t('decision.dialog.fallback', { option: decisionOption(decision, decision.defaultOption, t) })
            : t('decision.dialog.noFallback'),
        })}
      </p>
      {answer.isError ? <p className="mt-2 text-xs text-critical">{answer.error.message}</p> : null}
    </>
  )
}

/**
 * Un accord : le bloc même du fil, replié de l'événement qui l'a ouvert. Ce qui
 * changera, puis refuser ou accorder, par la route du fil ; la ligne part quand le
 * serveur dit que la demande n'attend plus.
 */
function AccordAnswer({ id, onVerdict }: { id: string; onVerdict?: (verdict: string) => void }) {
  const t = useTranslate()
  const { data, isError } = useQuery({
    queryKey: ['awaiting-request', id],
    queryFn: () => api.get<AwaitingRequestEntryDto>(`/api/awaiting/${id}/request`),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  if (isError) return <p className="text-xs text-ink-faint">{t('forYou.gone')}</p>
  if (!data) return <p className="text-xs text-ink-faint">{t('forYou.loading')}</p>

  const item = applyEvent(emptyChatState(), data.seq, data.ts, data.event).items[0]
  const decided = (decision: 'accepted' | 'refused') =>
    onVerdict?.(t(decision === 'accepted' ? 'forYou.verdict.accepted' : 'forYou.verdict.refused'))
  if (item?.kind === 'filing') {
    return <FilingPrompt conversationId={data.conversationId} filing={item} canDecide onDecided={decided} />
  }
  if (item?.kind === 'cardFiling') {
    return <CardFilingPrompt conversationId={data.conversationId} filing={item} canDecide onDecided={decided} />
  }
  if (item?.kind === 'cardDraft') {
    return <CardDraftPrompt conversationId={data.conversationId} item={item} canDecide onDecided={decided} />
  }
  return <p className="text-xs text-ink-faint">{t('forYou.gone')}</p>
}
