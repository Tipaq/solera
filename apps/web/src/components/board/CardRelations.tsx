import { Plus, X } from 'lucide-react'
import type { CardDto } from '@solera/protocol'
import { useAddCardRelation, useRemoveCardRelation } from '../../lib/cards'
import { useTranslate } from '../../lib/i18n'
import { Button, IconButton } from '@solera/ui'
import { BlockList, LinkButton } from './CardBlocks'
import { CardChooser } from './CardChooser'

/**
 * Les liens informatifs d'une carte (#109) : ils ne changent ni l'ordre du travail ni la
 * colonne, à la différence de la parente et des blocages. Un agent les pose seul, par
 * `relate_cards`, et ils se retirent d'ici d'un geste.
 *
 * « Doublon de » est une ligne de propriété, à valeur unique comme la parente : une
 * copie n'a qu'une originale. « Liée à » est une liste, lue des deux bouts.
 */
export function CardDuplicateOf({
  card,
  projectId,
  onSelectCard,
}: {
  card: CardDto
  projectId: string
  onSelectCard: (number: number) => void
}) {
  const t = useTranslate()
  const add = useAddCardRelation(projectId, card.id)
  const remove = useRemoveCardRelation(projectId, card.id)
  const original = card.duplicateOf

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {original ? (
        <>
          <button
            type="button"
            onClick={() => onSelectCard(original.number)}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-ink-soft hover:bg-surface-high hover:text-ink"
          >
            <span className="shrink-0 text-meta text-ink-faint">#{original.number}</span>
            <span className="min-w-0 truncate">{original.title}</span>
          </button>
          <IconButton
            label={t('board.card.duplicateOf.clear')}
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ kind: 'duplicate_of', targetId: original.id })}
          >
            <X size={13} />
          </IconButton>
        </>
      ) : (
        <CardChooser
          projectId={projectId}
          label={t('board.card.duplicateOf.choose')}
          // Ni elle-même, ni ses propres doublons : deux cartes doublons l'une de l'autre
          // n'auraient plus d'originale, et le serveur le refuse.
          excludeIds={[card.id, ...card.duplicates.map((link) => link.id)]}
          onPick={(picked) => add.mutate({ kind: 'duplicate_of', targetId: picked.id })}
          trigger={
            <Button variant="ghost" size="sm">
              {t('board.card.duplicateOf.choose')}
            </Button>
          }
        />
      )}
    </div>
  )
}

export function CardRelated({
  card,
  projectId,
  onSelectCard,
}: {
  card: CardDto
  projectId: string
  onSelectCard: (number: number) => void
}) {
  const t = useTranslate()
  const add = useAddCardRelation(projectId, card.id)
  const remove = useRemoveCardRelation(projectId, card.id)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{t('board.card.related')}</h3>
          <CardChooser
            projectId={projectId}
            label={t('board.card.related.add')}
            excludeIds={[card.id, ...card.related.map((link) => link.id)]}
            onPick={(picked) => add.mutate({ kind: 'related', targetId: picked.id })}
            trigger={
              <Button variant="ghost" size="sm" icon={<Plus size={14} />}>
                {t('board.card.related.add')}
              </Button>
            }
          />
        </div>
        {card.related.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('board.card.related.none')}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {card.related.map((link) => (
              <li key={link.id} className="flex items-center gap-1">
                <LinkButton link={link} onSelect={onSelectCard} />
                <IconButton
                  label={t('board.card.related.remove', { number: link.number })}
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ kind: 'related', targetId: link.id })}
                >
                  <X size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {add.isError ? (
          <p role="alert" className="text-sm text-critical">
            {t('board.card.related.error')}
          </p>
        ) : null}
      </div>

      {card.duplicates.length > 0 ? (
        <BlockList title={t('board.card.duplicates')} links={card.duplicates} onSelect={onSelectCard} />
      ) : null}
    </div>
  )
}
