import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectBackgroundDto, ServiceDto } from '@solera/protocol'
import type { MessageKey, MessageParams } from '../../web/src/lib/i18n/index.js'
import type { SessionWork } from '../../web/src/lib/session-works.js'

const { familyOf, humanLabel, loadText, mergeWorks, portIn, seedFromWork, shortCommand } = await import('../../web/src/lib/session-works.js')
const { en } = await import('../../web/src/lib/i18n/catalog-en.js')
const { fr } = await import('../../web/src/lib/i18n/catalog-fr.js')

function translator(catalog: Record<string, string>) {
  return (key: MessageKey, params?: MessageParams) =>
    catalog[key]!.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
const t = translator(fr)
const tEn = translator(en)

const PROJECT = 'p1'
const HERE = 'c-here'
const OTHER = 'c-other'

const service = (over: Partial<ServiceDto>): ServiceDto => ({
  id: 'svc', kind: 'command', pid: 1, name: 'node', command: null, parentPid: 0, parentName: null, launcherPid: null,
  stopsWithSolera: true, cwd: null, ports: [], startedAt: 1_000, memoryBytes: 0, cpu: null, processCount: 1, processes: [],
  projectId: PROJECT, projectName: 'Nimbus', conversationId: HERE, conversationTitle: 'Ici', origin: 'agent', canStop: true,
  ...over,
})

const work = (over: Partial<SessionWork>): SessionWork => ({
  id: 'w', conversationId: HERE, conversationTitle: 'Ici', agent: 'claude', family: 'shell', description: null,
  command: null, startedAt: null, port: null, cpu: null, memoryBytes: null, stop: null, ...over,
})

test("shortCommand retire l'enrobage : env, variables, npx, npm/pnpm exec, dlx", () => {
  assert.equal(shortCommand('npx vite --port 5418 --strictPort'), 'vite --port 5418 --strictPort')
  assert.equal(shortCommand('npm exec -- vitest --watch'), 'vitest --watch')
  assert.equal(shortCommand('pnpm exec tsc --noEmit'), 'tsc --noEmit')
  assert.equal(shortCommand('pnpm dlx storybook dev'), 'storybook dev')
  assert.equal(shortCommand('env NODE_ENV=test PORT=3000 npx --yes jest'), 'jest')
  assert.equal(shortCommand('FOO=1 BAR= bunx astro dev'), 'astro dev')
  assert.equal(shortCommand('  pnpm --filter @solera/server test --watch  '), 'pnpm --filter @solera/server test --watch')
})

test('humanLabel dit ce que le processus est, en français et en anglais', () => {
  const of = (command: string, tr = t) => humanLabel(work({ command }), tr)
  assert.equal(of('npx vite --port 5418 --strictPort'), 'Serveur vite')
  assert.equal(of('npx vitest --watch'), 'Tests vitest en surveillance')
  assert.equal(of('npx vitest --watch', tEn), 'Vitest tests (watching)')
  assert.equal(of('pnpm --filter @solera/server test --watch'), 'Tests (server) en surveillance')
  assert.equal(of('npm run dev'), 'Serveur de dev')
  assert.equal(of('pnpm exec tsc --noEmit -w'), 'Typecheck en surveillance')
  assert.equal(of('/usr/bin/node scripts/serve.mjs'), 'Script node')
  assert.equal(of('python3 -m http.server 8000'), 'Script python')
  // Un exécutable inconnu : son nom, capitalisé.
  assert.equal(of('caddy run'), 'Caddy')
  // Sans commande : la description du CLI, sinon le mot de sa famille.
  assert.equal(humanLabel(work({ family: 'monitor', description: 'Surveiller la CI de la PR #118' }), t), 'Surveiller la CI de la PR #118')
  assert.equal(humanLabel(work({ family: 'workflow' }), t), 'Workflow')
})

test('portIn devine un port dans une commande', () => {
  assert.equal(portIn('vite --port 5418'), 5418)
  assert.equal(portIn('vite --port=5173'), 5173)
  assert.equal(portIn('curl http://localhost:8080/health'), 8080)
  assert.equal(portIn('wait for :3000'), 3000)
  assert.equal(portIn('vitest --watch'), null)
})

test('familyOf range les familles du CLI', () => {
  assert.equal(familyOf('local_bash'), 'shell')
  assert.equal(familyOf('shell'), 'shell')
  assert.equal(familyOf('local_workflow'), 'workflow')
  assert.equal(familyOf('monitor_mcp'), 'other')
  assert.equal(familyOf('monitor'), 'monitor')
  assert.equal(familyOf('mcp_task'), 'monitor')
  assert.equal(familyOf('local_agent'), 'subagent')
  assert.equal(familyOf('remote_thing'), 'other')
})

test('loadText : la charge et la mémoire, seulement ce qui est connu', () => {
  assert.equal(loadText(work({ cpu: 0.034, memoryBytes: 120 * 1024 * 1024 }), t), '3 % · 120.0 Mo')
  assert.equal(loadText(work({ cpu: null, memoryBytes: 2048 }), t), '2 ko')
  assert.equal(loadText(work({}), t), null)
})

test("seedFromWork : un service si un port est connu, sinon une tâche, d'où il vient", () => {
  const served = seedFromWork(work({ command: 'npx vite --port 5418', port: 5418, conversationTitle: 'Repenser la page' }), t)
  assert.deepEqual(served.preset, { what: 'command', kind: 'service' })
  assert.equal(served.prefill?.label, 'Serveur vite')
  assert.equal(served.prefill?.command, 'npx vite --port 5418')
  assert.equal(served.prefill?.url, 'http://localhost:{port}')
  assert.equal(served.prefill?.description, 'Repris de « Repenser la page », où une session l’avait lancé en fond.')
  const task = seedFromWork(work({ command: 'npx vitest --watch' }), t)
  assert.deepEqual(task.preset, { what: 'command', kind: 'task' })
  assert.equal(task.prefill?.url, '')
})

const background = (conversationId: string, title: string, tasks: Partial<ProjectBackgroundDto['tasks'][number]>[]): ProjectBackgroundDto => ({
  conversationId, title, agent: 'codex',
  tasks: tasks.map((task, index) => ({
    id: `t${index}`, kind: 'local_bash', description: '', startedAt: 500, toolCallId: null, command: null, serviceId: null, ...task,
  })),
})

test('mergeWorks : processus du projet et travaux de fond, sans doublon, cette session d’abord', () => {
  const services = [
    service({ id: 's-vite', command: 'vite --port 5418', ports: [5418], startedAt: 3_000, cpu: 0.02, memoryBytes: 1024, conversationId: OTHER, conversationTitle: 'Ailleurs' }),
    service({ id: 's-tests', command: 'vitest --watch', startedAt: 2_000 }),
    // Hors du projet, sans session, un lanceur : écartés.
    service({ id: 's-elsewhere', projectId: 'p2' }),
    service({ id: 's-terminal', conversationId: null, conversationTitle: null, origin: 'terminal' }),
    service({ id: 's-launcher', kind: 'launcher' }),
    service({ id: 's-helper', kind: 'helper' }),
    // Un processus dont le lanceur a disparu, encore rattaché à sa session : gardé.
    service({ id: 's-detached', kind: 'detached', command: 'node serve.mjs', startedAt: 4_000, canStop: false }),
  ]
  const tasks = [
    background(OTHER, 'Ailleurs', [
      // Porté par s-vite : un seul travail, la description du CLI et la commande exacte en plus.
      { id: 'b-vite', description: 'Serveur du prototype', command: 'npx vite --port 5418', serviceId: 's-vite', startedAt: 2_900 },
      // Sans processus : une surveillance.
      { id: 'b-monitor', kind: 'monitor', description: 'Surveiller la CI', startedAt: 1_000 },
      // Un sous-agent a sa place dans l'onglet Agent.
      { id: 'b-agent', kind: 'local_agent', description: 'Explorer', startedAt: 1_000 },
    ]),
  ]
  const works = mergeWorks({
    projectId: PROJECT,
    services,
    background: tasks,
    conversations: [{ id: HERE, title: 'Ici', agent: 'claude' }],
    currentConversationId: HERE,
  })
  assert.deepEqual(works.map((entry) => entry.id), ['s-tests', 's-detached', `${OTHER}:b-monitor`, 's-vite'])
  const [tests, detached, monitor, vite] = works
  assert.equal(tests!.agent, 'claude')
  assert.deepEqual(tests!.stop, { via: 'service', serviceId: 's-tests' })
  // Un processus qu'on ne peut pas arrêter n'a pas de geste.
  assert.equal(detached!.stop, null)
  assert.equal(monitor!.family, 'monitor')
  assert.equal(monitor!.agent, 'codex')
  assert.equal(monitor!.description, 'Surveiller la CI')
  // Claude sait arrêter un travail de fond ; Codex non.
  assert.equal(monitor!.stop, null)
  assert.equal(vite!.description, 'Serveur du prototype')
  assert.equal(vite!.command, 'npx vite --port 5418')
  assert.equal(vite!.port, 5418)
  assert.equal(vite!.cpu, 0.02)
  assert.equal(vite!.startedAt, 3_000)
  assert.deepEqual(vite!.stop, { via: 'service', serviceId: 's-vite' })
})

test('mergeWorks : un travail de fond Claude sans processus s’arrête par sa route', () => {
  const works = mergeWorks({
    projectId: PROJECT,
    services: null,
    background: [{ ...background(HERE, 'Ici', [{ id: 'b1', command: 'npx vite --port 5173', startedAt: 10 }]), agent: 'claude' }],
    conversations: [],
  })
  assert.equal(works.length, 1)
  assert.deepEqual(works[0]!.stop, { via: 'task', conversationId: HERE, taskId: 'b1' })
  // Sans scan, le port se devine dans la commande.
  assert.equal(works[0]!.port, 5173)
})

test("mergeWorks : sans session courante, l'ordre des départs", () => {
  const works = mergeWorks({
    projectId: PROJECT,
    services: [service({ id: 'b', startedAt: 2 }), service({ id: 'a', startedAt: 1, conversationId: OTHER })],
    background: [],
    conversations: [],
  })
  assert.deepEqual(works.map((entry) => entry.id), ['a', 'b'])
})
