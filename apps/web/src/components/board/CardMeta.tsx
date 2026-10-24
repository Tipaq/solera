import { Link2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { CardDto } from '@solera/protocol'
import { ancestorIds, descendantIds, useCards, useCreateCard, useUpdateCard } from '../../lib/cards'
import { dayFromInput, dayInputValue } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { Button, IconButton, cx } from '@solera/ui'
import { CardChooser } from './CardChooser'
import { ColumnDot } from './ColumnDot'

/**
 * L'échéance et la place dans l'arbre d'une carte : ce qu'on règle sur place.
 *
 * Deux champs et pas cinq : la maquette T2 en empilait autant qu'un ticket de forge,
 * et des cinq proposés un seul ajoute une colonne porteuse de sens nouveau (la date),
 * un autre réutilise la carte elle-même (la parente). Chacun est une ligne du tableau
 * des propriétés de `CardDetail`, qu'on lit avant de lire ce qu'il y a à faire.
 */
export function CardDue({ card, projectId }: { card: CardDto; projectId: string }) {
  const t = useTranslate()
  const updateCard = useUpdateCard(projectId)
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label className="sr-only" htmlFor={`due-${card.id}`}>
        {t('board.card.due')}
      </label>
      <input
        id={`due-${card.id}`}
        type="date"
        value={card.dueAt === null ? '' : dayInputValue(card.dueAt)}
        onChange={(event) => {
          const dueAt = dayFromInput(event.target.value)
          // Un champ vidé est une échéance retirée ; une saisie en cours (« 20 » dans
          // l'année) n'est pas une date et n'écrit rien.
          if (dueAt === null && event.target.value !== '') return
          updateCard.mutate({ id: card.id, dueAt })
        }}
        className={cx(
          'min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-ink-soft outline-none',
          'hover:border-line focus:border-accent',
          card.dueAt === null && 'text-ink-faint',
        )}
      />
      {card.dueAt !== null ? (
        <IconButton
          label={t('board.card.due.clear')}
          size="sm"
          onClick={() => updateCard.mutate({ id: card.id, dueAt: null })}
        >
          <X size={13} />
        </IconButton>
      ) : null}
    </div>
  )
}

export function CardParent({
  card,
  projectId,
  onSelectCard,
}: {
  card: CardDto
  projectId: string
  onSelectCard: (number: number) => void
}) {
  const t = useTranslate()
  const updateCard = useUpdateCard(projectId)
  const { data: cards } = useCards(projectId)

  /**
   * Les cartes qui ont déjà des enfants, proposées d'abord : une parente se réutilise
   * bien plus souvent qu'il ne s'en crée. Ni la carte ni ses descendantes : l'arbre
   * ferait une boucle, et le serveur le refuserait.
   */
  const below = descendantIds(cards ?? [], card.id)
  const parents = (cards ?? []).filter((other) => other.children.length > 0 && other.id !== card.id && !below.has(other.id))

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {card.parent ? (
        <>
          <button
            type="button"
            onClick={() => onSelectCard(card.parent?.number ?? card.number)}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-ink-soft hover:bg-surface-high hover:text-ink"
          >
            <span className="shrink-0 text-meta text-ink-faint">#{card.parent.number}</span>
            <span className="min-w-0 truncate">{card.parent.title}</span>
          </button>
          <IconButton
            label={t('board.card.parent.clear')}
            size="sm"
            onClick={() => updateCard.mutate({ id: card.id, parentId: null })}
          >
            <X size={13} />
          </IconButton>
        </>
      ) : (
        <CardChooser
          projectId={projectId}
          label={t('board.card.parent.choose')}
          excludeIds={[card.id, ...below]}
          suggested={parents.map(({ id, number, title, column }) => ({ id, number, title, column }))}
          suggestedLabel={t('board.card.parent.existing')}
          onPick={(picked) => updateCard.mutate({ id: card.id, parentId: picked.id })}
          trigger={
            <Button variant="ghost" size="sm">
              {t('board.card.parent.choose')}
            </Button>
          }
        />
      )}
    </div>
  )
}

/**
 * Les enfants d'une carte, et les deux façons de la découper : lui créer un enfant, ou
 * rattacher sous elle une carte qui existe déjà. La carte ne change pas de nature en
 * gagnant des enfants ; elle sort du kanban, qui ne montre que les feuilles, et sa
 * colonne suit désormais la leur.
 */
export function CardChildren({
  card,
  projectId,
  onSelectCard,
}: {
  card: CardDto
  projectId: string
  onSelectCard: (number: number) => void
}) {
  const t = useTranslate()
  const updateCard = useUpdateCard(projectId)
  const createCard = useCreateCard(projectId)
  const { data: cards } = useCards(projectId)
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)

  // Ni elle-même, ni ses ancêtres (l'arbre bouclerait), ni ses enfants déjà là.
  const above = ancestorIds(cards ?? [], card)
  const excluded = [card.id, ...above, ...card.children.map((child) => child.id)]

  const submit = () => {
    const value = title.trim()
    if (!value || createCard.isPending) return
    createCard.mutate({ title: value, parentId: card.id }, { onSuccess: () => setTitle('') })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{t('board.card.children')}</h3>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
            {t('board.card.children.new')}
          </Button>
          <CardChooser
            projectId={projectId}
            label={t('board.card.children.attach')}
            excludeIds={excluded}
            onPick={(picked) => updateCard.mutate({ id: picked.id, parentId: card.id })}
            trigger={
              <IconButton label={t('board.card.children.attach')} size="sm">
                <Link2 size={14} />
              </IconButton>
            }
          />
        </div>
      </div>
      {adding ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={title}
            maxLength={200}
            aria-label={t('board.card.children.new')}
            placeholder={t('board.card.new.placeholder')}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
              if (event.key === 'Escape') {
                setAdding(false)
                setTitle('')
              }
            }}
            className="min-h-9 min-w-0 flex-1 rounded-md border border-line bg-sunken px-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <IconButton label={t('board.card.cancel')} size="sm" onClick={() => { setAdding(false); setTitle('') }}>
            <X size={13} />
          </IconButton>
        </div>
      ) : null}
      {card.children.length === 0 ? (
        adding ? null : <p className="text-sm text-ink-faint">{t('board.card.children.none')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {card.children.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                onClick={() => onSelectCard(child.number)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-ink-soft hover:bg-surface-high hover:text-ink"
              >
                <span className="shrink-0 text-meta text-ink-faint">#{child.number}</span>
                <span className="min-w-0 flex-1 truncate">{child.title}</span>
                <ColumnDot column={child.column} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {createCard.isError || updateCard.isError ? (
        <p role="alert" className="text-sm text-critical">{t('board.card.saveError')}</p>
      ) : null}
    </div>
  )
}
