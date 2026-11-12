import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

// Le découpage en cartes (#70) de bout en bout, avec les vrais composants et la vraie
// API, dans une base temporaire : l'entrée du board ouvre le brouillon de conversation
// en mode « découper », une session de découpage dépose un brouillon par la même file
// que le serveur MCP, le bloc apparaît dans le fil et dans l'Activité de la colonne, on
// le corrige (renommer, retirer une carte, retirer un lien), et « Créer » pose les cartes
// sur le board. Aucun CLI ne tourne : le message rendu à la session reste en file.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const Database = createRequire(join(serverDir, 'package.json'))('better-sqlite3')
const data = await mkdtemp(join(tmpdir(), 'solera-card-draft-check-'))
const shots = join(root, 'docs/audits/2026-10-25-card-draft')
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
  await mkdir(shots, { recursive: true })
  const apiPort = await freePort()
  const webPort = await freePort()
  const config = join(data, 'config.toml')
  await writeFile(config, '[agents.claude]\nenabled = false\n[agents.codex]\nenabled = false\n[agents.opencode]\nenabled = false\n')
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

  const db = new Database(join(data, 'data', 'solera.db'))
  const project = db.prepare("SELECT id, owner_id AS ownerId FROM projects WHERE name = 'Nimbus'").get()
  const neighbour = db.prepare('SELECT number, title FROM cards WHERE project_id = ? AND number = 2').get(project.id)

  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript((origin) => {
    if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  // Le brouillon en mode « découper » : à la racine, sans arbre. Ses entrées ont quitté la
  // rangée du board (#160), puis la palette et la fiche d'une carte (#180) : le découpage
  // passe par « idée : » et la page d'un jalon, l'adresse reste.
  await page.goto(`${base}/p/${project.id}/c/new?split=new`)
  await page.getByText('Découper en cartes', { exact: true }).first().waitFor()
  assert.equal(new URL(page.url()).searchParams.get('split'), 'new')
  await page.getByText(/Dicte en vrac/).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'split-draft-page.png') })

  // L'affinage d'un jalon (#195) : la page du jalon ouvre ce brouillon sur la carte, son
  // premier message pré-rempli par `?prompt=` (l'appel du skill, puis le brief).
  const milestoneCard = db.prepare('SELECT id, number FROM cards WHERE project_id = ? ORDER BY number LIMIT 1').get(project.id)
  const brief = `/affiner-un-jalon #${milestoneCard.number} --decouper\n\nLe brief du jalon, pré-rempli.`
  await page.goto(`${base}/p/${project.id}/c/new?split=${milestoneCard.id}&mode=direct&prompt=${encodeURIComponent(brief)}`)
  // Aucun CLI n'est activé : le composer est grisé, mais son texte est là.
  await page.waitForFunction((text) => [...document.querySelectorAll('textarea')].some((field) => field.value === text), brief)

  // La session de découpage, créée par la route (sans premier message, aucun CLI ne
  // tourne), puis son brouillon, déposé par la même file que le serveur MCP.
  // La ligne écrite à la main : la route créerait la conversation en résolvant les
  // défauts du CLI, qu'aucun CLI activé ne donne ici. La configuration est celle du
  // protocole, pour que le fil se lise comme un vrai.
  const sessionConfig = execFileSync(
    process.execPath,
    ['--import', 'tsx', '-e', "import('@solera/protocol').then((m) => process.stdout.write(JSON.stringify(m.DEFAULT_CLAUDE_CONFIG)))"],
    { cwd: serverDir },
  ).toString()
  const session = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO conversations (id, project_id, user_id, title, agent, config, status, purpose, created_at, updated_at)
     VALUES (?, ?, ?, 'Découper : le mode hors ligne', 'claude', ?, 'idle', 'split', ?, ?)`,
  ).run(session, project.id, project.ownerId, sessionConfig, now, now)
  db.prepare("INSERT INTO agent_requests (id, project_id, conversation_id, kind, payload, created_at) VALUES (?, ?, ?, 'propose_cards', ?, ?)")
    .run(randomUUID(), project.id, session, JSON.stringify({
      milestone: { title: 'Le mode hors ligne', description: 'Ouvrir l’application sans réseau, et rattraper en revenant.' },
      cards: [
        { key: 'cache', title: 'Mettre les prévisions en cache', description: 'Le service worker garde les sept derniers jours.', subtasks: ['La stratégie de cache', 'La purge'], related: [neighbour.number] },
        { key: 'banner', title: 'Le bandeau hors ligne', after: ['cache'] },
        { key: 'sync', title: 'Rattraper au retour du réseau', after: ['cache'] },
        { key: 'doc', title: 'Une page de doc de trop', after: ['banner'] },
      ],
    }), Date.now())

  for (let i = 0; i < 50 && !db.prepare("SELECT settled_at FROM agent_requests WHERE kind = 'propose_cards'").get()?.settled_at; i++) await delay(100)
  const deposit = db.prepare("SELECT is_error AS isError, result FROM agent_requests WHERE kind = 'propose_cards'").get()
  assert.equal(deposit.isError, 0, deposit.result)
  await page.goto(`${base}/p/${project.id}/c/${session}`)
  const block = page.getByRole('region', { name: 'Brouillon de cartes', exact: true })
  await block.getByText('Brouillon : 4 carte(s) à créer').waitFor({ timeout: 15000 })
  // « À décider » a laissé sa place à l'Activité de la colonne (#121). À cette hauteur
  // elle se replie en son en-tête (#234), dont le badge signale l'attente sans un clic ;
  // la demande se lit dans la modale qu'il ouvre.
  const header = page.getByRole('group', { name: 'Suivi des conversations', exact: true }).getByRole('button', { name: /^Activité/ })
  await header.getByText(/^\d+ pour toi$/).waitFor({ state: 'attached' })
  await header.click()
  const overview = page.getByRole('dialog', { name: 'Activité globale', exact: true })
  await overview.getByText('4 cartes à créer', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await overview.waitFor({ state: 'hidden' })
  await block.scrollIntoViewIfNeeded()
  await block.screenshot({ animations: 'disabled', path: join(shots, 'card-draft-pending.png') })

  // Corriger : renommer, retirer une carte (et le lien qui la citait), retirer un lien.
  await block.getByRole('textbox', { name: 'Titre de la carte 2', exact: true }).fill('Un bandeau quand le réseau manque')
  const rows = block.locator('ol > li')
  await rows.nth(3).getByRole('button', { name: 'Retirer cette carte du brouillon', exact: true }).click()
  assert.equal(await rows.count(), 3)
  await rows.nth(2).getByRole('button', { name: /^Retirer le lien/ }).click()
  await rows.nth(0).getByRole('button', { name: 'Voir la description', exact: true }).click()
  await block.getByRole('textbox', { name: 'Sous-tâches', exact: true }).waitFor()
  await block.screenshot({ animations: 'disabled', path: join(shots, 'card-draft-edited.png') })

  await block.getByRole('button', { name: 'Créer le jalon et 3 carte(s)', exact: true }).click()
  await block.getByText('Créé', { exact: true }).waitFor({ timeout: 10000 })
  // Le bloc montre ce qui a été créé, corrections comprises, et non le brouillon d'origine.
  await block.getByText('Brouillon de 3 carte(s)').waitFor()
  assert.equal(await block.getByText('Une page de doc de trop').count(), 0)
  await block.screenshot({ animations: 'disabled', path: join(shots, 'card-draft-created.png') })

  const cards = await (await context.request.get(`${base}/api/projects/${project.id}/cards`)).json()
  const milestone = cards.find((card) => card.title === 'Le mode hors ligne')
  assert.ok(milestone, 'le jalon est créé')
  const children = cards.filter((card) => card.parent?.id === milestone.id).map((card) => card.title).sort()
  assert.deepEqual(children, ['Mettre les prévisions en cache', 'Rattraper au retour du réseau', 'Un bandeau quand le réseau manque'].sort())
  assert.ok(!cards.some((card) => card.title === 'Une page de doc de trop'), 'la carte retirée n’est pas créée')
  const blocks = db.prepare(
    `SELECT s.title AS source, t.title AS target FROM card_blocks b JOIN cards s ON s.id = b.source_id JOIN cards t ON t.id = b.target_id
     WHERE s.project_id = ?`,
  ).all(project.id).filter((row) => row.target !== row.source && [row.source, row.target].some((title) => children.includes(title)))
  assert.deepEqual(blocks.map((row) => `${row.source} → ${row.target}`), ['Mettre les prévisions en cache → Un bandeau quand le réseau manque'])
  const message = db.prepare("SELECT body FROM session_messages WHERE to_conversation_id = ? AND kind = 'cards'").get(session)
  assert.match(message?.body ?? '', /Mettre les prévisions en cache/)

  db.close()
  assert.deepEqual(errors, [])
  console.log(`Découpage en cartes : entrée du board, brouillon corrigé puis créé. Captures dans ${shots}`)
} finally {
  await browser?.close()
  for (const child of processes) child.kill('SIGTERM')
  await rm(data, { recursive: true, force: true })
}
