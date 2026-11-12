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

  browser = await launchBrowser()
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

  // Les champs de la carte #36 : l'échéance, la parente, les sous-tâches du markdown et
  // les liens « bloque ». Dans les propriétés de la fiche, qui disent ce qui est prévu,
  // et non dans son fil, qui raconte ce qui s'est passé.
  await panel.getByLabel('Échéance', { exact: true }).fill('2026-12-01')
  await page.waitForResponse((response) => response.url().endsWith(`/api/cards/${created.id}`))
  await panel.getByRole('button', { name: 'Choisir une parente', exact: true }).click()
  const parents = page.getByRole('dialog', { name: 'Choisir une parente', exact: true })
  await parents.getByPlaceholder('Chercher une carte').fill('11')
  await parents.getByRole('button', { name: /^#11 / }).click()
  await panel.getByRole('button', { name: 'Détacher de cette parente', exact: true }).waitFor()

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
  assert.equal(ticked.parent.number, 11)

  // Promouvoir une sous-tâche en carte (#71) : une sœur sous la même parente, qui bloque
  // celle-ci, et la ligne devient `#N`, sa case désactivée puisqu'elle suit #N.
  await panel.locator('li.sg-task-item').nth(1).hover()
  await panel.locator('button[data-sg-promote="1"]').click()
  await panel.getByLabel('Titre de la nouvelle carte', { exact: true }).waitFor()
  await panel.getByText('Elle sera rangée sous #11, comme cette carte.', { exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'promouvoir-sous-tache.png') })
  await panel.getByRole('button', { name: 'Créer la carte', exact: true }).click()
  await panel.getByLabel('Titre de la nouvelle carte', { exact: true }).waitFor({ state: 'hidden' })
  const all = await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json()
  const sister = all.find((entry) => entry.title === 'Poser les échéances')
  assert.equal(sister.parent.number, 11)
  assert.deepEqual(sister.blocks.map((link) => link.number), [number])
  assert.match(all.find((entry) => entry.id === created.id).description, new RegExp(`- \\[ \\] #${sister.number} Poser les échéances`))
  await panel.locator('input[type="checkbox"][disabled]').first().waitFor()
  assert.equal(await panel.locator('input[data-sg-task="1"]').count(), 0)

  // Un lien posé à la main, à côté des citations `#12` et sous son propre nom.
  await panel.getByRole('button', { name: 'Déclarer une carte bloquée', exact: true }).click()
  const blocked = page.getByRole('dialog', { name: 'Déclarer une carte bloquée', exact: true })
  await blocked.getByPlaceholder('Chercher une carte').fill('1')
  await blocked.getByRole('button', { name: /^#1 / }).click()
  await panel.getByRole('button', { name: 'Ne plus bloquer #1', exact: true }).waitFor()
  const blocking = (await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json())
    .find((entry) => entry.number === 1)
  assert.deepEqual(blocking.blockedBy.map((link) => link.number), [number])

  // Les liens informatifs (#109) : « liée à » en liste, « doublon de » en propriété,
  // et l'abandon d'un doublon proposé en tête de fiche, sans être appliqué.
  await panel.getByRole('button', { name: 'Lier une carte', exact: true }).click()
  const relating = page.getByRole('dialog', { name: 'Lier une carte', exact: true })
  await relating.getByPlaceholder('Chercher une carte').fill('2')
  await relating.getByRole('button', { name: /^#2 / }).click()
  await panel.getByRole('button', { name: 'Délier #2', exact: true }).waitFor()
  await panel.getByRole('button', { name: 'Choisir l’originale', exact: true }).click()
  const originals = page.getByRole('dialog', { name: 'Choisir l’originale', exact: true })
  await originals.getByPlaceholder('Chercher une carte').fill('1')
  await originals.getByRole('button', { name: /^#1 / }).click()
  await panel.getByRole('button', { name: 'Abandonner cette carte', exact: true }).waitFor()
  const linked = await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json()
  assert.deepEqual(linked.find((entry) => entry.number === 2).related.map((link) => link.number), [number])
  assert.deepEqual(linked.find((entry) => entry.number === 1).duplicates.map((link) => link.number), [number])
  assert.equal(linked.find((entry) => entry.id === created.id).column, 'todo', 'le lien ne clôt rien')
  await panel.locator('div.overflow-y-auto').first().evaluate((node) => { node.scrollTop = 0 })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'ticket-doublon.png') })
  await panel.getByRole('button', { name: 'Ce n’est pas un doublon', exact: true }).click()
  await panel.getByRole('button', { name: 'Abandonner cette carte', exact: true }).waitFor({ state: 'hidden' })
  // Capture depuis le haut du panneau : l'échéance et la parente s'y lisent avant la
  // description, et c'est ce placement-là qu'on vérifie.
  await panel.locator('div.overflow-y-auto').first().evaluate((node) => { node.scrollTop = 0 })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'ticket-champs-desktop.png') })

  // Le `#2` de la description est un lien vers la carte, avec un aperçu au survol (#86).
  const ref = panel.locator('button.sg-card-ref[data-sg-card="2"]')
  await ref.hover()
  const preview = page.getByRole('tooltip').filter({ hasText: card.title })
  await preview.waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'card-ref-preview.png') })
  await page.mouse.move(5, 5)
  await preview.waitFor({ state: 'detached' })

  // Un clic dans le vide du tableau referme l'éditeur, comme « Fermer » : ici l'espace
  // entre les deux premières colonnes, l'éditeur couvrant la droite.
  const todoBox = await page.getByRole('region', { name: 'À faire', exact: true }).boundingBox()
  await page.mouse.click(todoBox.x + todoBox.width + 6, todoBox.y + 100)
  await panel.waitFor({ state: 'hidden' })
  assert.ok(!page.url().includes('carte='))
  const review = page.getByRole('region', { name: 'À vérifier', exact: true })

  // Glisser une tuile dans une autre colonne la range pour de bon (B-4.6) : elle se
  // saisit par tout son corps au pointeur, et le geste n'ouvre pas sa fiche.
  const tile = page.locator(`[data-card-tile="${number}"]`)
  await tile.scrollIntoViewIfNeeded()
  const from = await tile.boundingBox()
  // Mesurée après le défilement qui amène la tuile en vue.
  const reviewBox = await review.boundingBox()
  await page.mouse.move(from.x + from.width / 3, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 3 + 10, from.y + from.height / 2 + 10, { steps: 3 })
  // La zone défile d'un bloc : la colonne peut descendre sous la fenêtre, on vise sa part visible.
  const visibleBottom = Math.min(reviewBox.y + reviewBox.height, page.viewportSize().height)
  await page.mouse.move(reviewBox.x + reviewBox.width / 2, visibleBottom - 60, { steps: 15 })
  await delay(150)
  const dropped = page.waitForResponse((response) => response.url().endsWith(`/api/cards/${created.id}`) && response.request().method() === 'PATCH')
  await page.mouse.up()
  assert.ok((await dropped).ok())
  await review.locator(`[data-card-tile="${number}"]`).waitFor()
  assert.ok(!page.url().includes('carte=') && !page.url().includes('fiche='), 'glisser n’ouvre pas la carte')
  const moved = (await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json())
    .find((entry) => entry.id === created.id)
  assert.equal(moved.column, 'review')
  // Rechargé, le tableau la montre où le serveur l'a rangée.
  await page.reload()
  await review.locator(`[data-card-tile="${number}"]`).waitFor()

  // Le tri dans les colonnes (B-4.2), dans « Affichage ▾ », retenu pour ce projet.
  const todo = page.getByRole('region', { name: 'À faire', exact: true })
  const firstInTodo = () => todo.locator('[data-card-tile]').first().getAttribute('data-card-tile')
  const display = page.getByRole('dialog', { name: 'Affichage', exact: true })
  const sortBy = async (name) => {
    await page.getByRole('button', { name: 'Affichage', exact: true }).click()
    await display.getByRole('radiogroup', { name: 'Tri dans les colonnes', exact: true }).getByRole('radio', { name, exact: true }).click()
    await page.keyboard.press('Escape')
    await display.waitFor({ state: 'detached' })
  }
  const todoNumbers = (await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json())
    .filter((entry) => entry.column === 'todo' && entry.children.length === 0 && !(entry.parent === null && entry.milestone))
    .map((entry) => entry.number)
  await sortBy('Numéro')
  await page.waitForFunction((n) => document.querySelector('section[aria-label="À faire"] [data-card-tile]')?.getAttribute('data-card-tile') === String(n), Math.max(...todoNumbers))
  await page.reload()
  assert.equal(await firstInTodo(), String(Math.max(...todoNumbers)), 'le tri est retenu pour ce projet')
  await sortBy('Ce qui t’attend')

  const search = page.getByRole('searchbox', { name: 'Rechercher une carte, un numéro…', exact: true })
  await search.fill(`#${number}`)
  await page.locator(`[data-card-tile="${number}"]`).waitFor()
  assert.equal(await page.locator('[data-card-tile]').count(), 1)
  await search.fill('aucun-resultat-123')
  await page.getByText('Aucune carte ne correspond à ta recherche.').waitFor()
  await search.fill('')

  // Les tuiles (B-3) et « Ce qui t'attend » (B-4.2) : une issue entrée de l'extérieur
  // passe avant ce qui n'attend rien, avec son drapeau, et la carte à préciser le sien.
  const incoming = todo.locator('[data-card-tile="13"]')
  await incoming.getByText('à accepter', { exact: true }).waitFor()
  await todo.locator('[data-card-tile="6"]').getByText('à préciser', { exact: true }).waitFor()
  const order = await todo.locator('[data-card-tile]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-card-tile')))
  const quiet = (await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json())
    .filter((entry) => entry.column === 'todo' && entry.acceptedAt !== null && !entry.conversations.some((session) => !session.archivedAt && session.status === 'awaiting_input'))
    .map((entry) => String(entry.number))
  assert.ok(order.filter((n) => quiet.includes(n)).every((n) => order.indexOf(n) > order.indexOf('13')), `non acceptée avant ce qui n’attend rien : ${order}`)
  await incoming.scrollIntoViewIfNeeded()
  await todo.screenshot({ animations: 'disabled', path: join(shots, 'board-todo-states.png') })

  // Un clic sur une tuile ouvre sa fiche sur place (B-7), sans quitter le tableau.
  await incoming.click()
  const sheet = page.getByRole('dialog', { name: 'Carte #13', exact: true })
  await sheet.waitFor()
  assert.equal(new URL(page.url()).searchParams.get('fiche'), '13')
  assert.match(new URL(page.url()).pathname, /\/board$/)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'board-fiche.png') })
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })
  assert.ok(!page.url().includes('fiche='))

  // L'éditeur complet reste celui des liens (`?carte=`) : on y trie la carte entrante.
  await page.goto(`${board}?carte=13`)
  await panel.getByRole('button', { name: 'Accepter', exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: 'Session', exact: true }).isDisabled(), true, 'Une carte non acceptée ne lance pas de session')
  await panel.locator('div.overflow-y-auto').first().evaluate((node) => { node.scrollTop = 0 })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'ticket-incoming.png') })
  const accepted = page.waitForResponse((response) => response.url().endsWith('/accept'))
  await panel.getByRole('button', { name: 'Accepter', exact: true }).click()
  assert.ok((await accepted).ok())
  await panel.getByRole('button', { name: 'Accepter', exact: true }).waitFor({ state: 'detached' })
  assert.equal(await panel.getByRole('button', { name: 'Session', exact: true }).isEnabled(), true)
  await incoming.getByText('à accepter', { exact: true }).waitFor({ state: 'detached' })

  // Une parente : ses enfants dans la fiche, sa colonne déduite, et le filtre du board.
  await page.goto(`${board}?carte=11`)
  await panel.getByRole('heading', { name: /^v1\.2/ }).waitFor()
  const children = panel.getByRole('heading', { name: 'Enfants', exact: true }).locator('xpath=../..')
  for (const child of [2, 4, 10, number]) await children.getByRole('button', { name: new RegExp(`^#${child} `) }).waitFor()
  await panel.getByRole('button', { name: /^Changer la colonne/ }).click()
  await page.getByText('Colonne déduite des enfants', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await panel.locator('div.overflow-y-auto').first().evaluate((node) => { node.scrollTop = 0 })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'ticket-parent.png') })

  // Lancer le jalon (#72) : la section de la parente, puis l'aperçu, sans lancer.
  const milestone = panel.getByRole('region', { name: 'Jalon', exact: true })
  await milestone.getByRole('button', { name: 'Lancer le jalon', exact: true }).click()
  const launchPreview = page.getByRole('dialog', { name: 'Lancer le jalon #11', exact: true })
  await launchPreview.getByText(/^Partent tout de suite/).waitFor()
  await launchPreview.getByText(/jalon\/11-/).first().waitFor()
  await launchPreview.screenshot({ animations: 'disabled', path: join(shots, 'jalon-apercu.png') })
  await launchPreview.getByRole('button', { name: 'Annuler', exact: true }).click()
  await preview.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  // Le filtre par jalon, dans « Filtrer ▾ » : une coche, puis une puce sur la ligne (B-1.2, B-1.3).
  const filters = page.getByRole('dialog', { name: 'Filtrer', exact: true })
  await page.getByRole('button', { name: /^Filtrer/ }).click()
  await filters.getByRole('checkbox', { name: /#11/ }).click()
  await page.keyboard.press('Escape')
  await filters.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Retirer ce filtre', exact: true }).waitFor()
  assert.equal((await page.getByRole('button', { name: /^Filtrer/ }).textContent()).replace(/\s/g, ''), 'Filtrer1')
  const underEleven = [2, 4, 10, number, sister.number]
  await page.waitForFunction((n) => document.querySelectorAll('[data-card-tile]').length === n, underEleven.length)
  for (const child of underEleven) await page.locator(`[data-card-tile="${child}"]`).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'board-milestone-filter.png') })
  await page.getByRole('button', { name: 'Retirer ce filtre', exact: true }).click()
  await page.waitForFunction((n) => document.querySelectorAll('[data-card-tile]').length > n, underEleven.length)

  // Les couloirs par jalon (B-4.7) : une section par jalon qui a des feuilles ouvertes,
  // puis « Sans jalon » ; les tuiles n'y portent pas l'étiquette de leur jalon.
  await page.getByRole('button', { name: 'Affichage', exact: true }).click()
  await display.getByRole('radio', { name: 'Couloirs par jalon', exact: true }).click()
  await page.keyboard.press('Escape')
  const lane = page.getByRole('region', { name: 'v1.2 — offline et radar', exact: true })
  await lane.waitFor()
  await page.getByRole('region', { name: 'Sans jalon', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: 'v1.1 — la mise en route', exact: true }).count(), 0, 'un jalon fini n’a pas de couloir')
  await lane.locator(`[data-card-tile="${number}"]`).waitFor()
  assert.equal(await lane.locator('[title^="Jalon #"]').count(), 0)
  assert.equal(await lane.getByRole('link', { name: 'Ouvrir le jalon', exact: true }).getAttribute('href'), `/p/${project.id}/timeline/11`)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'board-lanes.png') })
  await page.getByRole('button', { name: 'Affichage', exact: true }).click()
  await display.getByRole('radio', { name: 'Aucun', exact: true }).click()
  await page.keyboard.press('Escape')

  // Terminé se replie en bande étroite, toujours cible de dépôt, et se déplie (B-4.3).
  await page.getByRole('button', { name: /^Terminé/ }).click()
  const doneBox = await page.getByRole('region', { name: 'Terminé', exact: true }).boundingBox()
  assert.ok(doneBox.width <= 40, `Terminé repliée : ${doneBox.width}`)
  await page.getByRole('button', { name: /^Terminé/ }).click()
  await page.getByRole('region', { name: 'Terminé', exact: true }).locator('[data-card-tile]').first().waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'board-desktop.png') })

  await page.goto(`${board}?carte=${number}`)
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
  // Au téléphone, le Kanban défile de côté dans sa zone, la page jamais (B-8).
  const kanban = page.locator('[data-kanban]')
  assert.ok(await kanban.evaluate((node) => node.scrollWidth > node.clientWidth), 'Le Kanban défile horizontalement')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await search.fill('#2')
  await page.locator(`[data-card-tile="${card.number}"]`).waitFor()
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
  console.log('OK : création et brouillon, aperçu Markdown, pièces multiples, téléchargement, erreur/réessai, retrait, notes, échéance, parente, sous-tâches, promotion d’une sous-tâche, lien « bloque », référence #n et aperçu, éditeur refermé à côté, glisser persisté, tri retenu, recherche, drapeaux et « Ce qui t’attend », fiche sur place, filtre par jalon, couloirs, Terminé repliée, mobile ; captures dans ' + shots)
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
