/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * La maturité expliquée (flux v3) : chaque étape de la bande s'ouvre sur une petite
 * fiche. Pour l'étape courante, « Pourquoi il est ici » (les raisons concrètes) et « Pour
 * passer à l'étape suivante » (le geste, cliquable) ; pour les autres, la règle qui y
 * fait entrer. Mêmes règles qu'`analyse` (`maturity.ts`), dites pour un humain.
 */
import { Check } from 'lucide-react'
import { useState } from 'react'
import { Button, Popover, cx } from '@solera/ui'
import { MATURITIES, MATURITY_LABEL, MATURITY_RULE, maturityReasons, type HorizonMilestone, type Maturity } from './maturity'

function StepCard({ step, entry, action, onAct, close }: {
  step: Maturity
  entry: HorizonMilestone
  action: { label: string; detail: string }
  onAct: (() => void) | null
  close: () => void
}) {
  const at = MATURITIES.indexOf(entry.maturity)
  const index = MATURITIES.indexOf(step)
  const current = step === entry.maturity
  const rule = MATURITY_RULE[step]
  return (
    <div className="flex w-80 flex-col gap-3 p-3.5 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-ink-faint tabular-nums">{index + 1}/6</span>
        <span className="font-semibold text-ink">{MATURITY_LABEL[step]}</span>
        <span className="ml-auto text-xs text-ink-faint">{current ? 'ici maintenant' : index < at ? 'franchie' : 'à venir'}</span>
      </div>
      {current ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-faint">Pourquoi il est ici</span>
            <ul className="flex flex-col gap-1">
              {maturityReasons(entry).map((reason) => (
                <li key={reason} className="text-ink-soft">{reason}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-faint">Pour passer à l’étape suivante</span>
            <p className="text-ink-soft">{rule.leave}</p>
            {onAct ? (
              <Button size="sm" className="self-start" onClick={() => { close(); onAct() }}>{action.label}</Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-faint">{index < at ? 'Il y était quand' : 'Il y sera quand'}</span>
          <p className="text-ink-soft">{rule.when}</p>
        </div>
      )}
    </div>
  )
}

/** Les six étapes de la bande, chacune ouvrant sa fiche. */
export function ExplainedSteps({ entry, action, onAct }: {
  entry: HorizonMilestone
  action: { label: string; detail: string }
  onAct: (() => void) | null
}) {
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
              label={`Étape ${MATURITY_LABEL[step]}`}
              side="bottom"
              align={index > 3 ? 'end' : 'start'}
              className="p-0"
              trigger={
                <button
                  type="button"
                  className="group flex w-full min-w-0 flex-col gap-1.5 rounded-md pt-1 pb-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  title="Pourquoi cette étape ?"
                >
                  <span className={cx('h-1.5 rounded-full transition-colors', index < at ? 'bg-accent/50' : index === at ? 'bg-accent' : 'bg-surface-high group-hover:bg-line-strong')} />
                  <span
                    className={cx(
                      'hidden items-center gap-1 truncate text-xs underline-offset-2 group-hover:underline sm:flex',
                      index === at ? 'font-semibold text-ink' : index < at ? 'text-ink-soft' : 'text-ink-faint',
                    )}
                  >
                    {index < at ? <Check size={11} className="shrink-0 text-accent" /> : null}
                    {MATURITY_LABEL[step]}
                  </span>
                </button>
              }
            >
              <StepCard step={step} entry={entry} action={action} onAct={onAct} close={() => setOpen(null)} />
            </Popover>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => setOpen(entry.maturity)} className="self-start text-xs text-ink-soft hover:text-ink sm:hidden">
        Étape {at + 1}/6 · <span className="font-semibold text-ink">{MATURITY_LABEL[entry.maturity]}</span> · pourquoi ?
      </button>
    </div>
  )
}
