import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/*
 * Les trois pages de lieu : le tableau de bord d'un projet, Projets, Planifiées.
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas : que le bandeau du haut
 * dit ce qui réclame et **omet ce qui est à zéro**, que le board du tableau de bord
 * est bien celui de l'application — mêmes colonnes, mêmes tuiles — et que l'ancienne
 * page de réglages est toujours joignable depuis le `⋯` qui l'a reprise.
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-places-check-'))
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

  browser = await chromium.launch({ channel: 'chromium', chromiumSandbox: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript((origin) => {
    if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const nimbus = projects.find((entry) => entry.name === 'Nimbus')
  const docs = projects.find((entry) => entry.name === 'Docs')
  assert.ok(nimbus && docs)

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-10-12-pages-de-lieu')
  await mkdir(shots, { recursive: true })

  // ─── Le tableau de bord d'un projet ───────────────────────────────────────
  await page.goto(`${base}/p/${nimbus.id}`)
  await page.getByRole('heading', { name: 'Nimbus', exact: true, level: 2 }).waitFor()

  // Le board est celui de l'application : ses colonnes, et ses tuiles.
  for (const column of ['À faire', 'En cours', 'À vérifier', 'Terminé']) {
    await page.getByRole('region', { name: column, exact: true }).waitFor()
  }
  assert.equal(
    await page.getByRole('region', { name: 'Abandonné', exact: true }).count(),
    0,
    'Le résumé ne porte pas la colonne des abandons',
  )
  const cards = await (await context.request.get(`${base}/api/projects/${nimbus.id}/cards`)).json()
  const review = cards.find((entry) => entry.column === 'review')
  await page.locator(`[data-card-open="${review.id}"]`).waitFor()

  // Le bandeau dit ce qui réclame, et rien d'autre.
  const awaiting = page.getByRole('link', { name: /attend ta réponse/ })
  await awaiting.waitFor()
  assert.match(await awaiting.innerText(), /depuis/, 'La tuile d’attente dit depuis quand')
  await page.getByRole('link', { name: /à relire/ }).waitFor()
  assert.equal(
    await page.getByText(/cartes$/).count(),
    0,
    'Le bandeau ne porte aucun inventaire',
  )
  await page.screenshot({ animations: 'disabled', path: join(shots, 'dashboard-projet.png') })

  // La planification du projet suit en lignes.
  const schedules = await (await context.request.get(`${base}/api/schedules`)).json()
  const task = schedules.find((entry) => entry.projectId === nimbus.id)
  if (task) await page.getByRole('link', { name: new RegExp(task.name) }).first().waitFor()

  // Les réglages ont quitté la page et sont dans le `⋯`.
  await page.getByRole('button', { name: 'Actions du projet', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Réglages du projet', exact: true }).click()
  await page.getByRole('heading', { name: 'Réglages du projet', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, `/p/${nimbus.id}/settings`)

  // Un projet calme ne montre pas un bandeau vide, il le dit.
  await page.goto(`${base}/p/${docs.id}`)
  await page.getByText('Rien ne réclame ici.', { exact: true }).waitFor()

  // ─── La page Projets ──────────────────────────────────────────────────────
  await page.goto(`${base}/projects`)
  await page.getByRole('heading', { name: 'Projets', exact: true, level: 2 }).waitFor()
  for (const project of projects) {
    await page.getByRole('link', { name: new RegExp(project.name) }).first().waitFor()
  }
  assert.ok(
    (await page.getByText(nimbus.git ? nimbus.git.branch : 'main').count()) > 0,
    'Chaque ligne porte la branche du dépôt',
  )
  await page.screenshot({ animations: 'disabled', path: join(shots, 'page-projets.png') })

  // ─── La page Planifiées ───────────────────────────────────────────────────
  await page.goto(`${base}/schedules`)
  for (const header of ['Tâche', 'Cible', 'Fréquence', 'Prochaine', 'Dernier']) {
    await page.getByRole('columnheader', { name: header, exact: true }).waitFor()
  }
  const rows = page.getByRole('row')
  assert.equal(await rows.count(), schedules.length + 1, 'Une ligne par tâche, plus l’en-tête')
  const toggles = page.getByRole('switch')
  assert.equal(await toggles.count(), schedules.length)
  // L'interrupteur agit tout de suite, sans formulaire à valider.
  const first = schedules.find((entry) => entry.enabled)
  if (first) {
    await page.getByRole('switch', { name: `Activer « ${first.name} »`, exact: true }).click()
    await page.waitForFunction(
      (id) => fetch(`/api/schedules`).then((r) => r.json()).then((list) => list.find((e) => e.id === id)?.enabled === false),
      first.id,
    )
  }
  await page.screenshot({ animations: 'disabled', path: join(shots, 'page-planifiees.png') })

  // ─── Au doigt ─────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/p/${nimbus.id}`)
  await page.getByRole('region', { name: 'En cours', exact: true }).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'dashboard-mobile.png') })
  await page.goto(`${base}/projects`)
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'projets-mobile.png') })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/p/${nimbus.id}`)
  await page.getByRole('region', { name: 'En cours', exact: true }).waitFor()
  // Le thème se pose après la navigation : `goto` recharge le document et emporterait
  // l'attribut avec lui.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'dashboard-sombre.png') })

  assert.deepEqual(errors, [])
  console.log('OK : bandeau sans inventaire, board réel, réglages dans le ⋯, lignes de projets, table des planifiées, mobile ; captures dans ' + shots)
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
