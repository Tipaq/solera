import { MessageCircleQuestion } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { DecisionDto, DecisionStatus } from '@solera/protocol'
import { HeaderBand } from '../components/HeaderBand'
import { DECISION_STATUS_LABELS } from '../components/decisions/DecisionDialog'
import { Badge, Banner, EmptyState, Tabs } from '@solera/ui'
import { shortAge } from '../lib/dates'
import { decisionDue, openDecision, useDecisions } from '../lib/decisions'
import { useTranslate } from '../lib/i18n'

/** Deux teintes qui disent quelque chose, comme au Journal : ce qui attend, ce qui a échu. */
const STATUS_TONES: Record<DecisionStatus, 'caution' | 'positive' | 'neutral'> = {
  pending: 'caution',
  user: 'positive',
  default: 'neutral',
  expired: 'caution',
  withdrawn: 'neutral',
}

/**
 * Les décisions du compte : celles qui attendent, puis l'historique — ce qui a été
 * tranché, par qui, ou laissé à l'échéance. Lues dans `agent_requests`, il n'y a pas
 * d'autre source.
 *
 * `?open=` ouvre une décision : c'est l'adresse que suivent les notifications système.
 */
export function DecisionsPage() {
  const t = useTranslate()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'pending' | 'all'>('pending')
  const { data: decisions, isPending, isError } = useDecisions(view)

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
          {isPending ? null : !decisions || decisions.length === 0 ? (
            <EmptyState
              icon={<MessageCircleQuestion size={22} />}
              title={t(view === 'pending' ? 'decision.page.emptyPending' : 'decision.page.empty')}
              description={t('decision.page.emptyHint')}
            />
          ) : (
            <ul className="flex flex-col">
              {decisions.map((decision) => (
                <DecisionRow key={decision.id} decision={decision} />
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
  const outcome = answer ? [answer.option, answer.text].filter(Boolean).join(' — ') : ''

  return (
    <li className="border-t border-line/60 first:border-t-0">
      <button
        type="button"
        onClick={() => openDecision(decision.id)}
        className="flex min-h-11 w-full flex-col gap-1 rounded px-2 py-2.5 text-left transition-colors hover:bg-surface-high"
      >
        <span className="flex w-full items-start gap-2">
          <span className="min-w-0 flex-1 text-sm font-medium text-ink">{decision.question}</span>
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
