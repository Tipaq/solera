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

/*
 * La page `/sessions` (#232) : toutes les conversations, cherchées, filtrées, rangées.
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas : que **l'adresse est la
 * source** — un lien vers `?projet=` suivi alors qu'on est déjà sur la page change bien
 * la liste, sans recharger —, que les fils des tâches planifiées n'y sont pas, que l'état
 * d'une session se lit de son statut vivant et de sa carte, que la portée reste
 * atteignable au téléphone, et qu'un en-tête de groupe ne met pas un lien dans un bouton.
 *
 * Puis la sélection (#233) : chaque geste en masse est vérifié **par l'API** — épinglée,
 * archivée, désarchivée, supprimée —, l'archivage passe par la fenêtre des demandes en
 * attente, un refus du serveur n'arrête pas les autres et se dit dans un bandeau.
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-sessions-check-'))
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
  const atlas = projects.find((entry) => entry.name === 'Atlas API')
  assert.ok(nimbus && atlas)

  // Le jeu de démo n'a ni épinglée, ni archivée, ni fil libre : on les pose par l'API.
  const conversations = await (await context.request.get(`${base}/api/conversations`)).json()
  const byTitle = (title) => {
    const found = conversations.find((entry) => entry.title === title)
    assert.ok(found, `La démo a « ${title} »`)
    return found
  }
  const pinned = byTitle('Release notes for v0.9')
  const archived = byTitle('Migrate icons to Lucide')
  const loose = byTitle('Playwright smoke tests')
  assert.ok((await context.request.patch(`${base}/api/conversations/${pinned.id}`, { data: { pinned: true } })).ok())
  assert.ok((await context.request.patch(`${base}/api/conversations/${archived.id}`, { data: { archived: true } })).ok())
  assert.ok((await context.request.post(`${base}/api/conversations/${loose.id}/project`, { data: { projectId: null } })).ok())

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-11-11-sessions')
  await mkdir(shots, { recursive: true })
  const shot = (name, target = page) => target.screenshot({ animations: 'disabled', path: join(shots, `check-${name}.png`) })

  const toolbar = page.locator('[data-toolbar]')
  const content = page.locator('[data-place-content]')
  const line = (title) => content.locator('[data-session]', { hasText: title })
  const titles = () => content.locator('[data-session]').evaluateAll((links) => links.map((link) => link.querySelector('.truncate').textContent))
  /** Attend que l'adresse porte `value` pour `key` (`null` : absente) ; elle s'écrit sous transition. */
  const expectParam = (key, value) =>
    page.waitForFunction(([k, v]) => new URL(location.href).searchParams.get(k) === v, [key, value], { timeout: 5_000 })
  /** Les titres affichés, triés ou non, une fois que la liste a suivi l'adresse. */
  const expectTitles = async (expected, { sorted = false } = {}) => {
    const want = sorted ? [...expected].sort() : expected
    for (let i = 0; i < 50; i++) {
      const got = sorted ? (await titles()).sort() : await titles()
      if (JSON.stringify(got) === JSON.stringify(want)) return
      await delay(100)
    }
    assert.deepEqual(sorted ? (await titles()).sort() : await titles(), want)
  }
  /** Une navigation interne, comme le ferait un lien de la sidebar : sans recharger. */
  const follow = (path) => page.evaluate((to) => {
    history.pushState({}, '', to)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)

  // ─── SES-1 : la page, la bande, le lieu ─────────────────────────────────
  await page.goto(`${base}/sessions`)
  await page.getByRole('heading', { name: 'Sessions', exact: true }).waitFor()
  await line('Refactor settings storage').waitFor()
  assert.equal(await page.locator('nav[aria-label="Vues du projet"]').count(), 0, 'Une bande seule, sans rangée d’onglets')
  const newConversation = page.locator('header').getByRole('button', { name: 'Nouvelle conversation', exact: true })
  await newConversation.waitFor()
  assert.equal(
    await page.getByLabel('Navigation', { exact: true }).getByRole('button', { name: /^Fils/ }).first().getAttribute('aria-current'),
    'page',
    '/sessions est la page de Fils : le lieu s’allume',
  )

  // ─── SES-2 : toutes les sessions, sauf celles des tâches planifiées ──────
  const all = await titles()
  assert.ok(all.includes('Fix the flaky retry test') && all.includes('Playwright smoke tests'), 'Tous les projets, et les fils libres')
  assert.ok(!all.some((title) => title.startsWith('CLI release watch')), 'Pas de fil ouvert par une tâche planifiée')
  assert.ok(!all.includes('Migrate icons to Lucide'), 'Pas d’archivée dans les actives')

  // ─── SES-3 / SES-4 : l'état et la ligne ─────────────────────────────────
  assert.match(await line('Refactor settings storage').innerText(), /t’attend/)
  assert.match(await line('Investigate slow first paint').innerText(), /en erreur/, 'Une interruption est une erreur')
  assert.match(await line('Radar tile prefetching').innerText(), /à relire/, 'Sa carte est à vérifier')
  assert.doesNotMatch(await line('Add offline caching').innerText(), /à relire|t’attend/)
  assert.equal(await line('Release notes for v0.9').getByLabel('épinglée').count(), 1)
  const radar = await line('Radar tile prefetching').innerText()
  assert.match(radar, /Nimbus/, 'La pastille de projet, dès lg')
  assert.match(radar, /#4/, 'La carte')
  // La branche arrive avec l'état des arbres, lu après la liste.
  await line('Add offline caching').getByText('feat/offline-cache').waitFor({ timeout: 15_000 }).catch(async () => {
    const status = await (await context.request.get(`${base}/api/worktrees/status`)).json()
    assert.fail(`La branche de son arbre ; état des arbres : ${JSON.stringify(status).slice(0, 800)}`)
  })

  // ─── SES-12 / SES-9 : « Ce qui t'attend » puis les tranches ─────────────
  await content.getByText('Ce qui t’attend', { exact: true }).waitFor()
  const heads = await content.locator('h2').allInnerTexts()
  assert.equal(heads[0], 'ÉPINGLÉES', 'Les épinglées en tête de la Liste')
  assert.ok(heads.includes('AUJOURD’HUI'), heads.join(' · '))
  assert.equal((await titles())[0], 'Release notes for v0.9')
  await shot('1280-liste')
  await shot('1280-barre', toolbar)

  // ─── SES-5 : la recherche, écrite dans l'adresse ───────────────────────
  const field = toolbar.getByRole('searchbox', { name: 'Chercher une session' })
  await field.fill('prefetch')
  await expectTitles(['Radar tile prefetching'])
  await expectParam('q', 'prefetch')
  await field.fill('#4')
  await expectTitles(['Radar tile prefetching'])
  await field.fill('atlas')
  await page.waitForFunction(() => document.querySelectorAll('[data-session]').length === 3)
  await field.fill('zzzz')
  await content.getByText('Aucune session ne correspond.').waitFor()
  await field.fill('')
  await expectParam('q', null)
  // La frappe rapide ne perd pas de lettre : le champ ne se recale pas sur l'adresse en retard.
  await field.pressSequentially('flaky retry', { delay: 0 })
  await expectParam('q', 'flaky retry')
  assert.equal(await field.inputValue(), 'flaky retry')
  await expectTitles(['Fix the flaky retry test'])
  await field.fill('')
  await page.goto(`${base}/sessions?q=retry`)
  assert.equal(await field.inputValue(), 'retry', '`?q=` pré-remplit la recherche (la palette)')
  await line('Fix the flaky retry test').waitFor()

  // ─── SES-6 : Filtrer ▾ ─────────────────────────────────────────────────
  await page.goto(`${base}/sessions`)
  await line('Refactor settings storage').waitFor()
  await toolbar.getByRole('button', { name: 'Filtrer' }).click()
  const menu = page.getByRole('dialog', { name: 'Filtrer' })
  await menu.waitFor()
  await menu.getByRole('checkbox', { name: /Atlas/ }).click()
  await expectTitles(['Add /health and request metrics', 'Fix the flaky retry test', 'Rate-limit the places endpoint'], { sorted: true })
  await expectParam('projet', atlas.id)
  assert.match(await menu.getByRole('checkbox', { name: /Sans projet/ }).innerText(), /1/, '« Sans projet » et son compte')
  await menu.getByRole('checkbox', { name: /^Codex|Codex$/ }).waitFor()
  await menu.getByRole('radio', { name: '7 j' }).click()
  await menu.getByRole('checkbox', { name: 'Épinglées seulement' }).click()
  await expectParam('periode', 'semaine')
  await expectParam('epinglees', '1')
  await shot('1280-filtrer', menu)
  await menu.getByRole('button', { name: 'Effacer tous les filtres' }).click()
  await page.keyboard.press('Escape')
  for (const key of ['projet', 'periode', 'epinglees']) await expectParam(key, null)

  await page.goto(`${base}/sessions?etat=attend,erreur`)
  await expectTitles(['Investigate slow first paint', 'Refactor settings storage'], { sorted: true })
  assert.equal(await toolbar.locator('[data-filter-chip]').count(), 2, 'Une puce par état')
  await toolbar.locator('[data-filter-chip]', { hasText: 'en erreur' }).getByRole('button', { name: 'Retirer ce filtre' }).click()
  await page.waitForFunction(() => new URL(location.href).searchParams.get('etat') === 'attend')

  // ─── L'adresse est la source : un lien suivi sur la page la change ──────
  await follow('/sessions?projet=none')
  await expectTitles(['Playwright smoke tests'])
  assert.match(await toolbar.locator('[data-filter-chip]').innerText(), /sans projet/)
  await follow('/sessions?q=prefetch')
  await expectTitles(['Radar tile prefetching'])
  assert.equal(await field.inputValue(), 'prefetch', 'Un `?q=` suivi sur la page recale le champ')
  await follow(`/sessions?projet=${nimbus.id}`)
  await page.waitForFunction(() => document.querySelectorAll('[data-session]').length > 1)
  assert.ok((await titles()).every((title) => conversations.find((entry) => entry.title === title)?.projectId === nimbus.id))

  // ─── SES-7 : la portée ──────────────────────────────────────────────────
  await page.goto(`${base}/sessions`)
  const scope = toolbar.getByRole('radiogroup', { name: 'Actives ou archivées' })
  assert.match(await scope.innerText(), /Archivées\s*1/, 'Le compte de chaque côté')
  await scope.getByRole('radio', { name: /Archivées/ }).click()
  await expectTitles(['Migrate icons to Lucide'])
  await expectParam('portee', 'archivees')
  assert.equal(await content.getByText('Ce qui t’attend', { exact: true }).count(), 0, '« Ce qui t’attend » seulement dans les actives')
  await scope.getByRole('radio', { name: /Actives/ }).click()
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('portee'))

  // ─── SES-8 / SES-11 : Affichage ▾, Par état ─────────────────────────────
  const display = toolbar.getByRole('button', { name: /^Affichage/ })
  await display.click()
  const displayMenu = page.getByRole('dialog', { name: 'Affichage' })
  await displayMenu.getByRole('radio', { name: 'Par état' }).click()
  await page.waitForFunction(() => new URL(location.href).searchParams.get('vue') === 'etat')
  await shot('1280-affichage', displayMenu)
  await page.keyboard.press('Escape')
  await content.locator('h2', { hasText: 'Terminées' }).waitFor()
  assert.deepEqual(await content.locator('h2').allInnerTexts(), ['T’ATTEND', 'TRAVAILLE', 'À RELIRE', 'TERMINÉES'])
  assert.equal(await content.getByText('Ce qui t’attend', { exact: true }).count(), 0, 'Pas de « Ce qui t’attend » hors de la Liste')
  const waitingColumn = content.locator('section').filter({ has: page.locator('h2', { hasText: 'T’ATTEND' }) })
  await waitingColumn.locator('[data-session]').nth(1).waitFor({ timeout: 8_000 }).catch(async () => {
    assert.fail(`L’erreur est rangée avec ce qui t’attend ; colonnes : ${JSON.stringify(await content.locator("section").allInnerTexts())}`)
  })
  assert.equal(await waitingColumn.locator('[data-session]').count(), 2, 'L’erreur est rangée avec ce qui t’attend')
  assert.doesNotMatch(await waitingColumn.innerText(), /t’attend\s/, 'Lignes compactes : pas de mot d’état')
  await shot('1280-par-etat')

  // ─── SES-10 : Par projet ────────────────────────────────────────────────
  await display.click()
  await displayMenu.getByRole('radio', { name: 'Par projet' }).click()
  await page.keyboard.press('Escape')
  await content.getByRole('link', { name: 'Atlas API', exact: true }).waitFor()
  assert.equal(await page.locator('button a, a button, a a').count(), 0, 'Ni lien dans un bouton, ni l’inverse')
  const fold = content.getByRole('button', { name: 'Replier Atlas API' })
  await fold.click()
  assert.equal(await content.getByRole('button', { name: 'Déplier Atlas API' }).getAttribute('aria-expanded'), 'false')
  assert.equal(await line('Fix the flaky retry test').count(), 0, 'Le groupe replié cache ses lignes')
  await content.getByRole('button', { name: 'Déplier Atlas API' }).click()
  await line('Fix the flaky retry test').waitFor()
  await content.getByText('Sans projet', { exact: true }).waitFor()
  await shot('1280-par-projet')

  // La vue se retient : la page rouverte sans `?vue=` la retrouve.
  await page.goto(`${base}/sessions`)
  await content.getByRole('link', { name: 'Atlas API', exact: true }).waitFor()

  // ─── SES-8 : le tri ─────────────────────────────────────────────────────
  await page.goto(`${base}/sessions?vue=liste&tri=nom`)
  await line('Refactor settings storage').waitFor()
  assert.equal(await content.locator('section h2').count(), 0, 'Un autre tri : une seule liste, sans tranches')
  const named = await titles()
  assert.deepEqual(named, [...named].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })))
  await page.goto(`${base}/sessions?tri=attente`)
  await line('Refactor settings storage').waitFor()
  assert.deepEqual((await titles()).slice(0, 2), ['Refactor settings storage', 'Investigate slow first paint'])

  // ─── Un clic mène au fil ────────────────────────────────────────────────
  await line('Fix the flaky retry test').click()
  await page.waitForURL(`**/p/${atlas.id}/c/*`)

  // ─── SES-14 : les états vides ───────────────────────────────────────────
  assert.ok((await context.request.patch(`${base}/api/conversations/${archived.id}`, { data: { archived: false } })).ok())
  await page.goto(`${base}/sessions?portee=archivees`)
  await content.getByText('Aucune session archivée.').waitFor()

  // ─── Au téléphone ───────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok((await context.request.patch(`${base}/api/conversations/${archived.id}`, { data: { archived: true } })).ok())
  await page.goto(`${base}/sessions`)
  await line('Refactor settings storage').waitFor()
  assert.equal(await toolbar.getByRole('radiogroup', { name: 'Actives ou archivées' }).isVisible(), false, 'Pas de place dans la barre')
  assert.equal(Math.round((await toolbar.boundingBox()).height), 48, 'La barre tient sur une ligne')
  await shot('390-liste')
  await toolbar.getByRole('button', { name: 'Filtrer' }).click()
  const phoneMenu = page.getByRole('dialog', { name: 'Filtrer' })
  const phoneScope = phoneMenu.getByRole('radiogroup', { name: 'Actives ou archivées' })
  await phoneScope.waitFor()
  await shot('390-filtrer', phoneMenu)
  await phoneScope.getByRole('radio', { name: /Archivées/ }).click()
  await page.keyboard.press('Escape')
  await line('Migrate icons to Lucide').waitFor()
  await expectParam('portee', 'archivees')

  // ─── SES-13 : la sélection et les gestes en masse, vérifiés par l'API ────
  // Sur la base jetable de la suite, jamais sur celle de Solera.
  await page.setViewportSize({ width: 1280, height: 800 })
  const record = async (title) => (await (await context.request.get(`${base}/api/conversations`)).json()).find((entry) => entry.title === title)
  /** Attend que le serveur dise ce que le geste devait faire. */
  const until = async (check, message) => {
    for (let i = 0; i < 50; i++) {
      if (await check()) return
      await delay(100)
    }
    assert.fail(message)
  }
  const flaky = 'Fix the flaky retry test'
  const limit = 'Rate-limit the places endpoint'
  const flakyId = (await record(flaky)).id
  await page.goto(`${base}/sessions?vue=liste&tri=nom`)
  await line(flaky).waitFor()
  const selectToggle = toolbar.getByRole('button', { name: 'Sélectionner' })
  await selectToggle.click()
  const bar = page.locator('[data-selection-bar]')
  await bar.waitFor()
  assert.equal(await toolbar.getByRole('button', { name: 'Terminer' }).getAttribute('aria-pressed'), 'true')
  assert.match(await bar.innerText(), /0 sélectionnée\b/)
  for (const name of ['Épingler', 'Archiver', 'Supprimer']) {
    assert.equal(await bar.getByRole('button', { name, exact: true }).isDisabled(), true, `« ${name} » désactivé à 0`)
  }
  assert.equal(await bar.getByRole('button', { name: 'Désarchiver' }).count(), 0, 'On ne désarchive pas une active')
  assert.equal(await content.getByText('Ce qui t’attend', { exact: true }).count(), 0, 'Pas de « Ce qui t’attend » en sélection')

  // Un clic coche la ligne, il n'ouvre plus le fil.
  await line(flaky).click()
  await line(limit).click()
  assert.equal(new URL(page.url()).pathname, '/sessions')
  assert.equal(await line(flaky).getAttribute('aria-checked'), 'true')
  assert.equal(await line('Refactor settings storage').getAttribute('aria-checked'), 'false')
  assert.match(await bar.innerText(), /2 sélectionnées/)
  await shot('1280-selection')
  await shot('1280-barre-selection', bar)

  // Épingler, puis désépingler : le même bouton défait quand tout est déjà épinglé.
  await bar.getByRole('button', { name: 'Épingler', exact: true }).click()
  await until(async () => (await record(flaky)).pinned && (await record(limit)).pinned, 'Les deux sont épinglées')
  await selectToggle.waitFor()
  assert.equal(await bar.count(), 0, 'Le geste fait, la sélection se referme')
  await selectToggle.click()
  await line(flaky).click()
  await line(limit).click()
  await bar.getByRole('button', { name: 'Désépingler', exact: true }).click()
  await until(async () => !(await record(flaky)).pinned && !(await record(limit)).pinned, 'Les deux sont désépinglées')

  // Un refus du serveur : les autres suivent, le refus se dit, sa ligne reste cochée.
  await page.route(`**/api/conversations/${flakyId}`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'test', message: 'Refusé par la suite' } }) })
      : route.continue(),
  )
  await selectToggle.click()
  await line(flaky).click()
  await line(limit).click()
  await bar.getByRole('button', { name: 'Épingler', exact: true }).click()
  await until(async () => (await record(limit)).pinned, 'La seconde est épinglée malgré le refus de la première')
  const failure = page.getByRole('alert').filter({ hasText: 'Refusé par la suite' })
  await failure.waitFor()
  assert.match(await failure.innerText(), /Une session n’a pas suivi/)
  assert.equal((await record(flaky)).pinned, false)
  assert.equal(await line(flaky).getAttribute('aria-checked'), 'true', 'Le refus reste coché, pour réessayer')
  assert.equal(await line(limit).getAttribute('aria-checked'), 'false')
  await shot('1280-refus')
  await page.unroute(`**/api/conversations/${flakyId}`)
  assert.ok((await context.request.patch(`${base}/api/conversations/${(await record(limit)).id}`, { data: { pinned: false } })).ok())

  // Archiver passe par la fenêtre des demandes en attente (#119).
  await page.route('**/api/conversations/pending-requests*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ conversations: [{ id: flakyId, projectId: atlas.id, decision: 1, cardChange: 0, cardDraft: 0, move: 0 }] }),
    }),
  )
  await line(limit).click()
  assert.match(await bar.innerText(), /2 sélectionnées/)
  await bar.getByRole('button', { name: 'Archiver', exact: true }).click()
  const guard = page.getByRole('dialog', { name: 'Archiver avec des demandes en attente ?' })
  await guard.waitFor()
  assert.equal((await record(flaky)).archivedAt, null, 'Rien ne part avant la confirmation')
  await guard.getByRole('button', { name: 'Archiver quand même' }).click()
  await until(async () => (await record(flaky)).archivedAt !== null && (await record(limit)).archivedAt !== null, 'Les deux sont archivées')
  await page.unroute('**/api/conversations/pending-requests*')
  assert.equal(await page.getByRole('alert').count(), 0, 'Le refus d’avant s’efface au geste suivant')
  await line(flaky).waitFor({ state: 'detached' })

  // Changer de portée vide la sélection ; « Tout » coche les lignes affichées.
  await selectToggle.click()
  await line('Refactor settings storage').click()
  assert.match(await bar.innerText(), /1 sélectionnée\b/)
  await scope.getByRole('radio', { name: /Archivées/ }).click()
  await expectParam('portee', 'archivees')
  await line(flaky).waitFor()
  assert.match(await bar.innerText(), /0 sélectionnée\b/, 'La portée change, la sélection se vide')
  assert.equal(await bar.getByRole('button', { name: 'Épingler', exact: true }).count(), 0, 'Ni épingler ni archiver une archivée')
  await bar.getByRole('button', { name: 'Tout', exact: true }).click()
  await expectTitles(['Fix the flaky retry test', 'Migrate icons to Lucide', 'Rate-limit the places endpoint'])
  assert.match(await bar.innerText(), /3 sélectionnées/)
  await shot('1280-archivees-tout')
  await bar.getByRole('button', { name: 'Désarchiver', exact: true }).click()
  await until(async () => {
    const all = await (await context.request.get(`${base}/api/conversations`)).json()
    return all.every((entry) => entry.archivedAt === null)
  }, 'Toutes désarchivées')
  await content.getByText('Aucune session archivée.').waitFor()
  await scope.getByRole('radio', { name: /Actives/ }).click()

  // Supprimer : une confirmation, au pluriel, qui dit que c'est sans retour.
  await line(flaky).waitFor()
  await selectToggle.click()
  await line(flaky).click()
  await line(limit).click()
  await bar.getByRole('button', { name: 'Supprimer', exact: true }).click()
  const confirmDelete = page.getByRole('dialog', { name: 'Supprimer 2 sessions ?' })
  await confirmDelete.waitFor()
  assert.match(await confirmDelete.innerText(), /ne se défait pas/)
  await shot('1280-supprimer', confirmDelete)
  await confirmDelete.getByRole('button', { name: 'Annuler' }).click()
  await confirmDelete.waitFor({ state: 'detached' })
  assert.ok(await record(flaky), 'Annuler ne supprime rien')
  await line(limit).click()
  await bar.getByRole('button', { name: 'Supprimer', exact: true }).click()
  const confirmOne = page.getByRole('dialog', { name: 'Supprimer 1 session ?' })
  await confirmOne.getByRole('button', { name: 'Supprimer', exact: true }).click()
  await until(async () => (await record(flaky)) === undefined, 'Supprimée côté serveur')
  assert.ok(await record(limit), 'Seule la session cochée part')
  await line(flaky).waitFor({ state: 'detached' })

  // « Tout » ne coche que les lignes affichées : pas celles d'un groupe replié.
  await page.goto(`${base}/sessions?vue=projet`)
  await content.getByRole('button', { name: 'Replier Atlas API' }).click()
  await line(limit).waitFor({ state: 'detached' })
  await selectToggle.click()
  await bar.getByRole('button', { name: 'Tout', exact: true }).click()
  const visible = await content.locator('[data-session]').count()
  assert.ok(visible > 1)
  assert.match(await bar.innerText(), new RegExp(`^${visible} sélectionnées`), 'Le groupe replié n’est pas coché')
  await content.getByRole('button', { name: 'Déplier Atlas API' }).click()
  assert.equal(await line(limit).getAttribute('aria-checked'), 'false')
  assert.match(await bar.innerText(), new RegExp(`^${visible} sélectionnées`))
  await toolbar.getByRole('button', { name: 'Terminer' }).click()

  // Au téléphone : la barre tient, les libellés de la barre d'outils se replient.
  await page.setViewportSize({ width: 390, height: 844 })
  await selectToggle.click()
  await line(limit).click()
  assert.equal(Math.round((await bar.boundingBox()).height), 44, 'La barre de sélection fait h-11')
  await shot('390-selection')
  await toolbar.getByRole('button', { name: 'Terminer' }).click()
  await bar.waitFor({ state: 'detached' })

  assert.deepEqual(errors, [])
  console.log('OK : /sessions — bande, lieu Fils, contenu sans planifiées, états, ligne, Ce qui t’attend, tranches, recherche, filtres, adresse source, portée, vues, tri, ouverture, états vides, téléphone, sélection et gestes en masse ; captures dans ' + shots)
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
