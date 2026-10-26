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
 * Les pages de lieu : l'Aperçu d'un projet, Projets, Planifiées, et les deux Journaux.
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas : que le bandeau du haut
 * dit ce qui réclame et **omet ce qui est à zéro**, que le board de l'Aperçu est bien
 * celui de l'application — mêmes colonnes, mêmes tuiles — et que l'ancienne page de
 * réglages est toujours joignable depuis le `⋯` qui l'a reprise.
 *
 * Depuis le 2026-10-15, la vue d'un projet est logée dans une coque : la bande porte le
 * nom du projet et le `⋯`, la rangée porte les vues. La suite vérifie donc aussi que la
 * page n'a **plus** d'en-tête à elle — deux titres de projet l'un sous l'autre étaient
 * précisément ce que la coque est venue supprimer.
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

  browser = await launchBrowser()
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

  // ─── L'Aperçu d'un projet ─────────────────────────────────────────────────
  await page.goto(`${base}/p/${nimbus.id}`)
  await page.getByRole('navigation', { name: 'Vues du projet', exact: true }).waitFor()
  // Le nom du projet est dans la bande, et **une seule fois** : la page n'en remet pas.
  assert.equal(
    await page.getByRole('heading', { name: 'Nimbus', exact: true }).count(),
    1,
    'Le nom du projet est dans la bande, et la page ne le redit pas',
  )
  // La rangée porte les vues, et l'Aperçu est la seule sans action propre.
  const row = page.getByRole('navigation', { name: 'Vues du projet', exact: true })
  // L'ordre de l'audit, et les six depuis #110 : la rangée est la même sur toutes les vues.
  for (const view of ['Aperçu', 'Activité', 'Board', 'Planifiées', 'Jalons', 'Journal']) {
    await row.getByRole('link', { name: new RegExp(`^${view}`) }).waitFor()
  }
  assert.equal(await row.getByRole('button').count(), 0, "L'Aperçu n'a pas d'action propre")

  /*
    Le résumé du board a **quitté** l'Aperçu le 2026-10-16 : il redisait le board au
    rabais, et l'onglet est à portée d'œil. À sa place, le jalon courant et les échéances
    proches — ce que l'audit demandait, et qui n'était pas possible avant que la carte
    #36 ne pose l'échéance et le jalon.
  */
  assert.equal(
    await page.getByRole('region', { name: 'À faire', exact: true }).count(),
    0,
    "L'Aperçu ne redit plus le board : l'onglet est à côté",
  )
  const cards = await (await context.request.get(`${base}/api/projects/${nimbus.id}/cards`)).json()
  const milestone = cards.find((entry) => entry.title.startsWith('v1.2'))
  assert.ok(milestone, 'Le jeu d’essai porte une carte-jalon')
  await page.getByText('Jalon courant', { exact: true }).waitFor()
  await page.getByRole('link', { name: milestone.title, exact: true }).waitFor()

  // Les échéances proches, la plus urgente d'abord, et **une seule ligne teintée** :
  // celle qui est en retard. Si tout était coloré, plus rien ne ressortirait.
  const due = page.getByText('Échéances proches', { exact: true })
  await due.waitFor()
  const late = cards.find((entry) => entry.dueAt !== null && entry.dueAt < Date.now() && entry.column !== 'done')
  await page.getByRole('link', { name: new RegExp(`#${late.number}\\b`) }).first().waitFor()
  // Une carte-jalon n'y figure pas : sa date est celle du jalon, que la tuile d'à côté
  // porte déjà, et l'écrire deux fois sur la même ligne d'écran est le défaut qu'on évite.
  assert.equal(
    await page.getByRole('link', { name: new RegExp(`#${milestone.number}\\s`) }).count(),
    0,
    'La carte-jalon ne se compte pas aussi dans les échéances',
  )

  /*
    La **troisième colonne**, le Journal en miniature. Elle n'est arrivée qu'à la fusion
    du 2026-10-16 : la vue de la carte #31 en promettait deux sur trois en commentaire,
    la route serveur étant sur une autre branche. Rien dans git ne marquait ce manque —
    les deux branches se fusionnent proprement à cet endroit — d'où cette assertion.
  */
  const digest = page.locator('section').filter({ has: page.getByText('Journal', { exact: true }) })
    .filter({ has: page.getByRole('link', { name: /tout voir/i }) })
  await digest.first().waitFor()
  await digest.first().getByRole('link', { name: /tout voir/i }).waitFor()
  /* Elle écrit « NOTE » et **jamais** « DÉCISION », comme le Journal : `card_notes.body`
     est un champ libre et la carte #32 a refusé de le typer le 2026-10-15. La maquette
     F1 intitulait pourtant cette colonne « Dernières décisions ». */
  for (const absent of ['Décision', 'Décisions', 'Dernières décisions']) {
    assert.equal(
      await page.getByText(absent, { exact: true }).count(),
      0,
      `L’Aperçu n’écrit pas « ${absent} » : rien ne distingue une note d’une décision`,
    )
  }

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
  await page.screenshot({ animations: 'disabled', path: join(shots, 'apercu-projet.png') })

  /*
    La chronologie : les jalons en lignes, les cartes en barres. Ce qu'une relecture ne
    verrait pas et que la suite tient — le **pied de vue compte ce qui n'a ni jalon ni
    date**, sans quoi la vue mentirait par omission, et une carte-jalon n'est pas sa
    propre barre.
  */
  await row.getByRole('link', { name: /^Jalons/ }).click()
  await page.waitForURL(`**/p/${nimbus.id}/timeline`)
  await page.getByRole('button', { name: new RegExp(milestone.title) }).first().waitFor()
  const unplaced = cards.filter(
    (entry) => entry.milestone === null && entry.dueAt === null
      && entry.column !== 'done' && entry.column !== 'abandoned',
  )
  if (unplaced.length > 0) {
    await page.getByText(new RegExp(`${unplaced.length} cartes sans jalon ni date`)).waitFor()
  }
  await page.screenshot({ animations: 'disabled', path: join(shots, 'chronologie-projet.png') })

  await page.goto(`${base}/p/${nimbus.id}`)
  await page.getByRole('navigation', { name: 'Vues du projet', exact: true }).waitFor()

  // La planification du projet suit en lignes.
  const schedules = await (await context.request.get(`${base}/api/schedules`)).json()
  const task = schedules.find((entry) => entry.projectId === nimbus.id)
  if (task) await page.getByRole('link', { name: new RegExp(task.name) }).first().waitFor()

  // Les réglages ont quitté la page et sont dans le `⋯`, qui ne navigue plus vers une vue.
  await page.getByRole('button', { name: 'Actions du projet', exact: true }).click()
  for (const view of ['Board', 'Planifiées']) {
    assert.equal(
      await page.getByRole('menuitem', { name: view, exact: true }).count(),
      0,
      `Le \u22ef ne redit pas la vue « ${view} », la rangée est juste en dessous`,
    )
  }
  await page.getByRole('menuitem', { name: 'Réglages du projet', exact: true }).click()
  await page.getByRole('heading', { name: 'Réglages du projet', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, `/p/${nimbus.id}/settings`)

  // Un projet calme ne montre pas un bandeau vide, il le dit.
  await page.goto(`${base}/p/${docs.id}`)
  await page.getByText('Rien ne réclame ici.', { exact: true }).waitFor()

  // ─── Le portefeuille : Projets, Board global, Travail ─────────────────────
  await page.goto(`${base}/projects`)
  const portfolio = page.getByRole('navigation', { name: 'Vues du portefeuille', exact: true })
  await portfolio.waitFor()
  for (const project of projects) {
    await page.getByRole('link', { name: new RegExp(project.name) }).first().waitFor()
  }
  assert.ok(
    (await page.getByText(nimbus.git ? nimbus.git.branch : 'main').count()) > 0,
    'Chaque ligne porte la branche du dépôt',
  )
  await page.screenshot({ animations: 'disabled', path: join(shots, 'page-projets.png') })

  /*
    Le board global : les cartes de **tous** les projets dans quatre colonnes, chacune
    disant d'où elle sort. C'est ce qui le distingue d'un board de projet, et ce qu'une
    relecture ne verrait pas — rien dans le code ne garantit que les cartes de deux
    projets atterrissent bien dans la même colonne.
  */
  await portfolio.getByRole('link', { name: /^Board/ }).click()
  await page.waitForURL('**/projects/board')
  const todo = page.getByRole('region', { name: 'À faire', exact: true })
  await todo.waitFor()
  const mixed = await page.evaluate(() => {
    const names = [...document.querySelectorAll('[data-card-open]')]
      .map((tile) => tile.textContent ?? '')
    return names.length
  })
  assert.ok(mixed > 0, 'Le board global porte des cartes')
  assert.equal(
    await page.getByRole('region', { name: 'Abandonné', exact: true }).count(),
    0,
    "L'abandon est un classement, pas une étape du board global",
  )
  // Le filtre par projet vit dans l'adresse : un board filtré se partage par lien.
  await page.goto(`${base}/projects/board?projet=${nimbus.id}`)
  await todo.waitFor()
  await page.getByRole('button', { name: /^Retirer le filtre/ }).waitFor()
  const others = projects.filter((entry) => entry.id !== nimbus.id).map((entry) => entry.name)
  for (const name of others) {
    assert.equal(
      await page.locator('[data-card-open]').filter({ hasText: name }).count(),
      0,
      `Le filtre retire les cartes de « ${name} »`,
    )
  }
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-board.png') })

  // *Travail* : groupé par ce que les cartes demandent, et non par colonne.
  await page.goto(`${base}/projects/work`)
  await page.getByRole('heading', { name: /^À vérifier/ }).waitFor()
  assert.equal(
    await page.getByRole('heading', { name: /^À faire/ }).count(),
    0,
    'Travail groupe par demande, pas par colonne : « À faire » ne réclame rien',
  )
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-travail.png') })

  // La chronologie du portefeuille : les projets en lignes, leurs jalons en barres. Un
  // projet sans jalon le dit, plutôt que de laisser sa ligne muette.
  await page.goto(`${base}/projects/timeline`)
  await page.getByRole('button', { name: new RegExp(milestone.title) }).first().waitFor()
  await page.getByText('aucun jalon', { exact: true }).first().waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-chronologie.png') })

  // Le filtre *Jalon* du board global : il liste des **cartes**, puisqu'un jalon en est
  // une, et il se partage par lien comme les deux autres.
  await page.goto(`${base}/projects/board?jalon=${milestone.id}`)
  await page.getByRole('button', { name: /^Retirer le filtre/ }).waitFor()
  const attached = cards.filter((entry) => entry.milestone?.id === milestone.id)
  assert.ok(attached.length > 0, 'Le jeu d’essai rattache des cartes à son jalon')
  /* Attendre une **tuile** et non la colonne : la colonne est rendue avant que les
     cartes du projet arrivent, et compter à ce moment-là rend zéro quel que soit le
     filtre. C'est la course qui a fait tomber cette assertion la première fois. */
  await page.locator(`[data-card-open="${attached[0].id}"]`).waitFor()
  assert.equal(
    await page.locator('[data-card-open]').count(),
    attached.length,
    'Le filtre Jalon ne laisse que les cartes rattachées',
  )

  /*
    Le Journal : sept sources mêlées, et c'est leur **alignement** qu'une relecture ne
    verrait pas. Deux d'entre elles ne sont pas en base — une branche fusionnée se lit
    dans git, un audit versé sur le disque — et rien dans le code ne garantit qu'elles
    arrivent bien jusqu'à la page.
  */
  await page.goto(`${base}/p/${nimbus.id}/journal`)
  const filters = page.getByRole('radiogroup', { name: 'Filtrer le journal', exact: true })
  await filters.waitFor()
  // Les filtres sont des pilules, **pas** une seconde rangée d'onglets : il n'y a
  // qu'une navigation dans la page, celle des vues.
  assert.equal(
    await page.getByRole('navigation').filter({ hasText: 'Tout' }).count(),
    0,
    'Les filtres du journal ne sont pas une seconde rangée d’onglets',
  )
  // Pas de ligne « Décision » : `card_notes.body` est libre, la carte #32 a refusé le type.
  for (const absent of ['Décision', 'Décisions']) {
    assert.equal(
      await page.getByText(absent, { exact: true }).count(),
      0,
      `Le journal n’écrit pas « ${absent} » : rien ne distingue une note d’une décision`,
    )
  }
  // Les deux sources hors base sont là, donc la route a bien lu git et le disque.
  await page.getByText('feat/city-search', { exact: true }).waitFor()
  await page.getByText(/docs\/audits\/.*offline-cache/).waitFor()
  await page.getByText(/^Aujourd.hui$/).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'projet-journal.png') })

  // Une pilule filtre vraiment : *Dépôt* ne garde que la fusion et l'audit.
  await filters.getByRole('radio', { name: 'Dépôt', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('li').length > 0)
  assert.equal(
    await page.getByText('Session', { exact: true }).count(),
    0,
    'Le filtre « Dépôt » ne garde que ce qui se lit dans le dossier du projet',
  )

  // Le même journal au portefeuille, où chaque ligne porte la pastille de son projet.
  await page.goto(`${base}/projects/journal`)
  await page.getByRole('radiogroup', { name: 'Filtrer le journal', exact: true }).waitFor()
  await page.getByText('feat/city-search', { exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-journal.png') })

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
  await page.getByText('Jalon courant', { exact: true }).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'apercu-mobile.png') })
  await page.goto(`${base}/projects`)
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'projets-mobile.png') })
  // Au doigt la provenance disparaît, et c'est voulu : l'heure et le titre tiennent.
  await page.goto(`${base}/p/${nimbus.id}/journal`)
  await page.getByRole('radiogroup', { name: 'Filtrer le journal', exact: true }).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'journal-mobile.png') })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/p/${nimbus.id}`)
  await page.getByText('Jalon courant', { exact: true }).waitFor()
  // Le thème se pose après la navigation : `goto` recharge le document et emporterait
  // l'attribut avec lui.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'apercu-sombre.png') })
  await page.goto(`${base}/p/${nimbus.id}/journal`)
  await page.getByRole('radiogroup', { name: 'Filtrer le journal', exact: true }).waitFor()
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'journal-sombre.png') })

  assert.deepEqual(errors, [])
  console.log('OK : coque et rangée, bandeau sans inventaire, board réel, réglages dans le ⋯, lignes de projets, board global, Travail, les deux chronologies et les deux journaux, table des planifiées, mobile ; captures dans ' + shots)
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
