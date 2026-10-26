import { z } from 'zod'
import {
  agentConfigSchema,
  claudeConfigSchema,
  codexConfigSchema,
  grokConfigSchema,
  opencodeConfigSchema,
  DEFAULT_CONFIGS,
  type AgentConfig,
  type ClaudeConfig,
  type CodexConfig,
  type GrokConfig,
  type OpencodeConfig,
} from './agent-config.js'

/**
 * ## L'héritage vivant, champ par champ (#120)
 *
 * Trois niveaux posent des réglages au-dessus des défauts du protocole : le compte, le
 * projet, la conversation. Chacun ne garde que **ce qu'il change**, et la configuration
 * d'une session se recalcule à partir d'eux à chaque lancement. Changer un défaut du
 * compte touche donc toutes les conversations qui ne l'avaient pas changé elles-mêmes, à
 * leur prochaine relance (Q10), et un projet peut ouvrir les décisions sans figer le
 * modèle (Q11).
 *
 * Avant, le premier niveau qui avait une configuration la fournissait en entier, et la
 * conversation en recevait une copie à sa création. Les deux règles ont disparu ensemble :
 * la seconde sans la première aurait figé chaque fil au défaut de son jour de naissance.
 *
 * `config.toml` reste à part et au-dessus : c'est un plafond (`&&`), pas un étage.
 */

export type AgentKindOf<C extends AgentConfig> = C['agent']

/**
 * Les champs qui veulent dire la même chose pour tous les CLI, et se règlent donc une fois
 * pour tous au compte et au projet (Q32) : ce que l'agent demande à Solera, ce que Solera
 * lui prête, et la façon d'envoyer pendant un tour.
 *
 * Tout le reste — modèle, effort, abonnement, mode de permission natif, options propres —
 * se règle par CLI, parce que ses valeurs ne se traduisent pas d'un CLI à l'autre.
 */
export const SHARED_CONFIG_FIELDS = [
  'soleraMcp',
  'agentMemory',
  'skillLibrary',
  'mcpServers',
  'additionalDirectories',
  'projectFiling',
  'cardFiling',
  'proposeCards',
  'decisions',
  'decisionMaxHours',
  'queueMessages',
] as const satisfies readonly (keyof ClaudeConfig & keyof CodexConfig & keyof OpencodeConfig & keyof GrokConfig)[]

export type SharedConfigField = (typeof SHARED_CONFIG_FIELDS)[number]
export type SharedConfig = Pick<ClaudeConfig, SharedConfigField>

const SHARED = new Set<string>(SHARED_CONFIG_FIELDS)

export function isSharedField(field: string): field is SharedConfigField {
  return SHARED.has(field)
}

/** Les champs qu'un niveau peut changer pour un CLI : tous sauf le discriminant. */
export type ConfigOverrides<C extends AgentConfig = AgentConfig> = C extends AgentConfig
  ? Partial<Omit<C, 'agent'>>
  : never

/**
 * Ce qu'un niveau (compte ou projet) change. `shared` vaut pour tous les CLI ; la clé d'un
 * CLI porte ses champs propres, et peut aussi porter une exception à un champ partagé.
 *
 * Les exceptions ne s'écrivent pas depuis l'interface — régler un champ partagé les
 * efface — mais la migration les pose quand deux CLI d'un même compte divergeaient : les
 * fondre en une valeur commune aurait perdu le réglage de l'un des deux.
 */
export interface ConfigLayer {
  shared: Partial<SharedConfig>
  claude: ConfigOverrides<ClaudeConfig>
  codex: ConfigOverrides<CodexConfig>
  opencode: ConfigOverrides<OpencodeConfig>
  grok: ConfigOverrides<GrokConfig>
}

export const EMPTY_CONFIG_LAYER: ConfigLayer = {
  shared: {},
  claude: {},
  codex: {},
  opencode: {},
  grok: {},
}

type AgentKey = AgentConfig['agent']
export const CONFIG_LAYER_AGENTS: readonly AgentKey[] = ['claude', 'codex', 'opencode', 'grok']

const SCHEMAS = {
  claude: claudeConfigSchema,
  codex: codexConfigSchema,
  opencode: opencodeConfigSchema,
  grok: grokConfigSchema,
} as const

/**
 * Garde d'un ensemble de changements les champs que le schéma du CLI accepte, un par un.
 *
 * Tolérant comme toute relecture de réglages : un champ retiré du protocole ou une valeur
 * qui a dérivé tombe seule, sans emporter ses voisins ni rendre le niveau illisible.
 */
export function sanitizeOverrides<A extends AgentKey>(
  agent: A,
  raw: unknown,
  only?: (field: string) => boolean,
): ConfigOverrides<Extract<AgentConfig, { agent: A }>> {
  const result: Record<string, unknown> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result as never
  const shape = SCHEMAS[agent].shape as Record<string, z.ZodTypeAny>
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    if (field === 'agent' || value === undefined) continue
    if (only && !only(field)) continue
    const schema = shape[field]
    if (!schema) continue
    const parsed = schema.safeParse(value)
    if (parsed.success) result[field] = parsed.data
  }
  return result as never
}

function sanitizeShared(raw: unknown): Partial<SharedConfig> {
  // Les champs partagés ont le même schéma chez les quatre CLI : celui de Claude suffit.
  return sanitizeOverrides('claude', raw, isSharedField) as Partial<SharedConfig>
}

/** Relit un niveau stocké, champ par champ. */
export function readConfigLayer(raw: unknown): ConfigLayer {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_CONFIG_LAYER
  const record = raw as Record<string, unknown>
  return {
    shared: sanitizeShared(record.shared),
    claude: sanitizeOverrides('claude', record.claude),
    codex: sanitizeOverrides('codex', record.codex),
    opencode: sanitizeOverrides('opencode', record.opencode),
    grok: sanitizeOverrides('grok', record.grok),
  }
}

export const configLayerSchema = z.unknown().transform(readConfigLayer)

export function isEmptyLayer(layer: ConfigLayer): boolean {
  return (
    Object.keys(layer.shared).length === 0 &&
    CONFIG_LAYER_AGENTS.every((agent) => Object.keys(layer[agent]).length === 0)
  )
}

/**
 * Ce qu'un niveau change pour un CLI : ses champs partagés, puis ses exceptions et ses
 * champs propres, qui l'emportent.
 */
export function layerOverridesFor(layer: ConfigLayer, agent: AgentKey): ConfigOverrides {
  return { ...layer.shared, ...layer[agent] } as ConfigOverrides
}

/**
 * Comparaison de valeurs de réglage : des scalaires, des listes et de petits objets
 * (`permissions` d'opencode, l'approbation granulaire de Codex). L'ordre des clés d'un
 * objet ne compte pas, celui d'une liste si.
 */
export function sameSettingValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((value, index) => sameSettingValue(value, other[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (!sameSettingValue(left[key], right[key])) return false
  }
  return true
}

/**
 * La configuration d'un CLI, niveau par niveau, du plus général au plus précis : les
 * défauts du protocole, puis chaque niveau, puis les changements de la conversation.
 *
 * Un niveau illisible ne fait pas tomber la configuration : le schéma rattrape un champ
 * manquant par son défaut, et une fusion qui échouerait quand même retombe sur les
 * défauts du CLI plutôt que de rendre la session impossible à lancer.
 */
export function resolveAgentConfig(
  agent: AgentKey,
  layers: readonly ConfigLayer[],
  own: ConfigOverrides | null = null,
): AgentConfig {
  const merged: Record<string, unknown> = { ...DEFAULT_CONFIGS[agent] }
  for (const layer of layers) Object.assign(merged, layerOverridesFor(layer, agent))
  if (own) Object.assign(merged, own)
  merged.agent = agent
  const parsed = agentConfigSchema.safeParse(merged)
  return parsed.success ? parsed.data : DEFAULT_CONFIGS[agent]
}

/**
 * Les champs de `target` qui diffèrent de `base` : ce qu'un niveau doit retenir pour que
 * sa configuration vaille `target` au-dessus de `base`.
 */
export function diffAgentConfig(target: AgentConfig, base: AgentConfig): ConfigOverrides {
  const result: Record<string, unknown> = {}
  const baseRecord = base as unknown as Record<string, unknown>
  for (const [field, value] of Object.entries(target)) {
    if (field === 'agent') continue
    if (!sameSettingValue(value, baseRecord[field])) result[field] = value
  }
  return result as ConfigOverrides
}

/** D'où vient la valeur d'un champ, telle que l'interface l'affiche. */
export type ConfigSource = 'default' | 'account' | 'project' | 'conversation'

export interface NamedLayer {
  source: Exclude<ConfigSource, 'default' | 'conversation'>
  layer: ConfigLayer
}

/**
 * Le niveau qui fournit chaque champ : le plus précis de ceux qui le changent, ou
 * `default` quand aucun ne le change.
 */
export function configSources(
  agent: AgentKey,
  layers: readonly NamedLayer[],
  own: ConfigOverrides | null = null,
): Record<string, ConfigSource> {
  const result: Record<string, ConfigSource> = {}
  for (const field of Object.keys(DEFAULT_CONFIGS[agent])) {
    if (field !== 'agent') result[field] = 'default'
  }
  for (const { source, layer } of layers) {
    for (const field of Object.keys(layerOverridesFor(layer, agent))) result[field] = source
  }
  if (own) for (const field of Object.keys(own)) result[field] = 'conversation'
  return result
}

/**
 * Un changement de niveau, tel que l'interface l'envoie : des champs posés, et des champs
 * rendus à l'héritage. `scope` dit si les champs valent pour tous les CLI ou pour un seul.
 *
 * Deux listes plutôt qu'un `null` qui voudrait dire « hérité » : `account`, `maxTurns` ou
 * `maxBudgetUsd` ont `null` parmi leurs valeurs légitimes.
 */
export interface ConfigLayerPatch {
  scope: 'shared' | AgentKey
  set?: Record<string, unknown>
  unset?: string[]
}

export const configLayerPatchSchema = z.object({
  scope: z.enum(['shared', 'claude', 'codex', 'opencode', 'grok']),
  set: z.record(z.string(), z.unknown()).optional(),
  unset: z.array(z.string().max(64)).max(64).optional(),
})

/**
 * Applique un changement à un niveau.
 *
 * Régler un champ partagé efface ses exceptions par CLI : la ligne de l'écran affiche une
 * seule valeur pour tous, et elle doit dire vrai. Un champ propre envoyé sous `shared`, ou
 * un champ partagé envoyé sous un CLI, est rangé où il doit l'être plutôt que refusé.
 */
export function patchConfigLayer(layer: ConfigLayer, patch: ConfigLayerPatch): ConfigLayer {
  const next: ConfigLayer = {
    shared: { ...layer.shared },
    claude: { ...layer.claude },
    codex: { ...layer.codex },
    opencode: { ...layer.opencode },
    grok: { ...layer.grok },
  }
  const targets: AgentKey[] = patch.scope === 'shared' ? [...CONFIG_LAYER_AGENTS] : [patch.scope]

  for (const field of patch.unset ?? []) {
    if (isSharedField(field) && patch.scope === 'shared') {
      delete (next.shared as Record<string, unknown>)[field]
      for (const agent of CONFIG_LAYER_AGENTS) delete (next[agent] as Record<string, unknown>)[field]
    } else {
      for (const agent of targets) delete (next[agent] as Record<string, unknown>)[field]
    }
  }

  const set = patch.set ?? {}
  if (patch.scope === 'shared') {
    const shared = sanitizeShared(set)
    Object.assign(next.shared, shared)
    for (const field of Object.keys(shared)) {
      for (const agent of CONFIG_LAYER_AGENTS) delete (next[agent] as Record<string, unknown>)[field]
    }
  } else {
    Object.assign(next[patch.scope], sanitizeOverrides(patch.scope, set))
  }
  return next
}

/**
 * Range dans un niveau la configuration complète qu'un écran d'avant l'héritage envoie
 * pour un CLI : le niveau retient ce qui diffère de `below`, les champs partagés en commun
 * et les autres pour ce CLI.
 *
 * Les champs égaux à `below` redeviennent hérités. C'est le chemin des clients qui
 * envoient encore une configuration entière, l'API publique comprise.
 */
export function layerWithFullConfig(layer: ConfigLayer, config: AgentConfig, below: AgentConfig): ConfigLayer {
  const changed = diffAgentConfig(config, below) as Record<string, unknown>
  const shared = sanitizeShared(changed)
  const next: ConfigLayer = { ...layer, shared }
  ;(next as unknown as Record<string, unknown>)[config.agent] = sanitizeOverrides(
    config.agent,
    changed,
    (field) => !isSharedField(field),
  )
  // Un champ partagé réglé ici ne garde pas d'exception ailleurs, comme dans
  // `patchConfigLayer`.
  for (const agent of CONFIG_LAYER_AGENTS) {
    if (agent === config.agent) continue
    const rest = { ...layer[agent] } as Record<string, unknown>
    for (const field of Object.keys(shared)) delete rest[field]
    ;(next as unknown as Record<string, unknown>)[agent] = rest
  }
  return next
}

/**
 * Construit un niveau à partir des configurations complètes d'avant l'héritage, un CLI
 * par clé, en ne retenant que ce qui diffère de `base` (le niveau du dessous, résolu).
 *
 * C'est la migration : rien de ce qui était réglé ne doit se perdre. Un champ partagé
 * prend la valeur de Claude, ou du premier CLI réglé, et un CLI qui en avait une autre la
 * garde en exception.
 */
export function layerFromFullConfigs(
  configs: Partial<Record<AgentKey, AgentConfig | null>>,
  base?: (agent: AgentKey) => AgentConfig,
): ConfigLayer {
  // Sans niveau du dessous, tout est retenu : c'est le cas du compte, voir
  // `accountLayerFromLegacy`.
  const below = (agent: AgentKey) => (base ? base(agent) : ({ agent } as AgentConfig))
  const diffs = new Map<AgentKey, Record<string, unknown>>()
  for (const agent of CONFIG_LAYER_AGENTS) {
    const config = configs[agent]
    if (config && config.agent === agent) {
      diffs.set(agent, diffAgentConfig(config, below(agent)) as Record<string, unknown>)
    }
  }

  const reference = (['claude', ...CONFIG_LAYER_AGENTS] as AgentKey[]).find((agent) => diffs.has(agent))
  const layer: ConfigLayer = { shared: {}, claude: {}, codex: {}, opencode: {}, grok: {} }
  if (!reference) return layer

  const referenceConfig = configs[reference]! as unknown as Record<string, unknown>
  const shared: Record<string, unknown> = {}
  for (const field of SHARED_CONFIG_FIELDS) {
    if (field in diffs.get(reference)!) shared[field] = referenceConfig[field]
  }
  layer.shared = sanitizeShared(shared)

  for (const [agent, diff] of diffs) {
    const config = configs[agent]! as unknown as Record<string, unknown>
    const under = below(agent) as unknown as Record<string, unknown>
    const own: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(diff)) {
      if (!isSharedField(field)) own[field] = value
    }
    for (const field of SHARED_CONFIG_FIELDS) {
      const effective = field in shared ? shared[field] : under[field]
      if (!sameSettingValue(config[field], effective)) own[field] = config[field]
    }
    ;(layer as unknown as Record<string, unknown>)[agent] = sanitizeOverrides(agent, own)
  }
  return layer
}
