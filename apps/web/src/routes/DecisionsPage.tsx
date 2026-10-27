import { Columns3, FolderInput, MessageCircleQuestion } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AccordStatus, DecisionDto, DecisionStatus, RequestHistoryDto } from '@solera/protocol'
import { HeaderBand } from '../components/HeaderBand'
import { DECISION_STATUS_LABELS } from '../components/decisions/DecisionDialog'
import { Badge, Banner, EmptyState, Tabs } from '@solera/ui'
import { shortAge } from '../lib/dates'
import { conversationPath } from '../lib/conversation-route'
import { decisionDue, openDecision, useRequestHistory } from '../lib/decisions'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { decisionOption, decisionQuestion } from '../components/decisions/decision-text'
import { accordText } from '../components/activity/ForYouItem'

/** Deux teintes qui disent quelque chose, comme au Journal : ce qui attend, ce qui a échu. */
const STATUS_TONES: Record<DecisionStatus, 'caution' | 'positive' | 'neutral'> = {
  pending: 'caution',
  user: 'positive',
  default: 'neutral',
  expired: 'caution',
  withdrawn: 'neutral',
}

const ACCORD_TONES: Record<AccordStatus, 'caution' | 'positive' | 'neutral'> = {
  pending: 'caution',
  accepted: 'positive',
  closed: 'neutral',
}

const ACCORD_LABELS: Record<AccordStatus, MessageKey> = {
  pending: 'forYou.history.pending',
  accepted: 'forYou.history.accepted',
  closed: 'forYou.history.closed',
}

/**
 * L'historique complet de ce qui t'attend (#121) : les décisions et les trois accords
 * qu'un clic tranche, ceux qui attendent puis tout le reste — ce qui a été tranché, par
 * qui, ou laissé à l'échéance. Lus dans `agent_requests`, il n'y a pas d'autre source.
 *
 * `?open=` ouvre une décision : c'est l'adresse que suivent les notifications système.
 */
export function DecisionsPage() {
  const t = useTranslate()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'pending' | 'all'>('pending')
  const { data: entries, isPending, isError } = useRequestHistory(view)

  useEffect(() => {
    const open = params.get('open')
    if (!open) return
    openDecision(open)
    const next = new URLSearchParams(params)
    next.delete('open')
    setParams(next, { replace: true })
  }, [params, setParams])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderBand>
        <MessageCircleQuestion size={16} className="shrink-0 text-ink-faint" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{t('decision.page.title')}</h1>
      </HeaderBand>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <Tabs
            label={t('decision.page.title')}
            value={view}
            onChange={setView}
            tabs={[
              { value: 'pending', label: t('decision.page.pending') },
              { value: 'all', label: t('decision.page.all') },
            ]}
          />
          {isError ? <Banner>{t('decision.page.loadError')}</Banner> : null}
          {isPending ? null : !entries || entries.length === 0 ? (
            <EmptyState
              icon={<MessageCircleQuestion size={22} />}
              title={t(view === 'pending' ? 'decision.page.emptyPending' : 'decision.page.empty')}
              description={t('decision.page.emptyHint')}
            />
          ) : (
            <ul className="flex flex-col">
              {entries.map((entry) => (
                entry.kind === 'decision'
                  ? <DecisionRow key={entry.decision.id} decision={entry.decision} />
                  : <AccordRow key={entry.id} accord={entry} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/** Une décision en une ligne entièrement cliquable : elle ouvre son dialogue. */
function DecisionRow({ decision }: { decision: DecisionDto }) {
  const t = useTranslate()
  const answer = decision.answer
  const outcome = answer
    ? [answer.option ? decisionOption(decision, answer.option, t) : null, answer.text].filter(Boolean).join(' — ')
    : ''

  return (
    <li className="border-t border-line/60 first:border-t-0">
      <button
        type="button"
        onClick={() => openDecision(decision.id)}
        className="flex min-h-11 w-full flex-col gap-1 rounded px-2 py-2.5 text-left transition-colors hover:bg-surface-high"
      >
        <span className="flex w-full items-start gap-2">
          <span className="min-w-0 flex-1 text-sm font-medium text-ink">{decisionQuestion(decision.question, decision.worktree?.branch, t)}</span>
          <Badge tone={STATUS_TONES[decision.status]}>{t(DECISION_STATUS_LABELS[decision.status])}</Badge>
        </span>
        <span className="flex w-full items-center gap-2 text-xs text-ink-faint">
          <span className="min-w-0 flex-1 truncate">
            {[decision.projectName, decision.conversationTitle].filter(Boolean).join(' · ')}
          </span>
          <span className="shrink-0 tabular-nums">
            {decision.status === 'pending' ? decisionDue(decision.expiresAt) : shortAge(decision.createdAt)}
          </span>
        </span>
        {outcome ? <span className="w-full truncate text-xs text-ink-soft">→ {outcome}</span> : null}
      </button>
    </li>
  )
}

/**
 * Un accord en une ligne : ce qu'il demandait, son issue, et le fil où son bloc reste
 * lisible — c'est là qu'il s'accorde encore s'il attend.
 */
function AccordRow({ accord }: { accord: Exclude<RequestHistoryDto, { kind: 'decision' }> }) {
  const t = useTranslate()
  const title = accordText(accord.kind, accord.count, 'title', t)
  const Icon = accord.kind === 'move_conversation' ? FolderInput : Columns3

  return (
    <li className="border-t border-line/60 first:border-t-0">
      <Link
        to={conversationPath({ id: accord.conversationId, projectId: accord.projectId })}
        className="flex min-h-11 w-full flex-col gap-1 rounded px-2 py-2.5 text-left transition-colors hover:bg-surface-high"
      >
        <span className="flex w-full items-start gap-2">
          <Icon size={14} aria-hidden className="mt-0.5 shrink-0 text-ink-faint" />
          <span className="min-w-0 flex-1 text-sm font-medium text-ink">{title}</span>
          <Badge tone={ACCORD_TONES[accord.status]}>{t(ACCORD_LABELS[accord.status])}</Badge>
        </span>
        <span className="flex w-full items-center gap-2 text-xs text-ink-faint">
          <span className="min-w-0 flex-1 truncate">
            {[accord.projectName, accord.conversationTitle].filter(Boolean).join(' · ')}
          </span>
          <span className="shrink-0 tabular-nums">{shortAge(accord.resolvedAt ?? accord.createdAt)}</span>
        </span>
      </Link>
    </li>
  )
}
