import { FolderInput } from 'lucide-react'
import { useState } from 'react'
import type { FilingItem } from '../../lib/chat-fold'
import { decideFiling } from '../../lib/conversations'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { staleReasonLabel } from '../../lib/request-reasons'
import { Badge, Button, cx } from '@solera/ui'

/**
 * Un rangement qu'un agent demande, et que l'utilisateur accorde.
 *
 * Elle annonce son prix plutôt que de refuser : le travail non commité ne part pas, il
 * reste dans le projet de départ. Ce qui se perd est l'orientation — worktree et carte
 * détachés, reprise du CLI impossible — et c'est exactement ce que ces lignes disent,
 * sur le modèle du `force` d'un worktree sale : on le dit, et on exige une confirmation
 * explicite plutôt que de décider à la place de l'utilisateur.
 */
export function FilingPrompt({
  conversationId,
  filing,
  canDecide,
  onDecided,
}: {
  conversationId: string
  filing: FilingItem
  canDecide: boolean
  /** Le clic est parti : la modale d'Activité (#121) en dit le verdict une seconde. */
  onDecided?: (decision: 'accepted' | 'refused') => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslate()

  const STATUS_LABEL: Record<Exclude<FilingItem['status'], 'pending'>, string> = {
    accepted: t('filing.status.accepted'),
    refused: t('filing.status.refused'),
    impossible: t('filing.status.impossible'),
  }

  const decide = async (decision: 'accepted' | 'refused') => {
    setBusy(true)
    setError(null)
    try {
      await decideFiling(conversationId, filing.id, decision)
      onDecided?.(decision)
    } catch (err) {
      // L'événement `filing.resolved` viendra du serveur : on n'anticipe pas l'état ici,
      // sinon l'affichage cesserait d'être un pur fold du journal.
      setError(err instanceof Error ? err.message : t('filing.error.generic'))
      setBusy(false)
    }
  }

  // Ce que le déplacement détache. Les lignes absentes ne s'affichent pas : une demande
  // sur un fil sans worktree ni carte n'a qu'un prix, la reprise du CLI.
  const costs = [
    filing.worktree
      ? filing.worktree.dirtyFiles > 0
        ? t('filing.cost.worktreeDirty', {
            name: filing.worktree.name,
            files: String(filing.worktree.dirtyFiles),
          })
        : t('filing.cost.worktree', { name: filing.worktree.name })
      : null,
    filing.card
      ? t('filing.cost.card', { number: String(filing.card.number), title: filing.card.title })
      : null,
    filing.resumable ? t('filing.cost.resume') : null,
  ].filter((line): line is string => line !== null)

  return (
    <div
      className={cx(
        'rounded-lg border p-3',
        filing.status === 'pending'
          ? 'border-accent bg-accent-wash/40 shadow-card'
          : 'border-line bg-surface/60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <FolderInput size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {filing.status === 'pending'
              ? t('filing.title.pending', { project: filing.projectName })
              : t('filing.title.past', { project: filing.projectName })}
          </p>
          {costs.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
              {costs.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {filing.status === 'impossible' && filing.reason ? (
            <p className="mt-1.5 text-xs text-ink-soft">{reasonLabel(filing.reason, t)}</p>
          ) : null}
        </div>
        {filing.status !== 'pending' ? (
          <Badge tone={filing.status === 'accepted' ? 'positive' : 'neutral'}>
            {STATUS_LABEL[filing.status]}
          </Badge>
        ) : null}
      </div>

      {filing.status === 'pending' && canDecide ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void decide('accepted')}>
            {t('filing.accept')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void decide('refused')}
          >
            {t('filing.refuse')}
          </Button>
        </div>
      ) : null}

      {filing.status === 'pending' && !canDecide ? (
        <p className="mt-2 text-xs text-ink-faint">{t('filing.ownerOnly')}</p>
      ) : null}

      {filing.status === 'accepted' ? (
        <p className="mt-2 text-xs text-ink-faint">{t('filing.accepted.hint')}</p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-critical">{error}</p> : null}
    </div>
  )
}

/**
 * Pourquoi un rangement accordé n'a pas pu avoir lieu. Le serveur envoie un code, et non
 * une phrase : le journal est rejoué dans la langue de qui le relit.
 */
function reasonLabel(reason: string, t: (key: MessageKey) => string): string {
  const stale = staleReasonLabel(reason, t)
  if (stale) return stale
  if (reason === 'project_not_found') return t('filing.reason.projectGone')
  if (reason === 'conversation_scheduled') return t('filing.reason.scheduled')
  return t('filing.reason.unknown')
}
