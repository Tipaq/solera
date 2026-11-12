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

/*
 * L'onglet Terminaux du panneau, sur le cadre commun (carte #223, PTER-1 à 3).
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas :
 *
 * - **la ligne d'outils tient sur 48 px** avec ses pastilles, du panneau large au
 *   téléphone : six shells ne la font pas passer à la ligne, ils défilent ;
 * - **l'état vide dit où le shell s'ouvrira**, et c'est vrai : le worktree pour un fil
 *   qui en a un, la racine du projet pour un fil qui n'en a pas ;
 * - **un shell emporté par un redémarrage du serveur** se signale en bande ambre et se
 *   relance là où il tournait — il faut redémarrer le vrai serveur pour le voir ;
 * - **une erreur** passe en bande rouge, annoncée tout de suite.
 *
 * Les images sortent dans `docs/audits/2026-11-page-projet-v2/223-terminaux/`, une par
 * bloc, en 1280 et 390 px.
 *
 * Playwright a besoin de ses bibliothèques, qui ne sont pas dans le système :
 *   export LD_LIBRARY_PATH="$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu"
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-terminals-check-'))
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
  delete env.SOLERA_PROCESS_ORIGIN
  delete env.SOLERA_INSTALL_DIR
  const api = `http://127.0.0.1:${apiPort}`
  let server = run(['--import', 'tsx', 'src/main.ts'], serverDir, env)
  const vite = run([join(webDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], webDir, env)
  const base = `http://127.0.0.1:${webPort}`
  await Promise.all([ready(`${api}/api/health`, server), ready(base, vite)])
  const seed = run(['--import', 'tsx', 'src/cli/demo-seed.ts'], serverDir, env)
  const [seedCode] = await once(seed, 'exit')
  assert.equal(seedCode, 0, seed.diagnostics)

  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript((origin) => {
    if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = async () => assert.ok((await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })).ok())
  await login()

  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const nimbus = projects.find((entry) => entry.name === 'Nimbus')
  assert.ok(nimbus, 'le projet de démo Nimbus est la matière de cette suite')
  const threads = await (await context.request.get(`${base}/api/projects/${nimbus.id}/conversations`)).json()
  const inWorktree = threads.find((entry) => entry.title === 'Add offline caching for forecasts')
  assert.ok(inWorktree?.worktreeId, 'un fil dans un worktree')
  const atRoot = threads.find((entry) => !entry.worktreeId && !entry.archived)
  assert.ok(atRoot, 'un fil à la racine du projet')

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-11-page-projet-v2/223-terminaux')
  await mkdir(shots, { recursive: true })

  const panel = page.locator('[data-panel="workspace"]')
  const line = () => panel.locator('[data-terminals-line]')
  // La largeur du panneau accosté se règle à la poignée, qui l'écrit dans le stockage
  // local : on la pose là et on recharge, plutôt que de simuler un glissement au pixel.
  const openTerminals = async (thread, width = 640) => {
    await page.goto(`${base}/p/${nimbus.id}/c/${thread.id}`)
    await page.evaluate((value) => localStorage.setItem('solera.panelDockedWidth', String(value)), width)
    await page.reload()
    const open = page.getByRole('button', { name: 'Ouvrir le panneau', exact: true })
    await open.waitFor()
    await open.click()
    await panel.waitFor()
    await panel.getByRole('button', { name: 'Terminaux', exact: true }).click()
    await line().waitFor()
  }
  /** La ligne d'outils : 48 px, rien qui déborde ni ne passe à la ligne. */
  const oneLine = async (label) => {
    const box = await line().evaluate((node) => {
      const bar = node.firstElementChild
      return { height: bar.getBoundingClientRect().height, overflow: bar.scrollWidth - bar.clientWidth }
    })
    assert.equal(box.height, 48, `${label} : la ligne d'outils fait 48 px`)
    assert.ok(box.overflow <= 0, `${label} : rien ne déborde de la ligne (${box.overflow} px)`)
  }
  const pill = (title) => line().locator('[data-terminal-pill]').filter({ hasText: title })
  const shot = async (name, target) =>
    page.screenshot({ animations: 'disabled', path: join(shots, name), clip: await target.boundingBox() })

  // ─── PTER-2 : aucun terminal, un état centré qui dit où il s'ouvrira ─────────
  await openTerminals(inWorktree)
  await line().getByText('Terminaux', { exact: true }).waitFor()
  const empty = panel.locator('[data-terminals-empty]')
  await empty.getByText('Aucun terminal ouvert', { exact: true }).waitFor()
  await empty.getByText('Il s’ouvre dans le worktree de cette conversation.', { exact: true }).waitFor()
  const create = empty.getByRole('button', { name: 'Nouveau terminal', exact: true })
  const [panelBox, buttonBox] = [await panel.boundingBox(), await create.boundingBox()]
  const offset = Math.abs(buttonBox.x + buttonBox.width / 2 - (panelBox.x + panelBox.width / 2))
  assert.ok(offset <= 2, `le bouton est centré dans l'onglet (${offset} px)`)
  assert.equal(Math.round(buttonBox.height), 36, 'le bouton a la hauteur de Button sm')
  assert.equal(await line().getByRole('button', { name: 'Nouveau terminal', exact: true }).count(), 1, '« + » au bout de la ligne')
  await oneLine('vide')
  await shot('1280-vide.png', panel)

  await openTerminals(atRoot)
  await empty.getByText('Il s’ouvre à la racine du projet.', { exact: true }).waitFor()
  console.log('OK : état vide centré, et il dit où le shell s’ouvrira.')

  // ─── PTER-1 : les shells en pastilles dans la ligne d'outils ─────────────────
  await openTerminals(inWorktree)
  await create.click()
  await line().locator('[data-terminal-pill]').first().waitFor()
  assert.equal(await empty.count(), 0, 'l’état vide s’en va')
  await line().getByText('1', { exact: true }).waitFor()
  await line().getByRole('button', { name: 'Nouveau terminal', exact: true }).click()
  await line().getByText('2', { exact: true }).waitFor()
  const pills = line().locator('[data-terminal-pill]')
  assert.equal(await pills.count(), 2)
  // Le nouveau devient l'actif : cliquer sur « + » sans rien voir changer ferait croire
  // que rien ne s'est passé.
  const second = pills.nth(1).locator('button[aria-pressed]')
  assert.equal(await second.getAttribute('aria-pressed'), 'true', 'le nouveau shell est l’actif')
  assert.equal(await pills.nth(0).locator('button[aria-pressed]').getAttribute('aria-pressed'), 'false')
  // Le dossier du shell, sous son nom : celui du worktree.
  await pills.nth(0).getByText('feat-offline-cache', { exact: true }).waitFor()
  // Vivant : le point vert, et le nom accessible le dit.
  await pills.nth(0).getByText('Shell actif', { exact: true }).waitFor({ state: 'attached' })
  const pillBox = await pills.nth(0).boundingBox()
  assert.equal(Math.round(pillBox.height), 36, 'une pastille a la hauteur des outils')
  // ✕ au survol seulement, à la souris.
  const close = pills.nth(0).getByRole('button', { name: /^Fermer / })
  assert.equal(await close.evaluate((node) => getComputedStyle(node).opacity), '0', '✕ caché hors survol')
  await pills.nth(0).hover()
  await page.waitForFunction((node) => getComputedStyle(node).opacity === '1', await close.elementHandle())
  await oneLine('deux shells, 40 rem')
  await shot('1280-pastilles.png', line())
  await pills.nth(0).locator('button[aria-pressed]').click()
  assert.equal(await pills.nth(0).locator('button[aria-pressed]').getAttribute('aria-pressed'), 'true', 'une pastille choisit son shell')
  await close.click()
  await line().getByText('1', { exact: true }).waitFor()
  assert.equal(await pills.count(), 1)
  console.log('OK : pastilles, compte, actif, ✕ au survol, fermeture.')

  // Au plafond, « + » se grise et dit pourquoi ; six shells tiennent sur une ligne.
  for (let i = 0; i < 5; i++) {
    const response = await context.request.post(`${base}/api/projects/${nimbus.id}/terminals`, { data: { conversationId: inWorktree.id } })
    assert.equal(response.status(), 201)
  }
  await openTerminals(inWorktree)
  await line().getByText('6', { exact: true }).waitFor()
  const plus = line().getByRole('button', { name: 'Nouveau terminal', exact: true })
  assert.equal(await plus.getAttribute('aria-disabled'), 'true', 'au plafond, « + » est désarmé')
  // Et il dit pourquoi : désarmé, pas `disabled`, sinon l'infobulle ne paraîtrait jamais.
  await plus.hover()
  await page.getByRole('tooltip').filter({ hasText: 'Maximum 6 terminaux par projet' }).waitFor()
  // Playwright tient un bouton aria-disabled pour inerte : on force le clic pour vérifier qu'il l'est.
  await plus.click({ force: true })
  await delay(500)
  assert.equal(await line().locator('[data-terminal-pill]').count(), 6, 'un clic au plafond n’ouvre rien')
  await oneLine('six shells, 40 rem')
  await openTerminals(inWorktree, 352)
  await oneLine('six shells, 22 rem')
  await shot('1280-six-22rem.png', line())
  console.log('OK : au plafond, « + » désactivé ; six shells sur une ligne.')

  // ─── PTER-3 : erreur en bande rouge ──────────────────────────────────────────
  // Un shell de moins pour que « + » réponde, et un refus du serveur simulé.
  const list = await (await context.request.get(`${base}/api/projects/${nimbus.id}/terminals`)).json()
  for (const terminal of list.slice(1)) {
    await context.request.delete(`${base}/api/projects/${nimbus.id}/terminals/${terminal.id}`)
  }
  await openTerminals(inWorktree)
  await page.route(`**/api/projects/${nimbus.id}/terminals`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'terminals_check', message: 'Pas de shell pour ce test.' } }) })
      : route.fallback())
  await line().getByRole('button', { name: 'Nouveau terminal', exact: true }).click()
  const alert = panel.getByRole('alert').filter({ hasText: 'Pas de shell pour ce test.' })
  await alert.waitFor()
  assert.match(await alert.innerText(), /Pas de shell pour ce test\./)
  assert.equal(await alert.evaluate((node) => node.previousElementSibling?.hasAttribute('data-terminals-line')), true, 'la bande est juste sous la ligne d’outils')
  await shot('1280-erreur.png', alert)
  await page.unroute(`**/api/projects/${nimbus.id}/terminals`)
  console.log('OK : une erreur passe en bande rouge sous la ligne.')

  // ─── PTER-3 : interrompu par un redémarrage, bande ambre et « Relancer ici » ──
  server.kill('SIGTERM')
  await once(server, 'exit')
  server = run(['--import', 'tsx', 'src/main.ts'], serverDir, env)
  await ready(`${api}/api/health`, server)
  await login()
  await openTerminals(inWorktree)
  const notice = panel.getByRole('status').filter({ hasText: 'Shell interrompu' })
  await notice.waitFor()
  await shot('1280-interrompu.png', notice)
  await notice.getByRole('button', { name: 'Relancer ici', exact: true }).click()
  await line().getByText('2', { exact: true }).waitFor()
  assert.equal(await notice.count(), 0, 'le shell relancé est vivant : la bande s’en va')
  console.log('OK : un shell interrompu se signale en bande ambre et se relance.')

  // ─── Au téléphone : la ligne tient, l'état vide reste centré ─────────────────
  for (const terminal of await (await context.request.get(`${base}/api/projects/${nimbus.id}/terminals`)).json()) {
    await context.request.delete(`${base}/api/projects/${nimbus.id}/terminals/${terminal.id}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await openTerminals(inWorktree)
  await empty.getByText('Aucun terminal ouvert', { exact: true }).waitFor()
  await oneLine('téléphone, vide')
  await shot('390-vide.png', panel)
  await empty.getByRole('button', { name: 'Nouveau terminal', exact: true }).click()
  await line().locator('[data-terminal-pill]').first().waitFor()
  await line().getByRole('button', { name: 'Nouveau terminal', exact: true }).click()
  await line().getByText('2', { exact: true }).waitFor()
  await oneLine('téléphone, deux shells')
  await shot('390-pastilles.png', line())
  console.log('OK : au téléphone, la ligne tient sur 48 px.')

  assert.deepEqual(errors, [], 'aucune erreur de page')
  console.log('Captures :', shots)
} finally {
  if (browser) await browser.close()
  for (const child of processes) child.kill('SIGKILL')
  await rm(data, { recursive: true, force: true })
}
