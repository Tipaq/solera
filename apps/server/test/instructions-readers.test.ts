import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RepoFiles } from '../../web/src/lib/instructions-readers.js'

const { INSTRUCTION_READERS, readersOf, alertsOf, fileStateOf, editTargetOf, nonEmptyLines, pointsTo } = await import(
  '../../web/src/lib/instructions-readers.js'
)

const GLOBAL = '- Répondre en français.'
const CONTENT = '# Consignes\n\n- Les tests se lancent avec `pnpm test`.\n- Ne jamais pousser sur main.\n- Une PR par carte.\n'
const POINTER = 'Voir [AGENTS.md](AGENTS.md) — les mêmes consignes pour tous les CLI.\n'

/** La partie projet de chaque CLI, en une chaîne par CLI : `fichiers`, `solera` ou `✗ raison`. */
const projectOf = (input: Parameters<typeof readersOf>[0]) =>
  Object.fromEntries(
    readersOf(input).map((reading) => [
      reading.agent,
      reading.project.kind === 'files'
        ? reading.project.files.join(' + ')
        : reading.project.kind === 'solera'
          ? 'solera'
          : `✗ ${reading.project.reason}`,
    ]),
  )

test('lecteurs : les quatre CLI, dans l’ordre de la table', () => {
  assert.deepEqual(INSTRUCTION_READERS, ['claude', 'codex', 'grok', 'opencode'])
  assert.deepEqual(readersOf({ mode: 'solera', solera: CONTENT, files: {}, global: GLOBAL }).map((reading) => reading.agent), INSTRUCTION_READERS)
})

test('lecteurs, dans le dépôt : Codex ne lit que AGENTS.md, OpenCode le premier trouvé, Claude et Grok les deux', () => {
  const both: RepoFiles = { 'AGENTS.md': CONTENT, 'CLAUDE.md': POINTER }
  assert.deepEqual(projectOf({ mode: 'repo', solera: '', files: both, global: GLOBAL }), {
    claude: 'AGENTS.md + CLAUDE.md',
    codex: 'AGENTS.md',
    grok: 'AGENTS.md + CLAUDE.md',
    opencode: 'AGENTS.md',
  })
  assert.deepEqual(projectOf({ mode: 'repo', solera: '', files: { 'AGENTS.md': CONTENT }, global: GLOBAL }), {
    claude: 'AGENTS.md',
    codex: 'AGENTS.md',
    grok: 'AGENTS.md',
    opencode: 'AGENTS.md',
  })
})

test('lecteurs, dans le dépôt : seul CLAUDE.md, Codex reste sans rien et dit pourquoi', () => {
  assert.deepEqual(projectOf({ mode: 'repo', solera: '', files: { 'CLAUDE.md': CONTENT }, global: GLOBAL }), {
    claude: 'CLAUDE.md',
    codex: '✗ codexIgnoresClaude',
    grok: 'CLAUDE.md',
    opencode: 'CLAUDE.md',
  })
})

test('lecteurs, dans le dépôt : un AGENTS.md vide masque CLAUDE.md à OpenCode, le premier trouvé l’emporte', () => {
  const project = projectOf({ mode: 'repo', solera: '', files: { 'AGENTS.md': '\n', 'CLAUDE.md': CONTENT }, global: GLOBAL })
  assert.equal(project.opencode, '✗ noFile')
  assert.equal(project.claude, 'CLAUDE.md')
})

test('lecteurs, dans le dépôt : aucun fichier, ou des fichiers vides, c’est n’avoir rien', () => {
  const none = { claude: '✗ noFile', codex: '✗ noFile', grok: '✗ noFile', opencode: '✗ noFile' }
  assert.deepEqual(projectOf({ mode: 'repo', solera: CONTENT, files: {}, global: GLOBAL }), none)
  assert.deepEqual(projectOf({ mode: 'repo', solera: '', files: { 'AGENTS.md': '  \n\n' }, global: GLOBAL }), none)
})

test('lecteurs, dans Solera : le texte de Solera pour tous, les fichiers du dépôt masqués', () => {
  const files: RepoFiles = { 'AGENTS.md': CONTENT, 'CLAUDE.md': CONTENT }
  assert.deepEqual(projectOf({ mode: 'solera', solera: CONTENT, files, global: GLOBAL }), {
    claude: 'solera',
    codex: 'solera',
    grok: 'solera',
    opencode: 'solera',
  })
  assert.deepEqual(projectOf({ mode: 'solera', solera: ' \n', files, global: GLOBAL }), {
    claude: '✗ soleraEmpty',
    codex: '✗ soleraEmpty',
    grok: '✗ soleraEmpty',
    opencode: '✗ soleraEmpty',
  })
})

test('lecteurs : la partie globale vaut dans les deux modes, et manque si elle est vide', () => {
  for (const mode of ['solera', 'repo'] as const) {
    assert.ok(readersOf({ mode, solera: '', files: {}, global: GLOBAL }).every((reading) => reading.global))
    assert.ok(readersOf({ mode, solera: '', files: {}, global: ' \n' }).every((reading) => !reading.global))
  }
})

test('renvoi : un fichier de quatre lignes au plus qui cite l’autre', () => {
  assert.equal(nonEmptyLines('a\n\n  \nb\n'), 2)
  assert.ok(pointsTo(POINTER, 'AGENTS.md'))
  assert.ok(pointsTo('Voir CLAUDE.md', 'CLAUDE.md'))
  assert.ok(!pointsTo(POINTER, 'CLAUDE.md'), 'il ne cite pas CLAUDE.md')
  assert.ok(!pointsTo('a\nb\nc\nd\nAGENTS.md', 'AGENTS.md'), 'cinq lignes : un contenu, pas un renvoi')
  assert.ok(pointsTo('a\nb\nc\nVoir AGENTS.md', 'AGENTS.md'))
})

test('fichiers du dépôt : absent, renvoi, lignes, masqué en mode Solera', () => {
  const files: RepoFiles = { 'AGENTS.md': CONTENT, 'CLAUDE.md': POINTER }
  assert.deepEqual(fileStateOf('repo', files, 'AGENTS.md'), { kind: 'lines', count: 4, masked: false })
  assert.deepEqual(fileStateOf('repo', files, 'CLAUDE.md'), { kind: 'pointer', to: 'AGENTS.md' })
  assert.deepEqual(fileStateOf('solera', files, 'AGENTS.md'), { kind: 'lines', count: 4, masked: true })
  assert.deepEqual(fileStateOf('repo', { 'AGENTS.md': CONTENT }, 'CLAUDE.md'), { kind: 'absent' })
  assert.deepEqual(fileStateOf('repo', { 'AGENTS.md': '' }, 'AGENTS.md'), { kind: 'lines', count: 0, masked: false })
})

test('alertes : les CLI sans consignes du projet, et le conseil de renommage si seul CLAUDE.md existe', () => {
  assert.deepEqual(alertsOf({ mode: 'repo', solera: '', files: { 'CLAUDE.md': CONTENT }, global: GLOBAL }), [
    { kind: 'missing', agents: ['codex'], rename: true },
  ])
  assert.deepEqual(alertsOf({ mode: 'repo', solera: '', files: {}, global: GLOBAL }), [
    { kind: 'missing', agents: ['claude', 'codex', 'grok', 'opencode'], rename: false },
  ])
  assert.deepEqual(alertsOf({ mode: 'solera', solera: '', files: { 'CLAUDE.md': CONTENT }, global: GLOBAL }), [
    { kind: 'missing', agents: ['claude', 'codex', 'grok', 'opencode'], rename: false },
  ], 'en mode Solera, le renommage ne changerait rien')
  assert.deepEqual(alertsOf({ mode: 'solera', solera: CONTENT, files: {}, global: GLOBAL }), [])
  assert.deepEqual(alertsOf({ mode: 'repo', solera: '', files: { 'AGENTS.md': CONTENT, 'CLAUDE.md': POINTER }, global: GLOBAL }), [])
})

test('alertes : deux fichiers qui ont chacun leur contenu divergent', () => {
  const other = '# Autres consignes\n\n- a\n- b\n- c\n- d\n'
  assert.deepEqual(alertsOf({ mode: 'repo', solera: '', files: { 'AGENTS.md': CONTENT, 'CLAUDE.md': other }, global: GLOBAL }), [{ kind: 'diverge' }])
  // Un renvoi, d'un côté ou de l'autre, n'est pas une divergence.
  assert.deepEqual(alertsOf({ mode: 'repo', solera: '', files: { 'AGENTS.md': 'Voir CLAUDE.md', 'CLAUDE.md': CONTENT }, global: GLOBAL }), [])
  // Le même texte des deux côtés (un lien symbolique) non plus.
  assert.deepEqual(alertsOf({ mode: 'repo', solera: '', files: { 'AGENTS.md': CONTENT, 'CLAUDE.md': `${CONTENT}\n` }, global: GLOBAL }), [])
  // En mode Solera, les fichiers sont masqués : leur désaccord ne touche aucun agent.
  assert.deepEqual(alertsOf({ mode: 'solera', solera: CONTENT, files: { 'AGENTS.md': CONTENT, 'CLAUDE.md': other }, global: GLOBAL }), [])
})

test('édition : le texte de Solera, ou le fichier du dépôt qui porte le contenu', () => {
  assert.deepEqual(editTargetOf('solera', { 'AGENTS.md': CONTENT }), { kind: 'solera' })
  assert.deepEqual(editTargetOf('repo', { 'AGENTS.md': CONTENT, 'CLAUDE.md': POINTER }), { kind: 'file', path: 'AGENTS.md', exists: true })
  assert.deepEqual(editTargetOf('repo', { 'CLAUDE.md': CONTENT }), { kind: 'file', path: 'CLAUDE.md', exists: true })
  assert.deepEqual(editTargetOf('repo', {}), { kind: 'file', path: 'AGENTS.md', exists: false })
  // AGENTS.md qui ne fait que renvoyer à CLAUDE.md : on modifie celui qui a le contenu.
  assert.deepEqual(editTargetOf('repo', { 'AGENTS.md': 'Voir CLAUDE.md', 'CLAUDE.md': CONTENT }), { kind: 'file', path: 'CLAUDE.md', exists: true })
  // Un AGENTS.md vide existe : on l'écrit plutôt que de le doubler d'un autre.
  assert.deepEqual(editTargetOf('repo', { 'AGENTS.md': '' }), { kind: 'file', path: 'AGENTS.md', exists: true })
})
