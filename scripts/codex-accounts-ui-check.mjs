import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

// Comptes Codex supplémentaires : création, connexion par clé API et par code d'appareil,
// sélecteur de compte dans les défauts du CLI. Vrais composants, vraie API, base temporaire ;
// le vrai `codex app-server` est lancé pour les connexions, dans un home jetable.
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
  await writeFile(config, '[agents.claude]\nenabled = false\n[agents.opencode]\nenabled = false\n')
  const env = {
    ...process.env,
    SOLERA_PORT: String(apiPort),
    SOLERA_HOST: '127.0.0.1',
    SOLERA_CONFIG: config,
    SOLERA_DATA_DIR: join(data, 'data'),
    SOLERA_WEB_ROOT: join(data, 'web'),
    // Le home Codex de « l'utilisateur », dont chaque compte recopie la configuration :
    // jetable, pour ne lire ni la connexion ni la configuration de la machine.
    CODEX_HOME: join(data, 'user-codex'),
  }
  await mkdir(env.CODEX_HOME, { recursive: true })
  await writeFile(join(env.CODEX_HOME, 'config.toml'), 'model_reasoning_effort = "low"\n')
  const server = run(['--import', 'tsx', 'src/main.ts'], serverDir, env)
  const vite = run([join(webDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], webDir, env)
  const base = `http://127.0.0.1:${webPort}`
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`, server), ready(base, vite)])
  const seed = run(['--import', 'tsx', 'src/cli/demo-seed.ts'], serverDir, env)
  const [seedCode] = await once(seed, 'exit')
  assert.equal(seedCode, 0, seed.diagnostics)

  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  // Créer un compte : il naît non connecté, avec les deux voies de connexion.
  await page.goto(`${base}/settings/comptes-codex`)
  await page.getByText('Aucun compte Codex').waitFor()
  await page.getByRole('button', { name: 'Connecter un compte' }).first().click()
  await page.getByLabel('Nom').fill('Boulot')
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  // L'état se lit sur la ligne du compte : la carte « Connexion » du CLI, au-dessus dans
  // l'onglet, porte aussi un « Connecté » ou un « Non connecté », le sien.
  const row = page.getByRole('dialog').getByText('Boulot', { exact: true }).locator('..')
  await row.getByText('Non connecté', { exact: true }).waitFor()
  const listed = await (await context.request.get(`${base}/api/codex-accounts`)).json()
  assert.equal(listed.accounts[0].status, 'pending')
  const id = listed.accounts[0].id

  // Clé API : Codex l'écrit dans le home du compte, sans joindre OpenAI.
  await page.getByRole('button', { name: 'Utiliser une clé API' }).click()
  await page.getByLabel('Clé API').fill('sk-test-bogus-key')
  // Le bouton du formulaire : la carte « Connexion » du CLI a aussi son « Se connecter ».
  await page.locator('form', { has: page.getByLabel('Clé API') }).getByRole('button', { name: 'Se connecter', exact: true }).click()
  await row.getByText('Connecté', { exact: true }).waitFor({ timeout: 30000 })
  await page.getByText('Clé API', { exact: true }).waitFor()
  assert.ok(!(await page.content()).includes('sk-test-bogus-key'), 'La clé ne revient jamais au navigateur')
  const authFile = join(data, 'data', 'codex-accounts', id, 'auth.json')
  assert.ok((await readFile(authFile, 'utf8')).includes('sk-test-bogus-key'), 'auth.json est dans le home du compte')
  // Un home sans lien vers celui de l'utilisateur (#139) : sa configuration y est recopiée.
  const copied = join(data, 'data', 'codex-accounts', id, 'config.toml')
  assert.ok((await lstat(copied)).isFile(), 'config.toml recopié, pas lié, dans le home du compte')
  assert.ok((await readFile(copied, 'utf8')).includes('model_reasoning_effort'), 'la configuration de l’utilisateur suit')
  await page.screenshot({ path: '/tmp/solera-codex-accounts-desktop.png' })

  // Le sélecteur de compte dans les défauts de Codex. Il part sur le premier compte connecté
  // (#147) : avec un seul, rien ne s'écrirait. Un second, connecté par l'API, pour que le
  // choix ait à se garder ; il est retiré ensuite.
  const second = await (await context.request.post(`${base}/api/codex-accounts`, { data: { label: 'Perso' } })).json()
  const secondLogin = await context.request.post(`${base}/api/codex-accounts/${second.id}/login`, { data: { type: 'apiKey', apiKey: 'sk-test-other-key' } })
  assert.ok(secondLogin.ok(), await secondLogin.text())
  await page.goto(`${base}/settings/cli`)
  await page.getByRole('tab', { name: 'Codex' }).click()
  const account = page.getByRole('combobox', { name: 'Compte' })
  await account.waitFor()
  assert.equal(await account.textContent(), 'Boulot', 'le premier compte connecté est choisi d’office')
  await account.click()
  assert.equal(await page.getByRole('option', { name: /Connexion du terminal/ }).count(), 0, 'pas de connexion du terminal (#147)')
  await page.getByRole('option', { name: 'Perso' }).click()
  let settings
  for (let tries = 0; tries < 50; tries++) {
    settings = await (await context.request.get(`${base}/api/me/settings`)).json()
    if (settings.agentDefaults.codex.account === second.id) break
    await delay(100)
  }
  assert.equal(settings.agentDefaults.codex.account, second.id)
  assert.ok((await context.request.delete(`${base}/api/codex-accounts/${second.id}`)).ok())
  assert.equal(settings.agentDefaults.claude.account, null)

  // Déconnexion : le compte redevient en attente et disparaît du sélecteur.
  await page.goto(`${base}/settings/comptes-codex`)
  // Pas le bouton de la navigation, qui ferme la session Solera : celui de la carte.
  await page.getByRole('button', { name: 'Déconnecter ce compte' }).click()
  await row.getByText('Non connecté', { exact: true }).waitFor({ timeout: 30000 }).catch(async (err) => {
    await page.screenshot({ path: '/tmp/solera-codex-accounts-failure.png' })
    console.log('état après déconnexion :', JSON.stringify(await (await context.request.get(`${base}/api/codex-accounts`)).json()))
    throw err
  })
  assert.equal((await (await context.request.get(`${base}/api/codex-accounts`)).json()).accounts[0].status, 'pending')
  assert.ok(!(await readFile(authFile, 'utf8').catch(() => '')).includes('sk-test'), 'auth.json retiré par Codex')

  // Code d'appareil : Codex rend une URL et un code, l'écran les montre, on annule.
  await page.getByRole('button', { name: "Se connecter par code d'appareil" }).click()
  await page.getByText('Ouvrir la page de connexion').waitFor({ timeout: 30000 })
  // Le code à côté du lien : la carte d'installation du CLI montre aussi son chemin en <code>.
  const deviceCode = page.getByRole('dialog').locator('div', { has: page.getByRole('link', { name: 'Ouvrir la page de connexion' }) }).last().locator('code')
  const code = await deviceCode.textContent()
  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{5}$/, code)
  const status = await (await context.request.get(`${base}/api/codex-accounts/${id}/login`)).json()
  assert.equal(status.state, 'pending')
  assert.ok(status.verificationUrl.startsWith('https://'))
  await page.screenshot({ path: '/tmp/solera-codex-accounts-device.png' })
  await page.getByRole('button', { name: 'Annuler' }).click()
  await page.getByRole('button', { name: "Se connecter par code d'appareil" }).waitFor()
  assert.equal((await (await context.request.get(`${base}/api/codex-accounts/${id}/login`)).json()).state, 'idle')

  // Au téléphone : l'écran tient dans la largeur.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' })
  await mobile.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  await mobile.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  const phone = await mobile.newPage()
  await phone.goto(`${base}/settings/comptes-codex`)
  await phone.getByText('Boulot', { exact: true }).waitFor()
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await phone.screenshot({ path: '/tmp/solera-codex-accounts-mobile.png' })
  await mobile.close()

  assert.deepEqual(errors, [])
  console.log('OK : création, clé API dans le home du compte, sélecteur Codex, déconnexion, code d’appareil, mobile.')
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
