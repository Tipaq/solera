import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

// La visite de première ouverture, sur une base vide : le premier compte créé depuis le
// navigateur, chaque réglage écrit au compte, et la sortie vers le premier projet.
// Vrais composants et vraie API ; aucun CLI n'est activé. Les captures, une par étape,
// vont sous ~/.cache et non dans le dépôt.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-onboarding-check-'))
const shots = join(homedir(), '.cache/solera-onboarding-shots')
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
  await writeFile(
    config,
    '[agents.claude]\nenabled = false\n[agents.codex]\nenabled = false\n[agents.opencode]\nenabled = false\n[agents.grok]\nenabled = false\n'
      // Les familles qu'on accorde sont plafonnées pour l'instance par défaut, et leur
      // interrupteur disparaît : ouvertes ici pour que la visite les montre.
      + '[mcp]\ncardFiling = true\nprojectFiling = true\n',
  )
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

  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const heading = async (name) => {
    try {
      await page.getByRole('heading', { level: 1, name, exact: true }).waitFor({ timeout: 30_000 })
    } catch (error) {
      await page.screenshot({ path: join(shots, 'echec.png') })
      console.error(page.url(), (await page.locator('body').innerText()).slice(-600), errors)
      throw error
    }
  }
  const button = (name) => page.getByRole('button', { name, exact: true })
  const settings = async () => (await context.request.get(`${base}/api/me/settings`)).json()
  const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`), fullPage: true })

  // Une base sans compte : pas de page de connexion, la visite commence par le créer.
  const instance = await (await context.request.get(`${base}/api/system/instance`)).json()
  assert.equal(instance.needsSetup, true)
  await page.goto(base + '/')
  await heading('Créer le premier compte')
  assert.equal(await page.getByRole('button', { name: 'Se connecter', exact: true }).count(), 0)
  assert.ok(await button('Créer le compte').isDisabled(), 'pas de compte sans les trois champs')
  await page.getByLabel('Nom affiché', { exact: true }).fill('Tim')
  await page.getByLabel("Nom d'utilisateur", { exact: true }).fill('tim')
  await page.getByLabel('Mot de passe', { exact: true }).fill('court')
  assert.ok(await button('Créer le compte').isDisabled(), 'mot de passe trop court')
  await page.getByLabel('Mot de passe', { exact: true }).fill('correct horse battery')
  await shot('01-compte')
  await button('Créer le compte').click()

  // La session est ouverte, la visite repart au compte, sans l'étape du compte.
  await heading('Bienvenue, Tim')
  assert.equal(await page.getByText('Le premier, administrateur', { exact: true }).count(), 0)
  await page.waitForURL(/\/bienvenue$/)
  const again = await context.request.post(`${base}/api/auth/setup`, { data: { username: 'intrus', displayName: 'Intrus', password: 'correct horse battery' } })
  assert.equal(again.status(), 409, 'un second premier compte est refusé')
  await shot('02-bienvenue')
  await button('Commencer').click()

  await heading('Ton apparence')
  await shot('03-apparence')
  await button('Continuer').click()

  await heading('Les agents')
  await page.getByText('Aucun CLI choisi', { exact: true }).waitFor()
  await shot('04-agents')
  await button('Continuer').click()

  // Le réflexe et une famille, écrits aux quatre défauts de compte à « Continuer ».
  await heading("Ce que l'agent fait sans demander")
  await page.getByRole('radio', { name: /^Accepter les modifications/ }).click()
  await page.getByRole('switch', { name: /^Rangement de carte/ }).click()
  await shot('05-autorisations')
  await button('Continuer').click()
  await heading('Consignes et mémoire')
  let stored = await settings()
  assert.equal(stored.agentDefaults.claude.permissionMode, 'acceptEdits')
  assert.equal(stored.agentDefaults.codex.askForApproval, 'never')
  assert.equal(stored.agentDefaults.grok.permissionMode, 'auto')
  // Allumée par défaut depuis #66 : le clic l'éteint, aux quatre défauts.
  for (const agent of ['claude', 'codex', 'opencode', 'grok']) {
    assert.equal(stored.agentDefaults[agent].cardFiling, false, `cardFiling pour ${agent}`)
  }

  // La mémoire est la famille `agentMemory`, et les consignes ont leur défaut de projet.
  await page.getByRole('switch', { name: /^Mémoire/ }).click()
  await page.getByRole('radio', { name: /^Dans Solera/ }).click()
  await page.getByText('SOLERA.md, la partie globale', { exact: true }).waitFor()
  await shot('06-consignes')
  await button('Continuer').click()
  await heading('La bibliothèque de skills')
  stored = await settings()
  for (const agent of ['claude', 'codex', 'opencode', 'grok']) {
    assert.equal(stored.agentDefaults[agent].agentMemory, false, `mémoire éteinte pour ${agent}`)
  }
  assert.equal(stored.projectDefaults.instructionsMode, 'solera')
  await shot('07-skills')
  await button('Plus tard').click()

  await heading("L'écran")
  await page.getByText('La vue Git', { exact: true }).waitFor()
  await shot('08-ecran')
  await button('Continuer').click()
  await heading('Organiser le travail')
  await page.getByText('Le Journal', { exact: true }).waitFor()
  await shot('09-travail')
  await button('Continuer').click()

  // Le récapitulatif dit ce qui a été réglé et ce qui a été passé.
  await heading("C'est prêt")
  await page.getByText('Accepter les modifications', { exact: true }).waitFor()
  await page.getByText('Éteinte', { exact: true }).waitFor()
  await page.getByText('Passées pour plus tard', { exact: true }).waitFor()
  await shot('10-pret')
  // La liste des étapes ramène en arrière.
  await page.getByRole('complementary').getByRole('button', { name: /Skills/ }).click()
  await heading('La bibliothèque de skills')
  await page.getByRole('complementary').getByRole('button', { name: /C'est prêt/ }).click()
  await heading("C'est prêt")
  await button('Créer mon premier projet').click()

  // Sans projet, la sortie mène à sa création ; le formulaire reprend le défaut posé.
  await page.waitForURL(/\/projects\/new$/)
  await page.getByRole('complementary').first().waitFor()
  assert.equal((await settings()).onboarding.pending, false)
  await page.getByText('Dans Solera', { exact: true }).first().waitFor()
  await page.reload()
  await page.waitForURL(/\/projects\/new$/)

  // Rejouée, elle rouvre à sa première étape ; « Passer la visite » mène au récapitulatif.
  const replay = await context.request.patch(`${base}/api/me/settings`, { data: { onboarding: { pending: true } } })
  assert.ok(replay.ok())
  await page.goto(base + '/')
  await page.waitForURL(/\/bienvenue$/)
  await heading('Bienvenue, Tim')
  await button('Passer la visite').click()
  await heading("C'est prêt")
  await button('Créer mon premier projet').click()
  await page.waitForURL(/\/projects\/new$/)

  // Au téléphone : la progression en tête, et rien ne déborde.
  await context.request.patch(`${base}/api/me/settings`, { data: { onboarding: { pending: true, step: 4 } } })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/')
  await page.getByText(/^Étape 5 sur 9/).waitFor()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.ok(overflow <= 0, `débordement horizontal de ${overflow} px`)
  await shot('11-telephone')

  assert.deepEqual(errors, [])
  console.log(`OK : visite de première ouverture, du premier compte au premier projet. Captures dans ${shots}.`)
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
