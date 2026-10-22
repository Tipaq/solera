import { agentKindSchema, defaultConfigFor, type AgentConfig, type OnboardingPermission } from '@solera/protocol'
import { useUpdateAgentDefault, useUserSettings } from '../../lib/user-settings'
import type { OnboardingFamily } from '../../lib/onboarding'

/**
 * Les défauts de compte des quatre CLI, vus comme un seul réglage par famille.
 *
 * La visite règle les quatre ensemble, même ceux qu'on n'a pas choisis : un CLI installé
 * plus tard doit partir avec les mêmes garde-fous que les autres, et c'est l'écran des
 * défauts, ouvert CLI par CLI, qui sait les faire diverger. Une famille vaut allumée
 * quand elle l'est pour les quatre.
 */
export function useAgentDefaults() {
  const { data: settings } = useUserSettings()
  const update = useUpdateAgentDefault()
  const configs: AgentConfig[] = agentKindSchema.options.map(
    (agent) => settings?.agentDefaults[agent] ?? defaultConfigFor(agent),
  )

  const family = (name: OnboardingFamily): boolean => configs.every((config) => config[name])

  /** Réécrit les quatre défauts, l'un après l'autre : la route n'en prend qu'un à la fois. */
  const apply = async (change: (config: AgentConfig) => AgentConfig) => {
    for (const config of configs) await update.mutateAsync(change(config))
  }

  /** Le réflexe que le défaut de Claude porte, quand c'est l'un des quatre de la visite. */
  const claude = configs.find((config) => config.agent === 'claude')
  const claudeReflex: OnboardingPermission | null =
    claude?.agent !== 'claude'
      ? null
      : claude.permissionMode === 'bypassPermissions'
        ? 'bypass'
        : claude.permissionMode === 'manual' || claude.permissionMode === 'auto' || claude.permissionMode === 'acceptEdits'
          ? claude.permissionMode
          : null

  return { ready: settings !== undefined, family, apply, claudeReflex }
}
