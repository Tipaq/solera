import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { _electron as electron } from 'playwright'

/**
 * La mise à jour de l'app de bureau, de bout en bout : une version A installée trouve la
 * version B dans un dossier servi en HTTP, comme une release, la télécharge, propose
 * « Redémarrer et mettre à jour » dans À propos, puis se remplace et se relance.
 *
 * Usage : node scripts/desktop-update-check.mjs --app <exécutable de A> --feed <dossier de B>
 *
 * A est une app NSIS installée sous Windows, une .app dans un dossier où l'on peut écrire
 * sous macOS, une AppImage ou un .deb installé sous Linux (avec un écran : xvfb-run). Le
 * dossier de B contient ses paquets et ses latest*.yml, tels qu'electron-builder les écrit.
 *
 * Le profil de l'app va dans un dossier jetable (SOLERA_DESKTOP_USER_DATA). Sous Windows,
 * il faut en plus qu'aucun profil Solera n'existe : l'installeur relance l'app par le shell
 * (ExecShellAsUser), sans l'environnement du contrôle, et une jonction temporaire mène alors
 * le profil par défaut au dossier jetable. Sous Linux, APPIMAGE=<fichier> fait éprouver le
 * remplacement du fichier à un exécutable décompressé couvert par un profil AppArmor, là où
 * une AppImage extraite perdrait son bac à sable.
 */
const { values } = parseArgs({ options: { app: { type: 'string' }, feed: { type: 'string' } } })
if (!values.app || !values.feed) {
  console.error('usage: node scripts/desktop-update-check.mjs --app <exécutable> --feed <dossier>')
  process.exit(1)
}
const executable = resolve(values.app)
const feed = resolve(values.feed)
const bundle = process.platform === 'darwin' ? resolve(executable, '..', '..', '..') : null
const appImage = process.env.APPIMAGE ? resolve(process.env.APPIMAGE) : executable

const channelFile =
  process.platform === 'darwin'
    ? 'latest-mac.yml'
    : process.platform === 'win32'
      ? 'latest.yml'
      : process.arch === 'arm64'
        ? 'latest-linux-arm64.yml'
        : 'latest-linux.yml'
const channel = readFileSync(join(feed, channelFile), 'utf8')
const target = /^version: (.+)$/m.exec(channel)?.[1]?.trim()
assert.ok(target, `pas de version dans ${channelFile}`)
// Une AppImage ne dit pas sa version de l'extérieur : on compare le fichier à l'empreinte du flux.
const appImageSha512 = /- url: \S+\.AppImage\s+sha512: (\S+)/.exec(channel)?.[1]

function sha512(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

function installedVersion() {
  if (bundle) {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(bundle, 'Contents', 'Info.plist')], {
      encoding: 'utf8',
    }).trim()
  }
  if (process.platform === 'win32') {
    // Absent le temps que l'installeur le remplace ; sa version a quatre parties (0.0.2.0).
    const script = `(Get-Item -LiteralPath '${executable}' -ErrorAction SilentlyContinue).VersionInfo.ProductVersion`
    return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
      .trim()
      .replace(/^(\d+\.\d+\.\d+)\.0$/, '$1')
  }
  const debPackage = ownerPackage(executable)
  if (debPackage) return execFileSync('dpkg-query', ['-W', '-f=${Version}', debPackage], { encoding: 'utf8' }).trim()
  return existsSync(appImage) && sha512(appImage) === appImageSha512 ? target : 'autre'
}

/** Le paquet .deb auquel appartient l'exécutable, s'il y en a un. */
function ownerPackage(file) {
  try {
    return execFileSync('dpkg', ['-S', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(':')[0].trim()
  } catch {
    return null
  }
}

/** Les process de l'app installée, la fenêtre relancée comprise, mais pas ses auxiliaires. */
function appProcesses() {
  if (process.platform === 'win32') {
    // `exit 0` : sans process à lister, PowerShell sortirait en erreur.
    const script = `Get-Process -Name Solera -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${executable}' } | ForEach-Object { $_.Id }; exit 0`
    return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number)
  }
  // Sous Linux, l'AppImage relancée tourne depuis son point de montage : c'est le nom du
  // binaire qui la reconnaît. Sous macOS, le chemin de l'exécutable.
  const lines = execFileSync('ps', [bundle ? '-axo' : '-eo', 'pid=,comm=,args='], { encoding: 'utf8' }).split('\n')
  return lines
    .map((line) => /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter((match) => match && (bundle ? match[3].startsWith(executable) : match[2] === 'solera' && !match[3].includes('--type=')))
    .map((match) => Number(match[1]))
}

async function waitFor(what, test, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await test()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`délai dépassé : ${what}`)
    await delay(1000)
  }
}

// La version B, servie comme le seraient les fichiers d'une release.
const server = createServer((req, res) => {
  const file = join(feed, decodeURIComponent(new URL(req.url, 'http://feed').pathname))
  if (!file.startsWith(feed + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-length': statSync(file).size })
  createReadStream(file).pipe(res)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const feedUrl = `http://127.0.0.1:${server.address().port}/`

const scratch = await mkdtemp(join(tmpdir(), 'solera-update-check-'))
const userData = join(scratch, 'user-data')
const shots = join(scratch, 'shots')
await mkdir(shots)
let app
let page
let profileLink
let launchAttempted = false

try {
  if (process.platform === 'win32') {
    assert.ok(process.env.LOCALAPPDATA, 'LOCALAPPDATA est nécessaire pour isoler le profil du contrôle')
    assert.equal(appProcesses().length, 0, "fermer l'app installée avant le contrôle")
    await mkdir(userData, { recursive: true })
    const destination = join(process.env.LOCALAPPDATA, 'Solera')
    // Jamais par-dessus un profil existant : `symlink` échoue si le dossier est là. La
    // relance par ExecShellAsUser n'hérite pas forcément de SOLERA_DESKTOP_USER_DATA.
    await symlink(userData, destination, 'junction')
    profileLink = destination
  }
  const before = installedVersion()
  assert.notEqual(before, target, `l'app installée est déjà en ${target}`)
  console.log(`app installée : ${before}, version proposée : ${target}`)

  launchAttempted = true
  app = await electron.launch({
    executablePath: executable,
    env: { ...process.env, SOLERA_DESKTOP_USER_DATA: userData, SOLERA_DESKTOP_UPDATE_FEED: feedUrl },
    // Sinon Playwright coupe le bac à sable sous Linux, et l'app relancée en hériterait.
    chromiumSandbox: true,
    timeout: 120_000,
  })
  const exited = new Promise((done) => app.process().once('exit', done))
  page = await app.firstWindow({ timeout: 120_000 })
  await page.waitForURL(/\/bienvenue$/, { timeout: 60_000 })
  await page.getByRole('button', { name: /^(Passer la visite|Skip the tour)$/ }).click()
  await page.getByRole('heading', { level: 1, name: /^(C'est prêt|All set)$/ }).waitFor()
  await page.getByRole('button', { name: /^(Créer mon premier projet|Create my first project)$/ }).click()
  await page.waitForURL(/\/projects\/new$/)
  await page.goto(new URL('/settings/a-propos', page.url()).href)

  // La recherche tout de suite, plutôt que d'attendre les dix secondes du lancement.
  await page.evaluate(() => window.soleraDesktop.updates.check())
  const seen = []
  const ready = await waitFor(
    'version prête',
    async () => {
      const state = await page.evaluate(() => window.soleraDesktop.updates.state())
      if (seen.at(-1) !== state.status) seen.push(state.status)
      if (state.status === 'error' || state.status === 'unsupported') throw new Error(`mise à jour : ${JSON.stringify(state)}`)
      return state.status === 'ready' ? state : null
    },
    600_000,
  )
  console.log(`états : ${seen.join(' → ')}`)
  assert.equal(ready.version, target)

  const install = page.getByRole('button', { name: /Redémarrer et mettre à jour|Restart and update/ })
  await install.waitFor()
  await page.screenshot({ path: join(shots, 'about-ready.png'), fullPage: true })
  await install.click()
  // Les réglages sont eux-mêmes un dialogue : on vise la confirmation par son titre.
  await page
    .getByRole('dialog', { name: /Redémarrer Solera|Restart Solera/ })
    .getByRole('button', { name: /Redémarrer et mettre à jour|Restart and update/ })
    .click()

  await Promise.race([
    exited,
    delay(120_000, undefined, { ref: false }).then(() => {
      throw new Error("l'app ne s'est pas fermée pour s'installer")
    }),
  ])
  app = null
  page = null
  console.log('app fermée pour la mise à jour')

  await waitFor(`app installée en ${target}`, () => installedVersion() === target, 300_000)
  console.log(`app installée en ${target}`)
  if (bundle) {
    // Le verdict du script d'échange, qui l'écrit juste après avoir mis la nouvelle app en place.
    const result = join(userData, 'update-result')
    await waitFor("verdict de l'échange", () => existsSync(result), 30_000)
    assert.equal(readFileSync(result, 'utf8').trim(), 'ok')
  }

  const relaunched = await waitFor('app relancée', () => appProcesses().length > 0 && appProcesses(), 120_000)
  console.log(`app relancée (process ${relaunched.join(', ')})`)
  await waitFor('serveur relancé', async () => {
    const { port } = JSON.parse(readFileSync(join(userData, 'desktop.json'), 'utf8'))
    return fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) })
      .then((response) => response.ok).catch(() => false)
  }, 120_000)
  console.log('contrôle de mise à jour réussi (serveur relancé et disponible)')
} catch (err) {
  await page?.screenshot({ path: join(shots, 'failure.png'), fullPage: true }).catch(() => {})
  for (const name of ['updater.log', 'server.log', 'performance.jsonl']) {
    const log = join(userData, 'logs', name)
    if (existsSync(log)) console.log(`--- ${name}\n${readFileSync(log, 'utf8').slice(-16000)}`)
  }
  console.log(`captures : ${shots}`)
  throw err
} finally {
  await app?.close().catch(() => {})
  server.close()
  for (const pid of launchAttempted ? appProcesses() : []) {
    try {
      process.kill(pid)
    } catch {
      // Déjà sorti.
    }
  }
  // La jonction seule, celle de ce contrôle : jamais de suppression récursive d'un profil.
  if (profileLink) await unlink(profileLink)
  if (process.env.KEEP_DESKTOP_CHECK !== '1') await rm(scratch, { recursive: true, force: true }).catch(() => {})
}
