import { z } from 'zod'
import {
  agentConfigSchema,
  claudeConfigSchema,
  codexConfigSchema,
  opencodeConfigSchema,
  grokConfigSchema,
  DEFAULT_CONFIGS,
  type AgentConfig,
} from './agent-config.js'
import {
  EMPTY_CONFIG_LAYER,
  isEmptyLayer,
  layerFromFullConfigs,
  readConfigLayer,
  type ConfigLayer,
} from './config-layers.js'

/**
 * Le niveau d'un projet : ce que ses conversations changent aux défauts du compte de
 * chacun, champ par champ (#120).
 *
 * Réglage partagé et non personnel : il décrit le projet, pas celui qui le lit. Les
 * serveurs MCP utiles à un dépôt le sont pour tout le monde, et les répertoires
 * supplémentaires — qui désignent des dossiers précis — trouvent ici le seul endroit où
 * ils ont un sens. Seul le propriétaire du projet peut l'écrire.
 *
 * Un champ absent est hérité du compte de la personne qui ouvre la conversation. Deux
 * membres d'un projet partagé ont donc les mêmes réglages là où le projet en a posé, et
 * chacun les siens ailleurs.
 */
export type ProjectConfigLayer = ConfigLayer

/** Les configurations complètes d'avant l'héritage, un CLI par clé. */
export type LegacyProjectConfigs = Partial<Record<AgentConfig['agent'], AgentConfig>>

const legacyProjectDefaultsSchema = z.object({
  claude: claudeConfigSchema.nullable().default(null).catch(null),
  codex: codexConfigSchema.nullable().default(null).catch(null),
  opencode: opencodeConfigSchema.nullable().default(null).catch(null),
  grok: grokConfigSchema.nullable().default(null).catch(null),
})

/**
 * Lit la colonne `projects.default_config` quand elle est encore dans une forme d'avant
 * l'héritage : une configuration complète par CLI, ou une seule configuration sans le CLI
 * en clé. `null` quand la colonne est vide ou déjà un niveau.
 *
 * Utilisée par la migration, qui retient ce qui diffère du compte du propriétaire.
 */
export function readLegacyProjectConfigs(raw: string | null | undefined): LegacyProjectConfigs | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || 'shared' in parsed) return null

  const single = agentConfigSchema.safeParse(parsed)
  if (single.success) return { [single.data.agent]: single.data }

  const perAgent = legacyProjectDefaultsSchema.safeParse(parsed)
  if (!perAgent.success) return null
  const result: LegacyProjectConfigs = {}
  for (const [agent, config] of Object.entries(perAgent.data)) {
    if (config) (result as Record<string, AgentConfig>)[agent] = config
  }
  return result
}

/**
 * Relit la colonne `projects.default_config`.
 *
 * Une forme d'avant l'héritage ne devrait plus s'y trouver après la migration du
 * démarrage. Si elle s'y trouve quand même, elle se lit sans rien perdre : chaque champ
 * qui diffère du défaut du protocole est retenu.
 */
export function readProjectLayer(raw: string | null | undefined): ProjectConfigLayer {
  if (!raw) return EMPTY_CONFIG_LAYER
  const legacy = readLegacyProjectConfigs(raw)
  if (legacy) return layerFromFullConfigs(legacy, (agent) => DEFAULT_CONFIGS[agent])
  try {
    return readConfigLayer(JSON.parse(raw))
  } catch {
    return EMPTY_CONFIG_LAYER
  }
}

/**
 * Ce qui doit être écrit en colonne pour un niveau remplacé.
 *
 * `null` quand le projet ne change plus rien : la colonne retrouve son état de projet
 * neuf, et rien ne distingue « vidé » de « jamais réglé ».
 */
export function serializeProjectLayer(layer: ProjectConfigLayer): string | null {
  return isEmptyLayer(layer) ? null : JSON.stringify(layer)
}
