import { z } from 'zod'
import type { ModeKind } from '@solera/codex-bindings'
import type { AskForApproval, SandboxMode } from '@solera/codex-bindings/v2'

/**
 * Réglages d'une conversation, par CLI.
 *
 * Volontairement non unifiés : le mode de permission de Claude et le couple
 * approbation/sandbox de Codex sont des concepts différents. L'UI affiche le
 * vocabulaire natif de chaque CLI plutôt que d'inventer une abstraction qui mentirait.
 */

export const claudePermissionModeSchema = z.enum([
  'manual',
  'auto',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
])
export type ClaudePermissionMode = z.infer<typeof claudePermissionModeSchema>

export const claudeEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * ## Les familles d'autorisation du serveur MCP de Solera, et le critère d'ouverture
 *
 * Les booléens qui suivent découpent les outils du serveur intégré en familles. Il y en
 * a quatre, et la question « faut-il une cinquième ? » se tranche par ce critère, écrit
 * ici une fois pour ne pas rouvrir le débat à chaque carte :
 *
 * > **Une famille existe quand son pouvoir n'est pas de la même nature que le socle —
 * > l'outil agit au-dessus du projet, ou il défait un choix qu'une personne a posé, ou
 * > il écrit hors de la base ce qui orientera les sessions suivantes.**
 *
 * **Le nombre d'outils n'entre pas dans le critère.** `soleraMcp` en porte une vingtaine
 * et `cardFiling` un seul ; ce n'est pas une anomalie, c'est ce que le critère dit. Un
 * découpage par volume redonnerait la matrice outil × portée que la carte #24 a écartée.
 *
 * Ce que le critère retient aujourd'hui, et pourquoi :
 *
 * - `soleraMcp` — le socle : lire, coordonner, écrire en ajout. C'est le terme de
 *   comparaison, pas une famille au sens du critère.
 * - `agentMemory` — écrit hors de la base ce qui orientera les sessions suivantes, sans
 *   que personne ne l'ait relu.
 * - `projectFiling` — agit au-dessus du projet où la session travaille.
 * - `cardFiling` — défait un choix qu'une personne a posé (la colonne d'une carte).
 *
 * Ce que le critère écarte, pour fixer les idées : `add_card_note` écrit, mais en ajout
 * et dans la base ; `set_project_image` remplace, mais n'est le jugement de personne et
 * se reprend d'un clic ; `start_session` coûte cher, mais ne sort pas du projet.
 *
 * **Quatre étages d'héritage**, les mêmes pour toutes les familles : conversation →
 * préréglage de projet (`projects.default_config`) → défaut de compte → `config.toml`.
 * Les trois premiers sont des points de départ (`??`), le dernier seul est un plafond
 * (`&&`), et c'est lui qui fait *disparaître* l'entrée de l'interface. Toutes les
 * couches intérieures veulent donc dire la même chose, ce qui est la condition pour que
 * la valeur affichée se lise ; un étage qui plafonnerait parfois et proposerait parfois
 * la rendrait illisible.
 *
 * **Le prix d'une famille neuve est de quatre endroits** — les trois schémas de CLI
 * ci-dessous et `apps/server/src/config.ts` — **plus deux catalogues i18n.** C'est cet
 * argument, et non le critère, qui tient le nombre à quatre.
 *
 * `FREE_THREAD_TOOLS` (`apps/server/src/mcp/solera-mcp.mjs`) n'est **pas** une famille et
 * n'a rien à faire dans un écran de réglages : c'est la liste des outils qui ont encore
 * un objet quand il n'y a pas de projet.
 */

/**
 * Monte le serveur MCP de Solera, qui ouvre à l'agent l'historique du projet.
 *
 * Vrai par défaut : c'est ce que la plateforme apporte de plus qu'un lancement direct du
 * CLI. Décochable par conversation pour le sujet où cette mémoire n'aide pas, et
 * coupable pour l'instance entière dans `config.toml`. Commun aux deux CLI, le serveur
 * ne devant rien à l'un ni à l'autre.
 *
 * C'est le socle, et les trois familles ci-dessous se découpent *dedans* : les couper
 * toutes laisse le socle, couper celui-ci les emporte avec lui.
 */
const soleraMcpSchema = z.boolean().default(true)

/**
 * Prête aux agents la mémoire de Solera : les trois outils `*_memory`, l'index injecté à
 * Codex et à opencode, et le dossier que Claude reçoit en `autoMemoryDirectory`.
 *
 * **Vrai par défaut** : une session qui ne retient rien est le comportement d'avant
 * Solera, et c'est la famille dont le critère dit qu'elle écrit hors de la base. On la
 * retire pour le sujet qu'on ne veut pas voir orienter les suivants, pas l'inverse.
 *
 * À faux, la mémoire est **éteinte** et non seulement démontée, et c'est vrai des trois
 * CLI : Claude reçoit `autoMemoryEnabled: false`, qui lui retire le dossier sans l'en
 * renvoyer à celui qu'il tient d'habitude (sondé sur Claude Code 2.1.291 : plus aucun
 * chemin de mémoire dans sa session, et aucun repli vers `~/.claude/projects/…`). C'est
 * ce qui permet à la case de s'appeler simplement « Mémoire » : si couper avait laissé
 * Claude écrire dans son dossier à lui, invisible et non partagé, il aurait fallu dire
 * « Mémoire partagée » et expliquer l'effet CLI par CLI.
 *
 * Trois chemins à couper ensemble, et le troisième est le plus facile à oublier : les
 * outils, le `autoMemoryDirectory` de Claude, **et l'index que `memoryAppendixForCodex`
 * injecte en début de session**. Sans lui, la mémoire rentrerait par la fenêtre, en
 * lecture, chez les deux CLI qui n'ont pas de mémoire native.
 */
const agentMemorySchema = z.boolean().default(true)

/**
 * Livre la bibliothèque de skills de Solera, globale et du projet, à la session.
 *
 * Un seul interrupteur, pas un par skill : un skill qu'on n'invoque pas ne coûte que sa
 * description dans le contexte. Coupable pour l'instance dans `config.toml`. Côté
 * Claude, le changer relance la session, les plugins n'étant que des options de
 * lancement ; Codex l'applique à chaud.
 */
const skillLibrarySchema = z.boolean().default(true)

/**
 * Ouvre à l'agent les deux outils de rangement : déclarer un projet, et demander le
 * déplacement d'une conversation.
 *
 * Faux par défaut, comme `cardFiling` et à la différence des deux autres familles : ces
 * deux outils agissent au-dessus du projet où la session travaille, et c'est une portée
 * qu'on accorde plutôt qu'une capacité qu'on retire. Vetoable pour l'instance entière
 * dans `config.toml`, où `[mcp] project_filing = false` fait aussi disparaître l'entrée
 * de l'interface.
 *
 * Un seul booléen de conversation suffit à tenir un agent, alors que les étages
 * héritent en `??` et non en `&&` : aucun des outils du serveur MCP ne touche à une
 * configuration, donc personne d'autre que l'utilisateur ne peut recocher celui-ci.
 * C'est l'argument qui vaut pour les quatre familles.
 */
const projectFilingSchema = z.boolean().default(false)

/**
 * Ouvre à l'agent `request_card_move` : proposer le déplacement d'une ou plusieurs
 * cartes du board, en disant pourquoi.
 *
 * **Faux par défaut**, comme `projectFiling` : c'est une portée qu'on accorde. Le critère
 * la retient parce que la colonne d'une carte est un choix qu'une personne a posé, et
 * qu'un agent qui le défait se donnerait un satisfecit. Une seule carte dans la famille
 * aujourd'hui, et ce n'est pas un argument — voir le critère plus haut. Vetoable pour
 * l'instance dans `config.toml`, où `[mcp] card_filing = false` fait aussi disparaître
 * l'entrée de l'interface.
 *
 * L'outil **ne déplace rien** : il dépose une demande que l'utilisateur accorde d'un
 * clic, et c'est le clic qui écrit `card_moves` au nom de la personne. C'est ce qui
 * permet d'autoriser toutes les colonnes, `abandoned` comprise : le tabou visait l'acte,
 * pas la proposition.
 */
const cardFilingSchema = z.boolean().default(false)

/**
 * Fait attendre la fin du tour aux messages envoyés pendant qu'il tourne, au lieu de
 * les y pousser.
 *
 * Faux par défaut : infléchir est le comportement ordinaire de l'envoi, et son pire
 * cas — un message qui arrive trop tard pour le tour en cours — est exactement ce que
 * la file produit de toute façon. Le réglage existe pour qui préfère écrire la suite
 * sans risquer de couper l'agent, et c'est le seul cas où le composer montre à la fois
 * le carré d'arrêt et la flèche.
 *
 * Réglage d'interface : le serveur le transporte et le conserve, aucun runner ne le
 * lit. Il vit dans la configuration de la conversation parce que c'est là que se
 * règle tout ce qui vaut pour une conversation et pas pour l'instance.
 */
const queueMessagesSchema = z.boolean().default(false)

export const claudeConfigSchema = z.object({
  agent: z.literal('claude'),
  model: z.string(),
  effort: claudeEffortSchema,
  permissionMode: claudePermissionModeSchema,
  additionalDirectories: z.array(z.string()).default([]),
  /** Identifiants de serveurs du registre MCP actifs sur cette conversation. */
  mcpServers: z.array(z.string()).default([]),
  soleraMcp: soleraMcpSchema,
  agentMemory: agentMemorySchema,
  projectFiling: projectFilingSchema,
  cardFiling: cardFilingSchema,
  skillLibrary: skillLibrarySchema,
  queueMessages: queueMessagesSchema,
  /**
   * Ignore les serveurs déclarés sur le disque du CLI (`~/.claude.json`, `.mcp.json`,
   * connecteurs claude.ai) pour ne garder que ceux de Solera.
   *
   * Faux par défaut : activer l'isolation d'office ferait disparaître sans prévenir des
   * serveurs que l'utilisateur a déclarés lui-même. Propre à Claude, Codex n'ayant pas
   * d'équivalent : son `config.toml` et son `codex_apps` intégré restent de toute façon.
   */
  strictMcp: z.boolean().default(false),
  /**
   * Mode rapide de Claude Code : même modèle, réponses plus rapides, facturées à part.
   *
   * Sur un abonnement, l'usage part en crédits d'usage, hors quota du forfait, et le
   * premier tour en mode rapide repaie le contexte entier à ce tarif, une fois par
   * conversation : c'est un réglage à poser au départ plutôt qu'à bascule. Seuls
   * certains modèles le gèrent (`supportsFastMode` dans le catalogue) ; l'activer sur
   * un autre fait basculer le CLI sur Opus. C'est le SDK qui doit opter : un `/fast`
   * tapé dans une session headless répond « non disponible », relevé à la sonde.
   */
  fastMode: z.boolean().default(false),
  /**
   * Ultracode de Claude Code : orchestration par workflows multi-agents sur chaque
   * tâche de fond, le coût en tokens n'étant plus une contrainte. Le mot-clé
   * « ultracode » dans un message n'en ouvre qu'un tour ; ce réglage le tient pour
   * toute la session. Propre à la session, jamais écrit dans les fichiers du CLI.
   * Depuis Claude Code 2.1.284, il n'impose plus l'effort `xhigh` et tient à tout
   * niveau, mais le CLI ne l'ouvre toujours qu'aux modèles qui gèrent `xhigh` (sondé
   * sur 2.1.296 : ouvert à Haiku 5.5, refusé à Haiku 4.5 et Sonnet 4.6).
   */
  ultracode: z.boolean().default(false),
  /**
   * Style de sortie du CLI (`Concise`, `Explanatory`…), parmi ceux que le catalogue
   * annonce. Vide pour laisser le style par défaut.
   */
  outputStyle: z.string().default(''),
  /**
   * Modèle conseiller (`/advisor`), que le modèle principal peut consulter en cours de
   * tâche. Vide pour ne pas en donner : chaque consultation est un appel de plus.
   */
  advisorModel: z.string().default(''),
  /**
   * Garde-fous d'une session que personne ne regarde, pensés pour l'API de tâches :
   * coût cumulé en dollars et nombre d'appels de modèle au-delà desquels le CLI
   * referme le tour en erreur (`error_max_budget_usd`, `error_max_turns`). Comptés par
   * process : une session relancée pour un réglage repart de zéro. `null` ne plafonne
   * rien, ce qui est le défaut d'une conversation humaine ; le composer ne les montre
   * pas.
   */
  maxBudgetUsd: z.number().positive().nullable().default(null),
  maxTurns: z.number().int().positive().nullable().default(null),
})
export type ClaudeConfig = z.infer<typeof claudeConfigSchema>

/**
 * Les valeurs Codex ci-dessous ne sont pas choisies par Solera : elles doivent
 * refléter `@solera/codex-bindings`, généré par le binaire installé. Les
 * assertions de type en fin de fichier échouent à la compilation si elles divergent,
 * ce qui rend impossible une recopie approximative comme celle qui traînait ici.
 */

/** Variante objet de `AskForApproval`, qui règle chaque garde-fou séparément. */
export const codexGranularApprovalSchema = z.object({
  granular: z.object({
    sandbox_approval: z.boolean(),
    rules: z.boolean(),
    skill_approval: z.boolean(),
    request_permissions: z.boolean(),
    mcp_elicitations: z.boolean(),
  }),
})

export const codexApprovalNameSchema = z.enum(['untrusted', 'on-request', 'never'])

export type CodexApprovalName = z.infer<typeof codexApprovalNameSchema>

/**
 * Fidèle au protocole : c'est ce schéma que l'assertion de dérive compare à
 * `AskForApproval` généré. Il ne doit accepter que ce que Codex accepte.
 */
export const codexApprovalSchema = z.union([
  codexApprovalNameSchema,
  codexGranularApprovalSchema,
])

/**
 * Ce que Solera accepte dans une configuration de conversation : le protocole, plus
 * la sentinelle `CLI_DEFAULT`.
 *
 * `thread/start` et `turn/start` déclarent `approvalPolicy` nullable, et un null y
 * signifie « applique la politique configurée dans le CLI ». La sentinelle exprime
 * exactement cet état, au même titre que pour le modèle et l'effort.
 *
 * `on-failure`, déprécié de longue date, a disparu du protocole avec Codex 0.146. Les
 * conversations écrites avant le retrait le portent encore en base : elles se relisent
 * sur `on-request`, le plus proche, plutôt que de devenir illisibles.
 */
export const codexApprovalConfigSchema = z.preprocess(
  (value) => (value === 'on-failure' ? 'on-request' : value),
  z.union([z.literal(''), codexApprovalNameSchema, codexGranularApprovalSchema]),
)

export const codexSandboxSchema = z.enum([
  'read-only',
  'workspace-write',
  'danger-full-access',
])

/**
 * `ReasoningEffort` est une chaîne libre dans le protocole : les niveaux réellement
 * acceptés dépendent du modèle et sont annoncés par `model/list`
 * (`supportedReasoningEfforts`). Toute énumération figée ici serait une invention.
 */
export const codexEffortSchema = z.string()

/**
 * Mode de collaboration Codex, l'équivalent du mode Plan de Claude.
 *
 * Ce n'est pas une invention de Solera : le mode est porté par `turn/start`, derrière
 * la capacité `experimentalApi`, et c'est lui qui décide des outils accessibles au
 * modèle. En `default`, `request_user_input` est refusé par le routeur du CLI, donc
 * l'agent ne peut pas poser de question à choix : il se rabat sur une liste écrite
 * dans sa réponse.
 */
export const codexModeSchema = z.enum(['plan', 'default'])
export type CodexMode = z.infer<typeof codexModeSchema>

export const codexConfigSchema = z.object({
  agent: z.literal('codex'),
  /** Vide signifie « modèle par défaut du CLI », résolu à la création. */
  model: z.string(),
  reasoningEffort: codexEffortSchema,
  collaborationMode: codexModeSchema.default('default'),
  askForApproval: codexApprovalConfigSchema,
  sandbox: codexSandboxSchema,
  webSearch: z.boolean().default(false),
  profile: z.string().nullable().default(null),
  additionalDirectories: z.array(z.string()).default([]),
  /** Identifiants de serveurs du registre MCP actifs sur cette conversation. */
  mcpServers: z.array(z.string()).default([]),
  soleraMcp: soleraMcpSchema,
  agentMemory: agentMemorySchema,
  projectFiling: projectFilingSchema,
  cardFiling: cardFilingSchema,
  skillLibrary: skillLibrarySchema,
  queueMessages: queueMessagesSchema,
})
export type CodexConfig = z.infer<typeof codexConfigSchema>

/**
 * Règle d'opencode pour une famille d'outils : demander, laisser faire, refuser.
 *
 * La chaîne vide est la sentinelle `CLI_DEFAULT` : Solera ne pose alors aucune règle
 * et celle de l'`opencode.json` de l'utilisateur s'applique (à défaut, opencode laisse
 * faire). Les valeurs sont celles de `PermissionActionConfig` dans l'OpenAPI.
 */
export const opencodePermissionSchema = z.enum(['', 'ask', 'allow', 'deny'])
export type OpencodePermission = z.infer<typeof opencodePermissionSchema>

/**
 * Les familles d'outils que Solera règle. opencode en connaît d'autres (`read`,
 * `task`, `skill`…) : elles gardent la règle du CLI, les exposer toutes ferait un écran
 * de réglages que personne ne lit.
 */
export const opencodePermissionsSchema = z.object({
  edit: opencodePermissionSchema.default('ask'),
  bash: opencodePermissionSchema.default('ask'),
  webfetch: opencodePermissionSchema.default(''),
})
export type OpencodePermissions = z.infer<typeof opencodePermissionsSchema>

export const opencodeConfigSchema = z.object({
  agent: z.literal('opencode'),
  /** `fournisseur/modèle`, tel qu'opencode l'écrit. Vide : le défaut du CLI. */
  model: z.string(),
  /**
   * Variante du modèle (`low`, `high`, `max`…), l'équivalent de l'effort chez les deux
   * autres. Chaîne libre : chaque modèle annonce les siennes dans le catalogue.
   */
  variant: z.string().default(''),
  /**
   * Agent primaire d'opencode qui mène le tour : `build`, `plan`, ou un agent déclaré
   * par l'utilisateur. C'est le pendant du `collaborationMode` de Codex, à ceci près
   * que la liste est ouverte. Nommé ainsi parce que `agent` est déjà le discriminant.
   */
  primaryAgent: z.string().default('build'),
  permissions: opencodePermissionsSchema.default({}),
  additionalDirectories: z.array(z.string()).default([]),
  /** Identifiants de serveurs du registre MCP actifs sur cette conversation. */
  mcpServers: z.array(z.string()).default([]),
  soleraMcp: soleraMcpSchema,
  agentMemory: agentMemorySchema,
  projectFiling: projectFilingSchema,
  cardFiling: cardFilingSchema,
  skillLibrary: skillLibrarySchema,
  queueMessages: queueMessagesSchema,
})
export type OpencodeConfig = z.infer<typeof opencodeConfigSchema>

export const agentConfigSchema = z.discriminatedUnion('agent', [
  claudeConfigSchema,
  codexConfigSchema,
  opencodeConfigSchema,
])
export type AgentConfig = z.infer<typeof agentConfigSchema>

/**
 * Chaîne vide = « laisser le CLI décider ». Le serveur la remplace par le modèle et
 * l'effort réellement annoncés par le CLI au moment de créer la conversation.
 *
 * Écrire ici un identifiant au jugé (`gpt-5-codex`, qui n'existe pas) donne une
 * conversation qui échoue au lancement, des mois après la faute.
 */
export const CLI_DEFAULT = ''

export const DEFAULT_CLAUDE_CONFIG: ClaudeConfig = {
  agent: 'claude',
  model: CLI_DEFAULT,
  effort: 'medium',
  permissionMode: 'manual',
  additionalDirectories: [],
  mcpServers: [],
  soleraMcp: true,
  agentMemory: true,
  projectFiling: false,
  cardFiling: false,
  skillLibrary: true,
  queueMessages: false,
  strictMcp: false,
  fastMode: false,
  ultracode: false,
  outputStyle: CLI_DEFAULT,
  advisorModel: CLI_DEFAULT,
  maxBudgetUsd: null,
  maxTurns: null,
}

export const DEFAULT_CODEX_CONFIG: CodexConfig = {
  agent: 'codex',
  model: CLI_DEFAULT,
  reasoningEffort: CLI_DEFAULT,
  askForApproval: 'on-request',
  collaborationMode: 'default',
  sandbox: 'workspace-write',
  webSearch: false,
  profile: null,
  additionalDirectories: [],
  mcpServers: [],
  soleraMcp: true,
  agentMemory: true,
  projectFiling: false,
  cardFiling: false,
  skillLibrary: true,
  queueMessages: false,
}

export const DEFAULT_OPENCODE_CONFIG: OpencodeConfig = {
  agent: 'opencode',
  model: CLI_DEFAULT,
  variant: CLI_DEFAULT,
  primaryAgent: 'build',
  // opencode laisse tout faire par défaut. Solera part de « demander » pour ce qui
  // écrit ou exécute, comme le mode manuel de Claude et le `on-request` de Codex.
  permissions: { edit: 'ask', bash: 'ask', webfetch: CLI_DEFAULT },
  additionalDirectories: [],
  mcpServers: [],
  soleraMcp: true,
  agentMemory: true,
  projectFiling: false,
  cardFiling: false,
  skillLibrary: true,
  queueMessages: false,
}

/**
 * Garde-fou de compilation : si `pnpm codex:types` fait apparaître une nouvelle
 * variante d'approbation ou de sandbox, ces alias deviennent `never` et le typecheck
 * échoue. C'est ce qui empêche les schémas Zod ci-dessus de mentir sur le protocole.
 */
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/**
 * `false` et non `never` : `never extends true` est vrai, donc une assertion bâtie
 * sur `never` passerait toujours et ne servirait à rien.
 */
type AssertTrue<T extends true> = T

export type ApprovalMatchesProtocol = AssertTrue<
  Exactly<z.infer<typeof codexApprovalSchema>, AskForApproval>
>
export type SandboxMatchesProtocol = AssertTrue<
  Exactly<z.infer<typeof codexSandboxSchema>, SandboxMode>
>
export type ModeMatchesProtocol = AssertTrue<Exactly<z.infer<typeof codexModeSchema>, ModeKind>>

/**
 * Relit une configuration stockée en base.
 *
 * Passer par le schéma plutôt que par un cast : ses valeurs par défaut rattrapent les
 * conversations écrites avant l'ajout d'un réglage. Sans ça, le champ manquant partait
 * `undefined` au CLI, qui rejetait le tour, longtemps après la mise à jour qui l'a
 * introduit.
 */
export function parseAgentConfig(stored: string): AgentConfig {
  return agentConfigSchema.parse(JSON.parse(stored))
}

/**
 * Table plutôt que ternaire : un CLI ajouté à l'enum sans sa ligne ici ne compile
 * pas, là où le ternaire binaire lui aurait attribué les défauts Codex en silence.
 */
export const DEFAULT_CONFIGS: Record<AgentConfig['agent'], AgentConfig> = {
  claude: DEFAULT_CLAUDE_CONFIG,
  codex: DEFAULT_CODEX_CONFIG,
  opencode: DEFAULT_OPENCODE_CONFIG,
}

export function defaultConfigFor(agent: AgentConfig['agent']): AgentConfig {
  return DEFAULT_CONFIGS[agent]
}

