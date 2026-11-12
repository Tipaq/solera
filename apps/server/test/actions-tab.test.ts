import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Automation } from '../../web/src/lib/automations.js'
import type { SessionWork } from '../../web/src/lib/session-works.js'

const {
  ACTIONS_VIEWS,
  actionsStatus,
  panelAddress,
  panelFromAddress,
  withAddress,
  filterTally,
  launcherGroupsOf,
  sectionsOf,
  toggleFilter,
  worksShown,
} = await import('../../web/src/lib/actions-tab.js')
const { NO_FILTERS } = await import('../../web/src/lib/automations.js')

const item = (id: string, over: Partial<Automation> = {}): Automation => ({
  id,
  projectId: 'p1',
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

const DEV = item('dev', { commandKind: 'service', live: SERVICE_LIVE })
const STORYBOOK = item('storybook', { commandKind: 'service' })
const LINT = item('lint')
const BACKUP = item('backup', { schedule: SCHEDULE, failStreak: 2 })
const MIGRATE = item('migrate', { review: { kind: 'proposed', conversationId: null, title: null } })
const REVIEW = item('review', { what: 'agent', commandKind: undefined, command: undefined, prompt: 'Relis', schedule: SCHEDULE, onDemand: false })
const ALL = [DEV, STORYBOOK, LINT, BACKUP, MIGRATE, REVIEW]

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

test('ACTIONS_VIEWS : Lanceur d’abord, puis Liste et Agenda', () => {
  assert.deepEqual(ACTIONS_VIEWS, ['lanceur', 'liste', 'agenda'])
})

test('actionsStatus : ce qui tourne (actions et processus des sessions), ce qui attend une relecture', () => {
  assert.deepEqual(actionsStatus(ALL, [work('w1'), work('w2')]), { running: 3, toReview: 1 })
  assert.deepEqual(actionsStatus([], []), { running: 0, toReview: 0 })
})

test('filterTally : le compte de chaque filtre, sur toutes les actions', () => {
  assert.deepEqual(filterTally(ALL), {
    what: { command: 5, agent: 1 },
    when: { demand: 5, scheduled: 2 },
    state: { live: 1, review: 1, failing: 1 },
  })
})

test('toggleFilter : coche puis décoche dans un groupe, sans toucher aux autres', () => {
  const once = toggleFilter(NO_FILTERS, 'state', 'live')
  assert.deepEqual(once, { what: [], when: [], state: ['live'] })
  const twice = toggleFilter(toggleFilter(once, 'what', 'agent'), 'state', 'live')
  assert.deepEqual(twice, { what: ['agent'], when: [], state: [] })
  assert.deepEqual(NO_FILTERS, { what: [], when: [], state: [] }, 'les filtres vides ne bougent pas')
})

test('launcherGroupsOf : services, commandes, agents, chaque groupe présent même vide', () => {
  const groups = launcherGroupsOf(ALL)
  assert.deepEqual(groups.services.map((entry) => entry.id), ['dev', 'storybook'])
  assert.deepEqual(groups.commands.map((entry) => entry.id), ['lint', 'backup', 'migrate'])
  assert.deepEqual(groups.agents.map((entry) => entry.id), ['review'])
  assert.deepEqual(launcherGroupsOf([]), { services: [], commands: [], agents: [] })
})

test('sectionsOf : chaque action dans une seule section, dans l’ordre de la Liste', () => {
  const sections = sectionsOf(ALL)
  assert.deepEqual(sections.live.map((entry) => entry.id), ['dev'])
  assert.deepEqual(sections.review.map((entry) => entry.id), ['migrate'])
  assert.deepEqual(sections.scheduled.map((entry) => entry.id), ['backup', 'review'])
  assert.deepEqual(sections.demand.map((entry) => entry.id), ['storybook', 'lint'])
})

test('worksShown : la recherche lit le libellé, la commande et le titre de la session', () => {
  const works = [work('vite'), work('tests', { command: 'pnpm vitest --watch', conversationTitle: 'Connexion lente' })]
  const label = (entry: SessionWork) => (entry.id === 'vite' ? 'Serveur vite' : 'Tests vitest en surveillance')
  assert.deepEqual(worksShown(works, NO_FILTERS, '', label).map((entry) => entry.id), ['vite', 'tests'])
  assert.deepEqual(worksShown(works, NO_FILTERS, 'SERVEUR', label).map((entry) => entry.id), ['vite'])
  assert.deepEqual(worksShown(works, NO_FILTERS, 'connexion', label).map((entry) => entry.id), ['tests'])
  assert.deepEqual(worksShown(works, NO_FILTERS, '--port 5418', label).map((entry) => entry.id), ['vite'])
})

test('worksShown : masqués dès qu’un filtre exclut les commandes à la demande en cours (PRC-6)', () => {
  const works = [work('vite')]
  const label = () => 'Serveur vite'
  assert.equal(worksShown(works, { ...NO_FILTERS, what: ['agent'] }, '', label).length, 0)
  assert.equal(worksShown(works, { ...NO_FILTERS, when: ['scheduled'] }, '', label).length, 0)
  assert.equal(worksShown(works, { ...NO_FILTERS, state: ['review'] }, '', label).length, 0)
  assert.equal(worksShown(works, { ...NO_FILTERS, state: ['live', 'review'] }, '', label).length, 1)
})

test('panelFromAddress : ?action= ouvre le détail, ?nouvelle= l’éditeur pré-réglé ou le choix', () => {
  assert.deepEqual(panelFromAddress({ action: 'a-1', nouvelle: null }), { mode: 'detail', id: 'a-1' })
  assert.deepEqual(panelFromAddress({ action: null, nouvelle: 'service' }), {
    mode: 'edit',
    seed: { preset: { what: 'command', kind: 'service' } },
    back: null,
  })
  assert.deepEqual(panelFromAddress({ action: null, nouvelle: 'planifier' }), { mode: 'pick' })
  assert.equal(panelFromAddress({ action: null, nouvelle: 'n-importe' }), null)
  assert.equal(panelFromAddress({ action: null, nouvelle: null }), null)
  // Les deux : le détail l'emporte, l'éditeur ne s'ouvre pas par-dessus.
  assert.deepEqual(panelFromAddress({ action: 'a-1', nouvelle: '1' }), { mode: 'detail', id: 'a-1' })
})

test('panelAddress : l’adresse suit le tiroir dans les deux sens (AO-7)', () => {
  assert.deepEqual(panelAddress(null, 'commande'), { action: null, nouvelle: null }, 'fermer retire les deux')
  assert.deepEqual(panelAddress({ mode: 'detail', id: 'a-1' }, 'commande'), { action: 'a-1', nouvelle: null })
  assert.deepEqual(panelAddress({ mode: 'detail', id: 'a-1', review: true }, null), { action: 'a-1', nouvelle: null })
  // Modifier, ou le passage d'une commande : l'action d'où l'on vient reste dans l'adresse.
  assert.deepEqual(panelAddress({ mode: 'edit', seed: {}, back: 'a-1' }, null), { action: 'a-1', nouvelle: null })
  assert.deepEqual(panelAddress({ mode: 'run', terminalId: 'x', back: 'a-1' }, null), { action: 'a-1', nouvelle: null })
  // Une création garde le ?nouvelle= qui l'a ouverte, sans en écrire un.
  assert.deepEqual(panelAddress({ mode: 'edit', seed: {}, back: null }, 'service'), { action: null, nouvelle: 'service' })
  assert.deepEqual(panelAddress({ mode: 'edit', seed: {}, back: null }, null), { action: null, nouvelle: null })
  assert.deepEqual(panelAddress({ mode: 'pick' }, 'planifier'), { action: null, nouvelle: 'planifier' })
})

test('withAddress : pose ou retire les deux paramètres, garde le reste (?vue=)', () => {
  const params = new URLSearchParams('vue=liste&nouvelle=1')
  assert.equal(withAddress(params, { action: 'a-1', nouvelle: null }).toString(), 'vue=liste&action=a-1')
  assert.equal(withAddress(params, { action: null, nouvelle: null }).toString(), 'vue=liste')
  assert.equal(params.toString(), 'vue=liste&nouvelle=1', 'l’adresse donnée ne bouge pas')
})
