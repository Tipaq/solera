import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  conversations,
  scheduledRuns,
  scheduledTasks,
  type Db,
  type ScheduledRunRow,
  type ScheduledTaskRow,
} from '@solera/db'
import {
  DEFAULT_CHECK_TIMEOUT_SECONDS,
  nextScheduleRun,
  parseAgentConfig,
  scheduleCadenceSchema,
  type AgentConfig,
  type AgentKind,
  type ScheduleCadence,
  type ScheduleOverlapPolicy,
  type ScheduleScope,
  type ScheduleWorktreeMode,
  type ScheduledRunDto,
  type ScheduledTaskDto,
} from '@solera/protocol'
import { badRequest, conflict, notFound } from '../http/errors.js'

/**
 * Lecture et écriture des tâches planifiées, partagées entre les routes de l'interface
 * et l'outil MCP `schedule_task` : deux copies auraient armé différemment la même tâche.
 */

/** Tirs rendus avec une tâche : de quoi remplir son historique sans second appel. */
const RUNS_PER_TASK = 20

/** Null : une tâche sans cadence, qui ne part qu'à la demande. */
export function readCadence(raw: string | null): ScheduleCadence | null {
  return raw === null ? null : scheduleCadenceSchema.parse(JSON.parse(raw))
}

function writeCadence(cadence: ScheduleCadence | null): string | null {
  return cadence === null ? null : JSON.stringify(cadence)
}

export function runToDto(row: ScheduledRunRow): ScheduledRunDto {
  return {
    id: row.id,
    taskId: row.taskId,
    conversationId: row.conversationId,
    trigger: row.trigger,
    status: row.status,
    scheduledFor: row.scheduledFor,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
    // La durée est toujours posée quand le script a tourné, même tué avant d'avoir un code.
    check:
      row.checkDurationMs === null
        ? null
        : {
            exitCode: row.checkExitCode,
            stdout: row.checkOutput ?? '',
            stderr: row.checkStderr ?? '',
            durationMs: row.checkDurationMs,
          },
  }
}

export function tasksToDto(db: Db, rows: ScheduledTaskRow[]): ScheduledTaskDto[] {
  if (rows.length === 0) return []
  // Une requête par tâche plutôt qu'une fenêtre sur toutes : elles se comptent sur les
  // doigts, et l'index (task_id, started_at) rend chacune immédiate.
  return rows.map((row) => {
    const runs = db
      .select()
      .from(scheduledRuns)
      .where(eq(scheduledRuns.taskId, row.id))
      .orderBy(desc(scheduledRuns.startedAt))
      .limit(RUNS_PER_TASK)
      .all()
    // Un fil supprimé depuis ne doit pas laisser dans l'historique un lien qui ne mène
    // nulle part : le tir reste, sans sa conversation.
    const threadIds = runs.flatMap((run) => (run.conversationId ? [run.conversationId] : []))
    const alive = new Set(
      threadIds.length > 0
        ? db
            .select({ id: conversations.id })
            .from(conversations)
            .where(inArray(conversations.id, threadIds))
            .all()
            .map((thread) => thread.id)
        : [],
    )
    return {
      id: row.id,
      projectId: row.projectId,
      scope: row.scope,
      userId: row.userId,
      name: row.name,
      agent: row.agent,
      config: parseAgentConfig(row.config),
      prompt: row.prompt,
      cadence: readCadence(row.cadence),
      onDemand: row.onDemand,
      worktreeMode: row.worktreeMode,
      executionMode: row.executionMode,
      overlapPolicy: row.overlapPolicy,
      confined: row.confined,
      maxDurationMinutes: row.maxDurationMinutes,
      enabled: row.enabled,
      lastRunAt: row.lastRunAt,
      nextRunAt: row.nextRunAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      runs: runs.map((run) => ({
        ...runToDto(run),
        conversationId: run.conversationId && alive.has(run.conversationId) ? run.conversationId : null,
      })),
      check: row.checkScript
        ? {
            script: row.checkScript,
            timeoutSeconds: row.checkTimeoutSeconds,
            approved: row.checkApprovedAt !== null,
            proposedBy: row.checkProposedBy,
          }
        : null,
    }
  })
}

export interface ScheduledTaskInput {
  name: string
  agent: AgentKind
  /** Déjà résolue : les `CLI_DEFAULT` sont remplacés avant l'écriture. */
  config: AgentConfig
  prompt: string
  /** Null : la tâche ne part qu'à la demande. */
  cadence: ScheduleCadence | null
  /** Absent : vrai, comme une tâche d'avant que le choix existe. */
  onDemand?: boolean
  /** Absent : à la racine du projet. */
  worktreeMode?: ScheduleWorktreeMode
  overlapPolicy: ScheduleOverlapPolicy
  /** Tirs confinés ou non (#146) ; null ou absent : le réglage du projet. */
  confined?: boolean | null
  maxDurationMinutes: number
  enabled: boolean
  /** Null : pas de vérification avant le tour. */
  checkScript?: string | null
  checkTimeoutSeconds?: number
}

function assertCoherent(agent: AgentKind, config: AgentConfig): void {
  if (config.agent !== agent) {
    throw badRequest('config_agent_mismatch', 'The configuration does not match the selected CLI.')
  }
}

/**
 * Hors projet, ni worktree neuf ni confinement : pas de dépôt où ouvrir l'un, pas
 * d'environnement de projet pour l'autre. Refusé à l'écriture plutôt qu'au premier tir.
 */
function assertPlaceable(scope: ScheduleScope, worktreeMode: ScheduleWorktreeMode, confined: boolean | null): void {
  if (scope === 'project') return
  if (worktreeMode === 'new') {
    throw badRequest('schedule_worktree_needs_project', 'Only a task in a project can run in a new worktree.')
  }
  if (confined) {
    throw badRequest('schedule_confined_needs_project', 'Only a task in a project can run confined.')
  }
}

/** Ni bouton ni cadence : une tâche que rien ne lancerait jamais. */
function assertTriggerable(cadence: ScheduleCadence | null, onDemand: boolean): void {
  if (cadence === null && !onDemand) {
    throw badRequest('schedule_needs_trigger', 'A task runs on demand, on a schedule, or both.')
  }
}

/**
 * Prochain tir à armer, ou l'erreur qui dit pourquoi il n'y en a pas.
 *
 * Une tâche active sans prochain tir est une tâche qui ne partira jamais sans le dire :
 * autant la refuser à l'écriture.
 */
function armedAt(cadence: ScheduleCadence | null, enabled: boolean, lastRunAt: number | null): number | null {
  if (!enabled || cadence === null) return null
  const next = nextScheduleRun(cadence, Date.now(), lastRunAt)
  if (next === null) {
    throw badRequest('schedule_never_fires', 'This schedule has no upcoming run.')
  }
  return next
}

/**
 * Crée une tâche. Sans projet, `scope` dit où ses tirs s'ouvrent (`none` par défaut) ;
 * avec un projet, la portée est `project` et `scope` est ignoré.
 */
export function createScheduledTask(
  db: Db,
  owner: { projectId: string | null; scope?: Exclude<ScheduleScope, 'project'>; userId: string; conversationId?: string },
  input: ScheduledTaskInput,
): ScheduledTaskRow {
  assertCoherent(input.agent, input.config)
  const onDemand = input.onDemand ?? true
  assertTriggerable(input.cadence, onDemand)
  const scope: ScheduleScope = owner.projectId !== null ? 'project' : (owner.scope ?? 'none')
  const worktreeMode = input.worktreeMode ?? 'root'
  assertPlaceable(scope, worktreeMode, input.confined ?? null)
  const now = Date.now()
  const row: ScheduledTaskRow = {
    id: randomUUID(),
    projectId: owner.projectId,
    scope,
    userId: owner.userId,
    name: input.name,
    agent: input.agent,
    config: JSON.stringify(input.config),
    prompt: input.prompt,
    cadence: writeCadence(input.cadence),
    onDemand,
    worktreeMode,
    executionMode: 'fresh',
    overlapPolicy: input.overlapPolicy,
    confined: input.confined ?? null,
    maxDurationMinutes: input.maxDurationMinutes,
    enabled: input.enabled,
    createdByConversationId: owner.conversationId ?? null,
    checkScript: input.checkScript ?? null,
    checkTimeoutSeconds: input.checkTimeoutSeconds ?? DEFAULT_CHECK_TIMEOUT_SECONDS,
    // Écrit dans l'interface, il est relu par qui l'a tapé ; écrit par un agent, il
    // attend une personne.
    checkApprovedAt: input.checkScript && !owner.conversationId ? now : null,
    checkProposedBy: input.checkScript && owner.conversationId ? owner.conversationId : null,
    lastRunAt: null,
    nextRunAt: armedAt(input.cadence, input.enabled, null),
    createdAt: now,
    updatedAt: now,
  }
  db.insert(scheduledTasks).values(row).run()
  return row
}

/**
 * Modifie une tâche. `agentConversationId` null : le geste vient de l'interface, et
 * enregistrer le script vaut le relire. Par un agent, un script changé redevient une
 * proposition, comme la commande d'une action de projet.
 */
export function updateScheduledTask(
  db: Db,
  current: ScheduledTaskRow,
  patch: Partial<ScheduledTaskInput>,
  agentConversationId: string | null = null,
): ScheduledTaskRow {
  const agent = patch.agent ?? current.agent
  const config = patch.config ?? parseAgentConfig(current.config)
  assertCoherent(agent, config)

  const cadence = patch.cadence !== undefined ? patch.cadence : readCadence(current.cadence)
  const onDemand = patch.onDemand ?? current.onDemand
  assertTriggerable(cadence, onDemand)
  const worktreeMode = patch.worktreeMode ?? current.worktreeMode
  const confined = patch.confined !== undefined ? patch.confined : current.confined
  assertPlaceable(current.scope, worktreeMode, confined)
  const enabled = patch.enabled ?? current.enabled
  // Réarmée seulement si la cadence ou la pause ont bougé : renommer une tâche ne doit
  // pas repousser un tir par intervalle qui approchait.
  const rearm = patch.cadence !== undefined || enabled !== current.enabled
  const next: ScheduledTaskRow = {
    ...current,
    name: patch.name ?? current.name,
    agent,
    config: JSON.stringify(config),
    prompt: patch.prompt ?? current.prompt,
    cadence: writeCadence(cadence),
    onDemand,
    worktreeMode,
    overlapPolicy: patch.overlapPolicy ?? current.overlapPolicy,
    confined,
    maxDurationMinutes: patch.maxDurationMinutes ?? current.maxDurationMinutes,
    enabled,
    nextRunAt: rearm ? armedAt(cadence, enabled, current.lastRunAt) : current.nextRunAt,
    checkTimeoutSeconds: patch.checkTimeoutSeconds ?? current.checkTimeoutSeconds,
    updatedAt: Date.now(),
  }
  if (patch.checkScript !== undefined && patch.checkScript !== current.checkScript) {
    next.checkScript = patch.checkScript
    next.checkApprovedAt = patch.checkScript && !agentConversationId ? next.updatedAt : null
    next.checkProposedBy = patch.checkScript && agentConversationId ? agentConversationId : null
  }
  db.update(scheduledTasks).set(next).where(eq(scheduledTasks.id, current.id)).run()
  return next
}

/**
 * Valide le script tel qu'il a été relu. S'il a changé depuis l'affichage, rien n'est
 * validé : on aurait approuvé un texte que personne n'a vu.
 */
export function approveScheduleCheck(db: Db, task: ScheduledTaskRow, reviewed: string): ScheduledTaskRow {
  if (!task.checkScript) throw notFound('schedule_check_missing', 'This task has no check script.')
  if (task.checkScript !== reviewed) {
    throw conflict('schedule_check_changed', 'The check script changed since it was displayed: review it again.')
  }
  const next = { ...task, checkApprovedAt: Date.now(), checkProposedBy: null }
  db.update(scheduledTasks)
    .set({ checkApprovedAt: next.checkApprovedAt, checkProposedBy: null })
    .where(and(eq(scheduledTasks.id, task.id), eq(scheduledTasks.checkScript, reviewed)))
    .run()
  return next
}

/**
 * Supprime une tâche et rend ses fils à la vie ordinaire, rangés.
 *
 * Rangés plutôt que laissés actifs : sortis de leur section, les tirs d'une tâche
 * horaire déferleraient d'un coup dans la liste principale, ce que la colonne
 * `schedule_id` servait justement à éviter. Renvoie les fils encore en cours, que
 * l'appelant doit arrêter : plus rien ne les surveillera.
 */
export function deleteScheduledTask(db: Db, taskId: string): string[] {
  const threads = db
    .select({ id: conversations.id, status: conversations.status, archivedAt: conversations.archivedAt })
    .from(conversations)
    .where(eq(conversations.scheduleId, taskId))
    .all()

  const now = Date.now()
  const fresh = threads.filter((thread) => thread.archivedAt === null).map((thread) => thread.id)
  if (fresh.length > 0) {
    db.update(conversations).set({ archivedAt: now }).where(inArray(conversations.id, fresh)).run()
  }
  db.update(conversations).set({ scheduleId: null }).where(eq(conversations.scheduleId, taskId)).run()
  // Les tirs partent avec elle, par cascade.
  db.delete(scheduledTasks).where(eq(scheduledTasks.id, taskId)).run()

  return threads
    .filter((thread) => thread.status === 'running' || thread.status === 'awaiting_input')
    .map((thread) => thread.id)
}
