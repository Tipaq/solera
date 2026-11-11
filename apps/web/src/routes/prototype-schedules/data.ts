/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  nextScheduleRun,
  type AgentConfig,
  type AgentKind,
  type ScheduleCadence,
  type ScheduleRunStatus,
  type ScheduledRunDto,
  type ScheduledTaskDto,
} from '@solera/protocol'
import { useAllConversations } from '../../lib/conversations'
import { lastRun, scheduleState, useSchedules, type ScheduleState } from '../../lib/schedules'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export interface ScheduleProto {
  demo: boolean
  isPending: boolean
  tasks: ScheduledTaskDto[]
  /** Le coût d'un tir : celui de sa session (`costUsd`), simulé en démo. Null sans session. */
  costOf: (run: ScheduledRunDto) => number | null
}

/** Les tâches du projet, réelles ou de démo (`?demo=1`). */
export function useScheduleProto(projectId: string | undefined): ScheduleProto {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data: schedules, isPending } = useSchedules()
  const { data: conversations } = useAllConversations()

  return useMemo(() => {
    if (demo) {
      const { tasks, costs } = demoTasks(projectId ?? 'demo')
      return { demo, isPending: false, tasks, costOf: (run) => costs.get(run.id) ?? null }
    }
    const costs = new Map((conversations ?? []).map((entry) => [entry.id, entry.costUsd]))
    return {
      demo,
      isPending,
      tasks: (schedules ?? []).filter((task) => task.projectId === projectId),
      costOf: (run) => (run.conversationId ? costs.get(run.conversationId) ?? null : null),
    }
  }, [demo, schedules, conversations, isPending, projectId])
}

/* ------------------------------------------------------------------ lectures */

export function durationOf(run: ScheduledRunDto, now = Date.now()): number {
  return (run.finishedAt ?? now) - run.startedAt
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} s`
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${String(minutes % 60).padStart(2, '0')}`
}

export function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  return usd < 0.01 ? '< 0,01 $' : `${usd.toFixed(2).replace('.', ',')} $`
}

/** « dans 3 h », « dans 2 j » : la prochaine exécution, plus courte que `relativeDate`. */
export function inShort(ts: number, now = Date.now()): string {
  const delta = ts - now
  if (delta <= 0) return 'maintenant'
  if (delta < HOUR) return `dans ${Math.max(1, Math.round(delta / MINUTE))} min`
  if (delta < DAY) return `dans ${Math.round(delta / HOUR)} h`
  return `dans ${Math.round(delta / DAY)} j`
}

/** Les tirs qui comptent pour la santé : les sautés disent un chevauchement, pas un verdict. */
export function verdictRuns(task: ScheduledTaskDto): ScheduledRunDto[] {
  return task.runs.filter((run) => run.status !== 'skipped' && run.status !== 'running' && run.status !== 'checking')
}

export interface TaskHealth {
  state: ScheduleState
  /** Part des réussites sur les tirs jugés des 30 derniers jours, null sans tir. */
  rate: number | null
  judged: number
  /** Échecs (ou dépassements) d'affilée en tête de l'historique. */
  failStreak: number
  cost30: number
  avgDuration: number | null
  lastError: string | null
}

export function healthOf(task: ScheduledTaskDto, costOf: ScheduleProto['costOf'], now = Date.now()): TaskHealth {
  const recent = verdictRuns(task).filter((run) => run.startedAt > now - 30 * DAY)
  const ok = recent.filter((run) => run.status === 'succeeded').length
  let failStreak = 0
  for (const run of verdictRuns(task)) {
    if (run.status === 'failed' || run.status === 'timed_out') failStreak += 1
    else break
  }
  const durations = recent.filter((run) => run.finishedAt).map((run) => durationOf(run, now))
  const last = lastRun(task)
  return {
    state: scheduleState(task),
    rate: recent.length ? ok / recent.length : null,
    judged: recent.length,
    failStreak,
    cost30: task.runs.filter((run) => run.startedAt > now - 30 * DAY).reduce((sum, run) => sum + (costOf(run) ?? 0), 0),
    avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    lastError: last && (last.status === 'failed' || last.status === 'timed_out') ? last.error : null,
  }
}

/** Les prochains tirs d'une tâche entre deux dates, au plus `cap`. */
export function plannedRuns(task: ScheduledTaskDto, from: number, to: number, cap = 200): number[] {
  if (!task.enabled) return []
  const out: number[] = []
  let cursor = Math.max(from, Date.now())
  let last = task.lastRunAt
  for (let index = 0; index < cap; index += 1) {
    const next = index === 0 && task.nextRunAt && task.nextRunAt >= cursor ? task.nextRunAt : nextScheduleRun(task.cadence, cursor, last)
    if (next === null || next > to) break
    out.push(next)
    cursor = next + 1
    last = next
  }
  return out
}

/** La durée qu'on prête à un tir à venir : la médiane des passés, sinon la limite. */
export function typicalDuration(task: ScheduledTaskDto): number {
  const done = verdictRuns(task).filter((run) => run.finishedAt).map((run) => durationOf(run)).sort((a, b) => a - b)
  if (done.length) return done[Math.floor(done.length / 2)]!
  return Math.min(task.maxDurationMinutes, 60) * MINUTE
}

/* ------------------------------------------------------------------ démo */

interface DemoSpec {
  name: string
  agent: AgentKind
  cadence: ScheduleCadence
  prompt: string
  enabled?: boolean
  check?: { script: string; approved: boolean }
  /** Verdicts du plus récent au plus ancien, avec leur durée en minutes. */
  history: [ScheduleRunStatus, number, string?][]
  /** Espacement entre deux tirs passés, en heures. */
  every: number
  /** Heure du dernier tir, en heures avant maintenant. */
  lastAgo: number
  maxDuration?: number
}

const SPECS: DemoSpec[] = [
  {
    name: 'Revue nocturne des dépendances',
    agent: 'claude',
    cadence: { kind: 'cron', expression: '0 3 * * *' },
    prompt: 'Passe en revue les dépendances du dépôt : versions obsolètes, avis de sécurité, changements cassants annoncés. Ouvre une PR par mise à jour sûre, une carte pour le reste.',
    check: { script: 'pnpm outdated --json | jq -e "length > 0"', approved: true },
    history: [['succeeded', 18], ['skipped', 0, 'Rien à mettre à jour'], ['succeeded', 22], ['succeeded', 16], ['succeeded', 25], ['succeeded', 19], ['skipped', 0, 'Rien à mettre à jour'], ['succeeded', 21], ['succeeded', 17], ['succeeded', 20]],
    every: 24,
    lastAgo: 6,
  },
  {
    name: 'Veille de sécurité',
    agent: 'codex',
    cadence: { kind: 'cron', expression: '0 8 * * 1-5' },
    prompt: 'Lis les avis CVE de la semaine pour Node, Fastify, React et SQLite. Résume ce qui nous touche dans une note, avec le correctif.',
    history: [['succeeded', 9], ['succeeded', 11], ['timed_out', 30, 'Durée maximale atteinte (30 min)'], ['succeeded', 8], ['succeeded', 12], ['succeeded', 10], ['succeeded', 9]],
    every: 24,
    lastAgo: 1,
    maxDuration: 30,
  },
  {
    name: 'Rapport hebdo',
    agent: 'claude',
    cadence: { kind: 'cron', expression: '0 17 * * 5' },
    prompt: 'Rédige le rapport de la semaine : jalons avancés, cartes fermées, PR fusionnées, coût des sessions. Dépose-le en note sur le projet.',
    history: [['succeeded', 6], ['succeeded', 7], ['succeeded', 5], ['succeeded', 6]],
    every: 24 * 7,
    lastAgo: 4 * 24 + 15,
  },
  {
    name: 'Nettoyage des worktrees',
    agent: 'grok',
    cadence: { kind: 'interval', minutes: 360 },
    prompt: 'Liste les worktrees fusionnés sans fichiers non commités et propose leur suppression. Ne supprime rien qui porte du travail.',
    history: [['running', 0], ['succeeded', 3], ['succeeded', 2], ['succeeded', 4], ['succeeded', 3], ['succeeded', 2], ['succeeded', 3], ['succeeded', 2], ['succeeded', 3], ['succeeded', 2]],
    every: 6,
    lastAgo: 0.1,
  },
  {
    name: 'Tests E2E nocturnes',
    agent: 'claude',
    cadence: { kind: 'cron', expression: '30 2 * * *' },
    prompt: 'Lance les suites UI (board, git, places) et corrige ce qui casse. Si la correction dépasse une session, ouvre une carte.',
    history: [
      ['failed', 12, 'Chromium : libnspr4.so introuvable'],
      ['failed', 11, 'Chromium : libnspr4.so introuvable'],
      ['failed', 14, 'Chromium : libnspr4.so introuvable'],
      ['failed', 9, 'node-pty non compilé dans le worktree'],
      ['succeeded', 26],
      ['succeeded', 31],
      ['succeeded', 24],
    ],
    every: 24,
    lastAgo: 6.5,
  },
  {
    name: 'Traduction du catalogue',
    agent: 'opencode',
    cadence: { kind: 'cron', expression: '0 9 * * 1' },
    prompt: 'Complète les clés manquantes de catalog-en.ts à partir du français, en gardant la longueur des libellés de boutons.',
    enabled: false,
    history: [['succeeded', 14], ['failed', 20, 'Conflit sur catalog-en.ts'], ['succeeded', 13]],
    every: 24 * 7,
    lastAgo: 16 * 24,
  },
  {
    name: 'Synchro des issues GitHub',
    agent: 'codex',
    cadence: { kind: 'interval', minutes: 120 },
    prompt: 'Rapatrie les issues ouvertes depuis le dernier passage et propose-les en cartes à accepter.',
    check: { script: 'gh issue list --state open --json number --search "updated:>$(cat .last-sync)" | jq -e "length > 0"', approved: false },
    history: [],
    every: 2,
    lastAgo: 0,
  },
]

function demoTasks(projectId: string): { tasks: ScheduledTaskDto[]; costs: Map<string, number> } {
  const now = Date.now()
  const costs = new Map<string, number>()
  const tasks = SPECS.map((spec, taskIndex): ScheduledTaskDto => {
    const id = `demo-task-${taskIndex}`
    const runs = spec.history.map(([status, minutes, error], index): ScheduledRunDto => {
      const startedAt = now - (spec.lastAgo + index * spec.every) * HOUR
      const runId = `${id}-run-${index}`
      const running = status === 'running'
      if (status !== 'skipped') costs.set(runId, Math.round((minutes * (spec.agent === 'claude' ? 0.09 : 0.05) + ((taskIndex * 7 + index) % 5) * 0.03) * 100) / 100)
      return {
        id: runId,
        taskId: id,
        conversationId: status === 'skipped' ? null : `demo-conv-${taskIndex}-${index}`,
        trigger: index === 2 && taskIndex === 0 ? 'manual' : 'schedule',
        status,
        scheduledFor: startedAt,
        startedAt,
        finishedAt: running ? null : startedAt + Math.max(minutes, 0.3) * MINUTE,
        error: error && status !== 'skipped' ? error : null,
        check: status === 'skipped' ? { exitCode: 10, stdout: error ?? '', stderr: '', durationMs: 2400 } : null,
      }
    })
    const enabled = spec.enabled ?? true
    const lastRunAt = runs[0]?.startedAt ?? null
    return {
      id,
      projectId,
      userId: 'demo',
      name: spec.name,
      agent: spec.agent,
      config: {} as AgentConfig,
      prompt: spec.prompt,
      cadence: spec.cadence,
      executionMode: 'fresh',
      overlapPolicy: 'skip',
      confined: taskIndex === 3 ? true : null,
      maxDurationMinutes: spec.maxDuration ?? 45,
      enabled,
      lastRunAt,
      nextRunAt: enabled ? nextScheduleRun(spec.cadence, now, lastRunAt) : null,
      createdAt: now - 60 * DAY,
      updatedAt: now - 2 * DAY,
      runs,
      check: spec.check ? { ...spec.check, timeoutSeconds: 60, proposedBy: spec.check.approved ? null : 'demo-conv-agent' } : null,
    }
  })
  return { tasks, costs }
}
