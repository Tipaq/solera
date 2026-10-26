import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_CLAUDE_CONFIG,
  DEFAULT_CODEX_CONFIG,
  EMPTY_CONFIG_LAYER,
  accountLayerFromLegacy,
  configSources,
  diffAgentConfig,
  layerFromFullConfigs,
  layerWithFullConfig,
  patchConfigLayer,
  readConfigLayer,
  readLegacyProjectConfigs,
  readProjectLayer,
  resolveAgentConfig,
  storedUserSettingsSchema,
  type ConfigLayer,
} from '@solera/protocol'

/**
 * L'héritage vivant, champ par champ (#120) : la partie pure, celle que le serveur et
 * l'interface partagent.
 */

const layer = (patch: Partial<ConfigLayer>): ConfigLayer => ({ ...EMPTY_CONFIG_LAYER, ...patch })

test('le niveau le plus précis gagne, champ par champ', () => {
  const account = layer({ shared: { cardFiling: false }, claude: { model: 'opus', effort: 'high' } })
  const project = layer({ shared: { decisions: true }, claude: { effort: 'low' } })
  const config = resolveAgentConfig('claude', [account, project], { permissionMode: 'plan' })
  assert.equal(config.agent, 'claude')
  if (config.agent !== 'claude') return
  // Le projet n'a changé que l'effort et les décisions : le modèle reste celui du compte.
  assert.equal(config.model, 'opus')
  assert.equal(config.effort, 'low')
  assert.equal(config.cardFiling, false)
  assert.equal(config.decisions, true)
  assert.equal(config.permissionMode, 'plan')
  // Rien n'a parlé du reste : les défauts du protocole.
  assert.equal(config.soleraMcp, DEFAULT_CLAUDE_CONFIG.soleraMcp)
})

test('un champ partagé vaut pour tous les CLI, une exception par CLI l’emporte', () => {
  const account = layer({ shared: { agentMemory: false }, codex: { agentMemory: true } })
  assert.equal(resolveAgentConfig('claude', [account]).agentMemory, false)
  assert.equal(resolveAgentConfig('grok', [account]).agentMemory, false)
  assert.equal(resolveAgentConfig('codex', [account]).agentMemory, true)
})

test('d’où vient chaque valeur', () => {
  const account = layer({ claude: { model: 'opus' } })
  const project = layer({ shared: { cardFiling: false } })
  const sources = configSources(
    'claude',
    [
      { source: 'account', layer: account },
      { source: 'project', layer: project },
    ],
    { effort: 'max' },
  )
  assert.equal(sources.model, 'account')
  assert.equal(sources.cardFiling, 'project')
  assert.equal(sources.effort, 'conversation')
  assert.equal(sources.permissionMode, 'default')
  assert.equal('agent' in sources, false)
})

test('un niveau illisible perd ses champs invalides, pas ses voisins', () => {
  const read = readConfigLayer({
    shared: { cardFiling: 'peut-être', agentMemory: false, model: 'pas partagé' },
    claude: { effort: 'énorme', model: 'opus', inconnu: 1 },
    codex: 'n’importe quoi',
  })
  assert.deepEqual(read.shared, { agentMemory: false })
  assert.deepEqual(read.claude, { model: 'opus' })
  assert.deepEqual(read.codex, {})
})

test('régler un champ partagé efface ses exceptions, rendre à l’héritage le retire', () => {
  let current = layer({ shared: { cardFiling: true }, codex: { cardFiling: false, model: 'gpt' } })
  current = patchConfigLayer(current, { scope: 'shared', set: { cardFiling: false } })
  assert.deepEqual(current.shared, { cardFiling: false })
  assert.deepEqual(current.codex, { model: 'gpt' })

  current = patchConfigLayer(current, { scope: 'codex', unset: ['model'], set: { sandbox: 'read-only' } })
  assert.deepEqual(current.codex, { sandbox: 'read-only' })

  current = patchConfigLayer(current, { scope: 'shared', unset: ['cardFiling'] })
  assert.deepEqual(current.shared, {})
})

test('null reste une valeur posée : seul `unset` rend un champ à l’héritage', () => {
  const current = patchConfigLayer(layer({ claude: { account: 'compte' } }), { scope: 'claude', set: { account: null } })
  assert.deepEqual(current.claude, { account: null })
})

test('une configuration entière ne retient que ses écarts', () => {
  const below = { ...DEFAULT_CLAUDE_CONFIG, model: 'opus' }
  const next = layerWithFullConfig(
    layer({ codex: { cardFiling: false } }),
    { ...below, effort: 'max', cardFiling: false },
    below,
  )
  assert.deepEqual(next.claude, { effort: 'max' })
  assert.deepEqual(next.shared, { cardFiling: false })
  // L'exception du Codex tombe : la valeur partagée vaut maintenant pour lui aussi.
  assert.deepEqual(next.codex, {})
})

test('les écarts ignorent l’ordre des clés, pas celui des listes', () => {
  const base = { ...DEFAULT_CODEX_CONFIG, mcpServers: ['a', 'b'] }
  assert.deepEqual(diffAgentConfig({ ...base, mcpServers: ['a', 'b'] }, base), {})
  assert.deepEqual(diffAgentConfig({ ...base, mcpServers: ['b', 'a'] }, base), { mcpServers: ['b', 'a'] })
  const granular = {
    granular: { sandbox_approval: true, rules: false, skill_approval: true, request_permissions: false, mcp_elicitations: true },
  }
  const reordered = {
    granular: { mcp_elicitations: true, rules: false, sandbox_approval: true, request_permissions: false, skill_approval: true },
  }
  assert.deepEqual(diffAgentConfig({ ...base, askForApproval: reordered }, { ...base, askForApproval: granular }), {})
})

// --- migration : les formes d'avant -------------------------------------------------

test('le compte d’avant garde tout, même ce qui égale le défaut du protocole', () => {
  const legacy = {
    claude: { ...DEFAULT_CLAUDE_CONFIG, model: 'opus', additionalDirectories: ['/tmp/x'] },
    codex: { ...DEFAULT_CODEX_CONFIG },
  }
  const account = accountLayerFromLegacy(legacy)
  // Les champs partagés, identiques chez les deux, en commun.
  assert.equal(account.shared.cardFiling, DEFAULT_CLAUDE_CONFIG.cardFiling)
  assert.equal(account.shared.projectFiling, false)
  assert.equal(account.claude.model, 'opus')
  assert.equal(account.claude.permissionMode, 'manual')
  assert.equal(account.codex.sandbox, 'workspace-write')
  // Les répertoires ne vivent pas au compte.
  assert.deepEqual(account.shared.additionalDirectories, [])
  // Un CLI absent de la charge reste sans réglage.
  assert.deepEqual(account.grok, {})
  // Rien de ce qui s'appliquait ne change.
  assert.deepEqual(resolveAgentConfig('claude', [account]), { ...legacy.claude, additionalDirectories: [] })
  assert.deepEqual(resolveAgentConfig('codex', [account]), legacy.codex)
})

test('deux CLI qui divergeaient gardent chacun leur valeur', () => {
  const account = accountLayerFromLegacy({
    claude: { ...DEFAULT_CLAUDE_CONFIG, cardFiling: true },
    codex: { ...DEFAULT_CODEX_CONFIG, cardFiling: false },
  })
  assert.equal(account.shared.cardFiling, true)
  assert.equal(account.codex.cardFiling, false)
  assert.equal(resolveAgentConfig('codex', [account]).cardFiling, false)
  assert.equal(resolveAgentConfig('claude', [account]).cardFiling, true)
})

test('la lecture d’un compte d’avant passe par la même conversion', () => {
  const settings = storedUserSettingsSchema.parse({
    agentDefaults: { claude: { ...DEFAULT_CLAUDE_CONFIG, model: 'opus' } },
  })
  assert.equal(settings.agentLayer.claude.model, 'opus')
  assert.equal(settings.agentDefaults.claude.model, 'opus')
  // Un compte neuf : rien de réglé, les défauts du protocole.
  const fresh = storedUserSettingsSchema.parse({})
  assert.deepEqual(fresh.agentLayer, EMPTY_CONFIG_LAYER)
  assert.deepEqual(fresh.agentDefaults.codex, DEFAULT_CODEX_CONFIG)
})

test('le préréglage de projet d’avant ne garde que ses écarts au compte', () => {
  const owner = layer({ claude: { model: 'opus' }, shared: { cardFiling: false } })
  const raw = JSON.stringify({
    claude: { ...DEFAULT_CLAUDE_CONFIG, model: 'opus', cardFiling: false, decisions: true, additionalDirectories: ['/srv'] },
    codex: null,
  })
  const legacy = readLegacyProjectConfigs(raw)
  assert.ok(legacy?.claude)
  const project = layerFromFullConfigs(legacy, (agent) => resolveAgentConfig(agent, [owner]))
  assert.deepEqual(project.shared, { decisions: true, additionalDirectories: ['/srv'] })
  assert.deepEqual(project.claude, {})
  // Pour le propriétaire, rien ne change.
  assert.deepEqual(resolveAgentConfig('claude', [owner, project]), legacy.claude)
})

test('la forme d’avant les préréglages par CLI se relit encore', () => {
  const raw = JSON.stringify({ ...DEFAULT_CODEX_CONFIG, sandbox: 'read-only' })
  assert.deepEqual(Object.keys(readLegacyProjectConfigs(raw) ?? {}), ['codex'])
  assert.equal(readProjectLayer(raw).codex.sandbox, 'read-only')
  // Un niveau n'est pas une forme d'avant.
  assert.equal(readLegacyProjectConfigs(JSON.stringify(layer({ shared: { decisions: true } }))), null)
  assert.equal(readProjectLayer(JSON.stringify(layer({ shared: { decisions: true } }))).shared.decisions, true)
  assert.deepEqual(readProjectLayer(null), EMPTY_CONFIG_LAYER)
  assert.deepEqual(readProjectLayer('{pas du json'), EMPTY_CONFIG_LAYER)
})
