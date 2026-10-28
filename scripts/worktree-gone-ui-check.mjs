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

// Le fil d'une conversation dont le worktree a disparu (carte #61) : le bandeau prend la
// place du composer et porte ses deux issues, le panneau ne montre plus de fichiers, la
// colonne marque le fil. Vraie API dans une base temporaire, aucun CLI activé ; l'état
// « disparu » est simulé sur les réponses, la base de démonstration n'ayant pas de
// worktree à retirer.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-ui-check-'))
// Les captures restent après la suite, à côté de la base temporaire et non dedans.
const shots = join(tmpdir(), 'solera-worktree-gone-shots')
await mkdir(shots, { recursive: true })
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript((origin) => {
    if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const project = projects.find((entry) => entry.name === 'Nimbus')
  const conversations = await (await context.request.get(`${base}/api/projects/${project.id}/conversations`)).json()
  const hero = conversations.find((entry) => entry.title === 'Add offline caching for forecasts')
  const heroPath = `/p/${project.id}/c/${hero.id}`
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  const heroUrl = `**/api/conversations/${hero.id}`
  let gone = true
  const archived = []
  await page.route(heroUrl, async (route) => {
    if (route.request().method() === 'PATCH') {
      archived.push(route.request().postDataJSON())
      return route.fulfill({ json: { ok: true } })
    }
    const real = await (await route.fetch()).json()
    return route.fulfill({ json: { ...real, worktreeGone: gone } })
  })
  await page.route(`${heroUrl}/project-root`, async (route) => {
    gone = false
    const real = await (await context.request.get(`${base}/api/conversations/${hero.id}`)).json()
    return route.fulfill({ json: { ...real, worktreeGone: false } })
  })
  await page.route('**/api/conversations', async (route) => {
    const entries = await (await route.fetch()).json()
    return route.fulfill({ json: entries.map((entry) => entry.id === hero.id ? { ...entry, worktreeGone: gone } : entry) })
  })
  await page.goto(base + heroPath)
  const goneNotice = page.locator('[data-worktree-gone]')
  await goneNotice.waitFor()
  assert.equal(await page.locator('textarea').count(), 0, 'Le composer cède la place au bandeau')
  assert.match(await goneNotice.innerText(), /Le worktree de cette conversation a disparu/)
  assert.match(await goneNotice.innerText(), /reprend la même session/)
  await page.locator('[data-worktree-gone-marker]').first().waitFor()
  await page.getByRole('button', { name: 'Ouvrir le panneau', exact: true }).click()
  const gonePanel = page.getByLabel('Panneau du workspace', { exact: true })
  await gonePanel.getByRole('button', { name: 'Agent', exact: true }).waitFor()
  assert.equal(await gonePanel.getByRole('button', { name: 'Fichiers', exact: true }).count(), 0, 'Pas de fichiers pour un worktree disparu')
  await page.getByRole('button', { name: 'Fermer le panneau', exact: true }).first().click()
  await goneNotice.getByRole('button', { name: 'Archiver', exact: true }).click()
  for (let i = 0; i < 50 && archived.length === 0; i++) await delay(50)
  assert.deepEqual(archived, [{ archived: true }])
  await goneNotice.getByRole('button', { name: 'Continuer à la racine', exact: true }).click()
  await page.locator('textarea').waitFor()
  assert.equal(await goneNotice.count(), 0)
  await page.unroute(heroUrl)
  await page.unroute(`${heroUrl}/project-root`)
  await page.unroute('**/api/conversations')
  console.log('OK : worktree disparu, bandeau à la place du composer, Archiver et Continuer à la racine.')

  // Un arbre vivant : la session se ramène à la racine depuis les détails, et l'arbre
  // reste. La démo laisse ce fil au travail : le geste attend, et dit pourquoi.
  const openDetails = async () => {
    await page.getByRole('button', { name: 'Joindre, skills, serveurs, réglages', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Détails de la conversation', exact: true }).click()
    const details = page.getByRole('dialog', { name: 'Détails de la conversation' })
    await details.waitFor()
    return details
  }
  let details = await openDetails()
  let bringBack = details.getByRole('button', { name: 'Ramener à la racine du projet', exact: true })
  await bringBack.waitFor()
  assert.ok(await bringBack.isDisabled(), 'Pas de déménagement pendant un tour')
  await details.getByText('Un tour est en cours : la session se ramène une fois au repos.', { exact: true }).waitFor()
  await details.screenshot({ path: join(shots, 'details-return-to-root-running.png') })
  await page.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })

  // Au repos — le fil du radar —, la confirmation dit que l'arbre reste, et le fil
  // passe à la racine.
  const radar = conversations.find((entry) => entry.title === 'Radar tile prefetching')
  await page.goto(`${base}/p/${project.id}/c/${radar.id}`)
  await page.locator('textarea').waitFor()
  details = await openDetails()
  await details.getByRole('button', { name: 'Ramener à la racine du projet', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Ramener la session à la racine du projet ?' })
  await confirm.getByText(/Le worktree feat\/radar-prefetch reste tel quel/).waitFor()
  await confirm.getByText("L'agent reprend la même session.", { exact: true }).waitFor()
  await confirm.screenshot({ path: join(shots, 'return-to-root-confirm.png') })
  await confirm.getByRole('button', { name: 'Ramener', exact: true }).click()
  await confirm.waitFor({ state: 'hidden' })
  await details.getByRole('button', { name: 'Ramener à la racine du projet', exact: true }).waitFor({ state: 'detached' })
  await details.locator('[title="Dossier du projet"]').waitFor()
  const moved = await (await context.request.get(`${base}/api/conversations/${radar.id}`)).json()
  assert.equal(moved.worktreeId, null)
  const trees = await (await context.request.get(`${base}/api/projects/${project.id}/worktrees`)).json()
  assert.ok(trees.some((tree) => tree.name === 'feat/radar-prefetch'), "L'arbre reste")
  console.log('OK : arbre vivant, Ramener à la racine depuis les détails, refusé pendant un tour.')

  assert.deepEqual(errors, [])
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
