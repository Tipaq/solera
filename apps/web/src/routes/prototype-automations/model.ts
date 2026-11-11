/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Un seul objet, l'**action** = **Quoi** × **Quand**.
 * - Quoi : une *commande* (tâche qui se termine, ou service qui tourne — `ProjectActionDto`)
 *   ou un *agent* (un prompt confié à un CLI, avec son script de vérification — le
 *   modèle des tâches planifiées, `ScheduledTaskDto`).
 * - Quand : *à la demande* (un clic, ou un agent par `run_action`) et/ou *planifiée*
 *   (cadence cron, intervalle, une fois).
 * Les vraies actions et les vraies tâches planifiées sont fusionnées ici en lecture. Une
 * **commande planifiée** n'existe pas côté serveur : en démo seulement (SIMULÉ).
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  nextScheduleRun,
  type AgentConfig,
  type AgentKind,
  type ProjectActionDto,
  type ScheduleCadence,
  type ScheduledRunDto,
  type ScheduledTaskDto,
} from '@solera/protocol'
import { actionView, useActions } from '../../lib/actions'
import { demoActions } from '../prototype-actions/data'
import { useScheduleProto, verdictRuns, type ScheduleProto } from '../prototype-schedules/data'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export type What = 'command' | 'agent'
export type RunStatus = ScheduledRunDto['status']

/** Un passage, d'une commande ou d'un agent. */
export interface UnifiedRun {
  id: string
  status: RunStatus
  startedAt: number
  finishedAt: number | null
  /** Commande : code de sortie et extrait de sortie (SIMULÉ : le serveur ne garde rien). */
  exitCode?: number | null
  excerpt?: string[]
  /** Agent : la session du passage. */
  conversationId?: string | null
  error?: string | null
}

export interface Automation {
  id: string
  label: string
  description: string | null
  what: What
  /** Commande seulement. */
  commandKind?: 'task' | 'service'
  command?: string
  subdir?: string | null
  /** Agent seulement. */
  agent?: AgentKind
  prompt?: string
  onDemand: boolean
  schedule: {
    cadence: ScheduleCadence
    enabled: boolean
    nextRunAt: number | null
    /** Un service planifié : démarrer / arrêter à heure fixe — cas limite. */
    serviceWindow?: { stopCadence: ScheduleCadence }
  } | null
  runs: UnifiedRun[]
  /** Ce qui tourne maintenant, et où le voir. */
  live: { kind: 'service' | 'terminal' | 'session'; text: string; href: string | null } | null
  /** Pourquoi elle attend Tim (relecture), ou null. */
  review: string | null
  failStreak: number
  /** Sources, pour le détail. */
  action?: ProjectActionDto
  task?: ScheduledTaskDto
  /** Une commande planifiée : n'existe pas côté serveur. */
  simulated?: boolean
}

export function fromAction(action: ProjectActionDto): Automation {
  const view = actionView(action)
  const live = view.live
    ? action.service
      ? {
          kind: 'service' as const,
          text: `service${action.service.ports.length ? ` · :${action.service.ports.join(' :')}` : ''}${action.service.startedAt ? ` · depuis ${ago(action.service.startedAt)}` : ''}`,
          href: view.href,
        }
      : { kind: 'terminal' as const, text: 'en cours dans un terminal du panneau', href: null }
    : null
  const runs: UnifiedRun[] =
    action.lastRun && !action.lastRun.alive
      ? [{
          id: `${action.id}-last`,
          status: action.lastRun.exitCode === 0 ? 'succeeded' : 'failed',
          startedAt: action.lastRun.startedAt,
          finishedAt: null,
          exitCode: action.lastRun.exitCode,
        }]
      : []
  return {
    id: `a-${action.id}`,
    label: action.label,
    description: action.description,
    what: 'command',
    commandKind: action.kind,
    command: action.command,
    subdir: action.subdir,
    onDemand: true,
    schedule: null,
    runs,
    live,
    review: action.status === 'proposed' ? `proposée dans « ${action.agentConversationTitle ?? 'une session supprimée'} »` : null,
    failStreak: action.service?.state === 'failed' || (action.lastRun && action.lastRun.exitCode !== null && action.lastRun.exitCode !== 0) ? 1 : 0,
    action,
  }
}

export function fromTask(task: ScheduledTaskDto): Automation {
  const running = task.runs.find((run) => run.status === 'running' || run.status === 'checking')
  let failStreak = 0
  for (const run of verdictRuns(task)) {
    if (run.status === 'failed' || run.status === 'timed_out') failStreak += 1
    else break
  }
  return {
    id: `t-${task.id}`,
    label: task.name,
    description: null,
    what: 'agent',
    agent: task.agent,
    prompt: task.prompt,
    // Une tâche d'agent se lance aussi à la main (« Lancer maintenant ») : elle est donc
    // à la demande *et* planifiée.
    onDemand: true,
    schedule: { cadence: task.cadence, enabled: task.enabled, nextRunAt: task.nextRunAt },
    runs: task.runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      conversationId: run.conversationId,
      error: run.error,
    })),
    live: running
      ? { kind: 'session', text: `passage en cours depuis ${ago(running.startedAt)}`, href: running.conversationId ? `/p/${task.projectId}/c/${running.conversationId}` : null }
      : null,
    review: task.check && !task.check.approved ? 'script de vérification à valider' : null,
    failStreak,
    task,
  }
}

/* ------------------------------------------------------------------ démo : commandes planifiées */

function commandRuns(id: string, history: [RunStatus, number, number | null, string[]][], every: number, lastAgo: number): UnifiedRun[] {
  const now = Date.now()
  return history.map(([status, minutes, exitCode, excerpt], index) => {
    const startedAt = now - (lastAgo + index * every) * HOUR
    return {
      id: `${id}-run-${index}`,
      status,
      startedAt,
      finishedAt: status === 'running' ? null : startedAt + minutes * MIN,
      exitCode,
      excerpt,
    }
  })
}

export function demoScheduledCommands(): Automation[] {
  const now = Date.now()
  const backup: ScheduleCadence = { kind: 'cron', expression: '0 3 * * 0' }
  const purge: ScheduleCadence = { kind: 'cron', expression: '0 4 * * *' }
  const backupRuns = commandRuns('demo-backup', [
    ['succeeded', 4, 0, ['sqlite3 data.db ".backup backups/2026-11-08.db"', 'backup ok — 182 Mo', 'rotation : 4 sauvegardes gardées']],
    ['succeeded', 4, 0, ['backup ok — 179 Mo']],
    ['succeeded', 3, 0, ['backup ok — 176 Mo']],
    ['failed', 1, 1, ['Error: database is locked', 'exit 1']],
    ['succeeded', 3, 0, ['backup ok — 171 Mo']],
  ], 24 * 7, 3 * 24 + 8)
  const purgeRuns = commandRuns('demo-purge', [
    ['failed', 0.2, 2, ['find: ‘logs/archive’: No such file or directory', 'exit 2']],
    ['failed', 0.2, 2, ['find: ‘logs/archive’: No such file or directory', 'exit 2']],
    ['succeeded', 0.5, 0, ['124 fichiers supprimés (312 Mo)']],
    ['succeeded', 0.4, 0, ['98 fichiers supprimés (240 Mo)']],
    ['succeeded', 0.4, 0, ['101 fichiers supprimés (251 Mo)']],
  ], 24, 7)
  return [
    {
      id: 'c-demo-backup',
      label: 'Sauvegarde de la base',
      description: 'Copie la base SQLite et garde les quatre dernières.',
      what: 'command',
      commandKind: 'task',
      command: 'scripts/backup-db.sh --keep 4',
      subdir: null,
      onDemand: true,
      schedule: { cadence: backup, enabled: true, nextRunAt: nextScheduleRun(backup, now, backupRuns[0]!.startedAt) },
      runs: backupRuns,
      live: null,
      review: null,
      failStreak: 0,
      simulated: true,
    },
    {
      id: 'c-demo-purge',
      label: 'Purger les journaux de plus de 30 jours',
      description: null,
      what: 'command',
      commandKind: 'task',
      command: 'find logs/archive -mtime +30 -delete -print | wc -l',
      subdir: null,
      onDemand: false,
      schedule: { cadence: purge, enabled: true, nextRunAt: nextScheduleRun(purge, now, purgeRuns[0]!.startedAt) },
      runs: purgeRuns,
      live: null,
      review: null,
      failStreak: 2,
      simulated: true,
    },
  ]
}

/* ------------------------------------------------------------------ lecture */

export interface AutomationsData {
  demo: boolean
  isPending: boolean
  items: Automation[]
  /** Pour l'agenda : les tâches d'agent et, en démo, les commandes planifiées habillées en tâches. */
  agenda: ScheduleProto
}

export function useAutomations(projectId: string | undefined): AutomationsData {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data: actions, isPending: actionsPending } = useActions()
  const schedules = useScheduleProto(projectId)

  return useMemo(() => {
    const rawActions = demo ? demoActions(projectId ?? 'demo') : (actions ?? []).filter((action) => action.projectId === projectId)
    const commands = demo ? demoScheduledCommands() : []
    const items = [...rawActions.map(fromAction), ...commands, ...schedules.tasks.map(fromTask)]
    const asTasks = commands.filter((item) => item.schedule).map((item) => asScheduledTask(item, projectId ?? 'demo'))
    return {
      demo,
      isPending: !demo && (actionsPending || schedules.isPending),
      items,
      agenda: { ...schedules, tasks: [...schedules.tasks, ...asTasks] },
    }
  }, [demo, actions, actionsPending, schedules, projectId])
}

/** Une commande planifiée, habillée en tâche pour réutiliser l'agenda des Planifiées. */
function asScheduledTask(item: Automation, projectId: string): ScheduledTaskDto {
  return {
    id: item.id,
    projectId,
    userId: 'demo',
    name: `$ ${item.label}`,
    agent: 'claude',
    config: {} as AgentConfig,
    prompt: item.command ?? '',
    cadence: item.schedule!.cadence,
    executionMode: 'fresh',
    overlapPolicy: 'skip',
    confined: null,
    maxDurationMinutes: 10,
    enabled: item.schedule!.enabled,
    lastRunAt: item.runs[0]?.startedAt ?? null,
    nextRunAt: item.schedule!.nextRunAt,
    createdAt: Date.now() - 60 * DAY,
    updatedAt: Date.now() - 60 * DAY,
    runs: item.runs.map((run) => ({
      id: run.id,
      taskId: item.id,
      conversationId: null,
      trigger: 'schedule',
      status: run.status,
      scheduledFor: run.startedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      error: null,
      check: null,
    })),
    check: null,
  }
}

export function ago(ts: number, now = Date.now()): string {
  const delta = Math.max(0, now - ts)
  if (delta < HOUR) return `${Math.max(1, Math.round(delta / MIN))} min`
  if (delta < DAY) return `${Math.round(delta / HOUR)} h`
  return `${Math.round(delta / DAY)} j`
}
