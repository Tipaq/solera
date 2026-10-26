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
 * L'onglet Activité d'un projet (carte #110, planches B1, B4 et E1 de
 * `docs/audits/2026-10-21-page-projet/final/`).
 *
 * Ce que la suite tient : la rangée à six vues, le compteur ambre qui ne compte que ce
 * qui réclame, l'ordre des groupes, la branche de chaque session lue dans la liste
 * d'état des worktrees, le filtre `s:` et `#N`, le pliage des terminées, et la ligne à
 * deux étages au téléphone, et la demande dépliée sous sa ligne (#112). Elle écrit ses captures dans `portage/`, à côté du dessin.
 *
 * Le badge de PR (#115) : le projet de démo n'a pas de forge, la liste des PR est donc
 * simulée au niveau de la page. La suite tient qu'une PR ouverte fait passer une session
 * finie dans « Prête à relire », que le badge porte `#N` et son mot, et qu'une session
 * de la racine n'en porte pas.
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

  // ─── La rangée : six vues, Activité en deuxième, Jalons à la place de Chronologie ──
  await page.goto(`${base}/p/${nimbus.id}`)
  const row = page.getByRole('navigation', { name: 'Vues du projet', exact: true })
  await row.waitFor()
  const labels = (await row.getByRole('link').allInnerTexts()).map((text) => text.replace(/\s*\d+$/, '').trim())
  assert.deepEqual(labels, ['Aperçu', 'Activité', 'Board', 'Planifiées', 'Jalons', 'Journal'])
  // Le compteur de l'onglet est ce qui te demande quelque chose, pas l'inventaire.
  const asking = conversations.filter((entry) => ['awaiting_input', 'error', 'interrupted'].includes(entry.status)).length
  assert.match(await row.getByRole('link', { name: /^Activité/ }).innerText(), new RegExp(`${asking}$`))

  // ─── L'Aperçu : « En ce moment » sous les tuiles (#114, planche A1) ─────────
  const now = page.getByRole('region', { name: 'En ce moment', exact: true })
  await now.waitFor()
  const nowRows = now.getByRole('listitem')
  // Ce qui te demande quelque chose passe d'abord, et les terminées n'y sont pas.
  await nowRows.first().getByText(/^(Attend |Interrompue|En erreur)/).waitFor()
  await now.getByRole('link', { name: new RegExp(running.title) }).waitFor()
  const finished = conversations.filter((entry) => entry.status === 'idle' && !entry.card && entry.id !== withPr?.id)
  for (const entry of finished) {
    assert.equal(await now.getByRole('link', { name: entry.title, exact: true }).count(), 0, `${entry.title} est finie : elle reste à l’onglet`)
  }
  // Le bloc vient après les tuiles.
  const tileTop = (await page.getByRole('link', { name: /attend ta réponse/i }).boundingBox()).y
  assert.ok((await now.boundingBox()).y > tileTop, 'Le bloc vient sous les tuiles')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'a1-apercu-en-ce-moment.png') })
  await now.getByRole('link', { name: /^Toute l'activité/ }).click()
  await page.waitForURL(`**/p/${nimbus.id}/activity`)
  await page.goto(`${base}/p/${nimbus.id}`)
  await row.waitFor()

  // ─── Les groupes, dans l'ordre ─────────────────────────────────────────────
  await row.getByRole('link', { name: /^Activité/ }).click()
  await page.waitForURL(`**/p/${nimbus.id}/activity`)
  const headings = page.getByRole('heading', { level: 2 })
  await headings.first().waitFor()
  const order = ['Te demande quelque chose', 'Prête à relire', 'En cours', 'Terminées']
  const shown = (await headings.allInnerTexts()).map((text) => text.replace(/\s*\d+$/, '').trim())
  assert.deepEqual(shown, order.filter((label) => shown.includes(label)), 'Les groupes suivent l’ordre arrêté')

  const section = (name) => page.getByRole('region', { name: new RegExp(`^${name}`) })
  // Une session qui te demande quelque chose se déplie au lieu de mener au fil (#112).
  const awaitingRow = section('Te demande quelque chose').getByRole('button', { name: new RegExp(awaiting.title) })
  await awaitingRow.waitFor()
  const runningRow = section('En cours').getByRole('link', { name: new RegExp(running.title) })
  await runningRow.waitFor()
  // La branche vient de la liste d'état des worktrees, sans lecture par fil.
  const tree = trees.worktrees.find((entry) => entry.id === running.worktreeId)
  await runningRow.getByText(tree.branch ?? tree.name, { exact: true }).waitFor()
  // Une session de la racine dit « racine · branche ».
  await page.getByText(/^racine · /).first().waitFor()
  // La ligne qui attend dit depuis quand, en ambre.
  await section('Te demande quelque chose').getByText(/^Attend /).first().waitFor()

  // ─── Le badge de PR (#115) ─────────────────────────────────────────────────
  // Une PR en checks ne sort pas la session de « En cours » : elle travaille encore.
  await runningRow.getByText('#18', { exact: true }).filter({ visible: true }).waitFor()
  await runningRow.getByText('checks…', { exact: true }).filter({ visible: true }).waitFor()
  if (withPr) {
    const reviewRow = section('Prête à relire').getByRole('link', { name: new RegExp(withPr.title) })
    await reviewRow.getByText('#17', { exact: true }).filter({ visible: true }).waitFor()
    await reviewRow.getByText('prête', { exact: true }).filter({ visible: true }).waitFor()
  }
  // La racine ne porte pas de PR : c'est elle que les PR visent.
  const rootRow = page.getByRole('link').filter({ hasText: /racine · / }).first()
  assert.equal(await rootRow.getByText(/^#\d+$/).count(), 0, 'Une session de la racine n’a pas de badge')

  // ─── La demande dépliée sous sa ligne (#112, planche B2) ────────────────────
  // La quatrième colonne dit la demande elle-même, lue dans le journal.
  const { prompts } = await (await context.request.get(`${base}/api/projects/${nimbus.id}/prompts`)).json()
  const prompt = prompts.find((entry) => entry.conversationId === awaiting.id)
  assert.equal(prompt?.kind, 'permission', 'Le jeu d’essai fait attendre une permission')
  const command = prompt.event.input.command
  await awaitingRow.getByText(new RegExp(`^Attend .+ · Bash : ${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)).waitFor()
  assert.equal(await awaitingRow.getAttribute('aria-expanded'), 'false')
  await awaitingRow.click()
  assert.equal(await awaitingRow.getAttribute('aria-expanded'), 'true')
  const preview = section('Te demande quelque chose').getByRole('listitem').filter({ has: page.getByRole('button', { name: new RegExp(awaiting.title) }) })
  await preview.getByText('Permission demandée', { exact: true }).waitFor()
  await preview.getByText(command, { exact: true }).waitFor()
  for (const name of ['Refuser', 'Autoriser pour la session', 'Autoriser']) {
    await preview.getByRole('button', { name, exact: true }).waitFor()
  }
  assert.equal(
    await preview.getByRole('link', { name: 'Ouvrir le fil' }).getAttribute('href'),
    `/p/${nimbus.id}/c/${awaiting.id}`,
  )
  await page.screenshot({ animations: 'disabled', path: join(shots, 'b2-demande-depliee.png') })
  // La réponse part par la route du fil. Le jeu d'essai n'a pas de CLI derrière la
  // demande : le serveur la dit expirée, et l'aperçu le montre au lieu d'attendre.
  const [decision] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/api/conversations/${awaiting.id}/permissions/${prompt.requestId}`)),
    preview.getByRole('button', { name: 'Refuser', exact: true }).click(),
  ])
  assert.deepEqual(decision.request().postDataJSON(), { decision: 'denied', scope: 'once' })
  await preview.getByText('Cette demande a expiré, la session est terminée.').waitFor()
  // ↑ et ↓ passent d'une ligne à l'autre sans refermer l'aperçu ; Espace le replie.
  await awaitingRow.focus()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-session-row')), true)
  assert.notEqual(await page.evaluate(() => document.activeElement?.textContent), await awaitingRow.textContent())
  assert.equal(await awaitingRow.getAttribute('aria-expanded'), 'true')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Space')
  assert.equal(await awaitingRow.getAttribute('aria-expanded'), 'false')

  // Les terminées se plient après trois lignes.
  const done = section('Terminées')
  if (await done.count()) {
    const total = Number((await done.getByRole('heading').innerText()).match(/(\d+)$/)[1])
    if (total > 3) {
      assert.equal(await done.getByRole('listitem').count(), 4, 'Trois lignes et « … N de plus »')
      await done.getByRole('button', { name: `… ${total - 3} de plus` }).click()
      assert.equal(await done.getByRole('listitem').count(), total)
    }
  }
  await page.screenshot({ animations: 'disabled', path: join(shots, 'b1-activite-par-etat.png') })

  // ─── Le filtre ────────────────────────────────────────────────────────────
  const filter = page.getByRole('searchbox', { name: 'Filtrer les sessions' })
  await filter.fill('s:cours')
  await runningRow.waitFor()
  assert.equal(await section('Te demande quelque chose').count(), 0, 's:cours ne garde que ce qui tourne')
  await filter.fill('s:attend')
  await section('Te demande quelque chose').waitFor()
  assert.equal(await section('En cours').count(), 0)
  if (running.card) {
    await filter.fill(`#${running.card.number}`)
    await runningRow.waitFor()
    assert.equal(await section('Te demande quelque chose').count(), awaiting.card?.number === running.card.number ? 1 : 0)
  }
  await filter.fill('aucune session ne porte ce nom')
  await page.getByText('Aucune session ne correspond à ce filtre').waitFor()
  await filter.fill('')

  // Plier un groupe.
  await page.getByRole('button', { name: /^Terminées/ }).click()
  assert.equal(await section('Terminées').getByRole('listitem').count(), 0)
  await page.getByRole('button', { name: /^Terminées/ }).click()

  // ─── Grouper par worktree (#111, planche B3) ────────────────────────────────
  await page.getByRole('radio', { name: 'Worktree', exact: true }).click()
  await page.waitForURL(`**/p/${nimbus.id}/activity?groupe=worktree`)
  const treeGroup = page.getByRole('region', { name: new RegExp(`^${(tree.branch ?? tree.name).replace(/[/.]/g, '\\$&')}`) })
  const treeRow = treeGroup.getByRole('link', { name: new RegExp(running.title) })
  await treeRow.waitFor()
  // L'en-tête porte la branche : la ligne ne la répète pas.
  assert.equal(await treeRow.getByText(tree.branch ?? tree.name, { exact: true }).count(), 0, 'La ligne perd sa colonne branche')
  // Le badge de PR passe dans l'en-tête (#115) : la ligne ne le porte plus.
  await treeGroup.getByText('#18', { exact: true }).filter({ visible: true }).waitFor()
  assert.equal(await treeRow.getByText('#18', { exact: true }).count(), 0, 'La ligne perd son badge de PR')
  await page.getByRole('region', { name: /^main racine du projet/ }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'b3-activite-par-worktree.png') })
  await page.getByRole('radio', { name: 'État', exact: true }).click()
  await page.waitForURL(`**/p/${nimbus.id}/activity`)
  await section('En cours').waitFor()

  // ─── Sombre ───────────────────────────────────────────────────────────────
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'b1-activite-par-etat-sombre.png') })

  // ─── Au téléphone : deux étages, la carte tombe ────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/p/${nimbus.id}/activity`)
  await headings.first().waitFor()
  assert.equal(await filter.isVisible(), false, 'Au téléphone, la barre ne garde que les compteurs (E1)')
  if (running.card) {
    assert.equal(await runningRow.getByText(`#${running.card.number}`, { exact: true }).isVisible(), false, 'La carte tombe au téléphone')
  }
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'e1-activite-au-telephone.png') })

  // ─── Jalons, au portefeuille aussi ─────────────────────────────────────────
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/projects`)
  await page.getByRole('navigation', { name: 'Vues du portefeuille', exact: true }).getByRole('link', { name: /^Jalons/ }).waitFor()

  assert.deepEqual(errors, [])
  console.log('OK : six vues, compteur de demandes, groupes dans l’ordre, branche par session, badge de PR, demande dépliée, filtre, pliage, téléphone ; captures dans ' + shots)
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
