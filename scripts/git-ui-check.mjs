import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/*
 * La vue Git du panneau — lots 1, 2 et 3 (cartes #10 et #29).
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas :
 *
 * - **les colonnes suivent la largeur du panneau** et non celle de la fenêtre — Date à
 *   28 rem, Auteur à 36, Sha à 46, Fil à 56. Les paliers ne se vérifient pas à l'œil
 *   sur une seule largeur : la fenêtre, elle, ne bouge pas ;
 * - **le fil qui a écrit un commit** arrive jusqu'à l'écran, et **se tait** quand deux
 *   fils travaillaient au même endroit à la même heure ;
 * - **les écritures sont fermées pendant qu'un tour tourne**, et la lecture continue ;
 * - **le garde-fou nomme la perte** avant un `reset --dur` ;
 * - **ce qui est coché dans un bloc est exactement ce qui est indexé**, et le disque ne
 *   bouge pas (lot 3) ;
 * - **un rebase interactif fait ce que son plan annonce**, et la destination *Conflits*
 *   n'existe que pendant un conflit ;
 * - **le glisser-déposer du lot 4 se fait au clavier**, et il faut donc le vérifier au
 *   clavier : un `click()` de Playwright ne dirait rien du geste qui existe vraiment.
 *   Lâcher une branche **propose** au lieu d'agir, et réordonner un plan change l'ordre
 *   dans lequel git rejoue — ce qui se lit dans `git log`, pas à l'écran.
 *
 * Les images sortent dans `docs/audits/2026-10-15-git/lot-1/`, `lot-2/` et `lot-3/`,
 * une par vue.
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
  const shots3 = join(root, 'docs/audits/2026-10-15-git/lot-3')
  const shots4 = join(root, 'docs/audits/2026-10-15-git/lot-4')
  await mkdir(shots, { recursive: true })
  await mkdir(shots2, { recursive: true })
  await mkdir(shots3, { recursive: true })
  await mkdir(shots4, { recursive: true })

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

  // ─── Lot 3 · indexer par bloc et par ligne (T3) ───────────────────────────
  //
  // Dans le worktree du radar, où aucun agent ne tourne. La matière est posée ici
  // plutôt que dans `dirtyWorktree` : il faut un fichier **à plusieurs modifications
  // dans un même bloc**, sans quoi cocher une ligne reviendrait à cocher le fichier et
  // la suite ne mesurerait rien.
  const demoGit = (...args) => execFileSync('git', args, {
    cwd: radarPath,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Alex Demo', GIT_AUTHOR_EMAIL: 'alex@example.com', GIT_COMMITTER_NAME: 'Alex Demo', GIT_COMMITTER_EMAIL: 'alex@example.com' },
  })
  demoGit('checkout', '--', '.')
  demoGit('clean', '-fd')
  writeFileSync(join(radarPath, 'src/lib/radar-prefetch.ts'), [
    'export const PREFETCH_RING = 1',
    'export const PREFETCH_DEBOUNCE_MS = 120',
    'export const PREFETCH_MAX_TILES = 48',
    '',
  ].join('\n'))
  demoGit('add', '-A')
  demoGit('commit', '-m', 'Prefetch one ring around the viewport')
  writeFileSync(join(radarPath, 'src/lib/radar-prefetch.ts'), [
    'export const PREFETCH_RING = 2',
    'export const PREFETCH_DEBOUNCE_MS = 250',
    'export const PREFETCH_MAX_TILES = 96',
    '',
  ].join('\n'))

  await openGit(640, radarThread)
  await panel.getByRole('tab', { name: 'En cours', exact: true }).click()
  await panel.getByText('Non indexés · 1').waitFor()

  // Le diff se déplie sous la ligne du fichier, et chaque ligne modifiée y porte sa
  // case : c'est ce qui fait du diff un formulaire plutôt qu'une illustration. Le nom
  // accessible de la ligne est « radar-prefetch.ts src/lib/ », le fichier d'abord.
  await panel.getByRole('button', { name: /^radar-prefetch\.ts/ }).first().click()
  const boxes = panel.getByRole('button', { name: /^Cocher la ligne/ })
  await boxes.first().waitFor()
  assert.equal(await boxes.count(), 6, 'trois lignes changées, donc six cases : avant et après')

  // On coche la paire de la première ligne, et rien d'autre : le compteur du bouton
  // suit la sélection, et le reste du fichier reste dehors.
  //
  // Les rangs ne sont pas 0 et 1 : un diff groupe ses retraits puis ses ajouts, donc
  // la ligne « avant » est la première et sa ligne « après » la quatrième.
  await boxes.nth(0).click()
  await boxes.nth(3).click()
  await panel.getByRole('button', { name: 'Indexer 2 lignes', exact: true }).waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots3, 'indexer-par-ligne.png') })

  await panel.getByRole('button', { name: 'Indexer 2 lignes', exact: true }).click()
  // `exact` n'est pas une précaution de style : `getByText` cherche une sous-chaîne
  // sans tenir compte de la casse, et « Indexés · 1 » se trouve dans « Non indexés
  // · 1 » — la suite attendrait alors l'écran qu'elle a déjà sous les yeux.
  await panel.getByText('Indexés · 1', { exact: true }).waitFor()
  // Et la vérité, qui ne se voit pas sur une image : l'index porte exactement la ligne
  // cochée, les deux autres sont restées dehors, et le disque n'a pas bougé.
  const staged3 = demoGit('show', ':src/lib/radar-prefetch.ts')
  assert.match(staged3, /PREFETCH_RING = 2/, 'la ligne cochée est indexée')
  assert.match(staged3, /DEBOUNCE_MS = 120/, 'la ligne non cochée est restée à sa valeur d’avant')
  assert.match(staged3, /MAX_TILES = 48/)
  assert.match(
    readFileSync(join(radarPath, 'src/lib/radar-prefetch.ts'), 'utf8'),
    /DEBOUNCE_MS = 250/,
    'le disque n’a pas bougé : c’est tout l’intérêt du geste',
  )
  console.log('OK : ce qui est coché dans un bloc est exactement ce qui est indexé.')

  // On repart d'un arbre propre pour la suite : git refuse de rebaser par-dessus un
  // index qui porte des modifications, et c'est lui qui le refuse, pas nous.
  demoGit('reset', '--hard')

  // ─── Lot 3 · le rebase interactif et ses quatre verbes (T9) ───────────────
  const rebaseBase = execFileSync('git', ['rev-parse', '--short', 'HEAD~2'], { cwd: radarPath, encoding: 'utf8' }).trim()
  const baseSubject = execFileSync('git', ['log', '-1', '--format=%s', 'HEAD~2'], { cwd: radarPath, encoding: 'utf8' }).trim()

  await openGit(640, radarThread)
  const target = panel.getByRole('button', { name: new RegExp(`Gestes sur « ${baseSubject}`) })
  await target.hover()
  await target.click()
  await panel.page().getByRole('menuitem', { name: 'Rebaser interactivement...' }).click()

  // Le plan se lit du plus ancien au plus récent : c'est l'ordre dans lequel git
  // rejouera, et l'inverse du graphe.
  await panel.getByText(/^Rebaser 2 commits sur /).waitFor()
  await panel.getByText(/les tours de ce fil sont suspendus/).waitFor()

  const verbs = panel.getByRole('button', { name: /^Que faire de / })
  await verbs.first().click()
  for (const verb of ['reprendre', 'fondre', 'réécrire', 'jeter']) {
    await panel.page().getByRole('menuitem', { name: verb, exact: true }).waitFor()
  }
  // Le dernier commit part à la poubelle : 2 commits → 1.
  await panel.page().keyboard.press('Escape')
  await verbs.last().click()
  await panel.page().getByRole('menuitem', { name: 'jeter', exact: true }).click()
  await panel.getByText('2 → 1.').waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots3, 'rebase-interactif.png') })

  const before3 = execFileSync('git', ['log', '--format=%s', `${rebaseBase}..HEAD`], { cwd: radarPath, encoding: 'utf8' }).trim().split('\n')
  assert.equal(before3.length, 2)
  await panel.getByRole('button', { name: 'Lancer', exact: true }).click()
  await panel.getByText(/^Rebaser 1 commit sur /).waitFor({ timeout: 15000 })
  const after3 = execFileSync('git', ['log', '--format=%s', `${rebaseBase}..HEAD`], { cwd: radarPath, encoding: 'utf8' }).trim().split('\n')
  // `git log` rend le plus récent d'abord, l'écran le plus ancien d'abord : le verbe
  // posé sur la **dernière** ligne de l'écran porte donc sur le commit le plus récent,
  // et c'est l'ancien qui reste.
  assert.deepEqual(after3, [before3[1]], 'le commit jeté est parti, l’autre est resté')
  console.log('OK : le rebase interactif fait ce que son plan annonçait, et le dit avant.')

  // ─── Lot 3 · les conflits, et la destination qui n'existe que pendant (T10) ─
  // Le conflit est fabriqué par git lui-même : une branche et la courante qui
  // écrivent la même ligne. C'est le seul moyen d'avoir un vrai état de conflit.
  // La fusion échoue, et c'est l'état qu'on vient chercher : son code de sortie non
  // nul ne doit pas faire tomber la suite.
  const conflictGit = (...args) => {
    try {
      return demoGit(...args)
    } catch (err) {
      return String(err.stdout ?? '')
    }
  }
  conflictGit('switch', '-c', 'audit/bundle-web')
  writeFileSync(join(radarPath, 'vite.config.ts'), 'maximumFileSizeToCacheInBytes: 4_200_000,\nglobIgnores: [\'**/monaco/**\'],\n')
  conflictGit('add', '-A')
  conflictGit('commit', '-m', 'Raise the bundle ceiling')
  conflictGit('switch', 'feat/radar-prefetch')
  writeFileSync(join(radarPath, 'vite.config.ts'), 'maximumFileSizeToCacheInBytes: 3_500_000,\n')
  conflictGit('add', '-A')
  conflictGit('commit', '-m', 'Keep the bundle ceiling where it was')
  conflictGit('merge', 'audit/bundle-web')

  await openGit(640, radarThread)
  const conflicts = panel.getByRole('tab', { name: 'Conflits', exact: true })
  await conflicts.waitFor()
  await conflicts.click()
  await panel.getByText(/fichier — fusion de audit\/bundle-web/).waitFor()
  // Les trois versions empilées, chacune avec son « prendre ».
  await panel.getByText(/^Les miens — /).waitFor()
  await panel.getByText(/^Les leurs — /).waitFor()
  await panel.getByText('Le résultat', { exact: true }).waitFor()
  // Et le quatrième écart assumé : passer la main coûte un clic.
  await panel.getByRole('button', { name: 'Laisser l’agent le résoudre', exact: true }).waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots3, 'conflits.png') })

  await panel.getByRole('button', { name: 'prendre', exact: true }).last().click()
  await panel.getByRole('button', { name: 'Marquer résolu', exact: true }).click()
  // Le conflit résolu, la destination disparaît du rail : elle n'occupe rien le reste
  // du temps, et c'est la décision de T10.
  await conflicts.waitFor({ state: 'detached' })
  assert.match(
    execFileSync('git', ['show', ':vite.config.ts'], { cwd: radarPath, encoding: 'utf8' }),
    /4_200_000/,
    'le côté pris est bien celui qui est passé à l’index',
  )
  console.log('OK : Conflits apparaît pendant un conflit, le résout, et disparaît après.')

  // ─── Lot 3 · l'historique d'un fichier et le blâme par fil (T12) ──────────
  conflictGit('commit', '--no-edit')
  // La branche fusionnée est retirée, et ce n'est pas du ménage : tant qu'elle existe,
  // ses commits sont atteints depuis **deux** têtes, et la règle de rattachement se
  // tait plutôt que de choisir (`git-threads.ts`). Le blâme n'aurait alors aucun fil à
  // montrer, ce qui est juste mais ne prouve rien.
  conflictGit('branch', '-D', 'audit/bundle-web')

  // Deux lignes ajoutées par un commit qui n'appartient qu'à cette branche, et le
  // reste du fichier laissé tel quel : le blâme montre alors les deux cas côte à côte
  // — les lignes qu'un fil revendique, et celles que la règle ne peut rattacher à
  // personne parce qu'elles viennent de l'histoire commune.
  const kept = demoGit('show', 'HEAD:src/lib/radar-prefetch.ts')
  writeFileSync(
    join(radarPath, 'src/lib/radar-prefetch.ts'),
    `${kept}export const PREFETCH_DEBOUNCE_MS = 250\nexport const PREFETCH_MAX_TILES = 96\n`,
  )
  demoGit('add', '-A')
  demoGit('commit', '-m', 'Debounce the prefetch and cap the tiles')
  // Et une ligne de plus, non commitée : c'est elle qui fait apparaître le fichier
  // dans *En cours*, d'où son menu ouvre l'historique (règle T0).
  writeFileSync(
    join(radarPath, 'src/lib/radar-prefetch.ts'),
    `${kept}export const PREFETCH_DEBOUNCE_MS = 250\nexport const PREFETCH_MAX_TILES = 96\nexport const PREFETCH_IDLE_MS = 400\n`,
  )

  await openGit(640, radarThread)
  await panel.getByRole('tab', { name: 'En cours', exact: true }).click()
  const row3 = panel.getByRole('button', { name: 'Gestes sur src/lib/radar-prefetch.ts' })
  await row3.hover()
  await row3.click()
  await panel.page().getByRole('menuitem', { name: 'Historique du fichier', exact: true }).click()

  // L'en-tête compte deux choses, et la seconde est celle que GitKraken n'a pas :
  // combien de **fils** ont touché ce fichier.
  await panel.getByText(/^\d+ commits · \d+ fils?$/).waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots3, 'historique-d-un-fichier.png') })

  await panel.getByRole('button', { name: 'Blâme', exact: true }).click()
  // Le deuxième écart assumé : la colonne de droite dit *quel fil* a écrit la ligne.
  // L'auteur git, lui, est l'utilisateur dans les deux cas et ne renseigne plus rien.
  await panel.getByRole('button', { name: /Radar tile prefetching/ }).first().waitFor()
  await panel.getByText('export const PREFETCH_MAX_TILES = 96').waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots3, 'blame-par-fil.png') })
  console.log('OK : le blâme dit quel fil a écrit chaque ligne, et « à la main » sinon.')


  // ─── Lot 4 · lâcher une branche sur une autre, au clavier (T6) ────────────
  // Le geste n'existe **qu'**au clavier : pas de `click()` ici, et c'est le but. La
  // ligne se focalise, Espace la saisit, Entrée la lâche — et ce qui apparaît est une
  // proposition, pas une fusion. « Il faut qu'un lâcher accidentel ne fusionne rien ».
  demoGit('branch', 'feat/lot-4-drop')

  await openGit(640, radarThread)
  await panel.getByRole('tab', { name: 'Branches', exact: true }).click()
  const movable = panel.locator('[aria-roledescription^="branche déplaçable"]')
  const dropped = movable.filter({ hasText: 'feat/lot-4-drop' }).first()
  await dropped.waitFor()
  await dropped.focus()
  await page.keyboard.press(' ')
  // La destination allumée est la branche courante, et elle seule : les deux gestes de
  // T6 partent de là où l'on est, et lâcher ailleurs voudrait dire y basculer d'abord.
  await panel.locator('[data-over]').waitFor()
  assert.equal(await panel.locator('[data-over]').count(), 1, 'une seule destination : la courante')
  await panel.screenshot({ animations: 'disabled', path: join(shots4, 'glisser-une-branche.png') })

  // Le clic droit, tranché avec Tim au lot 4 : **les deux**, et pas l'un ou l'autre.
  // La preuve qui compte est que les deux ouvertures mènent aux *mêmes* entrées — les
  // primitives Radix sont deux, et il aurait été facile d'en laisser une derrière.
  await page.keyboard.press('Escape')
  const entries = ['Basculer', 'Supprimer cette branche']
  const byDots = movable.filter({ hasText: 'feat/lot-4-drop' }).first()
  await byDots.hover()
  await byDots.getByRole('button', { name: 'Gestes sur feat/lot-4-drop' }).click()
  for (const entry of entries) {
    await panel.page().getByRole('menuitem', { name: entry, exact: true }).waitFor()
  }
  await page.keyboard.press('Escape')

  await byDots.click({ button: 'right' })
  for (const entry of entries) {
    await panel.page().getByRole('menuitem', { name: entry, exact: true }).waitFor()
  }
  await page.screenshot({ animations: 'disabled', path: join(shots4, 'le-clic-droit.png') })
  console.log('OK : le « ⋯ » et le clic droit ouvrent les mêmes entrées.')
  await page.keyboard.press('Escape')

  await dropped.focus()
  await page.keyboard.press(' ')
  await panel.locator('[data-over]').waitFor()

  const headBefore = demoGit('rev-parse', 'HEAD').trim()
  await page.keyboard.press('Enter')
  await panel.getByText('Lâcher feat/lot-4-drop sur feat/radar-prefetch :').waitFor()
  await panel.getByRole('button', { name: 'Fusionner', exact: true }).waitFor()
  await panel.getByRole('button', { name: 'Rebaser', exact: true }).waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots4, 'la-proposition.png') })
  // Et la vérité qui ne se voit pas sur l'image : le dépôt n'a pas bougé d'un octet.
  assert.equal(demoGit('rev-parse', 'HEAD').trim(), headBefore, 'le lâcher n’a rien fusionné')

  // L'échappée annule, et le dépôt n'a toujours rien à annuler.
  await panel.getByRole('button', { name: 'Échap', exact: true }).click()
  await panel.getByText('Lâcher feat/lot-4-drop sur feat/radar-prefetch :').waitFor({ state: 'detached' })
  assert.equal(demoGit('rev-parse', 'HEAD').trim(), headBefore)
  console.log('OK : lâcher une branche propose fusionner ou rebaser, et n’agit pas tout seul.')

  // ─── Lot 4 · réordonner un plan de rebase, au clavier (le même geste) ─────
  // Deux fichiers distincts : réordonner deux commits qui écrivent la même ligne
  // ferait un conflit, et on vérifierait alors la résolution plutôt que l'ordre.
  demoGit('reset', '--hard')
  writeFileSync(join(radarPath, 'src/lib/lot4-a.ts'), 'export const a = 1\n')
  demoGit('add', '-A')
  demoGit('commit', '-m', 'Lot four first step')
  writeFileSync(join(radarPath, 'src/lib/lot4-b.ts'), 'export const b = 2\n')
  demoGit('add', '-A')
  demoGit('commit', '-m', 'Lot four second step')

  await openGit(640, radarThread)
  const from4 = panel.getByRole('button', { name: /Gestes sur « Debounce the prefetch/ })
  await from4.hover()
  await from4.click()
  await panel.page().getByRole('menuitem', { name: 'Rebaser interactivement...' }).click()
  await panel.getByText(/^Rebaser 2 commits sur /).waitFor()

  // L'écran se lit du plus ancien au plus récent : le premier est donc « first step ».
  const steps = panel.locator('[aria-roledescription^="ligne déplaçable"]')
  assert.equal(await steps.count(), 2)
  assert.match(await steps.first().innerText(), /Lot four first step/)
  await panel.screenshot({ animations: 'disabled', path: join(shots4, 'plan-avant.png') })

  await steps.first().focus()
  await page.keyboard.press(' ')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  // L'ordre a changé à l'écran, et c'est l'ordre dans lequel git rejouera.
  assert.match(await steps.first().innerText(), /Lot four second step/, 'la ligne saisie est descendue')
  await panel.screenshot({ animations: 'disabled', path: join(shots4, 'plan-reordonne.png') })

  // `git log` rend le plus récent d'abord : avant le rebase, « second » est en tête.
  const before4 = demoGit('log', '--format=%s', '-2').trim().split('\n')
  assert.deepEqual(before4, ['Lot four second step', 'Lot four first step'])
  await panel.getByRole('button', { name: 'Lancer', exact: true }).click()
  // Le plan compte toujours deux commits après coup : c'est donc le dépôt qu'on
  // interroge, pas l'écran, qui n'a aucun titre différent à montrer ici.
  let after4 = before4
  for (let i = 0; i < 150 && after4.join() === before4.join(); i++) {
    await delay(100)
    after4 = demoGit('log', '--format=%s', '-2').trim().split('\n')
  }
  assert.deepEqual(
    after4,
    ['Lot four first step', 'Lot four second step'],
    'les deux commits ont été rejoués dans l’ordre du plan, pas dans celui d’avant',
  )
  console.log('OK : réordonner le plan au clavier change l’ordre dans lequel git rejoue.')

  assert.deepEqual(errors, [], 'aucune erreur de page')
  console.log('Captures :', shots, ',', shots2, ',', shots3, 'et', shots4)
} finally {
  if (browser) await browser.close()
  for (const child of processes) child.kill('SIGKILL')
  await rm(data, { recursive: true, force: true })
}
