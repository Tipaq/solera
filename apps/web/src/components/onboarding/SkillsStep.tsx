import { Library } from 'lucide-react'
import { useState } from 'react'
import { SwitchRow } from '@solera/ui'
import { SkillLibrarySettingsPage } from '../../routes/SkillLibrarySettingsPage'
import { useTranslate } from '../../lib/i18n'
import { withFamily } from '../../lib/onboarding'
import { useSkillLibrary } from '../../lib/skill-library'
import { useAgentDefaults } from './defaults'
import { StepTitle, Why, useCommit, useGate, type StepProps } from './shell'

/**
 * La bibliothèque de skills : écrits une fois, livrés aux quatre CLI. L'interrupteur
 * est la famille `skillLibrary` des défauts du compte ; la bibliothèque elle-même, la
 * section des réglages, ouverte ici telle quelle.
 */
export function SkillsStep({ nav }: StepProps) {
  const t = useTranslate()
  const defaults = useAgentDefaults()
  const { data: library } = useSkillLibrary(null)
  const [delivered, setDelivered] = useState<boolean | null>(null)
  const on = delivered ?? defaults.family('skillLibrary')

  useGate(nav, { canContinue: defaults.ready, laterAllowed: true, skipAllowed: true })
  useCommit(nav, async () => {
    if (delivered !== null) await defaults.apply((config) => withFamily(config, 'skillLibrary', delivered))
  })

  return (
    <>
      <StepTitle title={t('onboarding.skills.title')} lead={t('onboarding.skills.lead')} />
      <Why>{t('onboarding.skills.why')}</Why>
      {library?.enabled === false ? null : (
        <SwitchRow
          checked={on}
          onCheckedChange={setDelivered}
          icon={<Library size={16} />}
          label={t('composer.setting.skillLibrary')}
          description={t(on ? 'composer.skillLibrary.on.hint' : 'composer.skillLibrary.off.hint')}
        />
      )}
      <details>
        <summary className="cursor-pointer py-1 text-sm font-medium text-ink-soft">
          {t('onboarding.skills.library')}
        </summary>
        <div className="pt-3">
          <SkillLibrarySettingsPage />
        </div>
      </details>
    </>
  )
}
