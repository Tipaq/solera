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
 * La vue Git du panneau — lots 1 et 2 (cartes #10 et #29).
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas :
 *
 * - **les colonnes suivent la largeur du panneau** et non celle de la fenêtre — Date à
 *   28 rem, Auteur à 36, Sha à 46, Fil à 56. Les paliers ne se vérifient pas à l'œil
 *   sur une seule largeur : la fenêtre, elle, ne bouge pas ;
 * - **le fil qui a écrit un commit** arrive jusqu'à l'écran, et **se tait** quand deux
 *   fils travaillaient au même endroit à la même heure ;
 * - **les écritures sont fermées pendant qu'un tour tourne**, et la lecture continue ;
 * - **le garde-fou nomme la perte** avant un `reset --dur`.
 *
 * Les images sortent dans `docs/audits/2026-10-15-git/lot-1/` et `lot-2/`, une par vue.
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

/**
 * Le dépôt du projet de démo, enrichi de ce que le graphe doit savoir dessiner.
 *
 * **Les commits sont datés**, et ce n'est pas de la décoration : le rattachement
 * commit → fil par recoupement de dates (`git-threads.ts`) ne peut rien distinguer si
 * tout tombe à la même seconde, et c'est alors le chemin atténué — le seul qui puisse
 * se tromper — qui n'est jamais exercé. On pose donc deux cas à l'opposé l'un de
 * l'autre :
 *
 * - un commit à l'heure où **un seul** fil travaillait à la racine du projet : la
 *   règle le lui rattache, en atténué, puisqu'elle déduit ;
 * - un commit à l'heure où **deux** fils y travaillaient : la règle doit se taire
 *   plutôt que d'en choisir un.
 */
function enrichRepo(repo, now) {
  const git = (cwd, at, ...args) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Alex Demo',
      GIT_AUTHOR_EMAIL: 'alex@example.com',
      GIT_COMMITTER_NAME: 'Alex Demo',
      GIT_COMMITTER_EMAIL: 'alex@example.com',
      ...(at === null ? {} : { GIT_AUTHOR_DATE: new Date(at).toISOString(), GIT_COMMITTER_DATE: new Date(at).toISOString() }),
    },
  })

  git(repo, null, 'tag', '-f', 'v0.9.0')

  // Deux fils tournaient à la racine il y a un jour — la veille des CLI et les notes
  // de version. La règle doit donc se taire sur ce commit-là.
  writeFileSync(join(repo, 'src/lib/units.ts'), 'export const toKelvin = (c: number) => c + 273.15\n')
  git(repo, null, 'add', '-A')
  git(repo, now - 86400e3, 'commit', '-m', 'Two threads were here at the same hour')

  // Un commit signé d'un agent, à une heure où un seul fil travaillait à la racine :
  // c'est le `Co-Authored-By` qui porte l'information, l'auteur git étant l'utilisateur
  // dans les deux cas.
  writeFileSync(join(repo, 'src/lib/units.ts'), 'export const toCelsius = (f: number) => (f - 32) / 1.8\n')
  git(repo, null, 'add', '-A')
  git(repo, now, 'commit', '-m', 'Convert Fahrenheit without rounding twice',
    '-m', 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')

  // Une vraie fusion, pour que le graphe ait un nœud en anneau et deux couloirs.
  git(repo, now, 'merge', '--no-ff', 'feat/radar-prefetch', '-m', 'Merge radar prefetching into main')

  // Une remise, pour le nœud en losange et pour la destination *Remises*.
  writeFileSync(join(repo, 'src/lib/stashed.ts'), 'export const stashed = true\n')
  git(repo, null, 'add', '-A')
  git(repo, now, 'stash', 'push', '-m', 'Before picking the toolbar back up')

  // Et de quoi faire exister le nœud « en cours ».
  writeFileSync(join(repo, 'src/lib/units.ts'), 'export const toCelsius = (f: number) => (f - 32) * 5 / 9\n')
  writeFileSync(join(repo, 'README.md'), '# Nimbus\n\nUncommitted line, on purpose.\n')
}

/** De quoi remplir *En cours* dans le worktree où aucun agent ne tourne. */
function dirtyWorktree(path) {
  writeFileSync(join(path, 'src/lib/radar-prefetch.ts'), 'export const PREFETCH_RING = 2\n')
  writeFileSync(join(path, 'src/lib/radar-cache.ts'), 'export const cache = new Map<string, Blob>()\n')
  writeFileSync(join(path, 'notes.md'), '# Notes\n\nUntracked, on purpose.\n')
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
  const now = Date.now()
  enrichRepo(nimbus.workspacePath, now)

  const threads = await (await context.request.get(`${base}/api/projects/${nimbus.id}/conversations`)).json()
  const hero = threads.find((entry) => entry.title === 'Add offline caching for forecasts')
  assert.ok(hero)
  // Le fil du radar est au repos, celui du hero a un tour en cours : il faut les deux,
  // l'un pour écrire et l'autre pour montrer les écritures fermées.
  const radarThread = threads.find((entry) => entry.title === 'Radar tile prefetching')
  assert.ok(radarThread)
  const worktrees = await (await context.request.get(`${base}/api/projects/${nimbus.id}/worktrees`)).json()
  const radarPath = worktrees.find((entry) => entry.name === 'feat/radar-prefetch')?.path
  assert.ok(radarPath, 'le worktree du radar est la matière des écritures')

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-10-15-git/lot-1')
  const shots2 = join(root, 'docs/audits/2026-10-15-git/lot-2')
  await mkdir(shots, { recursive: true })
  await mkdir(shots2, { recursive: true })

  const panel = page.locator('[data-panel="workspace"]')
  // La largeur du panneau accosté se règle à la poignée, qui l'écrit dans le stockage
  // local : on la pose là et on recharge, plutôt que de simuler un glissement au pixel.
  const openGit = async (width, thread = hero) => {
    await page.goto(`${base}/p/${nimbus.id}/c/${thread.id}`)
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
  // Par la branche, ce qui ne se trompe pas ; et par recoupement de dates pour
  // l'histoire commune — le commit d'agent tombe à une heure où un seul fil
  // travaillait à la racine.
  await panel.getByRole('button', { name: 'Refactor settings storage' }).first().waitFor()
  // Et le cas qui compte : deux fils travaillaient à la racine à cette heure-là, donc
  // **la règle se tait** plutôt que d'en choisir un. Ni l'un ni l'autre n'apparaît.
  assert.equal(await panel.getByRole('button', { name: /CLI release watch/ }).count(), 0)
  assert.equal(await panel.getByRole('button', { name: 'Release notes for v0.9' }).count(), 0)
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'graphe-60rem.png') })
  console.log('OK : les colonnes suivent la largeur du panneau, et le fil se tait quand il hésite.')

  // ─── Le commit sélectionné ────────────────────────────────────────────────
  await openGit(640)
  await panel.getByRole('button', { name: 'Convert Fahrenheit without rounding twice', exact: true }).click()
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

  // ─── En cours : indexer, écrire un message, commiter ──────────────────────
  // Dans le worktree du radar, où aucun agent ne tourne : celui du hero est tenu par
  // un tour, et c'est l'autre moitié de la démonstration (plus bas).
  dirtyWorktree(radarPath)
  await openGit(640, radarThread)
  await panel.getByRole('tab', { name: 'En cours', exact: true }).click()
  await panel.getByText('Non indexés · 3').waitFor()

  await panel.getByRole('button', { name: 'Indexer src/lib/radar-cache.ts', exact: true }).click()
  await panel.getByText('Indexés · 1').waitFor()
  await panel.getByRole('button', { name: 'Indexer notes.md', exact: true }).click()
  await panel.getByText('Indexés · 2').waitFor()
  // Par fichier, et pas tout d'un coup : le troisième reste de l'autre côté.
  await panel.getByText('Non indexés · 1').waitFor()

  await panel.getByLabel('Résumé', { exact: true }).fill('Prefetch a second ring of tiles')
  await panel.getByLabel('Description', { exact: true }).fill('Panning two tiles out no longer shows a blank.')
  // Le co-auteur désigne l'agent du fil : c'est lui, et lui seul, qui fera dire
  // « Claude » à la colonne Auteur du graphe.
  await panel.getByRole('button', { name: 'Co-auteur', exact: true }).waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots2, 'en-cours.png') })

  await panel.getByRole('button', { name: /^Commiter 2 fichiers/ }).click()
  await panel.getByText('Commit « Prefetch a second ring of tiles »').waitFor()
  await panel.getByText(/^Annuler la ramènera sur /).waitFor()
  await panel.getByText('Rien n’a été poussé.').waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots2, 'annuler.png') })

  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: radarPath, encoding: 'utf8' })
  assert.match(body, /Prefetch a second ring of tiles/)
  assert.match(body, /Panning two tiles out/, 'le résumé et la description restent séparés')
  assert.match(body, /Co-Authored-By: Claude/, 'l’agent du fil a co-signé')
  console.log('OK : indexer par fichier, résumé et description séparés, co-auteur de l’agent, commit.')

  // ─── Remises, avec l'aperçu sans lequel on n'ose plus dépiler ─────────────
  await panel.getByRole('tab', { name: 'Remises', exact: true }).click()
  await panel.getByText('Before picking the toolbar back up').waitFor()
  await panel.getByText('src/lib/stashed.ts').waitFor()
  await panel.getByRole('button', { name: 'Dépiler', exact: true }).last().waitFor()
  await panel.getByRole('button', { name: 'En faire une branche', exact: true }).waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots2, 'remises.png') })
  console.log('OK : chaque remise dit ce qu’elle contient avant qu’on la dépile.')

  // ─── Le menu d'un commit, et le garde-fou de ce qui ne s'annule pas ───────
  await panel.getByRole('tab', { name: 'Graphe', exact: true }).click()
  const row = panel.getByRole('button', { name: /Gestes sur « Prefetch radar tiles/ })
  await row.hover()
  await row.click()
  await panel.page().getByRole('menuitem', { name: 'Basculer sur ce commit' }).waitFor()
  // Les deux réinitialisations sont dépliées, et non cachées dans un sous-menu.
  await panel.page().getByRole('menuitem', { name: /Réinitialiser .* — doux/ }).waitFor()
  await panel.page().getByRole('menuitem', { name: /Réinitialiser .* — dur/ }).waitFor()
  await panel.page().getByRole('menuitem', { name: 'Ouvrir le fil qui l’a écrit' }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots2, 'menu-d-un-commit.png'), clip: await panel.boundingBox() })

  await panel.page().getByRole('menuitem', { name: /Réinitialiser .* — dur/ }).click()
  const guard = page.getByRole('alertdialog')
  await guard.waitFor()
  await guard.getByText('Ceci ne s’annule pas. Seront perdus définitivement :').waitFor()
  // Le garde-fou nomme la perte, et la chiffre : c'est ce qui permet de décider.
  await guard.getByText(/fichier(s)? modifié(s)? et non commité(s)?/).waitFor()
  // Le commit qu'on vient d'écrire est co-signé d'un agent, et le garde-fou le dit :
  // perdre un commit d'agent ne se décide pas comme perdre un commit à soi.
  await guard.getByText('1 commit, écrit par un agent').waitFor()
  await guard.getByRole('button', { name: 'Remiser d’abord', exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots2, 'garde-fou.png'), clip: await panel.boundingBox() })
  await guard.getByRole('button', { name: 'Annuler', exact: true }).click()
  console.log('OK : le menu d’un commit, et le garde-fou qui nomme ce qui serait perdu.')

  // Et seulement maintenant, l'annulation : le bandeau ne dit pas « annuler » mais
  // quoi et où ça ramène, et il tient sa promesse. Il a survécu au détour par le
  // menu et par le garde-fou, parce que le dépôt n'a pas bougé entre-temps.
  await panel.getByRole('tab', { name: 'En cours', exact: true }).click()
  await panel.getByRole('button', { name: 'Annuler', exact: true }).last().click()
  await panel.getByText('Indexés · 2').waitFor()
  assert.equal(
    execFileSync('git', ['log', '-1', '--format=%s'], { cwd: radarPath, encoding: 'utf8' }).trim(),
    'Prefetch radar tiles around the viewport',
    'le commit est défait, et ce qu’il portait est revenu à l’index',
  )
  console.log('OK : « Annuler » défait le commit et rend l’index.')

  // ─── Un tour tourne : les écritures sont fermées, la lecture continue ─────
  await openGit(640, hero)
  await panel.getByRole('tab', { name: 'En cours', exact: true }).click()
  await panel.getByText('Un agent travaille ici — Add offline caching for forecasts').waitFor()
  await panel.getByText(/rouvriront à la fin du tour/).waitFor()
  // Les gestes sont éteints, et la liste des fichiers, elle, est bien là.
  await panel.getByText(/^Non indexés · /).waitFor()
  for (const name of ['Tirer', 'Pousser', 'Remiser']) {
    assert.ok(
      await panel.getByRole('button', { name, exact: true }).first().isDisabled(),
      `${name} est éteint pendant le tour`,
    )
  }
  await panel.screenshot({ animations: 'disabled', path: join(shots2, 'un-tour-tourne.png') })
  console.log('OK : pendant un tour, les écritures sont fermées et la lecture continue.')

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
  console.log('Captures :', shots, 'et', shots2)
} finally {
  if (browser) await browser.close()
  for (const child of processes) child.kill('SIGKILL')
  await rm(data, { recursive: true, force: true })
}
