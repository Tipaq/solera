import type { AgentConfig, InstanceProfile } from '@solera/protocol'

/**
 * La visite de première ouverture : quelles étapes, dans quel ordre, d'après ce que
 * l'instance est et qui la suit.
 *
 * Elle présente Solera tel qu'il est, et règle pour de vrai ce qui se règle : les
 * étapes qui posent un défaut l'écrivent au compte, celles qui présentent un lieu de
 * l'interface ne règlent rien.
 *
 * Calculée à chaque rendu plutôt que mémorisée : l'index enregistré au compte ne vaut
 * que pour la liste du moment, et le compte créé à la première étape change la liste.
 */
export type OnboardingStepId =
  | 'account'
  | 'welcome'
  | 'appearance'
  | 'agents'
  | 'permissions'
  | 'instructions'
  | 'skills'
  | 'screen'
  | 'work'
  | 'ready'

export interface OnboardingShape {
  profile: InstanceProfile
  /** Vrai tant que la base n'a aucun compte : la visite commence par le créer. */
  needsSetup: boolean
}

export function onboardingSteps({ profile, needsSetup }: OnboardingShape): OnboardingStepId[] {
  const steps: OnboardingStepId[] = []
  // Le premier compte d'une instance hébergée. En bureau, le lanceur l'a déjà créé ; un
  // compte ouvert par un administrateur a déjà son mot de passe.
  if (profile === 'server' && needsSetup) steps.push('account')
  steps.push('welcome', 'appearance', 'agents', 'permissions', 'instructions', 'skills', 'screen', 'work', 'ready')
  return steps
}

/**
 * Les deux familles que la visite règle elle-même, chacune dans son étape : la mémoire
 * avec les consignes, parce que ce sont les deux choses qu'une session laisse aux
 * suivantes ; la bibliothèque avec les skills. Les demandes à Solera ont leurs trois
 * états, réglés par l'étape Permissions avec le composant des réglages (#120).
 */
export type OnboardingFamily = 'agentMemory' | 'skillLibrary'

export function withFamily(config: AgentConfig, family: OnboardingFamily, on: boolean): AgentConfig {
  return { ...config, [family]: on }
}
