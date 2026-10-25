import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

// Ce que l'interface montre de l'app de bureau, sans Electron : un faux pont
// `window.soleraDesktop` posé avant le chargement, sur le vrai serveur et le vrai Vite.
// - À propos suit la mise à jour (téléchargement, version prête, confirmation, échec,
//   build qui ne se met pas à jour) ;
// - la barre de titre prend la place des barres natives, décale le calque de
//   l'application, ouvre le menu hors de macOS et recopie le thème sur les contrôles ;
// - dans un navigateur, sans pont, rien de tout cela n'existe.
// Les captures vont dans DESKTOP_UPDATES_SHOTS, ou dans un dossier temporaire.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-desktop-updates-check-'))
const shots = process.env.DESKTOP_UPDATES_SHOTS ?? (await mkdtemp(join(tmpdir(), 'solera-desktop-updates-shots-')))
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

/** Un contexte connecté, avec ou sans le faux pont de bureau. */
async function newContext(base, { platform, width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript(({ origin, platform }) => {
    if (window !== window.top || location.origin !== origin) return
    localStorage.setItem('solera.locale', 'fr')
    if (!platform) return
    let state = { status: 'idle', checkedAt: null }
    const listeners = new Set()
    window.probe = {
      checks: 0,
      installs: 0,
      menus: 0,
      colors: [],
      publish(next) {
        state = next
        for (const listener of listeners) listener(next)
      },
    }
    window.soleraDesktop = {
      updates: {
        state: async () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        check: async () => { window.probe.checks++ },
        install: async () => { window.probe.installs++ },
      },
      window: {
        platform,
        menu: async () => { window.probe.menus++ },
        colors: async (...colors) => { window.probe.colors.push(colors) },
      },
    }
  }, { origin: new URL(base).origin, platform })
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  return context
}

try {
  const apiPort = await freePort()
  const webPort = await freePort()
  const config = join(data, 'config.toml')
  await writeFile(config, '[agents.opencode]\nenabled = false\n')
  const env = {
    ...process.env,
    SOLERA_PORT: String(apiPort),
    SOLERA_HOST: '127.0.0.1',
    SOLERA_CONFIG: config,
    SOLERA_DATA_DIR: join(data, 'data'),
    SOLERA_WEB_ROOT: join(data, 'web'),
    // Le serveur ne lit aucune release : seule l'app de bureau annonce une version.
    SOLERA_UPDATE_REPO: '',
  }
  const server = run(['--import', 'tsx', 'src/main.ts'], serverDir, env)
  const vite = run([join(webDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], webDir, env)
  const base = `http://127.0.0.1:${webPort}`
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`, server), ready(base, vite)])
  const seed = run(['--import', 'tsx', 'src/cli/demo-seed.ts'], serverDir, env)
  const [seedCode] = await once(seed, 'exit')
  assert.equal(seedCode, 0, seed.diagnostics)

  browser = await launchBrowser()
  const errors = []

  // 1. Windows : la barre de titre, son menu, le calque décalé, le thème recopié.
  const desktop = await newContext(base, { platform: 'win32' })
  const page = await desktop.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/`)
  const bar = page.locator('.desktop-titlebar')
  await bar.waitFor()
  assert.equal((await bar.boundingBox())?.height, 36)
  const layer = await page.locator('.app-layer').first().boundingBox()
  assert.equal(layer?.y, 36, 'le calque commence sous la barre')
  assert.equal(layer.y + layer.height, 900, 'et finit au bas de la fenêtre')
  await bar.getByRole('button', { name: "Menu de l'application" }).click()
  assert.equal(await page.evaluate(() => window.probe.menus), 1)
  await page.keyboard.press('Escape')
  for (const theme of ['light', 'dark', 'dark-contrast']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    await delay(100)
    await bar.screenshot({ path: join(shots, `titlebar-win32-${theme}.png`) })
  }
  const colors = await page.evaluate(() => window.probe.colors)
  assert.ok(colors.flat().every((color) => /^#[0-9a-f]{6}$/.test(color)), JSON.stringify(colors))
  assert.ok(new Set(colors.map(([background]) => background)).size >= 3, 'un fond par thème')
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })

  // Les réglages sont un dialogue modal : la barre reste au-dessus, son menu en sommeil
  // (le reste de la page est inerte) tandis que la fenêtre se déplace toujours par elle.
  await page.goto(`${base}/settings/a-propos`)
  const settings = page.getByRole('dialog')
  await settings.getByRole('heading', { name: 'À propos', exact: true }).waitFor()

  // 2. À propos suit la mise à jour : en attente, téléchargement, version prête.
  assert.equal(await settings.getByRole('heading', { name: /Nouveautés/ }).count(), 0, 'rien à annoncer au repos')
  await page.evaluate(() => window.probe.publish({ status: 'downloading', version: '9.9.9', percent: 42 }))
  await settings.getByRole('heading', { name: 'Nouveautés de la version 9.9.9' }).waitFor()
  await settings.getByText('Téléchargement de la version 9.9.9…').waitFor()
  assert.equal(await settings.getByRole('progressbar').getAttribute('aria-valuenow'), '42')
  await settings.getByRole('button', { name: 'Vérifier maintenant' }).click()
  assert.equal(await page.evaluate(() => window.probe.checks), 1, 'vérifier interroge aussi l\'app')
  await page.screenshot({ path: join(shots, 'about-downloading.png') })

  await page.evaluate(() => window.probe.publish({ status: 'ready', version: '9.9.9', installOnQuit: true }))
  await settings.getByText(/La version 9\.9\.9 est téléchargée\. Elle s'installera/).waitFor()
  await page.screenshot({ path: join(shots, 'about-ready.png') })
  await settings.getByRole('button', { name: 'Redémarrer et mettre à jour', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Redémarrer Solera pour le mettre à jour ?' })
  await confirm.getByText(/installer la version 9\.9\.9/).waitFor()
  assert.equal(await confirm.getByText(/mot de passe/).count(), 0)
  await page.screenshot({ path: join(shots, 'about-confirm.png') })
  await confirm.getByRole('button', { name: 'Redémarrer et mettre à jour' }).click()
  assert.equal(await page.evaluate(() => window.probe.installs), 1)

  // Le .deb : l'installation demande le mot de passe, et ne part pas à la fermeture.
  await page.evaluate(() => window.probe.publish({ status: 'ready', version: '9.9.9', installOnQuit: false }))
  await settings.getByText(/Son installation demande votre mot de passe/).waitFor()

  await page.evaluate(() => window.probe.publish({ status: 'installing', version: '9.9.9' }))
  await settings.getByText('Installation de la version 9.9.9 : Solera va se rouvrir de lui-même.').waitFor()

  // 3. Un échec pendant le téléchargement : le message, l'autorisation macOS, réessayer.
  await page.evaluate(() => window.probe.publish({ status: 'downloading', version: '9.9.9', percent: 80 }))
  await page.evaluate(() =>
    window.probe.publish({ status: 'error', message: 'sha512 checksum mismatch', version: '9.9.9', macPermission: false }),
  )
  await settings.getByText('La mise à jour a échoué : sha512 checksum mismatch').waitFor()
  await settings.getByText(/télécharger la nouvelle version depuis sa page GitHub/).waitFor()
  assert.equal(await settings.getByText(/Gestion des apps/).count(), 0)
  await page.evaluate(() =>
    window.probe.publish({ status: 'error', message: 'EPERM: operation not permitted', version: '9.9.9', macPermission: true }),
  )
  await settings.getByText(/Gestion des apps/).waitFor()
  await page.screenshot({ path: join(shots, 'about-failed.png') })
  await settings.getByRole('button', { name: 'Réessayer' }).click()
  assert.equal(await page.evaluate(() => window.probe.checks), 2)

  // 4. Une recherche ratée, sans version (dépôt privé, réseau coupé), et un build qui ne
  //    se met pas à jour seul : rien à annoncer, la carte n'apparaît pas.
  for (const state of [
    { status: 'error', message: 'HttpError: 404', version: null, macPermission: false },
    { status: 'unsupported', reason: 'development' },
  ]) {
    await page.evaluate((state) => window.probe.publish(state), state)
    await settings.getByRole('heading', { name: /Nouveautés/ }).waitFor({ state: 'detached' })
  }
  await desktop.close()

  // 5. macOS : les feux à gauche, pas de bouton de menu.
  const mac = await newContext(base, { platform: 'darwin' })
  const macPage = await mac.newPage()
  macPage.on('pageerror', (error) => errors.push(error.message))
  await macPage.goto(`${base}/`)
  const macBar = macPage.locator('.desktop-titlebar')
  await macBar.waitFor()
  assert.equal(await macBar.getByRole('button').count(), 0)
  const name = await macBar.getByText('Solera', { exact: true }).boundingBox()
  assert.ok(name && name.x >= 80, `le nom laisse la place des feux (x = ${name?.x})`)
  await macBar.screenshot({ path: join(shots, 'titlebar-darwin.png') })
  await mac.close()

  // 6. Dans un navigateur : ni barre, ni décalage.
  const web = await newContext(base)
  const webPage = await web.newPage()
  webPage.on('pageerror', (error) => errors.push(error.message))
  await webPage.goto(`${base}/settings/a-propos`)
  await webPage.getByRole('heading', { name: 'À propos', exact: true }).waitFor()
  assert.equal(await webPage.locator('.desktop-titlebar').count(), 0)
  assert.equal(await webPage.evaluate(() => document.documentElement.dataset.desktopChrome), undefined)
  assert.equal((await webPage.locator('.app-layer').first().boundingBox())?.y, 0)
  await web.close()

  assert.deepEqual(errors, [])
  console.log(`desktop-updates-ui-check: ok — captures dans ${shots}`)
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
