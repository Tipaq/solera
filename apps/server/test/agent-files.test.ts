import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatItem, EditTurn } from '../../web/src/lib/chat-fold.js'
import type { BackgroundWork } from '../../web/src/lib/background.js'
import type { MessageKey, MessageParams } from '../../web/src/lib/i18n/index.js'
import type { SubAgent } from '../../web/src/lib/subagents.js'

const { agentGroups, agentMeta, filesOf, resultOf, sessionFiles, workSeed } = await import('../../web/src/lib/agent-files.js')
const { buildBackground } = await import('../../web/src/lib/background.js')
const { emptyChatState } = await import('../../web/src/lib/chat-fold.js')
const { fr } = await import('../../web/src/lib/i18n/catalog-fr.js')
const { en } = await import('../../web/src/lib/i18n/catalog-en.js')

function translator(catalog: Record<string, string>) {
  return (key: MessageKey, params?: MessageParams) =>
    catalog[key]!.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
const t = translator(fr)
const tEn = translator(en)

const tool = (id: string, name: string, input: unknown, parent: string | null, extra: Partial<ChatItem> = {}): ChatItem => ({
  kind: 'tool', id, ts: 0, name, input, output: null, outputBytes: null, status: 'done', durationMs: 10, parentToolCallId: parent, ...extra,
}) as ChatItem
const said = (id: string, parent: string | null, ...blocks: ({ type: 'text'; text: string } | { type: 'thinking'; thinking: string })[]): ChatItem => ({
  kind: 'message', id, role: 'assistant', ts: 0, seq: 0, blocks, streamingText: '', streamingThinking: '', parentToolCallId: parent,
}) as ChatItem

const agent = (id: string, items: ChatItem[], over: Partial<SubAgent> = {}): SubAgent => ({
  id, type: 'general-purpose', description: `Agent ${id}`, status: 'done', startedAt: 0, durationMs: null, activity: null,
  items, toolCount: items.filter((item) => item.kind === 'tool').length, totalTokens: 0, parentId: null, ...over,
})

const work = (id: string, over: Partial<BackgroundWork> = {}): BackgroundWork => ({
  id, kind: 'local_bash', description: `Travail ${id}`, command: null, activity: null, lastTool: null, toolUses: 0, totalTokens: 0, ...over,
})

/* ------------------------------------------------------------------ filesOf */

test('filesOf : un fichier par chemin, dans l’ordre de sa première écriture, +/− tiré de l’entrée', () => {
  const writer = agent('a1', [
    tool('e1', 'Edit', { file_path: '/w/b.ts', old_string: 'x\ny', new_string: 'x\ny\nz' }, 'a1'),
    tool('r1', 'Read', { file_path: '/w/c.ts' }, 'a1'),
    tool('w1', 'Write', { file_path: '/w/a.ts', content: 'un\ndeux\ntrois\nquatre' }, 'a1'),
    tool('e2', 'Edit', { file_path: '/w/b.ts', old_string: 'z', new_string: '' }, 'a1'),
    tool('m1', 'MultiEdit', { file_path: '/w/d.ts', edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: 'd\ne', new_string: 'f' }] }, 'a1'),
    tool('n1', 'NotebookEdit', { notebook_path: '/w/n.ipynb', new_source: 'print(1)\nprint(2)' }, 'a1'),
  ])
  assert.deepEqual(filesOf(writer), [
    { path: '/w/b.ts', added: 3, removed: 3, passes: 2, toolCallIds: ['e1', 'e2'] },
    { path: '/w/a.ts', added: 4, removed: 0, passes: 1, toolCallIds: ['w1'] },
    { path: '/w/d.ts', added: 3, removed: 3, passes: 1, toolCallIds: ['m1'] },
    { path: '/w/n.ipynb', added: 2, removed: 0, passes: 1, toolCallIds: ['n1'] },
  ])
})

test('filesOf : un appel dont l’entrée ne dit pas le +/− le rend inconnu, sans perdre ses passes', () => {
  const patcher = agent('a1', [
    tool('e1', 'Edit', { file_path: '/w/a.ts', old_string: 'x', new_string: 'y' }, 'a1'),
    tool('p1', 'apply_patch', { input: '*** Begin Patch' }, 'a1', { presentation: { paths: ['/w/a.ts'] } } as Partial<ChatItem>),
    // Un outil MCP qui déclare écrire un chemin compte aussi.
    tool('x1', 'mcp__fs__write_file', {}, 'a1', { presentation: { paths: ['/w/z.md'] } } as Partial<ChatItem>),
  ])
  assert.deepEqual(filesOf(patcher), [
    { path: '/w/a.ts', added: null, removed: null, passes: 2, toolCallIds: ['e1', 'p1'] },
    { path: '/w/z.md', added: null, removed: null, passes: 1, toolCallIds: ['x1'] },
  ])
})

test('filesOf : les écritures d’un sous-agent imbriqué sont les siennes, pas celles du parent', () => {
  const parent = agent('a1', [
    tool('a2', 'Task', { description: 'enfant' }, 'a1'),
    tool('e9', 'Edit', { file_path: '/w/enfant.ts', old_string: '', new_string: 'x' }, 'a2'),
  ])
  assert.deepEqual(filesOf(parent), [])
})

/* ------------------------------------------------------------------ resultOf */

test('resultOf : le texte du dernier message du sous-agent, sans sa réflexion', () => {
  const done = agent('a1', [
    said('m1', 'a1', { type: 'text', text: 'Je regarde.' }),
    tool('r1', 'Read', { file_path: '/w/a.ts' }, 'a1'),
    said('m2', 'a1', { type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Trois fichiers.' }, { type: 'text', text: 'Rien d’autre.  ' }),
    said('m3', 'a1', { type: 'thinking', thinking: 'fini' }),
  ])
  assert.equal(resultOf(done), 'Trois fichiers.\n\nRien d’autre.')
})

test('resultOf : rien tant qu’il n’a rien dit, et pas les mots d’un sous-agent imbriqué', () => {
  assert.equal(resultOf(agent('a1', [tool('r1', 'Read', {}, 'a1')])), null)
  assert.equal(resultOf(agent('a1', [said('m1', 'a2', { type: 'text', text: 'enfant' })])), null)
})

/* ------------------------------------------------------------------ sessionFiles */

const turn = (id: string, files: [string, string[]][]): EditTurn => ({
  id, ts: 0, label: id, files: files.map(([path, toolCallIds]) => ({ path, action: 'modified' as const, toolCallIds })),
})

test('sessionFiles : chaque fichier rattaché à qui l’a écrit, +/− connu pour les seuls sous-agents', () => {
  const a1 = agent('a1', [
    tool('e1', 'Edit', { file_path: '/w/sub.ts', old_string: 'a', new_string: 'b\nc' }, 'a1'),
    tool('e2', 'Edit', { file_path: '/w/both.ts', old_string: 'a', new_string: 'b' }, 'a1'),
  ], { description: 'Explorer' })
  const a2 = agent('a2', [tool('e3', 'Write', { file_path: '/w/sub.ts', content: 'x' }, 'a2')], { description: 'Relire' })
  const files = sessionFiles(
    [
      turn('t1', [['/w/main.ts', ['p1', 'p2']], ['/w/sub.ts', ['e1']]]),
      turn('t2', [['/w/both.ts', ['p3', 'e2']], ['/w/sub.ts', ['e3']], ['/w/solo.ts', ['e9']]]),
    ],
    [a1, a2],
  )
  assert.deepEqual(files, [
    { path: '/w/main.ts', passes: 2, added: null, removed: null, byMain: true, agents: [] },
    // Deux sous-agents : la somme de leurs +/−.
    { path: '/w/sub.ts', passes: 2, added: 3, removed: 1, byMain: false, agents: ['a1', 'a2'] },
    // L'agent principal y a écrit : son +/− n'est pas connu, donc celui du fichier non plus.
    { path: '/w/both.ts', passes: 2, added: null, removed: null, byMain: true, agents: ['a1'] },
    // Un appel que le fil ne rattache à aucun sous-agent revient à l'agent principal.
    { path: '/w/solo.ts', passes: 1, added: null, removed: null, byMain: true, agents: [] },
  ])
})

test('sessionFiles : un seul sous-agent, son +/− ; aucun tour, aucun fichier', () => {
  const a1 = agent('a1', [tool('e1', 'Edit', { file_path: '/w/a.ts', old_string: '', new_string: 'x' }, 'a1')])
  assert.deepEqual(sessionFiles([turn('t1', [['/w/a.ts', ['e1']]])], [a1]), [
    { path: '/w/a.ts', passes: 1, added: 1, removed: 0, byMain: false, agents: ['a1'] },
  ])
  assert.deepEqual(sessionFiles([], [a1]), [])
})

/* ------------------------------------------------------------------ agentGroups */

test('agentGroups : En cours mêle sous-agents (du plus ancien) et travaux de fond ; Terminés, du plus récent', () => {
  const late = agent('late', [], { status: 'running', startedAt: 300 })
  const early = agent('early', [], { status: 'running', startedAt: 100 })
  const finished = agent('fin', [], { status: 'done', startedAt: 50 })
  const stopped = agent('stop', [], { status: 'interrupted', startedAt: 200 })
  const failed = agent('fail', [], { status: 'failed', startedAt: 150 })
  const w1 = work('w1')
  const groups = agentGroups([late, finished, early, stopped, failed], [w1])
  assert.deepEqual(groups.running.map((entry) => entry.key), ['early', 'late', 'w1'])
  assert.deepEqual(groups.running.map((entry) => entry.kind), ['agent', 'agent', 'work'])
  assert.deepEqual(groups.done.map((entry) => entry.id), ['stop', 'fail', 'fin'])
  assert.deepEqual(agentGroups([], []), { running: [], done: [] })
})

/* ------------------------------------------------------------------ agentMeta */

test('agentMeta : « 2 min · 14 outils » en cours, la durée finale une fois fini, « arrêté » sinon', () => {
  const now = 10 * 60_000
  assert.equal(agentMeta(agent('a', [], { status: 'running', startedAt: now - 2 * 60_000, toolCount: 14 }), now, t), '2 min · 14 outils')
  assert.equal(agentMeta(agent('a', [], { status: 'running', startedAt: now - 5_000, toolCount: 1 }), now, t), '5 s · 1 outil')
  assert.equal(agentMeta(agent('a', [], { status: 'done', durationMs: 90 * 60_000, toolCount: 0 }), now, t), '1 h 30')
  assert.equal(agentMeta(agent('a', [], { status: 'done', durationMs: null, toolCount: 3 }), now, t), '3 outils')
  assert.equal(agentMeta(agent('a', [], { status: 'interrupted', toolCount: 3 }), now, t), 'arrêté')
  assert.equal(agentMeta(agent('a', [], { status: 'failed', toolCount: 3 }), now, t), 'arrêté')
  assert.equal(agentMeta(agent('a', [], { status: 'running', startedAt: now - 2 * 60_000, toolCount: 14 }), now, tEn), '2 min · 14 tools')
})

/* ------------------------------------------------------------------ workSeed */

test('workSeed : « En faire une action » pré-remplit la commande, et un service quand un port se devine', () => {
  const dev = workSeed(work('w1', { description: 'Serveur de dev', command: 'pnpm exec vite --port 5418' }), 'Onglet Agent', t)
  assert.deepEqual(dev.preset, { what: 'command', kind: 'service' })
  assert.equal(dev.prefill?.command, 'pnpm exec vite --port 5418')
  assert.equal(dev.prefill?.label, 'Serveur vite')
  assert.match(dev.prefill?.description ?? '', /Onglet Agent/)

  const flow = workSeed(work('w2', { kind: 'workflow', description: 'Revue des PR' }), 'Onglet Agent', t)
  assert.deepEqual(flow.preset, { what: 'command', kind: 'task' })
  assert.equal(flow.prefill?.command, '')
  assert.equal(flow.prefill?.label, 'Revue des PR')
})

/* ------------------------------------------------------------------ buildBackground */

test('buildBackground : la commande d’un Bash lancé en fond, lue dans l’appel qui l’a lancé', () => {
  const state = emptyChatState()
  state.items = [tool('b1', 'Bash', { command: 'pnpm dev --port 5418', run_in_background: true }, null), tool('s1', 'Task', { description: 'x' }, null)]
  state.background = [{ id: 'k1', kind: 'local_bash', description: 'dev' }, { id: 'k2', kind: 'local_agent', description: 'x' }, { id: 'k3', kind: 'workflow', description: 'Revue' }]
  const task = (id: string, toolCallId: string | null) => ({
    id, toolCallId, kind: '', description: '', activity: null, lastTool: null, toolUses: 0, totalTokens: 0, durationMs: 0, unattended: true, done: false, outcome: null,
  })
  state.tasks = new Map([['k1', task('k1', 'b1')], ['k2', task('k2', 's1')], ['k3', task('k3', null)]])
  const works = buildBackground(state)
  // Le sous-agent a son fil : il n'est pas un travail de fond.
  assert.deepEqual(works.map((entry) => [entry.id, entry.command]), [['k1', 'pnpm dev --port 5418'], ['k3', null]])
})
