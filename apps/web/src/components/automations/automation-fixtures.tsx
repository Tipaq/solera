import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { ProjectActionDto, ScheduledRunDto, ScheduledTaskDto, WorktreeDto } from '@solera/protocol'
import { fromAction, fromTask, type Automation, type TaskInput } from '../../lib/automations'
import { worktreesKey } from '../../lib/worktrees'

/**
 * Une action par état que les pièces distinguent, lues par le vrai modèle (`fromAction`,
 * `fromTask`) : en marche, arrêtée, réussie, en échec, plusieurs échecs, jamais lancée, à
 * relire, en cours. Les heures partent de l'ouverture de la story.
 */
export const PROJECT_ID = 'p-nimbus'
export const NOW = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN

function action(id: string, extra: Partial<ProjectActionDto>): Automation {
  const shown = {
    id, projectId: PROJECT_ID, label: id, description: null, kind: 'task' as const, command: 'pnpm test', subdir: null,
    url: null, placement: 'follow' as const, pinnedBranch: null, status: 'approved' as const, agentConversationId: null, agentConversationTitle: null, createdAt: NOW,
    updatedAt: NOW, service: null, lastRun: null, runs: [], onDemand: true, schedule: null, ...extra,
  }
  const { kind, command, subdir, url, schedule } = shown
  const cadence = schedule?.cadence ?? null
  return fromAction({ approved: shown.status === 'approved' ? { kind, command, subdir, url, cadence } : null, ...shown })
}

const cmdRun = (id: string, ago: number, exitCode: number) => ({
  id, actionId: 'x', trigger: 'manual' as const, conversationId: null, terminalId: null, cwd: '/srv/nimbus',
  status: exitCode === 0 ? ('succeeded' as const) : ('failed' as const), exitCode, startedAt: NOW - ago, finishedAt: NOW - ago + MIN,
})

function task(id: string, extra: Partial<TaskInput>): Automation {
  // Une tâche sans cadence (à la demande seulement) est ce qu'AC-04 ajoute au DTO.
  return fromTask({
    id, projectId: PROJECT_ID, userId: 'u1', name: id, agent: 'claude', config: {} as ScheduledTaskDto['config'],
    prompt: 'Passe en revue les dépendances et ouvre une carte par mise à jour risquée.',
    cadence: { kind: 'cron', expression: '0 3 * * *' }, executionMode: 'fresh', overlapPolicy: 'skip', confined: null,
    maxDurationMinutes: 30, enabled: true, lastRunAt: null, nextRunAt: NOW + 3 * HOUR, createdAt: NOW, updatedAt: NOW,
    runs: [], check: null, ...extra,
  } as ScheduledTaskDto)
}

const agentRun = (status: ScheduledRunDto['status'], ago: number): ScheduledRunDto => ({
  id: `r-${ago}`, taskId: 't', conversationId: `c-${ago}`, trigger: 'schedule', status, scheduledFor: NOW - ago,
  startedAt: NOW - ago, finishedAt: status === 'running' ? null : NOW - ago + 5 * MIN, error: null, check: null,
})

export const SERVICE_ON = action('a-dev', {
  label: 'Serveur de dev', kind: 'service', command: 'pnpm dev --host 127.0.0.1', url: 'http://127.0.0.1:{port}',
  service: { unit: 'solera-app-action-a-dev.service', state: 'active', cwd: '/srv/nimbus', ports: [5173], startedAt: NOW - 2 * HOUR,
    served: { path: '/srv/nimbus', worktreeId: null, root: true, branch: 'main', head: 'a1b2c3d', ahead: 0, behind: 0, dirtyFiles: 0 },
  },
})
/** Un service qui sert un worktree : en retard sur la base, des fichiers non commités. */
export const SERVICE_TREE = action('a-api', {
  label: 'API', kind: 'service', command: 'pnpm --filter api dev', subdir: 'apps/api', url: 'http://127.0.0.1:{port}',
  service: { unit: 'solera-app-action-a-api.service', state: 'active', cwd: '/srv/nimbus/.worktrees/w1/apps/api', ports: [8080], startedAt: NOW - HOUR,
    served: { path: '/srv/nimbus/.worktrees/w1', worktreeId: 'w1', root: false, branch: 'feat/905-vue-horizon-et-ses-jalons', head: 'e4f5a6b', ahead: 4, behind: 3, dirtyFiles: 2 },
  },
})
export const SERVICE_OFF = action('a-storybook', {
  label: 'Storybook', kind: 'service', command: 'pnpm storybook',
  service: { unit: 'solera-app-action-a-storybook.service', state: 'inactive', cwd: null, ports: [], startedAt: null, served: null },
})
export const SUCCEEDED = action('a-lint', { label: 'Lint', command: 'pnpm lint', runs: [cmdRun('l1', 3 * MIN, 0)] })
export const FAILED = action('a-tests', { label: 'Tests', command: 'pnpm test', runs: [cmdRun('t1', 12 * MIN, 1)] })
export const FAIL_STREAK = action('a-backup', {
  label: 'Sauvegarde', command: './scripts/backup.sh', runs: [cmdRun('b2', HOUR, 2), cmdRun('b1', 25 * HOUR, 2)],
})
export const NEVER = action('a-seed', { label: 'Remplir la base', command: 'pnpm db:seed' })
export const IN_TERMINAL = action('a-build', {
  label: 'Build', command: 'pnpm build', lastRun: { terminalId: 'term-1', alive: true, exitCode: null, startedAt: NOW - 2 * MIN },
})
export const PROPOSED = action('a-migrate', {
  label: 'Migrer la base', command: 'pnpm db:migrate', status: 'proposed',
  agentConversationId: 'c-db', agentConversationTitle: 'Schéma des factures',
})
export const AGENT = task('t-review', { name: 'Revue des dépendances', runs: [agentRun('succeeded', 20 * HOUR)] })
export const AGENT_RUNNING = task('t-triage', {
  name: 'Tri des tickets', agent: 'codex', cadence: null, runs: [agentRun('running', 4 * MIN)],
})

/** Les états, dans l'ordre où les stories les montrent. */
export const STATES: Automation[] = [SERVICE_ON, SERVICE_OFF, SUCCEEDED, FAILED, FAIL_STREAK, NEVER, IN_TERMINAL, PROPOSED, AGENT, AGENT_RUNNING]

const tree = (id: string, name: string): WorktreeDto => ({
  id, projectId: PROJECT_ID, name, path: `/srv/nimbus/.worktrees/${id}`, baseRef: 'main', createdAt: NOW, conversationCount: 1,
  git: { branch: name, isDirty: false, changedFiles: 0, added: 0, removed: 0 },
})

export const WORKTREES: WorktreeDto[] = [
  tree('w1', 'feat/factures'),
  tree('w2', 'fix/connexion-lente'),
  tree('w3', 'feat/export-csv'),
]

/** Les arbres du projet dans le cache de React Query : « Lancer dans » les lit sans requête. */
export function SeededWorktrees({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(worktreesKey(PROJECT_ID), WORKTREES)
    return null
  })
  return <>{children}</>
}
