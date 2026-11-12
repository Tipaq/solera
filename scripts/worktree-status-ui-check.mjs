import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

// L'avancement des worktrees sur la démo : vrai serveur, vrai git, base temporaire.
// La démo porte deux arbres créés par Solera (« offline cache », non commité ; « radar
// prefetch », commité non fusionné) ; on y ajoute au shell un arbre externe fusionné et
// un arbre introuvable, comme les agents en laissent derrière eux.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-worktree-check-'))
// Les captures restent après la suite, à côté de la base temporaire et non dedans.
const shots = join(tmpdir(), 'solera-worktrees-shots')
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
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(child.diagnostics)
    if (await fetch(url).then((response) => response.ok).catch(() => false)) return
    await delay(100)
  }
  throw new Error(`Server did not start: ${child.diagnostics}`)
}

try {
  await mkdir(shots, { recursive: true })
  const apiPort = await freePort()
  const webPort = await freePort()
  const config = join(data, 'config.toml')
  await writeFile(config, '[agents.claude]\nenabled = false\n[agents.codex]\nenabled = false\n')
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Alex Demo',
    GIT_AUTHOR_EMAIL: 'alex@example.test',
    GIT_COMMITTER_NAME: 'Alex Demo',
    GIT_COMMITTER_EMAIL: 'alex@example.test',
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

  // Deux arbres de plus, créés au shell comme le font les agents : l'un fusionné par
  // squash (à nettoyer), l'autre dont le dossier a disparu (introuvable).
  const repoRoot = join(data, 'data', 'demo', 'nimbus')
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim()
  const squashed = join(data, 'external', 'nimbus-squashed')
  git(repoRoot, 'worktree', 'add', '-b', 'fix/squashed-typo', squashed, 'main')
  await writeFile(join(squashed, 'TYPO.md'), 'fixed\n')
  git(squashed, 'add', '-A')
  git(squashed, 'commit', '-m', 'Fix a typo')
  git(repoRoot, 'merge', '--squash', 'fix/squashed-typo')
  git(repoRoot, 'commit', '-m', 'Fix a typo (squashed)')
  // Un second arbre fusionné, que « À décider » ne doit pas proposer de nettoyer.
  const docs = join(data, 'external', 'nimbus-docs')
  git(repoRoot, 'worktree', 'add', '-b', 'docs/readme', docs, 'main')
  await writeFile(join(docs, 'NOTES.md'), 'notes\n')
  git(docs, 'add', '-A')
  git(docs, 'commit', '-m', 'Add notes')
  git(repoRoot, 'merge', '--no-ff', 'docs/readme', '-m', 'Merge docs/readme')
  const gone = join(data, 'external', 'nimbus-gone')
  git(repoRoot, 'worktree', 'add', '-b', 'feat/gone', gone, 'main')
  await rm(gone, { recursive: true, force: true })

  browser = await launchBrowser()

  const session = async (viewport, mobile) => {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'fr-FR', serviceWorkers: 'block' })
    await context.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
    const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
    assert.ok(login.ok())
    const projects = await (await context.request.get(`${base}/api/projects`)).json()
    const project = projects.find((entry) => entry.name === 'Nimbus')
    const status = await (await context.request.get(`${base}/api/projects/${project.id}/worktrees/status`)).json()
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    return { context, page, errors, project, status }
  }

  // L'API : chaque état représenté, l'arbre principal exclu.
  const desktop = await session({ width: 1440, height: 900 }, false)
  const states = Object.fromEntries(desktop.status.worktrees.map((tree) => [tree.name, tree.state]))
  assert.deepEqual(states, {
    'docs/readme': 'merged',
    'feat/gone': 'missing',
    'feat/offline-cache': 'dirty',
    'feat/radar-prefetch': 'unmerged',
    'fix/squashed-typo': 'merged',
  })
  assert.equal(desktop.status.base, 'main')
  assert.ok(desktop.status.worktrees.find((tree) => tree.name === 'fix/squashed-typo').external)
  assert.ok(desktop.status.worktrees.find((tree) => tree.name === 'feat/offline-cache').conversations.length > 0)
  console.log('OK : états calculés sur la démo.')

  // « À décider » est réservé à ce qu'un agent demande : une fusion n'y propose plus de
  // nettoyer l'arbre, qui reste dans Travail.
  const { page, errors, project } = desktop
  await page.goto(`${base}/p/${project.id}/board`)
  await page.getByRole('heading', { level: 1 }).first().waitFor()
  await page.waitForTimeout(500)
  assert.equal(await page.getByText(/est fusionnée et propre : nettoyer \?/).count(), 0, 'Aucune proposition de nettoyage')
  assert.ok(existsSync(docs), "L'arbre fusionné reste en place")
  console.log('OK : une fusion ne propose rien dans « À décider ».')

  // Le nettoyage de Travail (#177, `projet.md` T-1.5, T-12) : un arbre créé par Solera et
  // fusionné, et une branche fusionnée sans arbre, partent d'un seul dialogue. Les arbres
  // créés au shell ne se nettoient pas d'ici (T-6.2 : « désactivé pour un arbre externe »).
  const created = await (await page.request.post(`${base}/api/projects/${project.id}/worktrees`, { data: { name: 'fix/solera-merged', baseRef: 'main' } })).json()
  assert.ok(created.path, JSON.stringify(created))
  await writeFile(join(created.path, 'MERGED.md'), 'merged\n')
  git(created.path, 'add', '-A')
  git(created.path, 'commit', '-m', 'Merged from a Solera tree')
  git(repoRoot, 'merge', '--no-ff', 'fix/solera-merged', '-m', 'Merge fix/solera-merged')
  git(repoRoot, 'branch', 'chore/old-merged', 'main~1')
  const fresh = await (await page.request.get(`${base}/api/projects/${project.id}/worktrees/status`)).json()
  const mergedBranches = fresh.branches.filter((entry) => entry.merged && !entry.remoteOnly).map((entry) => entry.name)
  assert.ok(mergedBranches.includes('chore/old-merged'), `branches fusionnées : ${mergedBranches}`)
  const total = 1 + mergedBranches.length

  await page.goto(`${base}/p/${project.id}/travail?vue=tableau`)
  const table = page.getByRole('region', { name: 'Les arbres et les branches du projet', exact: true })
  await table.waitFor()
  const lineOf = (name) => page.locator('li[data-tree-line]').filter({ has: page.getByRole('button', { name, exact: true }) })
  await lineOf('feat/offline-cache').waitFor()
  // Un arbre externe : son nettoyage est montré, éteint.
  const cleanupToggle = page.getByRole('button', { name: /arbres? (fusionnés?|à nettoyer)/ }).first()
  if ((await cleanupToggle.getAttribute('aria-expanded')) === 'false') await cleanupToggle.click()
  await lineOf('docs/readme').getByRole('button', { name: 'Gestes sur docs/readme', exact: true }).click()
  assert.ok(await page.getByRole('menuitem', { name: 'Nettoyer', exact: true }).isDisabled(), 'Un arbre externe ne se nettoie pas d’ici')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: join(shots, 'travail-tableau-desktop.png') })

  // « Nettoyer · N » : l'arbre fusionné de Solera et les branches fusionnées, ensemble.
  await page.getByRole('button', { name: `Nettoyer · ${total}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Nettoyer', exact: true })
  await dialog.getByText('Worktrees fusionnés · 1', { exact: true }).waitFor()
  await dialog.getByText(`Branches fusionnées · ${mergedBranches.length}`, { exact: true }).waitFor()
  await dialog.getByText('Tout est déjà dans main : rien ne se perd.', { exact: true }).waitFor()
  const confirm = dialog.getByRole('button', { name: new RegExp(`^Supprimer 1 arbre et ${mergedBranches.length} branches? — libère jusqu’à `) })
  await confirm.waitFor()
  await dialog.screenshot({ path: join(shots, 'cleanup-dialog.png') })
  // Décocher une section la retire du bouton ; « Rien de coché » quand il ne reste rien.
  await dialog.getByRole('checkbox', { name: /^Branches fusionnées/ }).uncheck()
  await dialog.getByRole('button', { name: /^Supprimer 1 arbre — libère jusqu’à / }).waitFor()
  await dialog.getByRole('checkbox', { name: /^Worktrees fusionnés/ }).uncheck()
  await dialog.getByRole('button', { name: 'Rien de coché', exact: true }).waitFor()
  await dialog.getByRole('checkbox', { name: /^Worktrees fusionnés/ }).check()
  await dialog.getByRole('checkbox', { name: /^Branches fusionnées/ }).check()
  await confirm.click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('status').getByText(new RegExp(`^1 arbre supprimé et ${mergedBranches.length} branches? supprimées?`)).waitFor()
  await lineOf('fix/solera-merged').waitFor({ state: 'detached' })
  assert.ok(!existsSync(created.path), 'Le dossier est retiré')
  assert.equal(git(repoRoot, 'branch', '--list', 'fix/solera-merged'), '', 'Sa branche est supprimée')
  assert.equal(git(repoRoot, 'branch', '--list', 'chore/old-merged'), '', 'La branche fusionnée sans arbre est supprimée')
  assert.ok(existsSync(docs), 'Un arbre externe reste')
  assert.equal(await page.getByRole('button', { name: /^Nettoyer · / }).count(), 0, 'Plus rien à nettoyer : le bouton s’en va')
  assert.deepEqual(errors, [])
  console.log('OK : « Nettoyer · N », un dialogue pour les arbres et les branches.')

  // Un arbre habité et non commité, par son menu : le plan dit la perte et la session
  // archivée. La démo n'a pas de session de la racine qui y ait écrit : le plan en reçoit
  // deux, dont une au travail, qui retient alors l'arbre.
  const offline = lineOf('feat/offline-cache')
  await offline.getByRole('button', { name: 'Gestes sur feat/offline-cache', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nettoyer', exact: true }).click()
  await dialog.getByText('Worktrees · 1', { exact: true }).waitFor()
  await dialog.getByText('feat/offline-cache : du travail non commité serait perdu.', { exact: true }).waitFor()
  await dialog.getByText(/^Sa session est archivée : /).waitFor()
  await dialog.getByRole('checkbox', { name: /^Passer en Terminé : #\d+/ }).waitFor()
  await dialog.screenshot({ path: join(shots, 'cleanup-dialog-dirty.png') })
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  const planRoute = '**/api/projects/*/worktrees/cleanup?*'
  await page.route(planRoute, async (route) => {
    const response = await route.fetch()
    const plan = await response.json()
    plan.restarted = [
      { id: 'root-1', title: 'Plan the release', running: false },
      { id: 'root-2', title: 'Orchestrate the agents', running: true },
    ]
    plan.busy = [...plan.busy, { id: 'root-2', title: 'Orchestrate the agents' }]
    await route.fulfill({ response, json: plan })
  })
  await offline.getByRole('button', { name: 'Gestes sur feat/offline-cache', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nettoyer', exact: true }).click()
  await dialog.getByText('feat/offline-cache : Orchestrate the agents y travaille, l’arbre reste jusqu’à la fin de son tour.', { exact: true }).waitFor()
  assert.ok(await dialog.getByRole('button', { name: 'En attente de la session', exact: true }).isDisabled(), 'Une session au travail retient le nettoyage')
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.unroute(planRoute)
  assert.deepEqual(errors, [])
  console.log('OK : le plan réel d’un arbre non commité, et l’arbre retenu par une session au travail.')

  // Téléphone : le tableau devient des cartes, rien ne déborde.
  const phone = await session({ width: 390, height: 844 }, true)
  await phone.page.goto(`${base}/p/${project.id}/travail?vue=tableau`)
  await phone.page.getByRole('region', { name: 'Les arbres et les branches du projet', exact: true }).waitFor()
  await delay(600)
  assert.ok(await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Pas de défilement horizontal au téléphone')
  await phone.page.screenshot({ path: join(shots, 'travail-tableau-phone.png') })
  assert.deepEqual(phone.errors, [])
  console.log('OK : Tableau au téléphone.')
  console.log(`Captures : ${shots}`)
} finally {
  await browser?.close()
  for (const child of processes) child.kill('SIGTERM')
  await delay(200)
  await rm(data, { recursive: true, force: true })
}
