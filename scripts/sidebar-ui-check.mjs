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

/**
 * Le centre horizontal de chaque élément, mesuré depuis le bord gauche de la colonne.
 * Arrondi au demi-pixel : un `size-3.5` centré dans un créneau de 16 px tombe sur un
 * demi-pixel, et la comparaison porte sur la colonne, pas sur l'anticrénelage.
 */
function centersFromLeft(locator) {
  return locator.evaluateAll((nodes) => nodes.map((node) => {
    const column = node.closest('aside').getBoundingClientRect()
    const box = node.getBoundingClientRect()
    return Math.round((box.left + box.width / 2 - column.left) * 2) / 2
  }))
}

/** Le bord droit de chaque élément, mesuré depuis le bord droit de la colonne. */
function rightsFromRight(locator) {
  return locator.evaluateAll((nodes) => nodes.map((node) => {
    const column = node.closest('aside').getBoundingClientRect()
    return Math.round((column.right - node.getBoundingClientRect().right) * 2) / 2
  }))
}

/** Le centre horizontal de chaque élément, mesuré depuis le bord droit de la colonne. */
function centersFromRight(locator) {
  return locator.evaluateAll((nodes) => nodes.map((node) => {
    const column = node.closest('aside').getBoundingClientRect()
    const box = node.getBoundingClientRect()
    return Math.round((column.right - box.left - box.width / 2) * 2) / 2
  }))
}

/** Toutes les valeurs d'une mesure, ramenées à leurs valeurs distinctes. */
const distinct = (values) => [...new Set(values)]

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

  // Les barres de défilement visibles : la gouttière réservée (SID-2) a alors une largeur.
  browser = await launchBrowser({ scrollbars: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript((origin) => {
    // La visionneuse PDF du navigateur n'expose pas le stockage de l'application.
    if (window === window.top && location.origin === origin) {
      localStorage.setItem('solera.locale', 'fr')
      // Un nombre fixe : la colonne déborde à coup sûr, et ce qu'on y cherche ne dépend
      // pas de la hauteur. « Ajuster à la hauteur » a son propre contexte, plus bas.
      localStorage.setItem('solera.display.sessionLimit', '20')
    }
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const project = projects.find((entry) => entry.name === 'Nimbus')
  const conversations = await (await context.request.get(`${base}/api/projects/${project.id}/conversations`)).json()
  const hero = conversations.find((entry) => entry.title === 'Add offline caching for forecasts')
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-09-19-sidebar')
  await mkdir(shots, { recursive: true })
  // Une longue liste pour vérifier le défilement, le budget et la ligne de fin, sans
  // toucher à la base réelle.
  const longList = async (route) => {
    const response = await route.fetch()
    const entries = await response.json()
    // `idle` et lues : une session active ne figure pas dans le groupe de son projet,
    // elle est déjà dans l'activité au-dessus.
    // Un fil libre : il n'appartient à aucun projet, et c'est le groupe *Sans projet*
    // qui doit lui donner un domicile dans la colonne.
    const free = { ...hero, id: 'fixture-libre', projectId: null, title: 'Fil sans projet', status: 'idle', lastReadSeq: hero.lastNotableSeq, archivedAt: null }
    await route.fulfill({ json: [...entries, free, ...Array.from({ length: 30 }, (_, i) => ({ ...hero, id: `fixture-${i}`, title: `Session de travail ${i + 1}`, status: 'idle', lastReadSeq: hero.lastNotableSeq, archivedAt: null }))] })
  }
  await page.route('**/api/conversations', longList)
  const allConversations = async () => (await (await context.request.get(`${base}/api/conversations`)).json())
  // Le total que la ligne de fin du projet annonce : archivées comprises, tirs exclus, et
  // les trente de la liste longue.
  const projectTotal = (await allConversations()).filter((entry) => entry.projectId === project.id && !entry.scheduleId).length + 30

  await page.goto(`${base}/p/${project.id}/c/${hero.id}`)
  const places = page.getByRole('navigation', { name: 'Lieux' })
  const column = page.locator('aside')
  await places.waitFor()

  // Les lieux : une liste verticale, toujours visible, et le compte en une ligne.
  for (const name of ['Fils', 'Projets', 'Planifiées']) {
    await places.getByRole('button', { name: new RegExp(`^${name}`) }).waitFor()
  }
  /*
    Le raccourci de création sur la ligne *Projets*, à côté du « ↗ ». Il est **effacé et
    non retiré** : au clavier on doit l'atteindre, donc il reste dans l'ordre de
    tabulation même quand on ne le voit pas. C'est ce que cette vérification tient, et
    qu'une relecture du CSS ne dirait pas — `hidden` aurait eu l'air identique à l'œil.
  */
  const newProject = places.getByRole('link', { name: 'Créer un projet', exact: true })
  await newProject.waitFor()
  assert.equal(await newProject.evaluate((node) => getComputedStyle(node).opacity), '0')
  await places.getByRole('button', { name: /^Projets/ }).focus()
  await page.keyboard.press('Tab')
  assert.ok(
    await newProject.evaluate((node) => node === document.activeElement),
    'Une tabulation depuis la ligne Projets atteint son raccourci de création',
  )
  /* Et il **redevient visible** une fois atteint : c'est l'invariant que l'effacement
     doit à l'accès au clavier, et la moitié qui manquait. Attendre plutôt que mesurer
     tout de suite — l'opacité est en transition, et une lecture immédiate rend une
     valeur interpolée sur un état pourtant correct. */
  await page.waitForFunction(
    () => getComputedStyle(document.activeElement).opacity === '1',
    null,
    { timeout: 2000 },
  )
  await page.keyboard.press('Enter')
  await page.waitForURL('**/projects/new')
  await page.goBack()
  await places.waitFor()
  /*
    Le bord droit d'une ligne ouvre toujours son lieu. Le compteur et le « ↗ » sont
    sortis du bouton pour tenir la colonne de droite ; sans le `::after` qui couvre la
    ligne, ils laisseraient là une bande morte — jusqu'à cinquante pixels, et sur les
    quatre lieux, y compris ceux qui n'ont aucun raccourci.
  */
  for (const [name, url] of [['Planifiées', '**/schedules'], ['Projets', '**/projects']]) {
    await page.goto(`${base}/p/${project.id}/c/${hero.id}`)
    const line = places.getByRole('button', { name: new RegExp(`^${name}`) })
    const box = await line.evaluate((node) => {
      const { right, top, height } = node.closest('li').getBoundingClientRect()
      return { x: right - 3, y: top + height / 2 }
    })
    await page.mouse.click(box.x, box.y)
    await page.waitForURL(url, { timeout: 5000 })
  }

  await page.goto(`${base}/p/${project.id}/c/${hero.id}`)
  await places.waitFor()
  // Les deux icônes ensemble, au survol : la capture ne cadre que les lieux, le reste
  // de la colonne a déjà les siennes.
  await places.getByRole('button', { name: /^Projets/ }).hover()
  await newProject.evaluate((node) => node.blur())
  await page.waitForTimeout(200)
  await places.screenshot({ animations: 'disabled', path: join(shots, 'lieux-raccourci-projet.png') })

  const activity = column.getByRole('group', { name: 'Suivi des conversations' })
  await activity.waitFor()
  // Attendre qu'elle soit remplie avant de la mesurer : ses lignes viennent du socket,
  // qui arrive après le premier rendu, et une mesure prise sur « Aucune session en
  // cours » ne vaut rien.
  await activity.getByRole('link').first().waitFor()
  await places.getByRole('button', { name: /^Projets/ }).click()
  await column.getByRole('link', { name: 'Nouveau projet…' }).waitFor()

  /*
    SID-3 : une seule colonne d'icônes. Chaque ligne pose son icône dans un créneau de
    16 px centré à 26 px du bord (conteneur 8 + ligne 10 + 8) ; le texte part à 44 px.
    Les lieux, l'en-tête et les lignes de l'Activité, les groupes de l'arbre et la
    ligne « Nouveau projet… » tombent sur la même verticale. Les sessions d'un groupe,
    en retrait sous leur filet, forment la leur.
  */
  const iconColumn = [
    ...await centersFromLeft(places.locator('li button > :first-child')),
    ...await centersFromLeft(activity.locator(':scope > button > :first-child')),
    ...await centersFromLeft(activity.locator('li > :is(a, button) > :first-child')),
    ...await centersFromLeft(column.locator(`a[href="/p/${project.id}"] > :first-child`)),
    ...await centersFromLeft(column.getByRole('button', { name: 'Sans projet', exact: true }).locator(':scope > :first-child')),
    ...await centersFromLeft(column.getByRole('link', { name: 'Nouveau projet…' }).locator(':scope > :first-child')),
  ]
  assert.deepEqual(distinct(iconColumn), [26], `une seule colonne d'icônes, à 26 px : ${iconColumn}`)
  const placeTexts = await places.locator('li button > span').evaluateAll((nodes) => nodes.map((node) =>
    node.getBoundingClientRect().left - node.closest('aside').getBoundingClientRect().left))
  assert.deepEqual(distinct(placeTexts), [44], 'les libellés partent à 44 px')
  const treeSessions = await centersFromLeft(column.locator('[data-sidebar-scroll] ul > li > a[href*="/c/"]:not([role=group] a) > :first-child'))
  assert.equal(distinct(treeSessions).length, 1, `les sessions de l'arbre forment une colonne : ${treeSessions}`)

  /*
    Un bord droit commun : les compteurs des lieux, le « ↗ » de l'Activité et le
    `Ctrl K` de *Rechercher* finissent sur la même verticale. SID-2 la tient quand la
    barre de défilement paraît : la bande, le bloc du haut et le bloc qui défile
    réservent la même gouttière, et leurs boîtes utiles ont la même largeur.
  */
  // La souris hors de la colonne : au survol, le compteur d'un lieu cède sa place au « ↗ ».
  await page.mouse.move(900, 400)
  const rightEdge = [
    ...await rightsFromRight(places.locator('li > div > span[aria-hidden]')),
    ...await rightsFromRight(activity.locator(':scope > button > :last-child')),
    ...await rightsFromRight(column.locator('kbd')),
  ]
  assert.equal(distinct(rightEdge).length, 1, `un bord droit commun : ${rightEdge}`)
  const scroller = column.locator('[data-sidebar-scroll]')
  const searchBlock = column.getByRole('button', { name: /^Rechercher/ }).locator('xpath=..')
  const band = column.getByRole('button', { name: 'Masquer la navigation' }).locator('xpath=ancestor::header[1]')
  const gutters = []
  for (const block of [scroller, searchBlock, band]) {
    gutters.push(await block.evaluate((node) => node.offsetWidth - node.clientWidth - parseFloat(getComputedStyle(node).borderLeftWidth) - parseFloat(getComputedStyle(node).borderRightWidth)))
  }
  assert.ok(gutters[0] > 0, `la gouttière du bloc qui défile est réservée : ${gutters}`)
  assert.equal(distinct(gutters).length, 1, `la bande, le bloc du haut et le bloc qui défile réservent la même gouttière : ${gutters}`)

  /*
    SID-1 : un seul bloc qui défile — lieux, Activité, projets et sessions ensemble. Le
    haut (bande, Rechercher, Nouvelle conversation) et le compte restent fixes. À vingt
    sessions par liste, la colonne déborde à coup sûr.
  */
  assert.ok(await scroller.evaluate((node) => node.scrollHeight > node.clientHeight), 'la colonne déborde')
  assert.equal(await scroller.locator('nav[aria-label="Lieux"]').count(), 1, 'les lieux sont dans le bloc qui défile')
  assert.equal(await scroller.getByRole('group', { name: 'Suivi des conversations' }).count(), 1, 'l’Activité aussi')
  const account = column.getByRole('button', { name: 'Alex' })
  const fixed = async () => [
    (await searchBlock.boundingBox()).y,
    (await account.boundingBox()).y,
  ]
  await scroller.evaluate((node) => { node.scrollTop = 0 })
  const fixedBefore = await fixed()
  const placesBefore = (await places.boundingBox()).y
  await scroller.evaluate((node) => { node.scrollTop = 160 })
  assert.ok((await places.boundingBox()).y < placesBefore - 100, 'les lieux montent avec le reste')
  // La colonne déborde maintenant : la barre a paru, et le bord droit n'a pas bougé.
  assert.deepEqual(
    distinct([...await rightsFromRight(places.locator('li > div > span[aria-hidden]')), ...await rightsFromRight(column.locator('kbd'))]),
    [rightEdge[0]],
    'rien ne bouge quand la barre paraît',
  )
  assert.deepEqual(await fixed(), fixedBefore, 'le haut et le compte restent en place')
  await page.screenshot({ path: join(shots, 'defilement-unique.png') })
  await scroller.evaluate((node) => { node.scrollTop = 0 })

  /*
    SID-11 : *Fils* est une destination — sa ligne mène à `/sessions`, avec le « ↗ » au
    survol, et la page allume le lieu. SID-10 : l'historique daté est coupé au budget, et
    sa ligne de fin mène à la page, avec le total puisqu'il y a une coupe. Plus de
    « Tout l'historique… » qui ouvrait la palette.
  */
  const threadsPlace = places.getByRole('button', { name: /^Fils/ })
  await threadsPlace.hover()
  await threadsPlace.locator('xpath=..').locator('svg.lucide-arrow-up-right').waitFor()
  await threadsPlace.click()
  await page.waitForURL(/\/sessions$/)
  assert.equal(await threadsPlace.getAttribute('aria-current'), 'page', '/sessions allume *Fils*')
  await column.getByRole('heading', { name: /Aujourd’hui|Hier|7 derniers jours|Plus ancien/ }).first().waitFor()
  const threadTotal = (await allConversations()).filter((entry) => !entry.scheduleId && !entry.archivedAt).length + 31
  assert.equal(await column.locator('[data-session-list] > li').count(), 20, 'Fils coupé au budget')
  const allThreads = column.getByRole('link', { name: `Toutes les sessions · ${threadTotal}`, exact: true })
  assert.equal(await allThreads.getAttribute('href'), '/sessions')
  assert.equal(await column.getByText('Tout l’historique…').count(), 0)

  // Lieu *Projets* : l'arbre, le centre suit, et la conversation ouverte reste ouverte.
  await places.getByRole('button', { name: /^Projets/ }).click()
  await column.getByRole('link', { name: 'Nouveau projet…' }).waitFor()
  // Plus aucun sous-lien de vue sous un projet déplié, ni d'en-tête « Sessions » : les
  // onglets portent les vues, et sous un projet il n'y a que des sessions.
  assert.equal(
    await column.getByRole('link', { name: /^Board/ }).count(),
    0,
    'Les sous-liens de vue ont quitté la colonne',
  )
  assert.equal(
    await column.getByText('Sessions', { exact: true }).count(),
    0,
    'Pas d’en-tête « Sessions » : le filet de couleur dit l’appartenance',
  )
  /*
    SID-6 / SID-9 : vingt sessions sous le projet, puis une seule ligne de fin, « Toutes
    les sessions du projet · N → », vers la page filtrée sur lui ; N compte les archivées.
    Plus de « N autres sessions… » qui dépliait sur place, plus de section « Archivées ».
  */
  const projectGroup = column.locator(`li:has(a[href="/p/${project.id}"])`)
  assert.equal(await projectGroup.locator('[data-session-list] > li').count(), 20, 'vingt sessions sous le projet')
  const allProject = projectGroup.getByRole('link', { name: /^Toutes les sessions du projet/ })
  assert.equal(await allProject.getAttribute('href'), `/sessions?projet=${project.id}`)
  assert.equal(await allProject.textContent(), `Toutes les sessions du projet${projectTotal}`)
  assert.equal(await column.getByText(/autres sessions…$/).count(), 0)
  assert.equal(await column.getByText(/^Archivées/).count(), 0)
  // La ligne de fin pose son icône sur la colonne des sessions du groupe.
  assert.deepEqual(
    distinct([
      ...await centersFromLeft(projectGroup.locator('[data-session-list] > li > a > :first-child')),
      ...await centersFromLeft(allProject.locator(':scope > :first-child')),
    ]).length,
    1,
    'la ligne de fin sur la colonne des sessions',
  )
  await allProject.screenshot({ path: join(shots, 'ligne-de-fin-projet.png') })

  /*
    Ranger pendant un tour (carte #118). Le serveur refuse, et le refus doit se lire :
    il arrivait après la fermeture du menu `⋯`, qui démonte son contenu, et le clic ne
    faisait rien. Le dialogue propose d'arrêter le tour ; l'arrêt demandé, le
    rangement est retenté aussitôt, et un refus d'une autre nature se dit à son tour.
  */
  const interrupts = []
  let moveAttempts = 0
  await page.route('**/api/conversations/fixture-0/project', (route) => {
    moveAttempts += 1
    return interrupts.length === 0
      ? route.fulfill({ status: 400, json: { error: { code: 'conversation_busy', message: 'A conversation cannot be moved while a turn is running.' } } })
      : route.fulfill({ status: 400, json: { error: { code: 'conversation_scheduled', message: 'A scheduled run stays where its task put it.' } } })
  })
  await page.route('**/api/conversations/fixture-0/interrupt', (route) => {
    interrupts.push(route.request().method())
    return route.fulfill({ status: 204 })
  })
  const busyRow = column.getByRole('link', { name: /Session de travail 1(?!\d)/ }).first().locator('xpath=ancestor::li[1]')
  await busyRow.hover()
  await busyRow.getByRole('button', { name: 'Actions de la conversation' }).click()
  await page.getByRole('menuitem', { name: 'Ranger…' }).click()
  await page.getByRole('menuitem', { name: /^Dans / }).first().click()
  const busy = page.getByRole('dialog', { name: 'Un tour est en cours' })
  await busy.waitFor()
  await page.screenshot({ path: join(shots, 'ranger-pendant-un-tour.png') })
  await busy.getByRole('button', { name: 'Arrêter le tour et ranger' }).click()
  await page.getByRole('dialog', { name: 'Ce fil n’a pas été rangé' }).or(page.getByRole('dialog', { name: "Ce fil n'a pas été rangé" })).waitFor()
  assert.deepEqual(interrupts, ['POST'])
  assert.equal(moveAttempts, 2)
  await page.getByRole('button', { name: 'Fermer' }).click()
  await page.unroute('**/api/conversations/fixture-0/project')
  await page.unroute('**/api/conversations/fixture-0/interrupt')

  // *Sans projet* ouvre la liste, avant les projets : une boîte de réception, et non un
  // cas particulier qu'on range en bas. Son lien n'a pas de segment de projet — écrire
  // `/p/null/c/<id>` donnerait une adresse qui se charge et ne trouve rien.
  const free = column.getByRole('button', { name: 'Sans projet', exact: true })
  await free.waitFor()
  assert.equal(await column.locator(`a[href="/c/fixture-libre"]`).count(), 1)
  assert.equal(await column.locator('a[href^="/p/null/"]').count(), 0)
  // Les lignes de lieu sont elles aussi des `li > div` depuis qu'elles portent un
  // raccourci : chercher dans toute la colonne rendrait *Fils* comme premier groupe.
  const order = await column.evaluate((node) => {
    const groups = [...node.querySelectorAll('li')]
      .filter((item) => item.querySelector(':scope > div') && !item.closest('nav'))
    return groups[0]?.textContent?.startsWith('Sans projet') ?? false
  })
  assert.equal(order, true, '*Sans projet* doit être le premier groupe')
  // Remonter le bloc qui défile avant la capture, sinon l'image s'ouvre là où le dépli
  // l'a laissée et le premier groupe est hors champ.
  await column.evaluate((node) => {
    for (const child of node.querySelectorAll('*')) if (child.scrollTop > 0) child.scrollTop = 0
  })
  await page.screenshot({ path: join(shots, 'lieu-projets.png') })

  // La ligne d'un projet ouvre sa porte, et sa porte est l'Aperçu. Elle a ouvert une
  // conversation neuve vide tant que `/p/:id` n'était qu'un formulaire de réglages : le
  // défaut de `useProjectView` datait d'avant l'Aperçu.
  const projectRow = column.getByRole('link', { name: project.name }).first()
  assert.equal(await projectRow.getAttribute('href'), `/p/${project.id}`)

  /*
    Quatre cibles sur la ligne, et pas une de plus : le corps, le chevron, puis le `+` et
    le `⋯` qui **prennent la place** des deux points d'état au survol. C'est la seule
    chose ici qu'une relecture ne verrait pas — rien dans le code ne dit qu'on échange
    plutôt qu'on ajoute, sinon deux classes d'affichage qui doivent se répondre.
  */
  const projectLine = projectRow.locator('xpath=..')
  const newThread = projectLine.getByRole('link', { name: /^Nouvelle conversation/ })
  assert.equal(await newThread.isVisible(), false, 'Au repos, le + n’est pas là')
  await projectRow.hover()
  await newThread.waitFor()
  await projectLine.getByRole('button', { name: /^Actions/ }).waitFor()
  assert.equal(
    await projectLine.locator('[data-project-state]').isVisible(),
    false,
    'Au survol, les points d’état cèdent la place au lieu de se pousser',
  )

  /*
    SID-13 : le `⋯` d'un projet mène droit à chacun de ses onglets, dans l'ordre de la
    rangée, puis à toutes ses sessions ; un séparateur, puis Réglages et Renommer. Plus
    de pastilles de couleur : elle vit dans Réglages › Général. Le clic droit ouvre le
    même menu.
  */
  const projectMenuEntries = [
    'Aperçu', 'Travail', 'Tableau', 'Jalons', 'Actions', 'Toutes les sessions du projet',
    'Réglages du projet', 'Renommer',
  ]
  await projectRow.click({ button: 'right' })
  const treeMenu = page.getByRole('menu')
  await treeMenu.waitFor()
  assert.deepEqual(
    await treeMenu.getByRole('menuitem').allTextContents(),
    ['N’afficher que ce projet', ...projectMenuEntries],
  )
  assert.deepEqual(
    await treeMenu.locator(':scope > [role="menuitem"], :scope > [role="separator"]').evaluateAll(
      (nodes) => nodes.map((node) => node.getAttribute('role') === 'separator' ? '—' : node.textContent),
    ),
    ['N’afficher que ce projet', '—', ...projectMenuEntries.slice(0, 6), '—', ...projectMenuEntries.slice(6)],
    'un séparateur avant les onglets, un autre avant Réglages',
  )
  assert.equal(await treeMenu.getByText('Couleur').count(), 0, 'plus de couleur : ni intitulé, ni pastilles (des entrées sans texte)')
  await page.screenshot({ path: join(shots, 'menu-projet.png') })
  await treeMenu.getByRole('menuitem', { name: 'Jalons', exact: true }).click()
  await page.waitForURL(`**/p/${project.id}/timeline`)
  await projectRow.hover()
  await projectLine.getByRole('button', { name: /^Actions/ }).click()
  await page.getByRole('menuitem', { name: 'Travail', exact: true }).click()
  await page.waitForURL(`**/p/${project.id}/travail`)
  await projectRow.hover()
  await projectLine.getByRole('button', { name: /^Actions/ }).click()
  await page.getByRole('menuitem', { name: 'Toutes les sessions du projet', exact: true }).click()
  await page.waitForURL(`**/sessions?projet=${project.id}`)
  await places.getByRole('button', { name: /^Projets/ }).click()
  await projectRow.hover()

  await projectRow.click()
  await page.waitForURL(`**/p/${project.id}`)
  assert.equal(await page.locator('textarea').count(), 0, 'un projet ne s’ouvre pas sur un fil vide')

  // Et une ligne de conversation ouvre bien sa conversation, pas un fil neuf.
  const conversationRow = column.locator(`a[href$="/c/${hero.id}"]`).first()
  await conversationRow.click()
  await page.waitForURL(`**/c/${hero.id}`)

  /*
    Le mode « un seul projet » (#51). On y entre depuis la ligne du projet dans l'arbre ;
    la ligne du projet tient en une ligne — ⇅, le nom vers l'Aperçu, +, ⋯ — et les
    conversations suivent directement, sans liens de vues. Le choix se retient au
    rechargement, suit la conversation qu'on ouvre ailleurs, et revenir à l'arbre ne
    touche pas aux replis du compte.
  */
  const collapsedBefore = (await (await context.request.get(`${base}/api/me/settings`)).json()).collapsedProjects
  await projectRow.hover()
  await projectLine.getByRole('button', { name: `N’afficher que ${project.name}`, exact: true }).click()
  const focusLine = column.locator('[data-project-focus]')
  await focusLine.waitFor()
  assert.equal(await focusLine.getByRole('link', { name: project.name, exact: true }).getAttribute('href'), `/p/${project.id}`)
  assert.equal(await column.getByRole('button', { name: 'Sans projet', exact: true }).count(), 0, 'un seul groupe à la fois')
  assert.equal(await column.getByRole('link', { name: /^Tableau/ }).count(), 0, 'pas de liens de vues sous la ligne')
  await column.locator(`a[href$="/c/${hero.id}"]`).first().waitFor()
  /*
    SID-5 : le ⇅ et les sessions du projet sont sur la colonne d'icônes, sans retrait.
    SID-4 : le ⋯ du projet et le bouton de repli de la bande sont deux boutons `sm`
    (28 px) centrés sur la même verticale, à 26 px du bord droit utile.
  */
  const focusColumn = [
    ...await centersFromLeft(focusLine.locator(':scope > :first-child')),
    ...await centersFromLeft(focusLine.locator('xpath=..').locator('ul > li > a > :first-child')),
  ]
  assert.deepEqual(distinct(focusColumn), [26], `mode projet sur la colonne d'icônes : ${focusColumn}`)
  const focusName = focusLine.getByRole('link', { name: project.name, exact: true })
  await focusName.hover()
  // Les fonds sont en transition : laisser la couleur arriver avant de la lire.
  await page.waitForTimeout(250)
  const collapse = column.getByRole('button', { name: 'Masquer la navigation' })
  const projectMenu = focusLine.getByRole('button', { name: /^Actions du projet/ })
  assert.deepEqual(
    [await collapse.evaluate((node) => node.offsetWidth), await projectMenu.evaluate((node) => node.offsetWidth)],
    [28, 28],
    'le repli et le ⋯ en taille sm',
  )
  assert.deepEqual(
    distinct([...await centersFromRight(collapse), ...await centersFromRight(projectMenu)]).length,
    1,
    'le repli et le ⋯ sur la même verticale',
  )
  // Pas de fond sur toute la ligne au survol : chaque geste a le sien, le nom le sien.
  assert.equal(await focusLine.evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)')
  assert.notEqual(await focusName.evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)')
  assert.equal(await focusLine.evaluate((node) => getComputedStyle(node.parentElement).paddingTop), '8px', 'de l’air sous le filet')
  await page.screenshot({ path: join(shots, 'mode-projet.png') })

  const switcher = focusLine.getByRole('button', { name: /^Changer de projet/ })
  await switcher.click()
  await page.getByRole('menuitem', { name: 'Tous les projets', exact: true }).waitFor()
  await page.screenshot({ path: join(shots, 'mode-projet-liste.png') })
  await page.getByRole('menuitem', { name: /^Sans projet/ }).click()
  await column.locator('a[href="/c/fixture-libre"]').waitFor()
  // Le choix fait à la main tient au rechargement, sur le même fil.
  await page.reload()
  await column.locator('[data-project-focus]').waitFor()
  await column.locator('a[href="/c/fixture-libre"]').waitFor()
  // Un fil d'un autre projet, ouvert depuis *Fils*, ramène la colonne sur son projet.
  await places.getByRole('button', { name: /^Fils/ }).click()
  await column.locator('a[href$="/c/fixture-1"]').first().click()
  await page.waitForURL('**/c/fixture-1')
  // L'adresse change avant que le fil soit rendu : la navigation est une transition, et
  // changer de lieu avant son commit l'abandonne — le fil n'a jamais été ouvert.
  await column.locator('a[href$="/c/fixture-1"][aria-current="page"]').first().waitFor()
  await places.getByRole('button', { name: /^Projets/ }).click()
  await focusLine.getByRole('link', { name: project.name, exact: true }).waitFor()

  // « Tous les projets » revient à l'arbre, replis du compte intacts.
  await switcher.click()
  await page.getByRole('menuitem', { name: 'Tous les projets', exact: true }).click()
  await focusLine.waitFor({ state: 'detached' })
  await column.getByRole('button', { name: 'Sans projet', exact: true }).waitFor()
  const collapsedAfter = (await (await context.request.get(`${base}/api/me/settings`)).json()).collapsedProjects
  assert.deepEqual(collapsedAfter, collapsedBefore)

  // Lieu *Planifiées* : les tâches par échéance, tous projets confondus.
  await places.getByRole('button', { name: /^Planifiées/ }).click()
  await column.getByRole('heading', { name: /Aujourd’hui|Cette semaine|Plus tard|En sommeil/ }).first()
    .or(column.getByText('Aucune tâche planifiée')).waitFor()

  // La modale d'activité : quatre filtres qui portent leur compte, plus un par projet.
  const openActivity = activity.getByRole('button', { name: /^Activité/ })
  await openActivity.click()
  const dialog = page.getByRole('dialog', { name: 'Activité globale' })
  for (const name of ['Pour toi', 'Non lues', 'En cours', 'Tout']) {
    await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).waitFor()
  }
  // Ouverte d'un clic, Radix donne le focus à « Fermer » : son infobulle ne doit pas
  // s'ouvrir pour autant, elle ne suit que le focus clavier (carte #56).
  assert.equal(await page.getByRole('tooltip').count(), 0)
  await dialog.getByRole('button', { name: 'Tous les projets' }).click()
  await page.getByRole('menuitem', { name: 'Nimbus' }).click()
  await page.screenshot({ path: join(shots, 'modale-activite.png') })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  // Ouverte au clavier, le même focus est visible : l'aide du bouton s'affiche, et le
  // premier Échap la ferme avant la modale.
  await openActivity.focus()
  await page.keyboard.press('Enter')
  await dialog.getByRole('button', { name: 'Fermer' }).and(page.locator(':focus')).waitFor()
  await page.getByRole('tooltip', { name: 'Fermer' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('tooltip').waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })

  // Le menu du compte : Services et Réglages y sont entrés, la colonne n'en garde qu'une.
  assert.equal(await column.getByRole('link', { name: 'Services' }).count(), 0)
  await column.getByRole('button', { name: 'Alex' }).click()
  await page.getByRole('menuitem', { name: 'Services' }).waitFor()
  await page.getByRole('menuitem', { name: 'Réglages' }).waitFor()
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).waitFor()
  await page.getByRole('menuitem', { name: 'Consommation' }).waitFor()
  await page.screenshot({ path: join(shots, 'menu-compte.png') })

  // La consommation appartient au compte : son entrée ouvre la modale des CLI. Aucun
  // CLI n'est activé ici, donc c'est l'état vide qui se vérifie — l'entrée reste quand
  // même, puisque la savoir vide coûterait une sonde à chaque ouverture du menu.
  await page.getByRole('menuitem', { name: 'Consommation' }).click()
  const usage = page.getByRole('dialog', { name: 'Consommation du compte' })
  await usage.getByText(/Aucun CLI n'est installé/).waitFor()
  await page.keyboard.press('Escape')

  // Avec des CLI, une section chacun, lues ensemble. Bouchonné : la machine de CI
  // n'installe aucun CLI, et le rendu de la modale est ce qui se vérifie ici — pas la
  // sonde, qui a ses propres tests côté serveur.
  const usageFixtures = {
    claude: { plan: 'max', limitsAvailable: true, credits: { label: 'Crédits hors forfait', utilization: 0.1, detail: '4,10 $ consommés', enabled: true }, windows: [
      { id: 'five_hour', label: 'Fenêtre de 5 h', utilization: 0.42, resetsAt: Date.now() + 3_600_000 },
      { id: 'seven_day', label: 'Fenêtre de 7 j', utilization: 0.81, resetsAt: Date.now() + 200_000_000 },
    ] },
    codex: { plan: 'plus', limitsAvailable: true, credits: null, windows: [
      { id: 'weekly', label: 'Hebdomadaire', utilization: 0.93, resetsAt: Date.now() + 86_400_000 },
    ] },
    // Sans limites de forfait : les fenêtres sont vides, et ce n'est pas une panne.
    opencode: { plan: null, limitsAvailable: false, credits: null, windows: [] },
  }
  await page.route('**/api/agents', (route) => route.fulfill({ json: { agents: Object.keys(usageFixtures).map((agent) => ({
    agent, binary: agent, enabled: true, installed: true, managed: true, path: `/usr/bin/${agent}`,
    version: '1.0.0', reason: null, preferredVersion: '1.0.0', install: { status: 'idle' },
  })) } }))
  await page.route('**/api/agents/*/usage*', (route) => {
    const agent = new URL(route.request().url()).pathname.split('/')[3]
    route.fulfill({ json: { agent, fetchedAt: Date.now() - 42_000, ...usageFixtures[agent] } })
  })
  // Rechargée : la liste des CLI est en cache depuis l'ouverture précédente, et elle y
  // tient une minute — les bouchons posés après coup ne seraient jamais appelés.
  await page.reload()
  await places.waitFor()
  await column.getByRole('button', { name: 'Alex' }).click()
  await page.getByRole('menuitem', { name: 'Consommation' }).click()
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) {
    await usage.getByRole('heading', { name }).waitFor()
  }
  await usage.getByText('Fenêtre de 5 h').waitFor()
  await usage.getByText('Hebdomadaire').waitFor()
  // Ouverte depuis un menu à la souris : le focus que Radix pose sur le premier bouton
  // n'ouvre pas son infobulle par-dessus le contenu.
  assert.equal(await page.getByRole('tooltip').count(), 0)
  await usage.screenshot({ path: join(shots, 'modale-consommation.png') })
  await page.keyboard.press('Escape')
  await usage.waitFor({ state: 'hidden' })

  // Ce que la lecture par CLI achète, et qui n'était testé nulle part : un CLI lent ne
  // retient pas les autres, et un CLI en panne ne vide pas l'écran. Chacun répond pour
  // lui — c'est toute la raison d'avoir une query par CLI plutôt qu'une pour le compte.
  await page.unroute('**/api/agents/*/usage*')
  await page.route('**/api/agents/*/usage*', async (route) => {
    const agent = new URL(route.request().url()).pathname.split('/')[3]
    if (agent === 'opencode') {
      await route.fulfill({ status: 500, json: { error: { code: 'usage_unavailable', message: 'Could not read usage from opencode.' } } })
      return
    }
    // Assez long pour que la section reste en squelette pendant que Claude s'affiche,
    // assez court pour ne pas peser sur la suite.
    if (agent === 'codex') await delay(1500)
    await route.fulfill({ json: { agent, fetchedAt: Date.now() - 42_000, ...usageFixtures[agent] } })
  })
  await page.reload()
  await places.waitFor()
  await column.getByRole('button', { name: 'Alex' }).click()
  await page.getByRole('menuitem', { name: 'Consommation' }).click()
  // Claude est là, Codex est encore en route, opencode a échoué — les trois en même temps.
  await usage.getByText('Fenêtre de 5 h').waitFor()
  await usage.locator('section[aria-busy="true"]').waitFor()
  await usage.getByRole('alert').waitFor()
  // Puis le lent arrive, sans que l'échec du voisin ait rien emporté.
  await usage.getByText('Hebdomadaire').waitFor()
  assert.equal(await usage.locator('section[aria-busy="true"]').count(), 0)
  assert.equal(await usage.getByRole('alert').count(), 1)

  // Rafraîchir relance un process CLI par agent, et `?refresh=1` court-circuite le
  // cache du serveur : le bouton doit se fermer pendant qu'il travaille, sinon trois
  // clics impatients en lancent trois fois plus. Codex met 1,5 s à répondre, ce qui
  // laisse le temps de le constater.
  await usage.getByRole('button', { name: 'Rafraîchir' }).click()
  // Attendu plutôt que constaté sur-le-champ : le rendu qui ferme le bouton suit le
  // clic d'un battement, et l'échéance de ce `waitFor` est ce qui dit le défaut.
  await usage.locator('button[aria-label="Rafraîchir"][disabled]').waitFor({ timeout: 2000 })
  await usage.locator('button[aria-label="Rafraîchir"]:not([disabled])').waitFor()

  await page.keyboard.press('Escape')
  await usage.waitFor({ state: 'hidden' })

  // Les comptes supplémentaires : une section pour chacun de ceux qui ont une jauge,
  // nommée par le CLI puis le compte. Un jeton sans jauge et une clé API n'ont rien à
  // montrer, et ne sont pas sondés.
  const now = Date.now()
  await page.route('**/api/claude-accounts', (route) => route.fulfill({ json: { accounts: [
    { id: 'perso', label: 'Perso · alex@example.com', email: 'alex@example.com', alias: 'Perso', kind: 'oauth', duplicate: false, gauge: true, createdAt: now, updatedAt: now },
    { id: 'jeton', label: 'Jeton seul · jeton@example.com', email: 'jeton@example.com', alias: 'Jeton seul', kind: 'oauth', duplicate: false, gauge: false, createdAt: now, updatedAt: now },
    { id: 'cle', label: 'Clé Console', email: null, alias: 'Clé Console', kind: 'apiKey', duplicate: false, gauge: false, createdAt: now, updatedAt: now },
  ] } }))
  await page.route('**/api/codex-accounts', (route) => route.fulfill({ json: { accounts: [
    { id: 'boite', label: 'Boîte', status: 'ready', authMode: 'chatgpt', email: null, planType: 'pro', createdAt: now, updatedAt: now },
  ] } }))
  const probedAccounts = []
  await page.unroute('**/api/agents/*/usage*')
  await page.route('**/api/agents/*/usage*', (route) => {
    const url = new URL(route.request().url())
    const agent = url.pathname.split('/')[3]
    if (url.searchParams.get('account')) probedAccounts.push(url.searchParams.get('account'))
    route.fulfill({ json: { agent, fetchedAt: Date.now() - 42_000, ...usageFixtures[agent] } })
  })
  await page.reload()
  await places.waitFor()
  await column.getByRole('button', { name: 'Alex' }).click()
  await page.getByRole('menuitem', { name: 'Consommation' }).click()
  await usage.getByRole('heading', { name: 'Claude Code · Perso · alex@example.com' }).waitFor()
  await usage.getByRole('heading', { name: 'Codex · Boîte' }).waitFor()
  assert.equal(await usage.locator('section h3').count(), 5)
  assert.deepEqual(probedAccounts.sort(), ['boite', 'perso'])
  await page.keyboard.press('Escape')
  await usage.waitFor({ state: 'hidden' })

  /*
    SID-6 à SID-8 : « Ajuster à la hauteur », le défaut, dans un contexte sans réglage.
    À 1280×800 la colonne ne défile pas : chaque liste montre ce qui tient, la mesure se
    stabilise, et l'Activité garde ses lignes. À 1280×600, moins de 5 sessions tiendraient
    sous elle : elle se réduit à son en-tête, et revient quand la place revient.
  */
  const fitContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  // Le mode « un seul projet » : une seule liste, celle du projet. Dans l'arbre, le
  // budget se partage entre tous les groupes dépliés, et le jeu de démo en a quatre.
  // Posé une fois par onglet : le test le retire plus loin, pour l'arbre.
  await fitContext.addInitScript((id) => {
    localStorage.setItem('solera.locale', 'fr')
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('solera.display.projectFocus', id)
  }, project.id)
  assert.ok((await fitContext.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })).ok())
  const fitPage = await fitContext.newPage()
  fitPage.on('pageerror', (error) => errors.push(error.message))
  await fitPage.route('**/api/conversations', longList)
  await fitPage.goto(`${base}/p/${project.id}/c/${hero.id}`)
  const fitColumn = fitPage.locator('aside')
  const fitActivity = fitColumn.getByRole('group', { name: 'Suivi des conversations' })
  const fitGroup = fitColumn.locator('div:has(> [data-project-focus])')
  await fitActivity.getByRole('link').first().waitFor()
  await fitGroup.getByRole('link', { name: /^Toutes les sessions du projet/ }).waitFor()
  /**
   * La mesure se pose — cinq relevés identiques de suite, en dix secondes au plus : une
   * colonne qui oscille n'y arrive jamais — et la colonne ne défile pas.
   */
  const settled = async () => {
    const sample = () => fitPage.evaluate(() => {
      const node = document.querySelector('[data-sidebar-scroll]')
      return {
        sessions: document.querySelectorAll('[data-session-list] > li').length,
        activity: document.querySelectorAll('[data-sidebar-activity] li').length,
        scrolls: node.scrollHeight > node.clientHeight,
      }
    })
    let last = ''
    let same = 0
    for (let pass = 0; pass < 50 && same < 5; pass += 1) {
      await delay(200)
      const current = JSON.stringify(await sample())
      same = current === last ? same + 1 : 0
      last = current
    }
    assert.equal(same, 5, `la mesure se pose : ${last}`)
    const state = JSON.parse(last)
    assert.equal(state.scrolls, false, `la colonne ne défile pas : ${last}`)
    return state
  }
  const tall = await settled()
  assert.ok(tall.sessions >= 5, `au moins 5 sessions à 800 px : ${JSON.stringify(tall)}`)
  assert.ok(tall.activity > 0, 'l’Activité garde ses lignes')
  // La liste est coupée, et sa ligne de fin est là : le calcul ne la coupe jamais.
  await fitGroup.getByRole('link', { name: /^Toutes les sessions du projet/ }).waitFor()
  await fitColumn.screenshot({ path: join(shots, 'ajuster-800.png') })
  await fitPage.setViewportSize({ width: 1280, height: 600 })
  const short = await settled()
  assert.equal(short.activity, 0, `l’Activité se réduit à son en-tête : ${JSON.stringify(short)}`)
  await fitActivity.getByRole('button', { name: /^Activité/ }).waitFor()
  await fitColumn.screenshot({ path: join(shots, 'ajuster-600.png') })
  await fitPage.setViewportSize({ width: 1280, height: 800 })
  assert.deepEqual(await settled(), tall, 'la place revenue, l’Activité se redéplie')

  // Dix, vingt, cinquante : ce nombre par liste, et le bloc qui défile prend le relais.
  const live = (await allConversations()).filter((entry) => entry.projectId === project.id && !entry.scheduleId && !entry.archivedAt).length + 30
  for (const [limit, rows] of [['10', 10], ['50', Math.min(50, live)]]) {
    await fitPage.evaluate((value) => localStorage.setItem('solera.display.sessionLimit', value), limit)
    await fitPage.reload()
    await fitGroup.locator('[data-session-list] > li').nth(rows - 1).waitFor()
    assert.equal(await fitGroup.locator('[data-session-list] > li').count(), rows, `${limit} par liste`)
    // La ligne de fin ne paraît que si le total dépasse ce qui est montré.
    assert.equal(await fitGroup.getByRole('link', { name: /^Toutes les sessions du projet/ }).count(), rows < projectTotal ? 1 : 0)
  }
  assert.ok(await fitColumn.locator('[data-sidebar-scroll]').evaluate((node) => node.scrollHeight > node.clientHeight), 'à 50, la colonne défile')

  /*
    Dans l'arbre, en « Ajuster », le budget se partage entre les quatre groupes : les
    lignes de fin restent, et celle des fils libres mène à la page filtrée sur eux.
  */
  await fitPage.evaluate(() => {
    localStorage.removeItem('solera.display.sessionLimit')
    localStorage.removeItem('solera.display.projectFocus')
  })
  await fitPage.reload()
  const loose = fitColumn.getByRole('link', { name: /^Toutes les sessions sans projet/ })
  await loose.waitFor()
  assert.equal(await loose.getAttribute('href'), '/sessions?projet=none')
  await settled()

  // Au téléphone, rien ne se mesure : « Ajuster » vaut 10.
  await fitPage.evaluate((id) => localStorage.setItem('solera.display.projectFocus', id), project.id)
  await fitPage.setViewportSize({ width: 390, height: 844 })
  await fitPage.reload()
  await fitPage.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click()
  await fitGroup.getByRole('link', { name: /^Toutes les sessions du projet/ }).waitFor()
  assert.equal(await fitGroup.locator('[data-session-list] > li').count(), 10, 'au téléphone, 10')
  await fitContext.close()

  // Le tiroir au doigt : rien ne déborde sur la largeur.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click()
  await places.waitFor()
  // Le tiroir entre par une translation : capturer avant la fin la montre à moitié sortie.
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(shots, 'tiroir-mobile.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

  assert.deepEqual(errors, [])
  console.log('OK : lieux et leur raccourci de création, historique daté, arbre des projets, planifiées, défilement d’un seul bloc, colonne d’icônes et bord droit commun, modale d’activité, mode un seul projet, menu ⋯ d’un projet, menu du compte, consommation (vide, servie, lente, en panne, par compte), refus de rangement pendant un tour, Fils vers /sessions, lignes de fin, Ajuster à la hauteur et repli de l’Activité, 10 / 20 / 50, tiroir mobile.')
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
