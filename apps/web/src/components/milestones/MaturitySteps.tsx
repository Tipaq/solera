import { Tooltip, cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { MATURITIES, type Maturity } from '../../lib/milestone-model'

/**
 * Les six étapes en traits fins (MAT-9) : franchies en accent atténué, la courante en
 * accent, celles à venir en gris. Chaque trait nomme son étape au survol.
 */
export function MaturitySteps({ maturity }: { maturity: Maturity }) {
  const t = useTranslate()
  const at = MATURITIES.indexOf(maturity)
  return (
    <div
      role="img"
      aria-label={t('milestones.maturity.aria', { step: t(`milestones.maturity.label.${maturity}`) })}
      className="flex items-center gap-1"
    >
      {MATURITIES.map((step, index) => (
        <Tooltip key={step} label={t(`milestones.maturity.label.${step}`)}>
          <span
            className={cx(
              'h-1 flex-1 rounded-full',
              index < at ? 'bg-accent/50' : index === at ? 'bg-accent' : 'bg-surface-high',
            )}
          />
        </Tooltip>
      ))}
    </div>
  )
}
