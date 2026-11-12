import { Check } from 'lucide-react'
import { Button } from '@solera/ui'
import { pluralOf } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'
import type { ProposedAddition } from '../../lib/refinement'

/**
 * **L'ajout proposé** (#196, spec jalons AFF-7) : où la session d'affinage range ce qu'on
 * a ajouté au jalon — en sous-tâches d'une carte qui en parle déjà, ou en nouvelles
 * cartes —, à accepter ou à laisser. Rien n'est écrit avant le clic.
 *
 * Une sous-tâche que la carte porte déjà se dit avant le clic, qui la sautera (#185).
 */
export function AdditionProposal({
  addition,
  canDecide,
  busy,
  error,
  onDecide,
}: {
  addition: ProposedAddition
  /** Le propriétaire du projet seul tranche ; les autres lisent. */
  canDecide: boolean
  busy: boolean
  error: string | null
  onDecide: (accept: boolean) => void
}) {
  const t = useTranslate()
  const fresh = addition.kind === 'subtasks' ? addition.targets.flatMap((target) => target.subtasks.filter((subtask) => !subtask.present)).length : 0
  const nothingNew = addition.kind === 'subtasks' && fresh === 0
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent-wash/20 px-3.5 py-3 text-sm">
      {addition.kind === 'subtasks' ? (
        addition.targets.map((target) => (
          <div key={target.cardId} className="flex flex-col gap-1">
            <span className="font-medium text-ink">
              {t(`milestone.addition.into.${pluralOf(target.subtasks.length)}`, { number: target.number })}
            </span>
            {target.subtasks.map((subtask) => (
              <span key={subtask.label} className="text-ink-soft">
                « {subtask.label} »{subtask.present ? <span className="text-xs text-ink-faint"> · {t('milestone.addition.present')}</span> : null}
              </span>
            ))}
          </div>
        ))
      ) : (
        <>
          <span className="font-medium text-ink">
            {t(`milestone.addition.cards.${pluralOf(addition.cards.length)}`, { count: addition.cards.length })}
          </span>
          <ul className="flex flex-col gap-1 text-ink-soft">
            {addition.cards.map((card) => (
              <li key={card.key} className="flex items-center gap-2">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink-faint" />
                <span className="min-w-0 truncate">{card.title}</span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {card.after === null
                    ? t('milestone.addition.startsNow')
                    : 'number' in card.after
                      ? t('milestone.addition.afterCard', { number: card.after.number })
                      : t('milestone.addition.afterDraft', { title: card.after.title })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {nothingNew ? <span className="text-xs text-ink-faint">{t('milestone.addition.nothingNew')}</span> : null}
      {error ? (
        <p role="alert" className="text-xs text-critical">
          {t('milestone.addition.failed', { error })}
        </p>
      ) : null}
      {canDecide ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(false)}>
            {t('milestone.addition.leave')}
          </Button>
          <Button size="sm" icon={<Check size={14} />} disabled={busy || nothingNew} onClick={() => onDecide(true)}>
            {addition.kind === 'subtasks'
              ? t(`milestone.addition.addSubtasks.${pluralOf(Math.max(fresh, 1))}`, { count: fresh })
              : t(`milestone.addition.create.${pluralOf(addition.cards.length)}`, { count: addition.cards.length })}
          </Button>
        </div>
      ) : (
        <span className="text-xs text-ink-faint">{t('cardFiling.ownerOnly')}</span>
      )}
    </div>
  )
}
