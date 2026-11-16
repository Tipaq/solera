import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectActionDto, ScheduledRunDto, ScheduledTaskDto } from '@solera/protocol'
import type { MessageKey, MessageParams } from '../../web/src/lib/i18n/index.js'

const { fromAction, fromTask } = await import('../../web/src/lib/automations.js')
const { actionsTabPath, overviewActionsOf, overviewLine } = await import('../../web/src/lib/overview-actions.js')
const { en } = await import('../../web/src/lib/i18n/catalog-en.js')
const { fr } = await import('../../web/src/lib/i18n/catalog-fr.js')

/*
 * Le bloc « Actions » de l'Aperçu (`projet.md` A-5) : ce qui tourne ou attend
 * seulement, et des renvois vers l'onglet Actions, plus vers le lanceur ⚡ (A-5.4).
 */

const MIN = 60_000
const DAY = 24 * 60 * MIN
const NOW = 1_800_000_000_000

function translator(catalog: Record<string, string>) {
  return (key: MessageKey, params?: MessageParams) =>
    catalog[key]!.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
const t = translator(fr)
const tEn = translator(en)

const action = (over: Partial<ProjectActionDto> = {}): ProjectActionDto => ({
  id: 'a1',
  projectId: 'p1',
  label: 'Tests',
  description: null,
  kind: 'task',
  command: 'pnpm test',
  subdir: null,
  url: null,
  status: 'approved',
  agentConversationId: null,
  agentConversationTitle: null,
  createdAt: NOW - 30 * DAY,
  updatedAt: NOW - 30 * DAY,
  service: null,
  lastRun: null,
  runs: [],
  approved: null,
  ...over,
})

const devServer = fromAction(
  action({
    id: 'dev',
    label: 'Serveur de dev',
    kind: 'service',
    url: 'http://localhost:{port}',
    service: { unit: 'solera-app-dev', state: 'active', cwd: null, ports: [5173], startedAt: NOW - 26 * MIN },
  }),
)
const tests = fromAction(
  action({ id: 'tests', label: 'Tests unitaires', lastRun: { terminalId: 'term1', alive: true, exitCode: null, startedAt: NOW - 2 * MIN } }),
)
const proposed = fromAction(
  action({ id: 'e2e', label: 'Suite UI', status: 'proposed', agentConversationId: 'c9', agentConversationTitle: 'Revue de la PR #117' }),
)
const storybook = fromAction(
  action({ id: 'sb', label: 'Storybook', kind: 'service', service: { unit: 'u', state: 'inactive', cwd: null, ports: [], startedAt: null } }),
)
const idleTask = fromAction(action({ id: 'lint', label: 'Lint' }))

const task = (over: Partial<ScheduledTaskDto> = {}): ScheduledTaskDto => ({
  id: 't1',
  projectId: 'p1',
  userId: 'u1',
  name: 'Revue nocturne',
  agent: 'claude',
  config: { model: 'opus' } as ScheduledTaskDto['config'],
  prompt: 'Passe en revue.',
  cadence: { kind: 'cron', expression: '0 3 * * *' },
  executionMode: 'fresh',
  overlapPolicy: 'skip',
  confined: null,
  maxDurationMinutes: 30,
  enabled: true,
  lastRunAt: null,
  nextRunAt: NOW + DAY,
  createdAt: NOW - 60 * DAY,
  updatedAt: NOW - DAY,
  runs: [],
  check: null,
  ...over,
})

const agentRun = (status: ScheduledRunDto['status'], conversationId: string | null): ScheduledRunDto => ({
  id: 'r1',
  taskId: 't1',
  conversationId,
  trigger: 'schedule',
  status,
  scheduledFor: NOW - 7 * MIN,
  startedAt: NOW - 7 * MIN,
  finishedAt: null,
  error: null,
  check: null,
})

test('overviewActionsOf : ce qui tourne puis ce qui attend, le reste compté au repos (A-5.1, A-5.3)', () => {
  const { shown, idle, total } = overviewActionsOf([storybook, proposed, devServer, idleTask, tests])
  assert.deepEqual(
    shown.map((item) => item.label),
    ['Serveur de dev', 'Tests unitaires', 'Suite UI'],
  )
  assert.equal(idle, 2)
  assert.equal(total, 5)
})

test('overviewActionsOf : rien du tout, ou rien qui tourne', () => {
  assert.deepEqual(overviewActionsOf([]), { shown: [], idle: 0, total: 0 })
  assert.deepEqual(overviewActionsOf([storybook, idleTask]), { shown: [], idle: 2, total: 2 })
})

test('overviewLine : un service en marche, son port, son âge et « Ouvrir » (A-5.2)', () => {
  assert.deepEqual(overviewLine(devServer, 'p1', NOW, t), {
    tone: 'live',
    detail: 'service · :5173 · depuis 26 min',
    gesture: { kind: 'open', href: 'http://localhost:5173' },
  })
})

test('overviewLine : un service sans adresse renvoie à son détail dans l’onglet Actions', () => {
  const bare = fromAction(
    action({ id: 'worker', kind: 'service', service: { unit: 'u', state: 'active', cwd: null, ports: [], startedAt: null } }),
  )
  assert.deepEqual(overviewLine(bare, 'p1', NOW, t), {
    tone: 'live',
    detail: 'service',
    gesture: { kind: 'detail', to: '/p/p1/actions?action=a-worker' },
  })
})

test('overviewLine : une tâche dans un terminal, depuis combien de temps, et « Panneau »', () => {
  assert.deepEqual(overviewLine(tests, 'p1', NOW, t), {
    tone: 'live',
    detail: 'tâche en cours dans un terminal · 2 min',
    gesture: { kind: 'terminal', terminalId: 'term1' },
  })
  assert.equal(overviewLine(tests, 'p1', NOW, tEn).detail, 'task running in a terminal · 2 min')
})

test('overviewLine : à relire mène au détail de l’action dans l’onglet Actions, plus au lanceur ⚡ (A-5.4)', () => {
  assert.deepEqual(overviewLine(proposed, 'p1', NOW, t), {
    tone: 'review',
    detail: 'à relire — proposée dans « Revue de la PR #117 »',
    gesture: { kind: 'review', to: '/p/p1/actions?action=a-e2e' },
  })
  const gone = fromAction(action({ id: 'x', status: 'proposed', agentConversationTitle: null }))
  assert.equal(overviewLine(gone, 'p1', NOW, t).detail, 'à relire — proposée dans une session supprimée')
})

test('overviewLine : un passage d’agent en cours mène à sa session, ou à son détail sans elle', () => {
  const withSession = fromTask(task({ runs: [agentRun('running', 'c7')] }))
  assert.deepEqual(overviewLine(withSession, 'p1', NOW, t), {
    tone: 'live',
    detail: 'passage en cours depuis 7 min',
    gesture: { kind: 'session', conversationId: 'c7' },
  })
  const without = fromTask(task({ runs: [agentRun('checking', null)] }))
  assert.deepEqual(overviewLine(without, 'p1', NOW, t).gesture, { kind: 'detail', to: '/p/p1/actions?action=t-t1' })
})

test('actionsTabPath : l’onglet, ou une action précise', () => {
  assert.equal(actionsTabPath('p1'), '/p/p1/actions')
  assert.equal(actionsTabPath('p1', 'a-x y'), '/p/p1/actions?action=a-x%20y')
})
