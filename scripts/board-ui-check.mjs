import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

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
  const shots = join(root, 'docs/audits/2026-09-19-board')
  await mkdir(shots, { recursive: true })
  await page.goto(board)
  /* Deux boutons créent une carte : celui de la bande, qui ouvre le dialogue complet, et
     celui de chaque colonne, qui ouvre la saisie en ligne. Ils ne portent pas le même
     libellé — la bande dit « Carte », la colonne « Nouvelle carte » — donc le nom exact
     suffit à les distinguer, et on ne peut pas viser la bande par un titre « Board » :
     depuis la rangée d'onglets, elle porte le nom du projet. */
  const newCard = page.getByRole('button', { name: 'Carte', exact: true })
  await newCard.click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle carte', exact: true })
  await dialog.getByRole('textbox', { name: 'Titre', exact: true }).fill('Améliorer l’accueil du projet')
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('## Objectif\nRetrouver les informations utiles dès l’ouverture du projet.\n\n- Afficher les cartes à vérifier\n- Reprendre la dernière session\n- Donner accès aux documents de référence\n\nVoir aussi #2 pour le fonctionnement hors ligne.')
  await dialog.getByRole('radio', { name: 'Aperçu', exact: true }).click()
  await dialog.getByRole('heading', { name: 'Objectif', exact: true }).waitFor()
  await dialog.getByRole('radio', { name: 'Écrire', exact: true }).click()
  // Annuler ferme et conserve le brouillon ; ne doit jamais soumettre le formulaire.
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click()
  assert.equal((await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json()).length, cards.length)
  await newCard.click()
  assert.equal(await dialog.getByRole('textbox', { name: 'Titre', exact: true }).inputValue(), 'Améliorer l’accueil du projet')
  await dialog.getByRole('button', { name: 'Créer la carte', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const panel = page.getByRole('complementary', { name: /^Carte #/ })
  await panel.getByRole('heading', { name: 'Améliorer l’accueil du projet', exact: true }).waitFor()
  await editCard(page, panel)
  const editor = panel.getByRole('textbox', { name: 'Description', exact: true })
  await editor.fill((await editor.inputValue()) + '\n\nTexte validé.')
  assert.equal(await panel.getByRole('button', { name: 'Session', exact: true }).isDisabled(), true)
  await editor.press('Control+Enter')
  await panel.getByRole('textbox', { name: 'Description', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await panel.getByRole('button', { name: 'Session', exact: true }).isEnabled(), true)
  const number = Number(new URL(page.url()).searchParams.get('carte'))
  const created = (await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json()).find((entry) => entry.number === number)
  assert.ok(created)
  const files = panel.getByRole('region', { name: 'Pièces jointes', exact: true })
  await files.locator('input[type=file]').setInputFiles([
    { name: 'brief.md', mimeType: 'text/markdown', buffer: Buffer.from('# Brief\nInformations accessibles aux agents.') },
    { name: 'reference.png', mimeType: 'image/png', buffer: await page.screenshot() },
  ])
  await files.getByRole('link', { name: /brief.md/ }).waitFor()
  await files.getByRole('link', { name: /reference.png/ }).waitFor()
  const attached = (await (await context.request.get(`${base}/api/cards/${created.id}/attachments`)).json())
  assert.equal(attached.length, 2)
  const download = await context.request.get(`${base}/api/attachments/${attached[0].id}`)
  assert.ok(download.ok())
  assert.equal(await download.text(), '# Brief\nInformations accessibles aux agents.')
  const beforeErrors = await files.getByRole('alert').count()
  await page.route(`**/api/cards/${created.id}/attachments`, (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 500, json: { error: { code: 'test', message: 'Erreur simulée' } } }) : route.continue())
  await files.locator('input[type=file]').setInputFiles({ name: 'retry.txt', mimeType: 'text/plain', buffer: Buffer.from('Retry') })
  await files.getByRole('alert').filter({ hasText: 'Erreur simulée' }).waitFor()
  assert.equal(await files.getByRole('alert').count(), beforeErrors + 1)
  await page.unroute(`**/api/cards/${created.id}/attachments`)
  await files.locator('div.border-dashed').evaluate((node) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['Retry'], 'retry.txt', { type: 'text/plain' }))
    node.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
  })
  await files.getByRole('link', { name: /retry.txt/ }).waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await files.getByRole('button', { name: 'Retirer retry.txt', exact: true }).click()
  await files.getByRole('link', { name: /retry.txt/ }).waitFor({ state: 'hidden' })
  await panel.getByRole('textbox', { name: 'Ajouter une note', exact: true }).fill('Les documents de référence sont joints à la carte.')
  await panel.getByRole('button', { name: 'Ajouter une note', exact: true }).click()
  await panel.getByText('Les documents de référence sont joints à la carte.', { exact: true }).waitFor()

  // Les champs de la carte #36 : l'échéance, le jalon, les sous-tâches du markdown et
  // les liens « bloque ». Dans les propriétés de la fiche, qui disent ce qui est prévu,
  // et non dans son fil, qui raconte ce qui s'est passé.
  await panel.getByLabel('Échéance', { exact: true }).fill('2026-12-01')
  await page.waitForResponse((response) => response.url().endsWith(`/api/cards/${created.id}`))
  await panel.getByRole('button', { name: 'Choisir un jalon', exact: true }).click()
  const milestones = page.getByRole('dialog', { name: 'Choisir un jalon', exact: true })
  await milestones.getByPlaceholder('Chercher une carte').fill('2')
  await milestones.getByRole('button', { name: /^#2 / }).click()
  await panel.getByRole('button', { name: 'Détacher de ce jalon', exact: true }).waitFor()

  // Cocher réécrit la description : la case n'a pas de table, c'est une ligne du texte.
  await editCard(page, panel)
  const tasks = panel.getByRole('textbox', { name: 'Description', exact: true })
  await tasks.fill((await tasks.inputValue()) + '\n\n- [ ] Lister les écrans\n- [ ] Poser les échéances')
  await tasks.press('Control+Enter')
  await panel.getByRole('textbox', { name: 'Description', exact: true }).waitFor({ state: 'hidden' })
  await panel.getByText('0/2', { exact: true }).waitFor()
  await panel.locator('input[data-sg-task="0"]').click()
  await panel.getByText('1/2', { exact: true }).waitFor()
  const ticked = (await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json())
    .find((entry) => entry.id === created.id)
  assert.match(ticked.description, /- \[x\] Lister les écrans/)
  assert.equal(ticked.dueAt !== null, true)
  assert.equal(ticked.milestone.number, 2)

  // Un lien posé à la main, à côté des citations `#12` et sous son propre nom.
  await panel.getByRole('button', { name: 'Déclarer une carte bloquée', exact: true }).click()
  const blocked = page.getByRole('dialog', { name: 'Déclarer une carte bloquée', exact: true })
  await blocked.getByPlaceholder('Chercher une carte').fill('1')
  await blocked.getByRole('button', { name: /^#1 / }).click()
  await panel.getByRole('button', { name: 'Ne plus bloquer #1', exact: true }).waitFor()
  const blocking = (await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json())
    .find((entry) => entry.number === 1)
  assert.deepEqual(blocking.blockedBy.map((link) => link.number), [number])
  // Capture depuis le haut du panneau : l'échéance et le jalon s'y lisent avant la
  // description, et c'est ce placement-là qu'on vérifie.
  await panel.locator('div.overflow-y-auto').first().evaluate((node) => { node.scrollTop = 0 })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'ticket-champs-desktop.png') })

  await panel.getByRole('button', { name: 'Fermer', exact: true }).click()
  const search = page.getByRole('searchbox', { name: 'Rechercher une carte, un numéro…', exact: true })
  await search.fill(`#${number}`)
  await page.locator(`[data-card-open="${created.id}"]`).waitFor()
  assert.equal(await page.locator('[data-card-open]').count(), 1)
  assert.equal(await page.getByRole('button', { name: /^Déplacer la carte/ }).count(), 0, 'Filtering cannot reorder partial columns')
  await search.fill('aucun-resultat-123')
  await page.getByText('Aucune carte ne correspond à ta recherche.').waitFor()
  await search.fill('')
  // Déplacement clavier : le tri reste utilisable sans souris.
  const handle = page.getByRole('button', { name: `Déplacer la carte #${number}`, exact: true })
  await handle.focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(150)
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(150)
  const reordered = page.waitForResponse((response) => response.url().endsWith('/cards/order'))
  await page.keyboard.press('Space')
  assert.ok((await reordered).ok())
  await page.waitForTimeout(300)
  assert.equal(await page.locator('[data-card-open]').count(), cards.length + 1)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'board-desktop.png') })
  await page.locator(`[data-card-open="${created.id}"]`).click()
  await editCard(page, panel)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'ticket-editor-desktop.png') })
  await panel.getByRole('button', { name: 'Annuler', exact: true }).click()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const mobileTicket = page.getByRole('dialog', { name: `Carte #${number}`, exact: true })
    await mobileTicket.waitFor()
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await mobileTicket.evaluate((node) => node.scrollWidth <= node.clientWidth), true)
    if (width === 390) await page.screenshot({ animations: 'disabled', path: join(shots, 'ticket-mobile.png') })
  }
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'board-mobile.png') })
  await search.fill('#2')
  await page.locator(`[data-card-open="${card.id}"]`).waitFor()
  assert.equal(await page.getByRole('region', { name: 'En cours', exact: true }).isVisible(), true, 'Mobile search switches to the matching column')
  await search.fill('')
  await newCard.click()
  await dialog.getByRole('textbox', { name: 'Titre', exact: true }).fill('Vérification mobile')
  const createBox = await dialog.getByRole('button', { name: 'Créer la carte', exact: true }).boundingBox()
  assert.ok(createBox.y + createBox.height <= 844, 'The mobile creation action remains visible')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'create-mobile.png') })
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'board-dark.png') })
  assert.deepEqual(errors, [])
  console.log('OK : création et brouillon, aperçu Markdown, pièces multiples, téléchargement, erreur/réessai, retrait, notes, échéance, jalon, sous-tâches, lien « bloque », recherche, clavier et mobile ; captures dans ' + shots)
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

/** « Modifier la carte » vit dans le menu « ⋯ » de la fiche, depuis la fiche commune. */
async function editCard(page, panel) {
  await panel.getByRole('button', { name: 'Plus d’actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Modifier la carte', exact: true }).click()
}
