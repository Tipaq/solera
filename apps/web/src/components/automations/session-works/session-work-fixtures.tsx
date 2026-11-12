import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { ProjectBackgroundDto, ServiceDto, ServicesDto } from '@solera/protocol'
import { conversationsKey, projectBackgroundKey } from '../../../lib/conversations'
import { SERVICES_KEY } from '../../../lib/services'
import { mergeWorks } from '../../../lib/session-works'

/**
 * Ce que les sessions d'un projet de démonstration ont laissé tourner : un serveur vite
 * lancé ici, des tests en surveillance et un serveur au titre très long lancés ailleurs,
 * une surveillance de CI sans processus. Les stories passent par le vrai `mergeWorks`.
 */
export const PROJECT_ID = 'p-nimbus'
export const CONVERSATION_ID = 'c-here'
const OTHER_ID = 'c-other'
const LONG_ID = 'c-long'
const now = Date.now()
const MIN = 60_000

const service = (over: Partial<ServiceDto>): ServiceDto => ({
  id: 'svc', kind: 'command', pid: 4242, name: 'node', command: null, parentPid: 1, parentName: 'bash', launcherPid: 4000,
  stopsWithSolera: true, cwd: '/srv/nimbus', ports: [], startedAt: now - 10 * MIN, memoryBytes: 96 * 1024 * 1024, cpu: 0.03,
  processCount: 3, processes: [], projectId: PROJECT_ID, projectName: 'Nimbus', conversationId: CONVERSATION_ID,
  conversationTitle: 'Repenser la page projet', origin: 'agent', canStop: true, ...over,
})

export const SERVICES: ServiceDto[] = [
  service({ id: 's-vite', command: 'vite --port 5418 --strictPort', ports: [5418], startedAt: now - 47 * MIN, memoryBytes: 182 * 1024 * 1024, cpu: 0.04 }),
  service({
    id: 's-tests', command: 'pnpm --filter @nimbus/server test --watch', startedAt: now - 12 * MIN,
    conversationId: OTHER_ID, conversationTitle: 'Sessions autonomes confinées',
  }),
  service({
    id: 's-storybook', command: 'storybook dev -p 6006 --no-open --ci --config-dir apps/catalog/.storybook', ports: [6006],
    startedAt: now - 3 * 60 * MIN, conversationId: LONG_ID,
    conversationTitle: 'Une session au titre très long qui ne tient sur aucune tuile ni aucune ligne du panneau',
  }),
]

export const BACKGROUND: ProjectBackgroundDto[] = [
  {
    conversationId: CONVERSATION_ID, title: 'Repenser la page projet', agent: 'claude',
    tasks: [{ id: 'b-vite', kind: 'local_bash', description: 'Serveur du prototype', startedAt: now - 47 * MIN, toolCallId: 't1', command: 'npx vite --port 5418 --strictPort', serviceId: 's-vite' }],
  },
  {
    conversationId: OTHER_ID, title: 'Sessions autonomes confinées', agent: 'codex',
    tasks: [{ id: 'b-tests', kind: 'local_bash', description: '', startedAt: now - 12 * MIN, toolCallId: 't2', command: 'pnpm --filter @nimbus/server test --watch', serviceId: 's-tests' }],
  },
  {
    conversationId: LONG_ID, title: 'Une session au titre très long qui ne tient sur aucune tuile ni aucune ligne du panneau', agent: 'claude',
    tasks: [{ id: 'b-ci', kind: 'monitor', description: 'Surveiller la CI de la PR #118', startedAt: now - 6 * MIN, toolCallId: null, command: null, serviceId: null }],
  },
]

export const WORKS = mergeWorks({ projectId: PROJECT_ID, services: SERVICES, background: BACKGROUND, conversations: [] })
export const WORKS_HERE = mergeWorks({
  projectId: PROJECT_ID, services: SERVICES, background: BACKGROUND, conversations: [], currentConversationId: CONVERSATION_ID,
})

/** Prérempli les requêtes de `useSessionWorks` : rien ne part. */
export function SeededSessionWorks({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    const scan: ServicesDto = { supported: true, scannedAt: now, services: SERVICES, apps: [], environments: [], system: null }
    client.setQueryData(SERVICES_KEY, scan)
    client.setQueryData(projectBackgroundKey(PROJECT_ID), BACKGROUND)
    client.setQueryData(conversationsKey(PROJECT_ID), [])
    return null
  })
  return <>{children}</>
}
