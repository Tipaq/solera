import { spottedChips, type BriefReading } from '../../lib/brief'
import { useTranslate } from '../../lib/i18n'
import type { BriefAttachments } from './use-brief-attachments'

/** « Repéré » et ses puces : ce que la lecture du brief a trouvé, et ce qui est joint. */
export function BriefSpotted({ reading, attachments }: { reading: BriefReading; attachments: BriefAttachments }) {
  const t = useTranslate()
  const chips = spottedChips(reading, { cards: attachments.cards.length, links: attachments.links.length, files: attachments.files.length })
  if (!chips.length) return null
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-faint">
      <span>{t('brief.spotted')}</span>
      {chips.map((chip, index) => (
        <span key={chip.key} className="text-ink-soft">
          {t(chip.key, { count: chip.count })}
          {index < chips.length - 1 ? <span className="text-ink-faint">,</span> : null}
        </span>
      ))}
    </span>
  )
}
