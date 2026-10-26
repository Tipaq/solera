import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  EMPTY_CONFIG_LAYER,
  configSources,
  diffAgentConfig,
  isSharedField,
  patchConfigLayer,
  resolveAgentConfig,
  type AgentConfig,
  type AgentKind,
  type ConfigLayer,
  type ConfigLayerPatch,
  type ConfigSource,
  type NamedLayer,
  type ProjectDto,
  type UserSettingsDto,
} from '@solera/protocol'
import { api } from './api'
import { useUserSettings } from './user-settings'

/**
 * Le niveau que règle un écran (#120) : le compte, ou un projet. La conversation n'a pas
 * d'écran (Q33) : ses changements passent par le menu « + » du composer.
 */
export type SettingsLevel = { kind: 'account' } | { kind: 'project'; project: ProjectDto }

export interface LevelConfig {
  /** Ce que ce niveau donne pour ce CLI : les niveaux du dessous, puis le sien. */
  config: AgentConfig
  /** D'où vient chaque champ, pour dire « hérité du compte » ou « modifié ici ». */
  sources: Record<string, ConfigSource>
  /** Écrit, champ par champ, ce qui distingue `next` de `config`. */
  write: (next: AgentConfig) => void
  /** Rend des champs à l'héritage. */
  reset: (fields: string[]) => void
  error: boolean
  ready: boolean
}

const USER_SETTINGS_KEY = ['user-settings']
const PROJECTS_KEY = ['projects']

/**
 * Les changements d'une configuration entière, rangés par portée : les champs qui valent
 * pour tous les CLI ensemble, les autres sous leur CLI.
 */
function patchesFor(agent: AgentKind, changed: Record<string, unknown>): ConfigLayerPatch[] {
  const shared: Record<string, unknown> = {}
  const own: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(changed)) {
    if (isSharedField(field)) shared[field] = value
    else own[field] = value
  }
  const patches: ConfigLayerPatch[] = []
  if (Object.keys(shared).length > 0) patches.push({ scope: 'shared', set: shared })
  if (Object.keys(own).length > 0) patches.push({ scope: agent, set: own })
  return patches
}

function unsetPatches(agent: AgentKind, fields: string[]): ConfigLayerPatch[] {
  const shared = fields.filter(isSharedField)
  const own = fields.filter((field) => !isSharedField(field))
  const patches: ConfigLayerPatch[] = []
  if (shared.length > 0) patches.push({ scope: 'shared', unset: shared })
  if (own.length > 0) patches.push({ scope: agent, unset: own })
  return patches
}

/**
 * La configuration d'un CLI à un niveau, et de quoi la changer.
 *
 * Le niveau écrit est tenu localement le temps de l'aller-retour : sans lui, la valeur
 * choisie reviendrait à l'ancienne sous le curseur jusqu'à la relecture.
 */
export function useLevelConfig(level: SettingsLevel, agent: AgentKind): LevelConfig {
  const queryClient = useQueryClient()
  const { data: settings, isPending } = useUserSettings()
  const [optimistic, setOptimistic] = useState<{ key: string; layer: ConfigLayer } | null>(null)

  const levelKey = level.kind === 'account' ? 'account' : `project:${level.project.id}`
  const storedOwn = level.kind === 'account' ? (settings?.agentLayer ?? EMPTY_CONFIG_LAYER) : level.project.configLayer
  const own = optimistic?.key === levelKey ? optimistic.layer : storedOwn

  const layers: NamedLayer[] =
    level.kind === 'account'
      ? [{ source: 'account', layer: own }]
      : [
          { source: 'account', layer: settings?.agentLayer ?? EMPTY_CONFIG_LAYER },
          { source: 'project', layer: own },
        ]

  const mutation = useMutation({
    mutationFn: async (patches: ConfigLayerPatch[]) => {
      for (const patch of patches) {
        if (level.kind === 'account') {
          const next = await api.patch<UserSettingsDto>('/api/me/settings', { agentLayer: patch })
          queryClient.setQueryData(USER_SETTINGS_KEY, next)
        } else {
          await api.patch(`/api/projects/${level.project.id}`, { configLayer: patch })
        }
      }
      if (level.kind === 'project') await queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
    onSettled: () => setOptimistic(null),
  })

  const apply = (patches: ConfigLayerPatch[]) => {
    if (patches.length === 0) return
    setOptimistic({ key: levelKey, layer: patches.reduce(patchConfigLayer, own) })
    mutation.mutate(patches)
  }

  const config = resolveAgentConfig(
    agent,
    layers.map((named) => named.layer),
  )
  return {
    config,
    sources: configSources(agent, layers),
    write: (next) => apply(patchesFor(agent, diffAgentConfig(next, config) as Record<string, unknown>)),
    reset: (fields) => apply(unsetPatches(agent, fields)),
    error: mutation.isError,
    ready: level.kind === 'project' || !isPending,
  }
}
