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

// La page globale Planifiées (AC-20, PLF-1 à PLF-10) : vrais composants, vraie API, dans
// une base temporaire semée par la démo. Aucun agent ne tourne : ni CLI ni quota.
// Les captures vont dans PLANNED_SHOTS, ou dans un dossier temporaire annoncé à la fin.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-planned-check-'))
const shots = process.env.PLANNED_SHOTS ?? (await mkdtemp(join(tmpdir(), 'solera-planned-shots-')))
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
  await writeFile(config, '[agents.codex]\nenabled = false\n[agents.opencode]\nenabled = false\n')
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
    if (window !== window.top || location.origin !== origin) return
    localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const api = async (path) => (await context.request.get(`${base}${path}`)).json()

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mkdir(shots, { recursive: true })

  await page.goto(`${base}/schedules`)
  const seeded = page.locator('[data-planned-tile]', { has: page.getByText('CLI release watch', { exact: true }) })
  await seeded.waitFor()
  // Le Lanceur d'office, rangé par échéance ; la tuile porte la pastille de son projet.
  await seeded.getByText('Nimbus', { exact: true }).waitFor()
  await page.locator('[data-planned-summary]').getByText(/^1 tâche · 1 portée$/).waitFor()
  await seeded.getByRole('button', { name: /^Lancer « CLI release watch » maintenant, à la racine de Nimbus$/ }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'planned-launcher-desktop.png') })

  // « + Tâche ▾ » › Tâche d'agent : l'éditeur arrive planifié d'office, avec sa portée.
  await page.getByRole('button', { name: 'Nouvelle tâche', exact: true }).click()
  await page.getByRole('dialog', { name: 'Nouvelle tâche', exact: true }).getByRole('button', { name: /^Tâche d’agent/ }).click()
  const plannedEditor = page.getByRole('dialog', { name: 'Nouvelle action', exact: true })
  assert.equal(await plannedEditor.getByRole('checkbox', { name: /^Planifiée/ }).getAttribute('aria-checked'), 'true')
  const scopeField = plannedEditor.locator('[data-scope-field]').getByRole('combobox')
  await scopeField.click()
  // Un administrateur voit l'instance ; sans vault configuré, le Savoir est fermé, et dit pourquoi.
  await page.getByRole('option', { name: /^Instance/ }).waitFor()
  const vaultOption = page.getByRole('option', { name: /^Savoir/ })
  assert.equal(await vaultOption.getAttribute('aria-disabled'), 'true')
  await vaultOption.getByText(/^Aucun vault n’est configuré/).waitFor()
  await page.getByRole('option', { name: /^Sans projet/ }).click()
  await plannedEditor.getByText('Un lancement part hors projet.', { exact: true }).waitFor()
  // Hors projet, ni worktree neuf ni confinement : « Où il tourne » disparaît.
  assert.equal(await plannedEditor.getByText('Où il tourne', { exact: true }).count(), 0)
  await plannedEditor.getByRole('textbox', { name: 'Libellé', exact: true }).fill('Veille sans projet')
  await plannedEditor.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Résume les notes de la semaine.')
  await page.screenshot({ animations: 'disabled', path: join(shots, 'planned-editor-desktop.png') })
  await plannedEditor.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await plannedEditor.waitFor({ state: 'hidden' })
  const looseTask = (await api('/api/schedules')).find((task) => task.name === 'Veille sans projet')
  assert.equal(looseTask.scope, 'none')
  assert.equal(looseTask.projectId, null)
  assert.ok(looseTask.cadence, 'Créée depuis les Planifiées, la tâche a une cadence')
  assert.equal(looseTask.worktreeMode, 'root')
  const looseTile = page.locator('[data-planned-tile]', { has: page.getByText('Veille sans projet', { exact: true }) })
  await looseTile.getByText('Sans projet', { exact: true }).waitFor()
  await looseTile.getByText(/^Prochain dans .* · jamais lancée$/).waitFor()

  // Une commande planifiée ne vit que dans un projet : le reste lui est fermé.
  await page.getByRole('button', { name: 'Nouvelle tâche', exact: true }).click()
  await page.getByRole('dialog', { name: 'Nouvelle tâche', exact: true }).getByRole('button', { name: /^Commande planifiée/ }).click()
  await plannedEditor.getByRole('radio', { name: /^Une commande/ }).waitFor()
  assert.equal(await plannedEditor.getByRole('radio', { name: /^Une commande/ }).getAttribute('aria-checked'), 'true')
  await plannedEditor.locator('[data-scope-field]').getByRole('combobox').click()
  assert.equal(await page.getByRole('option', { name: /^Sans projet/ }).getAttribute('aria-disabled'), 'true')
  await page.getByRole('option', { name: /^Sans projet/ }).getByText('Une commande tourne dans un projet.', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await plannedEditor.getByRole('button', { name: 'Annuler', exact: true }).click()
  await plannedEditor.waitFor({ state: 'hidden' })

  // Filtrer par portée : une puce, et le compte de chaque portée dans le menu.
  await page.getByRole('button', { name: 'Filtrer', exact: true }).click()
  const filterPopover = page.getByRole('dialog', { name: 'Filtrer', exact: true })
  await filterPopover.getByRole('checkbox', { name: /Sans projet/ }).click()
  await page.keyboard.press('Escape')
  await page.locator('[data-toolbar-chips]').getByText('Sans projet', { exact: true }).waitFor()
  await seeded.waitFor({ state: 'detached' })
  await looseTile.waitFor()
  await page.locator('[data-toolbar-chips]').getByRole('button', { name: 'Retirer ce filtre', exact: true }).click()
  await seeded.waitFor()

  // Le tiroir unifié : le nom ouvre le détail de la tâche, dans sa portée.
  await looseTile.getByRole('button', { name: /^Veille sans projet/ }).click()
  const looseDetail = page.getByRole('dialog', { name: 'Veille sans projet', exact: true })
  await looseDetail.getByText('Claude Code reçoit ce prompt, dans une session neuve :').waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'planned-detail-desktop.png') })
  await looseDetail.getByRole('button', { name: 'Fermer', exact: true }).click()
  await looseDetail.waitFor({ state: 'hidden' })

  // Affichage › Liste : la santé, quatre chiffres, puis par état ou par portée.
  const display = async () => page.getByRole('button', { name: /^Affichage/ }).click()
  await display()
  await page.getByRole('dialog', { name: 'Affichage', exact: true }).getByRole('radio', { name: /^Liste/ }).click()
  await page.keyboard.press('Escape')
  await page.locator('[data-planned-health]').getByText('Réussite sur 30 j', { exact: true }).waitFor()
  await page.locator('[data-health-section="healthy"]').getByText('Veille sans projet', { exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'planned-list-desktop.png') })
  await display()
  await page.getByRole('dialog', { name: 'Affichage', exact: true }).getByRole('radio', { name: 'Par portée', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.locator('[data-health-section="none"]').waitFor()
  // Affichage › Agenda : les passages à venir.
  await display()
  await page.getByRole('dialog', { name: 'Affichage', exact: true }).getByRole('radio', { name: /^Agenda/ }).click()
  await page.keyboard.press('Escape')
  await page.waitForURL(/vue=agenda/)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'planned-agenda-desktop.png') })
  await display()
  await page.getByRole('dialog', { name: 'Affichage', exact: true }).getByRole('radio', { name: /^Lanceur/ }).click()
  await page.keyboard.press('Escape')

  // Au téléphone : rien ne déborde.
  await page.setViewportSize({ width: 390, height: 844 })
  await looseTile.waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'planned-launcher-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 900 })

  // Supprimée depuis sa tuile : la suite repart d'une page où seule la tâche semée reste.
  await looseTile.getByRole('button', { name: 'Plus pour « Veille sans projet »', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Supprimer', exact: true }).click()
  await page.getByRole('dialog', { name: 'Supprimer « Veille sans projet » ?' }).getByRole('button', { name: 'Supprimer', exact: true }).click()
  await looseTile.waitFor({ state: 'detached' })

  assert.deepEqual(errors, [])
  console.log(`planned-ui-check: ok (captures dans ${shots})`)
} finally {
  await browser?.close()
  for (const child of processes) child.kill('SIGTERM')
  await rm(data, { recursive: true, force: true })
}
