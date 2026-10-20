import { X } from 'lucide-react'
import type { CardDto, CardLinkDto } from '@solera/protocol'
import { useCards, useUpdateCard } from '../../lib/cards'
import { dayFromInput, dayInputValue } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { Button, IconButton, cx } from '@solera/ui'
import { CardChooser } from './CardChooser'

/**
 * L'échéance et le jalon d'une carte : les deux propriétés qu'on règle sur place.
 *
 * Deux champs et pas cinq : la maquette T2 en empilait autant qu'un ticket de forge,
 * et des cinq proposés un seul ajoute une colonne porteuse de sens nouveau (la date),
 * un autre réutilise la carte elle-même (le jalon). Chacun est une ligne du tableau des
 * propriétés de `CardDetail`, qu'on lit avant de lire ce qu'il y a à faire.
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

export function CardMilestone({
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
   * Les cartes qui servent déjà de jalon, proposées d'abord.
   *
   * Aucun drapeau ne les distingue : une carte **est** un jalon dès que quelque chose
   * la désigne, donc la liste se déduit de ce que les autres cartes pointent. Rien à
   * tenir, rien à corriger quand on se trompe — et un jalon cesse d'en être un quand
   * la dernière carte qui le désignait le lâche.
   */
  const milestones = new Map<string, CardLinkDto>()
  for (const other of cards ?? []) {
    if (other.milestone) milestones.set(other.milestone.id, other.milestone)
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {card.milestone ? (
        <>
          <button
            type="button"
            onClick={() => onSelectCard(card.milestone?.number ?? card.number)}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-ink-soft hover:bg-surface-high hover:text-ink"
          >
            <span className="shrink-0 text-meta text-ink-faint">#{card.milestone.number}</span>
            <span className="min-w-0 truncate">{card.milestone.title}</span>
          </button>
          <IconButton
            label={t('board.card.milestone.clear')}
            size="sm"
            onClick={() => updateCard.mutate({ id: card.id, milestoneCardId: null })}
          >
            <X size={13} />
          </IconButton>
        </>
      ) : (
        <CardChooser
          projectId={projectId}
          label={t('board.card.milestone.choose')}
          excludeIds={[card.id]}
          suggested={[...milestones.values()]}
          suggestedLabel={t('board.card.milestone.existing')}
          onPick={(picked) => updateCard.mutate({ id: card.id, milestoneCardId: picked.id })}
          trigger={
            <Button variant="ghost" size="sm">
              {t('board.card.milestone.choose')}
            </Button>
          }
        />
      )}
    </div>
  )
}
