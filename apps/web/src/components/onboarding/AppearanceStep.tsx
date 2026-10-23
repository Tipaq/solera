import { AppearanceSection } from '../../routes/AppearanceSection'
import { useTranslate } from '../../lib/i18n'
import { StepTitle, useCommit, useGate, type StepProps } from './shell'

/**
 * L'apparence, telle que la section des réglages la montre : la visite ne la refait
 * pas, elle l'ouvre plus tôt. Chaque choix s'applique et s'enregistre au clic.
 */
export function AppearanceStep({ nav }: StepProps) {
  const t = useTranslate()
  useGate(nav, { canContinue: true, laterAllowed: true, skipAllowed: true })
  useCommit(nav, null)

  return (
    <>
      <StepTitle title={t('onboarding.appearance.title')} lead={t('onboarding.appearance.lead')} />
      <AppearanceSection />
    </>
  )
}
