import { AgentRequestsCard, CliReflexCard } from '../settings/LayeredSettings'
import { useTranslate } from '../../lib/i18n'
import { StepTitle, useGate, type StepProps } from './shell'

/**
 * Ce que l'agent peut faire sans demander : ce qu'il demande à Solera, et le réflexe de
 * permission de son CLI. Les mêmes blocs que la section Permissions des réglages (#120,
 * Q34), plutôt qu'une version à part avec ses quatre modes maison : une seule version
 * d'un réglage, rendue partout de la même façon.
 *
 * Écrit au compte dès qu'on change une valeur, comme dans les réglages : « Continuer »
 * n'a rien à appliquer, et revenir à l'étape montre ce qui est en place.
 */
export function PermissionsStep({ nav }: StepProps) {
  const t = useTranslate()
  useGate(nav, { canContinue: true, laterAllowed: true, skipAllowed: true })

  return (
    <>
      <StepTitle title={t('onboarding.permissions.title')} lead={t('onboarding.permissions.lead')} />
      <AgentRequestsCard level={{ kind: 'account' }} />
      <CliReflexCard level={{ kind: 'account' }} />
    </>
  )
}
