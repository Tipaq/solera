import { and, asc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm'
import { claudeAccounts, codexAccounts, conversations, grokAccounts, projects, type ConversationRow, type Db } from '@solera/db'
import { claudeAccountOrder } from '../claude-accounts/store.js'
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

/**
 * Le niveau du compte, tel que l'utilisateur l'a réglé — plus, pour Claude, Codex et
 * Grok, un compte de Solera quand il n'en a désigné aucun.
 *
 * Sans ce repli, un fil qui n'a rien choisi partait sur la connexion du terminal, qui
 * tombe sans prévenir : les sessions lancées par un agent, les tâches planifiées et les
 * fils d'avant échouaient au premier tour alors qu'un compte qui marche était là. Pour
 * Codex et Grok, c'est aussi ce qui garde le home de l'utilisateur hors des sessions : un
 * compte de Solera tourne dans un dossier à lui (ADR 0001). Le repli est le premier compte
 * dans l'ordre de la liste, et non le dernier utilisé : choisir un compte dans un fil ne
 * doit pas faire changer tous les autres à leur relance. Un compte Codex ou Grok jamais
 * connecté n'est pas proposé, sa session refuserait le tour. Un choix explicite au compte,
 * la connexion du terminal comprise (`null`), l'emporte ; un compte désigné puis supprimé
 * ne compte pas comme un choix.
 */
export function accountLayer(db: Db, userId: string): ConfigLayer {
  let layer = readUserSettings(db, userId).agentLayer
  for (const agent of ['claude', 'codex', 'grok'] as const) {
    const chosen = layer[agent].account
    if (chosen === null) continue
    const accounts = soleraAccounts(db, userId, agent)
    // Un compte désigné puis supprimé ne vaut pas mieux qu'aucun choix.
    if (chosen !== undefined && accounts.includes(chosen)) continue
    const first = accounts[0]
    if (first) layer = { ...layer, [agent]: { ...layer[agent], account: first } }
  }
  return layer
}

/** Les comptes de Solera de l'utilisateur pour ce CLI, dans l'ordre de leur liste. */
function soleraAccounts(db: Db, userId: string, agent: 'claude' | 'codex' | 'grok'): string[] {
  if (agent === 'claude') {
    return db
      .select({ id: claudeAccounts.id })
      .from(claudeAccounts)
      .where(eq(claudeAccounts.ownerId, userId))
      .orderBy(claudeAccountOrder)
      .all()
      .map((account) => account.id)
  }
  const table = agent === 'codex' ? codexAccounts : grokAccounts
  return db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.ownerId, userId), isNotNull(table.authMode)))
    .orderBy(asc(table.label))
    .all()
    .map((account) => account.id)
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
