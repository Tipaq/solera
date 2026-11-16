import { Tooltip, cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { maturityTooltip, type Maturity, type MilestoneEntry } from '../../lib/milestone-model'
import { MATURITY_TONE } from './tones'

/**
 * L'étape d'un jalon en pastille (MAT-8). Avec son jalon, l'infobulle dit pourquoi il en
 * est là : « À régler — 1 carte est à préciser : #12. »
 */
export function MaturityPill({ maturity, entry }: { maturity: Maturity; entry?: MilestoneEntry }) {
  const t = useTranslate()
  const pill = (
    <span className={cx('inline-flex shrink-0 rounded-full px-2 py-0.5 text-meta font-medium whitespace-nowrap', MATURITY_TONE[maturity])}>
      {t(`milestones.maturity.label.${maturity}`)}
    </span>
  )
  return entry ? <Tooltip label={maturityTooltip(entry, t)}>{pill}</Tooltip> : pill
}
