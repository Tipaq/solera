import { useSearchParams } from 'react-router-dom'
import { cx } from '@solera/ui'
import { withSheet } from '../../lib/card-sheet'
import type { CodeCard } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'
import { MilestoneChip } from './MilestoneChip'

/**
 * La carte d'un arbre ou d'une branche : « #n titre », qui ouvre sa fiche sur place
 * (`?fiche=`, la page monte `CardSheetHost`), et « ⚑ Jalon #m », qui mène au jalon.
 *
 * Une carte que le serveur a **déduite** du nom de la branche (`source: 'name'`) le dit
 * dans son infobulle, et à un lecteur d'écran : rien ne l'a rattachée à l'arbre.
 */
export function CardRef({ projectId, card, className }: { projectId: string; card: CodeCard; className?: string }) {
  const t = useTranslate()
  const [, setParams] = useSearchParams()
  const deduced = card.source === 'name'
  return (
    <span className={cx('relative z-[1] flex min-w-0 items-center gap-1.5 text-xs text-ink-faint', className)}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setParams((current) => withSheet(current, card.number))
        }}
        title={deduced ? t('code.card.deduced') : card.title}
        className="min-w-0 truncate rounded text-left underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="tabular-nums">#{card.number}</span> {card.title}
        {deduced ? <span className="sr-only"> — {t('code.card.deduced')}</span> : null}
      </button>
      {card.milestone ? <MilestoneChip milestone={card.milestone} to={`/p/${projectId}/timeline/${card.milestone.number}`} /> : null}
    </span>
  )
}
