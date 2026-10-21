import { MessageCircleQuestion } from 'lucide-react'
import type { DecisionItem } from '../../lib/chat-fold'
import { decisionDue, openDecision } from '../../lib/decisions'
import { useTranslate } from '../../lib/i18n'
import { DECISION_STATUS_LABELS } from '../decisions/DecisionDialog'
import { Badge, Button, cx } from '@solera/ui'

/**
 * Une décision que la session a demandée, dans son fil.
 *
 * Même forme que les deux rangements, avec un écart : rien ne se tranche dans la carte
 * elle-même. Le bouton ouvre le dialogue de réponse, le même que celui de la colonne et
 * des toasts — choisir parmi les options demande de lire le contexte, que le fil n'a
 * pas la place de montrer.
 *
 * Seul le propriétaire de la conversation tranche ; les autres lisent la question et
 * son issue.
 */
export function DecisionPrompt({ item, canDecide }: { item: DecisionItem; canDecide: boolean }) {
  const t = useTranslate()
  const pending = item.status === 'pending'
  const outcome = [item.option, item.text].filter(Boolean).join(' — ')

  return (
    <div
      className={cx(
        'rounded-lg border p-3',
        pending ? 'border-accent bg-accent-wash/40 shadow-card' : 'border-line bg-surface/60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <MessageCircleQuestion size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-faint">
            {t(pending ? 'decision.thread.pending' : 'decision.thread.past')}
          </p>
          <p className="mt-0.5 text-sm font-medium text-ink">{item.question}</p>
          {pending ? (
            <p className="mt-1 text-xs text-ink-faint">
              {decisionDue(item.expiresAt)} ·{' '}
              {item.defaultOption
                ? t('decision.dialog.fallback', { option: item.defaultOption })
                : t('decision.dialog.noFallback')}
            </p>
          ) : outcome ? (
            <p className="mt-1 text-xs text-ink-soft">→ {outcome}</p>
          ) : null}
        </div>
        {!pending ? (
          <Badge tone={item.status === 'user' ? 'positive' : 'neutral'}>
            {t(DECISION_STATUS_LABELS[item.status])}
          </Badge>
        ) : null}
      </div>
      {pending && canDecide ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => openDecision(item.id)}>
            {t('decision.thread.answer')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
