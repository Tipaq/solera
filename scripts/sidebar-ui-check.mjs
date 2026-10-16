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
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-09-19-sidebar')
  await mkdir(shots, { recursive: true })
  // Une longue liste pour vérifier le défilement et le « N autres sessions… », sans
  // toucher à la base réelle.
  await page.route('**/api/conversations', async (route) => {
    const response = await route.fetch()
    const entries = await response.json()
    // `idle` et lues : une session active ne figure pas dans le groupe de son projet,
    // elle est déjà dans l'activité au-dessus.
    // Un fil libre : il n'appartient à aucun projet, et c'est le groupe *Sans projet*
    // qui doit lui donner un domicile dans la colonne.
    const free = { ...hero, id: 'fixture-libre', projectId: null, title: 'Fil sans projet', status: 'idle', lastReadSeq: hero.lastNotableSeq, archivedAt: null }
    await route.fulfill({ json: [...entries, free, ...Array.from({ length: 30 }, (_, i) => ({ ...hero, id: `fixture-${i}`, title: `Session de travail ${i + 1}`, status: 'idle', lastReadSeq: hero.lastNotableSeq, archivedAt: null }))] })
  })

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

  // L'activité est fixe : faire défiler la zone basse ne la déplace pas.
  const activity = column.getByRole('group', { name: 'Suivi des conversations' })
  await activity.waitFor()
  // Attendre qu'elle soit remplie avant de la mesurer : ses lignes viennent du socket,
  // qui arrive après le premier rendu, et une mesure prise sur « Aucune session en
  // cours » ne vaut rien pour la comparaison d'après.
  await activity.getByRole('link').first().waitFor()
  const before = await activity.boundingBox()

  // Lieu *Fils* : l'historique daté. Une tranche au moins porte des lignes.
  await places.getByRole('button', { name: /^Fils/ }).click()
  await column.getByRole('heading', { name: /Aujourd’hui|Hier|7 derniers jours|Plus ancien/ }).first().waitFor()
  await column.getByRole('button', { name: 'Tout l’historique…' }).waitFor()

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
  const more = column.getByRole('button', { name: /autres sessions…$/ })
  await more.click()
  await column.getByRole('link', { name: /Session de travail 30/ }).waitFor()
  assert.deepEqual(await activity.boundingBox(), before, 'l’activité doit rester fixe')
  await column.getByRole('button', { name: 'Réduire la liste' }).click()
  assert.equal(await column.getByRole('link', { name: /Session de travail 30/ }).count(), 0)

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
  // La zone basse est la seule partie qui défile : la remonter avant la capture, sinon
  // l'image s'ouvre là où le dépli l'a laissée et le premier groupe est hors champ.
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

  await projectRow.click()
  await page.waitForURL(`**/p/${project.id}`)
  assert.equal(await page.locator('textarea').count(), 0, 'un projet ne s’ouvre pas sur un fil vide')

  // Et une ligne de conversation ouvre bien sa conversation, pas un fil neuf.
  const conversationRow = column.locator(`a[href$="/c/${hero.id}"]`).first()
  await conversationRow.click()
  await page.waitForURL(`**/c/${hero.id}`)

  // Lieu *Planifiées* : les tâches par échéance, tous projets confondus.
  await places.getByRole('button', { name: /^Planifiées/ }).click()
  await column.getByRole('heading', { name: /Aujourd’hui|Cette semaine|Plus tard|En sommeil/ }).first()
    .or(column.getByText('Aucune tâche planifiée')).waitFor()

  // La modale d'activité : quatre filtres qui portent leur compte, plus un par projet.
  await activity.getByRole('button', { name: /^Activité/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Activité globale' })
  for (const name of ['Tout', 'À débloquer', 'En cours', 'Non lues']) {
    await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).waitFor()
  }
  await dialog.getByRole('button', { name: 'Tous les projets' }).click()
  await page.getByRole('menuitem', { name: 'Nimbus' }).click()
  await page.screenshot({ path: join(shots, 'modale-activite.png') })
  await page.keyboard.press('Escape')

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
  // Le focus va au panneau et non à son premier bouton : une infobulle ouverte avec la
  // modale, par-dessus son contenu, est ce que le focus automatique de Radix produit
  // quand on le laisse faire.
  assert.equal(await page.getByRole('tooltip').count(), 0)
  await usage.screenshot({ path: join(shots, 'modale-consommation.png') })
  // Et le panneau focalisé rend bien la main : sans ça, détourner le focus fermerait
  // la porte de sortie au clavier.
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

  // Le tiroir au doigt : rien ne déborde sur la largeur.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click()
  await places.waitFor()
  // Le tiroir entre par une translation : capturer avant la fin la montre à moitié sortie.
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(shots, 'tiroir-mobile.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

  assert.deepEqual(errors, [])
  console.log('OK : lieux et leur raccourci de création, historique daté, arbre des projets, planifiées, activité fixe et sa modale, menu du compte, consommation (vide, servie, lente, en panne), tiroir mobile.')
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
