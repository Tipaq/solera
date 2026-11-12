import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActionServedVersion } from '@solera/protocol'
import type { Automation } from '../../web/src/lib/automations.js'

const { servedByTree } = await import('../../web/src/lib/served.js')

const served = (over: Partial<ActionServedVersion>): ActionServedVersion => ({
  path: null, worktreeId: null, root: false, branch: null, head: null, ahead: null, behind: null, dirtyFiles: null, ...over,
})
const service = (id: string, ports: number[], version: ActionServedVersion | null, running = true) =>
  ({
    id: `a-${id}`,
    label: `Service ${id}`,
    live: running ? { kind: 'service', ports, since: null, href: null } : null,
    source: { kind: 'action', action: { id, service: { unit: 'u', state: running ? 'active' : 'inactive', cwd: null, ports, startedAt: null, served: version } } },
  }) as unknown as Automation
const trees = [
  { key: 'root', root: true, id: null, path: '/p' },
  { key: '/w/a', root: false, id: 'a', path: '/w/a' },
  { key: '/w/shell', root: false, id: null, path: '/w/shell' },
]

test('le service qui sert un arbre : par son worktree, sinon la racine, sinon le chemin', () => {
  const marks = servedByTree(
    [
      service('dev', [5173], served({ worktreeId: 'a', path: '/w/a' })),
      service('api', [], served({ root: true, path: '/p' })),
      service('shell', [8080, 8081], served({ path: '/w/shell' })),
      // Arrêté, ou hors du projet : rien.
      service('off', [9000], served({ worktreeId: 'a' }), false),
      service('away', [9001], served({ path: '/ailleurs' })),
    ],
    trees,
  )
  assert.deepEqual(marks.get('/w/a'), [{ automationId: 'a-dev', label: 'Service dev', port: 5173 }])
  assert.deepEqual(marks.get('root'), [{ automationId: 'a-api', label: 'Service api', port: null }])
  assert.deepEqual(marks.get('/w/shell'), [{ automationId: 'a-shell', label: 'Service shell', port: 8080 }])
  assert.equal(marks.size, 3)
})
