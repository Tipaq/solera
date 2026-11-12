import { Check } from 'lucide-react'
import { useState } from 'react'
import { Button, Popover, Tooltip, TooltipButton, cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { MATURITIES, maturityReasons, reasonText, type Maturity, type MilestoneEntry } from '../../lib/milestone-model'

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

/**
 * Une étape expliquée (JAL-5) : l'étape courante dit pourquoi le jalon y est et comment
 * passer à la suivante, avec le geste ; une autre dit quand il y était ou y sera.
 */
function StepCard({
  step,
  entry,
  action,
  onAct,
  close,
}: {
  step: Maturity
  entry: MilestoneEntry
  action: { label: string; detail: string }
  onAct: (() => void) | null
  close: () => void
}) {
  const t = useTranslate()
  const at = MATURITIES.indexOf(entry.maturity)
  const index = MATURITIES.indexOf(step)
  const current = index === at
  return (
    <div className="flex w-80 max-w-full flex-col gap-3 p-3.5 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-ink-faint tabular-nums">{t('milestones.maturity.step.position', { index: index + 1 })}</span>
        <span className="font-semibold text-ink">{t(`milestones.maturity.label.${step}`)}</span>
        <span className="ml-auto text-xs text-ink-faint">
          {t(current ? 'milestones.maturity.step.now' : index < at ? 'milestones.maturity.step.passed' : 'milestones.maturity.step.coming')}
        </span>
      </div>
      {current ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-faint">{t('milestones.maturity.step.whyHere')}</span>
            <ul className="flex flex-col gap-1">
              {maturityReasons(entry).map((reason) => (
                <li key={reason.kind} className="text-ink-soft">{reasonText(reason, t)}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-faint">{t('milestones.maturity.step.toNext')}</span>
            <p className="text-ink-soft">{t(`milestones.maturity.rule.${step}.leave`)}</p>
            {onAct ? (
              <Button
                size="sm"
                className="self-start"
                onClick={() => {
                  close()
                  onAct()
                }}
              >
                {action.label}
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-faint">
            {t(index < at ? 'milestones.maturity.step.wasWhen' : 'milestones.maturity.step.willBeWhen')}
          </span>
          <p className="text-ink-soft">{t(`milestones.maturity.rule.${step}.when`)}</p>
        </div>
      )}
    </div>
  )
}

/**
 * Les six étapes de la bande d'un jalon (JAL-5), chacune ouvrant sa fiche. Au doigt, les
 * libellés se marcheraient dessus : les traits seuls, et l'étape courante écrite en
 * clair dessous, qui ouvre sa fiche.
 */
export function ExplainedSteps({
  entry,
  action,
  onAct,
}: {
  entry: MilestoneEntry
  action: { label: string; detail: string }
  onAct: (() => void) | null
}) {
  const t = useTranslate()
  const [open, setOpen] = useState<Maturity | null>(null)
  const at = MATURITIES.indexOf(entry.maturity)
  return (
    <div className="flex flex-col gap-1.5">
      <ol className="grid grid-cols-6 gap-1">
        {MATURITIES.map((step, index) => (
          <li key={step} className="min-w-0">
            <Popover
              open={open === step}
              onOpenChange={(next) => setOpen(next ? step : null)}
              label={t('milestones.maturity.step.label', { step: t(`milestones.maturity.label.${step}`) })}
              side="bottom"
              align={index > 3 ? 'end' : 'start'}
              className="p-0"
              trigger={
                <TooltipButton
                  type="button"
                  aria-label={t('milestones.maturity.step.label', { step: t(`milestones.maturity.label.${step}`) })}
                  title={t('milestones.maturity.step.why')}
                  className="group flex w-full min-w-0 flex-col gap-1.5 rounded-md pt-1 pb-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span
                    className={cx(
                      'h-1.5 rounded-full transition-colors',
                      index < at ? 'bg-accent/50' : index === at ? 'bg-accent' : 'bg-surface-high group-hover:bg-line-strong',
                    )}
                  />
                  <span
                    className={cx(
                      'hidden items-center gap-1 truncate text-xs underline-offset-2 group-hover:underline sm:flex',
                      index === at ? 'font-semibold text-ink' : index < at ? 'text-ink-soft' : 'text-ink-faint',
                    )}
                  >
                    {index < at ? <Check size={11} aria-hidden className="shrink-0 text-accent" /> : null}
                    {t(`milestones.maturity.label.${step}`)}
                  </span>
                </TooltipButton>
              }
            >
              <StepCard step={step} entry={entry} action={action} onAct={onAct} close={() => setOpen(null)} />
            </Popover>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => setOpen(entry.maturity)}
        className="self-start rounded text-xs text-ink-soft outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent sm:hidden"
      >
        {t('milestones.maturity.step.mobile', { index: at + 1 })} ·{' '}
        <span className="font-semibold text-ink">{t(`milestones.maturity.label.${entry.maturity}`)}</span> ·{' '}
        {t('milestones.maturity.step.mobileWhy')}
      </button>
    </div>
  )
}
