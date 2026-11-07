import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

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

  browser = await launchBrowser()
  const context = await newContext(base, { viewport: { width: 1440, height: 1000 } })
  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const project = projects.find((entry) => entry.name === 'Nimbus')
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Le choix du CLI du brouillon : une carte par CLI, celle d'un absent est un bouton
  // « Installer » doublé d'une croix « Ne plus proposer ». Visées par leur nom : Claude
  // Code peut manquer lui aussi sur la machine qui joue la suite.
  const picker = page.getByRole('group', { name: 'Agent', exact: true })
  const installCard = (label) => picker.getByRole('button', { name: new RegExp(`^${label} (Installer|Installation…)$`) })
  const dismiss = (label) => installCard(label).locator('xpath=..').getByRole('button', { name: 'Ne plus proposer' }).click()
  const hiddenLine = (labels) => picker.getByText(`Masqués tant qu’ils ne sont pas installés : ${labels}.`)

  // 1. Deux CLI manquants, deux cartes « Installer », chacune masquable ; OpenCode,
  //    coupé par la configuration, n'en a pas.
  await page.goto(`${base}/p/${project.id}/c/new?agent=claude`)
  await installCard('Codex').waitFor()
  await installCard('Grok Build').waitFor()
  assert.equal(await picker.getByText('OpenCode', { exact: true }).count(), 0, 'opencode coupé sans carte')
  await page.screenshot({ path: join(shots, 'install-rows.png') })
  await dismiss('Codex')
  await installCard('Codex').waitFor({ state: 'detached' })
  await hiddenLine('Codex').waitFor()
  await dismiss('Grok Build')
  await installCard('Grok Build').waitFor({ state: 'detached' })
  await hiddenLine('Codex, Grok Build').waitFor()
  // Le masque est au compte : il survit au rechargement.
  await page.reload()
  await hiddenLine('Codex, Grok Build').waitFor()
  const settings = await (await context.request.get(`${base}/api/me/settings`)).json()
  assert.deepEqual(settings.hiddenAgents, ['codex', 'grok'])
  await page.screenshot({ path: join(shots, 'install-hidden.png') })
  // Et se lève d'où on l'a posé.
  await picker.getByRole('button', { name: 'Afficher', exact: true }).click()
  await installCard('Codex').waitFor()
  await installCard('Grok Build').waitFor()
  await hiddenLine('Codex, Grok Build').waitFor({ state: 'detached' })

  // 2. L'avancement d'une installation : l'état « running » est injecté dans la
  //    réponse de la sonde, l'installation réelle durant plusieurs minutes. La carte
  //    du brouillon dit qu'elle tourne et perd sa croix ; l'avancement détaillé est
  //    dans l'onglet du CLI des réglages.
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
  await picker.getByRole('button', { name: 'Codex Installation…', exact: true }).waitFor()
  assert.ok(await installCard('Codex').isDisabled(), 'carte inactive pendant l’installation')
  assert.equal(await installCard('Codex').locator('xpath=..').getByRole('button', { name: 'Ne plus proposer' }).count(), 0)
  await page.screenshot({ path: join(shots, 'install-running.png') })
  await page.goto(`${base}/settings/comptes-codex`)
  await page.getByRole('tab', { name: 'Codex', selected: true }).waitFor()
  await page.getByRole('progressbar', { name: /Installation de Codex/ }).waitFor()
  await page.getByText(/Téléchargement de codex-0\.163\.0\.tgz · 14 fichiers reçus/).waitFor()
  await page.getByText(/^1 min 2[3-9] s$/).waitFor()
  await page.screenshot({ path: join(shots, 'install-progress.png') })
  await page.keyboard.press('Escape')
  await page.unroute('**/api/agents')
  await page.goto(`${base}/p/${project.id}/c/new?agent=claude`)

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
  //    page de brouillon tient dans la largeur avec ses cartes d'installation.
  const mobile = await newContext(base, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const phone = await mobile.newPage()
  phone.on('pageerror', (error) => errors.push(error.message))
  await phone.goto(`${base}/p/${project.id}/c/new?agent=claude`)
  await phone.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Codex Installer', exact: true }).waitFor()
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
