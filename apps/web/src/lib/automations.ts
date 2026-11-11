import {
  actionRunStatusOf,
  resolveActionUrl,
  type ActionRunDetailDto,
  type ActionRunDto,
  type AgentKind,
  type CreateProjectActionBody,
  type ProjectActionDto,
  type ScheduleCadence,
  type ScheduleRunStatus,
  type ScheduledTaskDto,
  type WorktreeDto,
} from '@solera/protocol'
import { cronToHuman } from './cron'
import type { MessageKey, MessageParams } from './i18n'
import type { ScheduleInput } from './schedules'

/**
 * Une **action** = **Quoi** × **Quand**, un seul objet pour les actions de projet et les
 * tâches planifiées (`actions.md` §1.A).
 *
 * - Quoi : une *commande* (tâche qui se termine, ou service qui tourne, `ProjectActionDto`)
 *   ou un *agent* (un prompt confié à un CLI, `ScheduledTaskDto`).
 * - Quand : *à la demande* (un clic, ou un agent par `run_action`) et/ou *planifiée*.
 *
 * Le serveur les garde dans deux tables : ce module les lit en un seul format, et dit
 * leur état. Pur : le texte passe par le `t` que l'appelant fournit, l'heure par `now`.
 * `lib/automations-query.ts` l'alimente des requêtes ; les tests le lisent seul.
 *
 * Ce que le serveur ne donne pas encore (les passages d'une commande, sa cadence, « à la
 * demande » d'une tâche, une tâche sans cadence) est lu quand il est là, et vaut sinon ce
 * que le serveur fait aujourd'hui : rien n'est simulé.
 */

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export type Translate = (key: MessageKey, params?: MessageParams) => string

export type What = 'command' | 'agent'
export type CommandKind = 'task' | 'service'

/** Les statuts d'un passage : ceux d'une tâche d'agent, et `stopped` d'une commande arrêtée. */
export type RunStatus = ScheduleRunStatus | 'stopped'

/** Un passage, d'une commande ou d'un agent. */
export interface UnifiedRun {
  id: string
  status: RunStatus
  startedAt: number
  finishedAt: number | null
  /** Commande : code de sortie, et les dernières lignes de sa sortie quand on les a. */
  exitCode?: number | null
  excerpt?: string | null
  /** Agent : la session du passage ; commande : celle d'où elle est partie. */
  conversationId?: string | null
  error?: string | null
}

/** Ce qui tourne maintenant, et de quoi le rejoindre. */
export type Live =
  | { kind: 'service'; ports: number[]; since: number | null; href: string | null }
  | { kind: 'terminal'; terminalId: string; since: number }
  /** Un passage sans terminal à montrer : celui d'un agent, ou d'une commande planifiée. */
  | { kind: 'run'; since: number; conversationId: string | null; checking: boolean }

/** Pourquoi elle attend une relecture avant de partir. */
export type Review =
  | { kind: 'proposed'; conversationId: string | null; title: string | null }
  | { kind: 'checkScript' }

export interface AutomationSchedule {
  cadence: ScheduleCadence
  enabled: boolean
  nextRunAt: number | null
  /**
   * Un service planifié : `cadence` le démarre, `stopCadence` l'arrête (AC-06, Q11). Le
   * serveur ne le donne pas encore : absent, le service tourne jusqu'à ce qu'on l'arrête.
   */
  serviceWindow?: { stopCadence: ScheduleCadence } | null
}

export interface Automation {
  /** `a-<id>` pour une action, `t-<id>` pour une tâche : les deux tables ont leurs ids. */
  id: string
  projectId: string | null
  label: string
  description: string | null
  what: What
  /** Commande seulement. */
  commandKind?: CommandKind
  command?: string
  subdir?: string | null
  /** Agent seulement. */
  agent?: AgentKind
  prompt?: string
  onDemand: boolean
  schedule: AutomationSchedule | null
  /** Le plus récent d'abord. */
  runs: UnifiedRun[]
  live: Live | null
  review: Review | null
  /** Échecs d'affilée en tête des passages jugés. */
  failStreak: number
  source: { kind: 'action'; action: ProjectActionDto } | { kind: 'task'; task: ScheduledTaskDto }
}

/* ------------------------------------------------------------------ lecture des deux tables */

/** Une action, avec ce qu'AC-03 lui ajoute : une cadence, « à la demande ». */
export type ActionInput = ProjectActionDto & {
  schedule?: AutomationSchedule | null
  onDemand?: boolean
}

/** Une tâche, avec ce qu'AC-04 lui ajoute : une cadence facultative, « à la demande ». */
export type TaskInput = Omit<ScheduledTaskDto, 'cadence'> & { cadence: ScheduleCadence | null; onDemand?: boolean }

const SERVICE_RUNNING = ['active', 'activating', 'reloading']

/**
 * `detailed` : les passages avec leur extrait (`useActionRuns`), pour le détail d'une
 * action. La liste des actions ne les porte pas : sans eux, l'extrait vaut null.
 */
export function fromAction(input: ProjectActionDto, detailed?: readonly ActionRunDetailDto[]): Automation {
  const action = input as ActionInput
  const { service, lastRun } = action
  const listed: readonly (ActionRunDto & { excerpt?: string | null })[] = detailed ?? action.runs
  // Une action lancée avant que le serveur garde ses passages n'a que son dernier lancement.
  const runs: UnifiedRun[] = listed.length
    ? listed.map((run) => ({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        exitCode: run.exitCode,
        excerpt: run.excerpt ?? null,
        conversationId: run.conversationId,
      }))
    : lastRun && !lastRun.alive
      ? [
          {
            id: `${action.id}-last`,
            // Sans code, le daemon a redémarré pendant qu'elle tournait : on ne sait rien.
            status: lastRun.exitCode === null ? 'stopped' : actionRunStatusOf(lastRun.exitCode),
            startedAt: lastRun.startedAt,
            finishedAt: null,
            exitCode: lastRun.exitCode,
          },
        ]
      : []

  let live: Live | null = null
  if (service && SERVICE_RUNNING.includes(service.state)) {
    live = { kind: 'service', ports: service.ports, since: service.startedAt, href: resolveActionUrl(action.url, service.ports) }
  } else if (lastRun?.alive) {
    live = { kind: 'terminal', terminalId: lastRun.terminalId, since: lastRun.startedAt }
  } else if (runs[0]?.status === 'running') {
    live = { kind: 'run', since: runs[0].startedAt, conversationId: runs[0].conversationId ?? null, checking: false }
  }

  const streak = failStreakOf(runs)
  return {
    id: `a-${action.id}`,
    projectId: action.projectId,
    label: action.label,
    description: action.description,
    what: 'command',
    commandKind: action.kind,
    command: action.command,
    subdir: action.subdir,
    onDemand: action.onDemand ?? true,
    schedule: action.schedule ?? null,
    runs,
    live,
    review:
      action.status === 'proposed'
        ? { kind: 'proposed', conversationId: action.agentConversationId, title: action.agentConversationTitle }
        : null,
    failStreak: service?.state === 'failed' ? Math.max(1, streak) : streak,
    source: { kind: 'action', action: input },
  }
}

export function fromTask(input: ScheduledTaskDto): Automation {
  const task = input as TaskInput
  const running = task.runs.find((run) => run.status === 'running' || run.status === 'checking')
  const runs: UnifiedRun[] = task.runs.map((run) => ({
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    conversationId: run.conversationId,
    error: run.error,
  }))
  return {
    id: `t-${task.id}`,
    projectId: task.projectId,
    label: task.name,
    description: null,
    what: 'agent',
    agent: task.agent,
    prompt: task.prompt,
    // « Lancer maintenant » existe pour toute tâche : elle est à la demande tant que le
    // serveur ne dit pas le contraire.
    onDemand: task.onDemand ?? true,
    schedule: task.cadence ? { cadence: task.cadence, enabled: task.enabled, nextRunAt: task.nextRunAt } : null,
    runs,
    live: running
      ? { kind: 'run', since: running.startedAt, conversationId: running.conversationId, checking: running.status === 'checking' }
      : null,
    review: task.check && !task.check.approved ? { kind: 'checkScript' } : null,
    failStreak: failStreakOf(runs),
    source: { kind: 'task', task: input },
  }
}

export type AutomationScope = { projectId: string } | { all: true }

/** Les actions et les tâches d'un projet, ou de toute l'instance, en un seul format. */
export function automationsOf(
  actions: readonly ProjectActionDto[],
  tasks: readonly ScheduledTaskDto[],
  scope: AutomationScope,
): Automation[] {
  const mine = <T extends { projectId: string | null }>(entry: T) => 'all' in scope || entry.projectId === scope.projectId
  return [...actions.filter(mine).map((action) => fromAction(action)), ...tasks.filter(mine).map(fromTask)]
}

/* ------------------------------------------------------------------ verdicts */

/**
 * Les passages qui disent quelque chose de la santé : ni ceux qui tournent, ni les
 * sautés (un chevauchement, ou rien à faire), ni les arrêtés (quelqu'un l'a voulu).
 */
export function verdictRuns(runs: readonly UnifiedRun[]): UnifiedRun[] {
  return runs.filter((run) => RUN_VERDICTS[run.status].judged)
}

const isFailure = (run: UnifiedRun) => run.status === 'failed' || run.status === 'timed_out'

export function failStreakOf(runs: readonly UnifiedRun[]): number {
  let streak = 0
  for (const run of verdictRuns(runs)) {
    if (!isFailure(run)) break
    streak += 1
  }
  return streak
}

export type VerdictTone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical'

/**
 * Ce qu'un passage dit, en une seule table pour tous les écrans : son mot, sa teinte,
 * s'il tourne encore (point qui pulse), s'il compte pour la santé.
 */
export const RUN_VERDICTS: Record<RunStatus, { label: MessageKey; tone: VerdictTone; live: boolean; judged: boolean }> = {
  checking: { label: 'automation.run.checking', tone: 'accent', live: true, judged: false },
  running: { label: 'automation.run.running', tone: 'accent', live: true, judged: false },
  succeeded: { label: 'automation.run.succeeded', tone: 'positive', live: false, judged: true },
  failed: { label: 'automation.run.failed', tone: 'critical', live: false, judged: true },
  timed_out: { label: 'automation.run.timedOut', tone: 'caution', live: false, judged: true },
  skipped: { label: 'automation.run.skipped', tone: 'neutral', live: false, judged: false },
  stopped: { label: 'automation.run.stopped', tone: 'neutral', live: false, judged: false },
}

/** Le remplissage d'une pastille ou d'un point de verdict. */
export const VERDICT_FILL: Record<VerdictTone, string> = {
  neutral: 'bg-line-strong',
  accent: 'bg-accent',
  positive: 'bg-positive',
  caution: 'bg-caution',
  critical: 'bg-critical',
}

/* ------------------------------------------------------------------ durées */

/** Un écart en minutes (au moins une), heures ou jours. */
function roughSpan(delta: number): { unit: 'minutes' | 'hours' | 'days'; count: number } {
  if (delta < HOUR) return { unit: 'minutes', count: Math.max(1, Math.round(delta / MIN)) }
  if (delta < DAY) return { unit: 'hours', count: Math.round(delta / HOUR) }
  return { unit: 'days', count: Math.round(delta / DAY) }
}

/** « 3 min », « 2 h », « 4 j » : depuis quand. */
export function ago(ts: number, now: number, t: Translate): string {
  const { unit, count } = roughSpan(Math.max(0, now - ts))
  return t(`automation.ago.${unit}`, { count })
}

/** « dans 3 h » : la prochaine échéance, en court. */
export function inShort(ts: number, now: number, t: Translate): string {
  if (ts <= now) return t('automation.next.now')
  const { unit, count } = roughSpan(ts - now)
  return t(`automation.next.${unit}`, { count })
}

/** « 20 s », « 12 min », « 1 h 05 » : la durée d'un passage. */
export function formatDuration(ms: number, t: Translate): string {
  const minutes = Math.round(ms / MIN)
  if (minutes < 1) return t('automation.duration.seconds', { count: Math.max(1, Math.round(ms / 1000)) })
  if (minutes < 60) return t('automation.duration.minutes', { count: minutes })
  return t('automation.duration.hours', { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, '0') })
}

/** Le coût d'un passage ou d'une période, en dollars ; « — » quand on ne le connaît pas. */
export function formatCost(usd: number | null, t: Translate, locale: string): string {
  if (usd === null) return '—'
  const format = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' }).format(value)
  return usd > 0 && usd < 0.01 ? t('automation.cost.under', { amount: format(0.01) }) : format(usd)
}

/** `timeZone` lit la date à l'heure du serveur, celle d'un motif cron ; absent, à celle du poste. */
export function formatDateTime(ts: number, locale: string, timeZone?: string): string {
  return new Date(ts).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })
}

/* ------------------------------------------------------------------ nature, quand */

export interface Nature {
  what: What
  kind?: CommandKind
  agent?: AgentKind
}

export const natureOf = (item: Automation): Nature => ({ what: item.what, kind: item.commandKind, agent: item.agent })

/** « Commande · tâche », « Commande · service », « Agent ». */
export function natureWord(nature: Nature, t: Translate): string {
  if (nature.what === 'agent') return t('automation.nature.agent')
  return t(nature.kind === 'service' ? 'automation.nature.service' : 'automation.nature.task')
}

export type WhenKind = 'demand' | 'scheduled' | 'both'

export function whenKind(item: Automation): WhenKind {
  if (item.schedule && item.onDemand) return 'both'
  return item.schedule ? 'scheduled' : 'demand'
}

/** La cadence en clair ; un motif cron illisible reste tel quel. */
export function cadenceWords(cadence: ScheduleCadence, t: Translate, locale: string): string {
  if (cadence.kind === 'interval') {
    const { minutes } = cadence
    if (minutes % 1440 === 0) return t('schedule.cadence.days', { count: minutes / 1440 })
    if (minutes % 60 === 0) return t('schedule.cadence.hours', { count: minutes / 60 })
    return t('schedule.cadence.minutes', { count: minutes })
  }
  if (cadence.kind === 'once') return t('schedule.cadence.onceAt', { date: formatDateTime(cadence.at, locale) })
  return cronToHuman(cadence.expression, locale) ?? cadence.expression
}

/** « Chaque jour à 03:00 », « (en pause) » quand elle l'est ; null sans planification. */
export function cadenceText(item: Automation, t: Translate, locale: string): string | null {
  if (!item.schedule) return null
  const text = cadenceWords(item.schedule.cadence, t, locale)
  return item.schedule.enabled ? text : t('automation.when.paused', { cadence: text })
}

/** Les puces « Quand » d'un en-tête : « À la demande », la cadence, ou les deux. */
export function whenWords(item: Automation, t: Translate, locale: string): string[] {
  const cadence = cadenceText(item, t, locale)
  return [item.onDemand ? t('automation.when.demand') : null, cadence].filter((word): word is string => word !== null)
}

/* ------------------------------------------------------------------ l'état en une phrase */

export type StateTone = 'live' | 'idle' | 'fail' | 'review'

export function reviewReason(review: Review, t: Translate): string {
  if (review.kind === 'checkScript') return t('automation.review.checkScript')
  return review.title === null ? t('automation.review.proposedGone') : t('automation.review.proposedIn', { title: review.title })
}

/** Le dernier passage fini, celui dont la phrase parle. */
const lastFinished = (item: Automation): UnifiedRun | undefined => item.runs.find((run) => !RUN_VERDICTS[run.status].live)

const isService = (item: Automation) => item.what === 'command' && item.commandKind === 'service'
const serviceFailed = (item: Automation) =>
  item.source.kind === 'action' && item.source.action.service?.state === 'failed'

/** « :5173 :5174 · depuis 2 h » : ce qu'on sait d'un service qui tourne. */
function serviceFacts(live: Extract<Live, { kind: 'service' }>, now: number, t: Translate): string[] {
  return [
    live.ports.length ? live.ports.map((port) => `:${port}`).join(' ') : null,
    live.since !== null ? t('automation.state.since', { ago: ago(live.since, now, t) }) : null,
  ].filter((fact): fact is string => fact !== null)
}

/**
 * Ce qui tourne, en clair, pour la ligne d'une liste : « service · :5173 · depuis 2 h »,
 * « en cours dans un terminal du panneau », « passage en cours depuis 3 min ».
 */
export function liveText(item: Automation, now: number, t: Translate): string | null {
  const { live } = item
  if (!live) return null
  if (live.kind === 'service') return [t('automation.live.service'), ...serviceFacts(live, now, t)].join(' · ')
  if (live.kind === 'terminal') return t('automation.live.terminal')
  return t('automation.live.run', { ago: ago(live.since, now, t) })
}

/**
 * L'état d'une action en une phrase courte, la même sur chaque tuile et chaque ligne
 * (LAN-5), et le ton de son point.
 */
export function actionState(item: Automation, now: number, t: Translate): { tone: StateTone; text: string } {
  if (item.review) return { tone: 'review', text: t('automation.state.review', { reason: reviewReason(item.review, t) }) }
  const { live } = item
  if (live?.kind === 'service') return { tone: 'live', text: [t('automation.state.running'), ...serviceFacts(live, now, t)].join(' · ') }
  if (live?.kind === 'terminal') return { tone: 'live', text: t('automation.state.inTerminal') }
  if (live?.kind === 'run') {
    return { tone: 'live', text: t(live.checking ? 'automation.state.checking' : 'automation.state.inProgress', { ago: ago(live.since, now, t) }) }
  }
  if (isService(item)) {
    return serviceFailed(item)
      ? { tone: 'fail', text: t('automation.state.serviceFailed') }
      : { tone: 'idle', text: t('automation.state.stopped') }
  }
  if (item.failStreak >= 2) return { tone: 'fail', text: t('automation.state.failStreak', { count: item.failStreak }) }
  const run = lastFinished(item)
  if (!run) return { tone: 'idle', text: t('automation.state.neverRun') }
  const when = ago(run.startedAt, now, t)
  switch (run.status) {
    case 'succeeded':
      return { tone: 'idle', text: t('automation.state.last.succeeded', { ago: when }) }
    case 'failed':
      return {
        tone: 'fail',
        text: run.exitCode != null
          ? t('automation.state.last.failedCode', { code: run.exitCode, ago: when })
          : t('automation.state.last.failed', { ago: when }),
      }
    case 'timed_out':
      return { tone: 'fail', text: t('automation.state.last.timedOut', { ago: when }) }
    case 'skipped':
      return { tone: 'idle', text: t('automation.state.last.skipped', { ago: when }) }
    default:
      return { tone: 'idle', text: t('automation.state.last.stopped', { ago: when }) }
  }
}

/**
 * L'état en une phrase entière, en tête du détail (DET-1). `emphasis` dit le fond du
 * bandeau : ambre à relire, rouge à partir de deux échecs d'affilée.
 */
export function stateSentence(
  item: Automation,
  now: number,
  t: Translate,
): { tone: StateTone; text: string; emphasis: 'review' | 'fail' | null } {
  const { tone } = actionState(item, now, t)
  const say = (text: string, emphasis: 'review' | 'fail' | null = null) => ({ tone, text, emphasis })
  if (item.review) return say(t('automation.sentence.review', { reason: reviewReason(item.review, t) }), 'review')
  const { live } = item
  if (live?.kind === 'service') {
    const facts = serviceFacts(live, now, t)
    return say(facts.length ? t('automation.sentence.service', { facts: facts.join(' · ') }) : t('automation.sentence.serviceBare'))
  }
  if (live?.kind === 'terminal') return say(t('automation.sentence.terminal'))
  if (live?.kind === 'run') return say(t('automation.sentence.run', { ago: ago(live.since, now, t) }))
  if (isService(item)) return say(t(serviceFailed(item) ? 'automation.sentence.serviceFailed' : 'automation.sentence.serviceStopped'))
  if (item.failStreak >= 2) {
    // Le dernier échec, pas un passage sauté ou arrêté depuis.
    const failure = verdictRuns(item.runs)[0]!
    return say(t('automation.sentence.failStreak', { count: item.failStreak, ago: ago(failure.startedAt, now, t) }), 'fail')
  }
  if (item.schedule && !item.schedule.enabled) {
    return say(t(item.onDemand ? 'automation.sentence.paused' : 'automation.sentence.pausedOnly'))
  }
  const run = lastFinished(item)
  if (!run) return say(t('automation.sentence.never'))
  const params = { verdict: t(RUN_VERDICTS[run.status].label), ago: ago(run.startedAt, now, t) }
  return say(
    run.exitCode != null
      ? t('automation.sentence.lastCode', { ...params, code: run.exitCode })
      : t('automation.sentence.last', params),
  )
}

/* ------------------------------------------------------------------ filtres, sections, groupes */

export type WhenFilter = 'demand' | 'scheduled'
export type StateFilter = 'live' | 'review' | 'failing'

/** « Filtrer ▾ » : OU dans un groupe, ET entre les groupes ; un groupe vide veut dire tout. */
export interface AutomationFilters {
  what: What[]
  when: WhenFilter[]
  state: StateFilter[]
}

export const NO_FILTERS: AutomationFilters = { what: [], when: [], state: [] }

export function matchesWhen(item: Automation, when: WhenFilter): boolean {
  return when === 'scheduled' ? item.schedule !== null : item.onDemand
}

export function matchesState(item: Automation, state: StateFilter): boolean {
  if (state === 'live') return item.live !== null
  if (state === 'review') return item.review !== null
  return item.failStreak > 0
}

export function matchesFilters(item: Automation, filters: AutomationFilters): boolean {
  if (filters.what.length && !filters.what.includes(item.what)) return false
  if (filters.when.length && !filters.when.some((when) => matchesWhen(item, when))) return false
  if (filters.state.length && !filters.state.some((state) => matchesState(item, state))) return false
  return true
}

/** Le nombre de filtres actifs, pour la pastille du bouton. */
export function filterCount(filters: AutomationFilters): number {
  return filters.what.length + filters.when.length + filters.state.length
}

/** « Chercher une action » : libellé, description, commande et prompt, sans casse. */
export function matchesQuery(item: Automation, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return [item.label, item.description, item.command, item.prompt].some((text) => text?.toLocaleLowerCase().includes(needle))
}

/**
 * Ce que les sessions ont laissé tourner est fait de commandes à la demande, en cours :
 * la section se masque dès qu'un filtre les exclut (PRC-6).
 */
export function showsSessionWorks(filters: AutomationFilters): boolean {
  return (
    (!filters.what.length || filters.what.includes('command')) &&
    (!filters.when.length || filters.when.includes('demand')) &&
    (!filters.state.length || filters.state.includes('live'))
  )
}

export type Section = 'live' | 'review' | 'scheduled' | 'demand'

/** Les sections de la Liste, dans l'ordre ; « Lancés par les sessions » vient après `live`. */
export const SECTIONS: readonly Section[] = ['live', 'review', 'scheduled', 'demand']

/** La seule section d'une action : ce qui tourne d'abord, puis ce qui attend une relecture. */
export function sectionOf(item: Automation): Section {
  if (item.live) return 'live'
  if (item.review) return 'review'
  return item.schedule ? 'scheduled' : 'demand'
}

export type LauncherGroup = 'services' | 'commands' | 'agents'

export const LAUNCHER_GROUPS: readonly LauncherGroup[] = ['services', 'commands', 'agents']

export function launcherGroupOf(item: Automation): LauncherGroup {
  if (item.what === 'agent') return 'agents'
  return item.commandKind === 'service' ? 'services' : 'commands'
}

/* ------------------------------------------------------------------ gestes */

export type PrimaryGesture = 'review' | 'switch' | 'terminal' | 'session' | 'launch'

/**
 * Le seul geste principal d'une tuile ou d'une ligne (LAN-7) : relire ce qu'un agent a
 * écrit avant tout, l'interrupteur d'un service, rejoindre ce qui tourne, sinon lancer.
 */
export function primaryGestureOf(item: Automation): PrimaryGesture {
  if (item.review) return 'review'
  if (isService(item)) return 'switch'
  if (item.live?.kind === 'terminal') return 'terminal'
  if (item.live?.kind === 'run' && item.live.conversationId) return 'session'
  return 'launch'
}

/**
 * Si « Lancer ▾ » propose de choisir l'arbre (LAN-9). Une tâche d'agent dit elle-même où
 * elle tourne, racine ou nouveau worktree : son chevron proposerait des arbres qu'un
 * passage ne sait pas viser (Q6).
 */
export const picksTree = (item: Automation): boolean => item.what === 'command'

/** Les arbres que « Lancer dans » propose après la racine : ceux qui sont sur le disque, six au plus. */
export function launchTrees(trees: readonly WorktreeDto[] | undefined): WorktreeDto[] {
  return (trees ?? []).filter((tree) => tree.git !== null).slice(0, 6)
}

/* ------------------------------------------------------------------ échéance et santé */

export type Due = 'today' | 'week' | 'later' | 'idle'

export const DUES: readonly Due[] = ['today', 'week', 'later', 'idle']

/** Quand elle passe : aujourd'hui (jusqu'à minuit, heure locale), sous 7 jours, plus tard. */
export function dueOf(item: Automation, now: number): Due {
  const next = item.schedule?.enabled ? item.schedule.nextRunAt : null
  if (next === null) return 'idle'
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  if (next <= endOfToday.getTime()) return 'today'
  return next <= now + 7 * DAY ? 'week' : 'later'
}

const nextOf = (item: Automation) => (item.schedule?.enabled ? (item.schedule.nextRunAt ?? Infinity) : Infinity)

/** Le prochain passage le plus proche d'abord ; sans échéance, à la fin. */
export function byNextRun(a: Automation, b: Automation): number {
  const left = nextOf(a)
  const right = nextOf(b)
  return left === right ? 0 : left < right ? -1 : 1
}

export interface Health {
  /** Part des réussites parmi les passages jugés des 30 derniers jours ; null sans aucun. */
  rate: number | null
  judged: number
  /**
   * Coût des passages d'agent des 30 derniers jours (celui de leurs sessions) ; null pour
   * une commande, dont la session est celle d'où elle est partie, pas la sienne.
   */
  cost30: number | null
  /** L'échec du dernier passage jugé : son erreur, ou la ligne de sa sortie qui la dit. */
  lastFailure: { error: string | null; code: number | null } | null
}

const ERROR_LINE = /error|erreur|no such|failed|échec|exit [1-9]/i

export function healthOf(item: Automation, costOf: (run: UnifiedRun) => number | null, now: number): Health {
  const recent = item.runs.filter((run) => run.startedAt > now - 30 * DAY)
  const judged = verdictRuns(recent)
  const last = verdictRuns(item.runs)[0]
  return {
    rate: judged.length ? judged.filter((run) => run.status === 'succeeded').length / judged.length : null,
    judged: judged.length,
    cost30: item.what === 'agent' ? recent.reduce((sum, run) => sum + (costOf(run) ?? 0), 0) : null,
    lastFailure:
      last && isFailure(last)
        ? {
            error: last.error ?? last.excerpt?.split('\n').find((line) => ERROR_LINE.test(line)) ?? null,
            code: last.exitCode ?? null,
          }
        : null,
  }
}

/* ------------------------------------------------------------------ brouillons */

/**
 * Ce que l'éditeur modifie : le corps d'une action ou celui d'une tâche. La nature ne
 * change pas après la création (Q5) : les deux vivent dans deux tables, « Dupliquer »
 * sert à en changer.
 */
export type AutomationDraft =
  | { what: 'command'; body: CreateProjectActionBody }
  | { what: 'agent'; body: ScheduleInput }

export function draftOf(item: Automation): AutomationDraft {
  if (item.source.kind === 'action') {
    const { label, description, kind, command, subdir, url } = item.source.action
    return {
      what: 'command',
      body: {
        label,
        kind,
        command,
        ...(description ? { description } : {}),
        ...(subdir ? { subdir } : {}),
        ...(url ? { url } : {}),
      },
    }
  }
  const { task } = item.source
  return {
    what: 'agent',
    body: {
      name: task.name,
      agent: task.agent,
      config: task.config,
      prompt: task.prompt,
      cadence: task.cadence,
      overlapPolicy: task.overlapPolicy,
      confined: task.confined,
      maxDurationMinutes: task.maxDurationMinutes,
      checkScript: task.check?.script ?? null,
      ...(task.check ? { checkTimeoutSeconds: task.check.timeoutSeconds } : {}),
    },
  }
}

/** « Dupliquer » : le même brouillon, libellé « (copie) », pour une nouvelle action. */
export function duplicateDraft(item: Automation, t: Translate): AutomationDraft {
  const draft = draftOf(item)
  return draft.what === 'command'
    ? { what: 'command', body: { ...draft.body, label: t('automation.copyOf', { label: draft.body.label }) } }
    : { what: 'agent', body: { ...draft.body, name: t('automation.copyOf', { label: draft.body.name }) } }
}
