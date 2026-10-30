#!/usr/bin/env node
// Faux `claude auth login --claudeai`, sans réseau ni vrai compte : le dialogue tel que
// sondé sur 2.1.296, l'URL d'autorisation, l'invite, puis le code lu sur le terminal.
// `good` connecte et rend 0, tout autre code donne « Login failed: … » et rend 1.
// Chaque lancement note ses arguments, son cwd et son `CLAUDE_CONFIG_DIR` dans
// `$FIXTURE_CLAUDE_LOG`, pour qu'un test vérifie où le CLI aurait écrit sa connexion.
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

if (process.env.FIXTURE_CLAUDE_LOG) {
  appendFileSync(
    process.env.FIXTURE_CLAUDE_LOG,
    `${JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), configDir: process.env.CLAUDE_CONFIG_DIR ?? null })}\n`,
  )
}

const state = Math.random().toString(36).slice(2, 12)
process.stdout.write("Browser didn't open? Use the url below to sign in (c to copy)\r\n\r\n")
process.stdout.write(
  `https://claude.com/cai/oauth/authorize?code=true&client_id=fixture&response_type=code&scope=user%3Ainference&state=${state}\r\n\r\n`,
)
process.stdout.write('Paste code here if prompted > ')

createInterface({ input: process.stdin }).on('line', (line) => {
  const code = line.trim()
  if (!code) return
  if (code === 'good') {
    process.stdout.write('\r\nLogin successful.\r\n')
    process.exit(0)
  }
  process.stdout.write('\r\nLogin failed: Invalid code\r\n')
  process.exit(1)
})
