import { z } from 'zod'
import {
  DEFAULT_SCHEDULE_DURATION_MINUTES,
  MAX_SCHEDULE_DURATION_MINUTES,
  MIN_SCHEDULE_DURATION_MINUTES,
  scheduleCadenceSchema,
  type ScheduleCadence,
} from './schedules.js'
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

/**
 * Le Quand d'une commande planifiée : sa cadence, sa pause et sa durée maximale. Elle
 * tourne sans terminal ni personne pour l'arrêter : passé ce délai, elle est coupée et
 * son passage compte comme un échec. Absents, `enabled` vaut vrai et la durée celle
 * d'une tâche planifiée.
 */
export const DEFAULT_ACTION_SCHEDULE_DURATION_MINUTES = DEFAULT_SCHEDULE_DURATION_MINUTES

const actionScheduleShape = {
  cadence: scheduleCadenceSchema,
  enabled: z.boolean(),
  maxDurationMinutes: z.number().int().min(MIN_SCHEDULE_DURATION_MINUTES).max(MAX_SCHEDULE_DURATION_MINUTES),
}

export const actionScheduleSchema = z.object(actionScheduleShape).partial({ enabled: true, maxDurationMinutes: true })
export type ActionScheduleInput = z.infer<typeof actionScheduleSchema>

/** Une modification : la pause n'envoie que `enabled`. Null retire la planification. */
export const actionSchedulePatchSchema = z.object(actionScheduleShape).partial()
export type ActionSchedulePatch = z.infer<typeof actionSchedulePatchSchema>

const projectActionShape = {
  label: z.string().trim().min(1).max(MAX_ACTION_LABEL_CHARS),
  description: z.string().trim().max(MAX_ACTION_DESCRIPTION_CHARS).optional(),
  kind: projectActionKindSchema,
  command: z.string().trim().min(1).max(MAX_ACTION_COMMAND_CHARS),
  subdir: actionSubdirSchema.optional(),
  url: actionUrlSchema.optional(),
}

/**
 * Une commande se lance à la demande (un clic, un agent), à sa cadence, ou les deux ;
 * jamais ni l'un ni l'autre, elle ne partirait plus. `onDemand` absent vaut vrai.
 *
 * Seule une `task` se planifie : un service planifié (démarrer, arrêter à heure fixe)
 * demande une fenêtre que ce schéma n'a pas encore.
 */
export const createProjectActionBodySchema = z
  .object({
    ...projectActionShape,
    schedule: actionScheduleSchema.nullable().optional(),
    onDemand: z.boolean().optional(),
  })
  .refine((body) => body.onDemand !== false || Boolean(body.schedule), {
    message: 'On demand, scheduled, or both.',
    path: ['onDemand'],
  })
  .refine((body) => body.kind === 'task' || !body.schedule, {
    message: 'Only a task can be scheduled.',
    path: ['schedule'],
  })
export type CreateProjectActionBody = z.infer<typeof createProjectActionBodySchema>

/**
 * Tout est facultatif. La cohérence (à la demande ou planifiée, seule une tâche se
 * planifie) se juge sur l'action une fois modifiée : c'est le serveur qui la tient.
 */
export const updateProjectActionBodySchema = z
  .object({
    ...projectActionShape,
    schedule: actionSchedulePatchSchema.nullable(),
    onDemand: z.boolean(),
  })
  .partial()
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

/** Le Quand d'une commande planifiée, tel que l'interface le montre. */
export interface ProjectActionSchedule {
  cadence: ScheduleCadence
  enabled: boolean
  /** Null quand plus rien n'est prévu : en pause, ou ponctuelle déjà tirée. */
  nextRunAt: number | null
  /** Le dernier tir de la cadence ; null avant le premier. */
  lastRunAt: number | null
  maxDurationMinutes: number
}

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
  /** Un clic ou un agent peut la lancer. Faux : elle ne part qu'à sa cadence. */
  onDemand: boolean
  /** Null : elle ne part jamais seule. */
  schedule: ProjectActionSchedule | null
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
  /** La cadence relue : une commande planifiée part sans clic, sa cadence se relit aussi. */
  cadence: ScheduleCadence | null
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

/** Un lancement d'une action, dans un terminal ou détaché (commande planifiée). */
export interface ActionRunDto {
  id: string
  actionId: string
  trigger: ActionRunTrigger
  /** La session d'où elle est partie ; null hors session. */
  conversationId: string | null
  /** Le terminal qui l'a jouée ; il peut avoir été fermé depuis. Null pour un tir planifié, sans terminal. */
  terminalId: string | null
  cwd: string
  status: ActionRunStatus
  /** Null tant qu'elle tourne, quand l'arrêt du daemon l'a emportée, ou coupée par sa durée maximale. */
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
