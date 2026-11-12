import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectActionDto, ScheduledTaskDto } from '@solera/protocol'
import type { EditorState } from '../../web/src/lib/action-editor.js'
import type { MessageKey, MessageParams } from '../../web/src/lib/i18n/index.js'

const { ALL_FIELDS, draftFrom, editorStateOf, headerWhen, linkIsLocalOnly, problemsOf, summaryOf } = await import(
  '../../web/src/lib/action-editor.js'
)
const { fromAction, fromTask } = await import('../../web/src/lib/automations.js')
const { en } = await import('../../web/src/lib/i18n/catalog-en.js')
const { fr } = await import('../../web/src/lib/i18n/catalog-fr.js')

function translator(catalog: Record<string, string>) {
  return (key: MessageKey, params?: MessageParams) =>
    catalog[key]!.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
const t = translator(fr)
const tEn = translator(en)

const NOW = 1_800_000_000_000
const NIGHTLY = { kind: 'cron', expression: '0 3 * * *' } as const
const EVENING = { kind: 'cron', expression: '0 19 * * 1-5' } as const

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
  approved: null,
  onDemand: true,
  schedule: null,
  service: null,
  instances: [],
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
  worktreeMode: 'new',
  executionMode: 'fresh',
  overlapPolicy: 'wait',
  confined: true,
  maxDurationMinutes: 45,
  enabled: true,
  lastRunAt: null,
  nextRunAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  runs: [],
  check: { script: 'exit 0', timeoutSeconds: 30, approved: true, proposedBy: null } as ScheduledTaskDto['check'],
  ...over,
})

const fresh = (over: Partial<EditorState> = {}): EditorState => ({ ...editorStateOf({}), ...over })

/* ------------------------------------------------------------------ EDI-1 : la graine */

test('editorStateOf : une nouvelle action est une commande, tâche, à la demande', () => {
  const state = editorStateOf({})
  assert.equal(state.what, 'command')
  assert.equal(state.kind, 'task')
  assert.equal(state.onDemand, true)
  assert.equal(state.scheduled, false)
  assert.equal(state.label, '')
  assert.equal(state.placement, 'follow')
  assert.equal(state.worktreeMode, 'root')
})

test('editorStateOf : preset choisit la nature, schedule coche « Planifiée »', () => {
  const service = editorStateOf({ preset: { what: 'command', kind: 'service' } })
  assert.equal(service.kind, 'service')
  const agent = editorStateOf({ preset: { what: 'agent' }, schedule: true })
  assert.equal(agent.what, 'agent')
  assert.equal(agent.scheduled, true)
})

test('editorStateOf : prefill remplit libellé, commande, lien et description', () => {
  const state = editorStateOf({ prefill: { label: 'Dev', command: 'pnpm dev', url: 'http://localhost:{port}', description: 'Vite' } })
  assert.equal(state.label, 'Dev')
  assert.equal(state.command, 'pnpm dev')
  assert.equal(state.url, 'http://localhost:{port}')
  assert.equal(state.description, 'Vite')
})

test('editorStateOf : prefill d’une suggestion du dépôt remplit aussi son dossier', () => {
  const state = editorStateOf({ preset: { what: 'command', kind: 'task' }, prefill: { label: 'Tests', command: 'pnpm test', subdir: 'apps/web' } })
  assert.equal(state.subdir, 'apps/web')
  assert.equal(editorStateOf({ prefill: { command: 'pnpm test' } }).subdir, '')
})

test('editorStateOf : from relit une commande planifiée, son placement et sa branche', () => {
  const item = fromAction(
    action({
      kind: 'service',
      subdir: 'apps/web',
      url: 'http://h:{port}',
      description: 'Vite',
      placement: 'branch',
      pinnedBranch: 'dev',
    }),
  )
  const state = editorStateOf({ from: item })
  assert.equal(state.kind, 'service')
  assert.equal(state.subdir, 'apps/web')
  assert.equal(state.url, 'http://h:{port}')
  assert.equal(state.description, 'Vite')
  assert.equal(state.placement, 'branch')
  assert.equal(state.pinnedBranch, 'dev')

  const scheduled = editorStateOf({
    from: fromAction(action({ onDemand: false, schedule: { cadence: NIGHTLY, enabled: true, nextRunAt: null, lastRunAt: null, maxDurationMinutes: 30 } })),
  })
  assert.equal(scheduled.onDemand, false)
  assert.equal(scheduled.scheduled, true)
  assert.deepEqual(scheduled.cadence, NIGHTLY)
  assert.equal(scheduled.stopCadence, null)
})

test('editorStateOf : from relit l’arrêt d’un service planifié', () => {
  const schedule = { cadence: NIGHTLY, enabled: true, nextRunAt: null, lastRunAt: null, maxDurationMinutes: 30, stopCadence: EVENING, nextStopAt: null }
  const state = editorStateOf({ from: fromAction(action({ kind: 'service', schedule })) })
  assert.deepEqual(state.stopCadence, EVENING)
})

test('editorStateOf : from relit une tâche d’agent entière, script compris', () => {
  const state = editorStateOf({ from: fromTask(task()) })
  assert.equal(state.what, 'agent')
  assert.equal(state.agent, 'codex')
  assert.equal(state.label, 'Revue nocturne')
  assert.equal(state.prompt, 'Passe en revue les dépendances.')
  assert.equal(state.worktreeMode, 'new')
  assert.equal(state.overlapPolicy, 'wait')
  assert.equal(state.confined, true)
  assert.equal(state.maxDuration, '45')
  assert.equal(state.checkScript, 'exit 0')
  assert.equal(state.checkTimeout, '30')
  assert.equal(state.checkEdited, false)
  assert.equal(state.scheduled, true)
  assert.deepEqual(state.config, task().config)

  const onDemandOnly = editorStateOf({ from: fromTask(task({ cadence: null })) })
  assert.equal(onDemandOnly.scheduled, false)
  assert.equal(onDemandOnly.cadence, null)
})

/* ------------------------------------------------------------------ EDI-6 … EDI-17 : les erreurs */

test('problemsOf : libellé, commande et prompt manquants', () => {
  assert.deepEqual(problemsOf(fresh()), { label: 'actionEditor.error.label', command: 'actionEditor.error.command' })
  assert.deepEqual(problemsOf(fresh({ what: 'agent', label: 'Revue' })), { prompt: 'actionEditor.error.prompt' })
  assert.deepEqual(problemsOf(fresh({ label: 'x'.repeat(61), command: 'ls' })), { label: 'actionEditor.error.labelMax' })
  // Un libellé d'espaces ne compte pas.
  assert.equal(problemsOf(fresh({ label: '   ', command: 'ls' })).label, 'actionEditor.error.label')
})

test('problemsOf : un dossier relatif, sans « .. »', () => {
  const ok = fresh({ label: 'Tests', command: 'pnpm test' })
  assert.deepEqual(problemsOf({ ...ok, subdir: 'apps/web' }), {})
  assert.equal(problemsOf({ ...ok, subdir: '/etc' }).subdir, 'actionEditor.error.subdirAbsolute')
  assert.equal(problemsOf({ ...ok, subdir: 'apps/../..' }).subdir, 'actionEditor.error.subdirParent')
  // Le dossier d'un agent n'existe pas : rien à reprocher.
  assert.equal(problemsOf({ ...ok, what: 'agent', prompt: 'p', subdir: '/etc' }).subdir, undefined)
})

test('problemsOf : le lien d’un service, {port} permis ; ignoré pour une tâche', () => {
  const service = fresh({ label: 'Dev', command: 'pnpm dev', kind: 'service' })
  assert.deepEqual(problemsOf({ ...service, url: 'http://localhost:{port}/app' }), {})
  assert.equal(problemsOf({ ...service, url: 'localhost:5173' }).url, 'actionEditor.error.url')
  assert.equal(problemsOf({ ...service, kind: 'task', url: 'pas une adresse' }).url, undefined)
})

test('problemsOf : au moins un Quand, une cadence complète', () => {
  const ok = fresh({ label: 'Tests', command: 'pnpm test' })
  assert.equal(problemsOf({ ...ok, onDemand: false }).when, 'actionEditor.error.when')
  assert.equal(problemsOf({ ...ok, scheduled: true, cadence: null }).cadence, 'actionEditor.error.cadence')
  assert.deepEqual(problemsOf({ ...ok, onDemand: false, scheduled: true, cadence: NIGHTLY }), {})
})

test('problemsOf : un service planifié demande son heure d’arrêt complète (EDI-18, AC-06)', () => {
  const service = fresh({ label: 'Dev', command: 'pnpm dev', kind: 'service', scheduled: true, cadence: NIGHTLY, stopCadence: null })
  assert.equal(problemsOf(service).stopCadence, 'actionEditor.error.stopCadence')
  assert.deepEqual(problemsOf({ ...service, stopCadence: EVENING }), {})
  // Une tâche finit seule : son arrêt ne compte pas.
  assert.equal(problemsOf({ ...service, kind: 'task' }).stopCadence, undefined)
})

test('problemsOf : une instance par worktree demande {port} dans son lien (SRV-6)', () => {
  const service = fresh({ label: 'Dev', command: 'pnpm dev', kind: 'service', placement: 'per-worktree' })
  assert.equal(problemsOf({ ...service, url: 'http://h:5173/' }).url, 'actionEditor.error.urlNeedsPort')
  assert.deepEqual(problemsOf({ ...service, url: 'http://h:{port}/' }), {})
  assert.deepEqual(problemsOf({ ...service, url: '' }), {})
  assert.deepEqual(problemsOf({ ...service, placement: 'follow', url: 'http://h:5173/' }), {})
})

test('problemsOf : « Toujours une branche » demande sa branche', () => {
  const service = fresh({ label: 'Dev', command: 'pnpm dev', kind: 'service', placement: 'branch', pinnedBranch: ' ' })
  assert.equal(problemsOf(service).branch, 'actionEditor.error.branch')
  assert.deepEqual(problemsOf({ ...service, pinnedBranch: 'dev' }), {})
  // Pour une tâche, le placement ne se règle pas.
  assert.equal(problemsOf({ ...service, kind: 'task' }).branch, undefined)
})

test('problemsOf : options d’un agent — durée et délai du script', () => {
  const agent = fresh({ what: 'agent', label: 'Revue', prompt: 'p' })
  assert.equal(problemsOf({ ...agent, maxDuration: '0' }).duration, 'actionEditor.error.duration')
  assert.equal(problemsOf({ ...agent, maxDuration: 'abc' }).duration, 'actionEditor.error.duration')
  assert.equal(problemsOf({ ...agent, checkScript: 'exit 0', checkTimeout: '0' }).checkTimeout, 'actionEditor.error.checkTimeout')
  // Un script vide vaut « pas de vérification » : son délai ne compte pas.
  assert.deepEqual(problemsOf({ ...agent, checkScript: '  ', checkTimeout: '0' }), {})
})

test('ALL_FIELDS couvre chaque problème possible', () => {
  const worst = fresh({ label: '', command: '', subdir: '/x', kind: 'service', url: 'x', onDemand: false, scheduled: true, cadence: null, placement: 'branch', pinnedBranch: '' })
  for (const field of Object.keys(problemsOf(worst))) assert.ok(ALL_FIELDS.includes(field as never), field)
  const agent = fresh({ what: 'agent', maxDuration: '0', checkScript: 'x', checkTimeout: '0' })
  for (const field of Object.keys(problemsOf(agent))) assert.ok(ALL_FIELDS.includes(field as never), field)
})

/* ------------------------------------------------------------------ Enregistrer */

test('draftFrom : une commande à la demande, champs taillés', () => {
  const draft = draftFrom(fresh({ label: ' Tests ', command: ' pnpm test ', subdir: ' apps/web ', description: ' ' }), null)
  assert.deepEqual(draft, {
    what: 'command',
    body: {
      label: 'Tests',
      kind: 'task',
      command: 'pnpm test',
      description: '',
      subdir: 'apps/web',
      url: '',
      placement: 'follow',
      pinnedBranch: null,
      onDemand: true,
      schedule: null,
    },
  })
})

test('draftFrom : un service garde son lien et son placement ; une tâche les perd', () => {
  const service = fresh({ label: 'Dev', command: 'pnpm dev', kind: 'service', url: 'http://h:{port}', placement: 'branch', pinnedBranch: 'dev' })
  const draft = draftFrom(service, null)
  assert.equal(draft.what === 'command' && draft.body.url, 'http://h:{port}')
  assert.equal(draft.what === 'command' && draft.body.placement, 'branch')
  assert.equal(draft.what === 'command' && draft.body.pinnedBranch, 'dev')
  const task = draftFrom({ ...service, kind: 'task' }, null)
  assert.equal(task.what === 'command' && task.body.url, '')
  assert.equal(task.what === 'command' && task.body.placement, 'follow')
  assert.equal(task.what === 'command' && task.body.pinnedBranch, null)
  // Une branche n'est gardée que pour « Toujours une branche ».
  const root = draftFrom({ ...service, placement: 'root' }, null)
  assert.equal(root.what === 'command' && root.body.pinnedBranch, null)
})

test('draftFrom : une commande planifiée porte sa cadence ; décochée, null pour la retirer', () => {
  const planned = draftFrom(fresh({ label: 'Purge', command: 'make purge', onDemand: false, scheduled: true, cadence: NIGHTLY, stopCadence: EVENING }), null)
  // Une tâche finit seule : son arrêt n'est pas envoyé.
  assert.deepEqual(planned.what === 'command' && planned.body.schedule, { cadence: NIGHTLY })
  assert.equal(planned.what === 'command' && planned.body.onDemand, false)
  const unplanned = draftFrom(fresh({ label: 'Purge', command: 'make purge', scheduled: false, cadence: NIGHTLY }), null)
  assert.equal(unplanned.what === 'command' && unplanned.body.schedule, null)
})

test('draftFrom : un service planifié porte son démarrage et son arrêt', () => {
  const draft = draftFrom(fresh({ label: 'Dev', command: 'pnpm dev', kind: 'service', scheduled: true, cadence: NIGHTLY, stopCadence: EVENING }), null)
  assert.deepEqual(draft.what === 'command' && draft.body.schedule, { cadence: NIGHTLY, stopCadence: EVENING })
})

test('draftFrom : un agent, sa cadence ou null, où il tourne, ses options', () => {
  const config = { agent: 'claude', model: 'opus' } as ScheduledTaskDto['config']
  const state = fresh({
    what: 'agent',
    label: ' Revue ',
    prompt: ' Relis. ',
    agent: 'claude',
    worktreeMode: 'new',
    confined: false,
    overlapPolicy: 'wait',
    maxDuration: '20',
    scheduled: true,
    cadence: NIGHTLY,
  })
  assert.deepEqual(draftFrom(state, config), {
    what: 'agent',
    body: {
      name: 'Revue',
      agent: 'claude',
      config,
      prompt: 'Relis.',
      cadence: NIGHTLY,
      onDemand: true,
      worktreeMode: 'new',
      overlapPolicy: 'wait',
      confined: false,
      maxDurationMinutes: 20,
      checkScript: null,
    },
  })
  const onDemand = draftFrom({ ...state, scheduled: false }, config)
  assert.equal(onDemand.what === 'agent' && onDemand.body.cadence, null)
})

test('draftFrom : le script d’une tâche existante ne repart que s’il a été touché', () => {
  const existing = editorStateOf({ from: fromTask(task()) })
  const untouched = draftFrom(existing, existing.config)
  assert.equal(untouched.what === 'agent' && 'checkScript' in untouched.body, false)
  assert.equal(untouched.what === 'agent' && untouched.body.checkTimeoutSeconds, 30)
  const edited = draftFrom({ ...existing, checkScript: 'exit 10', checkEdited: true }, existing.config)
  assert.equal(edited.what === 'agent' && edited.body.checkScript, 'exit 10')
  const removed = draftFrom({ ...existing, checkScript: null, checkEdited: true }, existing.config)
  assert.equal(removed.what === 'agent' && removed.body.checkScript, null)
  assert.equal(removed.what === 'agent' && 'checkTimeoutSeconds' in removed.body, false)
})

/* ------------------------------------------------------------------ EDI-2, EDI-20 : en-tête et pied */

test('headerWhen : les puces Quand de l’en-tête, en direct', () => {
  assert.deepEqual(headerWhen(fresh(), null, t), ['À la demande'])
  assert.deepEqual(headerWhen(fresh({ scheduled: true }), 'Chaque jour à 03:00', t), ['À la demande', 'Chaque jour à 03:00'])
  assert.deepEqual(headerWhen(fresh({ onDemand: false, scheduled: true }), null, t), ['Planifiée'])
  assert.deepEqual(headerWhen(fresh({ onDemand: false }), null, t), [])
})

test('summaryOf : « Commande · tâche · à la demande + Chaque jour à 03:00 »', () => {
  assert.equal(summaryOf(fresh({ scheduled: true }), 'Chaque jour à 03:00', 'Claude', t), 'Commande · tâche · à la demande + Chaque jour à 03:00')
  assert.equal(summaryOf(fresh({ kind: 'service' }), null, 'Claude', t), 'Commande · service · à la demande')
  assert.equal(summaryOf(fresh({ what: 'agent', onDemand: false, scheduled: true }), null, 'Codex', t), 'Agent · Codex · planifiée')
  assert.equal(summaryOf(fresh({ onDemand: false }), null, 'Claude', tEn), 'Command · task · never')
})

/* ------------------------------------------------------------------ EDI-9 : localhost à distance */

test('linkIsLocalOnly : localhost ne mène nulle part quand Solera est ouvert d’ailleurs', () => {
  assert.equal(linkIsLocalOnly('http://localhost:{port}', 'solera.tail1234.ts.net'), true)
  assert.equal(linkIsLocalOnly('http://127.0.0.1:5173/', '100.64.0.7'), true)
  assert.equal(linkIsLocalOnly('http://localhost:{port}', 'localhost'), false)
  assert.equal(linkIsLocalOnly('http://localhost:{port}', '127.0.0.1'), false)
  assert.equal(linkIsLocalOnly('http://devbox:{port}', 'solera.tail1234.ts.net'), false)
  assert.equal(linkIsLocalOnly('', 'solera.tail1234.ts.net'), false)
})

