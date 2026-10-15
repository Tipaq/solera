import { Plus, X } from 'lucide-react'
import type { CardDto, CardLinkDto } from '@solera/protocol'
import { useAddCardBlock, useRemoveCardBlock } from '../../lib/cards'
import { useTranslate } from '../../lib/i18n'
import { Button, IconButton } from '@solera/ui'
import { CardChooser } from './CardChooser'
import { ColumnDot } from './ColumnDot'

/**
 * Les liens « bloque », posés à la main et tenus à l'écart des références `#12`.
 *
 * Deux listes et pas une : « bloque » et « bloquée par » sont le même lien lu des deux
 * bouts, et c'est la seconde qui porte la consigne qu'on vient chercher — n'ouvre pas
 * celle-ci avant celles-là. Le bouton n'existe que du côté « bloque » : un lien se
 * pose depuis la carte qui empêche, et le pose à l'envers ferait deux gestes pour la
 * même chose.
 */
export function CardBlocks({
  card,
  projectId,
  onSelectCard,
}: {
  card: CardDto
  projectId: string
  onSelectCard: (number: number) => void
}) {
  const t = useTranslate()
  const add = useAddCardBlock(projectId, card.id)
  const remove = useRemoveCardBlock(projectId, card.id)

  const linked = [
    card.id,
    ...card.blocks.map((link) => link.id),
    ...card.blockedBy.map((link) => link.id),
  ]

  return (
    <div className="flex flex-col gap-4">
      {card.blockedBy.length > 0 ? (
        <BlockList
          title={t('board.card.blockedBy')}
          links={card.blockedBy}
          onSelect={onSelectCard}
        />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">
            {t('board.card.blocks')}
          </h3>
          <CardChooser
            projectId={projectId}
            label={t('board.card.blocks.add')}
            excludeIds={linked}
            onPick={(picked) => add.mutate(picked.id)}
            trigger={
              <Button variant="ghost" size="sm" icon={<Plus size={14} />}>
                {t('board.card.blocks.add')}
              </Button>
            }
          />
        </div>
        {card.blocks.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('board.card.blocks.none')}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {card.blocks.map((link) => (
              <li key={link.id} className="flex items-center gap-1">
                <LinkButton link={link} onSelect={onSelectCard} />
                <IconButton
                  label={t('board.card.blocks.remove', { number: link.number })}
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(link.id)}
                >
                  <X size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {add.isError ? (
          <p role="alert" className="text-sm text-critical">
            {t('board.card.blocks.error')}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function BlockList({
  title,
  links,
  onSelect,
}: {
  title: string
  links: CardLinkDto[]
  onSelect: (number: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{title}</h3>
      <ul className="flex flex-col gap-0.5">
        {links.map((link) => (
          <li key={link.id}>
            <LinkButton link={link} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function LinkButton({
  link,
  onSelect,
}: {
  link: CardLinkDto
  onSelect: (number: number) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(link.number)}
      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-ink-soft hover:bg-surface-high hover:text-ink"
    >
      <span className="shrink-0 text-meta text-ink-faint">#{link.number}</span>
      <span className="min-w-0 flex-1 truncate">{link.title}</span>
      <ColumnDot column={link.column} />
    </button>
  )
}
