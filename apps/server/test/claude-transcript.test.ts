import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { forkSession, getSessionInfo } from '@anthropic-ai/claude-agent-sdk'
import {
  copyTranscript,
  locateTranscript,
  readSubAgentTranscripts,
  readTranscript,
  sessionLookup,
  transcriptPath,
  type TranscriptHome,
} from '../src/agents/claude/transcript.js'
import { claudeTranscripts } from '../src/agents/claude/transcript-home.js'
import type { Paths } from '../src/config.js'

test('la relecture ignore le rejeu API sans perdre les messages ni les sous-agents', async () => {
  const data = await mkdtemp(join(tmpdir(), 'solera-transcript-'))
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = data
  try {
    const file = transcriptPath('/workspace', 'session')
    await mkdir(dirname(file), { recursive: true })
    const message = { type: 'user', message: { content: [{ type: 'api-request-blob' }] } }
    const spawn = { type: 'user', toolUseResult: { agentId: 'child' }, message: { content: [{ type: 'tool_result', tool_use_id: 'call' }] } }
    const replay = [
      { type: 'api-request-shape', shape: { system: 'x'.repeat(2_000_000) } },
      { type: 'api-request-blob', message: { content: 'duplicate' } },
      { sessionId: 'session', type: 'api-request', params: {} },
    ]
    await writeFile(file, [message, ...replay, spawn].map(x => JSON.stringify(x)).join('\r\n') + '\n{"type":')
    assert.deepEqual(await readTranscript('/workspace', 'session'), [message, spawn])
    assert.deepEqual(await readTranscript('/workspace', 'missing'), [])
    const childDir = join(file.replace(/\.jsonl$/, ''), 'subagents')
    await mkdir(childDir, { recursive: true })
    // La dernière ligne valide compte aussi quand le CLI n'a pas encore écrit le saut de ligne.
    await writeFile(join(childDir, 'agent-child.jsonl'), [...replay, message].map(x => JSON.stringify(x)).join('\n'))
    const threads = await readSubAgentTranscripts('/workspace', 'session', [spawn])
    assert.deepEqual(threads.get('call'), [message])
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
    await rm(data, { recursive: true, force: true })
  }
})

test("les transcripts d'un dev container se lisent sous son dossier, au nom du cwd vu du conteneur (#154)", async () => {
  const data = await mkdtemp(join(tmpdir(), 'solera-transcript-'))
  try {
    const home: TranscriptHome = {
      configDir: join(data, 'container'),
      cwdInside: (cwd) => cwd.replace(/^C:\\/, '/mnt/c/').replaceAll('\\', '/'),
      searchById: true,
    }
    const message = { type: 'user', uuid: 'u1', message: { content: 'bonjour' } }
    const file = transcriptPath('C:\\repo', 'session', home)
    assert.equal(file, join(data, 'container', 'projects', '-mnt-c-repo', 'session.jsonl'))
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(message) + '\n')
    assert.deepEqual(await readTranscript('C:\\repo', 'session', home), [message])

    // Un conteneur sans les montages de Solera voit le projet ailleurs : retrouvé par l'identifiant.
    const elsewhere = join(data, 'container', 'projects', '-workspaces-repo', 'other.jsonl')
    await mkdir(dirname(elsewhere), { recursive: true })
    await writeFile(elsewhere, JSON.stringify(message) + '\n')
    assert.equal(await locateTranscript('C:\\repo', 'other', home), elsewhere)
    // L'hôte ne cherche pas ailleurs que sous son cwd.
    assert.equal(await locateTranscript('C:\\repo', 'other', { ...home, searchById: false }), transcriptPath('C:\\repo', 'other', home))

    // Recopié sous un autre cwd, il part du dossier où il a été trouvé.
    assert.equal(await copyTranscript('C:\\repo', 'C:\\tree', 'other', home), true)
    assert.deepEqual(await readTranscript('C:\\tree', 'other', { ...home, searchById: false }), [message])
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})

test('le SDK lit et forke une session de conteneur par le dossier de son transcript (#154)', async () => {
  const data = await mkdtemp(join(tmpdir(), 'solera-transcript-'))
  try {
    const home: TranscriptHome = { configDir: join(data, 'container'), cwdInside: () => '/inside/repo', searchById: true }
    const sessionId = randomUUID()
    const user = {
      type: 'user',
      uuid: randomUUID(),
      parentUuid: null,
      sessionId,
      timestamp: new Date().toISOString(),
      cwd: '/inside/repo',
      message: { role: 'user', content: 'Écris un test' },
    }
    const title = { type: 'custom-title', customTitle: 'Un titre du conteneur', sessionId }
    const file = transcriptPath('/host/repo', sessionId, home)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, [user, title].map((entry) => JSON.stringify(entry)).join('\n') + '\n')

    const info = await getSessionInfo(sessionId, await sessionLookup('/host/repo', sessionId, home))
    assert.equal(info?.customTitle, 'Un titre du conteneur')

    const forked = await forkSession(sessionId, { ...(await sessionLookup('/host/repo', sessionId, home)), upToMessageId: user.uuid })
    const entries = await readTranscript('/host/repo', forked.sessionId, home)
    assert.ok(entries.some((entry) => entry.type === 'user'))
    assert.equal(dirname(transcriptPath('/host/repo', forked.sessionId, home)), dirname(file))
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})

test("une session de dev container non confinée lit le dossier de Claude que Solera lui monte (#154)", () => {
  const paths = { data: '/data' } as Paths
  const conversation = { environmentWhere: 'devcontainer', environmentConfined: false, userId: 'u' } as const
  const home = claudeTranscripts(paths, conversation)
  assert.equal(home.configDir, join('/data', 'container-homes', 'u', 'claude'))
  assert.equal(home.searchById, true)
  // Confinée, son dossier de l'hôte lui est relié : elle reste sur les transcripts de l'hôte.
  assert.equal(claudeTranscripts(paths, { ...conversation, environmentConfined: true }).searchById, undefined)
  assert.equal(claudeTranscripts(paths, { ...conversation, environmentWhere: 'host' }).searchById, undefined)
})
