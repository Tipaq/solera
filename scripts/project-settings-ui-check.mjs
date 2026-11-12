import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'

/*
 * Les réglages d'un projet (page projet v2, PP-21) : une page à menu gauche, un
 * brouillon unique, la recherche à la demande.
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas : que les modifications se
 * comptent dans la barre et sur leur catégorie, qu'Annuler les efface, qu'Enregistrer
 * les envoie en **un seul** `PATCH` qui ne porte qu'elles ; que la recherche s'ouvre
 * par `/`, choisit au clavier et amène le réglage à l'écran ; que le menu suit la
 * lecture et qu'un clic y fixe l'élément choisi ; que la Zone de danger retire
 * vraiment le projet ; que les consignes changent de mode, écrivent `AGENTS.md` dans le
 * dépôt et disent ce que chaque CLI en lit ; qu'un projet partagé se lit sans se régler ; et qu'au téléphone
 * un sélecteur remplace le menu. Les captures vont par bloc, en 1280 et 390 px.
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-project-settings-check-'))
const shots = join(root, 'docs/audits/2026-11-11-reglages-projet')
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

async function until(read, accept, what) {
  for (let i = 0; i < 50; i++) {
    const value = await read()
    if (accept(value)) return value
    await delay(100)
  }
  throw new Error(`Jamais atteint : ${what}`)
}

try {
  const apiPort = await freePort()
  const webPort = await freePort()
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
  const server = run(['--import', 'tsx', 'src/main.ts'], serverDir, env)
  const vite = run([join(webDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], webDir, env)
  const base = `http://127.0.0.1:${webPort}`
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`, server), ready(base, vite)])
  const seed = run(['--import', 'tsx', 'src/cli/demo-seed.ts'], serverDir, env)
  const [seedCode] = await once(seed, 'exit')
  assert.equal(seedCode, 0, seed.diagnostics)

  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript((origin) => {
    if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const nimbus = projects.find((entry) => entry.name === 'Nimbus')
  const docs = projects.find((entry) => entry.name === 'Docs')
  assert.ok(nimbus && docs)
  const reread = async (id = nimbus.id) => (await (await context.request.get(`${base}/api/projects`)).json()).find((entry) => entry.id === id)

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mkdir(shots, { recursive: true })
  const shot = (locator, name) => locator.screenshot({ animations: 'disabled', path: join(shots, `${name}.png`) })

  // ─── La page : menu, catégories, groupes ──────────────────────────────────
  await page.goto(`${base}/p/${nimbus.id}/settings`)
  const menu = page.getByRole('complementary', { name: 'Sections des réglages', exact: true })
  await menu.waitFor()
  const categories = await menu.locator('nav > div button, nav > div > div > button').evaluateAll((buttons) =>
    buttons.filter((button) => button.classList.contains('h-9')).map((button) => button.textContent.trim()))
  assert.deepEqual(categories, ['Général', 'Agents', 'Intégrations', 'Zone de danger'], 'Les quatre catégories, la Zone de danger en bas')
  for (const group of ['Identité', 'Apparence', 'Exécution']) await menu.getByRole('button', { name: group, exact: true }).waitFor()
  // La Zone de danger n'a pas de sous-catégorie dans le menu.
  assert.equal(await menu.getByRole('button', { name: 'Irréversible', exact: true }).count(), 0)
  // La catégorie lue en premier est Général, et son premier groupe.
  assert.equal(await menu.getByRole('button', { name: 'Général', exact: true }).getAttribute('aria-current'), 'location')
  assert.equal(await menu.getByRole('button', { name: 'Identité', exact: true }).getAttribute('aria-current'), 'location')
  // L'ancienne page a disparu : ni carte-lien Board ni Worktrees, ni badges d'état.
  for (const gone of ['Ouvrir le board', 'Voir les worktrees']) {
    assert.equal(await page.getByRole('button', { name: gone }).count(), 0, `${gone} a disparu`)
  }
  // Les réglages de Général, avec leurs valeurs.
  const row = (id) => page.locator(`#reglage-${id}`)
  assert.equal(await row('name').getByRole('textbox').inputValue(), 'Nimbus')
  await row('cap').getByRole('textbox', { name: 'Cap' }).waitFor()
  await row('color').getByRole('radiogroup', { name: 'Couleur' }).waitFor()
  await row('image').getByRole('button', { name: 'Changer' }).waitFor()
  await row('checkpoints').getByRole('switch').waitFor()
  await row('environment').waitFor()
  await row('remove').getByRole('button', { name: 'Retirer le projet' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await shot(page.locator('[data-place-content]'), '1280-page')
  await shot(menu, '1280-menu')
  for (const [anchor, name] of [['reglages-general-0', 'identite'], ['reglages-general-1', 'apparence'], ['reglages-general-2', 'execution'], ['reglages-danger', 'zone-de-danger']]) {
    await shot(page.locator(`#${anchor}`), `1280-${name}`)
  }

  // ─── Le brouillon : compter, annuler ──────────────────────────────────────
  const bar = page.getByText(/^\d+ modifications? non enregistrées?$/)
  // Les gestes de la barre, pas ceux des blocs qui ont encore les leurs (consignes…).
  const barButton = (name) => page.locator('[aria-live="polite"]').getByRole('button', { name, exact: true })
  await row('name').getByRole('textbox').fill('Nimbus 2')
  await row('color').getByRole('radio', { name: 'Vert' }).click()
  await bar.filter({ hasText: '2 modifications non enregistrées' }).waitFor()
  await menu.getByRole('button', { name: /^Général/ }).getByRole('img', { name: 'Modifications en attente' }).waitFor()
  await row('name').getByRole('img', { name: 'Modifié, pas encore enregistré' }).waitFor()
  await shot(page.locator('[data-place-content]'), '1280-brouillon')
  // Revenir à la valeur enregistrée efface la modification d'elle-même.
  await row('name').getByRole('textbox').fill('Nimbus')
  await bar.filter({ hasText: '1 modification non enregistrée' }).waitFor()
  await barButton('Annuler').click()
  await bar.waitFor({ state: 'detached' })
  assert.equal(await row('color').getByRole('radio', { name: 'Vert' }).getAttribute('aria-checked'), 'false')
  // Un nom vidé ne part pas : la barre le dit, Enregistrer attend.
  await row('name').getByRole('textbox').fill('  ')
  await page.getByText('Le projet a besoin d’un nom.', { exact: true }).waitFor()
  assert.ok(await barButton('Enregistrer').isDisabled())
  await barButton('Annuler').click()

  // ─── Enregistrer : un seul PATCH, avec les seuls champs modifiés ──────────
  await row('cap').getByRole('textbox').fill('  Un Solera qui se pilote depuis le téléphone.  ')
  await row('color').getByRole('radio', { name: 'Vert' }).click()
  await row('visibility').getByRole('radio', { name: 'Partagé' }).click()
  await row('checkpoints').getByRole('switch').click()
  const patches = []
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/projects/${nimbus.id}`) patches.push(request.postDataJSON())
  })
  await barButton('Enregistrer').click()
  await page.getByText('4 réglages enregistrés.', { exact: true }).waitFor()
  assert.deepEqual(patches, [{ cap: 'Un Solera qui se pilote depuis le téléphone.', color: '#5BC98C', visibility: 'shared', turnCheckpoints: false }], 'Un seul PATCH, les seuls champs modifiés')
  const saved = await reread()
  assert.equal(saved.cap, 'Un Solera qui se pilote depuis le téléphone.')
  assert.equal(saved.color, '#5BC98C')
  assert.equal(saved.visibility, 'shared')
  assert.equal(saved.turnCheckpoints, false)
  await shot(page.locator('[data-place-content]'), '1280-enregistre')
  // Le retour s'efface de lui-même, et la page relit l'enregistré sans point « modifié ».
  await page.getByText('4 réglages enregistrés.', { exact: true }).waitFor({ state: 'detached', timeout: 6000 })
  assert.equal(await page.getByRole('img', { name: 'Modifié, pas encore enregistré' }).count(), 0)

  // ─── Recherche : `/`, clavier, surbrillance ───────────────────────────────
  await page.locator('body').click({ position: { x: 900, y: 300 } })
  await page.keyboard.press('/')
  const palette = page.getByRole('dialog', { name: 'Rechercher un réglage', exact: true })
  await palette.waitFor()
  await palette.getByText('↑↓ pour choisir, Entrée pour y aller, Échap pour fermer.').waitFor()
  await palette.getByRole('searchbox').fill('xyzzy')
  await palette.getByText('Aucun réglage pour « xyzzy ».').waitFor()
  await palette.getByRole('searchbox').fill('point reprise')
  await palette.getByRole('option').first().waitFor()
  await shot(palette, '1280-recherche')
  await page.keyboard.press('Enter')
  await palette.waitFor({ state: 'detached' })
  await until(() => row('checkpoints').evaluate((element) => element.className), (className) => className.includes('bg-accent-wash'), 'réglage surligné')
  await until(() => row('checkpoints').evaluate((element) => {
    const box = element.getBoundingClientRect()
    return box.top >= 0 && box.bottom <= innerHeight
  }), Boolean, 'réglage amené à l’écran')
  // Échap ferme ; `/` dans un champ s'écrit au lieu d'ouvrir la palette.
  await page.getByRole('button', { name: 'Rechercher un réglage', exact: true }).first().click()
  await palette.waitFor()
  await page.keyboard.press('Escape')
  await palette.waitFor({ state: 'detached' })
  await row('cap').getByRole('textbox').focus()
  await page.keyboard.press('End')
  await page.keyboard.type('/')
  assert.equal(await palette.count(), 0, '`/` dans un champ ne lance pas la recherche')
  await barButton('Annuler').click()

  // ─── Le menu suit la lecture ──────────────────────────────────────────────
  await menu.getByRole('button', { name: 'Exécution', exact: true }).click()
  await until(() => menu.getByRole('button', { name: 'Exécution', exact: true }).getAttribute('aria-current'), (value) => value === 'location', 'Exécution allumé au clic')
  await delay(800)
  assert.equal(await menu.getByRole('button', { name: 'Exécution', exact: true }).getAttribute('aria-current'), 'location', 'Le clic fixe l’élément choisi pendant le défilement doux')
  // En bas de page, la dernière sous-catégorie visible l'emporte : la Zone de danger.
  await page.locator('#reglages-general-0').hover()
  await page.mouse.wheel(0, 20000)
  await until(() => menu.getByRole('button', { name: 'Zone de danger', exact: true }).getAttribute('aria-current'), (value) => value === 'location', 'Zone de danger lue en bas de page')
  // Cliquer une catégorie allume son premier groupe.
  await menu.getByRole('button', { name: 'Général', exact: true }).click()
  await until(() => menu.getByRole('button', { name: 'Identité', exact: true }).getAttribute('aria-current'), (value) => value === 'location', 'Général allume Identité')

  // ─── Agents : des rangées à plat, dans le brouillon ────────────────────────
  await page.goto(`${base}/p/${nimbus.id}/settings`)
  await menu.getByRole('button', { name: 'Agents', exact: true }).click()
  for (const group of ['Ce que l’agent demande à Solera', 'Ce que Solera lui prête', 'Permissions du CLI', 'Modèle par défaut']) {
    await menu.getByRole('button', { name: group, exact: true }).waitFor()
  }
  // Plus de cartes emboîtées : l'ancien bloc et ses titres ont disparu.
  assert.equal(await page.locator('#reglage-agent-settings').count(), 0, 'L’ancien bloc des réglages d’agent a disparu')
  assert.equal(await page.getByRole('heading', { name: 'Modèles par défaut' }).count(), 0)
  const decisions = row('agent-requests-decisions')
  await decisions.getByText('hérité du compte', { exact: true }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  for (const [anchor, name] of [['reglages-agents-1', 'agents-demandes'], ['reglages-agents-2', 'agents-prete'], ['reglages-agents-3', 'agents-permissions'], ['reglages-agents-4', 'agents-modele']]) {
    await shot(page.locator(`#${anchor}`), `1280-${name}`)
  }
  const stored = (await reread()).configLayer
  // Trois choix trop longs pour un segment : une liste, qui ne déborde pas de sa colonne.
  const policies = { Interdit: 'deny', 'Demande mon accord': 'ask', Automatique: 'auto' }
  const decisionsList = decisions.getByRole('combobox', { name: 'Décisions' })
  const current = (await decisionsList.textContent()).trim()
  const choiceLabel = Object.keys(policies).find((label) => !current.startsWith(label))
  const choose = async (label) => {
    await decisionsList.click()
    await page.getByRole('option', { name: new RegExp(`^${label}`) }).click()
  }
  await choose(choiceLabel)
  await bar.filter({ hasText: '1 modification non enregistrée' }).waitFor()
  await decisions.getByRole('img', { name: 'Modifié, pas encore enregistré' }).waitFor()
  await menu.getByRole('button', { name: /^Agents/ }).getByRole('img', { name: 'Modifications en attente' }).waitFor()
  await decisions.getByRole('button', { name: 'modifié ici' }).waitFor()
  await shot(page.locator('#reglages-agents-1'), '1280-agents-modifie')
  // Le CLI choisi ne règle que ce qui existe pour lui ; le brouillon survit au changement.
  const cli = row('agent-permissions-cli').getByRole('radiogroup', { name: 'CLI' })
  assert.equal(await row('agent-permissions-sandbox').count(), 0, 'Claude n’a pas de bac à sable')
  await cli.getByRole('radio', { name: 'Codex' }).click()
  await row('agent-permissions-sandbox').waitFor()
  await shot(page.locator('#reglages-agents-3'), '1280-agents-permissions-codex')
  const sandbox = row('agent-permissions-sandbox').getByRole('combobox', { name: 'Bac à sable' })
  const sandboxValue = (await sandbox.textContent()).trim()
  await sandbox.click()
  await page.getByRole('option').filter({ hasNotText: sandboxValue }).first().click()
  await bar.filter({ hasText: '2 modifications non enregistrées' }).waitFor()
  await cli.getByRole('radio', { name: 'Claude' }).click()
  // Ce qui change pour un CLI non affiché se marque sur la rangée du CLI.
  await row('agent-permissions-cli').getByRole('img', { name: 'Modifié, pas encore enregistré' }).waitFor()
  assert.equal(await row('agent-model-cli').getByRole('img', { name: 'Modifié, pas encore enregistré' }).count(), 0)
  // Annuler efface aussi les réglages d'agent.
  await barButton('Annuler').click()
  await bar.waitFor({ state: 'detached' })
  assert.ok((await decisionsList.textContent()).startsWith(current), 'Annuler rend la valeur enregistrée')

  // Enregistrer : le niveau du projet part avec le reste, dans le même PATCH.
  const agentPatches = []
  const onPatch = (request) => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/projects/${nimbus.id}`) agentPatches.push(request.postDataJSON())
  }
  page.on('request', onPatch)
  await choose(choiceLabel)
  await row('name').getByRole('textbox').fill('Nimbus agents')
  await bar.filter({ hasText: '2 modifications non enregistrées' }).waitFor()
  await barButton('Enregistrer').click()
  await page.getByText('2 réglages enregistrés.', { exact: true }).waitFor()
  const value = policies[choiceLabel]
  assert.deepEqual(agentPatches, [{ name: 'Nimbus agents', configLayer: [{ scope: 'shared', set: { decisions: value } }] }], 'Un seul PATCH, le niveau du projet avec le reste')
  assert.equal((await reread()).configLayer.shared.decisions, value)
  await decisions.getByRole('button', { name: 'modifié ici' }).waitFor()
  assert.equal(await decisions.getByRole('img', { name: 'Modifié, pas encore enregistré' }).count(), 0)

  // Revenir à l'héritage : un `unset`, compté et enregistré comme le reste.
  agentPatches.length = 0
  await decisions.getByRole('button', { name: 'modifié ici' }).click()
  await decisions.getByText('hérité du compte', { exact: true }).waitFor()
  await bar.filter({ hasText: '1 modification non enregistrée' }).waitFor()
  await barButton('Enregistrer').click()
  await page.getByText('1 réglage enregistré.', { exact: true }).waitFor()
  assert.deepEqual(agentPatches, [{ configLayer: [{ scope: 'shared', unset: ['decisions'] }] }])
  assert.deepEqual((await reread()).configLayer.shared, stored.shared)
  page.off('request', onPatch)
  await page.getByText('1 réglage enregistré.', { exact: true }).waitFor({ state: 'detached', timeout: 6000 })

  // ─── Consignes : le mode, les fichiers du dépôt, ce que lit chaque CLI ─────
  await page.goto(`${base}/p/${nimbus.id}/settings`)
  const instructions = row('instructions')
  const readers = instructions.getByRole('region', { name: 'Ce que lit chaque CLI' })
  const readerOf = (cli) => readers.getByRole('row', { name: new RegExp(`^${cli}`) })
  // Une image par partie du bloc : il est plus haut que l'écran.
  const instructionParts = {
    mode: () => instructions.getByRole('region', { name: 'Où vivent les consignes du projet' }),
    fichiers: () => instructions.getByRole('region', { name: 'Fichiers à la racine du dépôt' }),
    lecteurs: () => readers,
    texte: () => instructions.locator('section').filter({ has: page.getByRole('button', { name: 'Modifier', exact: true }) }),
  }
  const shotInstructions = async (prefix, parts) => {
    await page.evaluate(() => document.fonts.ready)
    for (const part of parts) {
      await instructionParts[part]().scrollIntoViewIfNeeded()
      await shot(instructionParts[part](), `${prefix}-${part}`)
    }
  }
  const instructionCalls = []
  const onInstructions = (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith(`/api/projects/${nimbus.id}/instructions`) && request.method() !== 'GET') {
      instructionCalls.push({ method: request.method(), path: path.slice(`/api/projects/${nimbus.id}`.length), body: request.postDataJSON() })
    }
  }
  page.on('request', onInstructions)
  // Un dossier sans fichier de consignes : le mode a été déduit, et rien n'est lu.
  await instructions.getByText('déduit du dossier, jamais choisi', { exact: true }).waitFor()
  assert.equal(await instructions.getByRole('radio', { name: /^Dans Solera/ }).getAttribute('aria-checked'), 'true')
  for (const cli of ['Claude', 'Codex', 'Grok', 'OpenCode']) {
    await readerOf(cli).getByText('le texte de Solera est vide', { exact: true }).waitFor()
  }
  await instructions.getByText('Claude Code, Codex, Grok Build et OpenCode n’auront pas les consignes du projet.', { exact: true }).waitFor()
  await instructions.getByRole('listitem').filter({ hasText: 'AGENTS.md' }).getByText('absent', { exact: true }).waitFor()
  await instructions.getByText('Vide.', { exact: true }).waitFor()
  // Changer de mode : tout de suite, hors du brouillon de la page.
  await instructions.getByRole('radio', { name: /^Dans le dépôt/ }).click()
  await until(() => instructions.getByRole('radio', { name: /^Dans le dépôt/ }).getAttribute('aria-checked'), (value) => value === 'true', 'mode dépôt choisi')
  await instructions.getByText('déduit du dossier, jamais choisi', { exact: true }).waitFor({ state: 'detached' })
  await readerOf('Codex').getByText('aucun fichier de consignes', { exact: true }).waitFor()
  assert.equal(await bar.count(), 0, 'Le mode ne passe pas par la barre')
  assert.equal((await (await context.request.get(`${base}/api/projects/${nimbus.id}/instructions`)).json()).mode, 'repo')
  // Écrire AGENTS.md, qui n'existe pas encore, depuis la page.
  await instructions.getByText('AGENTS.md (à créer)', { exact: true }).waitFor()
  await instructions.getByRole('button', { name: 'Modifier', exact: true }).click()
  const agentsText = '# Consignes\n\n- Les tests se lancent avec `pnpm test`.\n- Ne jamais pousser directement sur main.\n'
  await instructions.getByRole('textbox').fill(agentsText)
  await instructions.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await instructions.getByRole('textbox').waitFor({ state: 'detached' })
  assert.equal(await readFile(join(nimbus.workspacePath, 'AGENTS.md'), 'utf8'), agentsText, 'AGENTS.md écrit dans le dépôt')
  await readerOf('Codex').getByText('AGENTS.md', { exact: true }).waitFor()
  await readerOf('Claude').getByText('AGENTS.md', { exact: true }).waitFor()
  await instructions.getByRole('listitem').filter({ hasText: 'AGENTS.md' }).getByText('3 lignes', { exact: true }).waitFor()
  assert.equal(await instructions.getByRole('status').count(), 0, 'Plus d’alerte : tous les CLI lisent AGENTS.md')
  await shotInstructions('1280-consignes-depot', ['mode', 'fichiers', 'lecteurs', 'texte'])
  // Un CLAUDE.md qui a son propre contenu : les CLI ne liraient pas la même chose.
  await writeFile(join(nimbus.workspacePath, 'CLAUDE.md'), '# Claude\n\n- Toujours lancer le lint.\n- Préférer pnpm à npm.\n- Écrire les tests d’abord.\n- Pas de console.log.\n')
  await page.reload()
  await instructions.getByText(/^AGENTS\.md et CLAUDE\.md ont chacun leur contenu/).waitFor()
  await readerOf('Claude').getByText('AGENTS.md + CLAUDE.md', { exact: true }).waitFor()
  await readerOf('Codex').getByText('AGENTS.md', { exact: true }).waitFor()
  // OpenCode s'arrête au premier fichier trouvé.
  await readerOf('OpenCode').getByText('AGENTS.md', { exact: true }).waitFor()
  await instructions.getByRole('button', { name: /^CLAUDE\.md/ }).click()
  await instructions.getByText('- Préférer pnpm à npm.', { exact: false }).first().waitFor()
  await shotInstructions('1280-consignes-divergents', ['fichiers', 'lecteurs'])
  // Le même fichier réduit à un renvoi : plus de divergence.
  await writeFile(join(nimbus.workspacePath, 'CLAUDE.md'), 'Voir [AGENTS.md](AGENTS.md).\n')
  await page.reload()
  await instructions.getByText('renvoie à AGENTS.md', { exact: true }).waitFor()
  assert.equal(await instructions.getByRole('status').count(), 0, 'Un renvoi n’est pas une divergence')
  // Passer dans Solera avec un texte vide : on propose d'importer AGENTS.md, pas le renvoi.
  instructionCalls.length = 0
  await instructions.getByRole('radio', { name: /^Dans Solera/ }).click()
  const importDialog = page.getByRole('dialog', { name: 'Passer les consignes dans Solera' })
  await importDialog.getByText(/^Le contenu de AGENTS\.md est copié/).waitFor()
  await importDialog.getByRole('button', { name: 'Passer dans Solera sans importer', exact: true }).waitFor()
  await shot(importDialog, '1280-consignes-import')
  await importDialog.getByRole('button', { name: 'Importer et basculer' }).click()
  await importDialog.waitFor({ state: 'detached' })
  await readerOf('Codex').getByText('texte de Solera', { exact: true }).waitFor()
  assert.deepEqual(instructionCalls, [{ method: 'PATCH', path: '/instructions', body: { mode: 'solera', content: agentsText.trim() } }])
  await instructions.getByText('Texte tenu par Solera', { exact: true }).waitFor()
  await instructions.getByRole('listitem').filter({ hasText: 'AGENTS.md' }).getByText('3 lignes · masqué aux CLI', { exact: true }).waitFor()
  await shotInstructions('1280-consignes-solera', ['mode', 'fichiers', 'lecteurs', 'texte'])
  // Le lien vers la partie globale ouvre les réglages du compte, section Consignes.
  await instructions.getByRole('button', { name: 'La modifier', exact: true }).click()
  await page.getByRole('dialog').getByText(/^Des consignes injectées dans le prompt de chaque session/).waitFor()
  await page.keyboard.press('Escape')
  page.off('request', onInstructions)

  // ─── Zone de danger : retirer un projet, pour de vrai ─────────────────────
  await page.goto(`${base}/p/${docs.id}/settings`)
  await row('remove').getByRole('button', { name: 'Retirer le projet' }).click()
  const confirm = page.getByRole('dialog', { name: 'Retirer "Docs" de Solera ?' })
  await confirm.waitFor()
  await shot(confirm, '1280-retirer')
  await confirm.getByRole('button', { name: 'Retirer le projet' }).click()
  await until(() => reread(docs.id), (project) => project === undefined, 'Docs retiré')
  await until(() => page.url(), (url) => !url.includes(docs.id), `retour hors de Docs (${page.url()})`)

  // ─── Un projet partagé, pour qui n'en est pas propriétaire ────────────────
  const created = await context.request.post(`${base}/api/users`, { data: { username: 'sam', displayName: 'Sam', password: 'sam-password-1', isAdmin: false } })
  assert.ok(created.ok(), await created.text())
  const guest = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await guest.addInitScript(() => localStorage.setItem('solera.locale', 'fr'))
  assert.ok((await guest.request.post(`${base}/api/auth/login`, { data: { username: 'sam', password: 'sam-password-1' } })).ok())
  assert.ok((await guest.request.patch(`${base}/api/me/settings`, { data: { onboarding: { pending: false } } })).ok())
  const guestPage = await guest.newPage()
  guestPage.on('pageerror', (error) => errors.push(error.message))
  await guestPage.goto(`${base}/p/${nimbus.id}/settings`)
  await guestPage.getByText(/^Projet partagé par .+\. Seul son propriétaire peut le modifier\.$/).waitFor()
  const guestMenu = guestPage.getByRole('complementary', { name: 'Sections des réglages', exact: true })
  for (const hidden of ['Intégrations', 'Zone de danger']) {
    assert.equal(await guestMenu.getByRole('button', { name: hidden, exact: true }).count(), 0, `${hidden} n’est pas montré à un membre`)
  }
  assert.ok(await guestPage.locator('#reglage-name').getByRole('textbox').isDisabled(), 'Le nom se lit sans se changer')
  assert.equal(await guestPage.locator('[id^="reglage-agent-"]').count(), 0, 'Les réglages d’agent ne sont pas montrés à un membre')
  await guestMenu.getByRole('button', { name: 'Ce que les agents savent', exact: true }).waitFor()
  // Les consignes se lisent, sans changer de mode ni modifier.
  const guestInstructions = guestPage.locator('#reglage-instructions')
  await guestInstructions.getByText('Texte tenu par Solera', { exact: true }).waitFor()
  assert.ok(await guestInstructions.getByRole('radio', { name: /^Dans le dépôt/ }).isDisabled())
  assert.ok(await guestInstructions.getByRole('button', { name: 'Modifier', exact: true }).isDisabled())
  assert.ok(await guestPage.locator('#reglage-color').getByRole('radio').first().isDisabled())
  await shot(guestPage.locator('[data-place-content]'), '1280-partage')
  await guest.close()

  // ─── Au téléphone ─────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/p/${nimbus.id}/settings`)
  const goTo = page.getByRole('combobox', { name: 'Aller à', exact: true })
  await goTo.waitFor()
  assert.equal(await menu.isVisible(), false, 'Le menu gauche se replie en sélecteur')
  const options = await goTo.locator('option').allTextContents()
  assert.ok(options.includes('Général › Exécution') && options.includes('Zone de danger › Irréversible'), options.join(' | '))
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Rien ne déborde au téléphone')
  await page.evaluate(() => document.fonts.ready)
  await shot(page.locator('[data-place-content]'), '390-page')
  for (const [anchor, name] of [['reglages-general-0', 'identite'], ['reglages-general-1', 'apparence'], ['reglages-general-2', 'execution']]) {
    await shot(page.locator(`#${anchor}`), `390-${name}`)
  }
  for (const [anchor, name] of [['reglages-agents-1', 'agents-demandes'], ['reglages-agents-2', 'agents-prete'], ['reglages-agents-3', 'agents-permissions'], ['reglages-agents-4', 'agents-modele']]) {
    await shot(page.locator(`#${anchor}`), `390-${name}`)
  }
  await shotInstructions('390-consignes-solera', ['mode', 'fichiers', 'lecteurs', 'texte'])
  await goTo.selectOption({ label: 'Général › Exécution' })
  await until(() => page.locator('#reglages-general-2').evaluate((element) => element.getBoundingClientRect().top), (top) => top < 300, 'le sélecteur amène au groupe')
  await page.getByRole('button', { name: 'Rechercher un réglage', exact: true }).last().click()
  await palette.waitFor()
  await palette.getByRole('searchbox').fill('couleur')
  await palette.getByRole('option').first().waitFor()
  await shot(page, '390-recherche')
  await page.keyboard.press('Escape')
  await row('name').getByRole('textbox').fill('Nimbus mobile')
  await bar.waitFor()
  await shot(page, '390-brouillon')

  assert.deepEqual(errors, [])
  console.log('OK : réglages du projet — menu, brouillon et PATCH unique, agents à plat, consignes, recherche, lecture suivie, Zone de danger, partage, téléphone.')
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
