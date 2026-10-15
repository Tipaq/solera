import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/*
 * La vue Git du panneau — lot 1, en lecture seule (cartes #10 et #29).
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas : que **les colonnes
 * suivent la largeur du panneau** et non celle de la fenêtre — Date à 28 rem, Auteur à
 * 36, Sha à 46, Fil à 56 — et que le fil qui a écrit un commit, qui est l'écart assumé
 * avec GitKraken, arrive jusqu'à l'écran. Les paliers ne se vérifient pas à l'œil sur
 * une seule largeur : la fenêtre, elle, ne bouge pas.
 *
 * Les images sortent dans `docs/audits/2026-10-15-git/lot-1/`, une par vue.
 *
 * Playwright a besoin de ses bibliothèques, qui ne sont pas dans le système :
 *   export LD_LIBRARY_PATH="$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu"
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-git-check-'))
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

/** Le dépôt du projet de démo, enrichi de ce que le graphe doit savoir dessiner. */
function enrichRepo(repo) {
  const git = (cwd, ...args) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Alex Demo',
      GIT_AUTHOR_EMAIL: 'alex@example.com',
      GIT_COMMITTER_NAME: 'Alex Demo',
      GIT_COMMITTER_EMAIL: 'alex@example.com',
    },
  })

  git(repo, 'tag', '-f', 'v0.9.0')

  // Un commit signé d'un agent : c'est le `Co-Authored-By` qui porte l'information,
  // l'auteur git étant l'utilisateur dans les deux cas.
  writeFileSync(join(repo, 'src/lib/units.ts'), 'export const toCelsius = (f: number) => (f - 32) / 1.8\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', 'Convert Fahrenheit without rounding twice',
    '-m', 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')

  // Une vraie fusion, pour que le graphe ait un nœud en anneau et deux couloirs.
  git(repo, 'merge', '--no-ff', 'feat/radar-prefetch', '-m', 'Merge radar prefetching into main')

  // Une remise, pour le nœud en losange.
  writeFileSync(join(repo, 'src/lib/stashed.ts'), 'export const stashed = true\n')
  git(repo, 'add', '-A')
  git(repo, 'stash', 'push', '-m', 'Before picking the toolbar back up')

  // Et de quoi faire exister le nœud « en cours ».
  writeFileSync(join(repo, 'src/lib/units.ts'), 'export const toCelsius = (f: number) => (f - 32) * 5 / 9\n')
  writeFileSync(join(repo, 'README.md'), '# Nimbus\n\nUncommitted line, on purpose.\n')
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
  assert.ok(nimbus, 'le projet de démo Nimbus est la matière de cette suite')
  enrichRepo(nimbus.workspacePath)

  const threads = await (await context.request.get(`${base}/api/projects/${nimbus.id}/conversations`)).json()
  const hero = threads.find((entry) => entry.title === 'Add offline caching for forecasts')
  assert.ok(hero)

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-10-15-git/lot-1')
  await mkdir(shots, { recursive: true })

  const panel = page.locator('[data-panel="workspace"]')
  // La largeur du panneau accosté se règle à la poignée, qui l'écrit dans le stockage
  // local : on la pose là et on recharge, plutôt que de simuler un glissement au pixel.
  const openGit = async (width) => {
    await page.goto(`${base}/p/${nimbus.id}/c/${hero.id}`)
    await page.evaluate((value) => localStorage.setItem('solera.panelDockedWidth', String(value)), width)
    await page.reload()
    const open = page.getByRole('button', { name: 'Ouvrir le panneau', exact: true })
    await open.waitFor()
    await open.click()
    await panel.waitFor()
    await panel.getByRole('button', { name: 'Git', exact: true }).click()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-panel="workspace"]')).translate === '0px')
    return panel
  }

  // ─── Le rail, et le graphe à la largeur par défaut ────────────────────────
  await openGit(640)
  for (const destination of ['Graphe', 'En cours', 'Branches', 'Remises', 'Recherche', 'Historique d’un fichier']) {
    await panel.getByRole('tab', { name: destination, exact: true }).waitFor()
  }
  // *Conflits* n'est pas là, et c'est la décision : la destination n'apparaît que
  // pendant un conflit, et la détection appartient au lot 3.
  assert.equal(await panel.getByRole('tab', { name: 'Conflits', exact: true }).count(), 0)

  await panel.getByText(/^En cours — /).first().waitFor()
  await panel.getByText('Merge radar prefetching into main').waitFor()
  await panel.getByText('Convert Fahrenheit without rounding twice').waitFor()
  await panel.getByText(/Before picking the toolbar back up/).waitFor()

  // Les couloirs sont dessinés et colorés : deux couloirs au moins, la fusion ayant eu
  // lieu. Un graphe à une seule colonne serait une décoration, pas un graphe.
  const lanes = await panel.locator('svg line, svg path').count()
  assert.ok(lanes > 8, `le graphe dessine ses couloirs (${lanes} traits)`)

  const columns = async () => panel.evaluate((node) =>
    [...node.querySelectorAll('span')]
      .filter((span) => span.offsetParent !== null)
      // Les en-têtes sont mis en capitales par la feuille, pas dans le texte : on
      // compare donc ce que le DOM porte, et non ce que l'écran montre.
      .map((span) => span.textContent.trim().toUpperCase())
      .filter((text) => ['GRAPHE', 'MESSAGE', 'FIL', 'AUTEUR', 'DATE', 'SHA'].includes(text)))

  const wide = await columns()
  assert.deepEqual(wide.sort(), ['AUTEUR', 'DATE', 'GRAPHE', 'MESSAGE'], '40 rem : ni Sha ni Fil')
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'graphe-40rem.png') })

  // ─── Le même, à 22 rem : le minimum accosté ───────────────────────────────
  await openGit(352)
  await panel.getByText(/^En cours — /).first().waitFor()
  assert.deepEqual((await columns()).sort(), ['GRAPHE', 'MESSAGE'], '22 rem : le graphe et le message, rien d’autre')
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'graphe-22rem.png') })

  // ─── Et à 60 rem : la colonne Fil entre ───────────────────────────────────
  // Fenêtre plus large, parce que le panneau accosté ne peut pas dépasser ce que la
  // coque lui laisse — 760 px dans 1 440. C'est bien la largeur du **panneau** qui
  // décide, et c'est précisément ce que ce palier démontre : même mécanisme, autre
  // fenêtre.
  await page.setViewportSize({ width: 1920, height: 900 })
  await openGit(960)
  await panel.getByText(/^En cours — /).first().waitFor()
  assert.deepEqual((await columns()).sort(), ['AUTEUR', 'DATE', 'FIL', 'GRAPHE', 'MESSAGE', 'SHA'], '60 rem : tout entre, Fil compris')
  // Le fil qui a écrit un commit arrive jusqu'à l'écran : c'est ce qui justifie que
  // cette vue vive dans Solera plutôt qu'à côté.
  await panel.getByRole('button', { name: 'Add offline caching for forecasts' }).first().waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'graphe-60rem.png') })
  console.log('OK : les colonnes suivent la largeur du panneau, aux quatre paliers du tour 4.')

  // ─── Le commit sélectionné ────────────────────────────────────────────────
  await openGit(640)
  await panel.getByRole('button', { name: 'Convert Fahrenheit without rounding twice' }).click()
  await panel.getByText('Claude Opus 5', { exact: true }).waitFor()
  await panel.getByText(/^parent /).waitFor()
  await panel.getByText(/^Dans /).waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'commit-selectionne.png') })
  await panel.getByRole('button', { name: 'Revenir au graphe', exact: true }).click()
  await panel.getByText(/^En cours — /).first().waitFor()
  console.log('OK : un commit dit son auteur agent, son parent, les branches qui le contiennent, et son diff.')

  // ─── Branches ─────────────────────────────────────────────────────────────
  await panel.getByRole('tab', { name: 'Branches', exact: true }).click()
  for (const section of ['Local', 'Worktrees', 'Distant', 'Étiquettes', 'Sous-modules']) {
    await panel.getByText(section, { exact: true }).first().waitFor()
  }
  // Les sections vides restent affichées et disent qu'il n'y a rien : ici le dépôt de
  // démo n'a ni distant ni sous-module, et les deux sections le disent.
  await panel.getByText('aucun dans ce dépôt').first().waitFor()
  assert.equal(await panel.getByText('aucun dans ce dépôt').count(), 2)
  await panel.getByText('feat/offline-cache', { exact: true }).waitFor()
  // Le fil qui occupe le worktree, l'autre chose que GitKraken ne peut pas avoir.
  await panel.getByRole('button', { name: /Add offline caching/ }).first().waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'branches.png') })
  console.log('OK : Local, Worktrees avec leur fil, Étiquettes, et les sections vides qui le disent.')

  // ─── En cours ─────────────────────────────────────────────────────────────
  // La destination garde, en lecture, ce que l'onglet Git montrait déjà : indexer et
  // commiter sont le lot 2. Un lot qui retirerait ce qui marche serait une régression.
  await panel.getByRole('tab', { name: 'En cours', exact: true }).click()
  await panel.getByText('Non commité', { exact: true }).waitFor()
  // Le compte de fichiers plutôt qu'un nom : l'arborescence de l'onglet *Fichiers*
  // reste montée derrière, et porte les mêmes noms.
  await panel.getByText('2 fichiers', { exact: true }).waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'en-cours.png') })

  // Le nœud « en cours » du graphe mène à la même vue : c'est le même objet.
  await panel.getByRole('tab', { name: 'Graphe', exact: true }).click()
  await panel.getByText(/^En cours — /).first().click()
  await panel.getByText('Non commité', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('tab', { name: 'En cours', exact: true }).getAttribute('aria-selected'), 'true')
  console.log('OK : « En cours » garde le diff du répertoire de travail, et le nœud du graphe y mène.')

  // ─── Recherche ────────────────────────────────────────────────────────────
  await panel.getByRole('tab', { name: 'Recherche', exact: true }).click()
  const field = panel.getByPlaceholder('Chercher dans l’histoire')
  await field.fill('radar')
  await panel.getByText('Merge radar prefetching into main').waitFor()
  await panel.waitForFunction(
    (node) => !node.textContent.includes('Convert Fahrenheit'),
    await panel.elementHandle(),
  )

  // Le filtre que `git log` ne sait pas poser : ce qu'un agent a écrit.
  await field.fill('')
  await panel.getByRole('button', { name: 'Par un agent', exact: true }).click()
  await panel.getByText('Convert Fahrenheit without rounding twice').waitFor()
  await panel.waitForFunction(
    (node) => !node.textContent.includes('Merge radar prefetching'),
    await panel.elementHandle(),
  )
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'recherche.png') })
  console.log('OK : la recherche filtre le graphe, par message et par « écrit par un agent ».')

  assert.deepEqual(errors, [], 'aucune erreur de page')
  console.log('Captures :', shots)
} finally {
  if (browser) await browser.close()
  for (const child of processes) child.kill('SIGKILL')
  await rm(data, { recursive: true, force: true })
}
