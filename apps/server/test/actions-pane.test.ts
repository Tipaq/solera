import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActionSuggestion } from '@solera/protocol'
import type { Automation } from '../../web/src/lib/automations.js'

const {
  PANE_SECTIONS,
  PANE_SEARCH_FROM,
  PANE_EDIT_MIN_WIDTH,
  PANE_SUGGESTIONS,
  paneSectionsOf,
  readPaneView,
  paneShowsSearch,
  paneOffersExpand,
  paneSuggestions,
  suggestionSeed,
  signalTab,
} = await import('../../web/src/lib/actions-pane.js')

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

const DEV = item('dev', { commandKind: 'service', live: { kind: 'service', ports: [5173], since: null, href: null } })
const LINT = item('lint', { live: { kind: 'terminal', terminalId: 'term-1', since: 0 } })
const NIGHTLY = item('nightly', { schedule: SCHEDULE, live: { kind: 'terminal', terminalId: 'term-2', since: 0 } })
const TRIAGE = item('triage', { what: 'agent', commandKind: undefined, prompt: 'Trie', live: { kind: 'run', since: 0, conversationId: 'c2', checking: false } })
const MIGRATE = item('migrate', { review: { kind: 'proposed', conversationId: null, title: null } })
const BACKUP = item('backup', { schedule: SCHEDULE })
const SEED = item('seed')

const ids = (items: Automation[]) => items.map((entry) => entry.id)

test('PANE_SECTIONS : en marche, à relire, planifiées, à la demande', () => {
  assert.deepEqual(PANE_SECTIONS, ['live', 'review', 'scheduled', 'demand'])
})

test('paneSectionsOf : un service et un agent qui tournent sont « en marche »', () => {
  const sections = paneSectionsOf([DEV, TRIAGE, SEED])
  assert.deepEqual(ids(sections.live), ['dev', 'triage'])
  assert.deepEqual(ids(sections.demand), ['seed'])
})

test('paneSectionsOf : une commande dans un terminal n’est pas redite en marche, elle reste à sa place', () => {
  // Les commandes lancées ici la montrent déjà en tête ; lancée ailleurs, elle ne doit pas
  // disparaître de la liste pour autant.
  const sections = paneSectionsOf([LINT, NIGHTLY])
  assert.deepEqual(ids(sections.live), [])
  assert.deepEqual(ids(sections.demand), ['lint'])
  assert.deepEqual(ids(sections.scheduled), ['nightly'])
})

test('paneSectionsOf : chaque action dans une seule section, chaque section présente même vide', () => {
  const all = [DEV, LINT, NIGHTLY, TRIAGE, MIGRATE, BACKUP, SEED]
  const sections = paneSectionsOf(all)
  assert.deepEqual(Object.keys(sections), [...PANE_SECTIONS])
  assert.deepEqual(ids(sections.review), ['migrate'])
  assert.deepEqual(ids(sections.scheduled), ['nightly', 'backup'])
  assert.equal(Object.values(sections).flat().length, all.length)
  assert.deepEqual(paneSectionsOf([]), { live: [], review: [], scheduled: [], demand: [] })
})

test('readPaneView : la vue retenue, le Lanceur faute de mieux', () => {
  assert.equal(readPaneView(JSON.stringify('liste')), 'liste')
  assert.equal(readPaneView(JSON.stringify('agenda')), 'agenda')
  assert.equal(readPaneView(null), 'lanceur')
  assert.equal(readPaneView(JSON.stringify('tuiles')), 'lanceur', 'une vue qui n’existe plus')
  assert.equal(readPaneView('{pas du json'), 'lanceur')
})

test('paneShowsSearch : la recherche seulement au-delà de huit actions', () => {
  assert.equal(PANE_SEARCH_FROM, 8)
  assert.equal(paneShowsSearch(8), false)
  assert.equal(paneShowsSearch(9), true)
  assert.equal(paneShowsSearch(0), false)
})

test('paneOffersExpand : « Agrandir le panneau » en édition ou en choix, sous 360 px, s’il peut s’agrandir', () => {
  assert.equal(PANE_EDIT_MIN_WIDTH, 360)
  const edit = { mode: 'edit', seed: {}, back: null } as const
  const pick = { mode: 'pick' } as const
  const detail = { mode: 'detail', id: 'a-1', review: false } as const
  assert.equal(paneOffersExpand(edit, 320, true), true)
  assert.equal(paneOffersExpand(pick, 359, true), true)
  assert.equal(paneOffersExpand(edit, 360, true), false)
  assert.equal(paneOffersExpand(detail, 320, true), false, 'un détail se lit à l’étroit')
  assert.equal(paneOffersExpand(edit, 320, false), false, 'déjà plein écran')
  assert.equal(paneOffersExpand(edit, 0, true), false, 'largeur pas encore mesurée')
  assert.equal(paneOffersExpand(null, 320, true), false)
})

const suggestion = (name: string, over: Partial<ActionSuggestion> = {}): ActionSuggestion => ({
  source: 'package.json',
  name,
  kind: 'task',
  reason: 'task',
  command: `pnpm ${name}`,
  subdir: '',
  url: null,
  ...over,
})

test('paneSuggestions : les trois premières suggestions du dépôt', () => {
  assert.equal(PANE_SUGGESTIONS, 3)
  const list = ['dev', 'test', 'lint', 'build'].map((name) => suggestion(name))
  assert.deepEqual(paneSuggestions(list).map((entry) => entry.name), ['dev', 'test', 'lint'])
  assert.deepEqual(paneSuggestions(undefined), [])
})

test('suggestionSeed : l’éditeur pré-rempli, nature et dossier compris', () => {
  const seed = suggestionSeed({ label: 'Serveur de dev · web', kind: 'service', command: 'pnpm dev', subdir: 'apps/web', url: 'http://localhost:{port}' })
  assert.deepEqual(seed, {
    preset: { what: 'command', kind: 'service' },
    prefill: { label: 'Serveur de dev · web', command: 'pnpm dev', subdir: 'apps/web', url: 'http://localhost:{port}' },
  })
})

test('signalTab : les sous-agents dans Agent, les travaux de fond dans Actions', () => {
  assert.equal(signalTab('subagents'), 'agents')
  assert.equal(signalTab('background'), 'actions')
})
