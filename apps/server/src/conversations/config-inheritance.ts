import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { conversations, projects, type ConversationRow, type Db } from '@solera/db'
import {
  EMPTY_CONFIG_LAYER,
  diffAgentConfig,
  parseAgentConfig,
  readProjectLayer,
  resolveAgentConfig,
  sanitizeOverrides,
  sameSettingValue,
  type AgentConfig,
  type AgentKind,
  type ConfigLayer,
  type ConfigOverrides,
  type NamedLayer,
} from '@solera/protocol'
import type { AgentRegistry } from '../agents/registry.js'
import { readUserSettings } from '../settings/user-settings.js'

/**
 * L'héritage vivant côté serveur (#120) : d'où une conversation tient sa configuration.
 *
 * La source de vérité d'un fil est `conversations.config_overrides`, ce qu'il change. La
 * colonne `config` en est le calcul — compte, projet, puis le fil, et les sentinelles
 * `CLI_DEFAULT` remplacées par ce que le CLI annonce —, tenu à jour ici à chaque
 * lancement de session et à chaque changement d'un niveau du dessus. Les runners et les
 * gardes du serveur MCP continuent de lire `config` sans rien savoir des niveaux.
 */

export interface ConfigOwner {
  userId: string
  projectId: string | null
  agent: AgentKind
}

export function accountLayer(db: Db, userId: string): ConfigLayer {
  return readUserSettings(db, userId).agentLayer
}

export function projectLayer(db: Db, projectId: string | null): ConfigLayer {
  if (projectId === null) return EMPTY_CONFIG_LAYER
  const row = db
    .select({ defaultConfig: projects.defaultConfig })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  return readProjectLayer(row?.defaultConfig)
}

/** Les niveaux au-dessus d'un fil, du plus général au plus précis. Un fil libre n'a que le compte. */
export function inheritedLayers(db: Db, owner: Omit<ConfigOwner, 'agent'>): NamedLayer[] {
  const layers: NamedLayer[] = [{ source: 'account', layer: accountLayer(db, owner.userId) }]
  if (owner.projectId !== null) layers.push({ source: 'project', layer: projectLayer(db, owner.projectId) })
  return layers
}

/** Ce qu'un fil de ce CLI reçoit avant d'avoir rien changé lui-même. */
export function inheritedConfig(db: Db, owner: ConfigOwner): AgentConfig {
  return resolveAgentConfig(
    owner.agent,
    inheritedLayers(db, owner).map((named) => named.layer),
  )
}

/**
 * Ce qu'une conversation doit retenir pour valoir `desired` : les champs qui diffèrent de
 * son héritage. C'est le chemin de toute configuration complète qui arrive — création
 * depuis l'interface ou l'API, tâche planifiée, jalon, lancement par un agent.
 *
 * Les appelants résolvent souvent les `CLI_DEFAULT` avant d'arriver ici : un champ égal à
 * l'héritage *résolu* (`resolveDefaults`) n'est pas retenu non plus, sans quoi chaque fil
 * figerait le modèle par défaut du jour de sa création.
 */
export async function overridesFor(
  db: Db,
  resolveDefaults: (config: AgentConfig) => Promise<AgentConfig>,
  owner: ConfigOwner,
  desired: AgentConfig,
): Promise<ConfigOverrides> {
  const inherited = inheritedConfig(db, owner)
  const resolved = (await resolveDefaults(inherited).catch(() => inherited)) as unknown as Record<string, unknown>
  const overrides = diffAgentConfig(desired, inherited) as Record<string, unknown>
  for (const [field, value] of Object.entries(overrides)) {
    if (sameSettingValue(value, resolved[field])) delete overrides[field]
  }
  return overrides as ConfigOverrides
}

/**
 * Ce que le fil change, relu de la ligne. Une ligne d'avant l'héritage, pas encore vue
 * par la migration, change tout : c'est ce qui la laisse telle qu'elle était.
 */
export function readOverrides(row: Pick<ConversationRow, 'agent' | 'config' | 'configOverrides'>): ConfigOverrides {
  if (row.configOverrides === null) {
    try {
      return sanitizeOverrides(row.agent, parseAgentConfig(row.config)) as ConfigOverrides
    } catch {
      return {}
    }
  }
  try {
    return sanitizeOverrides(row.agent, JSON.parse(row.configOverrides)) as ConfigOverrides
  } catch {
    return {}
  }
}

/** La configuration d'un fil, recalculée des niveaux, sentinelles comprises. */
export function resolveConversationConfig(
  db: Db,
  row: Pick<ConversationRow, 'userId' | 'projectId' | 'agent' | 'config' | 'configOverrides'>,
): AgentConfig {
  return resolveAgentConfig(
    row.agent,
    inheritedLayers(db, row).map((named) => named.layer),
    readOverrides(row),
  )
}

/**
 * Applique à un fil un changement champ par champ, et rend la ligne à écrire.
 *
 * Un champ posé à la valeur qu'il hérite n'est pas retenu : la marque « changé dans ce
 * fil » ne doit apparaître que là où le fil diffère vraiment.
 */
export function patchOverrides(
  db: Db,
  row: Pick<ConversationRow, 'userId' | 'projectId' | 'agent' | 'config' | 'configOverrides'>,
  patch: { set?: Record<string, unknown>; unset?: string[] },
): ConfigOverrides {
  const next = { ...readOverrides(row) } as Record<string, unknown>
  for (const field of patch.unset ?? []) delete next[field]
  Object.assign(next, sanitizeOverrides(row.agent, patch.set ?? {}))
  const inherited = inheritedConfig(db, row) as unknown as Record<string, unknown>
  for (const [field, value] of Object.entries(next)) {
    if (sameSettingValue(value, inherited[field])) delete next[field]
  }
  return next as ConfigOverrides
}

/**
 * Recalcule la colonne `config` d'un fil et l'écrit si elle a bougé. Rend la ligne à jour.
 *
 * Les sentinelles `CLI_DEFAULT` sont résolues ici et nulle part en amont : un fil qui
 * n'a pas choisi de modèle suit celui de son compte, et le jour où le compte n'en choisit
 * pas non plus, celui que le CLI annonce.
 */
export async function refreshConversationConfig(
  db: Db,
  registry: Pick<AgentRegistry, 'adapter'>,
  row: ConversationRow,
): Promise<ConversationRow> {
  const resolved = await registry
    .adapter(row.agent)
    .resolveDefaults(resolveConversationConfig(db, row))
    .catch(() => resolveConversationConfig(db, row))
  const config = JSON.stringify(resolved)
  if (config === row.config) return row
  db.update(conversations).set({ config }).where(eq(conversations.id, row.id)).run()
  return { ...row, config }
}

/**
 * Tient à jour les fils qu'un changement de niveau concerne : ceux d'un compte, ou ceux
 * d'un projet. Le runner vivant garde la configuration sous laquelle il tourne jusqu'à sa
 * relance (Q10) ; c'est l'écart que le composer affiche en « En vigueur ».
 */
export async function refreshConversationConfigs(
  db: Db,
  registry: Pick<AgentRegistry, 'adapter'>,
  scope: { userId: string } | { projectId: string },
): Promise<number> {
  // Les fils rangés attendront leur relance, qui recalcule de toute façon : un compte en
  // garde des centaines, et aucun ne tourne.
  const where: SQL | undefined = and(
    'userId' in scope ? eq(conversations.userId, scope.userId) : eq(conversations.projectId, scope.projectId),
    isNull(conversations.archivedAt),
  )
  const rows = db.select().from(conversations).where(where).all()
  let changed = 0
  for (const row of rows) {
    const fresh = await refreshConversationConfig(db, registry, row)
    if (fresh !== row) changed += 1
  }
  return changed
}
