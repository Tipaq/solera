import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TerminalDto } from '@solera/protocol'

const { terminalDir, terminalTone } = await import('../../web/src/lib/terminal-tabs.js')

const shell = (fields: Partial<TerminalDto>): TerminalDto => ({
  id: 't1',
  title: 'bash',
  alive: true,
  interrupted: false,
  cwd: '/work/nimbus',
  conversationId: null,
  createdAt: 0,
  actionId: null,
  trial: false,
  exitCode: null,
  finishedAt: null,
  ...fields,
})

test('le point d’une pastille : vert vivant, rouge sorti en erreur, gris fini', () => {
  assert.equal(terminalTone(shell({})), 'positive')
  assert.equal(terminalTone(shell({ alive: false, exitCode: 2 })), 'critical')
  assert.equal(terminalTone(shell({ alive: false, exitCode: 0 })), 'neutral')
  assert.equal(terminalTone(shell({ alive: false })), 'neutral', 'un shell fermé sans code')
  assert.equal(terminalTone(shell({ alive: false, interrupted: true })), 'neutral', 'un shell emporté par un redémarrage')
})

test('le dossier d’une pastille : « workspace » à la racine, le nom du dossier ailleurs', () => {
  assert.equal(terminalDir(shell({}), '/work/nimbus'), null, 'à la racine du projet')
  assert.equal(terminalDir(shell({ cwd: '/data/worktrees/nimbus/feat-offline-cache' }), '/work/nimbus'), 'feat-offline-cache')
  assert.equal(terminalDir(shell({ cwd: '/data/worktrees/nimbus/feat-x/' }), '/work/nimbus'), 'feat-x', 'une barre finale ne vide pas le nom')
  assert.equal(terminalDir(shell({ cwd: '/work/nimbus' }), undefined), 'nimbus', 'projets pas encore lus : le nom du dossier')
})
