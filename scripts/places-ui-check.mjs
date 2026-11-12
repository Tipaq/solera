import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'
import { checkMilestoneAsks } from './checks/milestone-inbox.mjs'

/*
 * Les pages de lieu : l'Aperçu d'un projet, celui du portefeuille, Planifiées, et le Journal.
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas : l'ordre des blocs de
 * l'Aperçu (« Ce qui t'attend », puis le phare des jalons, puis la pile Actions et
 * Derniers événements dans la colonne de droite) et leurs renvois vers les onglets
 * Actions, Travail et Jalons, que le board global est bien celui de l'application —
 * mêmes colonnes, mêmes tuiles — et que les réglages du projet sont toujours
 * joignables, dans la coque.
 *
 * La vue d'un projet est logée dans une coque (`PlaceShell`, page projet v2) : la bande
 * porte l'avatar, le nom et « + Conversation », la rangée porte les cinq vues puis
 * Réglages au bout. La suite vérifie que la page n'a **plus** d'en-tête à elle, que la
 * bande n'a plus ni `⋯` ni pastille de branche, que la rangée ne porte plus d'action de
 * vue, que ses comptes suivent la règle des tons, que la gouttière est la même pour la
 * bande, la rangée et le contenu, et que les anciennes adresses mènent aux nouvelles.
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
  /*
    Pour le « Code en cours » de l'Aperçu (plus bas), avant toute lecture de l'état des
    arbres, que le serveur garde 30 s : un commit sur main, pour que les arbres prennent
    du retard, et un arbre vide créé au shell. Le dépôt est celui du jeu d'essai, dans le
    dossier temporaire de la suite.
  */
  const gitIn = (cwd, ...args) => execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Suite', GIT_AUTHOR_EMAIL: 'suite@example.com', GIT_COMMITTER_NAME: 'Suite', GIT_COMMITTER_EMAIL: 'suite@example.com',
    },
  })
  gitIn(nimbus.workspacePath, 'commit', '--allow-empty', '-q', '-m', 'Bump main for the overview suite')
  gitIn(nimbus.workspacePath, 'worktree', 'add', '-q', '-b', 'feat/deja-fini', join(data, 'shell-tree'), 'main')

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-10-12-pages-de-lieu')
  await mkdir(shots, { recursive: true })

  /** Les abscisses que la gouttière aligne : le premier élément de la bande (l'avatar,
      ou au doigt le bouton de navigation qui le précède), l'icône du premier onglet et le
      premier texte de la vue (le bord de sa boîte, padding compris). */
  const gutter = () => page.evaluate(() => {
    const visible = (element) => element && element.getBoundingClientRect().width > 0
    const band = document.querySelector('[data-place-icon]').closest('header')
    const first = [...band.children].find(visible)
    const tab = document.querySelector('nav[aria-label="Vues du projet"] a > span')
    const view = document.querySelector('[data-place-content]').firstElementChild
    const content = view.getBoundingClientRect().left + parseFloat(getComputedStyle(view).paddingLeft)
    return { band: first.getBoundingClientRect().left, tab: tab.getBoundingClientRect().left, content }
  })
  const assertGutter = async (where) => {
    const { band, tab, content } = await gutter()
    assert.ok(Math.abs(band - tab) <= 1 && Math.abs(band - content) <= 1, `Une seule gouttière ${where} : bande ${band}, onglet ${tab}, contenu ${content}`)
  }

  // ─── La coque d'un projet ─────────────────────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${base}/p/${nimbus.id}`)
  const row = page.getByRole('navigation', { name: 'Vues du projet', exact: true })
  await row.waitFor()
  // Le nom du projet est dans la bande, et **une seule fois** : la page n'en remet pas.
  assert.equal(
    await page.getByRole('heading', { name: 'Nimbus', exact: true }).count(),
    1,
    'Le nom du projet est dans la bande, et la page ne le redit pas',
  )
  // La rangée v2, dans cet ordre, puis Réglages au bout, et rien d'autre.
  const paths = await row.getByRole('link').evaluateAll((links) => links.map((link) => new URL(link.href).pathname))
  assert.deepEqual(
    paths,
    ['', '/travail', '/board', '/timeline', '/actions', '/settings'].map((tail) => `/p/${nimbus.id}${tail}`),
    'Aperçu · Travail · Tableau · Jalons · Actions … Réglages',
  )
  for (const view of ['Aperçu', 'Travail', 'Tableau', 'Jalons', 'Actions']) {
    await row.getByRole('link', { name: new RegExp(`^${view}`) }).waitFor()
  }
  assert.equal(await row.getByRole('button').count(), 0, 'La rangée ne porte plus aucune action de vue')
  const settingsTab = row.getByRole('link', { name: 'Réglages du projet', exact: true })
  assert.equal((await settingsTab.innerText()).trim(), 'Réglages')
  // Réglages poussé au bout : son bord droit est celui de la rangée, gouttière ôtée.
  const [rowBox, settingsBox, actionsBox] = await Promise.all([
    row.boundingBox(), settingsTab.boundingBox(), row.getByRole('link', { name: /^Actions/ }).boundingBox(),
  ])
  assert.ok(rowBox.x + rowBox.width - (settingsBox.x + settingsBox.width) <= 24, 'Réglages est au bout de la rangée')
  assert.ok(settingsBox.x - (actionsBox.x + actionsBox.width) > 40, 'Réglages est séparé des vues')

  // La bande : avatar, nom, « + Conversation », et plus de `⋯` ni de branche.
  const band = page.locator('header').filter({ has: page.getByRole('heading', { name: 'Nimbus', exact: true }) })
  await band.getByRole('button', { name: 'Conversation', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Actions du projet', exact: true }).count(), 0, 'Plus de ⋯ dans la bande')
  if (nimbus.git) {
    assert.equal(await band.getByText(nimbus.git.branch, { exact: true }).count(), 0, 'Plus de pastille de branche')
  }

  // Les comptes : ambre pour ce qui t'attend, gris pour l'inventaire, et ce qu'ils
  // comptent en infobulle.
  const projectCards = await (await context.request.get(`${base}/api/projects/${nimbus.id}/cards`)).json()
  const openLeaves = projectCards.filter((entry) => entry.children.length === 0 && !['done', 'abandoned'].includes(entry.column)).length
  const boardCount = row.getByRole('link', { name: /^Tableau/ }).locator('span[title]')
  assert.equal(await boardCount.getAttribute('title'), `${openLeaves} cartes ouvertes`)
  assert.equal((await boardCount.locator('[aria-hidden]').innerText()).trim(), String(openLeaves))
  assert.doesNotMatch(await boardCount.getAttribute('class'), /text-(caution|positive)/, 'Le Tableau est un inventaire, gris')
  const workCount = row.getByRole('link', { name: /^Travail/ }).locator('span[title]')
  await workCount.waitFor()
  assert.match(await workCount.getAttribute('title'), /t’attend/)
  assert.match(await workCount.getAttribute('class'), /text-caution/, 'Travail compte ce qui t’attend, en ambre')
  assert.equal(await row.getByRole('link', { name: /^Jalons/ }).locator('span[title]').count(), 0, 'Jalons n’a pas de compte')

  await assertGutter('en 1280 px, sur l’Aperçu')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'coque-projet.png'), clip: { x: 0, y: 0, width: 1280, height: 140 } })

  // Réglages est une vue de la coque : la rangée reste, son onglet s'allume.
  await settingsTab.click()
  await page.waitForURL(`**/p/${nimbus.id}/settings`)
  await page.getByRole('complementary', { name: 'Sections des réglages', exact: true }).waitFor()
  await row.waitFor()
  await settingsTab.and(page.locator('[aria-current="page"]')).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Nimbus', exact: true }).count(), 1, 'Les réglages ne redisent pas le nom du projet')
  // La couleur a quitté le `⋯` pour les réglages.
  await page.getByRole('radiogroup', { name: 'Couleur', exact: true }).waitFor()
  // La page des réglages part de son menu : son titre « Réglages » est sur la gouttière.
  const menuTitle = await page.getByRole('complementary', { name: 'Sections des réglages', exact: true })
    .getByRole('heading', { name: 'Réglages', exact: true }).evaluate((title) => title.getBoundingClientRect().left)
  const { band: settingsEdge } = await gutter()
  assert.ok(Math.abs(menuTitle - settingsEdge) <= 1, `Les réglages suivent la gouttière : ${menuTitle} / ${settingsEdge}`)

  // Le Tableau porte son « + Carte » dans sa barre, plus dans la rangée.
  await row.getByRole('link', { name: /^Tableau/ }).click()
  await page.waitForURL(`**/p/${nimbus.id}/board`)
  // La barre d'outils part du même bord : le cadre de sa recherche sous l'avatar.
  const search = await page.getByRole('searchbox', { name: /^Rechercher/ }).evaluate((input) => input.parentElement.getBoundingClientRect().left)
  const { band: edge } = await gutter()
  assert.ok(Math.abs(search - edge) <= 1, `La barre du Tableau suit la gouttière : ${search} / ${edge}`)
  await page.getByRole('button', { name: 'Carte', exact: true }).click()
  await page.waitForURL(/[?&]nouvelle=1/)
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })

  // Les anciennes adresses mènent à la vue qui les a absorbées, requête comprise.
  await page.goto(`${base}/p/${nimbus.id}/activity?groupe=worktree`)
  await page.waitForURL(`**/p/${nimbus.id}/travail?vue=couloirs`)
  await row.getByRole('link', { name: /^Travail/ }).and(page.locator('[aria-current="page"]')).waitFor()
  await page.goto(`${base}/p/${nimbus.id}/schedules`)
  await page.waitForURL(`**/p/${nimbus.id}/actions`)
  // L'onglet Actions : l'onglet courant de la rangée, et « + Action ▾ » au bout de sa barre.
  await row.getByRole('link', { name: /^Actions/ }).and(page.locator('[aria-current="page"]')).waitFor()
  await page.getByRole('button', { name: 'Nouvelle action', exact: true }).click()
  await page.getByRole('dialog', { name: 'Nouvelle action' }).getByRole('button', { name: /^Nouvelle commande/ }).click()
  await page.getByRole('dialog', { name: 'Nouvelle action', exact: true }).getByRole('textbox', { name: 'Libellé', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.goto(`${base}/p/${nimbus.id}/journal`)
  await page.waitForURL(`**/p/${nimbus.id}/travail?vue=fil`)
  await page.getByRole('heading', { name: 'Maintenant', exact: true }).waitFor()

  // Au doigt : même gouttière, Réglages en icône seule, la rangée défile.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/p/${nimbus.id}`)
  await row.waitFor()
  await assertGutter('en 390 px')
  assert.equal((await settingsTab.innerText()).trim(), '', 'Au téléphone, Réglages est une icône')
  // Arriver sur Réglages, au bout d'une rangée qui déborde, la fait défiler jusqu'à lui.
  // Par l'adresse et non par un clic : Playwright ferait lui-même défiler la rangée.
  await page.goto(`${base}/p/${nimbus.id}/settings`)
  // Après l'arrivée des comptes, qui élargissent les onglets et repoussent le bout.
  await row.getByRole('link', { name: /^Travail/ }).locator('span[title]').waitFor({ state: 'attached' })
  await row.getByRole('link', { name: /^Tableau/ }).locator('span[title]').waitFor({ state: 'attached' })
  await page.waitForTimeout(300)
  await page.waitForFunction(() => {
    const tab = document.querySelector('nav[aria-label="Vues du projet"] [aria-current="page"]')
    return tab && tab.getBoundingClientRect().right <= window.innerWidth + 1
  })
  await page.goto(`${base}/p/${nimbus.id}`)
  await row.waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'coque-projet-mobile.png'), clip: { x: 0, y: 0, width: 390, height: 140 } })
  await page.setViewportSize({ width: 1440, height: 900 })

  // ─── L'Aperçu d'un projet ─────────────────────────────────────────────────
  /*
    La mise en page `combo` (`projet.md` A-1) : « Ce qui t'attend » en tête, puis le
    phare des jalons, puis une grille — à gauche le « Code en cours », à droite
    la pile « Actions » puis « Derniers événements ».

    Le jeu d'essai n'a pas d'action, et un service ne tournerait pas sans systemd : la
    liste des actions est servie ici, de la forme de `/api/actions`. Un service en
    marche, une commande dans un terminal, une proposition d'agent, un service au repos.
  */
  const cards = await (await context.request.get(`${base}/api/projects/${nimbus.id}/cards`)).json()
  const milestone = cards.find((entry) => entry.title.startsWith('v1.2'))
  assert.ok(milestone, 'Le jeu d’essai porte une carte-jalon')
  const now = Date.now()
  const fakeAction = (over) => ({
    projectId: nimbus.id, description: null, subdir: null, url: null, status: 'approved',
    agentConversationId: null, agentConversationTitle: null, createdAt: now - 864e5, updatedAt: now - 864e5,
    service: null, lastRun: null, runs: [], approved: null, kind: 'task', command: 'true', ...over,
  })
  const fakeActions = [
    fakeAction({ id: 'dev', label: 'Serveur de dev', kind: 'service', url: 'http://localhost:{port}',
      service: { unit: 'solera-app-dev', state: 'active', cwd: null, ports: [5173], startedAt: now - 26 * 60_000 } }),
    fakeAction({ id: 'tests', label: 'Tests unitaires', lastRun: { terminalId: 'term-tests', alive: true, exitCode: null, startedAt: now - 2 * 60_000 } }),
    fakeAction({ id: 'e2e', label: 'Suite UI du tableau', status: 'proposed', agentConversationId: 'x', agentConversationTitle: 'Revue de la PR #117' }),
    fakeAction({ id: 'storybook', label: 'Storybook', kind: 'service', service: { unit: 'u', state: 'inactive', cwd: null, ports: [], startedAt: null } }),
  ]
  await page.route('**/api/actions', (route) => route.fulfill({ json: fakeActions }))
  await page.goto(`${base}/p/${nimbus.id}`)
  await row.waitFor()

  const inbox = page.getByRole('region', { name: 'Ce qui t’attend', exact: true })
  const actions = page.getByRole('region', { name: 'Actions', exact: true })
  const events = page.getByRole('region', { name: 'Derniers événements', exact: true })
  await Promise.all([inbox.waitFor(), actions.waitFor(), events.waitFor()])
  // L'ordre des blocs, dans le document (A-1.2).
  assert.ok(
    await page.evaluate(() => {
      const [ask, act, evt] = ['Ce qui t’attend', 'Actions', 'Derniers événements']
        .map((name) => [...document.querySelectorAll('section')].find((section) => section.getAttribute('aria-label') === name
          || document.getElementById(section.getAttribute('aria-labelledby') ?? '')?.textContent === name))
      const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      return before(ask, act) && before(act, evt)
    }),
    'Ce qui t’attend, puis Actions, puis Derniers événements',
  )
  // En grand écran, la pile est à droite (colonne de 24 rem), Actions au-dessus.
  const [inboxBox, actionsBlock, eventsBox] = await Promise.all([inbox.boundingBox(), actions.boundingBox(), events.boundingBox()])
  assert.ok(actionsBlock.x > inboxBox.x + inboxBox.width / 2, 'Actions est dans la colonne de droite')
  assert.ok(Math.abs(actionsBlock.x - eventsBox.x) <= 1 && eventsBox.y > actionsBlock.y, 'Derniers événements sous Actions')
  assert.ok(Math.abs(actionsBlock.width - 384) <= 1, `La colonne de droite fait 24 rem : ${actionsBlock.width}`)
  assert.ok(actionsBlock.y > inboxBox.y + inboxBox.height, 'La grille vient après « Ce qui t’attend »')

  // Actions : ce qui tourne ou attend seulement, et des renvois vers l'onglet (A-5).
  const lineOf = (label) => actions.getByRole('listitem').filter({ hasText: label })
  const open = lineOf('Serveur de dev').getByRole('link', { name: /^Ouvrir/ })
  assert.equal(await open.getAttribute('href'), 'http://localhost:5173')
  assert.equal(await open.getAttribute('target'), '_blank')
  await lineOf('Serveur de dev').getByText(/^service · :5173 · depuis 2\d min$/).waitFor()
  await lineOf('Tests unitaires').getByText(/^tâche en cours dans un terminal · \d min$/).waitFor()
  await lineOf('Tests unitaires').getByRole('button', { name: 'Panneau', exact: true }).waitFor()
  await lineOf('Suite UI du tableau').getByText('à relire — proposée dans « Revue de la PR #117 »', { exact: true }).waitFor()
  assert.equal(
    await lineOf('Suite UI du tableau').getByRole('link', { name: 'Relire', exact: true }).getAttribute('href'),
    `/p/${nimbus.id}/actions?action=a-e2e`,
    '« Relire » ouvre le détail de l’action dans l’onglet Actions',
  )
  assert.equal(await lineOf('Storybook').count(), 0, 'Un service au repos n’a pas de ligne')
  assert.equal(
    // Storybook, et les tâches planifiées du jeu d'essai : une action est Quoi × Quand.
    await actions.getByRole('link', { name: /^\d+ autres? au repos$/ }).getAttribute('href'),
    `/p/${nimbus.id}/actions`,
  )
  assert.equal(await page.getByText(/⚡/).count(), 0, 'Plus aucun renvoi au lanceur ⚡')

  // Derniers événements : cinq lignes au plus, et le lien vers Travail › Par moment (A-6).
  assert.equal(
    await events.getByRole('link', { name: 'Par moment', exact: true }).getAttribute('href'),
    `/p/${nimbus.id}/travail?vue=fil`,
  )
  const eventRows = await events.getByRole('listitem').count()
  assert.ok(eventRows > 0 && eventRows <= 5, `Cinq événements au plus : ${eventRows}`)
  /* Elle écrit « NOTE » et **jamais** « DÉCISION », comme le Journal : `card_notes.body`
     est un champ libre et la carte #32 a refusé de le typer le 2026-10-15. */
  for (const absent of ['Décision', 'Décisions', 'Dernières décisions']) {
    assert.equal(
      await page.getByText(absent, { exact: true }).count(),
      0,
      `L’Aperçu n’écrit pas « ${absent} » : rien ne distingue une note d’une décision`,
    )
  }

  // Ce qui a quitté l'Aperçu : les tuiles, « En ce moment », le jalon courant, les
  // échéances, la miniature du Journal et les planifiées (PP-11).
  for (const gone of ['Jalon courant', 'Échéances proches', 'En ce moment', 'Planification', 'tout voir']) {
    assert.equal(await page.getByText(gone, { exact: true }).count(), 0, `L’Aperçu n’a plus « ${gone} »`)
  }
  assert.equal(
    await page.getByRole('region', { name: 'À faire', exact: true }).count(),
    0,
    "L'Aperçu ne redit pas le board : l'onglet est à côté",
  )

  // Ce qui réclame est dans « Ce qui t'attend » depuis #163, et rien d'autre ne compte.
  await inbox.getByText(/à relire/).first().waitFor()
  assert.equal(await page.getByText(/cartes$/).count(), 0, 'L’Aperçu ne porte aucun inventaire')

  /*
    Le phare des jalons (A-3), entre « Ce qui t'attend » et la grille : le jalon courant
    en grand, la file à sa droite. Dans le jeu d'essai, v1.2 a trois enfants ouverts et
    v1.1 est livrée ; il n'y a pas d'autre jalon, donc les deux files sont vides — la
    suite en pose deux plus bas.
  */
  const beacon = page.getByRole('region', { name: 'Jalons', exact: true })
  await beacon.waitFor()
  const beaconBox = await beacon.boundingBox()
  assert.ok(beaconBox.y > inboxBox.y + inboxBox.height && beaconBox.y + beaconBox.height < actionsBlock.y, 'Le phare est entre « Ce qui t’attend » et la grille')
  await beacon.getByText('Jalon en cours', { exact: true }).waitFor()
  assert.equal(
    await beacon.getByRole('link', { name: milestone.title, exact: true }).getAttribute('href'),
    `/p/${nimbus.id}/timeline/${milestone.number}`,
    'Le titre du jalon mène à sa page',
  )
  await beacon.getByRole('img', { name: /^\d+ cartes faites sur 3$/ }).waitFor()
  await beacon.getByText(`#${milestone.number} · échéance dans 9 jours`, { exact: true }).waitFor()
  await beacon.getByText(/^1 vague · 3 cartes à la fois au plus$|^\d vagues · 3 cartes à la fois au plus$/).waitFor()
  await beacon.getByText(/^Vague 1 ?· \d\/\d/).first().waitFor()
  // Une pastille par enfant non abandonnée, nommée au survol, qui mène à sa carte.
  assert.equal(await beacon.getByRole('link', { name: /^#\d+ .+ — / }).count(), 3, 'Une pastille par carte du jalon')
  for (const queue of ['Ensuite · 0', 'Plus tard · 0']) {
    await beacon.getByRole('heading', { name: queue, exact: true }).waitFor()
  }
  assert.equal(await beacon.getByText('Rien pour l’instant.', { exact: true }).count(), 2)
  assert.equal(
    await beacon.getByRole('link', { name: 'Tous les jalons · 1 livré', exact: true }).getAttribute('href'),
    `/p/${nimbus.id}/timeline`,
  )
  /* Le geste suivant : le repère « N t'attend » quand une demande du jalon est dans la
     liste — il la déplie là-haut sans la redire (A-3.8) —, sinon un bouton vers le jalon. */
  const mark = beacon.getByRole('button', { name: /^\d+ t’attend(ent)?$/ })
  if (await mark.count()) {
    await beacon.getByText('Le jalon reprend dès ta réponse.', { exact: true }).waitFor()
    await mark.click()
    await inbox.getByRole('button', { name: 'Fermer', exact: true }).waitFor()
    await inbox.getByRole('button', { name: 'Fermer', exact: true }).click()
  } else {
    await beacon.getByRole('button', { name: /./ }).first().click()
    await page.waitForURL(`**/p/${nimbus.id}/timeline/${milestone.number}`)
    await page.goBack()
    await beacon.waitFor()
  }
  /* La file : un jalon prêt part dans « Ensuite », une idée dans « Plus tard » (A-3.9).
     Posés ici et retirés après le téléphone, pour ne rien changer aux vues suivantes. */
  const createCard = async (data) => (await context.request.post(`${base}/api/projects/${nimbus.id}/cards`, { data })).json()
  const readyMilestone = await createCard({ title: 'Accès distant fiable', milestone: true })
  const readyChild = await createCard({ title: 'Adresse de secours', parentId: readyMilestone.id })
  const idea = await createCard({ title: 'Mode hors ligne complet', milestone: true })
  await page.reload()
  await beacon.getByRole('heading', { name: 'Ensuite · 1', exact: true }).waitFor()
  await beacon.getByRole('heading', { name: 'Plus tard · 1', exact: true }).waitFor()
  const queued = (title) => beacon.getByRole('link').filter({ hasText: title })
  assert.equal(await queued('Accès distant fiable').getAttribute('href'), `/p/${nimbus.id}/timeline/${readyMilestone.number}`)
  await queued('Accès distant fiable').getByText('Prêt', { exact: true }).waitFor()
  await queued('Mode hors ligne complet').getByText('Idée', { exact: true }).waitFor()
  await beacon.screenshot({ animations: 'disabled', path: join(shots, 'apercu-phare.png') })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'apercu-projet.png') })
  await actions.screenshot({ animations: 'disabled', path: join(shots, 'apercu-actions.png') })
  await events.screenshot({ animations: 'disabled', path: join(shots, 'apercu-evenements.png') })

  // Au téléphone, une seule colonne : la pile passe sous la place du code (A-7).
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  const [narrowInbox, narrowActions, narrowEvents] = await Promise.all([inbox.boundingBox(), actions.boundingBox(), events.boundingBox()])
  assert.ok(
    Math.abs(narrowActions.x - narrowInbox.x) <= 1 && Math.abs(narrowEvents.x - narrowInbox.x) <= 1,
    'Au téléphone, les blocs sont empilés sur la gouttière',
  )
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Rien ne déborde à 390 px')
  const narrowBeacon = await beacon.boundingBox()
  assert.ok(Math.abs(narrowBeacon.x - narrowInbox.x) <= 1, 'Au téléphone, le phare est sur la gouttière')
  await beacon.screenshot({ animations: 'disabled', path: join(shots, 'apercu-phare-mobile.png') })
  for (const card of [readyChild, readyMilestone, idea]) {
    assert.ok((await context.request.delete(`${base}/api/cards/${card.id}`)).ok())
  }
  // La liste des cartes en cache les porte encore : la page la relit.
  await page.reload()
  await beacon.waitFor()
  await actions.screenshot({ animations: 'disabled', path: join(shots, 'apercu-actions-mobile.png') })
  await events.screenshot({ animations: 'disabled', path: join(shots, 'apercu-evenements-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.unroute('**/api/actions')

  // ─── Les demandes des jalons dans « Ce qui t'attend » (#255) ───────────────
  await checkMilestoneAsks({ page, base, project: nimbus, shots })

  // ─── Code en cours : le graphe des branches et ses gestes (A-4) ──────────
  /*
    Le dépôt de Nimbus est celui du jeu d'essai, dans le dossier temporaire de la suite :
    les gestes y agissent pour de vrai (rebase, nettoyage), jamais sur un dépôt réel. Il
    a reçu un commit sur main et un arbre vide créé au shell : sans session, celui-ci est
    compté à nettoyer, pas montré. La forge n'existe pas ici : une PR prête est servie
    pour une branche, et sa fusion interceptée.
  */
  const statuses = await (await context.request.get(`${base}/api/projects/${nimbus.id}/worktrees/status`)).json()
  const quietTree = statuses.worktrees.find((tree) => tree.branch === 'feat/radar-prefetch')
  assert.ok(quietTree && quietTree.behind > 0, `feat/radar-prefetch a pris du retard : ${JSON.stringify(quietTree)}`)
  const prUrl = 'https://github.com/o/nimbus/pull/42'
  await page.route(`**/api/projects/${nimbus.id}/pull-requests`, (route) => route.fulfill({
    json: {
      available: true, fetchedAt: Date.now(),
      pullRequests: [{ number: 42, url: prUrl, title: 'Radar prefetch', branch: 'feat/radar-prefetch', base: 'main', state: 'ready', checks: { passed: 3, pending: 0, failed: [] }, review: null, updatedAt: Date.now() }],
    },
  }))
  const merged = []
  await page.route('**/api/projects/*/pull-requests/*/merge', (route) => {
    merged.push(new URL(route.request().url()).pathname)
    return route.fulfill({ json: { number: 42, url: prUrl, branch: 'feat/radar-prefetch', base: 'main' } })
  })

  await page.goto(`${base}/p/${nimbus.id}`)
  const code = page.getByRole('region', { name: 'Code en cours', exact: true })
  await code.waitFor()
  const lineButtons = code.locator('[data-line] button[aria-expanded]')
  await code.locator('[data-line]').filter({ hasText: 'feat/radar-prefetch' }).waitFor()
  const lineNames = await lineButtons.allInnerTexts()
  // A-4.5 et A-4.6 : la racine en tête ; l'arbre vide et sans session n'est que compté.
  assert.equal(lineNames[0], nimbus.git.branch, `La racine en tête : ${lineNames}`)
  assert.ok(lineNames.includes('feat/offline-cache') && lineNames.includes('feat/radar-prefetch'), `Les arbres vivants : ${lineNames}`)
  assert.ok(!lineNames.includes('feat/deja-fini'), 'Un arbre vide sans session est compté, pas montré')
  // A-4.2, A-4.4 : lignes de 56 px, colonnes fixes, en grand écran dans la moitié gauche.
  const lineOfCode = (branch) => code.locator('[data-line]').filter({ has: page.getByRole('button', { name: branch, exact: true }) })
  const radar = lineOfCode('feat/radar-prefetch')
  assert.equal(Math.round((await radar.boundingBox()).height), 56)
  assert.ok((await code.boundingBox()).x + (await code.boundingBox()).width < (await actions.boundingBox()).x, 'Le code est à gauche de la pile')
  await radar.getByText('prête à fusionner', { exact: true }).waitFor()
  await radar.getByText(/^#42$/).waitFor()
  await radar.getByText(new RegExp(`↓${quietTree.behind}`)).waitFor()
  await code.screenshot({ animations: 'disabled', path: join(shots, 'apercu-code.png') })

  // A-4.7 : un clic n'importe où sur la ligne la déplie ; une ligne à la fois.
  const radarToggle = radar.getByRole('button', { name: 'feat/radar-prefetch', exact: true })
  const radarBox = await radar.boundingBox()
  await page.mouse.click(radarBox.x + radarBox.width * 0.6, radarBox.y + 8)
  assert.equal(await radarToggle.getAttribute('aria-expanded'), 'true', 'Un clic sur la ligne la déplie')
  const radarGestures = page.locator(`[id="${await radarToggle.getAttribute('aria-controls')}"]`)
  for (const label of ['Voir le diff', 'Fusionner la PR #42', `Rebaser sur main (↓${quietTree.behind})`, 'Nettoyer l’arbre']) {
    await radarGestures.getByRole('button', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')}`) }).waitFor()
  }
  await radarGestures.getByText(/PR #42 · prête/).waitFor()
  await code.screenshot({ animations: 'disabled', path: join(shots, 'apercu-code-gestes.png') })
  const offlineToggle = lineOfCode('feat/offline-cache').getByRole('button', { name: 'feat/offline-cache', exact: true })
  await offlineToggle.focus()
  await page.keyboard.press('Enter')
  assert.equal(await offlineToggle.getAttribute('aria-expanded'), 'true', 'Entrée déplie une ligne')
  assert.equal(await radarToggle.getAttribute('aria-expanded'), 'false', 'Une seule ligne dépliée à la fois')
  await page.keyboard.press(' ')
  assert.equal(await offlineToggle.getAttribute('aria-expanded'), 'false', 'Espace la replie')

  // Fusionner la PR : une confirmation, puis la vraie route de fusion.
  await radarToggle.click()
  await radarGestures.getByRole('button', { name: 'Fusionner la PR #42' }).click()
  const mergeDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
  await mergeDialog.getByText('Fusionner la PR #42 ?').waitFor()
  await mergeDialog.getByRole('button', { name: 'Fusionner', exact: true }).click()
  await code.getByText('PR #42 fusionnée.').waitFor()
  assert.deepEqual(merged, [`/api/projects/${nimbus.id}/pull-requests/42/merge`])
  await page.unroute('**/api/projects/*/pull-requests/*/merge')

  // Nettoyer : le dialogue avec le plan réel ; on ne nettoie pas, on regarde.
  await radarGestures.getByRole('button', { name: 'Nettoyer l’arbre' }).click()
  const cleanDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
  await cleanDialog.getByText(/feat\/radar-prefetch/).first().waitFor()
  await cleanDialog.getByText(/Supprimer la branche|branche/).first().waitFor()
  await page.keyboard.press('Escape')
  await cleanDialog.waitFor({ state: 'detached' })

  // Rebaser : sans session vivante, l'arbre est rebasé sur place, dans le dépôt d'essai.
  if ((await radarToggle.getAttribute('aria-expanded')) !== 'true') await radarToggle.click()
  await radarGestures.getByRole('button', { name: /^Rebaser sur main/ }).click()
  await code.getByText(/feat\/radar-prefetch rebasée sur main\.|Rebase demandé à sa session\./).waitFor()
  await code.getByText('feat/radar-prefetch rebasée sur main.', { exact: true }).waitFor()
  // Dans le dépôt lui-même : le cache de l'état des arbres n'a pas à être cru sur parole.
  assert.equal(String(gitIn(nimbus.workspacePath, 'rev-list', '--count', 'feat/radar-prefetch..main')).trim(), '0', 'Le rebase a été fait pour de vrai')

  // « + 1 arbre fusionné à nettoyer » mène à Travail, Par arbre, filtré « À nettoyer ».
  const settledLink = code.getByRole('link', { name: /^\+ \d+ arbres? fusionnés? à nettoyer$/ })
  assert.match(await settledLink.getAttribute('href'), new RegExp(`/p/${nimbus.id}/travail\\?vue=couloirs&etat=cleanup$`))
  await settledLink.click()
  await page.waitForURL(`**/p/${nimbus.id}/travail?vue=couloirs`)
  await page.locator('[data-filter-chip]').filter({ hasText: 'À nettoyer' }).waitFor()
  await page.unroute(`**/api/projects/${nimbus.id}/pull-requests`)
  // Le filtre imposé est retenu comme un autre : on le retire pour la suite.
  await page.locator('[data-filter-chip]').filter({ hasText: 'À nettoyer' }).getByRole('button', { name: 'Retirer ce filtre' }).click()

  // Voir le diff : la racine ouvre le panneau git sur place, ou dans sa session.
  await page.goto(`${base}/p/${nimbus.id}`)
  await code.waitFor()
  const rootToggle = lineButtons.first()
  await rootToggle.click()
  const rootGestures = page.locator(`[id="${await rootToggle.getAttribute('aria-controls')}"]`)
  assert.equal(await rootGestures.getByRole('button', { name: /^Rebaser/ }).count(), 0, 'On ne rebase pas la racine')
  assert.equal(await rootGestures.getByRole('button', { name: /Nettoyer/ }).count(), 0, 'On ne nettoie pas la racine')
  await rootGestures.getByRole('button', { name: /^Voir le diff/ }).click()
  await page.getByRole('tab', { name: 'Git', selected: true }).or(page.getByRole('button', { name: 'Git', pressed: true })).first().waitFor()

  // Au téléphone : le graphe, le texte et le `⋯` ; la dérive passe au pied d'une ligne dépliée.
  await page.goto(`${base}/p/${nimbus.id}`)
  await page.setViewportSize({ width: 390, height: 844 })
  await code.waitFor()
  await page.waitForTimeout(300)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Le graphe ne déborde pas à 390 px')
  assert.equal(
    await lineOfCode('feat/offline-cache').evaluate((line) => [...line.children].filter((cell) => cell.getBoundingClientRect().width > 0).length),
    3,
    'Au téléphone, trois cases : le graphe, le texte, le ⋯',
  )
  await code.screenshot({ animations: 'disabled', path: join(shots, 'apercu-code-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 900 })

  /*
    Les Jalons (#190) : le jalon du jeu d'essai est sur l'horizon, rangé à son étape, et
    son nom mène à sa page. Le détail se vérifie dans `milestones-ui-check.mjs`.
  */
  await row.getByRole('link', { name: /^Jalons/ }).click()
  await page.waitForURL(`**/p/${nimbus.id}/timeline`)
  const milestoneLink = page.getByRole('link', { name: new RegExp(milestone.title) }).first()
  await milestoneLink.waitFor()
  assert.equal(await milestoneLink.getAttribute('href'), `/p/${nimbus.id}/timeline/${milestone.number}`)
  await page.getByRole('list', { name: 'Jalons par étape', exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'jalons-projet.png') })

  const schedules = await (await context.request.get(`${base}/api/schedules`)).json()

  // Un projet calme ne montre pas un bandeau vide, il le dit ; ses actions aussi.
  await page.goto(`${base}/p/${docs.id}`)
  await page.getByText('Rien ne t’attend.', { exact: true }).waitFor()
  const calm = page.getByRole('region', { name: 'Actions', exact: true })
  await calm.getByText(/^(Aucune action dans ce projet\.|Rien ne tourne\.)$/).waitFor()
  assert.equal(
    await calm.getByRole('link', { name: 'L’onglet Actions', exact: true }).getAttribute('href'),
    `/p/${docs.id}/actions`,
  )

  // ─── Le portefeuille : coque et Aperçu (#237) ───────────────────────────────
  await page.goto(`${base}/projects`)
  const portfolio = page.getByRole('navigation', { name: 'Vues du portefeuille', exact: true })
  await portfolio.waitFor()
  /* La rangée : Aperçu, Travail, Tableau, Jalons. Actions attend sa vue du portefeuille
     (#241) : masqué d'ici là, plutôt que de mener hors de la coque. */
  assert.deepEqual(
    await portfolio.getByRole('link').evaluateAll((links) => links.map((link) => new URL(link.href).pathname)),
    ['/projects', '/projects/travail', '/projects/board', '/projects/timeline'],
    'Aperçu · Travail · Tableau · Jalons',
  )
  // La bande : un seul geste, « + Projet », et plus de « + Conversation ».
  const portfolioBand = page.locator('header').filter({ has: page.getByRole('heading', { name: 'Projets', exact: true }) })
  await portfolioBand.getByRole('button', { name: 'Nouveau projet', exact: true }).waitFor()
  assert.equal(await portfolioBand.getByRole('button').count(), 1, 'La bande du portefeuille ne porte que « + Projet »')
  // Réglages au bout : ceux de l'instance, en fenêtre.
  await portfolio.getByRole('button', { name: 'Réglages de l’instance', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })

  // L'Aperçu, dans son ordre : ce qui t'attend, les projets, puis le code et les événements.
  const portfolioOverview = page.locator('[data-place-content]')
  const projectsRegion = page.getByRole('region', { name: 'Projets', exact: true })
  await projectsRegion.waitFor()
  for (const project of projects) {
    await projectsRegion.locator(`a[href="/p/${project.id}"]`).waitFor()
  }
  const codeRegion = page.getByRole('region', { name: 'Code en cours', exact: true })
  const eventsRegion = page.getByRole('region', { name: 'Derniers événements', exact: true })
  await Promise.all([codeRegion.waitFor(), eventsRegion.waitFor()])
  assert.equal(await portfolioOverview.getByRole('searchbox').count(), 0, "Pas de barre d'outils sur l'Aperçu du portefeuille")
  const order = await portfolioOverview.evaluate((root) =>
    [...root.querySelectorAll('section[aria-labelledby]')].map((section) => section.querySelector('h2')?.textContent),
  )
  assert.deepEqual(
    order.filter((title) => ['Projets', 'Code en cours', 'Derniers événements'].includes(title)),
    ['Projets', 'Code en cours', 'Derniers événements'],
  )
  // « Tout le travail » mène à Travail du portefeuille.
  assert.equal(await codeRegion.getByRole('link', { name: /^Tout le travail/ }).getAttribute('href'), '/projects/travail')
  // Chaque arbre du code en cours ouvre l'arbre dans Travail de son projet.
  const treeLinks = await codeRegion.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  if (treeLinks.length === 0) await codeRegion.getByText('Rien ne tourne.', { exact: true }).waitFor()
  for (const href of treeLinks.filter((link) => link !== '/projects/travail')) assert.match(href, /^\/p\/[^/]+\/travail\?arbre=/)
  // Les événements de tous les projets, huit au plus, chacun avec son projet.
  const portfolioEvents = eventsRegion.locator('li')
  assert.ok((await portfolioEvents.count()) > 0 && (await portfolioEvents.count()) <= 8, 'Huit derniers événements au plus')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-apercu.png') })
  // Une carte mène à son projet.
  await projectsRegion.locator(`a[href="/p/${nimbus.id}"]`).click()
  await page.waitForURL(`**/p/${nimbus.id}`)

  // ─── Le portefeuille : Travail (#238) ───────────────────────────────────────
  // Les anciennes vues mènent à Travail, qui les a reprises ; le Journal à Par moment.
  for (const old of ['activity', 'work']) {
    await page.goto(`${base}/projects/${old}`)
    await page.waitForURL(/\/projects\/travail(\?vue=projet)?$/)
  }
  await page.goto(`${base}/projects/journal`)
  await page.waitForURL(/\/projects\/travail\?vue=moment$/)
  const work = page.locator('[data-place-content]')
  await work.locator('[data-work-day]').first().or(work.getByText('Rien sur la période.', { exact: true })).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-travail-moment.png') })

  /* Par projet : un groupe par projet qui a des arbres, chacun ouvrant l'arbre dans Travail
     de son projet. Un arbre fusionné de Nimbus est servi comme tel (la forge n'existe pas
     ici) : il se replie sous son projet, et « Nettoyer · N » apparaît dans la barre. */
  const radarPath = statuses.worktrees.find((tree) => tree.branch === 'feat/radar-prefetch').path
  await page.route('**/api/worktrees/status', async (route) => {
    const json = await (await route.fetch()).json()
    for (const tree of json.projects[nimbus.id]?.worktrees ?? []) {
      if (tree.path === radarPath) Object.assign(tree, { state: 'merged', unmergedCommits: false, ahead: 0 })
    }
    await route.fulfill({ json })
  })
  await page.goto(`${base}/projects/travail?vue=projet`)
  const nimbusGroup = work.locator(`[data-work-group="${nimbus.id}"]`)
  await nimbusGroup.waitFor()
  await nimbusGroup.locator(`a[href="/p/${nimbus.id}"]`).first().waitFor()
  const workLinks = await work.locator('[data-work-tree] a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  assert.ok(workLinks.length > 0, 'Travail du portefeuille montre des arbres')
  for (const href of workLinks) assert.match(href, /^\/p\/[^/]+\/travail\?arbre=/)
  const folded = nimbusGroup.locator('[data-work-folded]')
  await folded.getByText(/^1 arbre fusionné/).waitFor()
  assert.equal(await nimbusGroup.locator(`a[href="/p/${nimbus.id}/travail?arbre=${encodeURIComponent(radarPath)}"]`).count(), 0, 'Le fusionné est replié')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-travail.png') })

  // « Nettoyer » ouvre le dialogue de Travail sur le projet, avec son plan réel ; on regarde sans nettoyer.
  const workToolbar = page.locator('[data-toolbar]')
  await workToolbar.getByRole('button', { name: /^Nettoyer · \d+$/ }).click()
  const portfolioClean = page.locator('[data-clean-dialog]')
  await portfolioClean.getByText('feat/radar-prefetch', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await portfolioClean.waitFor({ state: 'detached' })

  // « Montrer les fusionnés » le déplie dans son groupe.
  await workToolbar.getByRole('button', { name: /^Affichage/ }).click()
  await page.getByRole('checkbox', { name: 'Arbres fusionnés et à nettoyer' }).click()
  await page.keyboard.press('Escape')
  await nimbusGroup.locator(`a[href="/p/${nimbus.id}/travail?arbre=${encodeURIComponent(radarPath)}"]`).waitFor()
  assert.equal(await folded.count(), 0, 'Plus de repli')
  await workToolbar.getByRole('button', { name: /^Affichage/ }).click()
  await page.getByRole('checkbox', { name: 'Arbres fusionnés et à nettoyer' }).click()
  await page.keyboard.press('Escape')
  await folded.waitFor()

  // Filtrer ▾ › Projet : seul Nimbus reste, sa puce porte son nom.
  await workToolbar.getByRole('button', { name: /^Filtrer/ }).click()
  await page.getByRole('checkbox', { name: /Nimbus/ }).click()
  await page.keyboard.press('Escape')
  await workToolbar.locator('[data-filter-chip]').filter({ hasText: 'Nimbus' }).waitFor()
  await page.waitForFunction((id) => [...document.querySelectorAll('[data-work-group]')].every((group) => group.dataset.workGroup === id), nimbus.id)

  // Tableau : une seule table, la colonne Projet, chaque ligne avec sa pastille.
  await workToolbar.getByRole('button', { name: /^Affichage/ }).click()
  await page.getByRole('radio', { name: 'Tableau', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForURL(/vue=tableau/)
  const table = page.getByRole('region', { name: 'Tableau', exact: true })
  await table.getByText('Projet', { exact: true }).waitFor()
  assert.equal(await table.locator('[data-work-tree]').count(), await table.locator('[data-work-tree]').filter({ hasText: 'Nimbus' }).count(), 'Chaque ligne nomme son projet')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-travail-tableau.png') })
  await workToolbar.locator('[data-filter-chip]').filter({ hasText: 'Nimbus' }).getByRole('button', { name: 'Retirer ce filtre' }).click()

  // Un clic sur un arbre l'ouvre dans Travail de son projet.
  await table.locator(`[data-work-tree^="${nimbus.id}:"] a`).first().click()
  await page.waitForURL(new RegExp(`/p/${nimbus.id}/travail\\?arbre=`))
  await page.unroute('**/api/worktrees/status')
  await page.goto(`${base}/projects`)
  await portfolio.waitFor()

  // Le Tableau du portefeuille : ses couloirs, filtres et clics sont dans `board-ui-check`.
  await portfolio.getByRole('link', { name: /^Tableau/ }).click()
  await page.waitForURL('**/projects/board')
  await page.locator('[data-portfolio-board] [data-card-tile]').first().waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-board.png') })

  /*
    Les Jalons du portefeuille (#240, PF-28 à PF-31) : les jalons de tous les projets sur
    le modèle de maturité. **Horizon** : une bande par projet, une tuile par jalon qui
    mène à sa page ; **Gantt** : un axe commun, une bande par projet, la barre d'un jalon
    cliquable. Le filtre Projet de la barre commune retire les bandes des autres.
  */
  await page.goto(`${base}/projects/timeline`)
  const nimbusBand = page.getByRole('region', { name: nimbus.name, exact: true })
  const tile = nimbusBand.locator(`a[href="/p/${nimbus.id}/timeline/${milestone.number}"]`)
  await tile.waitFor()
  assert.match(await tile.textContent(), new RegExp(`#${milestone.number}`), 'La tuile porte le numéro du jalon')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-jalons-horizon.png') })
  const milestoneProjects = await page.locator('[data-place-content] section[aria-label]').evaluateAll((sections) =>
    sections.map((section) => section.getAttribute('aria-label')),
  )
  const other = projects.find((entry) => entry.id !== nimbus.id && milestoneProjects.includes(entry.name))
  await page.getByRole('button', { name: /^Filtrer/ }).click()
  await page.getByRole('dialog', { name: 'Filtrer' }).getByRole('checkbox', { name: new RegExp(nimbus.name) }).click()
  await page.keyboard.press('Escape')
  await nimbusBand.waitFor()
  if (other) await page.getByRole('region', { name: other.name, exact: true }).waitFor({ state: 'detached' })
  // Le Gantt commun : la barre du jalon mène à sa page dans son projet.
  await page.getByRole('button', { name: /^Affichage : / }).click()
  await page.getByRole('dialog', { name: 'Affichage' }).getByRole('radio', { name: 'Gantt', exact: true }).click()
  await page.keyboard.press('Escape')
  const bar = page.locator(`[data-milestone-bar="${milestone.number}"]`)
  await bar.waitFor()
  await page.locator(`a[href="/p/${nimbus.id}/timeline/${milestone.number}"]`).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-jalons-gantt.png') })
  await bar.click()
  await page.waitForURL(`**/p/${nimbus.id}/timeline/${milestone.number}`)

  /*
    Le Journal : sept sources mêlées, et c'est leur **alignement** qu'une relecture ne
    verrait pas. Deux d'entre elles ne sont pas en base — une branche fusionnée se lit
    dans git, un audit versé sur le disque — et rien dans le code ne garantit qu'elles
    arrivent bien jusqu'à la page.
  */
  await page.goto(`${base}/p/${nimbus.id}/travail?vue=fil`)
  await page.getByRole('heading', { name: 'Maintenant', exact: true }).waitFor()
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
  await page.screenshot({ animations: 'disabled', path: join(shots, 'projet-journal.png') })

  // ─── La page Planifiées ───────────────────────────────────────────────────
  // Une tuile par tâche, au gabarit du Lanceur (AC-20) ; la pause part de son ⋯, sans formulaire.
  await page.goto(`${base}/schedules?vue=lanceur`)
  const tiles = page.locator('[data-planned-tile]')
  await tiles.first().waitFor()
  assert.equal(await tiles.count(), schedules.filter((entry) => entry.cadence || !entry.projectId).length, 'Une tuile par tâche')
  const first = schedules.find((entry) => entry.enabled && entry.cadence)
  if (first) {
    await page.getByRole('button', { name: `Plus pour « ${first.name} »`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Mettre en pause', exact: true }).click()
    await page.waitForFunction(
      (id) => fetch(`/api/schedules`).then((r) => r.json()).then((list) => list.find((e) => e.id === id)?.enabled === false),
      first.id,
    )
    await page.locator(`[data-planned-tile="t-${first.id}"]`).getByRole('button', { name: `Reprendre « ${first.name} »`, exact: true }).waitFor()
  }
  await page.screenshot({ animations: 'disabled', path: join(shots, 'page-planifiees.png') })

  // ─── Au doigt ─────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/p/${nimbus.id}`)
  await page.getByRole('region', { name: 'Derniers événements', exact: true }).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'apercu-mobile.png') })
  await page.goto(`${base}/projects`)
  await page.getByRole('region', { name: 'Derniers événements', exact: true }).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'projets-mobile.png') })
  // Au doigt la provenance disparaît, et c'est voulu : l'heure et le titre tiennent.
  await page.goto(`${base}/p/${nimbus.id}/travail?vue=fil`)
  await page.getByRole('heading', { name: 'Maintenant', exact: true }).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'journal-mobile.png') })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/p/${nimbus.id}`)
  await page.getByRole('region', { name: 'Derniers événements', exact: true }).waitFor()
  // Le thème se pose après la navigation : `goto` recharge le document et emporterait
  // l'attribut avec lui.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'apercu-sombre.png') })
  await page.goto(`${base}/p/${nimbus.id}/travail?vue=fil`)
  await page.getByRole('heading', { name: 'Maintenant', exact: true }).waitFor()
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'journal-sombre.png') })

  // Sans projet, l'Aperçu du portefeuille propose d'en créer un. En dernier : la suite
  // archive tous les projets pour y arriver.
  for (const project of projects) {
    assert.ok((await context.request.patch(`${base}/api/projects/${project.id}`, { data: { archived: true } })).ok())
  }
  await page.goto(`${base}/projects`)
  await page.getByText('Aucun projet', { exact: true }).waitFor()
  // Celui de la page : la ligne Projets de la sidebar porte aussi un raccourci du même nom.
  assert.equal(await page.getByRole('main').getByRole('link', { name: 'Créer un projet' }).getAttribute('href'), '/projects/new')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-vide.png') })

  assert.deepEqual(errors, [])
  console.log('OK : coque v2 (rangée, Réglages au bout, comptes, gouttière, anciennes adresses), bandeau sans inventaire, coque, Aperçu et Travail du portefeuille (anciennes vues, filtres, Tableau, Nettoyer, état vide), board global, les Jalons du portefeuille, le journal, page des Planifiées, mobile ; captures dans ' + shots)
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
