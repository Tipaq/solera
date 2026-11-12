import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActionRunDetailDto, ProjectActionDto, ScheduledTaskDto } from '@solera/protocol'
import type { MessageKey, MessageParams } from '../../web/src/lib/i18n/index.js'

const {
  actionPanelOf,
  editorKey,
  firstOpenRun,
  newActionPanel,
  originOf,
  panelBack,
  panelItem,
  panelLabel,
  pickable,
  reviewOf,
  runVerdict,
  stripOf,
  withPaused,
} = await import('../../web/src/lib/action-panel.js')
const { fromAction, fromTask, stateSentence, whenWords } = await import('../../web/src/lib/automations.js')
const { en } = await import('../../web/src/lib/i18n/catalog-en.js')
const { fr } = await import('../../web/src/lib/i18n/catalog-fr.js')

function translator(catalog: Record<string, string>) {
  return (key: MessageKey, params?: MessageParams) =>
    catalog[key]!.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
const t = translator(fr)
const tEn = translator(en)

const NOW = 1_800_000_000_000
const MIN = 60_000
const NIGHTLY = { kind: 'cron', expression: '0 3 * * *' } as const

const action = (over: Partial<ProjectActionDto> = {}): ProjectActionDto => ({
  id: 'a1',
  projectId: 'p1',
  label: 'Tests',
  description: null,
  kind: 'task',
  command: 'pnpm test',
  subdir: null,
  url: null,
  placement: 'follow',
  pinnedBranch: null,
  status: 'approved',
  agentConversationId: null,
  agentConversationTitle: null,
  createdAt: NOW,
  updatedAt: NOW,
  approved: { kind: 'task', command: 'pnpm test', subdir: null, url: null, cadence: null },
  onDemand: true,
  schedule: null,
  service: null,
  lastRun: null,
  runs: [],
  ...over,
})

const task = (over: Partial<ScheduledTaskDto> = {}): ScheduledTaskDto => ({
  id: 't1',
  projectId: 'p1',
  scope: 'project',
  userId: 'u1',
  name: 'Revue nocturne',
  agent: 'codex',
  config: { agent: 'codex', model: 'gpt-5.5' } as ScheduledTaskDto['config'],
  prompt: 'Passe en revue les dépendances.',
  cadence: NIGHTLY,
  onDemand: true,
  worktreeMode: 'root',
  executionMode: 'fresh',
  overlapPolicy: 'wait',
  confined: null,
  maxDurationMinutes: 45,
  enabled: true,
  lastRunAt: null,
  nextRunAt: NOW,
  createdAt: NOW - 3 * 86_400_000,
  updatedAt: NOW,
  runs: [],
  check: null,
  ...over,
})

const detailRun = (id: string, ago: number, exitCode: number | null, excerpt: string | null = null): ActionRunDetailDto => ({
  id,
  actionId: 'a1',
  trigger: 'manual',
  conversationId: null,
  terminalId: null,
  cwd: '/srv/p1',
  status: exitCode === null ? 'running' : exitCode === 0 ? 'succeeded' : 'failed',
  exitCode,
  startedAt: NOW - ago,
  finishedAt: exitCode === null ? null : NOW - ago + 20_000,
  excerpt,
})

/* ------------------------------------------------------------------ TIRA-1 : les modes */

test('newActionPanel : la nature choisie d’avance, ou le choix d’une action à planifier', () => {
  assert.deepEqual(newActionPanel('command'), { mode: 'edit', seed: { preset: { what: 'command', kind: 'task' } }, back: null })
  assert.deepEqual(newActionPanel('service'), { mode: 'edit', seed: { preset: { what: 'command', kind: 'service' } }, back: null })
  assert.deepEqual(newActionPanel('agent'), { mode: 'edit', seed: { preset: { what: 'agent' } }, back: null })
  assert.deepEqual(newActionPanel('schedule'), { mode: 'pick' })
  assert.deepEqual(newActionPanel('any'), { mode: 'edit', seed: {}, back: null })
})

test('actionPanelOf : `?nouvelle=` ouvre l’éditeur pré-réglé ; une valeur inconnue n’ouvre rien', () => {
  assert.deepEqual(actionPanelOf('1'), newActionPanel('any'))
  assert.deepEqual(actionPanelOf('commande'), newActionPanel('command'))
  assert.deepEqual(actionPanelOf('service'), newActionPanel('service'))
  assert.deepEqual(actionPanelOf('agent'), newActionPanel('agent'))
  assert.deepEqual(actionPanelOf('planifier'), { mode: 'pick' })
  assert.equal(actionPanelOf(null), null)
  assert.equal(actionPanelOf('autre'), null)
})

/* ------------------------------------------------------------------ TIRA-2, TIRA-3 : remonter d'un niveau */

test('panelBack : l’édition revient au détail d’où l’on vient, le passage aussi ; sinon on ferme', () => {
  assert.deepEqual(panelBack({ mode: 'edit', seed: {}, back: 'a-a1' }), { mode: 'detail', id: 'a-a1' })
  assert.deepEqual(panelBack({ mode: 'run', terminalId: 'term', back: 'a-a1' }), { mode: 'detail', id: 'a-a1' })
  assert.equal(panelBack({ mode: 'edit', seed: {}, back: null }), null)
  assert.equal(panelBack({ mode: 'detail', id: 'a-a1', review: true }), null)
  assert.equal(panelBack({ mode: 'pick' }), null)
})

test('panelItem : le détail d’une action disparue ne montre rien', () => {
  const items = [fromAction(action())]
  assert.equal(panelItem({ mode: 'detail', id: 'a-a1' }, items)?.label, 'Tests')
  assert.equal(panelItem({ mode: 'detail', id: 'a-gone' }, items), null)
  assert.equal(panelItem({ mode: 'pick' }, items), null)
})

test('panelLabel : le nom du tiroir selon le mode', () => {
  const tests = fromAction(action())
  assert.equal(panelLabel({ mode: 'detail', id: tests.id }, tests, t), 'Tests')
  assert.equal(panelLabel({ mode: 'edit', seed: { from: tests }, back: tests.id }, null, t), 'Modifier « Tests »')
  assert.equal(panelLabel({ mode: 'edit', seed: {}, back: null }, null, t), 'Nouvelle action')
  // Dupliquer crée une action : le tiroir ne dit pas qu'on modifie l'original.
  assert.equal(panelLabel({ mode: 'edit', seed: { draft: { what: 'command', body: { label: 'x', kind: 'task', command: 'y' } } }, back: tests.id }, null, t), 'Nouvelle action')
  assert.equal(panelLabel({ mode: 'pick' }, null, t), 'Planifier une action existante')
  assert.equal(panelLabel({ mode: 'run', terminalId: 'x', back: tests.id }, tests, t), 'Passage de « Tests »')
  assert.equal(panelLabel({ mode: 'pick' }, null, tEn), 'Schedule an existing action')
})

test('editorKey : une graine différente remonte l’éditeur à neuf', () => {
  const tests = fromAction(action())
  const keys = new Set([
    editorKey({ from: tests }),
    editorKey({ from: tests, schedule: true }),
    editorKey({ preset: { what: 'command', kind: 'task' } }),
    editorKey({ preset: { what: 'command', kind: 'service' } }),
    editorKey({ preset: { what: 'agent' } }),
    editorKey({}),
  ])
  assert.equal(keys.size, 6)
  assert.equal(editorKey({ from: tests }), editorKey({ from: fromAction(action({ label: 'Autre' })) }))
})

/* ------------------------------------------------------------------ TIRA-7 : planifier une action existante */

test('pickable : ni ce qui est déjà planifié, ni ce qui attend une relecture', () => {
  const items = [
    fromAction(action({ id: 'free' })),
    fromAction(action({ id: 'nightly', schedule: { cadence: NIGHTLY, enabled: true, nextRunAt: NOW, maxDurationMinutes: 30 } as ProjectActionDto['schedule'] })),
    fromAction(action({ id: 'proposed', status: 'proposed' })),
    fromTask(task({ id: 'demand', cadence: null } as unknown as Partial<ScheduledTaskDto>)),
    fromTask(task({ id: 'planned' })),
  ]
  assert.deepEqual(pickable(items).map((item) => item.id), ['a-free', 't-demand'])
})

/* ------------------------------------------------------------------ DET-4 : la relecture */

test('reviewOf : une commande neuve se relit telle quelle', () => {
  const proposed = fromAction(action({ status: 'proposed', approved: null, command: 'rm -rf build && pnpm build' }))
  assert.deepEqual(reviewOf(proposed), { kind: 'command', changes: [], command: 'rm -rf build && pnpm build', subdir: null, url: null })
})

test('reviewOf : une commande validée puis modifiée montre ce qui a changé, champ par champ', () => {
  const modified = fromAction(
    action({
      status: 'proposed',
      command: 'pnpm test --run',
      subdir: 'apps/web',
      url: null,
      approved: { kind: 'task', command: 'pnpm test', subdir: null, url: null, cadence: null },
    }),
  )
  assert.deepEqual(reviewOf(modified), {
    kind: 'command',
    command: 'pnpm test --run',
    subdir: 'apps/web',
    url: null,
    changes: [
      { field: 'command', before: 'pnpm test', after: 'pnpm test --run' },
      { field: 'subdir', before: null, after: 'apps/web' },
    ],
  })
})

test('reviewOf : le script de vérification d’une tâche, et rien hors relecture', () => {
  const checked = fromTask(task({ check: { script: 'git diff --quiet || exit 0', timeoutSeconds: 30, approved: false, proposedBy: 'c1' } }))
  assert.deepEqual(reviewOf(checked), { kind: 'script', script: 'git diff --quiet || exit 0' })
  assert.equal(reviewOf(fromAction(action())), null)
})

/* ------------------------------------------------------------------ DET-8 : les passages */

test('stripOf : les vingt derniers, le plus récent à droite, la date et le verdict en infobulle', () => {
  const runs = Array.from({ length: 24 }, (_, index) => detailRun(`r${index}`, (index + 1) * 60 * MIN, index === 0 ? 1 : 0))
  const item = fromAction(action(), runs)
  const strip = stripOf(item.runs, t, 'fr-FR', 'UTC')
  assert.equal(strip.length, 20)
  assert.equal(strip.at(-1)!.id, 'r0')
  assert.equal(strip[0]!.id, 'r19')
  assert.equal(strip.at(-1)!.tone, 'critical')
  assert.equal(strip[0]!.tone, 'positive')
  assert.match(strip.at(-1)!.title, / · échoué · code 1$/)
})

test('stripOf : ce qui tourne bat, ce qui a été arrêté reste neutre', () => {
  const item = fromAction(action(), [detailRun('now', MIN, null), { ...detailRun('stop', 2 * MIN, 130), status: 'stopped' }])
  assert.deepEqual(stripOf(item.runs, t, 'fr-FR', 'UTC').map((run) => run.tone), ['neutral', 'running'])
})

test('runVerdict : le code quand on le connaît, sinon le mot', () => {
  const item = fromAction(action(), [detailRun('r1', MIN, 2), detailRun('r2', 2 * MIN, null)])
  assert.equal(runVerdict(item.runs[0]!, t), 'code 2')
  assert.equal(runVerdict(item.runs[1]!, t), 'en cours')
  const agent = fromTask(task({ runs: [{ id: 'x', taskId: 't1', conversationId: 'c', trigger: 'schedule', status: 'timed_out', scheduledFor: NOW, startedAt: NOW, finishedAt: NOW, error: null, check: null }] }))
  assert.equal(runVerdict(agent.runs[0]!, t), 'trop long')
})

test('firstOpenRun : le premier passage qui a quelque chose à montrer est déplié d’office', () => {
  const item = fromAction(action(), [detailRun('r1', MIN, 0), detailRun('r2', 2 * MIN, 1, 'Error: boom')])
  assert.equal(firstOpenRun(item.runs), 'r2')
  assert.equal(firstOpenRun(fromAction(action(), [detailRun('r1', MIN, 0)]).runs), null)
  const failed = fromTask(task({ runs: [{ id: 'x', taskId: 't1', conversationId: null, trigger: 'schedule', status: 'failed', scheduledFor: NOW, startedAt: NOW, finishedAt: NOW, error: 'Le CLI a quitté', check: null }] }))
  assert.equal(firstOpenRun(failed.runs), 'x')
})

/* ------------------------------------------------------------------ DET-9 : l'origine */

test('originOf : proposée par un agent dans une session, ou créée par toi', () => {
  assert.deepEqual(originOf(fromAction(action({ agentConversationId: 'c1', agentConversationTitle: 'Schéma' }))), {
    by: 'agent',
    conversationId: 'c1',
    title: 'Schéma',
    at: NOW,
  })
  assert.deepEqual(originOf(fromAction(action())), { by: 'you', at: NOW })
  assert.deepEqual(originOf(fromTask(task())), { by: 'you', at: NOW - 3 * 86_400_000 })
})

/* ------------------------------------------------------------------ DET-11 : la pause, tout de suite */

test('withPaused : la pause se lit tout de suite dans les puces et la phrase', () => {
  const nightly = fromTask(task())
  const paused = withPaused(nightly, true)
  assert.equal(paused.schedule!.enabled, false)
  assert.match(whenWords(paused, t, 'fr-FR').at(-1)!, /en pause/)
  assert.equal(stateSentence(paused, NOW, t).text, 'Planification en pause : elle ne part qu’à la main.')
  assert.equal(withPaused(paused, false).schedule!.enabled, true)
  // Sans planification, rien à mettre en pause.
  const free = fromAction(action())
  assert.equal(withPaused(free, true), free)
})
