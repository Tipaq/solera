import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// Vrais composants, vraie API et vrai CLI Claude, dans une base temporaire : la tâche
// créée ici tire pour de bon, à la minute. Compter deux tours très courts de quota.
// Les captures vont dans SCHEDULE_SHOTS, ou dans un dossier temporaire annoncé à la fin.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-schedule-check-'))
const shots = process.env.SCHEDULE_SHOTS ?? (await mkdtemp(join(tmpdir(), 'solera-schedule-shots-')))
const processes = []
let browser

async function freePort() {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return port
}

/**
 * Le dossier où le Solera du poste a installé ses CLI agents.
 *
 * La suite donne au serveur un `SOLERA_DATA_DIR` jetable, et ce préfixe suit le dossier
 * de données : un CLI installé depuis l'interface devient alors introuvable, et le tir
 * meurt à la naissance sur « native binary not found at claude ». On rend donc le `bin`
 * du poste au `PATH` du serveur d'essai — c'est une installation, pas un état, et rien
 * dans la suite n'a de raison de l'isoler.
 */
function hostAgentsBin() {
  const data = process.env.SOLERA_DATA_DIR
    ?? join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'solera')
  return join(data, 'agents', 'bin')
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
  await writeFile(config, '[agents.codex]\nenabled = false\n[agents.opencode]\nenabled = false\n')
  const env = {
    ...process.env,
    SOLERA_PORT: String(apiPort),
    SOLERA_HOST: '127.0.0.1',
    SOLERA_CONFIG: config,
    SOLERA_DATA_DIR: join(data, 'data'),
    SOLERA_WEB_ROOT: join(data, 'web'),
    PATH: `${hostAgentsBin()}${delimiter}${process.env.PATH ?? ''}`,
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
    if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const api = async (path) => (await context.request.get(`${base}${path}`)).json()
  // Un projet sans tâche semée : le fil de démonstration en pose une sur Nimbus, et
  // la page ne serait donc jamais vide ni réduite à la tâche créée ici.
  const project = (await api('/api/projects')).find((entry) => entry.name === 'Atlas API')
  const schedules = async () => (await api('/api/schedules')).filter((task) => task.projectId === project.id)
  /** Attend qu'un état de la tâche soit vrai, le temps d'un tir réel. */
  const until = async (label, predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const [task] = await schedules()
      if (task && predicate(task)) return task
      await delay(1000)
    }
    throw new Error(`Timeout: ${label}\n${server.diagnostics}`)
  }

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mkdir(shots, { recursive: true })

  // --- Création par le formulaire ------------------------------------------------
  await page.goto(`${base}/p/${project.id}/schedules`)
  await page.getByText('Aucune tâche planifiée dans ce projet').waitFor()
  await page.getByRole('button', { name: 'Tâche', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle tâche planifiée', exact: true })
  await dialog.getByRole('textbox', { name: 'Nom', exact: true }).fill('Veille de test')
  await dialog.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Réponds seulement « OK », sans utiliser aucun outil.')
  // Sans cadence valide, rien ne part : le bouton doit le dire.
  await dialog.getByRole('spinbutton', { name: 'Tous les', exact: true }).fill('0')
  assert.equal(await dialog.getByRole('button', { name: 'Créer la tâche', exact: true }).isDisabled(), true)
  await dialog.getByRole('radio', { name: 'Cron', exact: true }).click()
  await dialog.getByText(/À 09:00, uniquement le lundi/).waitFor()
  await dialog.getByRole('radio', { name: 'Intervalle', exact: true }).click()
  await dialog.getByRole('spinbutton', { name: 'Tous les', exact: true }).fill('1')
  await dialog.getByRole('combobox', { name: 'Unité', exact: true }).click()
  await page.getByRole('option', { name: 'minutes', exact: true }).click()
  await dialog.getByRole('spinbutton', { name: 'Durée maximale (min)', exact: true }).fill('3')
  await dialog.getByText(/Prochain tir :/).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'form-desktop.png') })
  await dialog.getByRole('button', { name: 'Créer la tâche', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  const card = page.locator('[data-schedule="Veille de test"]')
  await card.getByText('Active', { exact: true }).waitFor()
  await card.getByText('Toutes les 1 min').waitFor()
  const [created] = await schedules()
  assert.deepEqual(created.cadence, { kind: 'interval', minutes: 1 })
  assert.equal(created.maxDurationMinutes, 3)

  // --- Le tir part tout seul, à l'heure ------------------------------------------
  const fired = await until('le tir planifié part', (task) => task.runs.some((entry) => entry.conversationId), 100_000)
  const run1 = fired.runs.find((entry) => entry.conversationId)
  assert.equal(run1.trigger, 'schedule')
  const thread = (await api('/api/conversations')).find((entry) => entry.id === run1.conversationId)
  assert.equal(thread.scheduleId, created.id)
  assert.match(thread.title, /^Veille de test · /)

  // En pause tout de suite : un seul tir automatique suffit à la preuve.
  await card.getByRole('button', { name: 'Mettre en pause', exact: true }).click()
  await until('la tâche est en pause', (task) => !task.enabled && task.nextRunAt === null, 10_000)

  // La colonne ne montre que les tâches, jamais leurs tirs (carte #35). On est sur
  // /p/<projet>/schedules : le lieu *Projets* est donc affiché, et le groupe du projet
  // déplié d'office — s'il portait le fil du tir, il serait ici.
  const column = page.locator('aside')
  const places = page.getByRole('navigation', { name: 'Lieux' })
  const threadLink = column.locator(`a[href$="/c/${thread.id}"]`)
  await column.locator(`a[href="/p/${project.id}/schedules"]`).first().waitFor()
  assert.equal(await threadLink.count(), 0, 'Un tir ne doit pas apparaître dans la liste des sessions du projet')
  // Et le lieu *Planifiées* liste les tâches, pas ce qu'elles ont lancé. Un lieu est
  // une destination : le clic ouvre sa page, d'où l'on revient au projet.
  await places.getByRole('button', { name: /^Planifiées/ }).click()
  await column.getByRole('link', { name: /^Veille de test/ }).waitFor()
  assert.equal(await threadLink.count(), 0, 'Le lieu *Planifiées* ne montre que les tâches')
  await page.goto(`${base}/p/${project.id}/schedules`)

  const done = await until('le tir se termine', (task) => task.runs.every((entry) => entry.status !== 'running'), 150_000)
  assert.equal(done.runs.find((entry) => entry.id === run1.id).status, 'succeeded', JSON.stringify(done.runs))
  await card.getByRole('button', { name: /Historique des tirs/ }).click()
  await card.getByText('terminé', { exact: true }).first().waitFor({ timeout: 30_000 })
  await page.screenshot({ animations: 'disabled', path: join(shots, 'schedule-desktop.png') })

  // Puisque la colonne ne les porte plus, l'historique est la **seule** route vers le
  // fil d'un tir : sans ce lien, il ne s'atteindrait plus que par la palette.
  const runLink = card.locator(`a[href$="/c/${thread.id}"]`)
  await runLink.waitFor()

  // Le fil s'ouvre comme une conversation ordinaire, et l'agent a su qu'il tournait seul.
  await runLink.click()
  await page.getByText(/personne n'est au clavier/).first().waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'run-desktop.png') })

  // --- Lancer maintenant, depuis le téléphone ------------------------------------
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/p/${project.id}/schedules`)
  await card.getByText('En pause', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'schedule-mobile.png') })
  await card.getByRole('button', { name: 'Lancer maintenant', exact: true }).click()
  const manual = await until('le tir manuel part', (task) => task.runs.some((entry) => entry.trigger === 'manual'), 60_000)
  assert.equal(manual.enabled, false, 'Lancer maintenant ne sort pas la tâche de sa pause')
  await card.getByText('En cours', { exact: true }).waitFor({ timeout: 30_000 })

  // Au doigt non plus : le tiroir ouvert sur le lieu *Planifiées* montre les tâches et
  // rien d'autre. On y vient par l'adresse — cliquer le lieu referme le tiroir, puisque
  // le clic navigue.
  await page.goto(`${base}/schedules`)
  await page.getByRole('button', { name: /^Ouvrir la navigation/ }).click()
  const drawer = page.locator('aside')
  await drawer.getByRole('link', { name: /^Veille de test/ }).waitFor()
  // L'activité, au-dessus, porte bien des liens de conversation — mais aucun tir : on
  // vise donc le fil du tir, pas « un lien vers une conversation ».
  assert.equal(await drawer.locator(`a[href$="/c/${thread.id}"]`).count(), 0, 'La colonne ne porte aucun tir')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'sidebar-mobile.png') })
  await page.getByRole('button', { name: 'Fermer la navigation', exact: true }).click()
  await page.goto(`${base}/p/${project.id}/schedules`)

  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true })
  assert.equal(await editor.getByRole('textbox', { name: 'Nom', exact: true }).inputValue(), 'Veille de test')
  const saveBox = await editor.getByRole('button', { name: 'Enregistrer', exact: true }).boundingBox()
  assert.ok(saveBox.y + saveBox.height <= 844, 'The mobile save action remains visible')
  assert.equal(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth), true)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'form-mobile.png') })
  await editor.getByRole('button', { name: 'Annuler', exact: true }).click()

  await until('le tir manuel se termine', (task) => task.runs.every((entry) => entry.status !== 'running'), 150_000)

  // --- Suppression : les fils redeviennent des conversations ordinaires, rangées --
  await page.setViewportSize({ width: 1440, height: 900 })
  await card.getByRole('button', { name: 'Supprimer', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click()
  await page.getByText('Aucune tâche planifiée dans ce projet').waitFor()
  const after = (await api('/api/conversations')).filter((entry) => entry.title.startsWith('Veille de test · '))
  assert.equal(after.length, 2)
  assert.ok(after.every((entry) => entry.scheduleId === null && entry.archivedAt !== null))
  // La tâche quitte le lieu *Planifiées* ; celle que sème la démonstration y reste, et
  // c'est elle qui prouve qu'on regarde bien une liste vivante et non un lieu vidé.
  await places.getByRole('button', { name: /^Planifiées/ }).click()
  await column.getByRole('link', { name: /^CLI release watch/ }).waitFor()
  assert.equal(await column.getByRole('link', { name: /^Veille de test/ }).count(), 0)

  assert.deepEqual(errors, [])
  console.log(`schedule-ui-check: ok (captures dans ${shots})`)
} finally {
  await browser?.close()
  for (const child of processes) child.kill('SIGTERM')
  await rm(data, { recursive: true, force: true })
}
