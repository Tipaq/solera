import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { closePanelButton } from './checks/panel.mjs'
import { checkEditor } from './checks/editor.mjs'
import { checkSearch } from './checks/search.mjs'
import { checkImage } from './checks/image.mjs'
import { checkIde } from './checks/ide.mjs'
import { checkDownloads } from './checks/downloads.mjs'
import { checkConversationInstructions } from './checks/conversation-instructions.mjs'
import { checkMedia } from './checks/media.mjs'

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

  /**
   * Les réglages ne sont plus une page : l'ancienne adresse ouvre la modale et rend
   * la main à l'accueil. C'est le seul chemin que cette suite a pour l'ouvrir tant que
   * le menu du compte n'est pas porté.
   */
  const openSettings = async (target, section) => {
    await target.goto(`${base}/settings/${section}`)
    await target.getByRole('dialog', { name: 'Réglages', exact: true }).waitFor()
  }
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
  const cards = await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json()
  const card = cards.find((entry) => entry.number === 2)
  const board = `${base}/p/${project.id}/board`
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const description = page.getByRole('textbox', { name: 'Description', exact: true })
  const save = page.getByRole('button', { name: 'Enregistrer', exact: true })
  const close = page.getByRole('button', { name: 'Fermer', exact: true })
  const openCard = async (number) => {
    await page.goto(`${board}?carte=${number}`)
    await page.getByLabel(`Carte #${number}`, { exact: true }).waitFor()
    if (await description.count() === 0) await page.getByRole('button', { name: 'Modifier la carte', exact: true }).click()
    await description.waitFor()
  }

  await openCard(2)
  const draft = `${card.description}\nBrouillon de vérification`
  await description.fill(draft)
  await close.click()
  await page.getByRole('button', { name: /#2 Offline caching for forecasts/ }).click()
  assert.equal(await description.inputValue(), draft, 'Closing a card must preserve its draft')
  await page.reload()
  await description.waitFor()
  assert.equal(await description.inputValue(), draft, 'Reloading must preserve the draft')
  await openCard(1)
  assert.notEqual(await description.inputValue(), draft, 'Drafts belong to their card')
  await openCard(2)
  assert.equal(await description.inputValue(), draft)

  const endpoint = `**/api/cards/${card.id}`
  await page.route(endpoint, (route) => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, json: { error: { code: 'ui_test_failure', message: 'Simulated write failure' } } })
    : route.continue())
  await save.click()
  await page.getByRole('alert').filter({ hasText: 'Enregistrement impossible' }).waitFor()
  assert.equal(await description.inputValue(), draft, 'A failed save must preserve the draft')
  await page.unroute(endpoint)

  let release
  let intercepted
  const pending = new Promise((resolve) => { intercepted = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  await page.route(endpoint, async (route) => {
    if (route.request().method() === 'PATCH') {
      intercepted()
      await gate
    }
    await route.continue()
  })
  await save.click()
  await pending
  const newerDraft = `${draft}\nAjout pendant la sauvegarde`
  await description.fill(newerDraft)
  await close.click()
  await page.getByRole('button', { name: /#2 Offline caching for forecasts/ }).click()
  assert.equal(await page.getByRole('button', { name: 'Enregistrement…', exact: true }).isDisabled(), true)
  const response = page.waitForResponse((entry) => entry.url().endsWith(`/api/cards/${card.id}`) && entry.request().method() === 'PATCH')
  release()
  await response
  await save.waitFor()
  assert.equal(await description.inputValue(), newerDraft, 'An earlier save must not erase newer input')
  await page.unroute(endpoint)
  await save.click()
  await page.getByText('Brouillon conservé dans cet onglet.', { exact: false }).waitFor({ state: 'hidden' })
  await page.reload()
  await page.getByRole('button', { name: 'Modifier la carte', exact: true }).click()
  await description.waitFor()
  assert.equal(await description.inputValue(), newerDraft, 'Successful changes must be persisted by the API')
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('solera.cardDraft:')).length), 0)
  const latestSession = card.conversations.filter((session) => !session.archivedAt).sort((a, b) => b.createdAt - a.createdAt)[0]
  assert.ok(latestSession)
  await page.getByRole('button', { name: 'Reprendre la session', exact: true }).click()
  await page.waitForURL(`**/c/${latestSession.id}`)
  await openCard(2)
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click()
  await page.waitForURL(`**/c/new?card=${card.id}`)
  console.log('OK : brouillons par carte, échec et sauvegarde concurrente, reprise et nouvelle session.')


  await page.goto(`${board}?carte=2`)
  await page.getByRole('button', { name: 'Modifier la carte', exact: true }).waitFor()
  assert.equal(await description.count(), 0, 'A saved card opens for reading')
  const noteField = page.getByRole('textbox', { name: 'Ajouter une note', exact: true })
  const addNote = page.getByRole('button', { name: 'Ajouter une note', exact: true })
  const noteA = 'Une note à conserver après fermeture.'
  const noteB = 'Une deuxième note écrite pendant la publication.'
  await page.getByLabel('Carte #2', { exact: true }).getByRole('tab', { name: /^Activité/ }).click()
  await noteField.fill(noteA)
  await close.click()
  await page.getByRole('button', { name: /#2 Offline caching for forecasts/ }).click()
  await page.getByLabel('Carte #2', { exact: true }).getByRole('tab', { name: /^Activité/ }).click()
  assert.equal(await noteField.inputValue(), noteA)
  await page.reload()
  await page.getByLabel('Carte #2', { exact: true }).getByRole('tab', { name: /^Activité/ }).click()
  await noteField.waitFor()
  await page.getByLabel('Carte #2', { exact: true }).getByRole('tab', { name: /^Activité/ }).click()
  assert.equal(await noteField.inputValue(), noteA)
  const noteEndpoint = `**/api/cards/${card.id}/notes`
  await page.route(noteEndpoint, (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 500, json: { error: { code: 'ui_test', message: 'Simulated note failure' } } })
    : route.continue())
  await addNote.click()
  await page.getByRole('alert').filter({ hasText: 'La note n’a pas été enregistrée.' }).waitFor()
  await page.getByLabel('Carte #2', { exact: true }).getByRole('tab', { name: /^Activité/ }).click()
  assert.equal(await noteField.inputValue(), noteA)
  await page.unroute(noteEndpoint)
  let releaseNote, noteSent
  const noteGate = new Promise((resolve) => { releaseNote = resolve })
  const noteIntercepted = new Promise((resolve) => { noteSent = resolve })
  await page.route(noteEndpoint, async (route) => {
    if (route.request().method() === 'POST') { noteSent(); await noteGate }
    await route.continue()
  })
  await addNote.click()
  await noteIntercepted
  await noteField.fill(noteB)
  await close.click()
  await page.getByRole('button', { name: /#2 Offline caching for forecasts/ }).click()
  await page.getByLabel('Carte #2', { exact: true }).getByRole('tab', { name: /^Activité/ }).click()
  assert.equal(await page.getByRole('button', { name: 'Enregistrement…', exact: true }).isDisabled(), true)
  releaseNote()
  await page.getByText(noteA, { exact: true }).waitFor()
  assert.equal(await noteField.inputValue(), noteB, 'Publishing an earlier note must preserve newer input')
  await page.unroute(noteEndpoint)
  await addNote.click()
  await page.getByText(noteB, { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Ajouter une note"]')?.value === '')
  assert.equal(await page.getByText(noteA, { exact: true }).isVisible(), false, 'Older notes are collapsed')
  await page.getByText(/^Notes précédentes \(/).click()
  await page.getByText(noteA, { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('solera.cardNoteDraft:')).length), 0)
  await page.reload()
  await page.getByLabel('Carte #2', { exact: true }).getByRole('tab', { name: /^Activité/ }).click()
  await page.getByText(noteB, { exact: true }).waitFor()
  console.log('OK : lecture de carte, brouillons de notes, échec de publication et dernière note en premier.')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(board)
  const column = page.getByRole('region', { name: 'À faire', exact: true })
  await column.waitFor()
  assert.ok((await column.boundingBox()).width >= 360, 'The mobile board must use its available width')
  await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus() })
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Ouvrir la navigation')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Fermer la navigation')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement.closest('[role="dialog"]')?.getAttribute('aria-label')), 'Navigation')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Ouvrir la navigation')
  console.log('OK : largeur du board, navigation invisible inerte, focus contenu et restitué.')

  const firstCard = cards.find((entry) => entry.number === 1)
  const opener = page.locator(`[data-card-open="${firstCard.id}"]`)
  await opener.click()
  const mobileCard = page.getByRole('dialog', { name: 'Carte #1', exact: true })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Fermer')
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i === 0 ? 'Shift+Tab' : 'Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute('aria-label')), 'Carte #1')
  }
  await page.keyboard.press('Escape')
  await page.waitForFunction((id) => document.activeElement?.getAttribute('data-card-open') === id, firstCard.id)
  await opener.click()
  await mobileCard.getByRole('button', { name: /^Changer la colonne/ }).click()
  await page.getByRole('menu').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  assert.equal(await mobileCard.isVisible(), true, 'Escape in the column menu must leave the card open')
  await mobileCard.getByRole('button', { name: /^Changer la colonne/ }).click()
  await page.getByRole('menuitem', { name: 'À vérifier', exact: true }).click()
  await mobileCard.getByRole('button', { name: 'Changer la colonne : À vérifier', exact: true }).waitFor()
  await mobileCard.getByRole('button', { name: 'Fermer', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Ouvrir la navigation')
  await page.getByRole('button', { name: 'Ouvrir le panneau', exact: true }).click()
  const workspace = page.getByRole('dialog', { name: 'Panneau du workspace', exact: true })
  await workspace.waitFor()
  // La recherche est une vue du panneau depuis le 2026-10-11 : le champ de filtre de
  // l'arborescence a disparu, et ses résultats ont leur propre liste.
  await workspace.getByRole('button', { name: 'Recherche', exact: true }).click()
  const searchFile = workspace.getByRole('searchbox', { name: 'Chercher dans le répertoire de travail', exact: true })
  await searchFile.fill('README')
  await page.keyboard.press('Escape')
  assert.equal(await workspace.isVisible(), true, 'Escape in file search must not close the workspace')
  assert.equal(await searchFile.inputValue(), '')
  await searchFile.fill('README')
  await workspace.locator('[data-search-results]').getByText('README.md', { exact: true }).first().click()
  await workspace.getByRole('button', { name: 'Source', exact: true }).click()
  const code = page.locator('[data-panel="workspace"] .cm-content').first()
  await code.waitFor()
  await code.evaluate((node) => { window.uiEditorNode = node })
  await code.click()
  await page.keyboard.press('Escape')
  assert.equal(await workspace.isVisible(), true, 'Escape remains available inside the editor')
  await page.setViewportSize({ width: 1440, height: 900 })
  assert.equal(await code.evaluate((node) => node === window.uiEditorNode), true)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await code.evaluate((node) => node === window.uiEditorNode), true, 'Resizing must retain the editor DOM')
  await (await closePanelButton(page)).focus()
  // Au clavier, le premier Échap ferme l'aide du bouton avant le panneau.
  await page.getByRole('tooltip').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('tooltip').waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Ouvrir le panneau')
  console.log('OK : focus des panneaux, menu superposé, raccourcis de l’éditeur et redimensionnement sans remontage.')

  await checkEditor({ page, context, base, project })
  await checkIde({ page, context, base, project })
  await checkSearch({ page, base, project })
  await checkImage({ page, base, project })
  await checkMedia({ page, context, base, project })
  // Le contrôle multimédia laisse le panneau ouvert ; repartir du board seul.
  await (await closePanelButton(page)).click()
  await checkDownloads({ page, context, base, project, hero, data })
  await checkConversationInstructions({ page, context, base, project, hero })


  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/p/${project.id}/c/${hero.id}`)
  await page.getByRole('button', { name: 'Ouvrir le panneau', exact: true }).click()
  const panel = page.locator('[data-panel="workspace"]')
  // Accoler et élargir se règlent à la poignée depuis que le panneau n'a plus
  // d'en-tête pour les porter.
  const grip = page.getByRole('separator', { name: /^Largeur du panneau/ })
  await grip.waitFor()
  const composer = page.locator('form').filter({ has: page.getByPlaceholder('Écris ton message...') })
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-panel="workspace"]')).translate === '0px')
  const docked = await panel.boundingBox()
  const composerBounds = await composer.boundingBox()
  assert.ok(composerBounds.width >= 400 && docked.width >= 320)
  assert.ok(composerBounds.x + composerBounds.width <= docked.x + 1, 'The panel must not cover the conversation')
  await panel.getByRole('button', { name: 'Git', exact: true }).click()
  await grip.dblclick()
  assert.ok((await panel.boundingBox()).width > docked.width, 'Double-clicking the grip lays the panel over the thread')
  assert.equal(await panel.getByRole('button', { name: 'Git', exact: true }).getAttribute('aria-pressed'), 'true')
  // Le clavier, lui, parcourt les trois : le plein écran n'est pas au double-clic,
  // parce qu'on n'en revient pas par la poignée, qui n'y existe plus.
  await grip.focus()
  await page.keyboard.press('Enter')
  assert.equal(await panel.getAttribute('data-fullscreen'), 'true')
  await panel.getByRole('button', { name: 'Quitter le plein écran', exact: true }).click()
  assert.equal(await panel.getAttribute('data-fullscreen'), null)
  await grip.dblclick()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => Math.round(document.querySelector('[data-panel="workspace"]').getBoundingClientRect().width) === innerWidth)
  await (await closePanelButton(page)).click()
  await panel.waitFor({ state: 'hidden' })
  // Joindre, les skills, les serveurs et les réglages ont quitté la rangée : ils sont
  // derrière le « + », dont la surface navigue entre quatre vues.
  const plus = page.getByRole('button', { name: /^Joindre, skills, serveurs, réglages/ })
  await plus.click()
  const plusSheet = page.getByRole('dialog', { name: 'Ajouter et régler', exact: true })
  await plusSheet.waitFor()
  // La cible tactile survit au déménagement : l'entrée du menu fait ses 44 px.
  assert.equal(await plusSheet.getByRole('button', { name: 'Joindre un fichier', exact: true })
    .evaluate((node) => node.getBoundingClientRect().height >= 44), true)
  for (const entry of ['Skills et commandes', 'Serveurs MCP', 'Réglages de la session']) {
    await plusSheet.getByRole('button', { name: new RegExp(`^${entry}`) }).waitFor()
  }
  // Les serveurs MCP ont quitté le panneau : leur liste vit ici, et l'écriture dans
  // une modale montée par la coque — un dialogue rendu dans un menu mourrait avec lui.
  await plusSheet.getByRole('button', { name: /^Serveurs MCP/ }).click()
  await page.getByRole('button', { name: /^Ajouter ou régler un serveur/ }).click()
  const registry = page.getByRole('dialog', { name: 'Gérer les serveurs MCP', exact: true })
  await registry.waitFor()
  await registry.getByRole('button', { name: 'Déclarer le serveur', exact: true }).waitFor()
  await registry.getByRole('button', { name: 'Fermer', exact: true }).click()
  await registry.waitFor({ state: 'hidden' })
  // La surface du « + » est restée dessous, sur sa vue MCP — fermer la modale y
  // ramène, et c'est bien ce qu'on veut. Le contrôle suivant repart de sa racine.
  const mcpView = page.getByRole('dialog', { name: 'Serveurs MCP', exact: true })
  await mcpView.waitFor()
  await page.keyboard.press('Escape')
  await mcpView.waitFor({ state: 'hidden' })
  await plus.click()
  await plusSheet.waitFor()

  // Les réglages s'ouvrent en menu — une ligne par catégorie, sa valeur à droite — et
  // chaque catégorie ouvre ses options dans la même surface.
  await plusSheet.getByRole('button', { name: /^Réglages de la session/ }).click()
  const settingsMenu = page.getByRole('dialog', { name: 'Réglages de la session', exact: true })
  await settingsMenu.getByRole('button', { name: /^Permissions/ }).click()
  const permissions = page.getByRole('dialog', { name: 'Permissions', exact: true })
  await permissions.getByRole('radio', { name: /^Demander/ }).waitFor()
  await page.keyboard.press('Escape')
  await permissions.waitFor({ state: 'hidden' })
  assert.equal(await plus.evaluate((node) => node.getBoundingClientRect().height >= 44), true)
  // L'effort a rejoint le menu du modèle ; la puce du modèle reste dans la rangée.
  assert.equal(await page.getByRole('button', { name: /^Effort de réflexion/ }).count(), 0)
  await page.getByRole('button', { name: /^Modèle :/ }).waitFor()
  console.log('OK : conversation et panneau côte à côte, agrandissement, repli mobile et réglages accessibles.')

  // Au doigt, la rangée garde ses 44 px même au large : `md:` rétrécit le « + » que
  // la requête `pointer-coarse` doit ramener à la cible tactile.
  const touch = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block', hasTouch: true, storageState: await context.storageState() })
  const touchPage = await touch.newPage()
  await touchPage.goto(`${base}/p/${project.id}/c/${hero.id}`)
  const touchPlus = touchPage.getByRole('button', { name: /^Joindre, skills, serveurs, réglages/ })
  await touchPlus.waitFor()
  assert.equal(await touchPlus.evaluate((node) => node.getBoundingClientRect().height >= 44), true)
  await touch.close()

  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}px`)
  }

  // L'activité et sa modale ne sont plus vérifiées ici : la carte #11 les a réécrites
  // (quatre filtres croisés d'un projet, une ligne par session) et `activity-ui-check.mjs`
  // les garde en entier, socket compris. Ce qui restait ici visait l'ancienne « Activité
  // globale », ses onglets *Ensemble* et sa section *Viennent de s'arrêter*, qui n'existent
  // plus. Une seule suite pour une seule interface.

  // La reprise ne traverse ni un compte ni un projet devenu inaccessible.
  const heroPath = `/p/${project.id}/c/${hero.id}`
  await page.goto(base + heroPath)
  await page.locator('textarea').waitFor()
  await page.goto(base + '/projects/new')
  await page.goto(base + '/')
  await page.waitForURL(base + heroPath)
  await openCard(2)
  await page.goto(base + '/projects/new')
  await page.goto(base + '/')
  await page.waitForURL(`${board}?carte=2`)
  const currentUser = await (await context.request.get(base + '/api/auth/me')).json()
  await page.goto(base + '/projects/new')
  await page.evaluate(({ id }) => localStorage.setItem(`solera.lastContext:${id}`, '/p/deleted/c/inaccessible'), currentUser)
  await page.goto(base + '/')
  await page.waitForURL(/\/p\/(?!deleted)[^/]+\/c\//)
  assert.notEqual(new URL(page.url()).pathname, '/p/deleted/c/inaccessible')
  console.log('OK : reprise du fil et de la carte, repli après suppression du contexte.')

  // Les CLI restent désactivés côté serveur. Des sondes fixes rendent le formulaire
  // manipulable sans lancer un agent, et l'envoi est intercepté avant toute création.
  await page.route('**/api/agents', async (route) => {
    const response = await route.fetch()
    const json = await response.json()
    json.agents = json.agents.map((entry) => ({ ...entry, enabled: true, installed: true, reason: null, version: null }))
    await route.fulfill({ json })
  })
  await page.route('**/api/agents/*/models', (route) => route.fulfill({ json: { models: [], modes: [], account: null, fetchedAt: Date.now() } }))
  await page.route('**/api/projects/*/commands?*', (route) => route.fulfill({ json: { commands: [] } }))
  await page.route('**/api/agents/*/usage', (route) => route.fulfill({ json: {
    agent: route.request().url().includes('/codex/') ? 'codex' : 'claude', plan: 'Test', limitsAvailable: true, credits: null, fetchedAt: Date.now(),
    windows: [{ id: 'session', label: 'Session', utilization: 0.95, resetsAt: Date.now() + 3_600_000 }, { id: 'week', label: 'Semaine', utilization: 0.25, resetsAt: null }],
  } }))
  await page.goto(`${base}/p/${project.id}/c/new?agent=claude`)
  const message = page.getByPlaceholder('Écris ton message...')
  await message.waitFor()
  await message.fill('Un brouillon qui doit rester en changeant d’agent.')
  const claude = page.getByRole('radio', { name: 'Claude Code', exact: true })
  const codex = page.getByRole('radio', { name: 'Codex', exact: true })
  await claude.focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await codex.isChecked(), true, 'Agent selection must support arrow keys')
  assert.equal(await message.inputValue(), 'Un brouillon qui doit rester en changeant d’agent.')
  // Plus de volet à déplier : le brouillon montre les jauges en clair, intitulé et
  // taux côte à côte, et la remise à zéro sous la barre.
  const usage = page.locator('section').filter({ hasText: 'Consommation du compte' }).last()
  await usage.getByText('Session', { exact: true }).waitFor()
  assert.equal(await usage.getByText('95 %', { exact: true }).isVisible(), true, 'A nearly exhausted quota must be visible')
  await usage.getByText(/^Remise à zéro/).first().waitFor()

  let submitted
  await page.route(`**/api/projects/${project.id}/conversations`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    submitted = route.request().postDataJSON()
    await route.fulfill({ status: 500, json: { error: { code: 'ui_test_failure', message: 'Simulated creation failure' } } })
  })
  assert.equal(submitted, undefined)
  await page.getByRole('button', { name: 'Envoyer le message', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(submitted.agent, 'codex')
  assert.equal(submitted.worktreeId, null)
  assert.equal(submitted.firstMessage.text, await message.inputValue())
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(() => document.querySelector('main > div > div').scrollTop = 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Draft overflow at ${width}px`)
    const box = await page.getByRole('button', { name: 'Envoyer le message', exact: true }).boundingBox()
    assert.ok(box.y + box.height <= 844, `Send button below viewport at ${width}px`)
  }
  console.log('OK : choix de l’agent au clavier, brouillon conservé, quotas visibles et envoi accessible.')

  await openSettings(page, 'apparence')
  for (const group of ['Toi', 'Les agents', "L'instance"]) {
    await page.getByRole('heading', { name: group, exact: true }).waitFor()
  }
  const size = page.getByRole('slider', { name: 'Taille du texte', exact: true })
  assert.equal(await size.getAttribute('aria-valuetext'), '15 px')
  await size.focus()
  // L'enregistrement sur le compte est différé d'une demi-seconde, le temps que le
  // curseur se pose. Recharger avant son départ ferait réappliquer l'ancienne copie
  // du compte : c'est elle qui fait foi, pas le cache local.
  const settingsSaved = page.waitForResponse((response) =>
    response.url().endsWith('/api/me/settings') && response.request().method() === 'PATCH')
  await page.keyboard.press('ArrowRight')
  assert.equal(await size.getAttribute('aria-valuetext'), '16 px')
  await settingsSaved
  await openSettings(page, 'apparence')
  await size.waitFor()
  assert.equal(await size.getAttribute('aria-valuetext'), '16 px')


  const neutral = page.getByRole('radio', { name: 'Neutre', exact: true })
  await page.getByText('Réglages fins des couleurs', { exact: true }).click()
  const hue = page.getByRole('slider', { name: 'Teinte', exact: true })
  await hue.focus()
  await page.keyboard.press('ArrowRight')
  const customHue = await hue.inputValue()
  await neutral.check()
  assert.equal(await page.evaluate(() => localStorage.getItem('solera.tint')), '0')
  assert.equal(await hue.inputValue(), customHue, 'A background preset preserves the accent hue')
  assert.equal(await size.getAttribute('aria-valuetext'), '16 px', 'A preset preserves reading settings')
  await openSettings(page, 'apparence')
  await neutral.waitFor()
  assert.equal(await neutral.isChecked(), true)
  await page.getByRole('radio', { name: 'Discret', exact: true }).check()
  assert.equal(await page.evaluate(() => localStorage.getItem('solera.tint')), '0.25')
  await page.getByRole('button', { name: 'Sombre contrasté', exact: true }).click()
  assert.equal(await page.getByRole('radio', { name: 'Discret', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Clair', exact: true }).click()
  assert.equal(await page.getByRole('radio', { name: 'Discret', exact: true }).isChecked(), true)
  console.log('OK : ambiances persistantes, teinte et lecture conservées, thème contrasté respecté.')

  // Le réglage Affichage : ce qu'on décroche de la colonne tient d'un chargement à
  // l'autre, et les deux lieux figés n'ont pas d'interrupteur à tenter.
  await openSettings(page, 'affichage')
  const settings = page.getByRole('dialog', { name: 'Réglages', exact: true })
  await settings.getByRole('heading', { name: 'Affichage', exact: true }).waitFor()
  const skillsPlace = settings.getByRole('switch', { name: /^Skills/ })
  assert.equal(await skillsPlace.getAttribute('aria-checked'), 'true')
  await skillsPlace.click()
  assert.equal(await page.evaluate(() => localStorage.getItem('solera.display.skills')), '0')
  assert.equal(await settings.getByRole('switch', { name: /^Fils/ }).count(), 0, 'Fils ne se décroche pas')
  await openSettings(page, 'affichage')
  assert.equal(await settings.getByRole('switch', { name: /^Skills/ }).getAttribute('aria-checked'), 'false')
  await settings.getByRole('button', { name: 'Fermer les réglages', exact: true }).first().click()
  await settings.waitFor({ state: 'hidden' })
  console.log('OK : réglages en modale, trois groupes, réglage Affichage persistant.')

  // La palette élargie : au repos elle propose ce qu'on rouvre et les gestes, à la
  // frappe elle groupe par famille, et un préfixe va droit à l'une d'elles.
  await page.goto(`${base}/p/${project.id}/board`)
  await page.getByRole('button', { name: 'Ouvrir le panneau', exact: true }).waitFor()
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Rechercher', exact: true })
  await palette.getByText('Reprendre', { exact: true }).waitFor()
  await palette.getByText('Gestes', { exact: true }).waitFor()
  await palette.getByRole('button', { name: /^Ouvrir les réglages/ }).waitFor()
  await palette.getByRole('textbox').fill('#')
  await palette.getByText('Cartes', { exact: true }).waitFor()
  assert.equal(await palette.getByText('Gestes', { exact: true }).count(), 0,
    'Un préfixe ne laisse que sa famille')
  await palette.getByRole('textbox').fill('')
  await page.keyboard.press('Escape')
  await palette.waitFor({ state: 'hidden' })
  console.log('OK : palette au repos, groupée par famille, et ses préfixes.')

  const createdUser = await context.request.post(base + '/api/users', { data: { username: 'ui-reader', displayName: 'UI Reader', password: 'ui-test-password', isAdmin: false } })
  assert.ok(createdUser.ok())
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block', storageState: await context.storageState() })
  const otherLogin = await other.request.post(base + '/api/auth/login', { data: { username: 'ui-reader', password: 'ui-test-password' } })
  assert.ok(otherLogin.ok())
  // Un compte ouvert par un administrateur a sa visite due : passée ici, c'est la
  // séparation des comptes qu'on vérifie, pas la visite (sa suite : test:onboarding-ui).
  const settled = await other.request.patch(base + '/api/me/settings', { data: { onboarding: { pending: false } } })
  assert.ok(settled.ok())
  assert.equal((await other.request.get(`${base}/api/projects/${project.id}/file/download?path=package.json`)).status(), 404)
  assert.equal((await other.request.get(`${base}/api/conversations/${hero.id}/file/download?path=package.json`)).status(), 404)
  const otherPage = await other.newPage()
  otherPage.on('pageerror', (error) => errors.push(error.message))
  await openSettings(otherPage, 'compte')
  await otherPage.getByRole('heading', { name: 'Toi', exact: true }).waitFor()
  assert.equal(await otherPage.getByRole('button', { name: 'Comptes', exact: true }).count(), 0,
    'Une section réservée aux administrateurs ne figure pas dans la liste')
  await otherPage.getByRole('button', { name: 'Fermer les réglages', exact: true }).first().click()
  await otherPage.evaluate(({ id, path }) => {
    localStorage.setItem(`solera.lastContext:${id}`, path)
  }, { id: currentUser.id, path: `/p/${project.id}/board?carte=2` })
  await otherPage.goto(base + '/')
  const visibleProjects = await (await other.request.get(base + '/api/projects')).json()
  const visibleConversations = await (await other.request.get(base + '/api/conversations')).json()
  const mostRecent = visibleConversations.filter((entry) => !entry.archivedAt).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (mostRecent) await otherPage.waitForURL(`**/p/${mostRecent.projectId}/c/${mostRecent.id}`)
  else if (visibleProjects.length) await otherPage.waitForURL(`**/p/${visibleProjects[0].id}/c/new`)
  else await otherPage.getByRole('main').getByText('Aucun projet', { exact: true }).waitFor()
  assert.notEqual(new URL(otherPage.url()).pathname + new URL(otherPage.url()).search, `/p/${project.id}/board?carte=2`, 'One account must not resume the context of another')
  await other.close()
  console.log('OK : réglages regroupés, unités lisibles persistantes et séparation des comptes.')

  assert.deepEqual(errors, [])
  console.log('OK : aucune exception navigateur ni débordement du document de 320 à 1440 px.')
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
