import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Automation } from '../../web/src/lib/automations.js'
import type { SessionWork } from '../../web/src/lib/session-works.js'

const {
  NO_PORTFOLIO_ACTION_FILTERS,
  actionHref,
  byProject,
  listStateOf,
  newActionHref,
  panelHref,
  portfolioActionMatches,
  portfolioActionPasses,
  portfolioActionsActive,
  projectActionCounts,
  runningNow,
} = await import('../../web/src/lib/portfolio-actions.js')
const { actionsTabBadge } = await import('../../web/src/lib/actions-tab.js')
const { newActionParam, actionPanelOf } = await import('../../web/src/lib/action-panel.js')

const item = (id: string, projectId: string | null, over: Partial<Automation> = {}): Automation => ({
  id,
  projectId,
  label: id,
  description: null,
  what: 'command',
  commandKind: 'task',
  command: 'pnpm test',
  onDemand: true,
  schedule: null,
  runs: [],
  live: null,
  review: null,
  failStreak: 0,
  source: { kind: 'action', action: {} as never },
  ...over,
})

const SCHEDULE = { cadence: { kind: 'cron', expression: '0 3 * * *' }, enabled: true, nextRunAt: null } as const
const SERVICE_LIVE = { kind: 'service', ports: [5173], since: null, href: null } as const

const DEV = item('a-dev', 'atlas', { label: 'Serveur de dev', commandKind: 'service', command: 'pnpm dev', live: SERVICE_LIVE })
const LINT = item('a-lint', 'atlas', { label: 'Lint', command: 'pnpm lint' })
const BACKUP = item('a-backup', 'nimbus', { label: 'Sauvegarde', command: 'restic backup', schedule: SCHEDULE, onDemand: false })
const REVIEW = item('t-review', 'nimbus', { label: 'Revue', what: 'agent', commandKind: undefined, command: undefined, prompt: 'Relis la PR', schedule: SCHEDULE })
const ORPHAN = item('t-orphan', null, { label: 'Sans projet' })
const ALL = [DEV, LINT, BACKUP, REVIEW, ORPHAN]

const work = (id: string, over: Partial<SessionWork> = {}): SessionWork => ({
  id,
  conversationId: 'c1',
  conversationTitle: 'Refonte du panier',
  agent: 'claude',
  family: 'shell',
  description: null,
  command: 'pnpm vite --port 5418',
  startedAt: null,
  port: 5418,
  cpu: null,
  memoryBytes: null,
  stop: null,
  ...over,
})

const PROJECTS = [
  { id: 'nimbus', name: 'Nimbus' },
  { id: 'atlas', name: 'Atlas API' },
]

test('la recherche du portefeuille : libellé, commande, prompt et nom du projet (PF-32)', () => {
  assert.equal(portfolioActionMatches(DEV, 'serveur', 'Atlas API'), true)
  assert.equal(portfolioActionMatches(LINT, 'PNPM LINT', 'Atlas API'), true)
  assert.equal(portfolioActionMatches(REVIEW, 'relis', 'Nimbus'), true)
  assert.equal(portfolioActionMatches(BACKUP, 'nimb', 'Nimbus'), true)
  assert.equal(portfolioActionMatches(BACKUP, 'atlas', 'Nimbus'), false)
  assert.equal(portfolioActionMatches(BACKUP, '  ', 'Nimbus'), true)
})

test('les filtres du portefeuille : Projet, Quoi, Quand ; rien de coché laisse tout passer', () => {
  const passes = (filters: Partial<typeof NO_PORTFOLIO_ACTION_FILTERS>) =>
    ALL.filter((entry) => portfolioActionPasses(entry, { ...NO_PORTFOLIO_ACTION_FILTERS, ...filters })).map((entry) => entry.id)
  assert.deepEqual(passes({}), ['a-dev', 'a-lint', 'a-backup', 't-review', 't-orphan'])
  assert.deepEqual(passes({ projects: ['nimbus'] }), ['a-backup', 't-review'])
  assert.deepEqual(passes({ what: ['agent'] }), ['t-review'])
  assert.deepEqual(passes({ when: ['scheduled'] }), ['a-backup', 't-review'])
  // À la demande : une action qu'on lance d'un clic, planifiée ou non.
  assert.deepEqual(passes({ when: ['demand'] }), ['a-dev', 'a-lint', 't-review', 't-orphan'])
  assert.deepEqual(passes({ projects: ['atlas'], when: ['scheduled'] }), [])
})

test('le compte des filtres propres à la page : Quoi et Quand, pas les projets', () => {
  assert.equal(portfolioActionsActive(NO_PORTFOLIO_ACTION_FILTERS), 0)
  assert.equal(portfolioActionsActive({ projects: ['atlas'], what: ['agent'], when: ['demand', 'scheduled'] }), 3)
})

test('le compte par projet, en regard de sa case : les actions sans projet ne comptent pas', () => {
  assert.deepEqual([...projectActionCounts(ALL)], [['atlas', 2], ['nimbus', 2]])
})

test('le Lanceur : un groupe par projet qui a des actions, dans l’ordre des projets (PF-34)', () => {
  const groups = byProject(PROJECTS, [LINT, BACKUP, DEV, ORPHAN])
  assert.deepEqual(
    groups.map((group) => [group.project.id, group.items.map((entry) => entry.id)]),
    [['nimbus', ['a-backup']], ['atlas', ['a-lint', 'a-dev']]],
  )
  assert.deepEqual(byProject(PROJECTS, []), [])
})

test('Tourne maintenant, tous projets : les actions vivantes puis les processus des sessions, projet par projet (PF-33)', () => {
  const running = runningNow(ALL, new Map([['nimbus', [work('w1')]], ['atlas', [work('w2'), work('w3')]], ['gone', [work('w4')]]]), PROJECTS.map((project) => project.id))
  assert.deepEqual(
    running.map((entry) => [entry.kind, entry.projectId, entry.key]),
    [
      ['work', 'nimbus', 'nimbus:w1'],
      ['action', 'atlas', 'atlas:a-dev'],
      ['work', 'atlas', 'atlas:w2'],
      ['work', 'atlas', 'atlas:w3'],
    ],
  )
  // Une action à relire ne « tourne » pas : elle attend.
  const proposed = item('a-p', 'atlas', { live: SERVICE_LIVE, review: { kind: 'proposed', conversationId: null, title: null } })
  assert.deepEqual(runningNow([proposed], new Map(), ['atlas']), [])
})

test('l’état d’une ligne de la Liste : à relire, puis vivant, planifiée, en pause, à la demande (PF-35)', () => {
  assert.equal(listStateOf(DEV), 'live')
  assert.equal(listStateOf(LINT), 'demand')
  assert.equal(listStateOf(BACKUP), 'scheduled')
  assert.equal(listStateOf({ ...BACKUP, schedule: { ...SCHEDULE, enabled: false } }), 'paused')
  assert.equal(listStateOf({ ...DEV, review: { kind: 'proposed', conversationId: null, title: null } }), 'review')
})

test('les adresses : une action s’ouvre dans l’onglet Actions de son projet, une création par ?nouvelle=', () => {
  assert.equal(actionHref('atlas', DEV.id), '/p/atlas/actions?action=a-dev')
  assert.equal(newActionHref('atlas', 'service'), '/p/atlas/actions?nouvelle=service')
  assert.equal(newActionHref('atlas', 'any'), '/p/atlas/actions?nouvelle=1')
  for (const kind of ['command', 'service', 'agent', 'schedule', 'any'] as const) {
    // Le paramètre écrit se relit en la même création.
    assert.deepEqual(actionPanelOf(newActionParam(kind)), actionPanelOf(newActionParam(kind)))
    assert.notEqual(actionPanelOf(newActionParam(kind)), null)
  }
  assert.equal(newActionParam('command'), 'commande')
  assert.equal(newActionParam('schedule'), 'planifier')
})

test('le tiroir demandé depuis le portefeuille devient l’adresse de l’onglet Actions du projet (PF-34)', () => {
  assert.equal(panelHref('atlas', { mode: 'detail', id: 'a-dev', review: true }), '/p/atlas/actions?action=a-dev')
  assert.equal(panelHref('atlas', { mode: 'run', terminalId: 'x', back: 'a-lint' }), '/p/atlas/actions?action=a-lint')
  assert.equal(panelHref('atlas', { mode: 'pick' }), '/p/atlas/actions?nouvelle=planifier')
  // Modifier, planifier : l'action qui existe ; une tuile d'ajout : la nature.
  assert.equal(panelHref('atlas', { mode: 'edit', seed: { from: LINT, schedule: true }, back: null }), '/p/atlas/actions?action=a-lint')
  assert.equal(panelHref('atlas', { mode: 'edit', seed: { preset: { what: 'command', kind: 'service' } }, back: null }), '/p/atlas/actions?nouvelle=service')
  assert.equal(panelHref('atlas', { mode: 'edit', seed: { preset: { what: 'command', kind: 'task' } }, back: null }), '/p/atlas/actions?nouvelle=commande')
  assert.equal(panelHref('atlas', { mode: 'edit', seed: { preset: { what: 'agent' } }, back: null }), '/p/atlas/actions?nouvelle=agent')
  assert.equal(panelHref('atlas', { mode: 'edit', seed: {}, back: null }), '/p/atlas/actions?nouvelle=1')
})

test('le compte de l’onglet Actions : ambre « à relire » d’abord, sinon vert « en marche », rien à zéro (ACT-2)', () => {
  assert.deepEqual(actionsTabBadge({ running: 3, toReview: 2 }), { count: 2, tone: 'caution', countTitle: 'actionsTab.status.review' })
  assert.deepEqual(actionsTabBadge({ running: 3, toReview: 0 }), { count: 3, tone: 'running', countTitle: 'actionsTab.status.running' })
  assert.equal(actionsTabBadge({ running: 0, toReview: 0 }), null)
})
