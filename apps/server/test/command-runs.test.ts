import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectActionDto, TerminalDto } from '@solera/protocol'
import type { MessageKey, MessageParams } from '../../web/src/lib/i18n/index.js'

const { commandRunsOf, runDuration, runMeta, runSentence } = await import('../../web/src/lib/command-runs.js')
const { summarize } = await import('../../web/src/lib/command-output.js')
const { fr } = await import('../../web/src/lib/i18n/catalog-fr.js')
const { en } = await import('../../web/src/lib/i18n/catalog-en.js')

function translator(catalog: Record<string, string>) {
  return (key: MessageKey, params?: MessageParams) =>
    catalog[key]!.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
const t = translator(fr)
const tEn = translator(en)

const SEC = 1000
const NOW = 1_800_000_000_000

const terminal = (over: Partial<TerminalDto>): TerminalDto => ({
  id: 't',
  title: 'shell',
  alive: false,
  interrupted: false,
  cwd: '/home/alex/nimbus',
  conversationId: 'c1',
  createdAt: NOW - 60 * SEC,
  actionId: 'a1',
  trial: false,
  exitCode: 0,
  finishedAt: NOW - 30 * SEC,
  ...over,
})

const action = (over: Partial<ProjectActionDto> = {}) =>
  ({ id: 'a1', projectId: 'p1', label: 'Tests', command: 'pnpm test', subdir: null, ...over }) as ProjectActionDto

test('commandRunsOf : les terminaux d’action de cette conversation, en cours d’abord puis les plus récents', () => {
  const runs = commandRunsOf(
    [
      terminal({ id: 'old', createdAt: NOW - 10 * 60 * SEC }),
      terminal({ id: 'shell', actionId: null }),
      terminal({ id: 'trial', actionId: null, trial: true }),
      terminal({ id: 'elsewhere', conversationId: 'c2' }),
      terminal({ id: 'root', conversationId: null }),
      terminal({ id: 'live', alive: true, exitCode: null, finishedAt: null, createdAt: NOW - 20 * 60 * SEC }),
      terminal({ id: 'recent', createdAt: NOW - 5 * SEC }),
    ],
    [action()],
    'c1',
  )
  assert.deepEqual(runs.map((run) => run.terminalId), ['live', 'recent', 'old'])
  assert.equal(runs[0]!.label, 'Tests')
  assert.equal(runs[0]!.command, 'pnpm test')
  // Hors conversation : ceux de la racine.
  assert.deepEqual(commandRunsOf([terminal({ id: 'root', conversationId: null }), terminal({ id: 'here' })], [action()]).map((run) => run.terminalId), ['root'])
})

test('commandRunsOf : le statut, et 128 + n se lit « arrêtée », pas « échouée »', () => {
  const status = (over: Partial<TerminalDto>) => commandRunsOf([terminal(over)], [action()], 'c1')[0]!.status
  assert.equal(status({ alive: true, exitCode: null, finishedAt: null }), 'running')
  assert.equal(status({ exitCode: 0 }), 'succeeded')
  assert.equal(status({ exitCode: 1 }), 'failed')
  assert.equal(status({ exitCode: 130 }), 'stopped')
  assert.equal(status({ exitCode: 129 }), 'stopped')
  // SIGSEGV : un plantage.
  assert.equal(status({ exitCode: 139 }), 'failed')
  assert.equal(status({ interrupted: true, exitCode: null, finishedAt: null }), 'interrupted')
})

test('commandRunsOf : une action supprimée garde le titre du terminal ; la racine se déduit du sous-dossier', () => {
  const [gone] = commandRunsOf([terminal({ actionId: 'zz', title: 'Vieux lint' })], [action()], 'c1')
  assert.equal(gone!.label, 'Vieux lint')
  assert.equal(gone!.action, null)
  const [nested] = commandRunsOf([terminal({ cwd: '/home/alex/nimbus/apps/web' })], [action({ subdir: 'apps/web' })], 'c1')
  assert.equal(nested!.root, '/home/alex/nimbus')
})

test('runDuration : à la seconde, pour une durée qui avance', () => {
  assert.equal(runDuration(400, t), '0 s')
  assert.equal(runDuration(38 * SEC, t), '38 s')
  assert.equal(runDuration(65 * SEC, t), '1 min 05')
  assert.equal(runDuration((2 * 3600 + 5 * 60 + 9) * SEC, t), '2 h 05')
})

const run = (over: Partial<TerminalDto>) => commandRunsOf([terminal(over)], [action()], 'c1')[0]!

test('runMeta : ce que dit la ligne', () => {
  assert.equal(runMeta(run({ alive: true, exitCode: null, finishedAt: null, createdAt: NOW - 38 * SEC }), NOW, null, t), '38 s')
  assert.equal(runMeta(run({ exitCode: 0, createdAt: NOW - 20 * SEC, finishedAt: NOW - 11 * SEC }), NOW, null, t), 'Réussie · 9 s')
  assert.equal(runMeta(run({ exitCode: 130 }), NOW, null, t), 'Arrêtée · 30 s')
  assert.equal(runMeta(run({ interrupted: true, exitCode: null, finishedAt: null }), NOW, null, t), 'Interrompue')
  const tests = summarize('vitest run', ' FAIL  a.test.ts > x\nnon\n FAIL  a.test.ts > y\nnon\n FAIL  a.test.ts > z\nnon\n')
  assert.equal(runMeta(run({ exitCode: 1, createdAt: NOW - 48 * SEC }), NOW, tests, t), 'Échec (code 1) · 18 s · 3 tests en échec')
  const lint = summarize('eslint .', 'a.ts\n  1:1  error  x  r\n  2:1  warning  y  r\nb.ts\n  1:1  error  z  r\n')
  assert.equal(runMeta(run({ exitCode: 1 }), NOW, lint, t), 'Échec (code 1) · 30 s · 2 erreurs')
  assert.equal(runMeta(run({ exitCode: 1 }), NOW, lint, tEn), 'Failed (code 1) · 30 s · 2 errors')
})

test('runSentence : la phrase d’état du détail', () => {
  assert.equal(runSentence(run({ alive: true, exitCode: null, finishedAt: null, createdAt: NOW - 38 * SEC }), NOW, null, t, 'il y a 0 s'), 'En cours depuis 38 s')
  assert.equal(runSentence(run({ exitCode: 0, createdAt: NOW - 20 * SEC, finishedAt: NOW - 11 * SEC }), NOW, null, t, 'il y a 11 secondes'), 'Réussie en 9 s · il y a 11 secondes')
  assert.equal(
    runSentence(run({ interrupted: true, exitCode: null, finishedAt: null }), NOW, null, t, ''),
    'Interrompue : le terminal a été emporté par un redémarrage.',
  )
  const tests = summarize('vitest', '      Tests  3 failed | 41 passed (44)\n')
  assert.equal(runSentence(run({ exitCode: 1, createdAt: NOW - 48 * SEC }), NOW, tests, t, ''), 'Échec (code 1) en 18 s · Tests  3 failed | 41 passed (44)')
  assert.equal(runSentence(run({ exitCode: 130, createdAt: NOW - 35 * SEC }), NOW, null, t, ''), 'Arrêtée au bout de 5 s')
})
