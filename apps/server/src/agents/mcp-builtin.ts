import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_MCP_SERVER_NAME, type AgentConfig, type McpServer } from '@solera/protocol'

/**
 * Le serveur MCP de Solera, monté d'office dans chaque conversation.
 *
 * Ce n'est pas une ligne de `mcp_servers` : personne ne l'a déclaré, il n'a ni commande
 * à saisir ni secret à garder, et son nom est réservé pour qu'aucune entrée du registre
 * ne vienne l'écraser. Il emprunte quand même la forme `McpServer`, ce qui lui fait
 * traverser les deux adaptateurs de CLI et l'inventaire sans qu'aucun d'eux ait à
 * connaître son existence.
 *
 * Activé par défaut, désactivable à trois niveaux : la conversation, pour le temps d'un
 * sujet ; le défaut des nouvelles conversations, dans les réglages ; l'instance entière,
 * dans `config.toml`, pour qui ne veut de Solera qu'une interface aux CLI.
 *
 * Les familles d'autorisation se découpent *dans* ce serveur et arrivent ici en portées
 * — un dossier de mémoire vide, un drapeau de rangement — jamais en liste d'outils :
 * c'est le `.mjs` qui tient son catalogue. Le critère d'ouverture d'une famille est
 * écrit en tête de `packages/protocol/src/agent-config.ts`.
 */

/** Identifiant distinct de ceux du registre, qui sont des UUID. */
export const BUILTIN_MCP_SERVER_ID = 'builtin:solera'

/**
 * Le fichier du serveur, selon qu'on tourne sur les sources ou sur le bundle.
 *
 * En développement ce module est `src/agents/mcp-builtin.ts` et le serveur son voisin
 * `src/mcp/` ; en production tsup a tout fondu dans `dist/main.js` et le `.mjs` est
 * copié dans `dist/mcp/`. Deux candidats testés plutôt qu'un drapeau d'environnement,
 * qui mentirait le jour où quelqu'un lance le bundle depuis le dépôt.
 */
export function resolveEntry(): string {
  const candidates = [
    join(import.meta.dirname, '../mcp/solera-mcp.mjs'),
    join(import.meta.dirname, 'mcp/solera-mcp.mjs'),
  ]
  const found = candidates.find((path) => existsSync(path))
  if (!found) {
    throw new Error(`Serveur MCP Solera introuvable (cherché : ${candidates.join(', ')})`)
  }
  return found
}

export interface BuiltinMcpParams {
  /** Interrupteur global de `config.toml`. */
  enabled: boolean
  config: AgentConfig
  databasePath: string
  /**
   * Projet de la conversation, ou null pour un fil libre — et le serveur part quand
   * même, en n'exposant que les outils qui ne parlent pas d'un projet : la mémoire du
   * compte et la partie globale de SOLERA.md. C'est le `.mjs` qui tient cette liste,
   * pas ce module : lui ne fait que transmettre la portée, et une portée vide en est
   * une.
   */
  projectId: string | null
  conversationId: string
  /**
   * Dossier de mémoire, du projet ou du compte, où `write_memory` écrit pour Codex.
   *
   * **Vide quand la famille `agentMemory` est refusée**, et c'est ce vide qui coupe :
   * le `.mjs` retire alors les trois outils `*_memory` de son catalogue, comme il
   * retire ceux du rangement. Un seul signal pour les deux moitiés de l'interrupteur —
   * la liste des outils et le dossier où ils écriraient — plutôt qu'un booléen de plus
   * à tenir d'accord avec un chemin.
   */
  memoryDir: string
  /**
   * Ouvre les deux outils de rangement (`create_project`, `move_conversation`).
   *
   * Portée dédiée et non capacité par défaut : ces deux outils agissent au-dessus du
   * projet où la session travaille. Le daemon revérifie de son côté, la base étant la
   * seule autorité ; ici, c'est ce qui décide si les outils apparaissent du tout.
   */
  projectFiling: boolean
  /**
   * Ouvre `request_card_change` : proposer de changer une carte du board — sa colonne,
   * sa parente, son échéance ou ses blocages.
   *
   * Sa propre portée et non une part de `projectFiling`, parce que les deux ne parlent
   * pas de la même chose : l'un agit au-dessus du projet, l'autre défait un choix qu'une
   * personne a posé dedans. Voir le critère en tête de `agent-config.ts`.
   */
  cardFiling: boolean
  /**
   * Ouvre `request_decision` : demander à une personne de trancher, sans attendre.
   * Le daemon revérifie le drapeau, et relit lui-même le délai maximal.
   */
  decisions: boolean
  /**
   * Le fichier d'état du Storybook du design system lié, que le daemon tient à jour
   * (`design-system/storybooks.ts`). Vide quand le projet n'a pas de DS : le `.mjs`
   * retire alors les outils du design system de son catalogue.
   */
  designSystemState: string
}

/**
 * Faux quand le serveur ne doit pas partir. L'absence de projet n'en fait pas partie.
 *
 * `strictMcp` l'emporte sur l'activation : le drapeau annonce « rien d'autre que ce que
 * j'ai déclaré » et se contredirait à garder une exception maison.
 */
export function builtinMcpEnabled(enabled: boolean, config: AgentConfig): boolean {
  if (!enabled || !config.soleraMcp) return false
  return !(config.agent === 'claude' && config.strictMcp)
}

export function builtinMcpServer(params: BuiltinMcpParams): McpServer | null {
  const {
    enabled,
    config,
    databasePath,
    projectId,
    conversationId,
    memoryDir,
    projectFiling,
    cardFiling,
    decisions,
    designSystemState,
  } = params
  if (!builtinMcpEnabled(enabled, config)) return null

  return {
    id: BUILTIN_MCP_SERVER_ID,
    name: BUILTIN_MCP_SERVER_NAME,
    enabled: true,
    transport: {
      type: 'stdio',
      // `process.execPath` et non « node » : sous systemd le PATH est minimal, et rien
      // ne garantit que celui du CLI mène au même runtime que celui du serveur.
      command: process.execPath,
      args: [resolveEntry()],
      // Une portée, jamais un secret : le serveur lit la base directement, il n'a donc
      // aucun jeton à recevoir, et l'environnement d'un process reste lisible par
      // quiconque a un shell sur la machine.
      env: {
        SOLERA_MCP_DB: databasePath,
        // Vide plutôt qu'absente pour un fil libre : les deux se lisent pareil côté
        // serveur, et une variable toujours posée se voit dans `ps` même quand elle
        // n'a rien à dire.
        SOLERA_MCP_PROJECT: projectId ?? '',
        SOLERA_MCP_CONVERSATION: conversationId,
        SOLERA_MCP_MEMORY: memoryDir,
        ...(projectFiling ? { SOLERA_MCP_FILING: '1' } : {}),
        ...(cardFiling ? { SOLERA_MCP_CARD_FILING: '1' } : {}),
        ...(decisions ? { SOLERA_MCP_DECISIONS: '1' } : {}),
        SOLERA_MCP_DESIGN_SYSTEM: designSystemState,
      },
    },
    createdAt: 0,
    updatedAt: 0,
  }
}
