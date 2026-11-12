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
import { checkTravailGraph } from './checks/travail-graph.mjs'
import { assertMilestoneRows, installMilestoneAsks } from './checks/milestone-inbox.mjs'
import { checkTravailTable } from './checks/travail-table.mjs'

/*
 * L'onglet Travail d'un projet (carte #175, `projet.md` T-1 à T-5, T-14), qui remplace
 * l'Activité et le Journal, et ce qui l'entoure.
 *
 * Ce que la suite tient : la rangée, le compteur ambre qui ne compte que ce qui réclame,
 * les anciennes adresses (`/activity?groupe=worktree` → « Par arbre », `/journal` →
 * « Par moment »), la barre sur une ligne (bilan neutre, Filtrer ▾ et ses puces, retenus
 * pour le projet, « Rien ne correspond »), la vue dans l'adresse et retenue, le fil
 * « Par moment » (Maintenant, En cours, Ce qui t'attend, la ligne de base, les jours),
 * l'index et la puce d'arbre qui filtrent, la recherche, le téléphone sans
 * débordement, et la vue « Graphe » avec le tiroir d'un commit (#178,
 * `checks/travail-graph.mjs`), et la vue « Tableau » avec les gestes d'un arbre et d'une
 * branche (#177, `checks/travail-table.mjs`). Elle écrit ses captures dans `portage/`, à côté du dessin.
 *
 * Les PR sont simulées au niveau de la page (le projet de démo n'a pas de forge), le
 * pilotage d'un jalon aussi (#116) : la suite tient son bandeau en tête du fil, la vue
 * par vagues et sa file, la pause, et la ligne de la frise qui mène à la vue.
 *
 * « Ce qui t'attend » (#163), sur l'Aperçu : le résumé de l'en-tête, trois lignes puis
 * « N de plus », les lourdes avant les légères, une seule réponse dépliée, l'ouverture de
 * loin (`openInboxItem`), la réponse par la route du fil, et le calme d'un projet vide.
 */
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-activity-check-'))
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
  assert.ok(nimbus)
  const conversations = (await (await context.request.get(`${base}/api/conversations`)).json())
    .filter((entry) => entry.projectId === nimbus.id && entry.archivedAt === null)
  const awaiting = conversations.find((entry) => entry.status === 'awaiting_input')
  const running = conversations.find((entry) => entry.status === 'running' && entry.worktreeId)
  assert.ok(awaiting && running, 'Le jeu d’essai porte une session qui attend et une qui tourne dans un worktree')

  // ─── Les PR, simulées : une en checks sur l'arbre qui tourne, une prête ailleurs ──
  const trees = await (await context.request.get(`${base}/api/projects/${nimbus.id}/worktrees/status`)).json()
  const branchOf = (conversation) => {
    const tree = trees.worktrees.find((entry) => entry.id === conversation.worktreeId)
    return tree ? (tree.branch ?? tree.name) : null
  }
  const runningBranch = branchOf(running)
  // Une session finie, dans un autre arbre : sa PR ouverte doit la faire passer en relecture.
  const withPr = conversations.find(
    (entry) => entry.worktreeId && ['idle', 'completed'].includes(entry.status) && branchOf(entry) && branchOf(entry) !== runningBranch,
  )
  const pullRequest = (number, branch, state, failed = []) => ({
    number, url: `https://github.com/demo/nimbus/pull/${number}`, title: `PR de ${branch}`, branch, base: 'main', state,
    checks: { passed: 0, pending: state === 'checks' ? 1 : 0, failed }, review: null, updatedAt: Date.now(),
  })
  const pullRequests = [pullRequest(18, runningBranch, 'checks')]
  if (withPr) pullRequests.push(pullRequest(17, branchOf(withPr), 'ready'))

  const page = await context.newPage()
  await page.route('**/api/projects/*/pull-requests', (route) =>
    route.fulfill({ json: { available: true, fetchedAt: Date.now(), pullRequests } }),
  )
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-10-21-page-projet/portage')
  await mkdir(shots, { recursive: true })

  // ─── La rangée v2 (#160) : Travail en deuxième ──────────────────────────────
  await page.goto(`${base}/p/${nimbus.id}`)
  const row = page.getByRole('navigation', { name: 'Vues du projet', exact: true })
  await row.waitFor()
  const labels = (await row.getByRole('link').evaluateAll((links) => links.map((link) => link.querySelector('span[title]') ? link.innerText.replace(link.querySelector('span[title]').innerText, '') : link.innerText))).map((text) => text.trim())
  assert.deepEqual(labels, ['Aperçu', 'Travail', 'Tableau', 'Jalons', 'Actions', 'Réglages'])
  // Le compteur de l'onglet est ce qui te demande quelque chose, pas l'inventaire.
  const asking = conversations.filter((entry) => ['awaiting_input', 'error', 'interrupted'].includes(entry.status)).length
  assert.equal(await row.getByRole('link', { name: /^Travail/ }).locator('span[title] [aria-hidden]').innerText(), String(asking))

  // « En ce moment » a quitté l'Aperçu (#172) : les sessions vivantes sont à Travail, et
  // le phare des jalons dira celles d'un jalon.
  assert.equal(await page.getByRole('region', { name: 'En ce moment', exact: true }).count(), 0)
  // ─── « Ce qui t'attend » (#163) : une liste, une ligne par demande ─────────
  const inbox = page.getByRole('region', { name: 'Ce qui t’attend', exact: true })
  await inbox.waitFor()
  // Les tuiles « attend ta réponse » et « à relire » s'y sont fondues : rien n'est dit deux fois.
  assert.equal(await page.getByRole('link', { name: /attend ta réponse/i }).count(), 0)
  // Ce qui doit y être : les sessions qui te demandent quelque chose, les cartes feuilles
  // à relire, la PR prête — lourdes d'abord.
  const { prompts: open } = await (await context.request.get(`${base}/api/projects/${nimbus.id}/prompts`)).json()
  const waiting = conversations.filter(
    (entry) => ['awaiting_input', 'error', 'interrupted'].includes(entry.status) || open.some((prompt) => prompt.conversationId === entry.id),
  )
  const boardCards = await (await context.request.get(`${base}/api/projects/${nimbus.id}/cards`)).json()
  const toReview = boardCards.filter((card) => card.column === 'review' && card.children.length === 0)
  const lightCount = toReview.length + (withPr ? 1 : 0)
  const total = waiting.length + lightCount
  const header = inbox.getByRole('button', { name: /^Ce qui t’attend/ })
  assert.equal(
    (await header.innerText()).replace(/\s+/g, ' ').trim(),
    `Ce qui t’attend ${[`${waiting.length} demande${waiting.length > 1 ? 's' : ''}`, lightCount ? `${lightCount} à relire` : null].filter(Boolean).join(' · ')}`,
  )
  const lines = inbox.getByRole('listitem')
  assert.ok(total > 3, 'Le jeu d’essai met plus de trois lignes dans la liste de Nimbus')
  assert.equal(await lines.count(), 3, 'Trois lignes visibles')
  {
    await inbox.getByRole('button', { name: `${total - 3} de plus`, exact: true }).click()
    assert.equal(await lines.count(), total)
    // Les lourdes (un bouton qui déplie) avant les légères (un lien).
    const heavy = await lines.evaluateAll((items) => items.map((item) => item.querySelector('button[aria-expanded]') !== null))
    assert.deepEqual(heavy, [...heavy].sort((a, b) => Number(b) - Number(a)), 'Les lourdes avant les légères')
    assert.equal(heavy.filter(Boolean).length, waiting.length)
    await inbox.getByRole('button', { name: 'Montrer moins', exact: true }).click()
    assert.equal(await lines.count(), 3)
  }
  // Une session qui attend dit sa demande en gris, et se déplie au geste.
  const asked = open.find((prompt) => prompt.conversationId === awaiting.id)
  assert.ok(asked?.event.input.command, 'Le jeu d’essai fait attendre une permission')
  const awaitingLine = lines.filter({ hasText: awaiting.title })
  await awaitingLine.getByText(`Bash : ${asked.event.input.command}`, { exact: true }).waitFor()
  if (awaiting.milestone) {
    assert.equal(
      await awaitingLine.getByRole('link', { name: `Jalon #${awaiting.milestone.number}` }).getAttribute('href'),
      `/p/${nimbus.id}/timeline/${awaiting.milestone.number}`,
    )
  }
  await awaitingLine.getByRole('button', { name: 'Répondre', exact: true }).click()
  for (const name of ['Refuser', 'Autoriser pour la session', 'Autoriser', 'Fermer']) {
    await awaitingLine.getByRole('button', { name, exact: true }).waitFor()
  }
  assert.equal(await awaitingLine.getByRole('link', { name: 'Ouvrir le fil' }).getAttribute('href'), `/p/${nimbus.id}/c/${awaiting.id}`)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'a2-ce-qui-t-attend-deplie.png') })
  // Une seule réponse dépliée : ouvrir une session arrêtée referme la première.
  const stopped = waiting.find((entry) => ['error', 'interrupted'].includes(entry.status))
  assert.ok(stopped, 'Le jeu d’essai a une session arrêtée dans Nimbus')
  {
    if (!(await lines.filter({ hasText: stopped.title }).count())) await inbox.getByRole('button', { name: /de plus$/ }).click()
    const stoppedLine = lines.filter({ hasText: stopped.title })
    await stoppedLine.getByRole('button', { name: 'Voir', exact: true }).click()
    await stoppedLine.getByText('La session s’est arrêtée. Ouvre-la pour la relancer.').waitFor()
    assert.equal(await awaitingLine.getByRole('button', { name: 'Refuser', exact: true }).count(), 0, 'Une seule réponse dépliée')
    await stoppedLine.getByRole('button', { name: 'Fermer', exact: true }).click()
    if (await inbox.getByRole('button', { name: 'Montrer moins' }).count()) await inbox.getByRole('button', { name: 'Montrer moins' }).click()
  }
  // Replier la liste, puis la rouvrir de loin (`openInboxItem`, le repère d'un jalon) :
  // elle se déplie, montre tout s'il le faut et ouvre la ligne.
  await header.click()
  assert.equal(await header.getAttribute('aria-expanded'), 'false')
  assert.equal(await lines.count(), 0)
  const target = stopped
  await page.evaluate((key) => window.dispatchEvent(new CustomEvent('solera:inbox-open', { detail: key })), `s-${target.id}`)
  await lines.filter({ hasText: target.title }).getByRole('button', { name: 'Fermer', exact: true }).waitFor()
  assert.equal(await header.getAttribute('aria-expanded'), 'true')
  await lines.filter({ hasText: target.title }).getByRole('button', { name: 'Fermer', exact: true }).click()
  // La réponse part par la route du fil. Sans CLI derrière la demande, le serveur la dit
  // expirée et la ligne reste ouverte pour le dire.
  await awaitingLine.getByRole('button', { name: 'Répondre', exact: true }).click()
  const [refusal] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/api/conversations/${awaiting.id}/permissions/${asked.requestId}`)),
    awaitingLine.getByRole('button', { name: 'Refuser', exact: true }).click(),
  ])
  assert.deepEqual(refusal.request().postDataJSON(), { decision: 'denied', scope: 'once' })
  await awaitingLine.getByText('Cette demande a expiré, la session est terminée.').waitFor()
  // Une réponse acceptée referme la ligne.
  await page.route(`**/api/conversations/${awaiting.id}/permissions/*`, (route) => route.fulfill({ json: { ok: true } }))
  await awaitingLine.getByRole('button', { name: 'Autoriser', exact: true }).click()
  await awaitingLine.getByRole('button', { name: 'Répondre', exact: true }).waitFor()
  await page.unroute(`**/api/conversations/${awaiting.id}/permissions/*`)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'a1-apercu-en-ce-moment.png') })
  // Un projet où rien n'attend : une ligne calme, pas de bloc vide.
  const all = await (await context.request.get(`${base}/api/conversations`)).json()
  let calm = false
  for (const other of projects.filter((entry) => entry.id !== nimbus.id && !entry.archivedAt)) {
    const asking = all.some((entry) => entry.projectId === other.id && ['awaiting_input', 'error', 'interrupted'].includes(entry.status))
    const { prompts: pending } = await (await context.request.get(`${base}/api/projects/${other.id}/prompts`)).json()
    const reviewing = (await (await context.request.get(`${base}/api/projects/${other.id}/cards`)).json()).some((card) => card.column === 'review')
    if (asking || pending.length || reviewing) continue
    // Les PR simulées plus haut valent pour tous les projets : celui-ci n'en a pas.
    await page.route(`**/api/projects/${other.id}/pull-requests`, (route) =>
      route.fulfill({ json: { available: true, fetchedAt: Date.now(), pullRequests: [] } }),
    )
    await page.goto(`${base}/p/${other.id}`)
    await inbox.getByText('Rien ne t’attend.', { exact: true }).waitFor()
    assert.equal(await inbox.getByRole('listitem').count(), 0)
    calm = true
    break
  }
  assert.ok(calm, 'Le jeu d’essai a un projet où rien n’attend')
  await page.goto(`${base}/p/${nimbus.id}`)
  await row.waitFor()

  // ─── Travail (#175) : les anciennes adresses mènent à leur vue ──────────────
  await page.goto(`${base}/p/${nimbus.id}/activity?groupe=worktree`)
  await page.waitForURL(`**/p/${nimbus.id}/travail?vue=couloirs`)
  await page.goto(`${base}/p/${nimbus.id}/journal`)
  await page.waitForURL(`**/p/${nimbus.id}/travail?vue=fil`)

  // ─── La barre sur une ligne ────────────────────────────────────────────────
  const toolbar = page.locator('[data-toolbar]')
  const search = toolbar.getByRole('searchbox', { name: 'Chercher, #12, branche', exact: true })
  await search.waitFor()
  assert.equal(Math.round((await toolbar.boundingBox()).height), 48, 'Une seule ligne de 48 px')
  // Le bilan, neutre : les worktrees sans la racine.
  const treeCount = trees.worktrees.length
  await toolbar.getByText(new RegExp(`^${treeCount} arbres?`)).waitFor()
  assert.equal(await toolbar.getByRole('button', { name: new RegExp(`^${treeCount} arbre`) }).count(), 0, 'Le bilan ne se clique pas')

  // ─── La vue « Par moment » : Maintenant, puis les jours ─────────────────────
  await page.getByRole('heading', { name: 'Maintenant', exact: true }).waitFor()
  const runningRow = page.getByRole('link', { name: new RegExp(running.title) }).first()
  await runningRow.waitFor()
  const working = page.locator('section', { has: page.getByRole('heading', { name: /^En cours \d+$/ }) })
  await working.getByRole('link', { name: new RegExp(running.title) }).waitFor()
  await page.getByRole('region', { name: 'Ce qui t’attend', exact: true }).getByText(awaiting.title).first().waitFor()
  // Ce qui t'attend n'est pas redit sous « En cours ».
  assert.equal(await working.getByRole('link', { name: new RegExp(awaiting.title) }).count(), 0, 'La session qui attend vit dans la liste des demandes')
  // La ligne de base en tête, pleine largeur.
  await page.getByText('la racine y est', { exact: true }).waitFor()
  // L'historique, par jour.
  await page.getByRole('heading', { name: /^(Aujourd’hui|Hier|[a-zé]+ \d+ [a-zéû]+)$/ }).first().waitFor()
  const tree = trees.worktrees.find((entry) => entry.id === running.worktreeId)
  const branch = tree.branch ?? tree.name
  const short = branch.replace(/^(feat|fix|spike|chore|jalon)\//, '')
  // La puce d'arbre de la session qui tourne : un clic filtre le fil sur l'arbre.
  const chip = page.getByTitle(`Filtrer le fil sur ${branch}`, { exact: true }).first()
  await chip.waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 't1-travail-par-moment.png') })

  // ─── Les demandes des jalons (#255) : la liste de Travail les a aussi ──────
  // Les gestes sont tenus sur l'Aperçu (`places-ui-check`) : ici, les lignes et leur place.
  const asks = await installMilestoneAsks({ page, base, project: nimbus })
  await page.reload()
  const { inbox: travailInbox } = await assertMilestoneRows({ page, fakes: asks })
  await travailInbox.screenshot({ animations: 'disabled', path: join(shots, 't11-travail-demandes-des-jalons.png') })
  await asks.uninstall()
  assert.deepEqual(asks.sent, { answers: [], drafts: [], merges: [] })
  await page.reload()
  await page.getByRole('heading', { name: 'Maintenant', exact: true }).waitFor()

  // ─── Affichage ▾ : la vue dans l'adresse, retenue pour le projet ────────────
  await toolbar.getByRole('button', { name: 'Affichage : Par moment', exact: true }).click()
  await page.getByRole('radio', { name: 'Par arbre', exact: true }).click()
  await page.waitForURL(`**/p/${nimbus.id}/travail?vue=couloirs`)
  await page.getByRole('region', { name: new RegExp(`^${branch.replace(/[/.]/g, '\\$&')}`) }).waitFor()
  await page.keyboard.press('Escape')
  await page.goto(`${base}/p/${nimbus.id}/travail`)
  await toolbar.getByRole('button', { name: 'Affichage : Par arbre', exact: true }).waitFor()
  await page.goto(`${base}/p/${nimbus.id}/travail?vue=fil`)
  await page.getByRole('heading', { name: 'Maintenant', exact: true }).waitFor()

  // ─── + Session : la racine, les arbres utilisables, un nouveau worktree ─────
  await toolbar.getByRole('button', { name: 'Session', exact: true }).click()
  await page.getByRole('menuitem', { name: 'main (racine)', exact: true }).waitFor()
  await page.getByRole('menuitem', { name: 'Nouveau worktree…', exact: true }).waitFor()
  await page.getByRole('menuitem', { name: short, exact: true }).click()
  await page.waitForURL(`**/p/${nimbus.id}/c/new?worktree=${tree.id}`)
  await page.goto(`${base}/p/${nimbus.id}/travail?vue=fil`)
  await page.getByRole('heading', { name: 'Maintenant', exact: true }).waitFor()

  // ─── Filtrer ▾ et ses puces, retenus pour le projet ────────────────────────
  const filterButton = toolbar.getByRole('button', { name: /^Filtrer/ })
  await filterButton.click()
  const filterPanel = page.getByRole('dialog', { name: 'Filtrer', exact: true })
  await filterPanel.getByRole('checkbox', { name: 'Sessions', exact: true }).click()
  await filterPanel.getByRole('checkbox', { name: 'Travaille', exact: true }).click()
  await page.keyboard.press('Escape')
  const chips = toolbar.locator('[data-filter-chip]')
  assert.deepEqual(await chips.allInnerTexts(), ['Sessions', 'Travaille'])
  await filterButton.getByText('2', { exact: true }).waitFor()
  // Sessions seulement : plus d'historique ; Travaille : plus de demandes.
  await runningRow.waitFor()
  await page.getByText('Rien dans l’historique ne correspond.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: 'Ce qui t’attend', exact: true }).count(), 0)
  await page.reload()
  await chips.first().waitFor()
  assert.deepEqual(await chips.allInnerTexts(), ['Sessions', 'Travaille'], 'Les filtres sont retenus pour le projet')
  // Une puce s'efface par sa croix.
  await chips.filter({ hasText: 'Travaille' }).getByRole('button', { name: 'Retirer ce filtre' }).click()
  assert.deepEqual(await chips.allInnerTexts(), ['Sessions'])
  // La période de l'historique.
  await filterButton.click()
  await filterPanel.getByRole('radio', { name: '7 j', exact: true }).click()
  await page.keyboard.press('Escape')
  assert.deepEqual(await chips.allInnerTexts(), ['Sessions', '7 jours'])
  // Rien ne correspond : le cadre pointillé, et de quoi tout effacer.
  await filterButton.click()
  await filterPanel.getByRole('checkbox', { name: 'Fusionné', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByText('Rien ne correspond à ces filtres.', { exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 't2-rien-ne-correspond.png') })
  await page.getByRole('button', { name: 'Effacer les filtres', exact: true }).click()
  assert.equal(await chips.count(), 0)
  await runningRow.waitFor()

  // ─── L'index, en filtre : un arbre, puis tous ──────────────────────────────
  const index = page.getByRole('navigation', { name: 'Index des arbres', exact: true })
  await index.getByRole('button', { name: new RegExp(`^${short.replace(/[/.]/g, '\\$&')}`) }).click()
  await page.waitForURL((url) => url.searchParams.get('arbre') === tree.path)
  await chips.first().waitFor()
  assert.deepEqual((await chips.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')), [`Arbre : ${short}`])
  await runningRow.waitFor()
  assert.equal(await page.getByText('la racine y est', { exact: true }).count(), 0, 'La ligne de base se tait quand un arbre est choisi')
  await page.screenshot({ animations: 'disabled', path: join(shots, 't3-un-arbre-choisi.png') })
  await index.getByRole('button', { name: /^Tous/ }).click()
  await page.waitForURL((url) => !url.searchParams.has('arbre'))
  await chips.first().waitFor({ state: 'detached' })
  // La puce d'arbre d'une ligne fait la même chose, et se défait au second clic.
  await chip.click()
  await page.waitForURL((url) => url.searchParams.get('arbre') === tree.path)
  await chips.first().waitFor()
  assert.equal(await chip.getAttribute('aria-pressed'), 'true')
  await chip.click()
  await page.waitForURL((url) => !url.searchParams.has('arbre'))
  await chips.first().waitFor({ state: 'detached' })

  // ─── La recherche filtre le vivant et l'historique ─────────────────────────
  await search.fill('aucune session ne porte ce nom')
  await page.getByText('Aucune session vivante ne correspond.', { exact: true }).waitFor()
  await page.getByText('Rien dans l’historique ne correspond.', { exact: true }).waitFor()
  if (running.card) {
    await search.fill(`#${running.card.number}`)
    await runningRow.waitFor()
  }
  await search.fill('')

  // ─── Sombre ───────────────────────────────────────────────────────────────
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ animations: 'disabled', path: join(shots, 't4-travail-par-moment-sombre.png') })
  await page.evaluate(() => { delete document.documentElement.dataset.theme })

  // ─── Par arbre (#176) : un couloir par arbre, l'index qui fait défiler ─────
  await page.goto(`${base}/p/${nimbus.id}/travail?vue=couloirs`)
  const escaped = (text) => text.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&')
  const lane = page.getByRole('region', { name: branch, exact: true })
  await lane.waitFor()
  // Un couloir par worktree, et celui de la racine.
  for (const entry of trees.worktrees) {
    await page.getByRole('region', { name: entry.branch ?? entry.name, exact: true }).first().waitFor()
  }
  await page.getByRole('region', { name: 'main', exact: true }).waitFor()
  // Son corps : la session qui tourne, son fil.
  await lane.locator('[data-session-row]').filter({ hasText: running.title }).waitFor()
  // L'index défile au lieu de filtrer : l'adresse ne bouge pas, le couloir s'entoure d'accent.
  await index.getByRole('button', { name: /^Tous/ }).waitFor()
  await index.getByText('en haut', { exact: true }).waitFor()
  await index.getByRole('button', { name: new RegExp(`^${escaped(short)}`) }).click()
  await page.waitForFunction((name) => document.querySelector(`section[aria-label="${name}"]`)?.hasAttribute('data-highlight'), branch)
  assert.equal(new URL(page.url()).searchParams.has('arbre'), false, 'En Par arbre, l’index ne filtre pas')
  // Le couloir est à l'écran (il monte en haut quand la page est assez longue).
  await page.waitForFunction((name) => {
    const box = document.querySelector(`section[aria-label="${name}"]`)?.getBoundingClientRect()
    return box && box.top >= 0 && box.top < window.innerHeight - 40
  }, branch)
  await page.screenshot({ animations: 'disabled', path: join(shots, 't6-travail-par-arbre.png') })

  // ─── Le tiroir d'un arbre : l'en-tête du couloir l'ouvre ──────────────────
  await lane.getByRole('button', { name: branch, exact: true }).click()
  const drawer = page.getByRole('dialog', { name: `Arbre ${branch}`, exact: true })
  await drawer.waitFor()
  await drawer.getByText(tree.path, { exact: true }).waitFor()
  for (const label of ['PR', 'Sur la base', 'Non commités', 'Taille sur disque', 'Dernier usage', 'Chemin']) {
    await drawer.getByText(label, { exact: true }).first().waitFor()
  }
  await drawer.getByRole('button', { name: 'Session', exact: true }).waitFor()
  await drawer.getByRole('region', { name: 'Sessions', exact: true }).getByRole('link', { name: new RegExp(escaped(running.title)) }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 't7-tiroir-d-un-arbre.png') })
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'detached' })
  // Le menu ⋯ d'un couloir : ses gestes ; le fermer laisse la page en place.
  await lane.getByRole('button', { name: `Gestes sur ${branch}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Session', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog', { name: `Arbre ${branch}` }).count(), 0, 'Le menu n’ouvre pas le tiroir')

  // ─── Affichage ▾ : regrouper par jalon, cacher le couloir Projet ──────────
  await toolbar.getByRole('button', { name: 'Affichage : Par arbre', exact: true }).click()
  await page.getByRole('radio', { name: 'Par jalon', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('region', { name: /^(Jalon #\d+ · |Sans jalon$)/ }).first().waitFor()
  await page.reload()
  await page.getByRole('region', { name: /^(Jalon #\d+ · |Sans jalon$)/ }).first().waitFor()
  await toolbar.getByRole('button', { name: 'Affichage : Par arbre', exact: true }).click()
  await page.getByRole('radio', { name: 'Aucun', exact: true }).click()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('region', { name: 'Sans jalon', exact: true }).count(), 0)

  // ─── Un filtre « À nettoyer » déplie la section, et l'index la suit ───────
  await filterButton.click()
  await filterPanel.getByRole('checkbox', { name: 'À nettoyer', exact: true }).click()
  await page.keyboard.press('Escape')
  const cleanable = trees.worktrees.filter((entry) => entry.state === 'merged' && entry.modified + entry.untracked === 0)
  const mergedBranches = trees.branches.filter((entry) => entry.merged)
  if (cleanable.length > 0) {
    const cleanup = page.getByRole('region', { name: /arbres? fusionnés?$/ })
    assert.equal(await cleanup.getByRole('button', { expanded: true }).count(), 1, 'À nettoyer, déplié d’office')
  }
  if (mergedBranches.length > 0) {
    const merged = page.getByRole('region', { name: /branches? fusionnées?$/ })
    await merged.getByRole('button', { expanded: true }).waitFor()
    for (const entry of mergedBranches) await merged.getByText(entry.name, { exact: true }).waitFor()
  }
  if (cleanable.length + mergedBranches.length === 0) await page.getByText('Rien ne correspond à ces filtres.', { exact: true }).waitFor()
  else assert.equal(await lane.count(), 0, 'Un arbre au travail ne répond pas à « À nettoyer »')
  await page.screenshot({ animations: 'disabled', path: join(shots, 't10-par-arbre-a-nettoyer.png') })
  await chips.filter({ hasText: 'À nettoyer' }).getByRole('button', { name: 'Retirer ce filtre' }).click()
  await chips.first().waitFor({ state: 'detached' })

  // ─── La vue Graphe et le tiroir d'un commit (#178) ─────────────────────────
  const runningTree = trees.worktrees.find((entry) => entry.id === running.worktreeId)
  await checkTravailGraph({ page, base, project: nimbus, running, runningTree, runningBranch, shots })

  // ─── La vue Tableau et les gestes d'un arbre et d'une branche (#177) ───────
  await checkTravailTable({ page, base, project: nimbus, runningBranch, readyBranch: withPr ? branchOf(withPr) : null, shots })

  // ─── Au téléphone : une ligne, rien ne déborde, l'index se replie ───────────
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/p/${nimbus.id}/travail?vue=fil`)
  await page.getByRole('heading', { name: 'Maintenant', exact: true }).waitFor()
  assert.equal(Math.round((await toolbar.boundingBox()).height), 48, 'La barre tient sur une ligne au téléphone')
  assert.equal(await index.isVisible(), false, 'L’index se replie au téléphone')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Rien ne déborde à 390 px')
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 't5-travail-au-telephone.png') })
  // Par arbre au téléphone : les couloirs tiennent dans la largeur, le tiroir prend l'écran.
  await page.goto(`${base}/p/${nimbus.id}/travail?vue=couloirs`)
  await lane.waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Par arbre ne déborde pas à 390 px')
  await page.screenshot({ animations: 'disabled', path: join(shots, 't8-par-arbre-au-telephone.png') })
  await lane.getByRole('button', { name: branch, exact: true }).click()
  await page.getByRole('dialog', { name: `Arbre ${branch}`, exact: true }).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 't9-tiroir-au-telephone.png') })
  await page.keyboard.press('Escape')

  // ─── Jalons, au portefeuille aussi ─────────────────────────────────────────
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/projects`)
  await page.getByRole('navigation', { name: 'Vues du portefeuille', exact: true }).getByRole('link', { name: /^Jalons/ }).waitFor()

  // ─── Le jalon lancé (#116, planches C1, C2 et C3) ──────────────────────────
  // Sans jalon lancé, pas de bandeau dans « Maintenant ».
  await page.goto(`${base}/p/${nimbus.id}/travail?vue=fil`)
  await page.getByRole('heading', { name: 'Maintenant', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: /^Jalon #\d+ lancé/ }).count(), 0, 'Pas de bandeau sans jalon lancé')

  // Le pilotage est simulé : lancer pour de vrai demanderait une forge et des CLI. Le
  // jalon est la parente du jeu d'essai, et la session qui tourne porte une de ses cartes.
  const cards = await (await context.request.get(`${base}/api/projects/${nimbus.id}/cards`)).json()
  const parent = cards.find((card) => cards.some((child) => child.parent?.id === card.id))
  assert.ok(parent && running.card, 'Le jeu d’essai a un jalon, et la session qui tourne une carte')
  // Le jalon d'une session est la parente de sa carte, joint à la liste (#163).
  if (running.card && cards.find((card) => card.id === running.card.id)?.parent?.id === parent.id) {
    assert.deepEqual(running.milestone, { id: parent.id, number: parent.number, title: parent.title })
  }
  const children = cards.filter((card) => card.parent?.id === parent.id && card.id !== running.card.id)
  const runCard = (card, layer, status, extra = {}) => ({
    cardId: card.id, number: card.number, title: card.title, layer, status, blockReason: null, blockedBy: [],
    conversationId: null, conversationTitle: null, conversationStatus: null, worktreeName: null,
    agent: null, model: null, error: null, ...extra,
  })
  const [first, second, ...rest] = children
  assert.ok(first && second, 'Le jalon du jeu d’essai a au moins deux autres cartes')
  const blocker = { number: second.number, title: second.title, outside: false, abandoned: false }
  const milestoneRun = {
    id: 'run', cardId: parent.id, cardNumber: parent.number, cardTitle: parent.title, state: 'running', concurrency: 3,
    agent: 'claude', model: 'claude-opus-5-5', branch: 'jalon/demo', busy: 1, createdAt: Date.now() - 50 * 60_000, endedAt: null,
    cards: [
      runCard(running.card, 0, 'working', { conversationId: running.id }),
      runCard(first, 0, 'done'),
      // Au repos sans PR : bloquée pour le pilotage, mais rien n'est demandé à personne.
      runCard({ id: 'au-repos', number: 999, title: 'Au repos sans PR' }, 0, 'blocked', { blockReason: 'idle' }),
      runCard(second, 1, 'queued'),
      ...rest.map((card) => runCard(card, 2, 'waiting', { blockedBy: [blocker] })),
    ],
  }
  let pauses = 0
  await page.route('**/api/projects/*/milestones/active', (route) => route.fulfill({ json: [milestoneRun] }))
  await page.route(`**/api/cards/${parent.id}/milestone`, async (route) => {
    if (route.request().method() === 'PATCH') {
      assert.deepEqual(route.request().postDataJSON(), { state: 'paused' })
      pauses += 1
      return route.fulfill({ json: { ...milestoneRun, state: 'paused' } })
    }
    return route.fulfill({ json: milestoneRun })
  })

  // C1 : le bandeau ouvre « Maintenant », au-dessus des sessions du fil.
  await page.reload()
  const banner = page.getByRole('region', { name: `Jalon #${parent.number} lancé`, exact: true })
  await banner.waitFor()
  await banner.getByText('1/3 sessions occupées').waitFor()
  await banner.getByText(`1/${milestoneRun.cards.length} fusionnées`).waitFor()
  await banner.getByText(/^1 prête en file$/).waitFor()
  // Une session au repos sans PR n'a rien demandé : elle ne compte pas dans « te demande ».
  assert.equal(await banner.getByText(/te demande/).count(), 0)
  assert.ok((await banner.boundingBox()).y < (await runningRow.boundingBox()).y, 'Le bandeau vient avant les sessions au travail')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'c1-jalon-en-tete-du-fil.png') })

  // C2 : la page du jalon (#194) — lancé, ses cartes en vagues, le pilotage à côté.
  await banner.getByRole('link', { name: 'Voir le jalon' }).click()
  await page.waitForURL(`**/p/${nimbus.id}/timeline/${parent.number}`)
  await page.getByRole('region', { name: 'Prochaine action' }).waitFor()
  await page.getByRole('heading', { name: `#${parent.number} ${parent.title}` }).waitFor()
  const waves = page.getByRole('region', { name: 'Vagues' })
  for (const card of [first, second]) await waves.getByRole('link', { name: new RegExp(`#${card.number} `) }).waitFor()
  assert.equal(await row.getByRole('link', { name: /^Jalons/ }).getAttribute('aria-current'), 'page', 'La page vit sous l’onglet Jalons')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'c2-la-vue-du-jalon.png') })
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('button', { name: 'Reprendre' }).waitFor()
  assert.equal(pauses, 1)
  // Une carte sans enfant n'est pas un jalon : la vue ne promet pas de la lancer.
  await page.goto(`${base}/p/${nimbus.id}/timeline/${running.card.number}`)
  await page.getByText(`#${running.card.number} n’est pas un jalon`).waitFor()

  // C3 : la ligne du jalon dans la frise, qui mène à sa vue.
  await page.goto(`${base}/p/${nimbus.id}/timeline`)
  const launchedHead = page.getByRole('button', { name: new RegExp(`#${parent.number} .*lancé`) })
  await launchedHead.waitFor()
  await launchedHead.getByText(/^1 session · /).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'c3-le-jalon-dans-la-frise.png') })
  await launchedHead.click()
  await page.waitForURL(`**/p/${nimbus.id}/timeline/${parent.number}`)

  assert.deepEqual(errors, [])
  console.log('OK : rangée, compteur de demandes, ce qui t’attend, Travail (redirections, barre, Par moment, ?vue=, filtres et puces retenus, rien ne correspond, index, puce d’arbre, recherche, téléphone), Par arbre (couloirs, index qui défile, tiroir, regroupement, à nettoyer, téléphone), Graphe et tiroir d’un commit, Tableau et gestes, jalon lancé ; captures dans ' + shots)
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
