import { Check, CircleDashed } from 'lucide-react'
import { Card, CardBody } from '@solera/ui'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import type { OnboardingStepId } from '../../lib/onboarding'
import { useUserSettings } from '../../lib/user-settings'
import { AGENT_LABELS } from '../AgentIcon'
import { useAgentDefaults } from './defaults'
import { StepTitle, useCommit, useGate, type StepProps } from './shell'

/**
 * Le récapitulatif : ce qui a été réglé, ce qui a été passé, et où le reprendre. Les
 * étapes passées le restent sans reproche : chacune a sa section dans les réglages.
 */
export function ReadyStep({ nav, state, steps }: StepProps & { steps: OnboardingStepId[] }) {
  const t = useTranslate()
  const defaults = useAgentDefaults()
  const { data: settings } = useUserSettings()
  useGate(nav, { canContinue: true, laterAllowed: false, skipAllowed: false })
  useCommit(nav, null)

  const answers = state.answers
  const lines: { label: string; value: string }[] = [
    {
      label: t('onboarding.ready.agents'),
      value: answers.agents.length > 0 ? answers.agents.map((agent) => AGENT_LABELS[agent]).join(', ') : t('onboarding.ready.none'),
    },
    {
      label: t('onboarding.ready.reflex'),
      value: t(`onboarding.permissions.reflex.${defaults.claudeReflex ?? answers.permission}` as MessageKey),
    },
    {
      label: t('composer.setting.agentMemory'),
      value: t(defaults.family('agentMemory') ? 'composer.agentMemory.on' : 'composer.agentMemory.off'),
    },
    {
      label: t('onboarding.instructions.mode'),
      value: t(`instructions.mode.${settings?.projectDefaults.instructionsMode ?? 'auto'}` as MessageKey),
    },
  ]
  const skipped = steps.filter((id) => state.skipped.includes(id))

  return (
    <>
      <StepTitle title={t('onboarding.ready.title')} lead={t('onboarding.ready.lead')} />
      <Card>
        <CardBody>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            {lines.map((line) => (
              <div key={line.label} className="contents">
                <dt className="text-ink-faint">{line.label}</dt>
                <dd className="text-ink">{line.value}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
      {skipped.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">{t('onboarding.ready.skipped')}</h2>
          <ul className="flex flex-col gap-1.5 text-sm text-ink-soft">
            {skipped.map((id) => (
              <li key={id} className="flex items-center gap-2">
                <CircleDashed size={14} className="text-ink-faint" aria-hidden />
                {t(`onboarding.step.${id}` as MessageKey)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-faint">{t('onboarding.ready.skipped.hint')}</p>
        </section>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Check size={14} className="text-positive" aria-hidden />
          {t('onboarding.ready.complete')}
        </p>
      )}
    </>
  )
}
