import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { launchBrowser } from './checks/browser.mjs'

// Base, projets et serveurs jetables : aucun agent ni service utilisateur n'est arrêté.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const runtime = process.env.SOLERA_TEST_RUNTIME
const data = await mkdtemp(join(tmpdir(), 'solera-services-ui-'))
const children = []
const trackedProcesses = []
// Unités systemd jetables, arrêtées en sortie même si le contrôle échoue.
const units = []
const systemd = (args) => promisify(execFile)('systemd-run', ['--user', '--collect', ...args])
let browser

async function port() {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const number = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return number
}

function run(args, cwd, env, binary = process.execPath) {
  const child = spawn(binary, args, { cwd, env, stdio: 'pipe' })
  children.push(child)
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
  throw new Error(`Service did not start: ${child.diagnostics}`)
}

try {
  const [apiPort, webPort, servicePort, oldPort, appPort] = await Promise.all([port(), port(), port(), port(), port()])
  const config = join(data, 'config.toml')
  await writeFile(config, '[agents.claude]\nenabled = false\n[agents.codex]\nenabled = false\n')
  const env = { ...process.env, SOLERA_PORT: String(apiPort), SOLERA_HOST: '127.0.0.1', SOLERA_CONFIG: config, SOLERA_DATA_DIR: join(data, 'data'), SOLERA_WEB_ROOT: runtime ? join(runtime, 'web') : join(data, 'web') }
  const seed = run(['--import', 'tsx', 'src/cli/demo-seed.ts'], serverDir, env)
  assert.equal((await once(seed, 'exit'))[0], 0, seed.diagnostics)
  const Sqlite = createRequire(join(serverDir, 'package.json'))('better-sqlite3')
  const db = new Sqlite(join(env.SOLERA_DATA_DIR, 'solera.db'), { readonly: true })
  const project = db.prepare('SELECT * FROM projects WHERE name = ?').get('Nimbus')
  const conversation = db.prepare('SELECT * FROM conversations WHERE project_id = ? LIMIT 1').get(project.id)
  db.close()
  const token = randomUUID()
  await mkdir(join(env.SOLERA_DATA_DIR, 'process-origins'))
  await writeFile(join(env.SOLERA_DATA_DIR, 'process-origins', `${token}.json`), JSON.stringify({ projectId: project.id, conversationId: conversation.id }))
  const script = (number) => `require('node:http').createServer((_, res) => res.end('fixture')).listen(${number}, '127.0.0.1')`
  // Même dossier et même marqueur que l’agent : ce frère indépendant doit être exclu.
  const old = run(['-e', script(oldPort)], project.workspace_path, { PATH: process.env.PATH, SOLERA_PROCESS_ORIGIN: token })
  const server = runtime
    ? run(['server/main.js'], runtime, env, process.env.SOLERA_TEST_NODE)
    : run(['--import', 'tsx', 'src/main.ts'], serverDir, env)
  const vite = runtime ? server : run([join(webDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], webDir, env)
  const base = `http://127.0.0.1:${runtime ? apiPort : webPort}`
  await Promise.all([ready(`${base}/api/health`, server), ready(base, vite), ready(`http://127.0.0.1:${oldPort}`, old)])
  // Une app permanente comme un agent la crée : unité solera-app-*, avec le jeton d’origine.
  const appName = `uicheck-${token.slice(0, 8)}`
  units.push(`solera-app-${appName}.service`)
  await systemd([`--unit=solera-app-${appName}`, `--setenv=SOLERA_PROCESS_ORIGIN=${token}`, `--working-directory=${project.workspace_path}`, process.execPath, '-e', script(appPort)])
  await ready(`http://127.0.0.1:${appPort}`, server)
  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  assert.ok((await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })).ok())
  const terminalResponse = await context.request.post(`${base}/api/projects/${project.id}/terminals`, { data: {} })
  assert.equal(terminalResponse.status(), 201)
  const terminal = await terminalResponse.json()
  const serviceFile = join(project.workspace_path, 'service-fixture.cjs')
  const workerFile = join(project.workspace_path, 'worker-fixture.cjs')
  const servicePidFile = join(data, 'service.pid')
  const workerPidFile = join(data, 'worker.pid')
  await writeFile(serviceFile, `require('node:fs').writeFileSync(${JSON.stringify(servicePidFile)}, String(process.pid)); ${script(servicePort)}`)
  await writeFile(workerFile, `require('node:fs').writeFileSync(${JSON.stringify(workerPidFile)}, String(process.pid)); setInterval(() => {}, 1000)`)
  const quote = (text) => "'" + text.replaceAll("'", "'\\''") + "'"
  const command = `SOLERA_PROCESS_ORIGIN=${quote(token)} ${quote(process.execPath)} ${quote(serviceFile)} &\r${quote(process.execPath)} ${quote(workerFile)} &\r`
  const terminalPage = await context.newPage()
  await terminalPage.goto(base)
  await terminalPage.evaluate(async ({ projectId, terminalId, command }) => {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(`${location.origin.replace('http', 'ws')}/api/projects/${projectId}/terminal?terminalId=${terminalId}`)
      socket.onerror = () => reject(new Error('Terminal socket failed'))
      socket.onmessage = (event) => {
        if (JSON.parse(event.data).t === 'ready') {
          socket.send(JSON.stringify({ t: 'input', data: command }))
          setTimeout(() => { socket.close(); resolve() }, 100)
        }
      }
    })
  }, { projectId: project.id, terminalId: terminal.id, command })
  await terminalPage.close()
  async function waitPid(file) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pid = Number(await readFile(file, 'utf8').catch(() => ''))
      if (pid) {
        const identity = await readFile(`/proc/${pid}/stat`, 'utf8')
        trackedProcesses.push({ pid, start: identity.slice(identity.lastIndexOf(')') + 2).split(' ')[19] })
        return pid
      }
      await delay(100)
    }
    throw new Error(`Missing PID file: ${file}`)
  }
  const service = { pid: await waitPid(servicePidFile) }
  const worker = { pid: await waitPid(workerPidFile) }
  await ready(`http://127.0.0.1:${servicePort}`, server)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/services`)
  await page.getByRole('heading', { name: 'Services', exact: true }).waitFor()
  const appCard = page.locator('li').filter({ hasText: appName })
  await appCard.getByText(`:${appPort}`, { exact: true }).waitFor()
  await appCard.getByText('En marche', { exact: true }).waitFor()
  await appCard.getByRole('link', { name: conversation.title, exact: true }).waitFor()
  // Le journal est dans les détails repliés de la ligne.
  await appCard.getByRole('button', { name: 'Détails', exact: true }).click()
  await appCard.getByText(`journalctl --user -u solera-app-${appName}.service`, { exact: true }).waitFor()
  // Une ligne se repère par sa ligne de commande : le PID est replié dans ses détails.
  const row = page.locator('li:not(:has(li))').filter({ has: page.locator('code[title*="service-fixture.cjs"]') })
  const oldRow = page.locator('li:not(:has(li))').filter({ has: page.locator(`code[title*="${oldPort}"]`) })
  await row.getByText(`:${servicePort}`, { exact: true }).waitFor()
  await row.getByRole('link', { name: conversation.title, exact: true }).waitFor()
  assert.equal(await oldRow.count(), 0, 'Un service indépendant est exclu même avec le même dossier et le même marqueur')
  const workerRow = page.locator('li:not(:has(li))').filter({ has: page.locator('code[title*="worker-fixture.cjs"]') })
  // Les deux commandes sont rangées sous le terminal qui les a lancées, avec leur ligne de commande.
  const terminalGroup = page.locator('section').filter({ has: page.getByText('Terminal', { exact: true }) })
  await terminalGroup.getByRole('link', { name: 'Nimbus', exact: true }).first().waitFor()
  assert.equal(await terminalGroup.locator('li:not(:has(li))').filter({ has: page.locator('code[title*="worker-fixture.cjs"]') }).count(), 1)
  await workerRow.getByRole('button', { name: 'Détails', exact: true }).click()
  await workerRow.getByText(String(worker.pid), { exact: true }).waitFor()
  await row.locator('code').filter({ hasText: 'service-fixture.cjs' }).waitFor()
  await workerRow.locator('code').filter({ hasText: 'worker-fixture.cjs' }).waitFor()
  await appCard.getByText(/^node -e /).waitFor()
  // Un seul projet : pas de pastilles de filtre, il n'y aurait rien à choisir. Sur une
  // machine où d'autres sessions tournent, leurs processus ajoutent « Origine inconnue » :
  // les pastilles paraissent alors, mais aucun autre projet.
  const filters = page.getByRole('radiogroup', { name: 'Filtrer par projet' })
  if (await filters.count()) {
    const pills = (await filters.getByRole('radio').allInnerTexts()).map((text) => text.split('\n')[0])
    assert.deepEqual(pills.filter((name) => !['Tous les projets', 'Nimbus', 'Origine inconnue'].includes(name)), [])
  }
  assert.equal(await oldRow.count(), 0)
  await appCard.getByText(`:${appPort}`, { exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/solera-services-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  // Le tiroir de navigation termine sa transition après le changement de breakpoint.
  await delay(350)
  await page.locator('[data-navigation-trigger]').click()
  // Services se range dans le menu du compte, au pied de la colonne.
  await page.getByRole('button', { name: 'Alex', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Services', exact: true }).click()
  await delay(350)
  await row.getByRole('button', { name: 'Arrêter', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: '/tmp/solera-services-mobile.png', fullPage: true })
  // « Processus des sessions » dans l'onglet Actions du panneau de la conversation qui les
  // a lancés (AC-17) : le même scan, une ligne de 36 px par processus, sans la pastille de
  // cette session ; un clic déplie la commande, « En faire une action » pré-remplit
  // l'éditeur, « Arrêter » arrête vraiment.
  const panelPage = await context.newPage()
  panelPage.on('pageerror', (error) => errors.push(error.message))
  await panelPage.goto(`${base}/p/${project.id}/c/${conversation.id}`)
  await panelPage.getByRole('button', { name: 'Ouvrir le panneau' }).first().click()
  await panelPage.locator('button[aria-pressed][aria-label^="Actions"]').click()
  const works = panelPage.locator('[data-session-works]')
  await works.getByText('Processus des sessions', { exact: true }).waitFor({ timeout: 15000 })
  const serviceLine = works.locator('li').filter({ has: panelPage.getByRole('link', { name: new RegExp(`:${servicePort}`) }) })
  await serviceLine.getByText('Script node', { exact: true }).waitFor()
  // Le second, lancé du terminal sans session, n'est pas un processus de session.
  assert.equal(await works.locator('li').count(), 1, 'Un processus de terminal sans session reste hors du panneau')
  const lineHeight = await serviceLine.locator('> div').first().evaluate((node) => node.getBoundingClientRect().height)
  assert.equal(Math.round(lineHeight), 36, 'Une ligne de processus fait 36 px')
  assert.equal(await serviceLine.getByText(conversation.title, { exact: true }).count(), 0, 'Pas de pastille pour cette session')
  await serviceLine.getByRole('button', { name: 'Script node', exact: true }).click()
  await serviceLine.getByText('Lancé par cette session', { exact: true }).waitFor()
  await serviceLine.locator('code').filter({ hasText: 'service-fixture.cjs' }).waitFor()
  await serviceLine.getByText(/La sortie ne remonte pas jusqu’ici/).waitFor()
  await serviceLine.screenshot({ path: '/tmp/solera-services-session-line.png' })
  await serviceLine.hover()
  await serviceLine.getByRole('button', { name: 'Plus pour « Script node »' }).click()
  await panelPage.getByRole('menuitem', { name: 'En faire une action', exact: true }).click()
  // L'éditeur s'ouvre en pile dans le panneau, à la place de la liste ; Échap y remonte.
  const editor = panelPage.locator('[data-action-stack]')
  assert.match(await editor.getByLabel('Commande', { exact: true }).inputValue(), /service-fixture\.cjs/)
  assert.equal(await editor.getByLabel('Lien du service', { exact: true }).inputValue(), 'http://localhost:{port}')
  await panelPage.keyboard.press('Escape')
  await editor.waitFor({ state: 'detached' })
  await serviceLine.hover()
  await serviceLine.getByRole('button', { name: 'Arrêter « Script node »' }).click()
  await works.waitFor({ state: 'detached', timeout: 12000 })
  assert.equal(await fetch(`http://127.0.0.1:${servicePort}`).then(() => true, () => false), false, 'Le processus arrêté depuis le panneau ne répond plus')
  await panelPage.close()
  await appCard.getByRole('button', { name: 'Arrêter', exact: true }).click()
  await appCard.waitFor({ state: 'detached', timeout: 12000 })
  assert.equal(await fetch(`http://127.0.0.1:${appPort}`).then(() => true, () => false), false, 'L’app arrêtée ne répond plus')
  // Arrêté depuis le panneau, il a quitté la page de lui-même.
  await row.waitFor({ state: 'detached', timeout: 12000 })
  await workerRow.getByRole('button', { name: 'Arrêter', exact: true }).click()
  await workerRow.waitFor({ state: 'detached', timeout: 12000 })
  await terminalGroup.getByText('Aucune commande en cours', { exact: true }).waitFor()
  assert.equal(old.exitCode, null, 'Stopping one service must not stop another')
  // Un terminal confiné a son bac à sable, rangé dans Environnements avec le terminal
  // dessous ; l'arrêter demande confirmation en nommant le terminal. Sans confinement
  // natif sur la machine, le réglage est refusé et l'étape est sautée.
  const confining = await context.request.patch(`${base}/api/projects/${project.id}`, { data: { environment: { where: 'host', confined: true } } })
  let sandboxChecked = false
  if (confining.ok()) {
    const confinedResponse = await context.request.post(`${base}/api/projects/${project.id}/terminals`, { data: {} })
    assert.equal(confinedResponse.status(), 201)
    const confined = await confinedResponse.json()
    await page.setViewportSize({ width: 1440, height: 900 })
    const sandbox = page.locator(`li[id="environment-sandbox-terminal-${confined.id}"]`)
    await sandbox.getByText('Bac à sable', { exact: true }).waitFor({ timeout: 15000 })
    await sandbox.getByText('En marche', { exact: true }).waitFor()
    await sandbox.getByText('Terminal', { exact: true }).waitFor()
    await page.screenshot({ path: '/tmp/solera-services-environments.png', fullPage: true })
    await sandbox.getByRole('button', { name: 'Arrêter', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText(`Le terminal « ${confined.title} »`, { exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Arrêter', exact: true }).click()
    await sandbox.waitFor({ state: 'detached', timeout: 12000 })
    sandboxChecked = true
  } else {
    console.log(`Bac à sable non vérifié : confinement indisponible (${confining.status()} ${await confining.text()})`)
  }
  assert.deepEqual(errors, [])
  console.log(`OK : commandes rangées sous leur terminal, lignes de commande, processus sans port, exclusion des services indépendants, app permanente, mobile, processus des sessions dans le panneau (ligne, détail, en faire une action, arrêt) et arrêt ciblé${sandboxChecked ? ', bac à sable d’un terminal confiné et son arrêt confirmé' : ''}.`)
} finally {
  await browser?.close()
  for (const unit of units) {
    await promisify(execFile)('systemctl', ['--user', 'stop', unit]).catch(() => {})
    await promisify(execFile)('systemctl', ['--user', 'reset-failed', unit]).catch(() => {})
  }
  for (const { pid, start } of trackedProcesses) {
    const current = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')
    if (current && current.slice(current.lastIndexOf(')') + 2).split(' ')[19] === start) process.kill(pid, 'SIGTERM')
  }
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
  }
  await rm(data, { recursive: true, force: true })
}
