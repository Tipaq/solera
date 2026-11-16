import { Info } from 'lucide-react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { Tooltip, cx } from '@solera/ui'
import { withSheet } from '../../lib/card-sheet'
import { useTranslate } from '../../lib/i18n'

/**
 * L'icône `ℹ` d'une carte cliquable (FCH-1) : elle ouvre la fiche **sur place**
 * (`?fiche=N`), et non la session où mène la carte. La page monte `CardSheetHost`.
 */
export function CardInfoButton({ card, className }: { card: Pick<CardDto, 'number'>; className?: string }) {
  const t = useTranslate()
  const [, setParams] = useSearchParams()
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setParams((current) => withSheet(current, card.number))
  }
  /* Un `span` qui joue le bouton, et non un `button` : l'icône se pose dans des liens et
     des boutons (la carte entière mène à sa session), où un bouton imbriqué est invalide.
     `pointerdown` arrêté aussi : une ligne glissable ne doit pas partir d'un clic sur `ℹ`. */
  return (
    <Tooltip label={t('cardSheet.info.tip')}>
      <span
        role="button"
        tabIndex={0}
        aria-label={t('cardSheet.info.label', { number: card.number })}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') open(event)
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className={cx(
          'inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface-high hover:text-ink',
          // 20 px à la souris ; au doigt, une zone de 44 px autour, sans déplacer la ligne.
          "relative pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-['']",
          'focus-visible:outline-2 focus-visible:outline-accent',
          className,
        )}
      >
        <Info size={13} aria-hidden />
      </span>
    </Tooltip>
  )
}
