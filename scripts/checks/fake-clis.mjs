import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Un faux CLI Claude pour les suites UI qui lancent de vrais tours : le runner de CI n'a
 * ni le CLI ni de compte, et un vrai tour coûterait du quota sur le poste (#267).
 *
 * Il parle ce que le SDK attend d'un `claude --input-format stream-json` : il accuse
 * toute requête de contrôle (`initialize` compris, avec des listes vides), et chaque
 * message de l'utilisateur joue un tour court — `system/init`, la réponse « OK » de
 * l'assistant, puis le `result`. Hors protocole, il répond à `--version` et à
 * `auth status` comme un CLI connecté.
 *
 * Chaque message reçu est ajouté à `$FAKE_CLAUDE_LOG` s'il est posé : c'est là qu'une
 * suite vérifie ce que le serveur a envoyé, puisque la réponse, elle, est jouée.
 * `$FAKE_CLAUDE_TURN_MS` retient le `result` d'autant : un tour instantané ne laisse pas
 * à l'écran le temps de montrer qu'il tourne.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { createInterface } = require('node:readline')

const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('2.1.302 (Claude Code)'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'ci@example.com' }))
  process.exit(0)
}

const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const sessionId = option('--session-id') ?? option('--resume') ?? randomUUID()
const model = option('--model') ?? 'claude-fake'
const reply = 'OK'
const turnMs = Number(process.env.FAKE_CLAUDE_TURN_MS ?? 0)
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
const log = (line) => { if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, line + '\\n') }
const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  log(line)
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.type === 'control_request') {
    send({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: message.request_id,
        response: { commands: [], agents: [], models: [], account: {}, output_style: 'default', available_output_styles: ['default'], mcpServers: [] },
      },
    })
    return
  }
  if (message.type !== 'user') return
  send({
    type: 'system', subtype: 'init', session_id: sessionId, uuid: randomUUID(), cwd: process.cwd(),
    tools: [], mcp_servers: [], model, permissionMode: 'default', slash_commands: [], apiKeySource: 'none',
    claude_code_version: '2.1.302', output_style: 'default', agents: [], skills: [], plugins: [],
  })
  send({
    type: 'assistant', session_id: sessionId, uuid: randomUUID(), parent_tool_use_id: null,
    message: { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', model, content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null, usage },
  })
  setTimeout(() => send({
    type: 'result', subtype: 'success', is_error: false, session_id: sessionId, uuid: randomUUID(),
    duration_ms: 5, duration_api_ms: 1, num_turns: 1, result: reply, stop_reason: 'end_turn',
    total_cost_usd: 0, usage, modelUsage: {}, permission_denials: [],
  }), turnMs)
})
process.stdin.on('end', () => process.exit(0))
`

/**
 * Un faux CLI Codex pour les suites UI des comptes (#264) : le vrai `codex app-server`
 * joindrait OpenAI pour le code d'appareil, et le runner de CI n'a pas de CLI.
 *
 * Il répond à `--version`, et `app-server` parle le JSON-RPC sur stdio que Solera
 * utilise pour les comptes :
 * - `account/login/start` par clé écrit `auth.json` dans `$CODEX_HOME`, comme le vrai ;
 *   par code d'appareil, il rend une URL et un code, et ne conclut jamais ;
 * - `account/read` relit `auth.json`, `account/logout` le retire ;
 * - le reste répond « méthode inconnue », que Solera traite comme une jauge absente.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { existsSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { createInterface } = require('node:readline')

const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-cli 0.163.0'); process.exit(0) }
if (args[0] !== 'app-server') { console.error('faux codex : seul app-server est joué'); process.exit(1) }

const home = process.env.CODEX_HOME || join(require('node:os').homedir(), '.codex')
const auth = join(home, 'auth.json')
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let request
  try { request = JSON.parse(line) } catch { return }
  const { id, method, params } = request
  if (id === undefined) return
  switch (method) {
    case 'initialize':
      return send({ id, result: { userAgent: 'fake-codex/0.163.0' } })
    case 'account/login/start':
      if (params.type === 'apiKey') {
        writeFileSync(auth, JSON.stringify({ OPENAI_API_KEY: params.apiKey }))
        return send({ id, result: { type: 'apiKey' } })
      }
      if (params.type === 'chatgptDeviceCode') {
        return send({ id, result: { type: 'chatgptDeviceCode', loginId: 'fake-login', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'FAKE-12345' } })
      }
      return send({ id, error: { code: -32602, message: 'faux codex : flux non joué' } })
    case 'account/read':
      return send({ id, result: { account: existsSync(auth) && readFileSync(auth, 'utf8').includes('OPENAI_API_KEY') ? { type: 'apiKey' } : null, requiresOpenaiAuth: true } })
    case 'account/logout':
      rmSync(auth, { force: true })
      return send({ id, result: {} })
    default:
      return send({ id, error: { code: -32601, message: 'faux codex : ' + method + ' non joué' } })
  }
})
process.stdin.on('end', () => process.exit(0))
`

async function writeExecutable(dir, name, source) {
  const path = join(dir, name)
  await writeFile(path, source)
  await chmod(path, 0o755)
  return path
}

/** Pose le faux `claude` dans `dir` et rend son chemin, à donner en `[agents.claude] binary`. */
export const writeFakeClaude = (dir) => writeExecutable(dir, 'claude', FAKE_CLAUDE)

/** Pose le faux `codex` dans `dir` et rend son chemin, à donner en `[agents.codex] binary`. */
export const writeFakeCodex = (dir) => writeExecutable(dir, 'codex', FAKE_CODEX)
