import { cx } from '@solera/ui'
import { pluralOf } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'
import { openInboxItem } from './AskInbox'

/**
 * Le repère d'un jalon qui t'attend : un point ambre et « N t'attend ». Il ne redit pas
 * la demande — elle vit dans « Ce qui t'attend », une seule fois — : il y mène et la
 * déplie (`openInboxItem`).
 */
export function WaitingMark({ waiting, className }: { waiting: { count: number; key: string }; className?: string }) {
  const t = useTranslate()
  return (
    <button
      type="button"
      onClick={() => openInboxItem(waiting.key)}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-caution ring-1 ring-caution/40 transition-colors ring-inset hover:bg-caution/10 focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11',
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-caution" />
      {t(`inbox.waiting.${pluralOf(waiting.count)}`, { count: waiting.count })}
    </button>
  )
}
