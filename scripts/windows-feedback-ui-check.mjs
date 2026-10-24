import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// Retours d'un utilisateur Windows de Sillage (20 oct. 2026), repris chez nous :
// avancement de l'installation d'un CLI, CLI manquants masquables, sélection de texte
// dans les cellules d'un tableau, clic droit dans la colonne. Vrais composants, vraie
// API, base temporaire. Codex et Grok sont déclarés sur des binaires introuvables pour
// forcer leur absence. Les captures vont dans WINDOWS_FEEDBACK_SHOTS, ou dans un
// dossier temporaire.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-feedback-check-'))
const shots = process.env.WINDOWS_FEEDBACK_SHOTS ?? (await mkdtemp(join(tmpdir(), 'solera-feedback-shots-')))
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

async function newContext(base, options) {
  const context = await browser.newContext({ locale: 'fr-FR', serviceWorkers: 'block', ...options })
  await context.addInitScript((origin) => {
    if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  return context
}

try {
  const apiPort = await freePort()
  const webPort = await freePort()
  const config = join(data, 'config.toml')
  await writeFile(config, '[agents.opencode]\nenabled = false\n[agents.codex]\nbinary = "/nonexistent/codex"\n[agents.grok]\nbinary = "/nonexistent/grok"\n')
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

  browser = await chromium.launch({ channel: 'chromium', chromiumSandbox: true })
  const context = await newContext(base, { viewport: { width: 1440, height: 1000 } })
  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const project = projects.find((entry) => entry.name === 'Nimbus')
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const choices = () => page.locator('input[name="draft-agent"]').count()
  // Le bouton du rang d'un CLI, visé par son texte : Claude Code peut manquer lui aussi
  // sur la machine qui joue la suite, et son rang vient en premier.
  const dismiss = (label) =>
    page.getByText(`${label} n'est pas installé`).locator('xpath=..').getByRole('button', { name: 'Ne plus proposer' }).click()
  const hiddenLine = (labels) => page.getByText(`Masqués tant qu’ils ne sont pas installés : ${labels}.`)

  // 1. Deux CLI manquants, deux rangs « Installer », chacun masquable.
  await page.goto(`${base}/p/${project.id}/c/new?agent=claude`)
  await page.getByText(/Codex n'est pas installé/).waitFor()
  await page.getByText(/Grok Build n'est pas installé/).waitFor()
  assert.equal(await choices(), 4, 'claude, codex, opencode (coupé) et grok proposés')
  await page.screenshot({ path: join(shots, 'install-rows.png') })
  await dismiss('Codex')
  await page.getByText(/Codex n'est pas installé/).waitFor({ state: 'detached' })
  await hiddenLine('Codex').waitFor()
  assert.equal(await choices(), 3, 'codex retiré du choix')
  await dismiss('Grok Build')
  await hiddenLine('Codex, Grok Build').waitFor()
  assert.equal(await choices(), 2, 'restent claude et opencode coupé')
  // Le masque est au compte : il survit au rechargement.
  await page.reload()
  await hiddenLine('Codex, Grok Build').waitFor()
  const settings = await (await context.request.get(`${base}/api/me/settings`)).json()
  assert.deepEqual(settings.hiddenAgents, ['codex', 'grok'])
  await page.screenshot({ path: join(shots, 'install-hidden.png') })
  await page.getByRole('button', { name: 'Afficher', exact: true }).click()
  await page.getByText(/Codex n'est pas installé/).waitFor()
  assert.equal(await choices(), 4)

  // 2. L'avancement d'une installation : l'état « running » est injecté dans la
  //    réponse de la sonde, l'installation réelle durant plusieurs minutes.
  await page.route('**/api/agents', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    for (const entry of body.agents) {
      if (entry.agent === 'codex') {
        entry.install = { status: 'running', version: entry.preferredVersion, startedAt: Date.now() - 83_000, fetched: 14, current: 'codex-0.163.0.tgz' }
      }
    }
    await route.fulfill({ response, json: body })
  })
  await page.reload()
  await page.getByRole('progressbar', { name: /Installation de Codex/ }).waitFor()
  await page.getByText(/Téléchargement de codex-0\.163\.0\.tgz · 14 fichiers reçus/).waitFor()
  await page.getByText(/^1 min 2[3-6] s$/).waitFor()
  assert.equal(await page.getByText(/Codex n'est pas installé/).count(), 0, 'le rang laisse la place à l’avancement')
  await page.screenshot({ path: join(shots, 'install-progress.png') })
  await page.unroute('**/api/agents')

  // 3. Clic droit sur une conversation de la colonne, puis sur l'en-tête d'un projet :
  //    le menu du « ⋯ », entrées comprises.
  const row = page.getByRole('link', { name: 'Radar tile prefetching' }).first()
  await row.waitFor()
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Renommer' }).waitFor()
  await page.getByRole('menuitem', { name: 'Supprimer' }).waitFor()
  await page.screenshot({ path: join(shots, 'context-conversation.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('menuitem', { name: 'Renommer' }).waitFor({ state: 'detached' })
  // `force` : dnd-kit pose aria-disabled sur un en-tête qu'on ne peut pas déplacer,
  // que Playwright lit comme un élément inactif.
  await page.getByRole('link', { name: 'Nimbus', exact: true }).first().click({ button: 'right', force: true })
  await page.getByRole('menuitem', { name: 'Board' }).waitFor()
  await page.getByRole('menuitem', { name: 'Renommer' }).waitFor()
  await page.screenshot({ path: join(shots, 'context-project.png') })
  await page.keyboard.press('Escape')

  // 4. Une sélection commencée dans une cellule n'en sort pas.
  await row.click()
  const cell = page.locator('.sg-table-scroll td', { hasText: 'Tablet' }).first()
  await cell.waitFor()
  await cell.scrollIntoViewIfNeeded()
  const from = await cell.boundingBox()
  const target = await page.locator('.sg-table-scroll td', { hasText: '420 ms' }).first().boundingBox()
  await page.mouse.move(from.x + 4, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + from.height / 2, { steps: 4 })
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? '')
  await page.mouse.up()
  assert.equal(selected, 'Tablet (1024×768)', `sélection confinée à la cellule, obtenu « ${selected} »`)
  await page.screenshot({ path: join(shots, 'table-selection.png') })

  // 5. Au téléphone : le clic droit n'ouvre rien de plus, le « ⋯ » reste la voie ; la
  //    page de brouillon tient dans la largeur avec ses rangs d'installation.
  const mobile = await newContext(base, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const phone = await mobile.newPage()
  phone.on('pageerror', (error) => errors.push(error.message))
  await phone.goto(`${base}/p/${project.id}/c/new?agent=claude`)
  await phone.getByText(/Codex n'est pas installé/).waitFor()
  await delay(800)
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'pas de débordement horizontal')
  await phone.screenshot({ path: join(shots, 'mobile.png') })
  await mobile.close()

  assert.deepEqual(errors, [])
  console.log(`windows-feedback-ui-check: ok — captures dans ${shots}`)
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
