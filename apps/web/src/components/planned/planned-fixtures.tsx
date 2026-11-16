import type { ScheduledRunDto, ScheduledTaskDto, ScheduleScope } from '@solera/protocol'
import { fromTask, type Automation, type TaskInput } from '../../lib/automations'
import { plannedOf, type PlannedItem, type ScopeProject } from '../../lib/planned'
import { AGENT, AGENT_CHECK, AGENT_RUNNING, NIGHTLY, NOW, PROJECT_ID } from '../automations/automation-fixtures'

/*
 * Les tâches de la page Planifiées dans chacune de leurs portées, lues par le vrai modèle
 * (`fromTask`, `plannedOf`) : deux projets, le Savoir, l'instance, sans projet. Les heures
 * partent de l'ouverture de la story.
 */

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const PROJECTS: ScopeProject[] = [
  { id: PROJECT_ID, name: 'Nimbus', image: null, color: '#22d3ee' },
  { id: 'p-atlas', name: 'Atlas API', image: null, color: '#a78bfa' },
]

const run = (status: ScheduledRunDto['status'], ago: number, error: string | null = null): ScheduledRunDto => ({
  id: `r-${ago}-${status}`, taskId: 't', conversationId: `c-${ago}`, trigger: 'schedule', status, scheduledFor: NOW - ago,
  startedAt: NOW - ago, finishedAt: NOW - ago + 5 * MIN, error, check: null,
})

function scoped(id: string, scope: ScheduleScope, projectId: string | null, extra: Partial<TaskInput>): Automation {
  return fromTask({
    id, projectId, scope, userId: 'u1', name: id, agent: 'claude', config: {} as ScheduledTaskDto['config'],
    prompt: 'Relis les notes de la semaine et rédige un résumé.', cadence: { kind: 'cron', expression: '0 18 * * 0' },
    onDemand: true, worktreeMode: 'root', executionMode: 'fresh', overlapPolicy: 'skip', confined: null,
    maxDurationMinutes: 30, enabled: true, lastRunAt: null, nextRunAt: NOW + 3 * DAY, createdAt: NOW, updatedAt: NOW,
    runs: [], check: null, ...extra,
  } as ScheduledTaskDto)
}

const E2E = scoped('t-e2e', 'project', 'p-atlas', {
  name: 'Tests E2E nocturnes', agent: 'codex', cadence: { kind: 'cron', expression: '0 2 * * *' }, nextRunAt: NOW + 14 * HOUR,
  runs: [run('failed', 9 * HOUR, 'Chromium introuvable'), run('failed', 33 * HOUR), run('failed', 57 * HOUR), run('succeeded', 81 * HOUR)],
})
const NOTES = scoped('t-notes', 'vault', null, {
  name: 'Résumer les notes de la semaine', runs: [run('succeeded', 4 * DAY), run('succeeded', 11 * DAY)],
})
const CLEAN = scoped('t-clean', 'instance', null, {
  name: 'Nettoyer les worktrees fusionnés', cadence: { kind: 'interval', minutes: 360 }, enabled: false, nextRunAt: null,
  runs: [run('succeeded', 2 * DAY)],
})
const LOOSE = scoped('t-loose', 'none', null, { name: 'Veille des versions de CLI', cadence: null, nextRunAt: null })

/** Une planifiée par état et par portée, dans l'ordre où les stories les montrent. */
export const PLANNED: PlannedItem[] = plannedOf([AGENT, AGENT_RUNNING, AGENT_CHECK, NIGHTLY, E2E, NOTES, CLEAN, LOOSE], PROJECTS)

/** Le coût d'un passage d'agent : de quoi remplir la Liste. */
export const costOf = (run: { conversationId?: string | null }): number | null => (run.conversationId ? 0.18 : null)
