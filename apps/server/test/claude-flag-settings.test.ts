import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_CLAUDE_CONFIG, type ClaudeConfig } from '@solera/protocol'
import { flagSettings, liveFlagSettings } from '../src/agents/claude/flag-settings.js'

const config = (fields: Partial<ClaudeConfig>): ClaudeConfig => ({ ...DEFAULT_CLAUDE_CONFIG, ...fields })

test('au lancement, Ultracode n’est écrit qu’allumé et le mode rapide toujours', () => {
  assert.deepEqual(flagSettings(config({})), { fastMode: false, autoMemoryEnabled: false })
  assert.deepEqual(flagSettings(config({ ultracode: true, fastMode: true })), {
    fastMode: true,
    ultracode: true,
    autoMemoryEnabled: false,
  })
})

test('sans dossier de mémoire, la mémoire est éteinte et non laissée à son défaut', () => {
  // Le cœur de la famille « Mémoire » : omettre `autoMemoryDirectory` aurait renvoyé
  // Claude à `~/.claude/projects/<cwd>/memory`, qu'il écrit tout aussi volontiers mais
  // que personne ne voit ni ne partage — la case décochée aurait menti.
  assert.deepEqual(flagSettings(config({}), [], [], null), { fastMode: false, autoMemoryEnabled: false })
  assert.deepEqual(flagSettings(config({}), [], [], '/memoire'), {
    fastMode: false,
    autoMemoryDirectory: '/memoire',
  })
})

test('à chaud, Ultracode n’est renvoyé que s’il bascule', () => {
  const on = config({ ultracode: true, effort: 'high' })
  assert.equal('ultracode' in liveFlagSettings(on, { ...on, outputStyle: 'Concise' }), false)
  assert.equal(liveFlagSettings(config({ effort: 'high' }), on).ultracode, true)
  assert.equal(liveFlagSettings(on, { ...on, ultracode: false }).ultracode, null)
})

test('un changement d’effort renvoie Ultracode allumé, que le CLI éteindrait sinon', () => {
  const on = config({ ultracode: true, effort: 'high' })
  assert.deepEqual(liveFlagSettings(on, { ...on, effort: 'medium' }), {
    effortLevel: 'medium',
    fastMode: false,
    outputStyle: null,
    advisorModel: null,
    ultracode: true,
  })
  // Éteint, il n'a rien à protéger : la clé reste absente.
  const off = config({ effort: 'high' })
  assert.equal('ultracode' in liveFlagSettings(off, { ...off, effort: 'low' }), false)
})
