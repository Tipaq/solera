import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

// Vérifie que les réglages présentent l'API et le serveur MCP côte à côte, qu'un jeton MCP
// se crée sans les champs propres aux tâches, puis que ce jeton ouvre le vrai serveur MCP.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-api-mcp-check-'))
const shots = process.env.API_MCP_SHOTS ?? (await mkdtemp(join(tmpdir(), 'solera-api-mcp-shots-')))
const processes = []
let browser
const unit = `solera-app-api-mcp-check-${process.pid}`

async function freePort() {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return port
}

function run(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'pipe' })
  processes.push(child)
  child.diagnostics = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { child.diagnostics = (child.diagnostics + chunk).slice(-6000) })
  }
  return child
}

async function ready(url, child) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(child.diagnostics)
    if (await fetch(url).then((response) => response.ok).catch(() => false)) return
    await delay(100)
  }
  throw new Error(`Server did not start: ${child.diagnostics}`)
}

try {
  const apiPort = await freePort()
  const webPort = await freePort()
  const config = join(data, 'config.toml')
  await writeFile(config, '[agents.codex]\nenabled = false\n[agents.opencode]\nenabled = false\n')
  const env = { ...process.env, NODE_ENV: 'development', SOLERA_PORT: String(apiPort), SOLERA_HOST: '127.0.0.1', SOLERA_CONFIG: config, SOLERA_DATA_DIR: join(data, 'data'), SOLERA_WEB_ROOT: join(data, 'web') }
  const server = spawn('systemd-run', ['--user', '--wait', '--pipe', '--collect', `--unit=${unit}`, `--working-directory=${serverDir}`,
    ...Object.entries(env).filter(([key]) => key.startsWith('SOLERA_') || ['PATH', 'NODE_ENV'].includes(key)).map(([key, value]) => `--setenv=${key}=${value}`),
    process.execPath, '--import', 'tsx', 'src/main.ts'], { stdio: 'pipe' })
  server.diagnostics = ''
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { server.diagnostics += chunk })
  const vite = run([join(webDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], webDir, env)
  const base = `http://127.0.0.1:${webPort}`
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`, server), ready(base, vite)])
  const seed = run(['--import', 'tsx', 'src/cli/demo-seed.ts'], serverDir, env)
  const [code] = await once(seed, 'exit')
  assert.equal(code, 0, seed.diagnostics)
  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  assert.ok((await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })).ok())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // Une capture par bloc plutôt qu'une page entière : chaque carte se relit seule.
  const card = (title) => page.locator('div.rounded-lg.surface', { has: page.getByRole('heading', { name: title, exact: true }) })
  const shoot = async (locator, file) => {
    await locator.scrollIntoViewIfNeeded()
    // Plus haute que l'écran, une carte ne se capture pas seule dans la modale qui
    // défile : l'écran tel qu'il est, alors.
    const box = await locator.boundingBox()
    if (box && box.height > page.viewportSize().height) await page.screenshot({ path: join(shots, file) })
    else await locator.screenshot({ path: join(shots, file) })
  }

  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport)
    await page.goto(`${base}/settings/api`)
    // Les deux portes, chacune avec son adresse.
    await page.getByRole('heading', { name: 'API REST', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Serveur MCP', exact: true }).waitFor()
    assert.ok(await page.getByText(`${base}/api/v1`, { exact: true }).isVisible())
    assert.ok(await page.getByText(`${base}/api/v1/mcp`, { exact: true }).first().isVisible())
    // En boucle locale, l'adresse ne mène nulle part depuis le téléphone : la carte le dit.
    assert.ok(await card('Serveur MCP').getByText('Cette adresse ne vaut que sur cette machine', { exact: false }).isVisible())
    // Sur la carte MCP, le guide replié porte un emplacement à la place du jeton.
    await page.getByText('Brancher un client MCP', { exact: true }).click()
    assert.ok(await page.getByText('Authorization: Bearer <jeton>', { exact: true }).isVisible())
    await shoot(card('API REST'), `${name}-api.png`)
    await shoot(card('Serveur MCP'), `${name}-mcp.png`)

    await page.getByRole('button', { name: 'Créer un jeton MCP', exact: true }).click()
    await page.getByRole('heading', { name: 'Nouveau jeton MCP' }).waitFor()
    assert.ok(await page.getByRole('checkbox', { name: /^mcp/ }).isChecked())
    assert.equal(await page.getByRole('checkbox', { name: /tasks:write/ }).isChecked(), false)
    // Sans portée de tâches, ni CLI ni webhook : ils ne régleraient rien.
    assert.ok(await page.getByText('Ni CLI ni modèle à choisir', { exact: false }).isVisible())
    assert.equal(await page.getByRole('textbox', { name: 'URL de webhook' }).count(), 0)
    // Cocher une portée de tâches les fait revenir.
    await page.getByRole('checkbox', { name: /tasks:write/ }).check()
    assert.equal(await page.getByRole('textbox', { name: 'URL de webhook' }).count(), 1)
    await page.getByRole('checkbox', { name: /tasks:write/ }).uncheck()
    await shoot(card('Nouveau jeton MCP'), `${name}-form.png`)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }

  await page.getByRole('textbox', { name: 'Nom', exact: true }).fill('Claude sur le portable')
  const created = page.waitForResponse(response => response.url().endsWith('/api/tokens') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Créer le jeton', exact: true }).click()
  const tokenResponse = await created
  assert.equal(tokenResponse.status(), 201, await tokenResponse.text())
  const token = await tokenResponse.json()
  assert.deepEqual(token.token.scopes, ['mcp'])
  assert.equal(token.token.webhookUrl, null)
  // Le jeton se montre avec le guide de branchement, valable pour tout client MCP.
  const reveal = card('Votre jeton')
  await reveal.getByText('Solera parle le protocole MCP standard', { exact: false }).waitFor()
  assert.ok(await reveal.getByText(`Authorization: Bearer ${token.secret}`, { exact: true }).isVisible())
  assert.ok(await reveal.getByText('HTTP « streamable »', { exact: false }).isVisible())
  // Les exemples sont repliés, puis portent le jeton une fois ouverts.
  await reveal.getByText('Exemples', { exact: true }).click()
  assert.ok(await reveal.getByText(`http_headers = { "Authorization" = "Bearer ${token.secret}" }`, { exact: false }).isVisible())
  assert.ok(await reveal.getByText('"mcpServers"', { exact: false }).isVisible())
  await shoot(reveal, 'phone-secret.png')
  // Le CLI ne règle que les tâches : la carte d'un jeton MCP seul n'en affiche pas.
  const listed = page.locator('div.rounded-lg.surface', { hasText: 'Claude sur le portable' }).last()
  assert.equal(await listed.getByText('claude', { exact: true }).count(), 0)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await shoot(reveal, 'desktop-secret.png')

  // Le jeton ouvre le vrai serveur MCP, et rien d'autre.
  const headers = { authorization: `Bearer ${token.secret}` }
  const rpc = (body, session) => context.request.post(`${base}/api/v1/mcp`, { headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) }, data: body })
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '0' } } })
  assert.equal(init.status(), 200, await init.text())
  const session = init.headers()['mcp-session-id']
  assert.ok(session)
  const projects = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }, session)).json()
  assert.match(projects.result.content[0].text, /projet\(s\)/)
  const sessions = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_sessions', arguments: { within_minutes: 10080 } } }, session)).json()
  assert.equal(sessions.result.isError, undefined, sessions.result.content[0].text)
  assert.equal((await context.request.get(`${base}/api/v1/projects`, { headers })).status(), 403)

  // Depuis les serveurs donnés aux agents, un renvoi vers celui de Solera.
  await page.goto(`${base}/settings/mcp`)
  const pointer = page.locator('p', { hasText: 'Ce sont des serveurs que vos agents utilisent' })
  await pointer.waitFor()
  await pointer.getByRole('button', { name: 'API et MCP' }).click()
  await page.getByRole('heading', { name: 'API REST', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(`api-mcp-ui-check: ok — captures dans ${shots}`)
} finally {
  await browser?.close()
  execFileSync('systemctl', ['--user', 'stop', unit], { stdio: 'ignore' })
  for (const child of processes) child.kill()
  await rm(data, { recursive: true, force: true })
}
