import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActionRunDto, ProjectActionDto, ScheduledRunDto, ScheduledTaskDto, WorktreeDto } from '@solera/protocol'
import type { ActionInput, Automation, UnifiedRun } from '../../web/src/lib/automations.js'
import type { MessageKey, MessageParams } from '../../web/src/lib/i18n/index.js'

const {
  NO_FILTERS,
  RUN_VERDICTS,
  actionState,
  ago,
  automationsOf,
  byNextRun,
  cadenceText,
  draftOf,
  dueOf,
  duplicateDraft,
  failStreakOf,
  filterCount,
  formatCost,
  formatDuration,
  fromAction,
  fromTask,
  healthOf,
  inShort,
  launchTrees,
  launcherGroupOf,
  liveText,
  matchesFilters,
  matchesQuery,
  natureOf,
  natureWord,
  picksTree,
  primaryGestureOf,
  sectionOf,
  showsSessionWorks,
  stateSentence,
  verdictRuns,
  whenKind,
  whenWords,
} = await import('../../web/src/lib/automations.js')
const { en } = await import('../../web/src/lib/i18n/catalog-en.js')
const { fr } = await import('../../web/src/lib/i18n/catalog-fr.js')

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = 1_800_000_000_000

function translator(catalog: Record<string, string>) {
  return (key: MessageKey, params?: MessageParams) =>
    catalog[key]!.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
const t = translator(fr)
const tEn = translator(en)

const action = (over: Partial<ActionInput> = {}): ActionInput => ({
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
  createdAt: NOW - 30 * DAY,
  updatedAt: NOW - 30 * DAY,
  service: null,
  lastRun: null,
  runs: [],
  approved: null,
  ...over,
})

const cmdRun = (id: string, status: ActionRunDto['status'], startedAt: number, exitCode: number | null): ActionRunDto => ({
  id, actionId: 'a1', trigger: 'manual', conversationId: null, terminalId: null, cwd: '/w/p1', status, exitCode, startedAt,
  finishedAt: status === 'running' ? null : startedAt + MIN,
})

const service = (state: string, over: Partial<NonNullable<ProjectActionDto['service']>> = {}) => ({
  unit: 'solera-app-a1',
  state,
  cwd: '/w/p1',
  ports: [],
  startedAt: null,
  served: null,
  ...over,
})

const run = (status: ScheduledRunDto['status'], startedAt: number, over: Partial<ScheduledRunDto> = {}): ScheduledRunDto => ({
  id: `r-${startedAt}`,
  taskId: 't1',
  conversationId: `c-${startedAt}`,
  trigger: 'schedule',
  status,
  scheduledFor: startedAt,
  startedAt,
  finishedAt: status === 'running' || status === 'checking' ? null : startedAt + 5 * MIN,
  error: null,
  check: null,
  ...over,
})

const task = (over: Partial<ScheduledTaskDto> = {}): ScheduledTaskDto => ({
  id: 't1',
  projectId: 'p1',
  userId: 'u1',
  name: 'Revue nocturne',
  agent: 'claude',
  config: { model: 'opus' } as ScheduledTaskDto['config'],
  prompt: 'Passe en revue les dépendances.',
  cadence: { kind: 'cron', expression: '0 3 * * *' },
  executionMode: 'fresh',
  overlapPolicy: 'skip',
  confined: null,
  maxDurationMinutes: 30,
  enabled: true,
  lastRunAt: null,
  nextRunAt: NOW + 3 * HOUR,
  createdAt: NOW - 60 * DAY,
  updatedAt: NOW - DAY,
  runs: [],
  check: null,
  ...over,
})

/* ------------------------------------------------------------------ MOD-6 : ago */

test('ago : minutes (au moins une), heures, jours', () => {
  assert.equal(ago(NOW - 10_000, NOW, t), '1 min')
  assert.equal(ago(NOW - 3 * MIN, NOW, t), '3 min')
  assert.equal(ago(NOW - 2 * HOUR, NOW, t), '2 h')
  assert.equal(ago(NOW - 3 * DAY, NOW, t), '3 j')
  assert.equal(ago(NOW - 3 * DAY, NOW, tEn), '3 d')
  // Une horloge en retard ne fait pas de durée négative.
  assert.equal(ago(NOW + 5 * MIN, NOW, t), '1 min')
})

test('inShort, formatDuration, formatCost', () => {
  assert.equal(inShort(NOW - 1, NOW, t), 'maintenant')
  assert.equal(inShort(NOW + 20 * MIN, NOW, t), 'dans 20 min')
  assert.equal(inShort(NOW + 3 * HOUR, NOW, t), 'dans 3 h')
  assert.equal(inShort(NOW + 2 * DAY, NOW, tEn), 'in 2 d')
  assert.equal(formatDuration(20_000, t), '20 s')
  assert.equal(formatDuration(12 * MIN, t), '12 min')
  assert.equal(formatDuration(65 * MIN, t), '1 h 05')
  assert.equal(formatCost(null, t, 'fr'), '—')
  assert.equal(formatCost(0.004, t, 'en'), '< $0.01')
  assert.equal(formatCost(1.5, t, 'en'), '$1.50')
  assert.match(formatCost(1.5, t, 'fr'), /^1,50\s\$$/)
})

/* ------------------------------------------------------------------ MOD-2 : fromAction */

test('fromAction : une commande, toujours à la demande, jamais planifiée sans le serveur', () => {
  const item = fromAction(action({ description: 'La suite entière' }))
  assert.equal(item.id, 'a-a1')
  assert.equal(item.what, 'command')
  assert.equal(item.commandKind, 'task')
  assert.equal(item.command, 'pnpm test')
  assert.equal(item.description, 'La suite entière')
  assert.equal(item.projectId, 'p1')
  assert.equal(item.onDemand, true)
  assert.equal(item.schedule, null)
  assert.deepEqual(item.runs, [])
  assert.equal(item.live, null)
  assert.equal(item.review, null)
  assert.equal(item.failStreak, 0)
  assert.equal(item.source.kind, 'action')
})

test('fromAction : service actif → live avec ports, départ et lien résolu', () => {
  const item = fromAction(
    action({ kind: 'service', url: 'http://h:{port}/', service: service('active', { ports: [5173, 5174], startedAt: NOW - 2 * HOUR }) }),
  )
  assert.deepEqual(item.live, { kind: 'service', ports: [5173, 5174], since: NOW - 2 * HOUR, href: 'http://h:5173/' })
  assert.equal(liveText(item, NOW, t), 'service · :5173 :5174 · depuis 2 h')
})

test('fromAction : service en échec → un échec, sans live', () => {
  const item = fromAction(action({ kind: 'service', service: service('failed') }))
  assert.equal(item.live, null)
  assert.equal(item.failStreak, 1)
})

test('fromAction : tâche dont le terminal vit → live terminal', () => {
  const item = fromAction(action({ lastRun: { terminalId: 'term1', alive: true, exitCode: null, startedAt: NOW - MIN } }))
  assert.deepEqual(item.live, { kind: 'terminal', terminalId: 'term1', since: NOW - MIN })
  assert.equal(liveText(item, NOW, t), 'en cours dans un terminal du panneau')
  // Le passage qui tourne n'est pas un passage fini.
  assert.deepEqual(item.runs, [])
})

test('fromAction : sans passages du serveur, le dernier lancement fini en tient lieu', () => {
  const ok = fromAction(action({ lastRun: { terminalId: 'x', alive: false, exitCode: 0, startedAt: NOW - HOUR } }))
  assert.equal(ok.runs.length, 1)
  assert.equal(ok.runs[0]!.status, 'succeeded')
  assert.equal(ok.runs[0]!.exitCode, 0)
  const ko = fromAction(action({ lastRun: { terminalId: 'x', alive: false, exitCode: 2, startedAt: NOW - HOUR } }))
  assert.equal(ko.runs[0]!.status, 'failed')
  assert.equal(ko.failStreak, 1)
  // Un code inconnu : le daemon a redémarré pendant qu'elle tournait.
  const cut = fromAction(action({ lastRun: { terminalId: 'x', alive: false, exitCode: null, startedAt: NOW - HOUR } }))
  assert.equal(cut.runs[0]!.status, 'stopped')
  assert.equal(cut.failStreak, 0)
  // 128 + n : tuée par le signal n. Ctrl-C ou SIGTERM l'ont arrêtée, SIGSEGV l'a fait planter.
  const interrupted = fromAction(action({ lastRun: { terminalId: 'x', alive: false, exitCode: 130, startedAt: NOW - HOUR } }))
  assert.equal(interrupted.runs[0]!.status, 'stopped')
  const crashed = fromAction(action({ lastRun: { terminalId: 'x', alive: false, exitCode: 139, startedAt: NOW - HOUR } }))
  assert.equal(crashed.runs[0]!.status, 'failed')
})

test('fromAction : les passages du serveur priment, et les arrêtés ne jugent pas', () => {
  const item = fromAction(
    action({
      runs: [
        cmdRun('r3', 'failed', NOW - HOUR, 1),
        cmdRun('r2', 'stopped', NOW - 2 * HOUR, 130),
        cmdRun('r1', 'failed', NOW - 3 * HOUR, 1),
        cmdRun('r0', 'succeeded', NOW - 4 * HOUR, 0),
      ],
      lastRun: { terminalId: 'x', alive: false, exitCode: 1, startedAt: NOW - HOUR },
    }),
  )
  assert.deepEqual(item.runs.map((entry) => entry.id), ['r3', 'r2', 'r1', 'r0'])
  assert.equal(item.failStreak, 2)
})

test('fromAction : un passage planifié qui tourne sans terminal est live « run »', () => {
  const item = fromAction(
    action({
      runs: [cmdRun('r1', 'running', NOW - 4 * MIN, null)],
    }),
  )
  assert.deepEqual(item.live, { kind: 'run', since: NOW - 4 * MIN, conversationId: null, checking: false })
})

test('fromAction : cadence et à la demande, quand le serveur les donne', () => {
  const item = fromAction(
    action({ onDemand: false, schedule: { cadence: { kind: 'interval', minutes: 60 }, enabled: false, nextRunAt: null } }),
  )
  assert.equal(item.onDemand, false)
  assert.deepEqual(item.schedule, { cadence: { kind: 'interval', minutes: 60 }, enabled: false, nextRunAt: null })
})

test('fromAction : la fenêtre d’un service planifié, quand le serveur la donne', () => {
  const window = { stopCadence: { kind: 'cron' as const, expression: '0 19 * * 1-5' } }
  const item = fromAction(action({
    kind: 'service',
    schedule: { cadence: { kind: 'cron', expression: '0 8 * * 1-5' }, enabled: true, nextRunAt: null, serviceWindow: window },
  }))
  assert.deepEqual(item.schedule?.serviceWindow, window)
})

test('fromAction : proposée → à relire, avec la session ou sa disparition', () => {
  const kept = fromAction(action({ status: 'proposed', agentConversationId: 'c9', agentConversationTitle: 'Mettre en place la CI' }))
  assert.deepEqual(kept.review, { kind: 'proposed', conversationId: 'c9', title: 'Mettre en place la CI' })
  const gone = fromAction(action({ status: 'proposed', agentConversationId: null, agentConversationTitle: null }))
  assert.deepEqual(gone.review, { kind: 'proposed', conversationId: null, title: null })
  assert.equal(actionState(gone, NOW, t).text, 'À relire — proposée dans une session supprimée')
})

/* ------------------------------------------------------------------ MOD-3 : fromTask */

test('fromTask : un agent, à la demande et planifié', () => {
  const item = fromTask(task())
  assert.equal(item.id, 't-t1')
  assert.equal(item.what, 'agent')
  assert.equal(item.agent, 'claude')
  assert.equal(item.prompt, 'Passe en revue les dépendances.')
  assert.equal(item.label, 'Revue nocturne')
  assert.equal(item.onDemand, true)
  assert.deepEqual(item.schedule, { cadence: { kind: 'cron', expression: '0 3 * * *' }, enabled: true, nextRunAt: NOW + 3 * HOUR })
  assert.equal(item.source.kind, 'task')
})

test('fromTask : sans cadence (AC-04), seulement à la demande', () => {
  const item = fromTask(task({ cadence: null as unknown as ScheduledTaskDto['cadence'] }))
  assert.equal(item.schedule, null)
  assert.equal(item.onDemand, true)
})

test('fromTask : passage en cours ou en vérification → live « run » avec sa session', () => {
  const running = fromTask(task({ runs: [run('running', NOW - 7 * MIN), run('succeeded', NOW - DAY)] }))
  assert.deepEqual(running.live, { kind: 'run', since: NOW - 7 * MIN, conversationId: `c-${NOW - 7 * MIN}`, checking: false })
  assert.equal(liveText(running, NOW, t), 'passage en cours depuis 7 min')
  const checking = fromTask(task({ runs: [run('checking', NOW - MIN, { conversationId: null })] }))
  assert.equal(checking.live?.kind, 'run')
  assert.equal(checking.live?.kind === 'run' && checking.live.checking, true)
})

test('fromTask : script de vérification à valider → à relire', () => {
  const item = fromTask(task({ check: { script: 'exit 0', timeoutSeconds: 60, approved: false, proposedBy: 'c1' } }))
  assert.deepEqual(item.review, { kind: 'checkScript' })
  assert.equal(fromTask(task({ check: { script: 'exit 0', timeoutSeconds: 60, approved: true, proposedBy: null } })).review, null)
})

test('fromTask : échecs d’affilée en tête des passages jugés, sautés et en cours ignorés', () => {
  const item = fromTask(
    task({
      runs: [
        run('running', NOW - MIN),
        run('failed', NOW - HOUR),
        run('skipped', NOW - 2 * HOUR),
        run('timed_out', NOW - 3 * HOUR),
        run('succeeded', NOW - 4 * HOUR),
        run('failed', NOW - 5 * HOUR),
      ],
    }),
  )
  assert.equal(item.failStreak, 2)
  assert.deepEqual(verdictRuns(item.runs).map((entry) => entry.status), ['failed', 'timed_out', 'succeeded', 'failed'])
  assert.equal(failStreakOf(item.runs), 2)
})

/* ------------------------------------------------------------------ MOD-5 : assemblage */

test('automationsOf : actions et tâches d’un projet, ou de tous', () => {
  const actions = [action(), action({ id: 'a2', projectId: 'p2' })]
  const tasks = [task(), task({ id: 't2', projectId: null })]
  assert.deepEqual(automationsOf(actions, tasks, { projectId: 'p1' }).map((item) => item.id), ['a-a1', 't-t1'])
  assert.deepEqual(automationsOf(actions, tasks, { all: true }).map((item) => item.id), ['a-a1', 'a-a2', 't-t1', 't-t2'])
})

/* ------------------------------------------------------------------ LAN-5 : actionState */

const states: [string, Automation, { tone: string; text: string }][] = [
  ['à relire', fromAction(action({ status: 'proposed', agentConversationTitle: 'CI' })), { tone: 'review', text: 'À relire — proposée dans « CI »' }],
  ['script à valider', fromTask(task({ check: { script: 'x', timeoutSeconds: 5, approved: false, proposedBy: null } })), { tone: 'review', text: 'À relire — script de vérification à valider' }],
  [
    'service en marche',
    fromAction(action({ kind: 'service', service: service('active', { ports: [5173], startedAt: NOW - 2 * HOUR }) })),
    { tone: 'live', text: 'En marche · :5173 · depuis 2 h' },
  ],
  ['service qui démarre, sans port', fromAction(action({ kind: 'service', service: service('activating') })), { tone: 'live', text: 'En marche' }],
  ['service arrêté', fromAction(action({ kind: 'service', service: service('inactive') })), { tone: 'idle', text: 'Arrêté' }],
  ['service en échec', fromAction(action({ kind: 'service', service: service('failed') })), { tone: 'fail', text: 'Arrêté sur une erreur' }],
  [
    'commande dans un terminal',
    fromAction(action({ lastRun: { terminalId: 't', alive: true, exitCode: null, startedAt: NOW - MIN } })),
    { tone: 'live', text: 'En cours dans un terminal du panneau' },
  ],
  ['passage d’agent', fromTask(task({ runs: [run('running', NOW - 3 * MIN)] })), { tone: 'live', text: 'En cours · depuis 3 min' }],
  ['vérification', fromTask(task({ runs: [run('checking', NOW - 3 * MIN)] })), { tone: 'live', text: 'Vérification · depuis 3 min' }],
  [
    'échecs d’affilée',
    fromTask(task({ runs: [run('failed', NOW - HOUR), run('timed_out', NOW - 2 * HOUR), run('failed', NOW - 3 * HOUR)] })),
    { tone: 'fail', text: '3 échecs d’affilée' },
  ],
  ['jamais lancée', fromTask(task()), { tone: 'idle', text: 'Jamais lancée' }],
  ['réussie', fromTask(task({ runs: [run('succeeded', NOW - 3 * MIN)] })), { tone: 'idle', text: 'Réussie · il y a 3 min' }],
  [
    'échec avec code',
    fromAction(action({ lastRun: { terminalId: 't', alive: false, exitCode: 1, startedAt: NOW - 2 * HOUR } })),
    { tone: 'fail', text: 'Échec (code 1) · il y a 2 h' },
  ],
  ['échec d’agent', fromTask(task({ runs: [run('failed', NOW - HOUR), run('succeeded', NOW - DAY)] })), { tone: 'fail', text: 'Échec · il y a 1 h' }],
  ['trop longue', fromTask(task({ runs: [run('timed_out', NOW - HOUR)] })), { tone: 'fail', text: 'Trop longue · il y a 1 h' }],
  ['sautée', fromTask(task({ runs: [run('skipped', NOW - HOUR), run('succeeded', NOW - DAY)] })), { tone: 'idle', text: 'Sautée · il y a 1 h' }],
  [
    'arrêtée',
    fromAction(action({ lastRun: { terminalId: 't', alive: false, exitCode: null, startedAt: NOW - HOUR } })),
    { tone: 'idle', text: 'Arrêtée · il y a 1 h' },
  ],
]

for (const [name, item, expected] of states) {
  test(`actionState : ${name}`, () => {
    assert.deepEqual(actionState(item, NOW, t), expected)
  })
}

test('actionState : la relecture prime sur ce qui tourne', () => {
  const item = fromAction(
    action({ kind: 'service', status: 'proposed', agentConversationTitle: 'CI', service: service('active', { ports: [1] }) }),
  )
  assert.equal(actionState(item, NOW, t).tone, 'review')
})

test('actionState : en anglais', () => {
  const item = fromAction(action({ lastRun: { terminalId: 't', alive: false, exitCode: 1, startedAt: NOW - 2 * HOUR } }))
  assert.equal(actionState(item, NOW, tEn).text, 'Failed (exit 1) · 2 h ago')
})

/* ------------------------------------------------------------------ DET-1 : stateSentence */

const sentences: [string, Automation, { text: string; emphasis: string | null }][] = [
  ['à relire', fromAction(action({ status: 'proposed', agentConversationTitle: 'CI' })), { text: 'À relire avant son prochain lancement : proposée dans « CI ».', emphasis: 'review' }],
  [
    'service en marche',
    fromAction(action({ kind: 'service', service: service('active', { ports: [5173], startedAt: NOW - 2 * HOUR }) })),
    { text: 'Le service tourne — :5173 · depuis 2 h.', emphasis: null },
  ],
  ['service qui démarre', fromAction(action({ kind: 'service', service: service('activating') })), { text: 'Le service tourne.', emphasis: null }],
  ['passage en cours', fromTask(task({ runs: [run('running', NOW - 3 * MIN)] })), { text: 'Un passage est en cours : depuis 3 min.', emphasis: null }],
  [
    'terminal',
    fromAction(action({ lastRun: { terminalId: 't', alive: true, exitCode: null, startedAt: NOW - MIN } })),
    { text: 'La commande tourne dans un terminal du panneau.', emphasis: null },
  ],
  [
    'échecs d’affilée',
    fromTask(task({ runs: [run('failed', NOW - HOUR), run('failed', NOW - 2 * HOUR)] })),
    { text: '2 échecs d’affilée — dernier il y a 1 h.', emphasis: 'fail' },
  ],
  ['service arrêté', fromAction(action({ kind: 'service', service: service('inactive') })), { text: 'Le service est arrêté.', emphasis: null }],
  ['service en échec', fromAction(action({ kind: 'service', service: service('failed') })), { text: 'Le service s’est arrêté sur une erreur.', emphasis: null }],
  [
    'en pause',
    fromTask(task({ enabled: false, runs: [run('succeeded', NOW - DAY)] })),
    { text: 'Planification en pause : elle ne part qu’à la main.', emphasis: null },
  ],
  [
    'en pause, pas à la demande',
    fromAction(action({ onDemand: false, schedule: { cadence: { kind: 'interval', minutes: 60 }, enabled: false, nextRunAt: null } })),
    { text: 'Planification en pause : elle ne part plus.', emphasis: null },
  ],
  [
    'dernier réussi, avec code',
    fromAction(action({ lastRun: { terminalId: 't', alive: false, exitCode: 0, startedAt: NOW - 3 * MIN } })),
    { text: 'Dernier passage réussi il y a 3 min (code 0).', emphasis: null },
  ],
  ['dernier d’agent', fromTask(task({ runs: [run('skipped', NOW - HOUR)] })), { text: 'Dernier passage sauté il y a 1 h.', emphasis: null }],
  ['jamais', fromTask(task()), { text: 'Jamais lancée.', emphasis: null }],
]

for (const [name, item, expected] of sentences) {
  test(`stateSentence : ${name}`, () => {
    const sentence = stateSentence(item, NOW, t)
    assert.equal(sentence.text, expected.text)
    assert.equal(sentence.emphasis, expected.emphasis)
  })
}

test('stateSentence : « dernier » date le dernier échec, pas un passage sauté après lui', () => {
  const item = fromTask(task({ runs: [run('skipped', NOW - 10 * MIN), run('failed', NOW - HOUR), run('failed', NOW - 2 * HOUR)] }))
  assert.equal(stateSentence(item, NOW, t).text, '2 échecs d’affilée — dernier il y a 1 h.')
})

test('un service en échec se dit pareil sur la tuile et dans le détail', () => {
  const item = fromAction(
    action({
      kind: 'service',
      service: service('failed'),
      runs: [cmdRun('r2', 'failed', NOW - HOUR, 1), cmdRun('r1', 'failed', NOW - 2 * HOUR, 1)],
    }),
  )
  assert.equal(actionState(item, NOW, t).text, 'Arrêté sur une erreur')
  assert.equal(stateSentence(item, NOW, t).text, 'Le service s’est arrêté sur une erreur.')
})

/* ------------------------------------------------------------------ nature, quand, cadence */

test('natureOf, natureWord', () => {
  assert.deepEqual(natureOf(fromAction(action())), { what: 'command', kind: 'task', agent: undefined })
  assert.equal(natureWord(natureOf(fromAction(action({ kind: 'service' }))), t), 'Commande · service')
  assert.equal(natureWord(natureOf(fromAction(action())), t), 'Commande · tâche')
  assert.equal(natureWord(natureOf(fromTask(task())), t), 'Agent')
})

test('whenKind, whenWords, cadenceText', () => {
  const demand = fromAction(action())
  const both = fromTask(task({ cadence: { kind: 'interval', minutes: 120 } }))
  const paused = fromTask(task({ cadence: { kind: 'interval', minutes: 120 }, enabled: false }))
  const only = fromAction(action({ onDemand: false, schedule: { cadence: { kind: 'interval', minutes: 2880 }, enabled: true, nextRunAt: null } }))
  assert.equal(whenKind(demand), 'demand')
  assert.equal(whenKind(both), 'both')
  assert.equal(whenKind(only), 'scheduled')
  assert.equal(cadenceText(demand, t, 'fr'), null)
  assert.equal(cadenceText(both, t, 'fr'), 'Toutes les 2 h')
  assert.equal(cadenceText(paused, t, 'fr'), 'Toutes les 2 h (en pause)')
  assert.deepEqual(whenWords(demand, t, 'fr'), ['À la demande'])
  assert.deepEqual(whenWords(paused, t, 'fr'), ['À la demande', 'Toutes les 2 h (en pause)'])
  assert.deepEqual(whenWords(only, t, 'fr'), ['Tous les 2 j'])
  // Un motif cron passe par sa lecture humaine, un motif illisible reste tel quel.
  assert.equal(cadenceText(fromTask(task()), tEn, 'en'), 'At 03:00')
  assert.equal(cadenceText(fromTask(task({ cadence: { kind: 'cron', expression: 'nope' } })), t, 'fr'), 'nope')
})

/* ------------------------------------------------------------------ verdicts : une seule table */

test('RUN_VERDICTS couvre chaque statut d’un passage, d’agent comme de commande', () => {
  for (const status of ['checking', 'running', 'succeeded', 'failed', 'timed_out', 'skipped', 'stopped'] as const) {
    assert.ok(RUN_VERDICTS[status].label.startsWith('automation.run.'), status)
    assert.ok(fr[RUN_VERDICTS[status].label], status)
  }
  assert.equal(RUN_VERDICTS.running.live, true)
  assert.equal(RUN_VERDICTS.failed.tone, 'critical')
  assert.equal(RUN_VERDICTS.timed_out.tone, 'caution')
  assert.equal(RUN_VERDICTS.stopped.tone, 'neutral')
})

/* ------------------------------------------------------------------ AO-1/2 : filtres, sections, groupes */

const items = {
  service: fromAction(action({ id: 's', kind: 'service', label: 'Serveur de dev', command: 'pnpm dev', service: service('active') })),
  failing: fromAction(action({ id: 'f', label: 'Lint', command: 'pnpm lint', lastRun: { terminalId: 't', alive: false, exitCode: 1, startedAt: NOW - HOUR } })),
  proposed: fromAction(action({ id: 'p', label: 'Seed', command: 'pnpm seed', status: 'proposed' })),
  agent: fromTask(task({ id: 'g', name: 'Revue', prompt: 'Relis les DÉPENDANCES' })),
  pausedAgent: fromTask(task({ id: 'h', name: 'Rapport', enabled: false })),
}

test('matchesFilters : un groupe vide laisse tout passer', () => {
  for (const item of Object.values(items)) assert.equal(matchesFilters(item, NO_FILTERS), true)
})

test('matchesFilters : OU dans un groupe, ET entre groupes', () => {
  const only = (filters: Partial<typeof NO_FILTERS>) =>
    Object.entries(items)
      .filter(([, item]) => matchesFilters(item, { ...NO_FILTERS, ...filters }))
      .map(([key]) => key)
  assert.deepEqual(only({ what: ['agent'] }), ['agent', 'pausedAgent'])
  assert.deepEqual(only({ what: ['agent', 'command'] }), Object.keys(items))
  assert.deepEqual(only({ when: ['scheduled'] }), ['agent', 'pausedAgent'])
  assert.deepEqual(only({ state: ['live', 'review'] }), ['service', 'proposed'])
  assert.deepEqual(only({ state: ['failing'] }), ['failing'])
  assert.deepEqual(only({ what: ['command'], state: ['live', 'failing'] }), ['service', 'failing'])
  assert.deepEqual(only({ what: ['agent'], state: ['live'] }), [])
})

test('filterCount compte les filtres actifs', () => {
  assert.equal(filterCount(NO_FILTERS), 0)
  assert.equal(filterCount({ what: ['agent'], when: ['demand', 'scheduled'], state: [] }), 3)
})

test('matchesQuery : libellé, description, commande, prompt, sans casse', () => {
  assert.equal(matchesQuery(items.service, '  DEV '), true)
  assert.equal(matchesQuery(items.agent, 'dépendances'), true)
  assert.equal(matchesQuery(items.failing, 'lint'), true)
  assert.equal(matchesQuery(items.failing, 'seed'), false)
  assert.equal(matchesQuery(items.failing, ''), true)
})

test('showsSessionWorks : les processus des sessions sont des commandes à la demande, en cours', () => {
  assert.equal(showsSessionWorks(NO_FILTERS), true)
  assert.equal(showsSessionWorks({ ...NO_FILTERS, what: ['command'], state: ['live'] }), true)
  assert.equal(showsSessionWorks({ ...NO_FILTERS, what: ['agent'] }), false)
  assert.equal(showsSessionWorks({ ...NO_FILTERS, when: ['scheduled'] }), false)
  assert.equal(showsSessionWorks({ ...NO_FILTERS, state: ['review', 'failing'] }), false)
})

test('sectionOf : chaque action dans une seule section, ce qui tourne d’abord', () => {
  assert.equal(sectionOf(items.service), 'live')
  assert.equal(sectionOf(items.proposed), 'review')
  assert.equal(sectionOf(items.agent), 'scheduled')
  assert.equal(sectionOf(items.pausedAgent), 'scheduled')
  assert.equal(sectionOf(items.failing), 'demand')
  const runningProposed = fromAction(action({ status: 'proposed', lastRun: { terminalId: 't', alive: true, exitCode: null, startedAt: NOW } }))
  assert.equal(sectionOf(runningProposed), 'live')
})

test('launcherGroupOf : services, commandes, agents', () => {
  assert.equal(launcherGroupOf(items.service), 'services')
  assert.equal(launcherGroupOf(items.failing), 'commands')
  assert.equal(launcherGroupOf(items.agent), 'agents')
})

/* ------------------------------------------------------------------ PLF-4/7 : échéance et santé */

test('dueOf : aujourd’hui jusqu’à minuit local, 7 jours, plus tard, en pause', () => {
  const endOfToday = new Date(NOW)
  endOfToday.setHours(23, 59, 59, 999)
  const at = (nextRunAt: number | null, enabled = true) =>
    fromAction(action({ schedule: { cadence: { kind: 'interval', minutes: 60 }, enabled, nextRunAt } }))
  assert.equal(dueOf(at(endOfToday.getTime()), NOW), 'today')
  assert.equal(dueOf(at(endOfToday.getTime() + 1), NOW), endOfToday.getTime() + 1 <= NOW + 7 * DAY ? 'week' : 'later')
  assert.equal(dueOf(at(NOW + 7 * DAY), NOW), 'week')
  assert.equal(dueOf(at(NOW + 7 * DAY + 1), NOW), 'later')
  assert.equal(dueOf(at(NOW + HOUR, false), NOW), 'idle')
  assert.equal(dueOf(at(null), NOW), 'idle')
  assert.equal(dueOf(fromAction(action()), NOW), 'idle')
})

test('byNextRun : le plus proche d’abord, sans échéance à la fin', () => {
  const at = (id: string, nextRunAt: number | null) =>
    fromAction(action({ id, schedule: nextRunAt === null ? null : { cadence: { kind: 'interval', minutes: 60 }, enabled: true, nextRunAt } }))
  const sorted = [at('c', null), at('b', NOW + 2 * HOUR), at('a', NOW + HOUR)].sort(byNextRun)
  assert.deepEqual(sorted.map((item) => item.id), ['a-a', 'a-b', 'a-c'])
})

test('healthOf : taux sur les passages jugés des 30 jours, coût, dernière erreur', () => {
  const item = fromTask(
    task({
      runs: [
        run('running', NOW - MIN),
        run('failed', NOW - HOUR, { error: 'Chromium introuvable' }),
        run('skipped', NOW - 2 * HOUR, { conversationId: null }),
        run('succeeded', NOW - DAY),
        run('succeeded', NOW - 2 * DAY),
        run('failed', NOW - 40 * DAY),
      ],
    }),
  )
  const costs: Record<string, number> = { [`c-${NOW - HOUR}`]: 0.2, [`c-${NOW - DAY}`]: 0.3, [`c-${NOW - 40 * DAY}`]: 9 }
  const health = healthOf(item, (entry: UnifiedRun) => (entry.conversationId ? costs[entry.conversationId] ?? null : null), NOW)
  assert.equal(health.judged, 3)
  assert.equal(health.rate, 2 / 3)
  assert.equal(Math.round(health.cost30 * 100) / 100, 0.5)
  assert.deepEqual(health.lastFailure, { error: 'Chromium introuvable', code: null })
})

test('healthOf : la dernière erreur d’une commande se lit dans son extrait', () => {
  const failed = cmdRun('r1', 'failed', NOW - HOUR, 2)
  // La liste ne porte pas l'extrait : seuls les passages détaillés (`useActionRuns`) l'ont.
  assert.equal(healthOf(fromAction(action({ runs: [failed] })), () => null, NOW).lastFailure?.error, null)
  const item = fromAction(action({ runs: [failed] }), [
    { ...failed, excerpt: 'purge…\nfind: ‘logs/archive’: No such file or directory\nexit 2' },
  ])
  // Le passage d'une commande porte la session d'où elle est partie : son coût n'est pas le sien.
  const health = healthOf(item, () => 5, NOW)
  assert.deepEqual(health.lastFailure, { error: 'find: ‘logs/archive’: No such file or directory', code: 2 })
  assert.equal(health.rate, 0)
  assert.equal(health.cost30, null)
  assert.equal(healthOf(fromAction(action()), () => null, NOW).rate, null)
  assert.equal(healthOf(fromTask(task({ runs: [run('succeeded', NOW - HOUR)] })), () => null, NOW).lastFailure, null)
})

/* ------------------------------------------------------------------ brouillons (Q5 : la nature ne change pas) */

test('draftOf : de quoi rouvrir l’éditeur sur une action existante', () => {
  const command = draftOf(fromAction(action({ kind: 'service', subdir: 'apps/web', url: 'http://h:{port}', description: 'Vite', onDemand: true })))
  assert.deepEqual(command, {
    what: 'command',
    body: {
      label: 'Tests',
      description: 'Vite',
      kind: 'service',
      command: 'pnpm test',
      subdir: 'apps/web',
      url: 'http://h:{port}',
      placement: 'follow',
      onDemand: true,
    },
  })
  // Où il tourne, sa branche et sa cadence suivent : « Dupliquer » les garde.
  const pinned = draftOf(fromAction(action({ kind: 'service', placement: 'branch', pinnedBranch: 'dev', onDemand: true })))
  assert.equal(pinned.what === 'command' && pinned.body.pinnedBranch, 'dev')
  const planned = draftOf(
    fromAction(action({ onDemand: false, schedule: { cadence: { kind: 'cron', expression: '0 3 * * *' }, enabled: true, nextRunAt: null, lastRunAt: null, maxDurationMinutes: 20 } as ActionInput['schedule'] })),
  )
  assert.deepEqual(planned.what === 'command' && planned.body.schedule, { cadence: { kind: 'cron', expression: '0 3 * * *' }, maxDurationMinutes: 20 })
  assert.equal(planned.what === 'command' && planned.body.onDemand, false)
  const agent = draftOf(fromTask(task({ check: { script: 'exit 0', timeoutSeconds: 60, approved: true, proposedBy: null } })))
  assert.equal(agent.what, 'agent')
  assert.equal(agent.what === 'agent' && agent.body.checkScript, 'exit 0')
  assert.equal(agent.what === 'agent' && agent.body.name, 'Revue nocturne')
})

test('duplicateDraft : même nature, libellé « (copie) »', () => {
  const copy = duplicateDraft(fromAction(action()), t)
  assert.equal(copy.what === 'command' && copy.body.label, 'Tests (copie)')
  const agent = duplicateDraft(fromTask(task()), tEn)
  assert.equal(agent.what === 'agent' && agent.body.name, 'Revue nocturne (copy)')
})

/* ------------------------------------------------------------------ LAN-7, LAN-9 : les gestes */

test('primaryGestureOf : un seul geste principal, dans l’ordre de LAN-7', () => {
  const proposed = fromAction(action({ kind: 'service', status: 'proposed', service: service('active', { ports: [5173] }) }))
  assert.equal(primaryGestureOf(proposed), 'review')
  assert.equal(primaryGestureOf(fromTask(task({ check: { script: 'test -f out', approved: false, timeoutSeconds: 60 } as ScheduledTaskDto['check'] }))), 'review')
  // Un service a son interrupteur, qu'il tourne ou non.
  assert.equal(primaryGestureOf(fromAction(action({ kind: 'service', service: service('active') }))), 'switch')
  assert.equal(primaryGestureOf(fromAction(action({ kind: 'service', service: service('inactive') }))), 'switch')
  assert.equal(
    primaryGestureOf(fromAction(action({ lastRun: { terminalId: 'term1', alive: true, exitCode: null, startedAt: NOW - MIN } }))),
    'terminal',
  )
  assert.equal(primaryGestureOf(fromTask(task({ runs: [run('running', NOW - MIN)] }))), 'session')
  // Un passage sans session à rejoindre (une commande planifiée) se relance.
  assert.equal(primaryGestureOf(fromAction(action({ runs: [cmdRun('x1', 'running', NOW - MIN, null)] }))), 'launch')
  assert.equal(primaryGestureOf(fromAction(action())), 'launch')
  assert.equal(primaryGestureOf(fromTask(task())), 'launch')
})

test('picksTree : seule une commande choisit son arbre (Q6)', () => {
  assert.equal(picksTree(fromAction(action())), true)
  assert.equal(picksTree(fromAction(action({ kind: 'service' }))), true)
  // Une tâche d’agent dit elle-même où elle tourne (racine ou nouveau worktree).
  assert.equal(picksTree(fromTask(task())), false)
})

test('launchTrees : les arbres présents sur le disque, six au plus', () => {
  const tree = (id: string, present = true): WorktreeDto => ({
    id, projectId: 'p1', name: `feat/${id}`, path: `/w/${id}`, baseRef: 'main', createdAt: NOW, conversationCount: 0,
    git: present ? ({} as WorktreeDto['git']) : null,
  })
  assert.deepEqual(launchTrees(undefined), [])
  assert.deepEqual(launchTrees([tree('a'), tree('gone', false), tree('b')]).map((entry) => entry.id), ['a', 'b'])
  assert.equal(launchTrees(Array.from({ length: 9 }, (_, i) => tree(`t${i}`))).length, 6)
})
