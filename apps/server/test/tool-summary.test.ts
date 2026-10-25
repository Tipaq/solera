import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countTextChanges, soleraEventSchema, toolPresentation, type SoleraEvent } from '@solera/protocol'
import type { ThreadItem } from '@solera/codex-bindings/v2'
import { applyEvent, emptyChatState, type ToolItem } from '@solera/protocol/chat-state'
import { describeTool as opencodeTool } from '../src/agents/opencode/tools.js'
import { describeTool as grokTool } from '../src/agents/grok/tools.js'
import { startedItem, completedItem } from '../src/agents/codex/item-events.js'

// Hors navigateur, les catalogues restent sur l'anglais, la langue de repli.
const { toolSummary } = await import('../../web/src/lib/tool-summary.js')
const { toolEdits } = await import('../../web/src/lib/tool-edits.js')
const { toolWebInput } = await import('../../web/src/lib/tool-web-input.js')
const { outputText } = await import('../../web/src/lib/tool-payload.js')

const tool = (name: string, input: unknown, output: unknown = null): ToolItem => ({
  kind: 'tool', id: 'call', ts: 0, name, input, output, outputBytes: null, status: 'done', durationMs: 10, parentToolCallId: null,
})
const fold = (events: SoleraEvent[]) => events.reduce((state, event, i) => applyEvent(state, i + 1, i, event), emptyChatState())
  .items.find((item): item is ToolItem => item.kind === 'tool')!

const before = 'garde\nancien\nfin\n'
const after = 'garde\nneuf\nen plus\nfin\n'

test('outils : une édition de Claude, d’OpenCode ou de Grok donne le même chemin et le même compte de lignes', () => {
  for (const entry of [
    { name: 'Edit', input: { file_path: 'src/a.ts', old_string: before, new_string: after } },
    opencodeTool('edit', { filePath: 'src/a.ts', oldString: before, newString: after }, []),
    grokTool('search_replace', { variant: 'SearchReplace', path: 'src/a.ts', old_string: before, new_string: after }),
  ]) {
    const item = tool(entry.name, entry.input)
    assert.equal(toolSummary(item)?.text, 'src/a.ts')
    assert.deepEqual(toolEdits(item)?.counts, { added: 2, removed: 1 })
    assert.equal(toolEdits(item)?.scope, 'fragment')
  }
  assert.equal(toolEdits(tool('Edit', { file_path: 'a', old_string: before, new_string: after, replace_all: true }))?.scope, 'replacement')
})

test('outils : les changements définitifs de Codex survivent au rejeu sans notification de patch intermédiaire', () => {
  const changes = [
    { path: 'modifie.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1,3 +1,4 @@\n garde\n-ancien\n+neuf\n+en plus\n fin' },
    { path: 'ajoute.ts', kind: { type: 'add' }, diff: 'un\ndeux\n' },
    { path: 'supprime.ts', kind: { type: 'delete' }, diff: 'un\n' },
  ]
  const start = { type: 'fileChange', id: 'call', status: 'inProgress', changes: [] } as ThreadItem
  const item = fold([...startedItem(start, null), ...completedItem({ ...start, status: 'completed', changes } as ThreadItem, '/projet', 10, null)])
  assert.deepEqual(toolEdits(item)?.counts, { added: 4, removed: 2 })
  assert.deepEqual(toolEdits(item)?.paths, ['modifie.ts', 'ajoute.ts', 'supprime.ts'])
  assert.deepEqual((item.input as { changes: unknown }).changes, changes)
  // Un journal plus ancien n'a les changements définitifs que dans la sortie.
  assert.deepEqual(toolEdits(tool('Edit', { changes: [] }, changes))?.counts, { added: 4, removed: 2 })
})

test('outils : l’apply_patch d’OpenCode donne ses chemins et ses lignes, sans compter le contexte ni inventer une suppression', () => {
  const patch = '*** Begin Patch\n*** Update File: ancien.ts\n*** Move to: neuf.ts\n@@\n garde\n-ancien\n+neuf\n+en plus\n*** Add File: ajoute.ts\n+un\n+deux\n*** End Patch'
  const described = opencodeTool('apply_patch', { patchText: patch }, [])
  const item = tool(described.name, described.input)
  assert.equal(toolSummary(item)?.text, 'neuf.ts · ajoute.ts')
  assert.deepEqual(toolEdits(item)?.counts, { added: 4, removed: 1 })
  assert.equal(toolEdits(tool('ApplyPatch', { patch: '*** Begin Patch\n*** Delete File: supprime.ts\n*** End Patch' }))?.counts, null)
})

test('outils : le compte de lignes tient les chaînes vides, le saut final, le CRLF, le contexte commun, et se borne', () => {
  for (const [a, b, expected] of [
    ['', '', { added: 0, removed: 0 }], ['', 'un\n', { added: 1, removed: 0 }],
    ['un\r\ndeux\r\n', 'un\r\nneuf\r\n', { added: 1, removed: 1 }],
    ['un\ndeux', 'un\ndeux', { added: 0, removed: 0 }],
    ['un\n', '', { added: 0, removed: 1 }],
    ['même\na\nmême\nb\nmême', 'même\nc\nmême\nd\nmême', { added: 2, removed: 2 }],
  ] as const) assert.deepEqual(countTextChanges(a, b), expected)
  assert.equal(countTextChanges('ancien\n'.repeat(2000), 'neuf\n'.repeat(2000)), null)
  assert.deepEqual(countTextChanges('même\n'.repeat(10000) + 'ancien', 'même\n'.repeat(10000) + 'neuf'), { added: 1, removed: 1 })
  assert.equal(countTextChanges('x'.repeat(1_000_001), ''), null)
})

test('outils : une édition mal formée ou indisponible n’invente pas de compteur et ne casse pas le fil', () => {
  for (const input of [null, 'opaque', { changes: [] }, { changes: [null, {}] }, { changes: [{ path: 'a', diff: 'inconnu', kind: { type: 'update' } }] }]) {
    assert.equal(toolEdits(tool('Edit', input))?.counts ?? null, null)
  }
  assert.equal(toolEdits(tool('Write', { file_path: 'a' }))?.counts, null)
})

test('outils : un Write compte les lignes écrites pour chaque CLI, sans prétendre à un diff net', () => {
  for (const entry of [
    { name: 'Write', input: { file_path: 'a.ts', content: 'un\ndeux\n' } },
    opencodeTool('write', { filePath: 'a.ts', content: 'un\ndeux\n' }, []),
    grokTool('write', { target_file: 'a.ts', content: 'un\r\ndeux\r\n' }),
  ]) {
    const item = tool(entry.name, entry.input)
    assert.equal(toolSummary(item)?.text, 'a.ts')
    assert.deepEqual(toolEdits(item)?.counts, { added: 2, removed: 0 })
    assert.equal(toolEdits(item)?.scope, 'written')
  }
  assert.deepEqual(toolEdits(tool('Write', { content: '' }))?.counts, { added: 0, removed: 0 })
  assert.deepEqual(toolEdits(tool('Write', { content: 'dernière ligne' }))?.counts, { added: 1, removed: 0 })
  assert.equal(toolEdits(tool('Write', { content: null }))?.counts, null)
})

test('outils : le texte d’une sortie MCP se lit quel que soit son enveloppement', () => {
  for (const output of ['Trouvé', [{ type: 'text', text: 'Trouvé' }], { content: [{ type: 'text', text: 'Trouvé' }], structuredContent: null }]) {
    assert.equal(outputText(output), 'Trouvé')
  }
  assert.equal(outputText({ content: [null, { type: 'image', data: 'image' }] }), null)
})

test('outils : une recherche résume son motif plutôt que son dossier, avec les identifiants MCP et les carnets', () => {
  assert.equal(toolSummary(tool('Grep', { path: '/espace', pattern: 'aiguille' }))?.text, 'aiguille')
  assert.equal(toolSummary(tool('NotebookEdit', { notebook_path: 'analyse.ipynb' }))?.text, 'analyse.ipynb')
  assert.equal(toolSummary(tool('solera/read_card', { card_number: 53 }))?.text, '#53')
  assert.equal(toolSummary(tool('solera/read_card', { number: 45 }))?.text, '#45')
  assert.equal(toolSummary(tool('Skill', { skill: 'frontend-design' }))?.text, 'frontend-design')
})

test('outils : les arguments web définitifs de Codex remplacent le départ vide, en direct comme au rejeu', () => {
  const start = { type: 'webSearch', id: 'call', query: '', action: null, results: null } satisfies ThreadItem
  const cases = [
    { query: 'requête de repli', action: { type: 'search', query: null, queries: null }, summary: 'requête de repli' },
    { query: 'résumé', action: { type: 'search', query: 'vraie requête', queries: null }, summary: 'vraie requête' },
    { query: '', action: { type: 'search', query: null, queries: ['première', 'seconde'] }, summary: 'première · seconde' },
    { query: "'stream-json'", action: { type: 'findInPage', url: null, pattern: 'stream-json' }, summary: 'stream-json' },
    { query: 'ouvrir', action: { type: 'openPage', url: 'https://example.com/docs' }, summary: 'https://example.com/docs' },
    { query: 'action future', action: { type: 'other' }, summary: 'action future' },
    { query: 'requête sans action', action: null, summary: 'requête sans action' },
  ] as const
  for (const sample of cases) {
    const final = { ...start, query: sample.query, action: sample.action, results: [{ type: 'text_result', snippet: 'Trouvé' }] } as ThreadItem
    const completed = completedItem(final, '/projet', 12, null)
    assert.deepEqual(completed.map((event) => event.type), ['tool.input_updated', 'tool.completed'])
    const events = [...startedItem(start, null), ...completed]
    for (const item of [fold(events), fold(JSON.parse(JSON.stringify(events)))]) {
      assert.equal(item.status, 'done')
      // Le résumé doit tenir sans la sortie, comme dans un fil projeté replié.
      assert.equal(toolSummary({ ...item, output: null })?.text, sample.summary)
      assert.equal((item.input as Record<string, unknown>).type, sample.action?.type)
    }
    const legacy = tool('WebSearch', { query: '' }, { query: sample.query, action: sample.action, results: [] })
    assert.deepEqual(toolWebInput(legacy), fold(events).input)
    assert.equal(toolSummary(legacy)?.text, sample.summary)
  }
})

test('outils : la reprise des arguments web laisse en paix les autres CLI, les appels en cours et les corps absents', () => {
  const input = { query: 'requête d’origine' }
  const output = { query: 'requête finale', action: { type: 'search', query: null, queries: null }, results: [] }
  for (const item of [
    tool('WebSearch', input, 'Résultats en texte'), tool('WebSearch', input, null),
    tool('WebSearch', input, { query: 'objet sans rapport' }), tool('github/search', input, output),
    { ...tool('WebSearch', input, output), status: 'running' as const },
    tool('WebSearch', input, { ...output, action: { type: 'inconnu' } }),
  ]) assert.equal(toolWebInput(item), input)
  assert.equal((toolWebInput(tool('WebFetch', {}, { ...output, action: { type: 'openPage', url: 'https://example.com' } })) as Record<string, unknown>).url, 'https://example.com')
})

test('outils : l’intitulé humain l’emporte, sans prendre la description d’une ressource pour une activité', () => {
  assert.equal(toolSummary({ ...tool('Bash', { command: 'tail -20 test.log', description: 'Lire le rapport' }), presentation: { title: 'Commande shell' } })?.text, 'Lire le rapport')
  assert.equal(toolSummary({ ...tool('Bash', { command: 'tail -20 test.log', description: '  ' }), presentation: { title: 'Lire le rapport' } })?.text, 'Lire le rapport')
  assert.equal(toolSummary({ ...tool('Read', {}), presentation: { paths: ['src/a.ts'] } })?.text, 'src/a.ts')
  assert.equal(toolSummary(tool('solera/create_card', { title: 'Réparer la recherche', description: 'Long corps de carte' }))?.text, 'Réparer la recherche')
  assert.equal(toolSummary(tool('mcp__solera__rename_session', { title: 'Lot 6' }))?.mono, false)
  assert.equal(toolSummary(tool('TaskCreate', { subject: 'Vérifier les tests', description: 'Long corps' }))?.text, 'Vérifier les tests')
  assert.equal(toolSummary(tool('TaskUpdate', { taskId: '7', status: 'completed' }))?.text, '#7')
  assert.equal(toolSummary(tool('TaskOutput', { task_id: 'fond-1' }))?.text, '#fond-1')
  assert.equal(toolSummary(tool('ReadMcpResource', { server: 'docs', uri: 'docs://guide' }))?.text, 'docs://guide')
  assert.equal(toolSummary(tool('Hook/PreToolUse', { source: '/hooks/check.sh' }))?.text, '/hooks/check.sh')
  assert.equal(toolSummary(tool('Sleep', { durationMs: 1200 }))?.text, 'Wait 1.2 s')
  assert.deepEqual(toolPresentation('read_file', ['read_file', 'Read']), {})
  assert.deepEqual(toolPresentation(' Lire la source ', ['Read'], [null, { path: 42 }, { path: 'src/a.ts' }, { path: 'src/a.ts' }]), { title: 'Lire la source', paths: ['src/a.ts'] })
})

test('outils : lecture, shell, recherche, sous-agent et skill gardent leur champ identifiant pour chaque adaptateur', () => {
  for (const [native, open, grok, inputs, expected] of [
    ['Read', 'read', 'read_file', [{ file_path: 'a.ts' }, { filePath: 'a.ts' }, { target_file: 'a.ts' }], 'a.ts'],
    ['Bash', 'bash', 'run_terminal_command', [{ command: 'echo hi', description: 'Saluer' }, { command: 'echo hi' }, { command: 'echo hi', description: 'Saluer' }], ['Saluer', 'echo hi', 'Saluer']],
    ['Grep', 'grep', 'grep', [{ pattern: 'aiguille', path: '/src' }, { pattern: 'aiguille', path: '/src' }, { query: 'aiguille', target_directory: '/src' }], 'aiguille'],
    ['WebSearch', 'websearch', 'web_search', [{ query: 'notes de version' }, { query: 'notes de version' }, { query: 'notes de version' }], 'notes de version'],
    ['WebFetch', 'webfetch', 'web_fetch', [{ url: 'https://example.com/guide' }, { url: 'https://example.com/guide' }, { url: 'https://example.com/guide' }], 'https://example.com/guide'],
    ['Agent', 'task', 'spawn_subagent', [{ description: 'Explorer les tests', prompt: 'Long prompt' }, { description: 'Explorer les tests', prompt: 'Long prompt' }, { description: 'Explorer les tests', prompt: 'Long prompt' }], 'Explorer les tests'],
  ] as const) {
    for (const [index, described] of [{ name: native, input: inputs[0] }, opencodeTool(open, inputs[1], []), grokTool(grok, inputs[2])].entries()) {
      assert.equal(toolSummary(tool(described.name, described.input))?.text, typeof expected === 'string' ? expected : expected[index], described.name)
    }
  }
  const listing = grokTool('list_dir', { target_directory: 'src' })
  assert.equal(toolSummary(tool(listing.name, listing.input))?.text, 'src')
  const glob = opencodeTool('glob', { pattern: '**/*.tsx' }, [])
  assert.equal(toolSummary(tool(glob.name, glob.input))?.text, '**/*.tsx')
  const skill = opencodeTool('skill', { name: 'frontend-design' }, [])
  assert.equal(toolSummary(tool(skill.name, skill.input))?.text, 'frontend-design')
})

test('outils : une commande que Codex a analysée se décrit, une commande composée ou inconnue garde sa ligne', () => {
  for (const [action, expected] of [
    [{ type: 'read', path: 'src/a.ts', name: 'a.ts' }, 'Read src/a.ts'],
    [{ type: 'listFiles', path: 'src' }, 'List files in src'],
    [{ type: 'search', path: 'src', query: 'aiguille' }, 'Search for aiguille in src'],
    [{ type: 'search', path: null, query: 'aiguille' }, 'Search for aiguille'],
    [{ type: 'unknown' }, 'commande shell'], [null, 'commande shell'],
  ] as const) assert.equal(toolSummary(tool('Bash', { command: 'commande shell', commandActions: [action] }))?.text, expected)
  assert.equal(toolSummary(tool('Bash', { command: 'cat a; echo fini', commandActions: [{ type: 'read', path: 'a' }, { type: 'unknown' }] }))?.text, 'cat a; echo fini')
})

test('outils : l’entrée définitive d’une commande, d’un MCP, d’un outil dynamique ou d’une image Codex passe le schéma et le fold', () => {
  const cases = [
    [{ type: 'commandExecution', command: '', cwd: '/projet' }, { command: 'cat a.ts', commandActions: [{ type: 'read', command: 'cat a.ts', path: 'a.ts', name: 'a.ts' }], aggregatedOutput: 'source', status: 'completed' }, 'Read a.ts'],
    [{ type: 'mcpToolCall', server: 'github', tool: 'search', arguments: {} }, { arguments: { query: 'bugs' }, appContext: { actionName: 'Chercher les tickets' }, result: { content: [] } }, 'bugs'],
    [{ type: 'dynamicToolCall', namespace: 'functions', tool: 'custom', arguments: {} }, { arguments: { path: 'a.ts' }, contentItems: [], status: 'completed' }, 'a.ts'],
    [{ type: 'imageGeneration', revisedPrompt: null, result: '' }, { revisedPrompt: 'Une forêt', result: '', status: 'completed' }, 'Une forêt'],
  ]
  for (const [initial, final, expected] of cases) {
    const start = { ...initial as object, id: 'call' } as ThreadItem
    const end = { ...start, ...final as object } as ThreadItem
    const item = fold([...startedItem(start, null), ...completedItem(end, '/projet', 10, null)].map((event) => soleraEventSchema.parse(event)))
    assert.equal(toolSummary(item)?.text, expected)
    if (end.type === 'mcpToolCall') assert.deepEqual(item.presentation, { label: 'Chercher les tickets', origin: 'mcp' })
    if (end.type === 'dynamicToolCall') assert.deepEqual(item.presentation, { origin: 'native' })
  }
})

test('outils : l’origine MCP se lit dans toutes les écritures des adaptateurs, sans classer un outil natif parmi les MCP', async () => {
  const { toolOrigin, toolLabel, toolIntent, toolPreview } = await import('../../web/src/lib/tool-presentation.js')
  for (const item of [
    tool('mcp__solera__read_memory', { file: 'project.md' }),
    tool('solera/read_memory', { file: 'project.md' }),
    tool(...Object.values(opencodeTool('solera_read_memory', { file: 'project.md' }, ['solera'])) as [string, unknown]),
    tool(...Object.values(grokTool('use_tool', { tool_name: 'solera__read_memory', tool_input: { file: 'project.md' } })) as [string, unknown]),
  ]) {
    assert.equal(toolOrigin(item.name).kind, 'solera', item.name)
    assert.equal(toolLabel(item.name), 'Read memory')
    assert.equal(toolSummary(item)?.text, 'project.md')
    assert.equal(toolIntent(item), 'context')
  }
  assert.equal(toolOrigin(opencodeTool('git_hub_issue_read', {}, ['git', 'git_hub']).name).server, 'git_hub')
  for (const name of ['Collaboration/spawnAgent', 'Codex/futureTool', 'Hook/PreToolUse', 'apply_patch']) assert.equal(toolOrigin(name).kind, 'native', name)
  assert.equal(toolOrigin('functions/custom_tool', { origin: 'native' }).kind, 'native')
  // L'étiquette d'un connecteur nomme l'opération ; sans elle, le nom sans séparateurs.
  assert.equal(toolLabel('github/issue_read', { origin: 'mcp', label: 'Lire le ticket' }), 'Lire le ticket')
  assert.equal(toolLabel('github/issue_read'), 'issue read')
  assert.equal(toolIntent(tool('Bash', { command: 'pnpm test' })), 'verify')
  assert.equal(toolIntent(tool('Bash', { command: 'ls' })), 'other')
  assert.equal(toolIntent(tool('Edit', {})), 'change')
  assert.equal(toolPreview(tool('solera/read_memory', {}, { content: [{ type: 'text', text: '  Trouvé\n  ici ' }] })), 'Trouvé ici')
  assert.equal(toolPreview({ ...tool('Read', {}), status: 'running' }), 'Waiting for output')
})

test('outils : une suite ne se clôt qu’au texte qui la suit ou à la fin du tour, et garde sa clé en grandissant', async () => {
  const { buildRows } = await import('../../web/src/lib/tool-rows.js')
  const message = (id: string, text: string) => ({ kind: 'message', id, ts: 0, role: 'assistant', blocks: text ? [{ type: 'text', text }] : [{ type: 'thinking', text: 'hmm' }], streamingText: '', streamingThinking: '', parentToolCallId: null }) as never
  const a = tool('Read', { file_path: 'a' })
  const b = { ...tool('Read', { file_path: 'b' }), id: 'b', status: 'running' as const }
  const running = buildRows([a, b], null, true)
  assert.deepEqual(running.map((row) => [row.kind, row.key, row.kind === 'tool-group' && row.complete]), [['tool-group', 'tools-call', false]])
  const thinking = buildRows([a, { ...b, status: 'done' }, message('m', '')], null, true)
  assert.equal(thinking[0]!.kind === 'tool-group' && thinking[0]!.complete, false, 'une réflexion ne clôt pas la suite')
  const spoken = buildRows([a, { ...b, status: 'done' }, message('m', ''), message('n', 'Voilà.')], null, true)
  assert.equal(spoken[0]!.key, 'tools-call')
  assert.equal(spoken[0]!.kind === 'tool-group' && spoken[0]!.complete, true)
  assert.equal(buildRows([a], null, false)[0]!.kind === 'tool-group' && (buildRows([a], null, false)[0] as { complete: boolean }).complete, true)
})
