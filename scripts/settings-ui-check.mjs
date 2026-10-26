import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

// Les réglages des agents (#120) : les trois groupes de la modale, les demandes à Solera
// en trois états au compte, les anciennes adresses, et l'héritage au projet — hérité,
// modifié ici, rendu à l'héritage. Vrais composants et vraie API, base temporaire,
// aucun CLI lancé.
// Les réglages sont une modale : l'adresse /settings/<section> l'ouvre puis rend la main,
// donc on y retourne par goto plutôt que par reload.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-settings-check-'))
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
  await writeFile(
    config,
    '[agents.claude]\nenabled = false\n[agents.codex]\nenabled = false\n[mcp]\ncardFiling = true\nprojectFiling = true\ndecisions = true\n',
  )
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(homedir(), '.cache/solera-settings-shots')
  await mkdir(shots, { recursive: true })
  /** Une image par bloc, pas la page entière : une planche n'est pas lisible. */
  const shot = (locator, name) => locator.screenshot({ path: join(shots, `${name}.png`) })
  const settings = async () => (await context.request.get(`${base}/api/me/settings`)).json()
  const until = async (read, ok, what) => {
    for (let tries = 0; tries < 50; tries++) {
      if (ok(await read())) return
      await delay(100)
    }
    throw new Error(`jamais arrivé : ${what}`)
  }
  // La carte la plus profonde qui porte à la fois le titre et des réglages : la carte elle-même.
  const card = (title) =>
    page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      .filter({ has: page.locator('[role=radiogroup], [role=combobox]') })
      .last()

  // Les trois groupes (Q31), et l'ordre des agents.
  await page.goto(`${base}/settings/permissions`)
  for (const group of ['Toi', 'Les agents', "L'instance"]) {
    await page.getByRole('heading', { name: group, exact: true }).waitFor()
  }
  const dialog = page.getByRole('dialog')
  const nav = await dialog.getByRole('button').allTextContents()
  const order = ['Permissions', 'Modèles par défaut', 'Abonnements', 'Consignes', 'Skills', 'Serveurs MCP']
  const positions = order.map((label) => nav.findIndex((text) => text.startsWith(label)))
  assert.ok(positions.every((position) => position >= 0), `sections des agents : ${nav.join(' | ')}`)
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'ordre des sections des agents')
  assert.ok(nav.some((text) => text.startsWith('Utilisateurs')), 'Utilisateurs, ex-« Comptes »')
  assert.ok(nav.some((text) => text.startsWith('Profil')), 'Profil, ex-« Compte »')

  // Une demande à Solera, en trois états, écrite au compte en commun.
  const requests = card("Ce que l’agent demande à Solera")
  await requests.getByRole('radiogroup', { name: 'Décisions' }).getByRole('radio', { name: 'Demande mon accord' }).click()
  await requests.getByRole('radiogroup', { name: 'Délai d’une décision' }).waitFor()
  await until(settings, (stored) => stored.agentLayer.shared.decisions === 'ask', 'décisions au compte')
  await shot(requests, '01-demandes-compte')
  await shot(card('Le réflexe du CLI'), '02-reflexe-compte')

  // Les adresses d'avant mènent aux sections qui les remplacent.
  await page.goto(`${base}/settings/cli`)
  await page.getByRole('heading', { name: 'Modèles par défaut', level: 2 }).or(page.getByRole('heading', { name: 'Modèles par défaut', exact: true })).first().waitFor()
  await page.getByRole('combobox', { name: 'Modèle' }).waitFor()
  await shot(card('Modèle, effort et abonnement'), '03-modeles')
  await page.goto(`${base}/settings/comptes-codex`)
  await page.getByRole('tab', { name: 'Codex', selected: true }).waitFor()

  // Le projet : hérité du compte, modifié ici, puis rendu à l'héritage (Q33).
  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const project = projects.find((entry) => entry.isOwner)
  assert.ok(project, 'un projet dont alex est propriétaire')
  await page.goto(`${base}/p/${project.id}/settings`)
  await page.getByRole('heading', { name: 'Réglages des agents pour ce projet' }).waitFor()
  const projectRequests = card("Ce que l’agent demande à Solera")
  // La ligne elle-même : le plus petit bloc qui porte le choix.
  const filing = projectRequests.locator('div').filter({ has: page.getByRole('radiogroup', { name: 'Rangement de carte' }) }).last()
  await filing.getByText('Hérité du compte', { exact: true }).waitFor()
  await filing.getByRole('radio', { name: 'Interdit' }).click()
  await filing.getByText('Modifié ici', { exact: true }).waitFor()
  const project1 = async () => (await (await context.request.get(`${base}/api/projects`)).json()).find((entry) => entry.id === project.id)
  await until(project1, (current) => current.configLayer.shared.cardFiling === 'deny', 'rangement de carte au projet')
  // Ce qu'il ne change pas reste celui du compte : les décisions réglées plus haut.
  assert.equal(await projectRequests.getByRole('radiogroup', { name: 'Décisions' }).getByRole('radio', { name: 'Demande mon accord' }).getAttribute('aria-checked'), 'true')
  await shot(projectRequests, '04-demandes-projet')
  await filing.getByRole('button', { name: 'Revenir au réglage du compte' }).click()
  await filing.getByText('Hérité du compte', { exact: true }).waitFor()
  await until(project1, (current) => !('cardFiling' in current.configLayer.shared), 'retour à l’héritage')

  // Au téléphone : la section tient dans la largeur.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/settings/permissions`)
  await page.getByRole('radiogroup', { name: 'Décisions' }).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Permissions débordent au téléphone')

  assert.deepEqual(errors, [])
  console.log(`OK : trois groupes, trois états au compte, anciennes adresses, héritage au projet, téléphone. Captures dans ${shots}.`)
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
