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

// Vrais composants et vraie API, dans une base temporaire. Aucun CLI n'est activé.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-ui-check-'))
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
    // La visionneuse PDF du navigateur n'expose pas le stockage de l'application.
    if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const project = projects.find((entry) => entry.name === 'Nimbus')
  const conversations = await (await context.request.get(`${base}/api/projects/${project.id}/conversations`)).json()
  const hero = conversations.find((entry) => entry.title === 'Add offline caching for forecasts')
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-09-19-sidebar')
  await mkdir(shots, { recursive: true })
  // Une longue liste pour vérifier le défilement et le « N autres sessions… », sans
  // toucher à la base réelle.
  await page.route('**/api/conversations', async (route) => {
    const response = await route.fetch()
    const entries = await response.json()
    // `idle` et lues : une session active ne figure pas dans le groupe de son projet,
    // elle est déjà dans l'activité au-dessus.
    // Un fil libre : il n'appartient à aucun projet, et c'est le groupe *Sans projet*
    // qui doit lui donner un domicile dans la colonne.
    const free = { ...hero, id: 'fixture-libre', projectId: null, title: 'Fil sans projet', status: 'idle', lastReadSeq: hero.lastNotableSeq, archivedAt: null }
    await route.fulfill({ json: [...entries, free, ...Array.from({ length: 30 }, (_, i) => ({ ...hero, id: `fixture-${i}`, title: `Session de travail ${i + 1}`, status: 'idle', lastReadSeq: hero.lastNotableSeq, archivedAt: null }))] })
  })

  await page.goto(`${base}/p/${project.id}/c/${hero.id}`)
  const places = page.getByRole('navigation', { name: 'Lieux' })
  const column = page.locator('aside')
  await places.waitFor()

  // Les lieux : une liste verticale, toujours visible, et le compte en une ligne.
  for (const name of ['Fils', 'Projets', 'Planifiées']) {
    await places.getByRole('button', { name: new RegExp(`^${name}`) }).waitFor()
  }
  // L'activité est fixe : faire défiler la zone basse ne la déplace pas.
  const activity = column.getByRole('group', { name: 'Suivi des conversations' })
  await activity.waitFor()
  // Attendre qu'elle soit remplie avant de la mesurer : ses lignes viennent du socket,
  // qui arrive après le premier rendu, et une mesure prise sur « Aucune session en
  // cours » ne vaut rien pour la comparaison d'après.
  await activity.getByRole('link').first().waitFor()
  const before = await activity.boundingBox()

  // Lieu *Fils* : l'historique daté. Une tranche au moins porte des lignes.
  await places.getByRole('button', { name: /^Fils/ }).click()
  await column.getByRole('heading', { name: /Aujourd’hui|Hier|7 derniers jours|Plus ancien/ }).first().waitFor()
  await column.getByRole('button', { name: 'Tout l’historique…' }).waitFor()

  // Lieu *Projets* : l'arbre, le centre suit, et la conversation ouverte reste ouverte.
  await places.getByRole('button', { name: /^Projets/ }).click()
  await column.getByRole('link', { name: /^Board/ }).first().waitFor()
  await column.getByRole('link', { name: 'Nouveau projet…' }).waitFor()
  const more = column.getByRole('button', { name: /autres sessions…$/ })
  await more.click()
  await column.getByRole('link', { name: /Session de travail 30/ }).waitFor()
  assert.deepEqual(await activity.boundingBox(), before, 'l’activité doit rester fixe')
  await column.getByRole('button', { name: 'Réduire la liste' }).click()
  assert.equal(await column.getByRole('link', { name: /Session de travail 30/ }).count(), 0)

  // *Sans projet* ouvre la liste, avant les projets : une boîte de réception, et non un
  // cas particulier qu'on range en bas. Son lien n'a pas de segment de projet — écrire
  // `/p/null/c/<id>` donnerait une adresse qui se charge et ne trouve rien.
  const free = column.getByRole('button', { name: 'Sans projet', exact: true })
  await free.waitFor()
  assert.equal(await column.locator(`a[href="/c/fixture-libre"]`).count(), 1)
  assert.equal(await column.locator('a[href^="/p/null/"]').count(), 0)
  const order = await column.evaluate((node) => {
    const groups = [...node.querySelectorAll('li')].filter((item) => item.querySelector(':scope > div'))
    return groups[0]?.textContent?.startsWith('Sans projet') ?? false
  })
  assert.equal(order, true, '*Sans projet* doit être le premier groupe')
  // La zone basse est la seule partie qui défile : la remonter avant la capture, sinon
  // l'image s'ouvre là où le dépli l'a laissée et le premier groupe est hors champ.
  await column.evaluate((node) => {
    for (const child of node.querySelectorAll('*')) if (child.scrollTop > 0) child.scrollTop = 0
  })
  await page.screenshot({ path: join(shots, 'lieu-projets.png') })

  // Lieu *Planifiées* : les tâches par échéance, tous projets confondus.
  await places.getByRole('button', { name: /^Planifiées/ }).click()
  await column.getByRole('heading', { name: /Aujourd’hui|Cette semaine|Plus tard|En sommeil/ }).first()
    .or(column.getByText('Aucune tâche planifiée')).waitFor()

  // La modale d'activité : quatre filtres qui portent leur compte, plus un par projet.
  await activity.getByRole('button', { name: /^Activité/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Activité globale' })
  for (const name of ['Tout', 'À débloquer', 'En cours', 'Non lues']) {
    await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).waitFor()
  }
  await dialog.getByRole('button', { name: 'Tous les projets' }).click()
  await page.getByRole('menuitem', { name: 'Nimbus' }).click()
  await page.screenshot({ path: join(shots, 'modale-activite.png') })
  await page.keyboard.press('Escape')

  // Le menu du compte : Services et Réglages y sont entrés, la colonne n'en garde qu'une.
  assert.equal(await column.getByRole('link', { name: 'Services' }).count(), 0)
  await column.getByRole('button', { name: 'Alex' }).click()
  await page.getByRole('menuitem', { name: 'Services' }).waitFor()
  await page.getByRole('menuitem', { name: 'Réglages' }).waitFor()
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).waitFor()
  await page.screenshot({ path: join(shots, 'menu-compte.png') })
  await page.keyboard.press('Escape')

  // Le tiroir au doigt : rien ne déborde sur la largeur.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click()
  await places.waitFor()
  // Le tiroir entre par une translation : capturer avant la fin la montre à moitié sortie.
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(shots, 'tiroir-mobile.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

  assert.deepEqual(errors, [])
  console.log('OK : lieux, historique daté, arbre des projets, planifiées, activité fixe et sa modale, menu du compte, tiroir mobile.')
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
