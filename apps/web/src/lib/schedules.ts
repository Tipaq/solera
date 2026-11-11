import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentConfig,
  AgentKind,
  ScheduleCadence,
  ScheduleOverlapPolicy,
  ScheduleCheckResultDto,
  ScheduleRunStatus,
  ScheduleScope,
  ScheduleWorktreeMode,
  ScheduledRunDto,
  ScheduledTaskDto,
} from '@solera/protocol'
import { api } from './api'
import { cadenceWords, formatDateTime as dateTimeIn, RUN_VERDICTS, VERDICT_FILL } from './automations'
import { locale, translate, type MessageKey } from './i18n'
import { useInstance } from './instance'

export const SCHEDULES_KEY = ['schedules']

/**
 * Toutes les tâches planifiées visibles, tous projets confondus : la sidebar et la page
 * Planification lisent la même liste, filtrée par projet.
 *
 * Relue périodiquement : un tir part et finit sans qu'aucune requête de l'interface
 * l'ait provoqué, et l'état d'une tâche n'a pas de canal poussé à lui. Le premier statut
 * d'un fil neuf déclenche aussi une relecture, voir `useStatusFeed`.
 */
export function useSchedules() {
  return useQuery({
    queryKey: SCHEDULES_KEY,
    queryFn: () => api.get<ScheduledTaskDto[]>('/api/schedules'),
    staleTime: 10_000,
    refetchInterval: 20_000,
  })
}

export interface ScheduleInput {
  name: string
  agent: AgentKind
  config: AgentConfig
  prompt: string
  /** Null : la tâche ne part qu'à la demande, et `onDemand` doit être vrai. */
  cadence: ScheduleCadence | null
  /** Absent : vrai à la création, inchangé à la modification. */
  onDemand?: boolean
  /** Absent : à la racine du projet à la création, inchangé à la modification. */
  worktreeMode?: ScheduleWorktreeMode
  overlapPolicy: ScheduleOverlapPolicy
  /** Tirs confinés ou non (#146) ; null : le réglage du projet. */
  confined: boolean | null
  maxDurationMinutes: number
  /** Null retire la vérification. */
  checkScript?: string | null
  checkTimeoutSeconds?: number
}

/**
 * Le fuseau où le serveur lit un motif cron : celui où l'aperçu d'une planification
 * calcule et affiche ses passages (`nextScheduleRun`, `formatDateTime`).
 *
 * Celui du navigateur tant que l'instance n'est pas chargée, ou qu'un serveur plus
 * ancien que l'interface ne le donne pas : c'était l'aperçu d'avant.
 */
export function useServerTimeZone(): string {
  const { data } = useInstance()
  return data?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: SCHEDULES_KEY })
    // Un tir lancé ou une tâche supprimée changent aussi la liste des fils.
    void queryClient.invalidateQueries({ queryKey: ['conversations'] })
  }
}

export function useCreateSchedule(projectId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: ScheduleInput) =>
      api.post<ScheduledTaskDto>(`/api/projects/${projectId}/schedules`, input),
    onSuccess: invalidate,
  })
}

/**
 * Où créer une tâche depuis la page Planifiées : un projet, le vault (Savoir), l'instance
 * (réservée aux administrateurs) ou nulle part. Hors projet, ni worktree neuf ni
 * confinement.
 */
export type ScheduleTarget = { scope: 'project'; projectId: string } | { scope: Exclude<ScheduleScope, 'project'> }

/** Crée une tâche dans la portée choisie (`POST /api/schedules`). */
export function useCreateScopedSchedule() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ target, input }: { target: ScheduleTarget; input: ScheduleInput }) =>
      api.post<ScheduledTaskDto>('/api/schedules', { ...input, ...target }),
    onSuccess: invalidate,
  })
}

export function useUpdateSchedule() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<ScheduleInput & { enabled: boolean }>) =>
      api.patch<ScheduledTaskDto>(`/api/schedules/${id}`, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteSchedule() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/schedules/${id}`),
    onSuccess: invalidate,
  })
}

export function useRunSchedule() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, skipCheck = false }: { id: string; skipCheck?: boolean }) =>
      api.post<ScheduledRunDto>(`/api/schedules/${id}/run`, { skipCheck }),
    onSuccess: invalidate,
  })
}

/** Joue un script de vérification sans rien lancer ; rien n'est mis en cache. */
export function useTestScheduleCheck(projectId: string) {
  return useMutation({
    mutationFn: (input: { script: string; timeoutSeconds: number; taskId?: string }) =>
      api.post<ScheduleCheckResultDto>(`/api/projects/${projectId}/schedules/check-test`, input),
  })
}

/** Comme `useTestScheduleCheck`, joué où la portée tourne : le vault, le dossier de données. */
export function useTestScopedScheduleCheck() {
  return useMutation({
    mutationFn: ({ target, ...input }: { target: ScheduleTarget; script: string; timeoutSeconds: number; taskId?: string }) =>
      api.post<ScheduleCheckResultDto>('/api/schedules/check-test', { ...input, ...target }),
  })
}

export function useApproveScheduleCheck() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, script }: { id: string; script: string }) =>
      api.post<ScheduledTaskDto>(`/api/schedules/${id}/check/approve`, { script }),
    onSuccess: invalidate,
  })
}

/**
 * Ce que la tâche est en train de faire, en un mot : c'est l'état de sa ligne.
 *
 * Le tir en cours prime sur la pause : une tâche mise en pause pendant un tir tourne
 * encore, et l'afficher « en pause » cacherait la session qui travaille.
 */
export type ScheduleState = 'running' | 'approval' | 'paused' | 'failed' | 'done' | 'waiting'

export const SCHEDULE_STATE_LABELS: Record<ScheduleState, MessageKey> = {
  running: 'schedule.state.running',
  approval: 'schedule.state.approval',
  paused: 'schedule.state.paused',
  failed: 'schedule.state.failed',
  done: 'schedule.state.done',
  waiting: 'schedule.state.waiting',
}

/**
 * Le dernier tir qui dit quelque chose de la tâche.
 *
 * Les sautés sont écartés : ils signalent un chevauchement, pas une santé. Une ligne
 * resserrée n'a la place que d'un verdict, et c'est celui-là.
 */
export function lastRun(task: ScheduledTaskDto): ScheduledRunDto | undefined {
  return task.runs.find((run) => run.status !== 'skipped')
}

/** Le mot, le point et la teinte d'un tir : lus de la table commune des passages. */
export const RUN_LABELS = mapRuns((status) => RUN_VERDICTS[status].label)

export const RUN_DOTS = mapRuns((status) => {
  const { tone, live } = RUN_VERDICTS[status]
  return live ? `${VERDICT_FILL[tone]} animate-pulse` : VERDICT_FILL[tone]
})

/** La teinte d'une pastille de verdict, quand un tir se résume en un mot. */
export const RUN_TONES = mapRuns((status) => RUN_VERDICTS[status].tone)

/** Les statuts d'un tir d'agent : ceux de la table commune, sauf `stopped`, propre aux commandes. */
function mapRuns<T>(pick: (status: ScheduleRunStatus) => T): Record<ScheduleRunStatus, T> {
  const statuses = Object.keys(RUN_VERDICTS).filter((status): status is ScheduleRunStatus => status !== 'stopped')
  return Object.fromEntries(statuses.map((status) => [status, pick(status)])) as Record<ScheduleRunStatus, T>
}

export function scheduleState(task: ScheduledTaskDto): ScheduleState {
  const last = lastRun(task)
  if (last?.status === 'running' || last?.status === 'checking') return 'running'
  // Avant la pause : une tâche qui attend une validation ne fait rien tant qu'on ne l'a
  // pas donnée, et c'est la seule chose qu'on attende de qui la regarde.
  if (task.check && !task.check.approved) return 'approval'
  if (!task.enabled) return task.cadence?.kind === 'once' && task.lastRunAt ? 'done' : 'paused'
  if (last?.status === 'failed' || last?.status === 'timed_out') return 'failed'
  return 'waiting'
}

/** Date et heure d'un tir ; `timeZone` les lit à l'heure du serveur plutôt qu'à celle du poste. */
export function formatDateTime(ts: number, timeZone?: string): string {
  return dateTimeIn(ts, locale(), timeZone)
}

/**
 * La cadence en clair, « À la demande » sans cadence ; le motif cron est traduit par
 * l'appelant, qui a `cronToHuman`.
 */
export function describeCadence(
  cadence: ScheduleCadence | null,
  cronHuman: (expression: string) => string | null,
  timeZone?: string,
): string {
  if (cadence === null) return translate('automation.when.demand')
  if (cadence.kind === 'cron') return cronHuman(cadence.expression) ?? cadence.expression
  if (cadence.kind === 'once') return translate('schedule.cadence.onceAt', { date: formatDateTime(cadence.at, timeZone) })
  return cadenceWords(cadence, translate, locale())
}
