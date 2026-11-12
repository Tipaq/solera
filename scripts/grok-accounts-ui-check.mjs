import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

// Comptes Grok supplémentaires : création, connexion par clé API et par code d'appareil,
// sélecteur de compte dans les défauts du CLI. Vrais composants, vraie API, base temporaire ;
// le CLI est le faux Grok des tests (`apps/server/test/fixtures/grok-agent.mjs`), qui parle
// comme Grok Build 1.0.62 sans joindre xAI.
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
  const grok = join(data, 'grok.mjs')
  await copyFile(join(serverDir, 'test/fixtures/grok-agent.mjs'), grok)
  await chmod(grok, 0o700)
  await writeFile(config, `[agents.claude]\nenabled = false\n[agents.opencode]\nenabled = false\n[agents.grok]\nbinary = "${grok}"\n`)
  const userGrokHome = join(data, 'user-grok')
  const env = {
    ...process.env,
    SOLERA_PORT: String(apiPort),
    SOLERA_HOST: '127.0.0.1',
    SOLERA_CONFIG: config,
    SOLERA_DATA_DIR: join(data, 'data'),
    SOLERA_WEB_ROOT: join(data, 'web'),
    // Le home Grok de « l'utilisateur », dont les comptes recopient la configuration, et une
    // confirmation de code d'appareil assez lente pour que l'écran montre l'attente.
    GROK_HOME: userGrokHome,
    FIXTURE_LOGIN_DELAY: '60000',
  }
  await mkdir(join(userGrokHome, 'sessions'), { recursive: true })
  await writeFile(join(userGrokHome, 'config.toml'), '[cli]\n')
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

  // L'ancienne adresse ouvre la modale des réglages sur la section Agents, à l'onglet de
  // Grok : les pages de comptes y sont fondues, un onglet par CLI (#120).
  await page.goto(`${base}/settings/comptes-grok`)
  await page.getByRole('dialog').getByRole('tab', { name: /Grok/, selected: true }).waitFor()

  // Créer un compte : il naît non connecté, avec les deux voies de connexion.
  await page.getByText('Aucun compte Grok').waitFor()
  await page.getByRole('button', { name: 'Connecter un compte' }).first().click()
  await page.getByLabel('Nom').fill('Perso')
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  // L'état se lit sur la ligne du compte : la carte « Connexion » du CLI, au-dessus dans
  // l'onglet, porte aussi un « Connecté » ou un « Non connecté », le sien.
  const row = page.getByRole('dialog').getByText('Perso', { exact: true }).locator('..')
  await row.getByText('Non connecté', { exact: true }).waitFor()
  const listed = await (await context.request.get(`${base}/api/grok-accounts`)).json()
  assert.equal(listed.accounts[0].status, 'pending')
  const id = listed.accounts[0].id
  const accountHome = join(data, 'data', 'grok-accounts', id)

  // Clé API : Grok l'écrit dans le home du compte ; elle ne revient jamais au navigateur.
  await page.getByRole('button', { name: 'Utiliser une clé API' }).click()
  await page.getByLabel('Clé API xAI').fill('xai-test-bogus-key')
  // Le bouton du formulaire : la carte « Connexion » du CLI a aussi son « Se connecter ».
  await page.locator('form', { has: page.getByLabel('Clé API xAI') }).getByRole('button', { name: 'Se connecter', exact: true }).click()
  await row.getByText('Connecté', { exact: true }).waitFor({ timeout: 30000 })
  await page.getByText('Clé API xAI', { exact: true }).waitFor()
  assert.ok(!(await page.content()).includes('xai-test-bogus-key'), 'La clé ne revient jamais au navigateur')
  assert.ok((await readFile(join(accountHome, 'auth.json'), 'utf8')).length > 0, 'auth.json est dans le home du compte')
  // Un home sans lien vers celui de l'utilisateur (#139) : sa configuration y est recopiée,
  // ses sessions n'y passent qu'une à une, quand un compte en reprend une.
  assert.ok((await lstat(join(accountHome, 'config.toml'))).isFile(), 'config.toml recopié, pas lié, dans le home du compte')
  assert.equal((await lstat(join(accountHome, 'sessions')).catch(() => null))?.isSymbolicLink() ?? false, false, 'les sessions ne sont pas liées au home de l’utilisateur')
  await page.screenshot({ path: '/var/tmp/solera-grok-accounts-desktop.png' })

  // Le sélecteur de compte dans les défauts de Grok. Il part sur le premier compte connecté
  // (#147) : avec un seul, rien ne s'écrirait. Un second, connecté par l'API, pour que le
  // choix ait à se garder ; il est retiré ensuite.
  const second = await (await context.request.post(`${base}/api/grok-accounts`, { data: { label: 'Travail' } })).json()
  const secondLogin = await context.request.post(`${base}/api/grok-accounts/${second.id}/login`, { data: { type: 'apiKey', apiKey: 'xai-test-other-key' } })
  assert.ok(secondLogin.ok(), await secondLogin.text())
  await page.goto(`${base}/settings/cli`)
  await page.getByRole('tab', { name: 'Grok' }).click()
  const account = page.getByRole('combobox', { name: 'Compte' })
  await account.waitFor()
  assert.equal(await account.textContent(), 'Perso', 'le premier compte connecté est choisi d’office')
  await account.click()
  assert.equal(await page.getByRole('option', { name: /Connexion du terminal/ }).count(), 0, 'pas de connexion du terminal (#147)')
  await page.getByRole('option', { name: 'Travail' }).click()
  let settings
  for (let tries = 0; tries < 50; tries++) {
    settings = await (await context.request.get(`${base}/api/me/settings`)).json()
    if (settings.agentDefaults.grok.account === second.id) break
    await delay(100)
  }
  assert.equal(settings.agentDefaults.grok.account, second.id)
  assert.ok((await context.request.delete(`${base}/api/grok-accounts/${second.id}`)).ok())

  // La jauge du compte, lue par `_x.ai/billing` dans son home.
  const usage = await (await context.request.get(`${base}/api/agents/grok/usage?account=${id}`)).json()
  assert.equal(usage.plan, 'X Premium')
  assert.equal(usage.windows[0]?.id, 'credits')

  // Déconnexion : le compte redevient en attente, sa connexion est retirée.
  await page.goto(`${base}/settings/comptes-grok`)
  await page.getByRole('button', { name: 'Déconnecter ce compte' }).click()
  await row.getByText('Non connecté', { exact: true }).waitFor({ timeout: 30000 })
  assert.equal((await (await context.request.get(`${base}/api/grok-accounts`)).json()).accounts[0].status, 'pending')
  assert.equal(await readFile(join(accountHome, 'auth.json'), 'utf8').catch(() => null), null, 'auth.json retiré')

  // Code d'appareil : l'écran montre l'URL et le code écrits par `grok login`, on annule.
  await page.getByRole('button', { name: "Se connecter par code d'appareil" }).click()
  await page.getByText('Ouvrir la page de connexion').waitFor({ timeout: 30000 })
  // Le code à côté du lien : la carte d'installation du CLI montre aussi son chemin en <code>.
  const deviceCode = page.getByRole('dialog').locator('div', { has: page.getByRole('link', { name: 'Ouvrir la page de connexion' }) }).last().locator('code')
  assert.equal(await deviceCode.textContent(), 'W68V-VRXD')
  const status = await (await context.request.get(`${base}/api/grok-accounts/${id}/login`)).json()
  assert.equal(status.state, 'pending')
  assert.equal(status.verificationUrl, 'https://accounts.x.ai/oauth2/device?user_code=W68V-VRXD')
  await page.screenshot({ path: '/var/tmp/solera-grok-accounts-device.png' })
  await page.getByRole('button', { name: 'Annuler' }).click()
  await page.getByRole('button', { name: "Se connecter par code d'appareil" }).waitFor()
  assert.equal((await (await context.request.get(`${base}/api/grok-accounts/${id}/login`)).json()).state, 'idle')

  // Au téléphone : l'écran tient dans la largeur.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' })
  await mobile.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  await mobile.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  const phone = await mobile.newPage()
  await phone.goto(`${base}/settings/comptes-grok`)
  await phone.getByText('Perso', { exact: true }).waitFor()
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await phone.screenshot({ path: '/var/tmp/solera-grok-accounts-mobile.png' })
  await mobile.close()

  assert.deepEqual(errors, [])
  console.log('OK : menu, création, clé API dans le home du compte, sélecteur Grok, jauge, déconnexion, code d’appareil, mobile.')
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
