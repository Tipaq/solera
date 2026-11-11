import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { ProjectActionDto } from '@solera/protocol'
import { ACTIONS_KEY } from '../../lib/actions'

/**
 * Les actions d'un projet de démonstration, une par état que la liste distingue. Les
 * vues lisent la liste par React Query : les stories préremplissent le cache, rien ne
 * part.
 */
export const PROJECT_ID = 'p-nimbus'
const now = Date.UTC(2026, 9, 24, 10, 0)

function action(id: string, extra: Partial<ProjectActionDto>): ProjectActionDto {
  const shown = {
    id, projectId: PROJECT_ID, label: id, description: null, kind: 'task' as const, command: 'pnpm test', subdir: null,
    url: null, placement: 'follow' as const, pinnedBranch: null, status: 'approved' as const, agentConversationId: null, agentConversationTitle: null, createdAt: now,
    updatedAt: now, service: null, lastRun: null, runs: [], onDemand: true, schedule: null, ...extra,
  }
  // Une action validée l'a été telle qu'elle est ; une proposée n'a jamais été relue.
  const { kind, command, subdir, url, schedule } = shown
  const cadence = schedule?.cadence ?? null
  return { approved: shown.status === 'approved' ? { kind, command, subdir, url, cadence } : null, ...shown }
}

export const ACTIONS: ProjectActionDto[] = [
  action('a-dev', {
    label: 'Serveur de dev', kind: 'service', command: 'pnpm dev --host 127.0.0.1', subdir: 'apps/web',
    description: 'Vite, avec le rechargement à chaud.', url: 'http://nimbus.local:{port}',
    service: { unit: 'solera-app-action-a-dev.service', state: 'active', cwd: '/srv/nimbus/apps/web', ports: [5173], startedAt: now - 3_600_000,
      served: { path: '/srv/nimbus', worktreeId: null, root: true, branch: 'main', head: 'a1b2c3d', ahead: 0, behind: 0, dirtyFiles: 0 },
    },
  }),
  action('a-tests', {
    label: 'Tests', command: 'pnpm test',
    lastRun: { terminalId: 't-1', alive: false, exitCode: 1, startedAt: now - 600_000 },
  }),
  action('a-seed', {
    label: 'Remplir la base', command: 'pnpm db:seed && pnpm db:check', status: 'proposed',
    agentConversationId: 'c-seed', agentConversationTitle: 'Jeu de données de démonstration',
  }),
  action('a-storybook', {
    label: 'Storybook', kind: 'service', command: 'pnpm storybook',
    service: { unit: 'solera-app-action-a-storybook.service', state: 'failed', cwd: null, ports: [], startedAt: null, served: null },
  }),
]

export function SeededActions({ actions, children }: { actions: ProjectActionDto[]; children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(ACTIONS_KEY, actions)
    return null
  })
  return <>{children}</>
}
