import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
  const { id, method, params } = JSON.parse(line)
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

/** Pose le faux `codex` dans `dir` et rend son chemin, à donner en `[agents.codex] binary`. */
export async function writeFakeCodex(dir) {
  const path = join(dir, 'codex')
  await writeFile(path, FAKE_CODEX)
  await chmod(path, 0o755)
  return path
}
