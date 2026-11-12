import {
  DEFAULT_CHECK_TIMEOUT_SECONDS,
  DEFAULT_SCHEDULE_DURATION_MINUTES,
  MAX_ACTION_LABEL_CHARS,
  MAX_CHECK_TIMEOUT_SECONDS,
  MAX_SCHEDULE_DURATION_MINUTES,
  MAX_SCHEDULE_NAME_CHARS,
  MIN_CHECK_TIMEOUT_SECONDS,
  MIN_SCHEDULE_DURATION_MINUTES,
  actionUrlSchema,
  type ActionPlacement,
  type AgentConfig,
  type AgentKind,
  type ScheduleCadence,
  type ScheduleOverlapPolicy,
  type ScheduleWorktreeMode,
} from '@solera/protocol'
import {
  draftOf,
  natureWord,
  type Automation,
  type AutomationDraft,
  type CommandKind,
  type Translate,
  type What,
} from './automations'
import type { MessageKey } from './i18n'
import { targetOfItem } from './planned'
import type { ScheduleTarget } from './schedules'

/**
 * L'éditeur unifié d'une action (`actions.md` §1.E) : ce qu'il tient, ce qu'il reproche à
 * chaque champ, et ce qu'il enregistre. Pur : le composant `ActionEditor` le rend, les
 * tests le lisent seul.
 *
 * Deux étapes : **Quoi** (une commande — tâche ou service — ou un agent), puis **Quand**
 * (à la demande, planifiée, ou les deux). La nature d'une action existante ne change pas
 * (Q5) : c'est l'appelant qui fige les cartes Quoi.
 */

/** D'où l'éditeur part (EDI-1). Il est remonté à neuf quand la graine change. */
export interface EditorSeed {
  /** Modifier une action existante. */
  from?: Automation
  /** « Dupliquer » : un brouillon complet, pour une nouvelle action (`duplicateDraft`). */
  draft?: AutomationDraft
  /** « Planifier » : arriver sur Quand, « Planifiée » cochée. */
  schedule?: boolean
  /** « + Nouveau service / commande / agent » : la nature choisie d'avance. */
  preset?: { what: What; kind?: CommandKind }
  /** « En faire une action » : ce qu'une session a lancé, pré-rempli. */
  prefill?: { label?: string; command?: string; url?: string; description?: string }
  /**
   * Hors d'un projet (la page Planifiées) : la portée proposée d'office, que le champ
   * Portée laisse changer (PLF-10). Absente, c'est l'hôte qui donne le projet.
   */
  target?: ScheduleTarget
}

export interface EditorState {
  what: What
  kind: CommandKind
  label: string
  description: string
  /* Commande */
  command: string
  subdir: string
  url: string
  placement: ActionPlacement
  pinnedBranch: string
  /* Agent */
  agent: AgentKind
  /** La configuration enregistrée ; null pour une nouvelle tâche, qui prend celle du projet. */
  config: AgentConfig | null
  prompt: string
  worktreeMode: ScheduleWorktreeMode
  /** Null : le réglage du projet. */
  confined: boolean | null
  overlapPolicy: ScheduleOverlapPolicy
  maxDuration: string
  /** Null : pas de vérification. */
  checkScript: string | null
  /**
   * Le script ne repart que si quelqu'un l'a touché : l'enregistrer depuis l'interface
   * vaut le valider, et changer l'heure d'une tâche ne doit pas valider en passant le
   * script qu'un agent a proposé. Vrai d'office pour une nouvelle action.
   */
  checkEdited: boolean
  checkTimeout: string
  /* Quand */
  onDemand: boolean
  scheduled: boolean
  /** Celle du `ScheduleBuilder` ; null tant que sa règle est incomplète. */
  cadence: ScheduleCadence | null
  /**
   * Un service planifié : son arrêt, celle du second `ScheduleBuilder` (EDI-18). Null
   * tant que sa règle est incomplète ; ignorée pour une tâche, qui finit seule.
   */
  stopCadence: ScheduleCadence | null
  /** La portée choisie hors d'un projet ; null quand l'hôte donne le projet. */
  target: ScheduleTarget | null
}

const BLANK: EditorState = {
  what: 'command',
  kind: 'task',
  label: '',
  description: '',
  command: '',
  subdir: '',
  url: '',
  placement: 'follow',
  pinnedBranch: '',
  agent: 'claude',
  config: null,
  prompt: '',
  // La racine, comme le serveur à la création : un « nouveau worktree » à chaque tir
  // laisse des arbres derrière lui (#249), c'est un choix à faire exprès.
  worktreeMode: 'root',
  confined: null,
  overlapPolicy: 'skip',
  maxDuration: String(DEFAULT_SCHEDULE_DURATION_MINUTES),
  checkScript: null,
  checkEdited: true,
  checkTimeout: String(DEFAULT_CHECK_TIMEOUT_SECONDS),
  onDemand: true,
  scheduled: false,
  cadence: null,
  stopCadence: null,
  target: null,
}

/** L'état d'un brouillon : celui d'une action existante, ou d'un duplicata. */
function stateOfDraft(draft: AutomationDraft): EditorState {
  if (draft.what === 'command') {
    const body = draft.body
    return {
      ...BLANK,
      what: 'command',
      kind: body.kind,
      label: body.label,
      description: body.description ?? '',
      command: body.command,
      subdir: body.subdir ?? '',
      url: body.url ?? '',
      placement: body.placement ?? 'follow',
      pinnedBranch: body.pinnedBranch ?? '',
      onDemand: body.onDemand ?? true,
      scheduled: Boolean(body.schedule),
      cadence: body.schedule?.cadence ?? null,
      stopCadence: body.schedule?.stopCadence ?? null,
    }
  }
  const body = draft.body
  return {
    ...BLANK,
    what: 'agent',
    label: body.name,
    agent: body.agent,
    config: body.config,
    prompt: body.prompt,
    worktreeMode: body.worktreeMode ?? 'root',
    confined: body.confined,
    overlapPolicy: body.overlapPolicy,
    maxDuration: String(body.maxDurationMinutes),
    checkScript: body.checkScript ?? null,
    checkTimeout: String(body.checkTimeoutSeconds ?? DEFAULT_CHECK_TIMEOUT_SECONDS),
    onDemand: body.onDemand ?? true,
    scheduled: body.cadence !== null,
    cadence: body.cadence,
  }
}

export function editorStateOf(seed: EditorSeed): EditorState {
  if (seed.from) {
    // Une tâche hors projet se relit dans sa portée, qui ne change pas : l'essai du script y joue.
    const target = seed.from.projectId === null ? targetOfItem(seed.from) : null
    const state = { ...stateOfDraft(draftOf(seed.from)), checkEdited: false, target }
    return seed.schedule ? { ...state, scheduled: true } : state
  }
  let state = seed.draft ? stateOfDraft(seed.draft) : BLANK
  if (seed.preset) state = { ...state, what: seed.preset.what, kind: seed.preset.kind ?? state.kind }
  if (seed.prefill) {
    const { label, command, url, description } = seed.prefill
    state = {
      ...state,
      label: label ?? state.label,
      command: command ?? state.command,
      url: url ?? state.url,
      description: description ?? state.description,
    }
  }
  if (seed.target) state = { ...state, target: seed.target }
  return seed.schedule ? { ...state, scheduled: true } : state
}

/** Hors d'un projet : la portée choisie ne vise aucun dépôt (le vault, l'instance, rien). */
export const outsideProject = (state: EditorState): boolean => state.target !== null && state.target.scope !== 'project'

/* ------------------------------------------------------------------ les problèmes */

export type EditorField =
  | 'label'
  | 'command'
  | 'prompt'
  | 'subdir'
  | 'url'
  | 'branch'
  | 'duration'
  | 'checkTimeout'
  | 'when'
  | 'cadence'
  | 'stopCadence'
  | 'scope'

/** Tous les champs, pour « Enregistrer » qui les marque touchés d'un coup (EDI-20). */
export const ALL_FIELDS: readonly EditorField[] = [
  'label',
  'command',
  'prompt',
  'subdir',
  'url',
  'branch',
  'duration',
  'checkTimeout',
  'when',
  'cadence',
  'stopCadence',
  'scope',
]

/** Une commande qui tourne en continu : elle seule a un lien et un placement. */
export const isService = (state: EditorState): boolean => state.what === 'command' && state.kind === 'service'

const inRange = (text: string, min: number, max: number) => {
  const value = Number(text)
  return text.trim() !== '' && Number.isInteger(value) && value >= min && value <= max
}

/** Le plus long libellé : le texte d'un bouton pour une commande, le nom d'une tâche pour un agent. */
export const labelMax = (state: EditorState): number => (state.what === 'agent' ? MAX_SCHEDULE_NAME_CHARS : MAX_ACTION_LABEL_CHARS)

/**
 * Ce qui empêche d'enregistrer, champ par champ. L'éditeur n'en montre un que sous son
 * champ, une fois quitté ; le pied les donne tous en infobulle d'« Enregistrer ».
 */
export function problemsOf(state: EditorState): Partial<Record<EditorField, MessageKey>> {
  const problems: Partial<Record<EditorField, MessageKey>> = {}
  const label = state.label.trim()
  if (!label) problems.label = 'actionEditor.error.label'
  else if (label.length > labelMax(state)) problems.label = 'actionEditor.error.labelMax'

  if (state.what === 'command') {
    // Une commande appartient à un projet : elle n'existe pas dans le vault ni sur l'instance.
    if (outsideProject(state)) problems.scope = 'actionEditor.error.scope'
    if (!state.command.trim()) problems.command = 'actionEditor.error.command'
    const subdir = state.subdir.trim()
    if (subdir.startsWith('/')) problems.subdir = 'actionEditor.error.subdirAbsolute'
    else if (subdir.split(/[\\/]/).includes('..')) problems.subdir = 'actionEditor.error.subdirParent'
    if (isService(state)) {
      const url = state.url.trim()
      if (!actionUrlSchema.safeParse(state.url).success) problems.url = 'actionEditor.error.url'
      // Chaque instance écoute sur son port : le lien doit pouvoir le dire (SRV-6).
      else if (state.placement === 'per-worktree' && url && !url.includes('{port}')) problems.url = 'actionEditor.error.urlNeedsPort'
      if (state.placement === 'branch' && !state.pinnedBranch.trim()) problems.branch = 'actionEditor.error.branch'
      // Un service planifié s'arrête à heure fixe (EDI-18) : sa seconde règle doit être complète.
      if (state.scheduled && !state.stopCadence) problems.stopCadence = 'actionEditor.error.stopCadence'
    }
  } else {
    if (!state.prompt.trim()) problems.prompt = 'actionEditor.error.prompt'
    if (!inRange(state.maxDuration, MIN_SCHEDULE_DURATION_MINUTES, MAX_SCHEDULE_DURATION_MINUTES)) {
      problems.duration = 'actionEditor.error.duration'
    }
    if (state.checkScript?.trim() && !inRange(state.checkTimeout, MIN_CHECK_TIMEOUT_SECONDS, MAX_CHECK_TIMEOUT_SECONDS)) {
      problems.checkTimeout = 'actionEditor.error.checkTimeout'
    }
  }

  if (!state.onDemand && !state.scheduled) problems.when = 'actionEditor.error.when'
  if (state.scheduled && !state.cadence) problems.cadence = 'actionEditor.error.cadence'
  return problems
}

/* ------------------------------------------------------------------ enregistrer */

/**
 * Le brouillon qu'« Enregistrer » envoie (`useAutomationMutations().save`). `config` est
 * celle que l'éditeur montre : l'enregistrée, ou celle qu'une session neuve du projet
 * prendrait. Les champs de l'autre nature sont laissés de côté.
 */
export function draftFrom(state: EditorState, config: AgentConfig | null): AutomationDraft {
  const cadence = state.scheduled ? state.cadence : null
  if (state.what === 'command') {
    const service = isService(state)
    return {
      what: 'command',
      body: {
        label: state.label.trim(),
        kind: state.kind,
        command: state.command.trim(),
        description: state.description.trim(),
        subdir: state.subdir.trim(),
        // Une tâche n'a pas de lien : passer de service à tâche le retire.
        url: service ? state.url.trim() : '',
        // Une tâche tourne toujours là d'où on la lance.
        placement: service ? state.placement : 'follow',
        pinnedBranch: service && state.placement === 'branch' ? state.pinnedBranch.trim() : null,
        onDemand: state.onDemand,
        // Null retire la planification d'une commande qui en avait une. Seul un service
        // s'arrête à sa cadence.
        schedule: cadence ? { cadence, ...(service && state.stopCadence ? { stopCadence: state.stopCadence } : {}) } : null,
      },
    }
  }
  const script = state.checkScript?.trim() ? state.checkScript : null
  // Hors projet, ni worktree neuf ni confinement : ni dépôt où ouvrir l'un, ni environnement pour l'autre.
  const outside = outsideProject(state)
  return {
    what: 'agent',
    body: {
      name: state.label.trim(),
      agent: state.agent,
      config: config ?? state.config!,
      prompt: state.prompt.trim(),
      cadence,
      onDemand: state.onDemand,
      worktreeMode: outside ? 'root' : state.worktreeMode,
      overlapPolicy: state.overlapPolicy,
      confined: outside ? null : state.confined,
      maxDurationMinutes: Number(state.maxDuration),
      ...(state.checkEdited ? { checkScript: script } : {}),
      ...(script ? { checkTimeoutSeconds: Number(state.checkTimeout) } : {}),
    },
  }
}

/* ------------------------------------------------------------------ en-tête et pied */

/** Les puces Quand de l'en-tête, mises à jour en direct (EDI-2). */
export function headerWhen(state: EditorState, sentence: string | null, t: Translate): string[] {
  return [
    state.onDemand ? t('automation.when.demand') : null,
    state.scheduled ? (sentence ?? t('actionEditor.when.scheduled')) : null,
  ].filter((word): word is string => word !== null)
}

/** Le résumé du pied (EDI-20) : « Commande · tâche · à la demande + Chaque jour à 03:00 ». */
export function summaryOf(state: EditorState, sentence: string | null, cliLabel: string, t: Translate): string {
  const what =
    state.what === 'agent'
      ? `${t('automation.nature.agent')} · ${cliLabel}`
      : natureWord({ what: 'command', kind: state.kind }, t)
  const when =
    [
      state.onDemand ? t('actionEditor.summary.demand') : null,
      state.scheduled ? (sentence ?? t('actionEditor.summary.scheduled')) : null,
    ]
      .filter(Boolean)
      .join(' + ') || t('actionEditor.summary.never')
  return `${what} · ${when}`
}

/* ------------------------------------------------------------------ le lien à distance */

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1']
const LOCAL_LINK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/?#]|$)/i

/**
 * Un lien vers `localhost` alors que Solera est ouvert depuis une autre machine : il
 * désignerait celle du navigateur, pas le serveur (EDI-9). Un avertissement, pas une
 * erreur : un tunnel peut très bien le rendre juste.
 */
export function linkIsLocalOnly(url: string, hostname: string): boolean {
  return !LOCAL_HOSTS.includes(hostname) && LOCAL_LINK.test(url.trim())
}
