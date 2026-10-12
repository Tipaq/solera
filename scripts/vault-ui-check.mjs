import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/**
 * Le vault de bout en bout : un dossier de notes sur le disque, l'index qui le lit, et
 * l'écran qui le dit.
 *
 * Les tests de `apps/server/test/vault-index.test.ts` prouvent les faits du texte ; ce
 * qu'ils ne peuvent pas prouver, c'est qu'un chemin saisi dans l'interface déclenche la
 * passe et que les comptes arrivent à l'écran. C'est tout ce que cette suite vérifie —
 * et elle le fait sur un vrai vault versionné, parce que le rattrapage par `git diff`
 * en dépend.
 *
 * Base, serveurs et vault sont jetables : aucune instance de l'utilisateur n'est
 * touchée.
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-vault-ui-'))
const children = []
let browser

async function port() {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const number = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return number
}

function run(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'pipe' })
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
  throw new Error(`Server did not start: ${child.diagnostics}`)
}

try {
  const vault = join(data, 'vault')
  const note = async (path, text) => {
    await mkdir(dirname(join(vault, path)), { recursive: true })
    await writeFile(join(vault, path), text)
  }
  const git = (...args) => {
    const done = spawnSync('git', args, { cwd: vault, encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
  }

  // Un vault d'essai : un carrefour, une ébauche, un lien cassé, et une orpheline.
  await note('Produit/Atelier.md', '# Atelier\n\nLe vault est un atelier. Voir [[Rapprochement]] et [[Disparue]].\n')
  await note('Produit/Rapprochement.md', '# Rapprochement\n\nUne raison en clair, un geste qui produit.\n')
  await note('Journal/2026-10-12.md', '# Six tours\n\nLe [[Rapprochement]] tient la page.\n')
  await note('Journal/2026-10-13.md', '# Portage\n\nL’index d’abord : [[Rapprochement]].\n')
  await note('Idées/Chantiers.md', '# Chantiers\n\nÉcarté pour l’instant : [[Rapprochement]].\n')
  await note('Idées/Index.md', '# Index\n\nDeux niveaux à ne pas confondre : [[Rapprochement]].\n')
  await note('Ébauche.md', '---\ntags: [brouillon]\n---\n\nRien encore, et personne ne la voit.\n')
  git('init', '--initial-branch=main')
  git('config', 'user.email', 'vault@solera.test')
  git('config', 'user.name', 'Vault')
  git('add', '--all')
  git('commit', '-m', 'le vault d’essai')

  const [apiPort, webPort] = await Promise.all([port(), port()])
  const config = join(data, 'config.toml')
  await writeFile(config, '[agents.claude]\nenabled = false\n[agents.codex]\nenabled = false\n')
  const env = {
    ...process.env,
    SOLERA_PORT: String(apiPort),
    SOLERA_HOST: '127.0.0.1',
    SOLERA_CONFIG: config,
    SOLERA_DATA_DIR: join(data, 'data'),
    SOLERA_WEB_ROOT: join(data, 'web'),
  }

  const seed = run(['--import', 'tsx', 'src/cli/demo-seed.ts'], serverDir, env)
  assert.equal((await once(seed, 'exit'))[0], 0, seed.diagnostics)

  const server = run(['--import', 'tsx', 'src/main.ts'], serverDir, env)
  const vite = run(
    [join(webDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    webDir,
    env,
  )
  const base = `http://127.0.0.1:${webPort}`
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`, server), ready(base, vite)])

  browser = await chromium.launch({ channel: 'chromium', chromiumSandbox: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-FR',
    colorScheme: 'dark',
    serviceWorkers: 'block',
  })
  await context.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  assert.ok((await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })).ok())

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  // Les réglages sont une modale, et `/settings/<section>` est l'ancienne adresse qui
  // l'ouvre : la viser vérifie les deux d'un coup.
  await page.goto(`${base}/settings/savoir`)
  await page.getByRole('heading', { name: 'Savoir', exact: true }).waitFor()
  await page.getByText('Pas encore de vault, donc rien à indexer.', { exact: true }).waitFor()

  const shots = join(root, 'docs/audits/2026-10-12-savoir/portage')
  await mkdir(shots, { recursive: true })
  await page.screenshot({ animations: 'disabled', path: join(shots, '01-reglage-vide-sombre.png') })

  // Un chemin relatif est refusé avant d'atteindre le serveur : le daemon n'a pas de
  // répertoire courant que l'utilisateur connaisse.
  const field = page.getByLabel('Dossier du vault', { exact: true })
  await field.fill('vault')
  await page.getByText('Le chemin doit être absolu.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled(), true)

  await field.fill(vault)
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()

  // L'index part sur le changement de chemin, sans qu'on ait à le demander.
  const counts = page.locator('dl div')
  await counts.filter({ hasText: 'notes' }).getByText('7', { exact: true }).waitFor()
  await counts.filter({ hasText: 'ébauches' }).getByText('1', { exact: true }).waitFor()
  // Sans lien entrant : Atelier, les deux journaux, Chantiers, Index, Ébauche.
  await counts.filter({ hasText: 'sans lien entrant' }).getByText('6', { exact: true }).waitFor()
  await counts.filter({ hasText: 'carrefours' }).getByText('1', { exact: true }).waitFor()
  await counts.filter({ hasText: 'liens cassés' }).getByText('1', { exact: true }).waitFor()
  await page.getByText(/^Reflète le commit /).waitFor()

  await page.screenshot({ animations: 'disabled', path: join(shots, '02-index-compte-sombre.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.screenshot({ animations: 'disabled', path: join(shots, '03-index-compte-clair.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })

  // Du travail fait ailleurs, pendant que l'écran reste ouvert : une note qui répare le
  // lien cassé, committée hors de Solera.
  await note('Produit/Disparue.md', '# Disparue\n\nElle existe, maintenant.\n')
  git('add', '--all')
  git('commit', '-m', 'la note qui manquait')

  await page.getByRole('button', { name: 'Tout réindexer', exact: true }).click()
  await counts.filter({ hasText: 'notes' }).getByText('8', { exact: true }).waitFor()
  await counts.filter({ hasText: 'liens cassés' }).getByText('0', { exact: true }).waitFor()
  await page.getByText('8 notes relues, 0 retirées.', { exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, '04-reindexation-sombre.png') })

  // Les faits du texte, tels que l'API les rend : c'est ce que le panneau lira.
  const facts = await (await context.request.get(`${base}/api/vault/notes/Produit/Rapprochement.md`)).json()
  assert.deepEqual(
    facts.incoming.map((link) => link.path).sort(),
    ['Idées/Chantiers.md', 'Idées/Index.md', 'Journal/2026-10-12.md', 'Journal/2026-10-13.md', 'Produit/Atelier.md'],
    'Les liens entrants sont exactement l’inversion des liens sortants',
  )
  const drafts = await (await context.request.get(`${base}/api/vault/notes?filter=drafts`)).json()
  assert.deepEqual(drafts.map((entry) => entry.path), ['Ébauche.md'], 'Une ébauche est une note sans dossier')

  // Mobile : l'écran tient sans débordement horizontal.
  await page.setViewportSize({ width: 390, height: 844 })
  await delay(350)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ animations: 'disabled', path: join(shots, '05-reglage-mobile-sombre.png') })

  assert.deepEqual(errors, [])
  console.log('OK : chemin refusé si relatif, index lancé au changement de chemin, cinq comptes, réindexation et liens entrants.')
} finally {
  await browser?.close()
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
  }
  await rm(data, { recursive: true, force: true })
}
