import { eq, isNotNull, isNull } from 'drizzle-orm'
import { conversations, projects, userSettings, writeTransaction, type Db } from '@solera/db'
import {
  CLI_DEFAULT,
  EMPTY_CONFIG_LAYER,
  accountLayerFromLegacy,
  diffAgentConfig,
  layerFromFullConfigs,
  parseAgentConfig,
  readConfigLayer,
  readLegacyProjectConfigs,
  readProjectLayer,
  resolveAgentConfig,
  serializeProjectLayer,
  type AgentConfig,
  type AgentKind,
  type ConfigLayer,
  type ConfigOverrides,
} from '@solera/protocol'

/**
 * Le modèle que la création d'un fil écrivait à la place de `CLI_DEFAULT`, quand il ne
 * dépend pas de la machine. Claude répond toujours par l'alias `default` ; Codex et Grok
 * par un identifiant de leur catalogue du jour, qu'on ne peut pas distinguer d'un choix.
 */
const RESOLVED_DEFAULT_MODEL: Partial<Record<AgentKind, string>> = { claude: 'default' }

/**
 * Ce qu'une conversation d'avant l'héritage change à ce qu'elle hérite aujourd'hui.
 *
 * Sa configuration était une copie complète : on n'en garde que ce qui diffère de son
 * héritage, ce qui laisse sa configuration effective identique. La seule exception est le
 * modèle résolu à la création à partir d'un « défaut du CLI » : il redevient le défaut,
 * que la relance résout à l'identique.
 */
export function legacyConversationOverrides(stored: AgentConfig, inherited: AgentConfig): ConfigOverrides {
  const overrides = diffAgentConfig(stored, inherited) as Record<string, unknown>
  const resolvedDefault = RESOLVED_DEFAULT_MODEL[stored.agent]
  if (resolvedDefault && inherited.model === CLI_DEFAULT && stored.model === resolvedDefault) {
    delete overrides.model
  }
  return overrides as ConfigOverrides
}

export interface ConfigBackfillReport {
  accounts: number
  projects: number
  conversations: number
}

/**
 * La migration de l'héritage vivant (#120), au démarrage, après les migrations SQL.
 *
 * Trois passes, dans l'ordre où les niveaux s'empilent, chacune calculée sur le résultat
 * de la précédente :
 *
 * 1. **Les comptes** : les défauts complets par CLI deviennent le niveau du compte. Tout
 *    est retenu, même ce qui égale le défaut du protocole — la valeur pouvait être un
 *    choix, et rien ne change à ce qui s'applique.
 * 2. **Les projets** : on ne retient que ce qui diffère des défauts du compte du
 *    propriétaire (décision de Tim, 2026-10-26). Pour lui, rien ne change.
 * 3. **Les conversations** : on ne retient que ce qui diffère de leur héritage.
 *
 * Idempotente sans marqueur : chaque passe ne touche que les lignes encore dans la forme
 * d'avant (`agentDefaults` sans `agentLayer`, une colonne de projet sans `shared`, un
 * `config_overrides` vide). Un arrêt au milieu reprend où il en était.
 */
export function backfillConfigLayers(db: Db): ConfigBackfillReport {
  const report: ConfigBackfillReport = { accounts: 0, projects: 0, conversations: 0 }

  const accountLayers = new Map<string, ConfigLayer>()
  writeTransaction(db, (tx) => {
    for (const row of tx.select().from(userSettings).all()) {
      let data: Record<string, unknown>
      try {
        const parsed = JSON.parse(row.data) as unknown
        data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
      } catch {
        continue
      }
      if ('agentLayer' in data) {
        accountLayers.set(row.userId, readConfigLayer(data.agentLayer))
        continue
      }
      const layer = accountLayerFromLegacy(data.agentDefaults)
      accountLayers.set(row.userId, layer)
      const { agentDefaults: _legacy, ...rest } = data
      tx.update(userSettings)
        .set({ data: JSON.stringify({ ...rest, agentLayer: layer }) })
        .where(eq(userSettings.userId, row.userId))
        .run()
      report.accounts += 1
    }
  })
  const accountOf = (userId: string) => accountLayers.get(userId) ?? EMPTY_CONFIG_LAYER

  const projectLayers = new Map<string, ConfigLayer>()
  writeTransaction(db, (tx) => {
    for (const row of tx.select().from(projects).where(isNotNull(projects.defaultConfig)).all()) {
      const legacy = readLegacyProjectConfigs(row.defaultConfig)
      if (!legacy) {
        projectLayers.set(row.id, readProjectLayer(row.defaultConfig))
        continue
      }
      const owner = accountOf(row.ownerId)
      const layer = layerFromFullConfigs(legacy, (agent) => resolveAgentConfig(agent, [owner]))
      projectLayers.set(row.id, layer)
      tx.update(projects).set({ defaultConfig: serializeProjectLayer(layer) }).where(eq(projects.id, row.id)).run()
      report.projects += 1
    }
  })

  writeTransaction(db, (tx) => {
    const rows = tx
      .select({
        id: conversations.id,
        userId: conversations.userId,
        projectId: conversations.projectId,
        agent: conversations.agent,
        config: conversations.config,
      })
      .from(conversations)
      .where(isNull(conversations.configOverrides))
      .all()
    for (const row of rows) {
      let stored: AgentConfig
      try {
        stored = parseAgentConfig(row.config)
      } catch {
        // Illisible avant comme après : le fil hérite de tout, ce qui vaut mieux qu'une
        // session qu'on ne peut plus lancer.
        tx.update(conversations).set({ configOverrides: '{}' }).where(eq(conversations.id, row.id)).run()
        report.conversations += 1
        continue
      }
      const layers = [accountOf(row.userId)]
      if (row.projectId) layers.push(projectLayers.get(row.projectId) ?? EMPTY_CONFIG_LAYER)
      const inherited = resolveAgentConfig(row.agent, layers)
      const overrides = legacyConversationOverrides(stored, inherited)
      tx.update(conversations)
        .set({ configOverrides: JSON.stringify(overrides) })
        .where(eq(conversations.id, row.id))
        .run()
      report.conversations += 1
    }
  })

  return report
}
