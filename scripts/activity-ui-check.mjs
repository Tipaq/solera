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

  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', colorScheme: 'dark', serviceWorkers: 'block' })
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
  const shots = join(root, 'docs/audits/2026-10-07-activity')
  await mkdir(shots, { recursive: true })
  const atlas = projects.find((entry) => entry.name === 'Atlas API')
  const docs = projects.find((entry) => entry.name === 'Docs')
  const extraProject = { ...project, id: 'extra-project', name: 'Autre projet' }
  const fixtures = [
    { id: 'activity-a', projectId: project.id, title: 'Compiler la nouvelle interface', status: 'running' },
    { id: 'activity-b', projectId: project.id, title: 'Valider les migrations', status: 'awaiting_input' },
    { id: 'activity-c', projectId: atlas.id, title: 'Optimiser les requêtes', status: 'running' },
    { id: 'activity-d', projectId: atlas.id, title: 'Attendre le choix utilisateur', status: 'awaiting_input' },
    { id: 'activity-e', projectId: docs.id, title: 'Documenter les endpoints et revoir les exemples après les retours de l’équipe', status: 'running' },
    { id: 'activity-f', projectId: extraProject.id, title: 'Surveiller le build', status: 'running' },
    { id: 'activity-g', projectId: project.id, title: 'Relire les migrations SQLite', status: 'running' },
    { id: 'activity-h', projectId: atlas.id, title: 'Mesurer le temps de réponse', status: 'running' },
    { id: 'activity-i', projectId: docs.id, title: 'Reprendre la page Principes', status: 'running' },
  ].map((entry) => ({ ...hero, archivedAt: null, lastNotableSeq: 5, lastReadSeq: 0, ...entry }))
  await page.route('**/api/projects', async (route) => route.fulfill({ json: [...projects, extraProject] }))
  await page.route('**/api/conversations', async (route) => route.fulfill({ json: fixtures }))
  let socket
  await page.routeWebSocket('**/api/ws', (ws) => {
    socket = ws
    ws.onMessage((raw) => { if (JSON.parse(String(raw)).t === 'ping') ws.send(JSON.stringify({ t: 'pong' })) })
  })
  const pushStatus = (id, status, background = 0) => socket.send(JSON.stringify({ t: 'status', conversationId: id, status, background, warm: true, loops: 0, lastNotableSeq: 5, metrics: hero.metrics }))
  await page.goto(`${base}/p/${project.id}/board`)
  const activity = page.getByRole('group', { name: 'Suivi des conversations', exact: true })
  const header = activity.getByRole('button', { name: /^Activité/ })
  await header.waitFor()
  // L'en-tête porte les deux compteurs ; il n'y a plus ni repli ni second bouton.
  await activity.getByRole('button', { name: 'Activité 2 à débloquer 7 en cours', exact: true }).waitFor()
  // Sept lignes au plus, et le reste compté sur une ligne plutôt que listé.
  assert.equal(await activity.getByRole('link').count(), 7)
  await activity.getByRole('button', { name: '+ 2 autres sessions actives', exact: true }).waitFor()
  // Les attentes précèdent le travail en cours, sans déplier quoi que ce soit.
  assert.match(await activity.getByRole('link').first().innerText(), /Valider les migrations/)
  await activity.getByRole('link', { name: /Compiler la nouvelle interface/ }).waitFor()
  await page.screenshot({ path: join(shots, 'activity-expanded.png') })

  await header.click()
  const overview = page.getByRole('dialog', { name: 'Activité globale', exact: true })
  const all = overview.getByRole('button', { name: /^Tout / })
  const pressed = () => overview.locator('button[aria-pressed=true]').innerText()
  await overview.waitFor()
  // Quatre filtres qui portent leur compte, plus un filtre par projet.
  await overview.getByRole('button', { name: 'Tout 9', exact: true }).waitFor()
  await overview.getByRole('button', { name: 'À débloquer 2', exact: true }).waitFor()
  await overview.getByRole('button', { name: 'En cours 7', exact: true }).waitFor()
  // Le non-lu est suspendu tant qu'une session produit : seules les deux attentes
  // réclament une relecture, les sept qui tournent ne demandent rien encore.
  await overview.getByRole('button', { name: 'Non lues 2', exact: true }).waitFor()
  // Elle s'ouvre sur ce qui attend, et non sur l'inventaire : deux attentes, donc
  // « à débloquer » et ses deux lignes seules.
  assert.match(await pressed(), /^À débloquer/)
  assert.equal(await overview.getByRole('link').count(), 2)
  await all.click()
  assert.equal(await overview.getByRole('link').count(), 9)
  // Le projet s'écrit en clair : la place existe, contrairement à la colonne.
  await overview.getByText('Autre projet', { exact: true }).waitFor()
  await page.screenshot({ path: join(shots, 'activity-overview.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.screenshot({ path: join(shots, 'activity-overview-light.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })

  // Une fin de tour fait baisser le compteur, sans faire disparaître la session.
  pushStatus('activity-a', 'running')
  pushStatus('activity-a', 'idle')
  await overview.getByRole('button', { name: 'En cours 6', exact: true }).waitFor()
  await overview.getByRole('link', { name: /Compiler la nouvelle interface.*Tour terminé/ }).waitFor()
  // Le travail en arrière-plan compte même si le tour principal est au repos.
  pushStatus('activity-a', 'idle', 1)
  await overview.getByRole('button', { name: 'En cours 7', exact: true }).waitFor()
  await overview.getByRole('link', { name: /Compiler la nouvelle interface.*En arrière-plan/ }).waitFor()
  pushStatus('activity-a', 'error')
  await overview.getByRole('link', { name: /Compiler la nouvelle interface.*En erreur/ }).waitFor()

  // Les filtres se croisent avec celui du projet.
  await overview.getByRole('button', { name: 'À débloquer 2', exact: true }).click()
  assert.equal(await overview.getByRole('link').count(), 2)
  await overview.getByRole('button', { name: 'Tous les projets', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Atlas API', exact: true }).click()
  assert.equal(await overview.getByRole('link').count(), 1)
  await all.click()
  assert.equal(await overview.getByRole('link').count(), 3)
  await overview.getByRole('button', { name: 'Atlas API', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Tous les projets', exact: true }).click()
  assert.equal(await overview.getByRole('link').count(), 9)
  await overview.getByRole('button', { name: 'Fermer', exact: true }).click()

  // Une nouvelle conversation, lancée depuis un autre client, rejoint le total.
  fixtures.push({ ...fixtures[0], id: 'activity-new', title: 'Session démarrée ailleurs', status: 'running' })
  pushStatus('activity-new', 'running')
  await header.click()
  await all.click()
  await overview.getByRole('link', { name: /Session démarrée ailleurs/ }).waitFor()
  await page.keyboard.press('Escape')
  await overview.waitFor({ state: 'hidden' })
  // Le focus revient là où il était parti.
  assert.equal(await header.evaluate((el) => el === document.activeElement), true)

  /*
    Le filtre d'ouverture est le premier groupe non vide, dans l'ordre de ce que les
    groupes réclament. Les trois premières entrées se jouent ici ; la quatrième, « tout »,
    demande que plus rien ne réclame — c'est le dernier cas du fichier.
  */
  const openOn = async () => {
    await header.click()
    await overview.waitFor()
    const label = await pressed()
    await page.keyboard.press('Escape')
    await overview.waitFor({ state: 'hidden' })
    return label
  }
  assert.match(await openOn(), /^À débloquer/)
  // La portée projet ne se retient pas plus que l'onglet : gardée d'une fois sur
  // l'autre, elle ouvrirait « à débloquer 2 » au-dessus d'une liste vide.
  await header.click()
  await overview.getByRole('button', { name: 'Tous les projets', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Docs', exact: true }).click()
  // Docs n'a que des sessions en cours : l'onglet des attentes y est vide.
  assert.equal(await overview.getByRole('link').count(), 0)
  await page.keyboard.press('Escape')
  await overview.waitFor({ state: 'hidden' })
  await header.click()
  await overview.waitFor()
  assert.match(await pressed(), /^À débloquer/)
  await overview.getByRole('button', { name: 'Tous les projets', exact: true }).waitFor()
  assert.equal(await overview.getByRole('link').count(), 2)
  await page.keyboard.press('Escape')
  await overview.waitFor({ state: 'hidden' })
  // Les deux attentes se posent : il ne reste plus qu'à relire.
  pushStatus('activity-b', 'idle')
  pushStatus('activity-d', 'idle')
  assert.match(await openOn(), /^Non lues/)
  // Tout se remet à produire : le non-lu est suspendu, et reste ce qui tourne.
  for (const entry of fixtures) pushStatus(entry.id, 'running')
  assert.match(await openOn(), /^En cours/)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click()
  // Au doigt, l'activité est coupée à deux lignes : le reste part dans la modale.
  await activity.getByRole('link').nth(1).waitFor()
  assert.equal(await activity.getByRole('link').count(), 2)
  await page.screenshot({ path: join(shots, 'activity-mobile.png') })
  await header.click()
  await overview.getByRole('link', { name: /Session démarrée ailleurs/ }).waitFor()
  await page.screenshot({ path: join(shots, 'activity-overview-mobile.png') })
  const box = await overview.boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await overview.getByRole('button', { name: 'Fermer', exact: true }).click()

  // Au repos **et** tout relu, l'activité le dit explicitement : il faut les deux, une
  // session posée qui n'a pas été lue réclame encore un regard.
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const entry of fixtures) { entry.status = 'idle'; entry.lastReadSeq = 5 }
  await page.reload()
  await activity.getByText('Aucune session en cours', { exact: true }).waitFor()
  // Et c'est le seul cas où la modale s'ouvre sur « tout » : rien ne réclame.
  await header.click()
  await overview.waitFor()
  assert.match(await pressed(), /^Tout/)
  assert.deepEqual(errors, [])
  console.log('OK : compteurs d’en-tête, sept lignes et le reste compté, modale ouverte sur le premier groupe non vide puis ses quatre filtres croisés d’un projet, statuts temps réel, fins de tour, arrière-plan, nouvelles sessions et mobile.')
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
