import { z } from 'zod'
import type { TerminalDto } from './terminal.js'

/**
 * Actions de projet : des boutons qui lancent une commande dans le dossier du projet.
 *
 * Tenues par Solera, jamais écrites dans le dépôt : chacun a son propre outillage, et
 * un `.solera/` versionné imposerait le sien à tous ceux qui clonent.
 *
 * Deux natures, parce qu'elles ne vivent pas pareil :
 * - `task` : une commande ponctuelle (tests, seed, build), jouée dans un terminal du
 *   panneau, qui se termine et laisse son écran et son code de sortie ;
 * - `service` : une commande qui tourne (serveur de dev, worker), portée par une unité
 *   systemd `solera-app-*` pour survivre au daemon et apparaître dans Services. Sans
 *   systemd utilisateur (macOS, conteneur), elle retombe dans un terminal.
 *
 * Les bornes sont ici parce que le formulaire les affiche et que l'outil MCP
 * `register_action` doit refuser la même chose que la route.
 */

export const MAX_ACTION_LABEL_CHARS = 60
export const MAX_ACTION_DESCRIPTION_CHARS = 300
export const MAX_ACTION_COMMAND_CHARS = 4000
export const MAX_ACTION_SUBDIR_CHARS = 300
export const MAX_ACTION_URL_CHARS = 500
/** Au-delà, ce n'est plus une barre de boutons mais un Makefile. */
export const MAX_ACTIONS_PER_PROJECT = 30

export const projectActionKindSchema = z.enum(['task', 'service'])
export type ProjectActionKind = z.infer<typeof projectActionKindSchema>

/**
 * Sous-dossier relatif au worktree où la commande s'exécute. Relatif et sans `..` :
 * une action suit le worktree de la conversation, un chemin absolu la ferait toujours
 * tourner au même endroit.
 */
export const actionSubdirSchema = z
  .string()
  .trim()
  .max(MAX_ACTION_SUBDIR_CHARS)
  .refine((value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'), {
    message: 'Relative path inside the project, without "..".',
  })

/**
 * Adresse où ouvrir un service, pour un lien dans l'interface. `{port}` y est remplacé
 * par le premier port sur lequel le service écoute : l'agent n'a pas à deviner celui
 * qu'un serveur de dev aura pris. Elle doit être joignable depuis le navigateur de
 * l'utilisateur, ce qui exclut souvent `localhost` quand Solera tourne ailleurs.
 */
export const actionUrlSchema = z
  .string()
  .trim()
  .max(MAX_ACTION_URL_CHARS)
  .refine((value) => value === '' || isHttpUrl(value.replaceAll('{port}', '1')), {
    message: 'An http(s) URL, optionally with {port}.',
  })

/** Sans `URL`, absent des types de ce paquet partagé entre navigateur et serveur. */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i.test(value)
}

/**
 * L'URL à ouvrir, ou null : sans gabarit, ou avec `{port}` alors que le service
 * n'écoute encore sur rien.
 */
export function resolveActionUrl(template: string | null, ports: readonly number[]): string | null {
  if (!template) return null
  if (!template.includes('{port}')) return template
  const port = ports[0]
  return port === undefined ? null : template.replaceAll('{port}', String(port))
}

export const createProjectActionBodySchema = z.object({
  label: z.string().trim().min(1).max(MAX_ACTION_LABEL_CHARS),
  description: z.string().trim().max(MAX_ACTION_DESCRIPTION_CHARS).optional(),
  kind: projectActionKindSchema,
  command: z.string().trim().min(1).max(MAX_ACTION_COMMAND_CHARS),
  subdir: actionSubdirSchema.optional(),
  url: actionUrlSchema.optional(),
})
export type CreateProjectActionBody = z.infer<typeof createProjectActionBodySchema>

export const updateProjectActionBodySchema = createProjectActionBodySchema.partial()
export type UpdateProjectActionBody = z.infer<typeof updateProjectActionBodySchema>

/** Au-delà, ce ne sont plus des arguments mais une autre commande, à relire comme telle. */
export const MAX_ACTION_RUN_ARGS = 200
export const MAX_ACTION_RUN_ARG_CHARS = 1000

const actionPlaceShape = {
  conversationId: z.string().min(1).optional(),
  worktreeId: z.string().min(1).optional(),
}

const onePlace = (body: { conversationId?: string; worktreeId?: string }) =>
  !(body.conversationId && body.worktreeId)
const onePlaceMessage = { message: 'Either a conversation or a worktree, not both.' }

/**
 * Où l'action tourne : le worktree d'une conversation, un worktree du projet choisi hors
 * conversation, ou à défaut la racine du projet.
 */
export const actionPlaceBodySchema = z.object(actionPlaceShape).refine(onePlace, onePlaceMessage)

/**
 * `args` s'ajoutent à la commande validée, chacun cité pour le shell : « relancer
 * seulement les échecs » passe des chemins, pas du code. Refusés par `run_action` : un
 * agent n'a pas à étendre une commande que l'utilisateur a relue.
 */
export const runProjectActionBodySchema = z
  .object({
    ...actionPlaceShape,
    args: z.array(z.string().min(1).max(MAX_ACTION_RUN_ARG_CHARS)).max(MAX_ACTION_RUN_ARGS).optional(),
  })
  .refine(onePlace, onePlaceMessage)
export type RunProjectActionBody = z.infer<typeof runProjectActionBodySchema>

export const serviceActionControlSchema = z.enum(['stop', 'restart'])
export type ServiceActionControl = z.infer<typeof serviceActionControlSchema>

/** État d'une action `service` portée par systemd. */
export interface ProjectActionServiceState {
  unit: string
  /** `ActiveState` de systemd ; `inactive` quand l'unité n'existe pas. */
  state: string
  cwd: string | null
  ports: number[]
  startedAt: number | null
}

export interface ProjectActionDto {
  id: string
  projectId: string
  label: string
  description: string | null
  kind: ProjectActionKind
  command: string
  subdir: string | null
  /** Gabarit d'URL d'un service, `{port}` compris ; null sans lien. */
  url: string | null
  /**
   * `proposed` : écrite ou modifiée par un agent et pas encore relue. Un clic lance la
   * commande hors de toute session : on la montre avant la première exécution, pour
   * qu'une injection de prompt ne puisse pas y glisser ce qu'on lancerait sans voir.
   */
  status: 'approved' | 'proposed'
  /** Conversation qui l'a créée ou modifiée en dernier ; null depuis l'interface. */
  agentConversationId: string | null
  /** Son titre, pour dire d'où vient une action à relire ; null si elle n'existe plus. */
  agentConversationTitle: string | null
  createdAt: number
  updatedAt: number
  /**
   * Ce qu'une personne a validé en dernier. Différent de la commande quand un agent l'a
   * modifiée depuis : la relecture montre l'écart, et le refus y revient. Null tant que
   * l'action n'a jamais été validée.
   */
  approved: ProjectActionReviewed | null
  /** Null pour une `task`, ou quand systemd n'est pas disponible. */
  service: ProjectActionServiceState | null
  /** Dernière exécution dans un terminal, tant que son onglet est ouvert. */
  lastRun: ProjectActionLastRun | null
  /** Les derniers passages, le plus récent d'abord, sans leur extrait (`ACTION_RUNS_SHOWN` au plus). */
  runs: ActionRunDto[]
}

export interface ProjectActionReviewed {
  kind: ProjectActionKind
  command: string
  subdir: string | null
  url: string | null
}

/** Combien de passages une action montre, et combien le serveur en garde. */
export const ACTION_RUNS_SHOWN = 20
export const ACTION_RUNS_KEPT = 100
/** Les dernières lignes de la sortie d'un passage, coupées sur une fin de ligne. */
export const MAX_ACTION_RUN_EXCERPT_CHARS = 4000

/** `schedule` : lancée par sa cadence (commande planifiée). */
export const actionRunTriggerSchema = z.enum(['manual', 'agent', 'schedule'])
export type ActionRunTrigger = z.infer<typeof actionRunTriggerSchema>

/** `stopped` : arrêtée, par Ctrl-C, la fermeture de son terminal ou l'arrêt du daemon. */
export type ActionRunStatus = 'running' | 'succeeded' | 'failed' | 'stopped'

/** Un lancement d'une action dans un terminal. */
export interface ActionRunDto {
  id: string
  actionId: string
  trigger: ActionRunTrigger
  /** La session d'où elle est partie ; null hors session. */
  conversationId: string | null
  /** Le terminal qui l'a jouée ; il peut avoir été fermé depuis. */
  terminalId: string | null
  cwd: string
  status: ActionRunStatus
  /** Null tant qu'elle tourne, ou quand l'arrêt du daemon l'a emportée. */
  exitCode: number | null
  startedAt: number
  finishedAt: number | null
}

/** Un passage avec les dernières lignes de sa sortie, pour le détail d'une action. */
export interface ActionRunDetailDto extends ActionRunDto {
  excerpt: string | null
}

const STOP_SIGNALS = [1, 2, 9, 15]

/**
 * Le verdict d'un code de sortie. 128 + n est le code d'une commande tuée par le signal
 * n : SIGHUP (son terminal fermé), SIGINT (Ctrl-C), SIGKILL et SIGTERM disent qu'on l'a
 * arrêtée, pas qu'elle a échoué. Les autres signaux (SIGSEGV, SIGABRT) sont des plantages.
 */
export function actionRunStatusOf(exitCode: number): Exclude<ActionRunStatus, 'running'> {
  if (exitCode === 0) return 'succeeded'
  return STOP_SIGNALS.includes(exitCode - 128) ? 'stopped' : 'failed'
}

export interface ProjectActionLastRun {
  terminalId: string
  alive: boolean
  /** Null tant qu'elle tourne, ou si un redémarrage du daemon l'a interrompue. */
  exitCode: number | null
  startedAt: number
}

/** Ce que rend une exécution : le terminal ouvert, ou l'unité démarrée. */
export interface ProjectActionRunResult {
  terminal: TerminalDto | null
  service: ProjectActionServiceState | null
  /** Une exécution précédente tourne encore : on la rend au lieu d'en lancer une seconde. */
  alreadyRunning: boolean
}

/**
 * « Essayer » une commande depuis l'éditeur, sans l'enregistrer : un terminal d'essai,
 * avec les droits d'un terminal. Depuis une conversation, dans son worktree et son
 * environnement ; sinon à la racine du projet. Le titre vient de l'interface, qui le
 * traduit ; sans lui, la première ligne de la commande en tient lieu.
 */
/** Le titre d'un terminal d'essai : « Essai · » suivi du libellé ou de la commande. */
export const MAX_TRY_TITLE_CHARS = 80

export const tryProjectActionBodySchema = z.object({
  command: z.string().trim().min(1).max(MAX_ACTION_COMMAND_CHARS),
  subdir: actionSubdirSchema.optional(),
  title: z.string().trim().min(1).max(MAX_TRY_TITLE_CHARS).optional(),
  conversationId: z.string().min(1).optional(),
})
export type TryProjectActionBody = z.infer<typeof tryProjectActionBodySchema>

/** Au-delà, la liste n'aide plus à choisir : un dépôt à cent scripts se parcourt ailleurs. */
export const MAX_ACTION_SUGGESTIONS = 40

/**
 * Pourquoi une suggestion a cette nature : son nom annonce un serveur (`dev`, `start`,
 * `serve`, `storybook`, `preview`), elle lance des conteneurs (`docker compose up`), ou,
 * par défaut, c'est une commande qui se termine.
 */
export type ActionSuggestionReason = 'service-name' | 'compose' | 'task'

/**
 * Une commande trouvée dans le dépôt du projet, pour remplir l'éditeur d'un clic. Le
 * libellé et l'explication se composent côté interface, à partir de `name` et `reason`.
 */
export interface ActionSuggestion {
  /** Fichier d'où elle vient, relatif à la racine : `package.json`, `apps/web/package.json`, `Makefile`… */
  source: string
  /** Le script, la cible, la recette ou le fichier, tel qu'écrit dans la source. */
  name: string
  kind: ProjectActionKind
  reason: ActionSuggestionReason
  command: string
  /** Dossier où la lancer, relatif à la racine ; '' pour la racine. */
  subdir: string
  /** Gabarit de lien d'un service web ; null sinon. */
  url: string | null
}
