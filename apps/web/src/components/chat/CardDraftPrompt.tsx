import { ChevronDown, ChevronRight, ListTree, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  cardDraftProblems,
  withoutDraftCard,
  type CardDraft,
  type CardDraftCard,
} from '@solera/protocol'
import type { CardDraftItem } from '../../lib/chat-fold'
import { decideCardDraft } from '../../lib/conversations'
import { formatDay } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { staleReasonLabel } from '../../lib/request-reasons'
import { Badge, Button, IconButton, cx } from '@solera/ui'

const INPUT =
  'w-full rounded-md border border-line bg-sunken px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent'

/**
 * Le brouillon d'un découpage en cartes (#70) : ce que l'agent propose après une dictée,
 * que le propriétaire du projet corrige ici puis crée d'un clic.
 *
 * **Rien n'existe sur le board tant que « Créer » n'a pas été cliqué.** Le bloc corrige
 * ce qui se corrige d'un geste — un titre, une description, des sous-tâches, une carte
 * ou un lien en trop. Fusionner, ajouter ou restructurer se demande à l'agent dans le
 * fil : il redépose un brouillon entier, qui remplace celui-ci. C'est ce partage qui
 * garde le bloc léger.
 *
 * Les corrections restent locales jusqu'au clic, et c'est le brouillon corrigé qui part :
 * le journal garde celui de l'agent, sa clôture dit ce qui a été créé.
 */
export function CardDraftPrompt({
  conversationId,
  item,
  canDecide,
  onDecided,
}: {
  conversationId: string
  item: CardDraftItem
  canDecide: boolean
  /** Le clic est parti : la modale d'Activité (#121) en dit le verdict une seconde. */
  onDecided?: (decision: 'accepted' | 'refused') => void
}) {
  const t = useTranslate()
  const { projectId } = useParams()
  const [draft, setDraft] = useState<CardDraft>(item.draft)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pending = item.status === 'pending'
  const editable = pending && canDecide
  const shown = editable ? draft : item.draft
  const titleOf = new Map(shown.cards.map((card) => [card.key, card.title]))
  const problems = cardDraftProblems(shown)
  const blank = shown.cards.some((card) => card.title.trim() === '') || (shown.parent?.kind === 'new' && shown.parent.title.trim() === '')

  const update = (key: string, patch: Partial<CardDraftCard>) =>
    setDraft((current) => ({ ...current, cards: current.cards.map((card) => (card.key === key ? { ...card, ...patch } : card)) }))

  const decide = async (decision: 'created' | 'refused') => {
    setBusy(true)
    setError(null)
    try {
      // Les lignes vides du champ de sous-tâches ne sont que de la saisie en cours.
      const clean = { ...draft, cards: draft.cards.map((card) => ({ ...card, subtasks: card.subtasks.map((line) => line.trim()).filter(Boolean) })) }
      await decideCardDraft(conversationId, item.id, decision === 'created' ? { decision, draft: clean } : { decision })
      onDecided?.(decision === 'created' ? 'accepted' : 'refused')
    } catch (err) {
      // La clôture viendra du serveur, par le journal : on n'anticipe pas l'état ici.
      setError(err instanceof Error ? err.message : t('cardDraft.error.generic'))
      setBusy(false)
    }
  }

  const STATUS_LABEL: Record<Exclude<CardDraftItem['status'], 'pending'>, string> = {
    created: t('cardDraft.status.created'),
    refused: t('cardDraft.status.refused'),
    superseded: t('cardDraft.status.superseded'),
    impossible: t('cardDraft.status.impossible'),
  }
  const cardLink = (number: number) => (projectId ? `/p/${projectId}/board?carte=${number}` : null)

  return (
    <section
      aria-label={t('cardDraft.label')}
      className={cx(
        'rounded-lg border p-3',
        pending ? 'border-accent bg-accent-wash/40 shadow-card' : 'border-line bg-surface/60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <ListTree size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {t(pending ? 'cardDraft.title.pending' : 'cardDraft.title.past', { count: String(shown.cards.length) })}
          </p>

          <div className="mt-1.5 text-xs">
            <span className="text-ink-faint">{t('cardDraft.parent')} </span>
            {item.status === 'created' && item.parent ? (
              <CardNumber number={item.parent.number} title={item.parent.title} to={cardLink(item.parent.number)} />
            ) : shown.parent?.kind === 'existing' ? (
              <CardNumber number={shown.parent.card.number} title={shown.parent.card.title} to={cardLink(shown.parent.card.number)} />
            ) : shown.parent?.kind === 'new' ? (
              editable ? (
                <span className="mt-1 flex items-center gap-2">
                  <span className="shrink-0 whitespace-nowrap">
                    <Badge tone="neutral">{t('cardDraft.parent.new')}</Badge>
                  </span>
                  <input
                    aria-label={t('cardDraft.parent.title')}
                    className={INPUT}
                    value={shown.parent.title}
                    onChange={(event) =>
                      setDraft((current) =>
                        current.parent?.kind === 'new' ? { ...current, parent: { ...current.parent, title: event.target.value } } : current,
                      )
                    }
                  />
                </span>
              ) : (
                <span className="text-ink">
                  {shown.parent.title} <span className="text-ink-faint">({t('cardDraft.parent.new')})</span>
                </span>
              )
            ) : (
              <span className="text-ink-soft">{t('cardDraft.parent.none')}</span>
            )}
            {shown.parent?.kind === 'new' && shown.parent.dueAt !== null ? (
              <span className="ml-2 text-ink-faint">{t('cardDraft.due', { day: formatDay(shown.parent.dueAt) })}</span>
            ) : null}
          </div>

          <ol className="mt-2 space-y-1.5">
            {shown.cards.map((card, index) => {
              const created = item.created.find((entry) => entry.key === card.key)
              const expanded = open === card.key
              return (
                <li key={card.key} className="rounded-md border border-line bg-canvas/60 px-2.5 py-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <IconButton
                      label={t(expanded ? 'cardDraft.card.collapse' : 'cardDraft.card.expand')}
                      onClick={() => setOpen(expanded ? null : card.key)}
                    >
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </IconButton>
                    {created ? (
                      <CardNumber number={created.number} title={created.title} to={cardLink(created.number)} />
                    ) : editable ? (
                      <input
                        aria-label={t('cardDraft.card.title', { index: String(index + 1) })}
                        className={cx(INPUT, 'font-medium')}
                        value={card.title}
                        onChange={(event) => update(card.key, { title: event.target.value })}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{card.title}</span>
                    )}
                    {card.subtasks.some((line) => line.trim()) ? (
                      <span className="shrink-0 text-meta text-ink-faint">
                        {t('cardDraft.card.subtasks', { count: String(card.subtasks.filter((line) => line.trim()).length) })}
                      </span>
                    ) : null}
                    {editable && shown.cards.length > 1 ? (
                      <IconButton label={t('cardDraft.card.remove')} onClick={() => setDraft((current) => withoutDraftCard(current, card.key))}>
                        <X size={14} />
                      </IconButton>
                    ) : null}
                  </div>

                  {expanded ? (
                    <div className="mt-2 flex flex-col gap-2 pl-7">
                      {editable ? (
                        <>
                          <textarea
                            aria-label={t('cardDraft.card.description')}
                            className={cx(INPUT, 'min-h-28 resize-y leading-relaxed')}
                            value={card.description}
                            onChange={(event) => update(card.key, { description: event.target.value })}
                          />
                          <textarea
                            aria-label={t('cardDraft.card.subtasksField')}
                            placeholder={t('cardDraft.card.subtasksHint')}
                            className={cx(INPUT, 'min-h-16 resize-y')}
                            value={card.subtasks.join('\n')}
                            onChange={(event) =>
                              update(card.key, { subtasks: event.target.value.split('\n') })
                            }
                          />
                        </>
                      ) : (
                        <>
                          {card.description ? <p className="whitespace-pre-wrap text-ink-soft">{card.description}</p> : null}
                          {card.subtasks.length > 0 ? (
                            <ul className="list-disc pl-4 text-ink-soft">
                              {card.subtasks.map((subtask) => (
                                <li key={subtask}>{subtask}</li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}

                  <Links
                    label={t('cardDraft.after')}
                    chips={[
                      ...card.after.map((key) => ({
                        id: `k:${key}`,
                        text: titleOf.get(key) ?? key,
                        remove: () => update(card.key, { after: card.after.filter((other) => other !== key) }),
                      })),
                      ...card.blockedBy.map((other) => ({
                        id: `c:${other.cardId}`,
                        text: `#${other.number} ${other.title}`,
                        remove: () => update(card.key, { blockedBy: card.blockedBy.filter((entry) => entry.cardId !== other.cardId) }),
                      })),
                    ]}
                    editable={editable}
                    removeLabel={t('cardDraft.link.remove')}
                  />
                  <Links
                    label={t('cardDraft.related')}
                    chips={card.related.map((other) => ({
                      id: `r:${other.cardId}`,
                      text: `#${other.number} ${other.title}`,
                      remove: () => update(card.key, { related: card.related.filter((entry) => entry.cardId !== other.cardId) }),
                    }))}
                    editable={editable}
                    removeLabel={t('cardDraft.link.remove')}
                  />
                </li>
              )
            })}
          </ol>

          {editable && problems.some((problem) => problem.code === 'cycle') ? (
            <p className="mt-2 text-xs text-critical">{t('cardDraft.problem.cycle')}</p>
          ) : null}
          {item.status === 'impossible' ? (
            <p className="mt-1.5 text-xs text-ink-soft">
              {(item.reason ? staleReasonLabel(item.reason, t) : null) ?? t('cardDraft.reason.unknown')}
            </p>
          ) : null}
        </div>
        {!pending ? (
          <Badge tone={item.status === 'created' ? 'positive' : 'neutral'}>{STATUS_LABEL[item.status as Exclude<CardDraftItem['status'], 'pending'>]}</Badge>
        ) : null}
      </div>

      {editable ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || problems.length > 0 || blank} onClick={() => void decide('created')}>
              {t(draft.parent?.kind === 'new' ? 'cardDraft.createWithParent' : 'cardDraft.create', { count: String(draft.cards.length) })}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide('refused')}>
              {t('cardDraft.refuse')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-faint">{t('cardDraft.hint')}</p>
        </>
      ) : null}

      {pending && !canDecide ? <p className="mt-2 text-xs text-ink-faint">{t('cardDraft.ownerOnly')}</p> : null}
      {error ? <p className="mt-2 text-xs text-critical">{error}</p> : null}
    </section>
  )
}

function CardNumber({ number, title, to }: { number: number; title: string; to: string | null }) {
  const body = (
    <>
      <span className="font-medium">#{number}</span> <span>{title}</span>
    </>
  )
  return to ? (
    <Link to={to} className="min-w-0 flex-1 truncate text-sm text-ink hover:underline">
      {body}
    </Link>
  ) : (
    <span className="min-w-0 flex-1 truncate text-sm text-ink">{body}</span>
  )
}

/** Une ligne de liens, chacun retirable d'un clic tant que le brouillon attend. */
function Links({
  label,
  chips,
  editable,
  removeLabel,
}: {
  label: string
  chips: { id: string; text: string; remove: () => void }[]
  editable: boolean
  removeLabel: string
}) {
  if (chips.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-7">
      <span className="text-ink-faint">{label}</span>
      {chips.map((chip) => (
        <span key={chip.id} className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-line bg-surface px-2 py-0.5 text-ink-soft">
          <span className="truncate">{chip.text}</span>
          {editable ? (
            <button type="button" aria-label={`${removeLabel} ${chip.text}`} className="shrink-0 text-ink-faint hover:text-ink" onClick={chip.remove}>
              <X size={11} />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}
