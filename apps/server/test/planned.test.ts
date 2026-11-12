import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ScheduledTaskDto, ScheduleScope } from '@solera/protocol'
import type { Automation, UnifiedRun } from '../../web/src/lib/automations.js'
import type { MessageKey, MessageParams } from '../../web/src/lib/i18n/index.js'
import type { PlannedItem, ScopeProject } from '../../web/src/lib/planned.js'

const {
  NO_PLANNED_FILTERS,
  editorTargets,
  fitTarget,
  defaultTarget,
  groupByDue,
  groupByScope,
  healthMotive,
  healthSectionOf,
  healthSummary,
  launchWhere,
  matchesPlanned,
  matchesPlannedQuery,
  plannedFilterCount,
  plannedGestureOf,
  plannedOf,
  plannedState,
  plannedTally,
  scopeKey,
  scopeLabel,
  scopeOptions,
  targetFromValue,
  targetOf,
  targetOfItem,
  targetValue,
  togglePlanned,
} = await import('../../web/src/lib/planned.js')
const { en } = await import('../../web/src/lib/i18n/catalog-en.js')
const { fr } = await import('../../web/src/lib/i18n/catalog-fr.js')

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
// Un mercredi à 10 h, heure locale : il reste de la journée, et la semaine déborde.
const NOW = new Date(2027, 0, 13, 10, 0, 0).getTime()

function translator(catalog: Record<string, string>) {
  return (key: MessageKey, params?: MessageParams) =>
    catalog[key]!.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
const t = translator(fr)
const tEn = translator(en)

const ATLAS: ScopeProject = { id: 'p-atlas', name: 'Atlas API', image: null, color: '#22d3ee' }
const NIMBUS: ScopeProject = { id: 'p-nimbus', name: 'Nimbus', image: null, color: '#a78bfa' }
const PROJECTS = [NIMBUS, ATLAS]

const schedule = (nextRunAt: number | null, enabled = true) =>
  ({ cadence: { kind: 'cron', expression: '0 3 * * *' }, enabled, nextRunAt: enabled ? nextRunAt : null }) as const

const run = (status: UnifiedRun['status'], startedAt: number, over: Partial<UnifiedRun> = {}): UnifiedRun => ({
  id: `r-${startedAt}`,
  status,
  startedAt,
  finishedAt: status === 'running' ? null : startedAt + 5 * MIN,
  conversationId: `c-${startedAt}`,
  ...over,
})

/** Une tâche d'agent, dans sa portée. */
const agent = (id: string, scope: ScheduleScope, projectId: string | null, over: Partial<Automation> = {}): Automation => ({
  id: `t-${id}`,
  projectId,
  label: id,
  description: null,
  what: 'agent',
  agent: 'claude',
  prompt: `Prompt de ${id}`,
  onDemand: true,
  schedule: schedule(NOW + 3 * HOUR),
  runs: [],
  live: null,
  review: null,
  failStreak: 0,
  source: { kind: 'task', task: { id, scope, projectId } as ScheduledTaskDto },
  ...over,
})

/** Une commande de projet. */
const command = (id: string, projectId: string, over: Partial<Automation> = {}): Automation => ({
  id: `a-${id}`,
  projectId,
  label: id,
  description: null,
  what: 'command',
  commandKind: 'task',
  command: `./scripts/${id}.sh`,
  onDemand: true,
  schedule: null,
  runs: [],
  live: null,
  review: null,
  failStreak: 0,
  source: { kind: 'action', action: {} as never },
  ...over,
})

const REVIEW = agent('revue', 'project', ATLAS.id)
const BACKUP = command('backup', NIMBUS.id, { schedule: schedule(NOW + 2 * DAY), failStreak: 2 })
const LINT = command('lint', ATLAS.id)
const NOTES = agent('notes', 'vault', null, { schedule: schedule(NOW + 10 * DAY) })
const CLEAN = agent('clean', 'instance', null, { schedule: schedule(null, false) })
const LOOSE = agent('loose', 'none', null, { schedule: null })

/* ------------------------------------------------------------------ portées */

test('plannedOf : ce qui a une cadence, et toute tâche hors projet, avec sa portée', () => {
  const planned = plannedOf([REVIEW, BACKUP, LINT, NOTES, CLEAN, LOOSE], PROJECTS)
  // Une commande à la demande d'un projet reste dans son onglet Actions ; une tâche sans
  // projet n'a que cette page.
  assert.deepEqual(planned.map((item) => item.id), ['t-revue', 'a-backup', 't-notes', 't-clean', 't-loose'])
  const byId = new Map(planned.map((item) => [item.id, item.scope]))
  assert.deepEqual(byId.get('t-revue'), { kind: 'project', projectId: ATLAS.id, project: ATLAS })
  assert.deepEqual(byId.get('a-backup'), { kind: 'project', projectId: NIMBUS.id, project: NIMBUS })
  assert.deepEqual(byId.get('t-notes'), { kind: 'vault' })
  assert.deepEqual(byId.get('t-clean'), { kind: 'instance' })
  assert.deepEqual(byId.get('t-loose'), { kind: 'none' })
})

test('plannedOf : un projet qu’on ne voit plus garde sa portée, sans nom', () => {
  const [item] = plannedOf([agent('orpheline', 'project', 'p-gone')], PROJECTS)
  assert.deepEqual(item!.scope, { kind: 'project', projectId: 'p-gone', project: null })
  assert.equal(scopeLabel(item!.scope, t), 'Projet inconnu')
})

test('scopeKey, scopeLabel : le projet par son id, les autres par leur nature', () => {
  const [revue, , notes, clean, loose] = plannedOf([REVIEW, BACKUP, NOTES, CLEAN, LOOSE], PROJECTS)
  assert.equal(scopeKey(revue!.scope), ATLAS.id)
  assert.equal(scopeKey(notes!.scope), 'vault')
  assert.deepEqual([revue, notes, clean, loose].map((item) => scopeLabel(item!.scope, t)), ['Atlas API', 'Savoir', 'Instance', 'Sans projet'])
  assert.deepEqual([notes, clean, loose].map((item) => scopeLabel(item!.scope, tEn)), ['Knowledge', 'Instance', 'No project'])
})

test('scopeOptions : les projets par nom, puis Savoir, Instance, Sans projet, avec leur compte', () => {
  const planned = plannedOf([LOOSE, CLEAN, NOTES, BACKUP, REVIEW, agent('revue-2', 'project', ATLAS.id)], PROJECTS)
  assert.deepEqual(
    scopeOptions(planned, t).map((option) => [option.key, option.count]),
    [[ATLAS.id, 2], [NIMBUS.id, 1], ['vault', 1], ['instance', 1], ['none', 1]],
  )
})

/* ------------------------------------------------------------------ filtres (PLF-2) */

const PLANNED = plannedOf(
  [
    REVIEW,
    BACKUP,
    NOTES,
    CLEAN,
    LOOSE,
    agent('script', 'project', NIMBUS.id, { review: { kind: 'checkScript' }, schedule: schedule(NOW + HOUR) }),
  ],
  PROJECTS,
)
const ids = (items: readonly PlannedItem[]) => items.map((item) => item.id)
const only = (filters: Partial<typeof NO_PLANNED_FILTERS>) =>
  ids(PLANNED.filter((item) => matchesPlanned(item, { ...NO_PLANNED_FILTERS, ...filters }, NOW)))

test('matchesPlanned : rien de coché, tout passe', () => {
  assert.equal(only({}).length, PLANNED.length)
})

test('matchesPlanned : portée, OU dans le groupe', () => {
  assert.deepEqual(only({ scopes: [NIMBUS.id] }), ['a-backup', 't-script'])
  assert.deepEqual(only({ scopes: ['vault', 'none'] }), ['t-notes', 't-loose'])
})

test('matchesPlanned : quoi, état, et ET entre les groupes', () => {
  assert.deepEqual(only({ what: ['command'] }), ['a-backup'])
  assert.deepEqual(only({ state: ['paused'] }), ['t-clean'])
  assert.deepEqual(only({ state: ['failing', 'review'] }), ['a-backup', 't-script'])
  // Une tâche hors projet sans cadence n'est ni active ni en pause.
  assert.deepEqual(only({ state: ['active'] }), ['t-revue', 'a-backup', 't-notes', 't-script'])
  assert.deepEqual(only({ scopes: [NIMBUS.id], what: ['agent'] }), ['t-script'])
})

test('matchesPlanned : prochain passage, aujourd’hui ou sous sept jours', () => {
  assert.deepEqual(only({ next: 'today' }), ['t-revue', 't-script'])
  assert.deepEqual(only({ next: 'week' }), ['t-revue', 'a-backup', 't-script'])
})

test('plannedFilterCount, togglePlanned', () => {
  const once = togglePlanned(NO_PLANNED_FILTERS, 'scopes', 'vault')
  assert.deepEqual(once.scopes, ['vault'])
  assert.deepEqual(togglePlanned(once, 'scopes', 'vault').scopes, [])
  assert.equal(plannedFilterCount({ ...once, state: ['failing'], next: 'today' }), 3)
  assert.equal(plannedFilterCount(NO_PLANNED_FILTERS), 0)
})

test('matchesPlannedQuery : libellé, prompt, commande et nom de la portée', () => {
  const find = (query: string) => ids(PLANNED.filter((item) => matchesPlannedQuery(item, query, t)))
  assert.deepEqual(find('  '), ids(PLANNED))
  assert.deepEqual(find('BACKUP.sh'), ['a-backup'])
  assert.deepEqual(find('prompt de notes'), ['t-notes'])
  assert.deepEqual(find('savoir'), ['t-notes'])
  assert.deepEqual(find('nimbus'), ['a-backup', 't-script'])
})

test('plannedTally : le compte de chaque entrée de Filtrer, sur toutes les tâches', () => {
  assert.deepEqual(plannedTally(PLANNED), {
    what: { agent: 5, command: 1 },
    state: { active: 4, paused: 1, failing: 1, review: 1 },
  })
})

/* ------------------------------------------------------------------ Lanceur (PLF-4) */

test('groupByDue : aujourd’hui, cette semaine, plus tard, en pause, à la demande ; par prochain passage', () => {
  const groups = groupByDue(PLANNED, NOW)
  assert.deepEqual(ids(groups.today), ['t-script', 't-revue'])
  assert.deepEqual(ids(groups.week), ['a-backup'])
  assert.deepEqual(ids(groups.later), ['t-notes'])
  assert.deepEqual(ids(groups.idle), ['t-clean'])
  assert.deepEqual(ids(groups.demand), ['t-loose'])
})

test('groupByScope : dans l’ordre des portées, par prochain passage', () => {
  const groups = groupByScope(PLANNED, scopeOptions(PLANNED, t))
  assert.deepEqual(
    groups.map((group) => [group.key, ids(group.items)]),
    [
      [ATLAS.id, ['t-revue']],
      [NIMBUS.id, ['t-script', 'a-backup']],
      ['vault', ['t-notes']],
      ['instance', ['t-clean']],
      ['none', ['t-loose']],
    ],
  )
})

/* ------------------------------------------------------------------ la tuile (PLF-5) */

const state = (over: Partial<Automation>, tr = t) => plannedState(plannedOf([agent('x', 'vault', null, over)], [])[0]!, NOW, tr)

test('plannedState : ce qui vient, puis ce qui s’est passé', () => {
  assert.deepEqual(state({ runs: [run('succeeded', NOW - 6 * HOUR)] }), { tone: 'idle', text: 'Prochain dans 3 h · dernier ✓ il y a 6 h' })
  assert.deepEqual(state({}), { tone: 'idle', text: 'Prochain dans 3 h · jamais lancée' })
  assert.deepEqual(state({ runs: [run('failed', NOW - HOUR)], failStreak: 1 }), { tone: 'fail', text: 'Prochain dans 3 h · dernier ✗ il y a 1 h' })
  assert.deepEqual(state({ schedule: schedule(null) }), { tone: 'idle', text: 'Pas de prochain passage · jamais lancée' })
  assert.deepEqual(state({ runs: [run('succeeded', NOW - 6 * HOUR)] }, tEn), { tone: 'idle', text: 'Next in 3 h · last ✓ 6 h ago' })
})

test('plannedState : un passage sauté ne dit rien du dernier verdict', () => {
  assert.equal(
    state({ runs: [run('skipped', NOW - HOUR), run('succeeded', NOW - 2 * DAY)] }).text,
    'Prochain dans 3 h · dernier ✓ il y a 2 j',
  )
})

test('plannedState : à relire, en cours, échecs d’affilée, en pause, à la demande', () => {
  assert.deepEqual(state({ review: { kind: 'checkScript' } }), { tone: 'review', text: 'À relire — script de vérification à valider' })
  assert.deepEqual(state({ live: { kind: 'run', since: NOW - 3 * MIN, conversationId: 'c1', checking: false } }), {
    tone: 'live',
    text: 'En cours · depuis 3 min',
  })
  assert.deepEqual(state({ failStreak: 3, runs: [run('failed', NOW - HOUR)] }), { tone: 'fail', text: '3 échecs d’affilée · dernier ✗ il y a 1 h' })
  assert.deepEqual(state({ schedule: schedule(null, false), runs: [run('succeeded', NOW - DAY)] }), { tone: 'idle', text: 'En pause · dernier ✓ il y a 1 j' })
  assert.deepEqual(state({ schedule: null }), { tone: 'idle', text: 'À la demande · jamais lancée' })
})

test('plannedGestureOf : relire, rejoindre la session, reprendre, sinon lancer maintenant', () => {
  const gesture = (over: Partial<Automation>) => plannedGestureOf(plannedOf([agent('x', 'vault', null, over)], [])[0]!)
  assert.equal(gesture({ review: { kind: 'checkScript' } }), 'review')
  assert.equal(gesture({ live: { kind: 'run', since: NOW, conversationId: 'c1', checking: false } }), 'session')
  // Un passage sans session à rejoindre (la vérification tourne) : rien à rejoindre, on lance.
  assert.equal(gesture({ live: { kind: 'run', since: NOW, conversationId: null, checking: true } }), 'launch')
  assert.equal(gesture({ schedule: schedule(null, false) }), 'resume')
  assert.equal(gesture({}), 'launch')
  assert.equal(gesture({ schedule: null }), 'launch')
})

test('launchWhere : où part un lancement à la main (PLF-9)', () => {
  const [revue, , notes, clean, loose] = PLANNED
  assert.deepEqual(
    [revue, notes, clean, loose].map((item) => launchWhere(item!.scope, t)),
    ['à la racine de Atlas API', 'dans le vault', 'sur l’instance', 'hors projet'],
  )
})

/* ------------------------------------------------------------------ Liste (PLF-7) */

const cost = (run: UnifiedRun) => (run.conversationId ? 0.5 : null)

test('healthSectionOf : à regarder, en bonne santé, en pause', () => {
  const section = (id: string) => healthSectionOf(PLANNED.find((item) => item.id === id)!)
  assert.equal(section('a-backup'), 'watch')
  assert.equal(section('t-script'), 'watch')
  assert.equal(section('t-revue'), 'healthy')
  assert.equal(section('t-loose'), 'healthy')
  assert.equal(section('t-clean'), 'paused')
})

test('healthSummary : réussite pondérée par passages jugés, échecs, coût et prochain passage', () => {
  const items = plannedOf(
    [
      agent('a', 'vault', null, { runs: [run('succeeded', NOW - HOUR), run('succeeded', NOW - DAY), run('failed', NOW - 2 * DAY)] }),
      agent('b', 'vault', null, {
        failStreak: 1,
        schedule: schedule(NOW + HOUR),
        runs: [run('failed', NOW - HOUR), run('skipped', NOW - 2 * HOUR), run('succeeded', NOW - 40 * DAY)],
      }),
      command('c', ATLAS.id, { schedule: schedule(null, false), runs: [run('succeeded', NOW - HOUR, { conversationId: null })] }),
    ],
    PROJECTS,
  )
  const summary = healthSummary(items, cost, NOW)
  // 3 réussis sur 5 jugés en 30 jours ; le sauté et le vieux ne comptent pas.
  assert.equal(summary.rate, 3 / 5)
  assert.equal(summary.failing, 1)
  // Les sessions des passages d'agent des 30 jours, sautés compris : 3 + 2.
  assert.equal(summary.cost, 2.5)
  assert.equal(summary.next, NOW + HOUR)
  assert.deepEqual(healthSummary([], cost, NOW), { rate: null, failing: 0, cost: 0, next: null })
})

test('healthMotive : le motif sous le nom, rien pour une tâche en bonne santé', () => {
  const [item] = plannedOf([agent('x', 'vault', null, { failStreak: 2, runs: [run('failed', NOW - HOUR, { error: 'Chromium introuvable' }), run('failed', NOW - DAY)] })], [])
  assert.equal(healthMotive(item!, NOW, t), '2 échecs d’affilée — Chromium introuvable')
  const [one] = plannedOf([command('y', ATLAS.id, { schedule: schedule(NOW), failStreak: 1, runs: [run('failed', NOW - HOUR, { exitCode: 3, conversationId: null })] })], PROJECTS)
  assert.equal(healthMotive(one!, NOW, t), '1 échec d’affilée — code 3')
  const [bare] = plannedOf([agent('z', 'vault', null, { failStreak: 1, runs: [run('timed_out', NOW - HOUR)] })], [])
  assert.equal(healthMotive(bare!, NOW, tEn), '1 failure in a row — see the last run')
  const [script] = plannedOf([agent('s', 'vault', null, { review: { kind: 'checkScript' } })], [])
  assert.equal(healthMotive(script!, NOW, t), 'Script de vérification à relire : les passages sont écartés.')
  assert.equal(healthMotive(PLANNED[0]!, NOW, t), null)
})

/* ------------------------------------------------------------------ le champ Portée (PLF-10) */

test('targetOf, targetValue, targetFromValue : aller et retour', () => {
  const [revue, , notes, clean, loose] = PLANNED
  const targets = [revue, notes, clean, loose].map((item) => targetOf(item!.scope))
  assert.deepEqual(targets, [{ scope: 'project', projectId: ATLAS.id }, { scope: 'vault' }, { scope: 'instance' }, { scope: 'none' }])
  for (const target of targets) assert.deepEqual(targetFromValue(targetValue(target)), target)
  assert.equal(targetFromValue('n’importe quoi'), null)
  assert.deepEqual([REVIEW, BACKUP, NOTES, CLEAN, LOOSE].map(targetOfItem), [
    { scope: 'project', projectId: ATLAS.id },
    { scope: 'project', projectId: NIMBUS.id },
    { scope: 'vault' },
    { scope: 'instance' },
    { scope: 'none' },
  ])
})

test('editorTargets : les projets, puis Savoir, Instance (administrateurs), Sans projet', () => {
  const values = (admin: boolean) => editorTargets(PROJECTS, { admin, what: 'agent', vault: true }).map((option) => option.value)
  assert.deepEqual(values(true), [`project:${ATLAS.id}`, `project:${NIMBUS.id}`, 'vault', 'instance', 'none'])
  assert.deepEqual(values(false), [`project:${ATLAS.id}`, `project:${NIMBUS.id}`, 'vault', 'none'])
  assert.ok(editorTargets(PROJECTS, { admin: true, what: 'agent', vault: true }).every((option) => option.closed === null))
  // Une commande tourne dans un projet : le reste lui est fermé.
  const commandTargets = editorTargets(PROJECTS, { admin: true, what: 'command', vault: true })
  assert.deepEqual(
    commandTargets.filter((option) => option.closed).map((option) => [option.value, option.closed]),
    [['vault', 'commandOnly'], ['instance', 'commandOnly'], ['none', 'commandOnly']],
  )
  // Sans vault configuré, le Savoir n'a pas de dossier où tourner.
  const noVault = editorTargets(PROJECTS, { admin: true, what: 'agent', vault: false })
  assert.equal(noVault.find((option) => option.value === 'vault')!.closed, 'noVault')
})

test('defaultTarget : le premier projet par nom, sinon le Savoir, sinon sans projet', () => {
  assert.deepEqual(defaultTarget(PROJECTS, { vault: true }), { scope: 'project', projectId: ATLAS.id })
  assert.deepEqual(defaultTarget([], { vault: true }), { scope: 'vault' })
  assert.deepEqual(defaultTarget([], { vault: false }), { scope: 'none' })
})

test('fitTarget : une commande ramenée au premier projet, un agent garde sa portée', () => {
  assert.deepEqual(fitTarget({ scope: 'vault' }, 'command', PROJECTS), { scope: 'project', projectId: ATLAS.id })
  assert.deepEqual(fitTarget({ scope: 'project', projectId: NIMBUS.id }, 'command', PROJECTS), { scope: 'project', projectId: NIMBUS.id })
  assert.deepEqual(fitTarget({ scope: 'vault' }, 'agent', PROJECTS), { scope: 'vault' })
  // Sans projet où la mettre, la portée reste : l'éditeur dit pourquoi on ne peut pas l'enregistrer.
  assert.deepEqual(fitTarget({ scope: 'none' }, 'command', []), { scope: 'none' })
})
