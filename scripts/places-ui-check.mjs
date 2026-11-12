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
  // Tant que la vue Actions n'est pas livrée, l'onglet rend les Planifiées du projet,
  // et leur « + Tâche » est en tête de la page.
  await page.getByRole('button', { name: 'Tâche', exact: true }).click()
  await page.getByRole('dialog').waitFor()
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
    phare des jalons, puis une grille — à gauche la place du « Code en cours », à droite
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
    v1.1 est livrée ; il n'y a pas d'autre jalon, donc les deux files sont vides.
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
  await actions.screenshot({ animations: 'disabled', path: join(shots, 'apercu-actions-mobile.png') })
  await events.screenshot({ animations: 'disabled', path: join(shots, 'apercu-evenements-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.unroute('**/api/actions')

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
    (entry) => entry.parent === null && entry.dueAt === null
      && entry.column !== 'done' && entry.column !== 'abandoned',
  )
  if (unplaced.length > 0) {
    await page.getByText(new RegExp(`${unplaced.length} cartes sans jalon ni date`)).waitFor()
  }
  await page.screenshot({ animations: 'disabled', path: join(shots, 'chronologie-projet.png') })

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

  // ─── Le portefeuille : Projets, Board global, Activité ─────────────────────
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
  // La même coque qu'un projet : Réglages au bout, qui ouvre ceux de l'instance.
  await portfolio.getByRole('button', { name: 'Réglages de l’instance', exact: true }).waitFor()
  await portfolio.getByRole('link', { name: /^Tableau/ }).click()
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

  // L'Activité du portefeuille (#117) : la liste d'un projet, une colonne Projet en
  // plus, et Travail qui s'y fond. L'ancienne adresse y mène.
  await page.goto(`${base}/projects/work`)
  await page.waitForURL(/\/projects\/activity$/)
  const review = page.locator('section[aria-labelledby="portfolio-activity-review"]')
  await review.waitFor()
  // La carte en *À vérifier* du jeu d'essai, par sa session ou par une ligne de carte.
  await review.getByText('#4', { exact: true }).waitFor()
  await page.getByText(nimbus.name, { exact: true }).first().waitFor()
  assert.equal(await page.getByRole('heading', { name: /^À faire/ }).count(), 0, "L'Activité groupe par demande, pas par colonne")
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-activite.png') })
  // Grouper par projet : un en-tête par projet, et plus de groupe d'état.
  await page.getByRole('radio', { name: 'Projet' }).click()
  await page.waitForURL(/groupe=project/)
  await page.locator(`section[aria-labelledby="portfolio-activity-project-${nimbus.id}"]`).waitFor()
  assert.equal(await review.count(), 0, 'Grouper par projet retire les groupes d’état')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-activite-par-projet.png') })

  // La chronologie du portefeuille : les projets en lignes, leurs jalons en barres. Un
  // projet sans jalon le dit, plutôt que de laisser sa ligne muette.
  await page.goto(`${base}/projects/timeline`)
  await page.getByRole('button', { name: new RegExp(milestone.title) }).first().waitFor()
  await page.getByText('aucun jalon', { exact: true }).first().waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'portefeuille-chronologie.png') })

  // Le filtre *Jalon* du board global : il liste des **cartes**, puisqu'un jalon en est
  // une, et il se partage par lien comme les deux autres. L'ancien nom du paramètre,
  // d'avant l'arbre de cartes (#83), mène encore au filtre.
  await page.goto(`${base}/projects/board?jalon=${milestone.id}`)
  await page.waitForURL(`**/projects/board?parente=${milestone.id}`)
  await page.getByRole('button', { name: /^Retirer le filtre/ }).waitFor()
  const attached = cards.filter((entry) => entry.parent?.id === milestone.id)
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
  await page.getByRole('region', { name: 'Derniers événements', exact: true }).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'apercu-mobile.png') })
  await page.goto(`${base}/projects`)
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

  assert.deepEqual(errors, [])
  console.log('OK : coque v2 (rangée, Réglages au bout, comptes, gouttière, anciennes adresses), bandeau sans inventaire, lignes de projets, board global, Activité, les deux chronologies et les deux journaux, table des planifiées, mobile ; captures dans ' + shots)
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
