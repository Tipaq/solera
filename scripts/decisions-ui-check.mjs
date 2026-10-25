import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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

// Les décisions de bout en bout, avec les vrais composants et la vraie API, dans une base
// temporaire : une session accordée dépose une décision par la même file que le serveur
// MCP, le toast et la section « À décider » apparaissent sans recharger, on répond dans
// le dialogue, la réponse part en message, l'historique et le fil la gardent. Un
// rangement de cartes en attente rejoint la section et mène à sa conversation. Aucun CLI
// ne tourne : la remise de la réponse échoue sans conséquence.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const Database = createRequire(join(serverDir, 'package.json'))('better-sqlite3')
const data = await mkdtemp(join(tmpdir(), 'solera-decisions-check-'))
const shots = join(root, 'docs/audits/2026-10-22-decisions')
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

  // Une session accordée, rattachée à une carte : la question et la réponse s'y
  // inscrivent aussi en note.
  const db = new Database(join(data, 'data', 'solera.db'))
  const project = db.prepare("SELECT id, owner_id AS ownerId FROM projects WHERE name = 'Nimbus'").get()
  const card = db.prepare('SELECT id FROM cards WHERE project_id = ? AND number = 2').get(project.id)
  const now = Date.now()
  const session = randomUUID()
  const sessionConfig = {
    agent: 'codex', model: '', reasoningEffort: '', askForApproval: 'on-request', sandbox: 'workspace-write',
    decisions: true, decisionMaxHours: 24,
  }
  db.prepare(
    `INSERT INTO conversations (id, project_id, user_id, title, agent, config, status, card_id, created_at, updated_at)
     VALUES (?, ?, ?, 'Veille des dépendances', 'codex', ?, 'idle', ?, ?, ?)`,
  ).run(session, project.id, project.ownerId, JSON.stringify(sessionConfig), card.id, now, now)
  const ask = (payload) => {
    const id = randomUUID()
    db.prepare("INSERT INTO agent_requests (id, project_id, conversation_id, kind, payload, created_at) VALUES (?, ?, ?, 'request_decision', ?, ?)")
      .run(id, project.id, session, JSON.stringify(payload), Date.now())
    return id
  }

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
  await page.goto(`${base}/p/${project.id}/board`)
  await page.getByRole('group', { name: 'Suivi des conversations', exact: true }).waitFor()
  const section = page.getByRole('region', { name: 'À décider' })
  assert.equal(await section.count(), 0, 'Pas de section tant que rien n’attend')

  // La session demande : le toast et la section apparaissent, sans recharger.
  const first = ask({
    question: 'Monter vite en 7.0 maintenant ?',
    context: '**Vite 7.0** est sorti hier. Les tests passent sur la branche `chore/vite-7`, mais deux plugins affichent des avertissements de dépréciation.\n\n- Diff : 4 fichiers',
    options: ['Oui, fusionner', 'Attendre la 7.0.1', 'Non'],
    default: 'Attendre la 7.0.1',
  })
  const toasts = page.getByRole('region', { name: 'Notifications' })
  await toasts.getByText('Monter vite en 7.0 maintenant ?').waitFor({ timeout: 15000 })
  await section.getByText('Monter vite en 7.0 maintenant ?').waitFor()
  await page.waitForTimeout(300)
  await toasts.screenshot({ path: join(shots, 'decisions-toast.png') })
  await section.screenshot({ path: join(shots, 'decisions-section.png') })

  // Le dialogue : contexte, choix, précision, envoi.
  await toasts.getByRole('button', { name: 'Répondre' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Vite 7.0', { exact: false }).first().waitFor()
  await dialog.getByRole('radio', { name: /Attendre la 7\.0\.1/ }).waitFor()
  assert.equal(await toasts.count(), 0, 'Ouvrir la décision depuis le toast le traite')
  await dialog.getByRole('radio', { name: /Oui, fusionner/ }).click()
  await dialog.getByLabel(/Précision pour l'agent/).fill('Vérifie d’abord les avertissements des deux plugins.')
  await page.waitForTimeout(200)
  await dialog.screenshot({ path: join(shots, 'decisions-dialog.png') })
  await dialog.getByRole('button', { name: 'Envoyer' }).click()
  await dialog.getByText('Répondu par Alex').waitFor()
  await dialog.screenshot({ path: join(shots, 'decisions-answered.png') })
  await page.keyboard.press('Escape')
  await section.waitFor({ state: 'detached' })

  const stored = db.prepare('SELECT answer, accepted_at AS acceptedAt, resolved_at AS resolvedAt FROM agent_requests WHERE id = ?').get(first)
  assert.deepEqual(JSON.parse(stored.answer), {
    by: 'user', userId: project.ownerId, option: 'Oui, fusionner', text: 'Vérifie d’abord les avertissements des deux plugins.',
  })
  assert.ok(stored.acceptedAt && stored.resolvedAt)
  const reply = db.prepare("SELECT body FROM session_messages WHERE to_conversation_id = ? AND kind = 'decision'").get(session)
  assert.match(reply.body, /Réponse : « Oui, fusionner »/)
  const notes = db.prepare('SELECT body FROM card_notes WHERE card_id = ? AND conversation_id = ? ORDER BY created_at').all(card.id, session)
  assert.equal(notes.length, 2)

  // Un rangement de cartes en attente, puis une seconde décision : la section porte les
  // deux, et le rangement mène à la conversation où se trouve son bouton.
  const mover = db.prepare("SELECT id, title FROM conversations WHERE project_id = ? AND id != ? AND archived_at IS NULL LIMIT 1").get(project.id, session)
  db.prepare(
    `INSERT INTO agent_requests (id, project_id, conversation_id, kind, payload, created_at, settled_at, result, is_error)
     VALUES (?, ?, ?, 'request_card_change', ?, ?, ?, 'Demande déposée.', 0)`,
  ).run(randomUUID(), project.id, mover.id, JSON.stringify({ changes: [{ card: 1, column: 'done', reason: 'Livrée.' }] }), Date.now(), Date.now())
  ask({ question: 'Fermer l’issue #18 comme doublon de #12 ?', options: ['Oui', 'Non'] })
  await section.getByText('Fermer l’issue #18', { exact: false }).waitFor({ timeout: 15000 })
  await section.getByText(mover.title).waitFor()
  await page.waitForTimeout(300)
  await section.screenshot({ path: join(shots, 'decisions-section-mixed.png') })
  await section.getByRole('link', { name: new RegExp(mover.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
  await page.waitForURL(`**/c/${mover.id}`)

  // Le fil de la session demandeuse : la question et son issue, à leur place.
  await page.goto(`${base}/p/${project.id}/c/${session}`)
  const asked = page.getByText('Monter vite en 7.0 maintenant ?').first()
  await asked.waitFor()
  await page.getByText('Fermer l’issue #18', { exact: false }).first().waitFor()
  await page.waitForTimeout(300)
  await page.getByRole('main').screenshot({ path: join(shots, 'decisions-thread.png') })

  // L'historique.
  await page.goto(`${base}/decisions`)
  await page.getByRole('tab', { name: 'Toutes' }).click()
  await page.getByRole('main').getByText('Monter vite en 7.0 maintenant ?').waitFor()
  await page.waitForTimeout(300)
  await page.getByRole('main').screenshot({ path: join(shots, 'decisions-history.png') })

  // La sorte « Décisions » se coupe dans les réglages, comme les autres.
  // Les réglages sont une modale : l'ancienne adresse l'ouvre sur la bonne section.
  await page.goto(`${base}/settings/notifications`)
  const settingsDialog = page.getByRole('dialog', { name: 'Réglages', exact: true })
  await settingsDialog.waitFor()
  await settingsDialog.getByRole('switch', { name: 'Décisions' }).click()
  await expectSetting(context, base, (settings) => settings.notifications.decision === false)

  // Au téléphone : la décision en feuille.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR',
    serviceWorkers: 'block', storageState: await context.storageState(),
  })
  await phone.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  const mobile = await phone.newPage()
  mobile.on('pageerror', (error) => errors.push(error.message))
  await mobile.goto(`${base}/decisions`)
  await mobile.getByRole('main').getByText('Fermer l’issue #18', { exact: false }).click()
  await mobile.getByRole('dialog').getByRole('radio', { name: 'Oui' }).waitFor()
  await mobile.waitForTimeout(300)
  await mobile.screenshot({ path: join(shots, 'decisions-phone-dialog.png') })
  await phone.close()

  db.close()
  assert.deepEqual(errors, [])
  console.log(`Décisions : parcours complet vérifié. Captures dans ${shots}`)
} finally {
  await browser?.close()
  for (const child of processes) child.kill('SIGTERM')
  await rm(data, { recursive: true, force: true })
}

async function expectSetting(context, base, predicate) {
  for (let i = 0; i < 50; i++) {
    const settings = await (await context.request.get(`${base}/api/me/settings`)).json()
    if (predicate(settings)) return
    await delay(100)
  }
  throw new Error('Le réglage n’a pas été enregistré')
}
