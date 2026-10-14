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
  const facts = await (await context.request.get(`${base}/api/vault/note?path=${encodeURIComponent('Produit/Rapprochement.md')}`)).json()
  assert.deepEqual(
    facts.incoming.map((link) => link.path).sort(),
    ['Idées/Chantiers.md', 'Idées/Index.md', 'Journal/2026-10-12.md', 'Journal/2026-10-13.md', 'Produit/Atelier.md'],
    'Les liens entrants sont exactement l’inversion des liens sortants',
  )
  const drafts = await (await context.request.get(`${base}/api/vault/notes?filter=drafts`)).json()
  assert.deepEqual(drafts.map((entry) => entry.path), ['Ébauche.md'], 'Une ébauche est une note sans dossier')


  // ── Le lieu Savoir, la page du vault, l'éditeur et le panneau ───────────────────

  // Les réglages sont une modale : tant qu'elle est ouverte, la colonne est derrière.
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })

  // Le lieu est allumé par défaut : la colonne doit le porter sans rien régler.
  await page.locator('[aria-label="Lieux"]').getByRole('button', { name: 'Savoir', exact: true }).click()
  await page.waitForURL('**/vault')

  // La colonne dit ce qui réclame, et les comptes viennent de l'index.
  await page.getByRole('link', { name: /^Ébauches/ }).waitFor()
  await page.getByRole('link', { name: /^Sans lien entrant/ }).waitFor()
  await page.getByRole('link', { name: /^Carrefours/ }).waitFor()
  // Récentes : la porte réelle du lieu. Le degré entrant suit le titre, pour qui range.
  await page.getByRole('link', { name: /^Disparue/ }).waitFor()

  // L'atelier ouvre sur la dernière note touchée, pas sur un choix à faire.
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.locator('.cm-content').waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, '06-atelier-sombre.png') })

  // Une note ouverte depuis la colonne : son titre et son dossier sont dans la bande.
  await page.getByRole('link', { name: /^Rapprochement\b/ }).first().click()
  await page.waitForURL('**/vault/note/Produit/Rapprochement.md')
  await page.getByRole('heading', { level: 1, name: /Produit\s+Rapprochement/ }).waitFor()
  // Cinq notes la citent : la pastille le dit, et c'est un fait du texte.
  await page.getByText('5 liens entrants', { exact: true }).waitFor()

  // Le panneau s'ouvre depuis la bande de la note, et retient son état.
  await page.getByRole('button', { name: 'Ouvrir le panneau', exact: true }).click()

  // Liens montre l'inversion exacte des liens sortants.
  await page.getByRole('button', { name: 'Liens, 5 entrants', exact: true }).click()
  await page.getByRole('heading', { name: 'Qui cite cette note (5)', exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Ce qu’elle cite (0)', exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, '07-panneau-liens-sombre.png') })

  // Rapprochements : la vue existe, son calcul n'est pas là, et elle le dit.
  await page.getByRole('button', { name: 'Rapprochements', exact: true }).click()
  await page.getByText('Les rapprochements ne sont pas encore calculés.', { exact: true }).waitFor()

  // Historique : ce que git raconte de cette note.
  await page.getByRole('button', { name: 'Historique', exact: true }).click()
  await page.getByText('le vault d’essai', { exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, '08-panneau-historique-sombre.png') })

  // L'écriture au centre, et l'enregistrement à la pause de frappe.
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nUne phrase tapée dans l’atelier.\n')
  // L'index relit la note : l'historique doit alors dire qu'elle n'est plus committée.
  await page.getByText('Modifiée depuis le dernier commit. Enregistrer n’est pas committer.', { exact: true }).waitFor()

  // `[[` ouvre le sélecteur de note, et le lien devient un fait dès l'enregistrement.
  await page.keyboard.type('Voir [[Atel')
  await page.getByRole('option', { name: /Atelier/ }).first().click()
  await page.getByRole('button', { name: /^Liens/ }).click()
  await page.getByRole('heading', { name: 'Ce qu’elle cite (1)', exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, '09-lien-ecrit-sombre.png') })

  // Le lien écrit se suit d'un clic : c'est le geste qui fait du vault un atelier.
  await page.locator('.cm-vault-link').first().click()
  await page.waitForURL('**/vault/note/Produit/Atelier.md')

  // Créer dans un dossier : le titre se tape dans l'arbre, et la note hérite du dossier.
  await page.getByRole('button', { name: 'Notes', exact: true }).click()
  const folder = page.getByRole('button', { name: /^Journal/ })
  await folder.hover()
  await page.getByRole('button', { name: 'Nouvelle note dans « Journal »', exact: true }).click()
  await page.getByPlaceholder('Titre de la note').fill('Note née dans l’arbre')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/vault/note/Journal/Note%20n%C3%A9e%20dans%20l%E2%80%99arbre.md')
  await page.getByRole('heading', { level: 1, name: /Journal\s+Note née dans l’arbre/ }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, '10-panneau-arbre-sombre.png') })

  // Parcourir : les colonnes qu'on trie, quand on range plutôt qu'on écrit.
  await page.getByRole('link', { name: /^Sans lien entrant/ }).click()
  await page.waitForURL('**/vault/parcourir?liste=orphans')
  await page.getByRole('columnheader', { name: /Entrants/ }).waitFor()
  await page.getByRole('cell', { name: 'Note née dans l’arbre' }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, '11-parcourir-sombre.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.screenshot({ animations: 'disabled', path: join(shots, '12-parcourir-clair.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })

  // Le tri se demande à la colonne, et change l'ordre des lignes.
  const firstCell = () => page.locator('tbody tr').first().locator('td').first().innerText()
  const byRecency = await firstCell()
  await page.getByRole('table').getByRole('button', { name: 'Note', exact: true }).click()
  assert.notEqual(await firstCell(), byRecency, 'Trier par titre doit changer la première ligne')


  // Mobile : l'écran tient sans débordement horizontal.
  await page.setViewportSize({ width: 390, height: 844 })
  await delay(350)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ animations: 'disabled', path: join(shots, '13-parcourir-mobile-sombre.png') })

  // La page du vault au doigt : l'écriture occupe l'écran, le panneau le recouvre.
  await page.goto(`${base}/vault/note/Produit/Atelier.md`)
  await page.locator('.cm-content').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ animations: 'disabled', path: join(shots, '14-atelier-mobile-sombre.png') })

  assert.deepEqual(errors, [])
  console.log('OK : réglage du vault, lieu Savoir, atelier, [[lien]] écrit puis suivi, panneau (Liens, Historique, arbre), création dans un dossier, Parcourir trié, et les deux écrans au doigt.')
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
