import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

// Palette de recherche sur la vraie API et les données de démo. Aucun CLI n'est activé.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-palette-check-'))
// Captures sur demande seulement : `SHOTS=/un/dossier node scripts/palette-ui-check.mjs`.
const shots = process.env.SHOTS
const processes = []
let browser

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
  await writeFile(config, '[agents.claude]\nenabled = false\n[agents.codex]\nenabled = false\n')
  const env = {
    ...process.env,
    SOLERA_PORT: String(apiPort),
    SOLERA_HOST: '127.0.0.1',
    SOLERA_CONFIG: config,
    SOLERA_DATA_DIR: join(data, 'data'),
    SOLERA_WEB_ROOT: join(data, 'web'),
  }
  const server = run(['--import', 'tsx', 'src/main.ts'], serverDir, env)
  const vite = run([join(webDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], webDir, env)
  const base = `http://127.0.0.1:${webPort}`
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`, server), ready(base, vite)])
  const seed = run(['--import', 'tsx', 'src/cli/demo-seed.ts'], serverDir, env)
  const [seedCode] = await once(seed, 'exit')
  assert.equal(seedCode, 0, seed.diagnostics)

  if (shots) await mkdir(shots, { recursive: true })
  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const nimbus = projects.find((entry) => entry.name === 'Nimbus')
  const atlas = projects.find((entry) => entry.name === 'Atlas API')
  const conversations = await (await context.request.get(`${base}/api/projects/${nimbus.id}/conversations`)).json()
  const hero = conversations.find((entry) => entry.title === 'Add offline caching for forecasts')
  const skill = await context.request.post(`${base}/api/skill-library`, {
    data: { scope: 'project', projectId: nimbus.id, name: 'forecast-debugging', description: 'Use when a forecast is stale.', body: '' },
  })
  assert.ok(skill.ok(), await skill.text())

  const mcp = await context.request.post(`${base}/api/mcp/servers`, {
    data: { name: 'weather-tools', enabled: true, transport: { type: 'stdio', command: 'weather-mcp', args: [], env: {} } },
  })
  assert.ok(mcp.ok(), await mcp.text())

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const palette = page.getByRole('dialog', { name: 'Rechercher', exact: true })
  const input = palette.getByRole('textbox')
  const family = (label) => palette.getByText(label, { exact: true })
  const row = (name) => palette.getByRole('button', { name })
  const selected = async () => (await palette.locator('[data-active="true"]').innerText()).split('\n')[0]
  const search = async (text) => {
    await input.fill(text)
    // Les fichiers arrivent du serveur après le délai de frappe : on attend le calme.
    await page.waitForTimeout(300)
    await palette.locator('svg.animate-spin').waitFor({ state: 'detached' })
  }

  // Le raccourci n'est écouté qu'une fois l'application montée.
  const open = async (path) => {
    if (path) {
      await page.goto(`${base}${path}`)
      // Le fil affiché dit que l'application est montée, au large comme au doigt.
      await page.getByText(hero.title).first().waitFor()
    }
    await page.keyboard.press('Control+k')
    await input.waitFor()
  }

  await open(`/p/${nimbus.id}/c/${hero.id}`)

  // Une seule saisie, toutes les familles : le fichier vient du worktree de la conversation.
  await search('forecast')
  for (const label of ['Conversations', 'Fichiers', 'Skills']) await family(label).waitFor()
  await row(/forecast-cache\.ts/).first().waitFor()
  await row(/forecast-debugging/).waitFor()
  if (shots) await page.screenshot({ path: join(shots, 'palette-forecast.png') })

  // Les serveurs MCP et les réglages ont leur famille.
  await search('weather')
  await family('Serveurs MCP').waitFor()
  await row(/weather-tools/).waitFor()
  await search('thème')
  await row(/Apparence/).waitFor()

  // Le flou ne pioche pas une lettre par mot.
  await search('pwr')
  assert.equal(await row(/Approvals/).count(), 0)

  // `/` : les fichiers de tous les projets, chacun nommé avec son projet.
  await search('/readme')
  const readmes = await palette.getByRole('button', { name: /README\.md/ }).allInnerTexts()
  for (const name of ['Nimbus', 'Atlas API']) {
    assert.ok(readmes.some((text) => text.includes(name)), `${name} absent : ${readmes.join(' | ')}`)
  }
  // Le nom d'un projet restreint.
  await search('/atlas readme')
  assert.deepEqual(
    (await palette.getByRole('button', { name: /README\.md/ }).allInnerTexts()).map((text) => text.includes('Atlas API')),
    [true],
  )

  // Un fichier du projet courant s'ouvre dans le panneau de la conversation, sans la quitter.
  await search('/forecast-cache')
  assert.equal(await selected(), 'forecast-cache.ts')
  await page.keyboard.press('Enter')
  await palette.waitFor({ state: 'detached' })
  await page.locator('[data-panel="workspace"] [data-editor-file="src/lib/forecast-cache.ts"]').waitFor()
  assert.equal(new URL(page.url()).pathname, `/p/${nimbus.id}/c/${hero.id}`)

  // Un fichier d'un autre projet : son board, panneau ouvert sur le fichier.
  await open()
  await search('/atlas readme')
  await page.keyboard.press('Enter')
  await page.locator('[data-panel="workspace"] [data-editor-file="README.md"]').waitFor()
  assert.equal(new URL(page.url()).pathname, `/p/${atlas.id}/board`)

  // Un skill ouvre sa page.
  await open()
  await search('forecast-debugging')
  await row(/forecast-debugging/).click()
  await page.waitForURL(/\/skills\//)

  // Au téléphone : plein écran, rien ne déborde.
  await page.setViewportSize({ width: 390, height: 844 })
  await open(`/p/${nimbus.id}/c/${hero.id}`)
  await search('forecast')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const box = await palette.boundingBox()
  assert.equal(Math.round(box.width), 390)
  if (shots) await page.screenshot({ path: join(shots, 'palette-mobile.png') })
  await palette.getByRole('button', { name: 'Fermer la recherche', exact: true }).click()
  await palette.waitFor({ state: 'detached' })

  assert.deepEqual(errors, [])
  console.log(`OK : toutes les familles d'une saisie, MCP, réglages, flou, fichiers de tous les projets, ouverture dans le bon panneau, skill, téléphone${shots ? ` ; captures dans ${shots}` : ''}`)
} finally {
  await browser?.close()
  await Promise.all(processes.map(async (child) => {
    if (child.exitCode !== null) return
    const stopped = once(child, 'exit')
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
    await stopped
    clearTimeout(timer)
  }))
  await rm(data, { recursive: true, force: true })
}
