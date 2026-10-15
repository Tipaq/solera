import type { CardColumn } from '@solera/protocol'
import { cx } from '@solera/ui'
import { COLUMN_TONES, columnLabel } from './columns'

/** L'état d'une carte citée, sans le poids d'une pastille pleine dans une liste. */
export function ColumnDot({ column }: { column: CardColumn }) {
  const tone = COLUMN_TONES[column]
  return (
    <span
      title={columnLabel(column)}
      className={cx(
        'size-1.5 shrink-0 rounded-full',
        tone === 'accent' && 'bg-accent',
        tone === 'caution' && 'bg-caution',
        tone === 'positive' && 'bg-positive',
        tone === 'neutral' && 'bg-line-strong',
      )}
    />
  )
}
