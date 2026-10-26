import type { AgentConfig, InstanceProfile, OnboardingPermission } from '@solera/protocol'

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
 * Le réflexe choisi, traduit dans le vocabulaire de chaque CLI.
 *
 * Les quatre réflexes sont ceux de Claude ; les autres CLI n'ont pas tous les quatre, et
 * la traduction prend le garde-fou le plus proche plutôt que d'inventer un mode.
 */
export function withPermissionChoice(config: AgentConfig, choice: OnboardingPermission): AgentConfig {
  switch (config.agent) {
    case 'claude':
      return {
        ...config,
        permissionMode: ({ manual: 'manual', auto: 'auto', acceptEdits: 'acceptEdits', bypass: 'bypassPermissions' } as const)[choice],
      }
    case 'codex':
      return {
        ...config,
        askForApproval: choice === 'manual' ? 'untrusted' : choice === 'auto' ? 'on-request' : 'never',
        sandbox: choice === 'bypass' ? 'danger-full-access' : 'workspace-write',
      }
    case 'opencode':
      return {
        ...config,
        permissions: {
          ...config.permissions,
          edit: choice === 'manual' || choice === 'auto' ? 'ask' : 'allow',
          bash: choice === 'bypass' ? 'allow' : 'ask',
        },
      }
    case 'grok':
      // L'ACP de Grok n'a pas d'`acceptEdits` : son `auto` laisserait un classifieur lancer
      // les commandes, que ce réflexe promet de demander. Le plus proche est `default`.
      return {
        ...config,
        permissionMode: ({ manual: 'default', auto: 'auto', acceptEdits: 'default', bypass: 'bypassPermissions' } as const)[choice],
      }
  }
}

/**
 * Les familles d'autorisation que la visite règle, communes aux quatre CLI.
 *
 * `agentMemory` et `skillLibrary` en font partie, mais chacune a son étape : la mémoire
 * avec les consignes, parce que ce sont les deux choses qu'une session laisse aux
 * suivantes ; la bibliothèque avec les skills.
 */
export type OnboardingFamily = 'soleraMcp' | 'agentMemory' | 'projectFiling' | 'cardFiling' | 'decisions' | 'skillLibrary'

export function withFamily(config: AgentConfig, family: OnboardingFamily, on: boolean): AgentConfig {
  return { ...config, [family]: on }
}
