import { ArrowDown, ArrowUp, Check, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { cardDraftProblems, MAX_DRAFT_CARDS, type CardDraft } from '@solera/protocol'
import { Button, IconButton, cx } from '@solera/ui'
import {
  addDraftCard,
  canAddDraftCard,
  draftLetter,
  draftLinksBelow,
  moveDraftCard,
  removeDraftCard,
  renameDraftCard,
  toggleDraftAfter,
} from '../../lib/card-draft-edit'
import { pluralOf } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'

/**
 * Le brouillon de découpage d'un jalon, corrigé sur sa page (#195, spec jalons AFF-6) :
 * une ligne par carte, qu'on renomme, monte, descend, retire ou lie aux cartes du dessus
 * par leurs lettres ; on en ajoute à la fin, puis on valide. Le brouillon de l'agent ne
 * change pas : `onChange` rend la version corrigée, qui part au clic.
 *
 * La description d'une carte se corrige dans le fil (`CardDraftPrompt`) : ici, on règle
 * le découpage lui-même, et ses sous-tâches se lisent en aperçu.
 */
export function DraftEditor({
  draft,
  onChange,
  blocked,
  onValidate,
  busy,
  error,
  readOnly = false,
}: {
  draft: CardDraft
  onChange: (draft: CardDraft) => void
  /** Une question de la session est ouverte : on y répond avant de valider. */
  blocked: boolean
  onValidate: () => void
  busy: boolean
  error: string | null
  /** Seul le propriétaire de la session tranche son brouillon. */
  readOnly?: boolean
}) {
  const t = useTranslate()
  const [adding, setAdding] = useState('')
  const problems = cardDraftProblems(draft)
  const letterOf = new Map(draft.cards.map((card, index) => [card.key, draftLetter(index)]))
  const full = !canAddDraftCard(draft)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium tracking-wide text-ink-faint uppercase">{t('milestone.draft.eyebrow')}</span>
        <span className="text-xs text-ink-faint">
          {t(`milestone.draft.count.${pluralOf(draft.cards.length)}`, { count: draft.cards.length })}
        </span>
      </div>
      <ol className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {draft.cards.map((card, index) => {
          const letter = draftLetter(index)
          // Les cartes du dessus, puis celles du dessous que l'agent lui a fait attendre.
          const linkable = [...draft.cards.slice(0, index), ...draftLinksBelow(draft, card.key).flatMap((key) => draft.cards.filter((other) => other.key === key))]
          const waitsOnNothing = card.after.length === 0 && card.blockedBy.length === 0
          return (
            <li key={card.key} className="flex flex-col gap-1.5 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-high text-xs font-medium tabular-nums"
                >
                  {letter}
                </span>
                <input
                  // Remonté par son titre : un renommage refusé (vide) reprend celui du brouillon.
                  key={card.title}
                  defaultValue={card.title}
                  readOnly={readOnly}
                  aria-label={t('milestone.draft.cardTitle', { letter })}
                  onBlur={(event) => {
                    const next = renameDraftCard(draft, card.key, event.target.value)
                    if (next !== draft) onChange(next)
                    else event.target.value = card.title
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur()
                  }}
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm text-ink outline-none hover:bg-surface-high/50 focus:bg-surface-high/50"
                />
                {readOnly ? null : (
                  <span className="flex shrink-0 items-center">
                    <IconButton size="sm" label={t('milestone.draft.up')} disabled={index === 0} onClick={() => onChange(moveDraftCard(draft, card.key, -1))}>
                      <ArrowUp size={13} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      label={t('milestone.draft.down')}
                      disabled={index === draft.cards.length - 1}
                      onClick={() => onChange(moveDraftCard(draft, card.key, 1))}
                    >
                      <ArrowDown size={13} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      label={t('milestone.draft.remove')}
                      // Le dernier ne se retire pas : un brouillon vide se refuse dans la session.
                      disabled={draft.cards.length === 1}
                      onClick={() => onChange(removeDraftCard(draft, card.key))}
                      className="hover:text-critical"
                    >
                      <X size={13} />
                    </IconButton>
                  </span>
                )}
              </div>

              {/* Ce qu'elle attend : une pastille par carte du dessus, allumée si elle l'attend,
                  et les cartes existantes que l'agent a nommées. */}
              <div className="ml-8 flex flex-wrap items-center gap-1 text-xs text-ink-faint">
                {linkable.length > 0 || card.blockedBy.length > 0 ? <span>{t('milestone.draft.after')}</span> : null}
                {linkable.map((other) => {
                  const on = card.after.includes(other.key)
                  return (
                    <button
                      key={other.key}
                      type="button"
                      aria-pressed={on}
                      aria-label={t('milestone.draft.afterToggle', { letter: letterOf.get(other.key) ?? '', title: other.title })}
                      title={other.title}
                      disabled={readOnly}
                      onClick={() => onChange(toggleDraftAfter(draft, card.key, other.key))}
                      className={cx(
                        'h-6 min-w-6 rounded px-1.5 font-medium tabular-nums transition-colors disabled:pointer-events-none',
                        on ? 'bg-accent/15 text-accent' : 'border border-dashed border-line hover:border-line-strong',
                      )}
                    >
                      {letterOf.get(other.key)}
                    </button>
                  )
                })}
                {card.blockedBy.map((other) => (
                  <span key={other.cardId} title={other.title} className="inline-flex h-6 items-center rounded bg-surface-high px-1.5 tabular-nums">
                    #{other.number}
                  </span>
                ))}
                {waitsOnNothing ? (
                  <span className="italic">{t(index === 0 ? 'milestone.draft.startsNow' : 'milestone.draft.nothing')}</span>
                ) : null}
              </div>

              {card.subtasks.length ? (
                <ul aria-label={t('milestone.draft.subtasks')} className="ml-8 flex flex-col gap-0.5 text-xs text-ink-soft">
                  {card.subtasks.map((line, position) => (
                    <li key={position} className="flex items-center gap-1.5">
                      <span aria-hidden className="size-3 shrink-0 rounded-sm border border-line" />
                      <span className="min-w-0 truncate">{line}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
        {readOnly ? null : (
          <li className="px-3 py-1.5">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const next = addDraftCard(draft, adding)
                if (next === draft) return
                onChange(next)
                setAdding('')
              }}
              className="flex items-center gap-2"
            >
              <Plus size={14} aria-hidden className="shrink-0 text-ink-faint" />
              <input
                value={adding}
                disabled={full}
                onChange={(event) => setAdding(event.target.value)}
                aria-label={t('milestone.draft.addPlaceholder')}
                placeholder={full ? t('milestone.draft.full', { count: MAX_DRAFT_CARDS }) : t('milestone.draft.addPlaceholder')}
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </form>
          </li>
        )}
      </ol>
      {readOnly ? null : (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {error ? (
            <span role="alert" className="mr-auto text-xs text-critical">
              {t('milestone.draft.failed', { error })}
            </span>
          ) : null}
          {problems.length > 0 ? (
            <span className="text-xs text-critical">
              {t(problems.some((problem) => problem.code === 'cycle') ? 'cardDraft.problem.cycle' : 'milestone.draft.invalid')}
            </span>
          ) : null}
          {blocked ? <span className="text-xs text-caution">{t('milestone.draft.answerFirst')}</span> : null}
          <Button size="sm" icon={<Check size={14} />} disabled={blocked || busy || problems.length > 0} onClick={onValidate}>
            {t('milestone.draft.validate')}
          </Button>
        </div>
      )}
    </div>
  )
}
