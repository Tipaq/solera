import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Un faux CLI Claude pour les suites UI qui lancent de vrais tours : le runner de CI n'a
 * ni le CLI ni de compte, et un vrai tour coûterait du quota sur le poste (#267).
 *
 * Il parle ce que le SDK attend d'un `claude --input-format stream-json` : il accuse
 * toute requête de contrôle (`initialize` compris, avec des listes vides), et chaque
 * message de l'utilisateur joue un tour court — `system/init`, une réponse de
 * l'assistant, puis le `result`. Hors protocole, il répond à `--version` et à
 * `auth status` comme un CLI connecté.
 *
 * Chaque message reçu est ajouté à `$FAKE_CLAUDE_LOG` s'il est posé : c'est là qu'une
 * suite vérifie ce que le serveur a envoyé, puisque la réponse, elle, est jouée.
 * `$FAKE_CLAUDE_REPLY` remplace la réponse par défaut, « OK ».
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
const reply = process.env.FAKE_CLAUDE_REPLY ?? 'OK'
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
const log = (line) => { if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, line + '\\n') }
const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  log(line)
  const message = JSON.parse(line)
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
  send({
    type: 'result', subtype: 'success', is_error: false, session_id: sessionId, uuid: randomUUID(),
    duration_ms: 5, duration_api_ms: 1, num_turns: 1, result: reply, stop_reason: 'end_turn',
    total_cost_usd: 0, usage, modelUsage: {}, permission_denials: [],
  })
})
process.stdin.on('end', () => process.exit(0))
`

/** Pose le faux `claude` dans `dir` et rend son chemin, à donner en `[agents.claude] binary`. */
export async function writeFakeClaude(dir) {
  const path = join(dir, 'claude')
  await writeFile(path, FAKE_CLAUDE)
  await chmod(path, 0o755)
  return path
}
