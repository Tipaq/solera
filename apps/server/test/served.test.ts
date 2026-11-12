import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActionPlacement, ActionServedVersion } from '@solera/protocol'
import type { Automation } from '../../web/src/lib/automations.js'

const { runningElsewhereOf, servedByTree, servedIndex, servedName, shortBranch, switchTargets } = await import('../../web/src/lib/served.js')

const served = (over: Partial<ActionServedVersion>): ActionServedVersion => ({
  path: null, worktreeId: null, root: false, branch: null, head: null, ahead: null, behind: null, dirtyFiles: null, ...over,
})
const service = (
  id: string,
  ports: number[],
  version: ActionServedVersion | null,
  { running = true, placement = 'follow' as ActionPlacement, cwd = null as string | null, href = null as string | null } = {},
) =>
  ({
    id: `a-${id}`,
    label: `Service ${id}`,
    live: running ? { kind: 'service', ports, since: null, href } : null,
    source: { kind: 'action', action: { id, placement, service: { unit: 'u', state: running ? 'active' : 'inactive', cwd, ports, startedAt: null, served: version } } },
  }) as unknown as Automation
const tree = (key: string, over: Record<string, unknown> = {}) => ({
  key, root: false, id: null as string | null, path: key, name: key, branch: null as string | null, state: 'unmerged' as string,
  ahead: 0, behind: 0, uncommitted: 0, ...over,
})
const trees = [
  tree('root', { root: true, path: '/p', branch: 'main', state: 'root', behind: 9 }),
  tree('/w/a', { id: 'a', branch: 'feat/a', ahead: 4, behind: 1, uncommitted: 7 }),
  tree('/w/shell', { branch: 'feat/shell' }),
]

test('le service qui sert un arbre : par son worktree, sinon la racine, sinon le chemin', () => {
  const marks = servedByTree(
    [
      service('dev', [5173], served({ worktreeId: 'a', path: '/w/a' })),
      service('api', [], served({ root: true, path: '/p' })),
      service('shell', [8080, 8081], served({ path: '/w/shell' })),
      // Arrêté, ou hors du projet : rien.
      service('off', [9000], served({ worktreeId: 'a' }), { running: false }),
      service('away', [9001], served({ path: '/ailleurs' })),
    ],
    trees,
  )
  assert.deepEqual(marks.get('/w/a'), [{ automationId: 'a-dev', label: 'Service dev', port: 5173 }])
  assert.deepEqual(marks.get('root'), [{ automationId: 'a-api', label: 'Service api', port: null }])
  assert.deepEqual(marks.get('/w/shell'), [{ automationId: 'a-shell', label: 'Service shell', port: 8080 }])
  assert.equal(marks.size, 3)
})

test("ce qu'il sert : l'état git lu par le serveur, l'arbre reconnu, par action et par arbre", () => {
  const index = servedIndex(
    [
      service('dev', [5173], served({ worktreeId: 'a', path: '/w/a', branch: 'feat/a', head: 'a1b2c3d', ahead: 3, behind: 2, dirtyFiles: 1 }), {
        cwd: '/w/a/apps/web',
        href: 'http://localhost:5173/',
      }),
      service('away', [9001], served({ path: null, branch: null }), { cwd: '/ailleurs' }),
      service('off', [9000], served({ worktreeId: 'a' }), { running: false }),
    ],
    trees,
  )
  const dev = index.byAutomation.get('a-dev')
  assert.ok(dev)
  assert.equal(dev.tree?.key, '/w/a')
  assert.deepEqual(
    { actionId: dev.actionId, cwd: dev.cwd, ports: dev.ports, href: dev.href, root: dev.root, branch: dev.branch, commit: dev.commit },
    { actionId: 'dev', cwd: '/w/a/apps/web', ports: [5173], href: 'http://localhost:5173/', root: false, branch: 'feat/a', commit: 'a1b2c3d' },
  )
  // Ce que le serveur a lu dans le dossier servi l'emporte sur l'état de l'arbre.
  assert.deepEqual({ ahead: dev.ahead, behind: dev.behind, uncommitted: dev.uncommitted }, { ahead: 3, behind: 2, uncommitted: 1 })
  assert.deepEqual(index.byTree.get('/w/a')?.map((entry) => entry.automationId), ['a-dev'])
  // Hors du projet : servi quand même, sans arbre.
  assert.equal(index.byAutomation.get('a-away')?.tree, null)
  assert.equal(index.byAutomation.has('a-off'), false)
})

test("sans mesure du serveur, l'avance, le retard et les non commités sont ceux de l'arbre", () => {
  const index = servedIndex([service('dev', [], served({ worktreeId: 'a', branch: 'feat/a' }))], trees)
  const dev = index.byAutomation.get('a-dev')!
  assert.deepEqual({ ahead: dev.ahead, behind: dev.behind, uncommitted: dev.uncommitted }, { ahead: 4, behind: 1, uncommitted: 7 })
})

test('seul un service qui suit son lancement se bascule', () => {
  const index = servedIndex(
    [
      service('follow', [], served({ root: true })),
      service('root', [], served({ root: true }), { placement: 'root' }),
      service('branch', [], served({ root: true }), { placement: 'branch' }),
    ],
    trees,
  )
  assert.equal(index.byAutomation.get('a-follow')?.switchable, true)
  assert.equal(index.byAutomation.get('a-root')?.switchable, false)
  assert.equal(index.byAutomation.get('a-branch')?.switchable, false)
})

test("basculer sur : les autres arbres que Solera sait viser, ni disparus ni fusionnés, huit au plus", () => {
  const many = [
    ...trees,
    tree('/w/gone', { id: 'g', state: 'missing' }),
    tree('/w/done', { id: 'd', state: 'merged' }),
    ...Array.from({ length: 10 }, (_, i) => tree(`/w/t${i}`, { id: `t${i}`, branch: `feat/t${i}` })),
  ]
  const index = servedIndex([service('dev', [], served({ worktreeId: 'a' }))], many)
  const targets = switchTargets(many, index.byAutomation.get('a-dev')!)
  // La racine d'abord, puis les worktrees ; ni l'arbre servi, ni celui créé au shell
  // (le lancement ne vise qu'un worktree de Solera ou la racine).
  assert.deepEqual(targets.map((entry) => entry.key), ['root', ...Array.from({ length: 7 }, (_, i) => `/w/t${i}`)])
})

test('le 409 « déjà en marche ailleurs » se lit depuis ses paramètres', () => {
  const error = Object.assign(new Error('…'), {
    code: 'service_running_elsewhere',
    params: { label: 'Dev', cwd: '/w/a', worktreeId: 'a', root: '', branch: 'feat/a', head: 'a1b2c3d', dirtyFiles: 2, ports: ':5173 :5174', href: 'http://localhost:5173/' },
  })
  assert.deepEqual(runningElsewhereOf(error), {
    cwd: '/w/a', worktreeId: 'a', root: false, branch: 'feat/a', ports: [5173, 5174], href: 'http://localhost:5173/',
  })
  assert.deepEqual(
    runningElsewhereOf(Object.assign(new Error('…'), { code: 'service_running_elsewhere', params: { cwd: '/p', root: 'true', worktreeId: '', branch: '', ports: '', href: '' } })),
    { cwd: '/p', worktreeId: null, root: true, branch: null, ports: [], href: null },
  )
  assert.equal(runningElsewhereOf(Object.assign(new Error('…'), { code: 'action_not_found' })), null)
  assert.equal(runningElsewhereOf(new Error('réseau')), null)
})

test("le nom de ce qui est servi : la racine dit sa branche, une longue branche s'abrège", () => {
  const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`
  assert.equal(servedName(t, { root: true, branch: 'main' }), 'served.root{"branch":"main"}')
  assert.equal(servedName(t, { root: true, branch: null }), 'served.root{"branch":"?"}')
  assert.equal(servedName(t, { root: false, branch: 'feat/a' }), 'feat/a')
  assert.equal(servedName(t, { root: false, branch: null }), 'served.unknown')
  assert.equal(shortBranch('feat/905-une-branche-vraiment-trop-longue'), 'feat/905-une-branche-vraime…')
  assert.equal(shortBranch('feat/905-une-branche-vraime…').length, 28)
  assert.equal(shortBranch('feat/court'), 'feat/court')
})
