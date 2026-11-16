import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  EMPTY_CONFIG_LAYER,
  changedLayerFields,
  configSources,
  diffAgentConfig,
  diffConfigLayers,
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

export interface AccountConfig {
  /** Ce que le compte donne pour ce CLI. */
  config: AgentConfig
  /** Écrit, champ par champ, ce qui distingue `next` de `config`. */
  write: (next: AgentConfig) => void
  error: boolean
  ready: boolean
}

const USER_SETTINGS_KEY = ['user-settings']

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
 * La configuration d'un CLI au niveau du compte (#120), et de quoi la changer. Le niveau
 * d'un projet passe par le brouillon de sa page de réglages (`useConfigLayerDraft`).
 *
 * Le niveau écrit est tenu localement le temps de l'aller-retour : sans lui, la valeur
 * choisie reviendrait à l'ancienne sous le curseur jusqu'à la relecture.
 */
export function useAccountConfig(agent: AgentKind): AccountConfig {
  const queryClient = useQueryClient()
  const { data: settings, isPending } = useUserSettings()
  const [optimistic, setOptimistic] = useState<ConfigLayer | null>(null)
  const own = optimistic ?? settings?.agentLayer ?? EMPTY_CONFIG_LAYER

  const mutation = useMutation({
    mutationFn: async (patches: ConfigLayerPatch[]) => {
      for (const patch of patches) {
        const next = await api.patch<UserSettingsDto>('/api/me/settings', { agentLayer: patch })
        queryClient.setQueryData(USER_SETTINGS_KEY, next)
      }
    },
    onSettled: () => setOptimistic(null),
  })

  const apply = (patches: ConfigLayerPatch[]) => {
    if (patches.length === 0) return
    setOptimistic(patches.reduce(patchConfigLayer, own))
    mutation.mutate(patches)
  }

  const config = resolveAgentConfig(agent, [own])
  return {
    config,
    write: (next) => apply(patchesFor(agent, diffAgentConfig(next, config) as Record<string, unknown>)),
    error: mutation.isError,
    ready: !isPending,
  }
}

/** La configuration d'un CLI dans le brouillon du niveau d'un projet. */
export interface DraftLevelConfig {
  config: AgentConfig
  sources: Record<string, ConfigSource>
  /** Range dans le brouillon ce qui distingue `next` de `config`. */
  write: (next: AgentConfig) => void
  /** Rend des champs à l'héritage, dans le brouillon. */
  reset: (fields: string[]) => void
  /** Les champs que le brouillon change pour ce CLI, partagés compris. */
  changed: (fields: string[]) => boolean
}

/**
 * Le niveau d'un projet, réglé dans le brouillon de la page des réglages (page projet
 * v2, PP-22) : les changements s'empilent sans rien écrire, se comptent dans la barre, et
 * partent avec le reste des réglages dans un seul `PATCH`.
 *
 * Le brouillon garde les **changements**, rejoués par-dessus l'enregistré : un
 * rafraîchissement du projet ne les écrase pas, et revenir à la valeur enregistrée
 * efface la modification d'elle-même.
 */
export function useConfigLayerDraft(project: ProjectDto) {
  const { data: settings } = useUserSettings()
  const [patches, setPatches] = useState<ConfigLayerPatch[]>([])
  const stored = project.configLayer
  const draft = patches.reduce(patchConfigLayer, stored)
  const changed = changedLayerFields(stored, draft)
  const account = settings?.agentLayer ?? EMPTY_CONFIG_LAYER
  const push = (next: ConfigLayerPatch[]) => {
    if (next.length > 0) setPatches((current) => [...current, ...next])
  }

  return {
    /** Le niveau vu d'un CLI : le compte, puis le brouillon. */
    level: (agent: AgentKind): DraftLevelConfig => {
      const layers: NamedLayer[] = [
        { source: 'account', layer: account },
        { source: 'project', layer: draft },
      ]
      const config = resolveAgentConfig(agent, [account, draft])
      return {
        config,
        sources: configSources(agent, layers),
        write: (next) => push(patchesFor(agent, diffAgentConfig(next, config) as Record<string, unknown>)),
        reset: (fields) => push(unsetPatches(agent, fields)),
        changed: (fields) => fields.some((field) => changed.includes(field) || changed.includes(`${agent}.${field}`)),
      }
    },
    /** Les réglages changés, un par un, pour la barre. */
    changed,
    /** Le corps du `PATCH` : les changements qui mènent de l'enregistré au brouillon. */
    body: () => diffConfigLayers(stored, draft),
    clear: () => setPatches([]),
    /** Le compte relu : avant, les rangées diraient les défauts du protocole. */
    ready: settings !== undefined,
  }
}

export type ConfigLayerDraft = ReturnType<typeof useConfigLayerDraft>
