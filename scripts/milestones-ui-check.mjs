import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './checks/browser.mjs'
import { viteDependency } from './checks/vite-deps.mjs'

// Les vues des jalons (spec page projet v2, jalons.md §6), une étape par sujet. Composants
// réels, montés seuls dans une page de lieu réduite ; API simulée, ni daemon ni base.
//
// Étape « horizon » (#190, BAR-1..7, CAP-1..3, HOR-1..13) : la vraie page des Jalons —
// recherche, filtres et leurs comptes, puces, échelle ; le cap écrit, modifié, vidé ; la
// chaîne, Maintenant (axe, barre, lancement, retard, infobulle), Ensuite et Plus tard
// (ordre du tableau, prochaine action, lien) ; « + Jalon » et une carte cochée « C'est un
// jalon » arrivent comme idées sous Plus tard.
//
// Étape « page » (#194, JAL-1..8, VAG-1..10) : l'en-tête, la prochaine action et son geste,
// les étapes expliquées (fiche par étape, téléphone), la mise en page, les vagues (colonnes,
// arêtes, cycle, chaîne au survol, empilement au téléphone, repère ambre).
//
// Étape « affinage » (#195, AFF-1..6) : la session d'affinage résumée sur la page — ses
// quatre états, son mode, son outil en cours, ses questions répondues sur place (gardées,
// envoyées ensemble à la dernière), son brouillon corrigé (renommer, monter, lier,
// retirer, ajouter) puis validé, et le geste qui ouvre un affinage pré-rempli.
//
// Étape « fiche » (#199, FCH-1..9, FLG-1) : `ℹ` n'ouvre pas la session, `?fiche=` se
// partage, les sections, les liens qui changent de fiche, la réponse sur place, la case
// « C'est un jalon » (d'office, grisée, cochable).
const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise((resolve) => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const vite = spawn(process.execPath, [web + 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: web, stdio: 'pipe' })
let diagnostics = ''
for (const stream of [vite.stdout, vite.stderr]) stream.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-6000) })
let browser

const PROJECT = '11111111-1111-4111-8111-111111111111'
const DAY = 86_400_000
const now = Date.now()

const link = (card) => ({ id: card.id, number: card.number, title: card.title, column: card.column })
const cardSession = (id, title, status, ago, extra = {}) => ({ id, title, agent: 'claude', status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: now - ago, ...extra })
const card = (number, title, column, extra = {}) => ({
  id: `card-${number}`, projectId: PROJECT, number, title, description: '', column, position: number, dueAt: null, parent: null,
  milestone: false, children: [], branch: null, branchPr: null, refinement: null, acceptedAt: now - 9 * DAY, toClarifySince: null, createdBy: 'u1',
  createdByName: 'Tim', createdAt: now - 9 * DAY, updatedAt: now - DAY, columnSince: now - 2 * DAY, conversations: [],
  attachmentCount: 0, noteCount: 0, references: [], referencedBy: [], blocks: [], blockedBy: [], related: [], duplicateOf: null,
  duplicates: [], issue: null, ...extra,
})

/** Le board de l'essai, réécrit par les PATCH et les cases cochées. */
function board() {
  const milestone = card(182, 'Page projet v2 · Jalons', 'in_progress', { milestone: true })
  const tiroir = card(161, 'Tiroir commun', 'done')
  const fiche = card(199, 'Fiche de carte sur place', 'in_progress', {
    description: 'La fiche **sur place**, hors du board.\n\n- [x] Le module pur\n- [ ] Les composants\n- [ ] La suite fiche',
    dueAt: now - 2 * DAY,
    parent: link(milestone),
    conversations: [
      cardSession('s-old', 'Première piste', 'idle', 3 * DAY),
      cardSession('s-wait', 'Fiche : composants', 'awaiting_input', DAY, { worktreeName: 'feat/199-fiche-de-carte' }),
      // Rangée mais encore en attente : ni dans la liste, ni dans la réponse sur place.
      cardSession('s-gone', 'Session rangée', 'awaiting_input', 4 * DAY, { archivedAt: now - DAY }),
    ],
  })
  const tableau = card(180, 'Tableau : Kanban réel', 'todo', { parent: link(milestone) })
  const idea = card(240, 'Une idée en l’air', 'todo')
  fiche.blockedBy = [link(tiroir)]
  fiche.blocks = [link(tableau)]
  tiroir.blocks = [link(fiche)]
  tableau.blockedBy = [link(fiche)]
  milestone.children = [link(fiche), link(tableau)]
  return [milestone, tiroir, fiche, tableau, idea]
}

/** Les jalons de l'étape « page », un par étape de maturité qu'elle exerce. */
function milestones() {
  const all = []
  const parent = (number, title, kids, extra = {}) => {
    const milestone = card(number, title, 'todo', { milestone: true, ...extra })
    for (const kid of kids) kid.parent = link(milestone)
    milestone.children = kids.map(link)
    all.push(milestone, ...kids)
    return milestone
  }
  const depend = (blocked, ...blockers) => {
    for (const blocker of blockers) {
      blocked.blockedBy.push(link(blocker))
      blocker.blocks.push(link(blocked))
    }
  }
  // À régler : une carte à préciser, trois vagues, une abandonnée qui n'y est pas.
  const axis = card(301, 'Échelle et axe', 'done')
  const bars = card(302, 'Barres de cartes', 'in_progress', { conversations: [cardSession('s-302', 'Barres', 'running', DAY)] })
  const tip = card(303, 'Infobulle flottante', 'todo', { toClarifySince: now - DAY })
  const horizon = card(304, 'Horizon des jalons', 'todo', { dueAt: now - 2 * DAY })
  const gone = card(305, 'Piste écartée', 'abandoned')
  depend(bars, axis)
  depend(tip, axis)
  depend(horizon, bars, tip)
  parent(300, 'Page projet v2 · Jalons', [axis, bars, tip, horizon, gone])
  // Une idée, sans cartes.
  all.push(card(320, 'Mode hors ligne', 'todo', { milestone: true }))
  // Prêt.
  const first = card(331, 'Adresse de secours', 'todo')
  const second = card(332, 'Doc mobile', 'todo')
  depend(second, first)
  parent(330, 'Accès distant fiable', [first, second, card(333, 'Sonde réseau', 'todo'), card(334, 'Journal des coupures', 'todo')])
  // Lancé, la PR du jalon ouverte.
  parent(340, 'Comptes nommés', [card(341, 'Alias', 'done'), card(342, 'Migration', 'done')], {
    branch: 'jalon/340-comptes-nommes', branchPr: { number: 77, url: 'https://github.com/tipaq/solera/pull/77', mergedAt: null },
  })
  // Un cycle.
  const loopA = card(351, 'Fil unique', 'todo')
  const loopB = card(352, 'Filtres par nature', 'todo')
  depend(loopA, loopB)
  depend(loopB, loopA)
  parent(350, 'Activité et Journal', [loopA, loopB])
  // Lancé, une session qui t'attend, une carte ajoutée depuis le lancement.
  parent(360, 'Tableau réel', [
    card(361, 'Kanban', 'in_progress', { conversations: [cardSession('s-361', 'Kanban', 'awaiting_input', DAY)] }),
    card(362, 'Colonnes', 'todo', { createdAt: now - DAY }),
  ])
  return all
}

const RUN_360 = {
  id: 'run-360', cardId: 'card-360', cardNumber: 360, cardTitle: 'Tableau réel', state: 'running', mode: 'auto', concurrency: 2,
  confined: null, agent: 'claude', model: 'claude-opus-5-5', branch: 'jalon/360-tableau-reel', busy: 1, cards: [],
  createdAt: now - 3 * DAY, endedAt: null,
}

const conversation = (entry, extra = {}) => ({
  id: entry.id, projectId: PROJECT, worktreeId: null, worktreeGone: false, card: { id: 'card-199', number: 199, title: 'Fiche de carte sur place', column: 'in_progress' },
  userId: 'u1', title: entry.title, titleSetByUser: false, agent: 'claude', forkedFromId: null, handoffFromId: null, config: {},
  status: entry.status, lastSeq: 4, lastNotableSeq: 4, lastReadSeq: 4, costUsd: 0, inputTokens: 0, outputTokens: 0, metrics: null,
  pinned: false, archivedAt: entry.archivedAt, createdAt: entry.createdAt, updatedAt: now - 60_000, isOwner: true, origin: null,
  scheduleId: null, milestone: null, ...extra,
})

const QUESTION = {
  conversationId: 's-wait', requestId: 'q1', requestedAt: now - 12 * 60_000,
  event: { type: 'question.requested', requestId: 'q1', questions: [{ id: 'keep', header: 'Composant', question: 'Je garde l’ancien composant derrière un réglage ?', options: [{ label: 'Le supprimer', description: '', preview: null }, { label: 'Le garder', description: '', preview: null }], multiSelect: false, allowOther: true, secret: false }] },
}

const NOTES = Array.from({ length: 5 }, (_, index) => ({
  id: `n${index}`, createdAt: now - (index + 1) * 3_600_000, body: `Note numéro ${index + 1}.`,
  author: index % 2 ? { kind: 'user', name: 'Tim' } : { kind: 'agent', agent: 'claude', conversationId: 's-old', conversationTitle: 'Première piste' },
}))

/* ------------------------------------------------------------------ horizon */

/** Un jalon et ses enfants, liés dans les deux sens comme le serveur les rend. */
function family(parent, kids) {
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids]
}

/**
 * Un projet à toutes les étapes : un jalon lancé qui t'attend et a grossi depuis son
 * lancement, un prêt en retard dont une carte avance, un livré ; deux à régler ou prêts,
 * deux idées ou à affiner ; une carte libre qu'on cochera « C'est un jalon ».
 */
function horizonBoard() {
  const launched = card(910, 'Page projet v2', 'in_progress', { milestone: true, createdAt: now - 6 * DAY, dueAt: now + 5 * DAY })
  const late = card(920, 'Accès distant fiable', 'todo', { milestone: true, createdAt: now - 8 * DAY, dueAt: now - 3 * DAY })
  const delivered = card(940, 'Comptes Claude nommés', 'done', { milestone: true, createdAt: now - 20 * DAY, dueAt: now - 10 * DAY })
  const ready = card(930, 'Partage en équipe', 'todo', { milestone: true, position: 30 })
  const split = card(950, 'Fil unique', 'todo', { milestone: true, position: 20 })
  return [
    ...family(launched, [
      card(911, 'Échelle et axe', 'done', { createdAt: now - 12 * DAY }),
      card(912, 'Barres de cartes', 'in_progress', { conversations: [cardSession('s-912', 'Barres', 'awaiting_input', DAY)] }),
      card(913, 'Ajoutée en route', 'todo', { createdAt: now - DAY }),
    ]),
    ...family(late, [card(921, 'Adresse de secours', 'in_progress', { conversations: [cardSession('s-921', 'Adresse', 'running', DAY)] })]),
    ...family(delivered, [card(941, 'Alias', 'done'), card(942, 'Migration', 'done')]),
    ...family(ready, [card(931, 'Invitations', 'todo')]),
    ...family(split, [card(951, 'Filtres par nature', 'todo', { toClarifySince: now - DAY })]),
    card(901, 'Mode hors ligne', 'todo', { milestone: true, position: 50 }),
    card(902, 'Projets partagés', 'todo', {
      milestone: true, position: 40,
      refinement: { conversationId: 'split-902', title: 'Affinage', status: 'running', mode: 'questions', createdAt: now - DAY, draft: null, change: null },
    }),
    card(960, 'Une idée en l’air', 'todo', { position: 960 }),
  ]
}

const RUN = { id: 'run-910', cardId: 'card-910', state: 'running', mode: 'auto', concurrency: 2, confined: false, createdAt: now - 3 * DAY, cards: [] }
const projectOf = (cap) => ({
  id: PROJECT, name: 'Solera', image: null, workspacePath: '/tmp/solera', ownerId: 'u1', ownerName: 'Tim', visibility: 'private', color: null,
  isOwner: true, position: 0, archivedAt: null, createdAt: now - 90 * DAY, conversationCount: 0, configLayer: {}, instructionsMode: null,
  designSystemPath: null, cap, turnCheckpoints: false, activeTerminals: 0, git: null,
})

/** La vraie page des Jalons, sous sa route, avec le tiroir commun de la coque. */
async function mountHorizon(page, entry) {
  const modules = {
    react: await viteDependency(origin, 'react', '/src/components/shell/Drawer.tsx'),
    reactDom: await viteDependency(origin, 'react-dom/client', '/src/main.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/shell/Drawer.tsx'),
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/cards.ts'),
    router: await viteDependency(origin, 'react-router-dom', '/src/routes/milestones/MilestonesPage.tsx'),
  }
  await page.goto(`${origin}/__milestones_check`)
  await page.evaluate(async ({ modules, entry }) => {
    const refresh = (await import('/@react-refresh')).default
    refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    localStorage.setItem('solera.locale', 'fr')
    await (await import('/src/lib/i18n/index.ts')).initLocale()
    document.documentElement.dataset.theme = 'dark'
    await import('/src/styles/index.css')
    const React = (await import(modules.react)).default
    const { createRoot } = (await import(modules.reactDom)).default
    const { TooltipProvider } = await import(modules.ui)
    const { QueryClient, QueryClientProvider } = await import(modules.query)
    const { MemoryRouter, Routes, Route, useLocation } = await import(modules.router)
    const { DrawerLayer } = await import('/src/components/shell/Drawer.tsx')
    const { DetailSurfaceContext } = await import('/src/lib/detail-surface.ts')
    const { MilestonesPage } = await import('/src/routes/milestones/MilestonesPage.tsx')
    const h = React.createElement
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

    function Where() {
      const location = useLocation()
      window.where = location.pathname + location.search
      return null
    }

    createRoot(document.getElementById('check')).render(
      h(QueryClientProvider, { client },
        h(MemoryRouter, { initialEntries: [entry] },
          h(TooltipProvider, null,
            h(DetailSurfaceContext.Provider, { value: 'drawer' },
              h(Where),
              h('div', { className: 'flex h-dvh flex-col' },
                h('nav', { className: 'h-12 shrink-0 border-b border-line', 'aria-label': 'Rangée' }),
                h('div', { 'data-place-content': '', className: 'relative flex min-h-0 flex-1 flex-col overflow-clip' },
                  h(Routes, null,
                    h(Route, { path: '/p/:projectId/timeline', element: h(MilestonesPage) }),
                    h(Route, { path: '*', element: h('p', null, 'ailleurs') })),
                  h(DrawerLayer))))))))
  }, { modules, entry })
}

async function horizonStep(width) {
  const phone = width < 700
  const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: phone, isMobile: phone, locale: 'fr-FR', serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  let cards = horizonBoard()
  let cap = null
  const writes = []
  await page.route('**/__milestones_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (path === '/api/projects') return route.fulfill({ json: [projectOf(cap)] })
    if (path === `/api/projects/${PROJECT}` && method === 'PATCH') {
      const body = request.postDataJSON()
      writes.push({ kind: 'project', ...body })
      cap = body.cap
      return route.fulfill({ json: { ok: true } })
    }
    if (path === `/api/projects/${PROJECT}/cards` && method === 'POST') {
      const body = request.postDataJSON()
      writes.push({ kind: 'create', ...body })
      const created = card(970, body.title, body.column ?? 'todo', { milestone: Boolean(body.milestone), position: 970, createdAt: Date.now() })
      cards = [...cards, created]
      return route.fulfill({ json: created })
    }
    if (path === `/api/projects/${PROJECT}/cards`) return route.fulfill({ json: cards })
    if (path === `/api/projects/${PROJECT}/milestones/active`) return route.fulfill({ json: [RUN] })
    if (path === `/api/projects/${PROJECT}/prompts`) return route.fulfill({ json: { prompts: [] } })
    if (path === '/api/conversations') return route.fulfill({ json: [] })
    if (path === '/api/awaiting') return route.fulfill({ json: { requests: [] } })
    if (path === '/api/auth/me') return route.fulfill({ json: { id: 'u1', name: 'Tim', email: 'tim@example.com' } })
    if (/^\/api\/cards\/[^/]+\/notes$/.test(path)) return route.fulfill({ json: [] })
    const patch = /^\/api\/cards\/([^/]+)$/.exec(path)
    if (patch && method === 'PATCH') {
      const body = request.postDataJSON()
      writes.push({ kind: 'patch', id: patch[1], ...body })
      const target = cards.find((entry) => entry.id === patch[1])
      Object.assign(target, body)
      return route.fulfill({ json: target })
    }
    return route.fulfill({ status: 404, json: {} })
  })

  const where = () => page.evaluate(() => window.where)
  const section = (name) => page.getByRole('region', { name, exact: true })
  const tiles = (name) => section(name).getByRole('listitem')
  const numbersIn = async (name) => (await tiles(name).allTextContents()).map((text) => Number(/#(\d+)/.exec(text)?.[1]))
  const chainCount = async (label) =>
    Number(await page.getByRole('list', { name: 'Jalons par étape' }).getByRole('listitem').filter({ hasText: label }).locator('span').last().textContent())
  const shot = (locator, name) => locator.screenshot({ animations: 'disabled', path: `/tmp/milestones-horizon-${name}-${width}.png` })

  console.log(width, 'horizon : les trois temps, dans leur ordre')
  await mountHorizon(page, `/p/${PROJECT}/timeline`)
  await section('Maintenant').waitFor()
  const axis = section('Maintenant')
  const axisNames = await axis.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  assert.deepEqual(axisNames, [920, 910, 940].map((number) => `/p/${PROJECT}/timeline/${number}`), 'Maintenant : non livrés par création, livré en dernier')
  assert.deepEqual(await numbersIn('Ensuite'), [950, 930], 'Ensuite : À régler et Prêt, dans l’ordre du tableau')
  assert.deepEqual(await numbersIn('Plus tard'), [902, 901], 'Plus tard : À affiner et Idée, dans l’ordre du tableau')
  assert.equal(await page.getByText('Une idée en l’air').count(), 0, 'Une carte sans drapeau n’est pas un jalon')

  console.log(width, 'HOR-1 : la chaîne compte chaque étape')
  assert.deepEqual(
    [await chainCount('Idée'), await chainCount('À affiner'), await chainCount('À régler'), await chainCount('Prêt'), await chainCount('Lancé'), await chainCount('Livré')],
    [1, 1, 1, 2, 1, 1],
  )

  console.log(width, 'HOR-4..7 : nom, pastille, ajouts, barre, lancement, échéance, retard')
  const row910 = axis.getByRole('link', { name: /#910/ })
  assert.equal(await row910.getByText('Lancé', { exact: true }).isVisible(), true)
  assert.equal(await row910.getByText('+1 depuis le lancement').isVisible(), true)
  const bar910 = page.locator('[data-milestone-bar="910"]')
  assert.equal(await bar910.getByText('1/3', { exact: true }).isVisible(), true, 'fait / non abandonnées')
  assert.equal(await bar910.getByText('1 t’attend').isVisible(), true, 'la carte dont une session attend')
  assert.equal(await bar910.locator('[data-launch]').count(), 1, 'le trait du lancement')
  const bar920 = page.locator('[data-milestone-bar="920"]')
  assert.match(await bar920.locator('[data-due]').getAttribute('class'), /border-critical/, 'losange rouge en retard')
  assert.match(await page.locator('[data-milestone-bar="940"] [data-due]').getAttribute('class'), /border-positive/, 'losange vert une fois livré')
  await shot(page.locator('[data-toolbar]'), 'barre')
  await shot(axis, 'maintenant')

  if (!phone) {
    console.log(width, 'HOR-8 : survol, les autres pâlissent, infobulle')
    await bar920.hover()
    const tip = page.getByRole('tooltip').filter({ hasText: '#920' })
    await tip.waitFor()
    assert.equal(await tip.getByText('3 j de retard', { exact: false }).isVisible(), true)
    assert.equal(await tip.getByText('Prêt — ', { exact: false }).isVisible(), true, 'la maturité et sa raison')
    assert.match(await page.locator('[data-milestone-bar="910"]').getAttribute('class'), /opacity-40/)
    await shot(axis, 'maintenant-survol')
    await page.mouse.move(5, 5)
  }

  console.log(width, 'HOR-11 : une tuile mène à la page du jalon et dit sa prochaine action')
  const tile950 = tiles('Ensuite').first()
  assert.equal(await tile950.getByRole('link').getAttribute('href'), `/p/${PROJECT}/timeline/950`)
  assert.equal(await tile950.getByText('Préciser', { exact: true }).isVisible(), true)
  assert.equal(await tile950.getByText('1 carte ouverte').isVisible(), true)
  assert.equal(await tiles('Plus tard').last().getByText('Pas encore découpé').isVisible(), true)
  await shot(section('Ensuite'), 'ensuite')
  await shot(section('Plus tard'), 'plus-tard')
  await shot(page.getByRole('list', { name: 'Jalons par étape' }), 'chaine')

  console.log(width, 'ℹ d’une tuile ouvre la fiche sur place, sans suivre le lien')
  await tile950.getByRole('button', { name: 'Détail de la carte #950' }).click()
  await page.getByRole('dialog', { name: 'Carte #950' }).waitFor()
  assert.equal(await where(), `/p/${PROJECT}/timeline?fiche=950`)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })

  console.log(width, 'BAR-2 : la recherche lit #numéro et titre ; la chaîne suit le filtre')
  const search = page.getByRole('searchbox', { name: 'Chercher un jalon' })
  await search.fill('#910')
  await page.waitForFunction(() => document.querySelectorAll('[data-milestone-bar]').length === 1)
  assert.equal(await section('Ensuite').getByText('Rien de découpé en attente.').isVisible(), true)
  assert.equal(await chainCount('Lancé'), 1)
  assert.equal(await chainCount('Prêt'), 0)
  await search.fill('hors ligne')
  assert.deepEqual(await numbersIn('Plus tard'), [901])
  await search.fill('')

  console.log(width, 'BAR-3, BAR-4 : filtres comptés sur tous les jalons, puces, effacer')
  await page.getByRole('button', { name: 'Filtrer' }).click()
  const menu = page.getByRole('dialog', { name: 'Filtrer' })
  const ready = menu.getByRole('checkbox', { name: /^Prêt/ })
  assert.equal((await ready.textContent()).trim(), 'Prêt2')
  await ready.click()
  await menu.getByRole('checkbox', { name: /^En retard/ }).click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelectorAll('[data-milestone-bar]').length === 1)
  assert.equal(await page.locator('[data-milestone-bar="920"]').count(), 1, 'prêt et en retard : seul #920')
  assert.equal(await chainCount('Prêt'), 1)
  const chips = page.locator('[data-filter-chip]')
  assert.deepEqual(await chips.allTextContents(), ['Prêt', 'en retard'])
  await shot(page.locator('[data-toolbar]'), 'barre-filtree')
  await chips.filter({ hasText: 'en retard' }).getByRole('button').click()
  assert.deepEqual(await chips.allTextContents(), ['Prêt'])
  await page.getByRole('button', { name: /^Filtrer/ }).click()
  await menu.getByRole('button', { name: 'Effacer tous les filtres' }).click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelectorAll('[data-milestone-bar]').length === 3)
  assert.equal(await chips.count(), 0)

  console.log(width, 'BAR-5 : Affichage règle l’échelle, Mois par défaut')
  await page.getByRole('button', { name: 'Affichage : Horizon' }).click()
  const display = page.getByRole('dialog', { name: 'Affichage' })
  await display.getByRole('radio', { name: 'Horizon', checked: true }).waitFor()
  assert.equal(await display.getByRole('radio', { name: 'Mois' }).getAttribute('aria-checked'), 'true')
  const before = await axis.locator('.overflow-x-auto > div').first().evaluate((element) => element.scrollWidth)
  await display.getByRole('radio', { name: 'Semaine' }).click()
  await page.keyboard.press('Escape')
  await page.waitForFunction((before) => document.querySelector('[aria-label="Maintenant"] .overflow-x-auto > div').scrollWidth > before, before)

  console.log(width, 'CAP-1..3 : ajouter, modifier, vider le cap')
  await page.getByRole('button', { name: 'Ajouter un cap' }).click()
  const field = page.getByRole('textbox', { name: 'Cap' })
  assert.equal(await field.evaluate((element) => element === document.activeElement), true, 'focus d’office')
  await field.fill('  Un cockpit d’agents, au bureau et au téléphone.  ')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByText('Un cockpit d’agents, au bureau et au téléphone.', { exact: true }).waitFor()
  assert.deepEqual(writes.at(-1), { kind: 'project', cap: 'Un cockpit d’agents, au bureau et au téléphone.' })
  await shot(page.getByText('Un cockpit d’agents, au bureau et au téléphone.', { exact: true }).locator('xpath=ancestor::div[contains(@class, "group")][1]'), 'cap')
  await page.getByRole('button', { name: 'Modifier le cap' }).click()
  await page.getByRole('textbox', { name: 'Cap' }).fill('   ')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByRole('button', { name: 'Ajouter un cap' }).waitFor()
  assert.deepEqual(writes.at(-1), { kind: 'project', cap: null })

  console.log(width, 'BAR-7 : « + Jalon » note une idée, qui arrive sous Plus tard')
  await page.getByRole('button', { name: 'Jalon', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouveau jalon' })
  await dialog.getByRole('textbox').first().fill('Tableau de bord des coûts')
  await dialog.getByRole('button', { name: 'Noter l’idée' }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(writes.at(-1).milestone, true)
  assert.equal(writes.at(-1).title, 'Tableau de bord des coûts')
  await section('Plus tard').getByText('Tableau de bord des coûts').waitFor()
  assert.match(await where(), /vue=horizon/, '« + Jalon » repasse en Horizon')

  console.log(width, 'HOR-12 (#199) : une carte cochée « C’est un jalon » arrive comme idée sous Plus tard')
  await mountHorizon(page, `/p/${PROJECT}/timeline?fiche=960`)
  const sheet = page.getByRole('dialog', { name: 'Carte #960' })
  await sheet.waitFor()
  await sheet.getByRole('checkbox', { name: 'C’est un jalon' }).check()
  await section('Plus tard').getByText('Une idée en l’air').waitFor()
  assert.deepEqual(writes.at(-1), { kind: 'patch', id: 'card-960', milestone: true })
  const idea = tiles('Plus tard').filter({ hasText: 'Une idée en l’air' })
  assert.equal(await idea.getByText('Idée', { exact: true }).isVisible(), true)

  if (phone) {
    console.log(width, 'HOR-13 : une colonne, seul l’axe défile en largeur')
    await page.keyboard.press('Escape')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'rien ne déborde')
    const columns = await page.getByRole('list', { name: 'Jalons par étape' }).evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
    assert.equal(columns, 3)
  }

  assert.deepEqual(errors, [])
  await context.close()
}

async function mount(page, entry, view = 'list') {
  // Les fournisseurs viennent des mêmes modules que les composants : voir `viteDependency`.
  const modules = {
    react: await viteDependency(origin, 'react', '/src/components/shell/Drawer.tsx'),
    reactDom: await viteDependency(origin, 'react-dom/client', '/src/main.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/shell/Drawer.tsx'),
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/cards.ts'),
    router: await viteDependency(origin, 'react-router-dom', '/src/components/cards/CardInfoButton.tsx'),
  }
  await page.goto(`${origin}/__milestones_check`)
  await page.evaluate(async ({ modules, project, entry, view }) => {
    const refresh = (await import('/@react-refresh')).default
    refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    localStorage.setItem('solera.locale', 'fr')
    await (await import('/src/lib/i18n/index.ts')).initLocale()
    document.documentElement.dataset.theme = 'dark'
    await import('/src/styles/index.css')
    const React = (await import(modules.react)).default
    const { createRoot } = (await import(modules.reactDom)).default
    const { TooltipProvider } = await import(modules.ui)
    const { QueryClient, QueryClientProvider } = await import(modules.query)
    const { MemoryRouter, Link, Route, Routes, useLocation } = await import(modules.router)
    const { MilestonePage } = await import('/src/routes/milestones/MilestonePage.tsx')
    const { DrawerLayer } = await import('/src/components/shell/Drawer.tsx')
    const { DetailSurfaceContext } = await import('/src/lib/detail-surface.ts')
    const { CardInfoButton } = await import('/src/components/cards/CardInfoButton.tsx')
    const { CardSheetHost } = await import('/src/components/cards/CardSheetHost.tsx')
    const { useCards } = await import('/src/lib/cards.ts')
    const h = React.createElement
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

    function Where() {
      const location = useLocation()
      window.where = location.pathname + location.search
      return null
    }

    // Une vue de cartes hors board : chaque ligne mène à sa session, `ℹ` à sa fiche.
    function Page() {
      const { data: cards } = useCards(project)
      return h('div', { className: 'flex h-dvh flex-col' },
        h('nav', { className: 'h-12 shrink-0 border-b border-line', 'aria-label': 'Rangée' }),
        h('div', { 'data-place-content': '', className: 'relative flex min-h-0 flex-1 flex-col overflow-clip' },
          h('ul', { 'aria-label': 'Cartes', className: 'flex max-w-md flex-col gap-1 p-6' },
            (cards ?? []).map((card) => h('li', { key: card.id },
              h(Link, { to: `/p/${project}/c/s-${card.number}`, className: 'flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface' },
                h('span', { className: 'text-xs text-ink-faint' }, `#${card.number}`),
                h('span', { className: 'min-w-0 flex-1 truncate' }, card.title),
                h(CardInfoButton, { card }))))),
          h(CardSheetHost, { projectId: project }),
          h(DrawerLayer)))
    }

    // La page d'un jalon, dans un lieu réduit : la rangée, puis le contenu qui défile.
    function Milestone() {
      return h('div', { className: 'flex h-dvh flex-col' },
        h('nav', { className: 'h-12 shrink-0 border-b border-line', 'aria-label': 'Rangée' }),
        h('div', { 'data-place-content': '', className: 'relative flex min-h-0 flex-1 flex-col overflow-clip' },
          h(Routes, null, h(Route, { path: '/p/:projectId/timeline/:number', element: h(MilestonePage) })),
          h(DrawerLayer)))
    }

    createRoot(document.getElementById('check')).render(
      h(QueryClientProvider, { client },
        h(MemoryRouter, { initialEntries: [entry] },
          h(TooltipProvider, null,
            h(DetailSurfaceContext.Provider, { value: 'drawer' }, h(Where), view === 'page' ? h(Milestone) : h(Page))))))
  }, { modules, project: PROJECT, entry, view })
}

/** Étape « page » : la page d'un jalon, à une largeur. */
async function pageStep(width) {
  const phone = width < 700
  const context = await browser.newContext({ viewport: { width, height: 860 }, hasTouch: phone, isMobile: phone, locale: 'fr-FR', serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const cards = milestones()
  const merges = []
  await page.route('**/__milestones_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === `/api/projects/${PROJECT}/cards`) return route.fulfill({ json: cards })
    if (path === `/api/projects/${PROJECT}/milestones/active`) return route.fulfill({ json: [RUN_360] })
    if (path === '/api/cards/card-360/milestone') return route.fulfill({ json: RUN_360 })
    if (/^\/api\/cards\/[^/]+\/milestone$/.test(path)) return route.fulfill({ json: null })
    if (path === '/api/conversations') return route.fulfill({ json: [] })
    if (path === `/api/projects/${PROJECT}/prompts`) return route.fulfill({ json: { prompts: [] } })
    if (path === '/api/awaiting') return route.fulfill({ json: { requests: [] } })
    if (/^\/api\/cards\/[^/]+\/notes$/.test(path)) return route.fulfill({ json: [] })
    if (path === '/api/cards/card-340/branch-pr/merge') {
      merges.push(request.method())
      return route.fulfill({ status: 409, json: { error: { code: 'branch_pr_closed', message: 'PR fermée' } } })
    }
    return route.fulfill({ status: 404, json: {} })
  })
  const where = () => page.evaluate(() => window.where)
  const band = page.getByRole('region', { name: 'Prochaine action' })
  const waves = page.getByRole('region', { name: 'Vagues' })
  const node = (number) => waves.getByRole('link', { name: new RegExp(`^#${number} `) })
  const step = (label) => page.getByRole('button', { name: `Étape ${label}`, exact: true })
  const sheet = (label) => page.getByRole('dialog', { name: `Étape ${label}` })
  const inView = (id) => page.evaluate((id) => {
    const rect = document.getElementById(id).getBoundingClientRect()
    return rect.top >= 0 && rect.top < window.innerHeight
  }, id)

  console.log(width, 'en-tête : drapeau, #N titre, ℹ, pastille, échéance ; retour vers les Jalons')
  await mount(page, `/p/${PROJECT}/timeline/300`, 'page')
  await page.getByRole('heading', { name: '#300 Page projet v2 · Jalons' }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Jalons', exact: true }).getAttribute('href'), `/p/${PROJECT}/timeline`)
  assert.equal(await page.getByRole('button', { name: 'Détail de la carte #300' }).isVisible(), true)
  assert.equal(await page.locator('header').getByText('À régler', { exact: true }).isVisible(), true)
  assert.equal(await page.locator('header').getByText('sans échéance').isVisible(), true)

  console.log(width, 'la prochaine action : le détail en grand et son bouton')
  await band.getByText('1 carte à préciser').waitFor()
  assert.equal(await band.getByRole('button', { name: 'Préciser', exact: true }).isVisible(), true)

  console.log(width, 'l’affinage qui attend passe avant les vagues')
  const refineTop = (await page.locator('#affinage').boundingBox()).y
  assert.ok(refineTop < (await waves.boundingBox()).y, 'L’affinage en attente vient en tête')
  assert.equal(await page.locator('#affinage').getByText('1 carte est à préciser : #303.').isVisible(), true)

  console.log(width, 'vagues : trois colonnes, ouvertes d’abord, l’abandonnée exclue')
  await waves.getByText('ce qui part ensemble, de gauche à droite · 3 à la fois').waitFor()
  for (const label of ['Vague 1', 'Vague 2', 'Vague 3']) assert.equal(await waves.getByText(label, { exact: true }).isVisible(), true, label)
  assert.equal(await node(305).count(), 0, 'Une carte abandonnée n’est pas dans les vagues')
  assert.equal(await waves.getByText('terminée').first().isVisible(), true, 'La première vague est faite')
  assert.equal(await waves.getByText('2 ouvertes · en parallèle').isVisible(), true)
  assert.equal(await node(302).getAttribute('href'), `/p/${PROJECT}/c/s-302`, 'Une carte mène à sa session')
  assert.equal(await node(304).getByText('par #302, #303').isVisible(), true, 'Ses bloqueurs ouverts, en ambre')
  assert.equal(await node(304).evaluate((element) => element.className.includes('ring-critical')), true, 'En retard : l’anneau rouge')
  if (phone) {
    console.log(width, 'au téléphone : les vagues empilées, les liens en clair')
    assert.equal(await waves.locator('svg.absolute').count(), 0, 'Pas d’arêtes dessinées')
    assert.equal(await node(302).getByText('après #301').isVisible(), true)
    const [a, b] = [await node(302).boundingBox(), await node(304).boundingBox()]
    assert.ok(Math.abs(a.x - b.x) < 2, 'Les nœuds s’alignent dans une seule colonne')
  } else {
    console.log(width, 'au large : une colonne par vague, les arêtes, la chaîne au survol')
    assert.equal(await waves.locator('svg.absolute > path').count(), 4, 'Une arête par lien « bloque » dans le jalon')
    const [a, b, c] = [await node(301).boundingBox(), await node(302).boundingBox(), await node(304).boundingBox()]
    assert.ok(a.x < b.x && b.x < c.x, 'Une colonne par vague, de gauche à droite')
    assert.equal(Math.round(a.height), 76, 'Des nœuds de taille égale')
    await node(302).hover()
    await page.waitForTimeout(200)
    assert.equal(await node(303).evaluate((element) => element.className.includes('opacity-30')), true, 'Hors de la chaîne : atténuée')
    assert.equal(await node(301).evaluate((element) => element.className.includes('opacity-30')), false, 'Son bloqueur est éclairé')
    assert.equal(await waves.locator('svg.absolute > path.stroke-accent').count(), 2, 'Les arêtes de sa chaîne en accent')
    await page.mouse.move(2, 2)
    await page.waitForTimeout(250)
  }
  await page.screenshot({ path: `/tmp/milestones-page-${width}.png` })

  console.log(width, 'étapes expliquées : la courante dit pourquoi et comment en sortir')
  if (phone) {
    await page.getByRole('button', { name: 'Étape 3/6 · À régler · pourquoi ?' }).click()
  } else {
    assert.equal(await page.getByRole('button', { name: 'Étape 3/6 · À régler · pourquoi ?' }).isVisible(), false, 'Le rappel au doigt seulement')
    await step('À régler').click()
  }
  const current = sheet('À régler')
  await current.waitFor()
  for (const text of ['3/6', 'ici maintenant', 'Pourquoi il est ici', '1 carte est à préciser : #303.', 'Pour passer à l’étape suivante']) {
    assert.equal(await current.getByText(text, { exact: true }).isVisible(), true, text)
  }
  await page.screenshot({ path: `/tmp/milestones-page-etape-${width}.png` })
  await current.getByRole('button', { name: 'Préciser' }).click()
  await current.waitFor({ state: 'detached' })

  console.log(width, 'une autre étape : quand il y était, quand il y sera')
  await step('Prêt').click()
  await sheet('Prêt').getByText('Il y sera quand').waitFor()
  assert.equal(await sheet('Prêt').getByText('à venir').isVisible(), true)
  assert.equal(await sheet('Prêt').getByRole('button').count(), 0, 'Pas de geste hors de l’étape courante')
  await page.keyboard.press('Escape')
  await step('Idée').click()
  await sheet('Idée').getByText('Il y était quand').waitFor()
  assert.equal(await sheet('Idée').getByText('franchie').isVisible(), true)
  await page.keyboard.press('Escape')

  console.log(width, 'Prêt : « Lancer » défile jusqu’au panneau Lancer')
  await mount(page, `/p/${PROJECT}/timeline/330`, 'page')
  await band.getByText('3 cartes peuvent partir tout de suite.').waitFor()
  assert.ok((await page.locator('#affinage').count()) === 0 || !(await page.locator('#affinage').isVisible()) || (await page.locator('#affinage').boundingBox()).y > (await waves.boundingBox()).y, 'Rien n’attend : l’affinage après les vagues')
  if (!phone) {
    const lancer = await page.locator('#lancer').boundingBox()
    assert.ok(lancer.x > (await waves.boundingBox()).x + 200, 'Au large, Lancer à droite')
  }
  await band.getByRole('button', { name: 'Lancer', exact: true }).click()
  await page.waitForTimeout(700)
  assert.equal(await inView('lancer'), true, 'Lancer est à l’écran')

  console.log(width, 'idée : vide des vagues, « Affiner » ouvre une session de découpage de la carte')
  await mount(page, `/p/${PROJECT}/timeline/320`, 'page')
  await waves.getByText('Pas encore découpé. L’affinage proposera des cartes et leur ordre.').waitFor()
  assert.equal(await page.locator('#lancer').innerText(), '', 'Rien à lancer sans cartes')
  await band.getByRole('button', { name: 'Affiner', exact: true }).click()
  await page.waitForFunction(() => window.where.includes('/c/new'))
  const affiner = new URL(await where(), origin)
  assert.equal(affiner.pathname, `/p/${PROJECT}/c/new`)
  assert.equal(affiner.searchParams.get('split'), 'card-320')
  assert.equal(affiner.searchParams.get('mode'), null, 'Questions d’abord : le mode par défaut')
  assert.equal(affiner.searchParams.get('prompt'), '/affiner-un-jalon #320\n\nMode hors ligne')

  console.log(width, 'cycle : « Défaire le cycle », l’arête qui remonte en rouge')
  await mount(page, `/p/${PROJECT}/timeline/350`, 'page')
  await band.getByText('un cycle entre #351, #352').waitFor()
  assert.equal(await band.getByRole('button', { name: 'Défaire le cycle' }).isVisible(), true)
  if (!phone) assert.equal(await waves.locator('svg.absolute > path.stroke-critical').count(), 1, 'Une arête rouge, celle qui remonte')

  console.log(width, 'PR du jalon ouverte : « Fusionner » appelle la route, l’échec se lit')
  await mount(page, `/p/${PROJECT}/timeline/340`, 'page')
  await band.getByText('Toutes les cartes sont fusionnées : la PR du jalon vers main est ouverte.').waitFor()
  assert.equal(await page.locator('header').getByText('Lancé', { exact: true }).isVisible(), true)
  await band.getByRole('button', { name: 'Fusionner', exact: true }).click()
  await band.getByRole('alert').waitFor()
  assert.deepEqual(merges, ['POST'])

  console.log(width, 'lancé, une session t’attend : la carte en ambre, « Répondre » ouvre sa fiche')
  await mount(page, `/p/${PROJECT}/timeline/360`, 'page')
  await band.getByRole('button', { name: 'Répondre', exact: true }).waitFor()
  assert.equal(await page.locator('header').getByText('+1 depuis le lancement').isVisible(), true)
  assert.equal(await node(361).getByText('t’attend').isVisible(), true)
  assert.equal(await node(361).evaluate((element) => element.className.includes('border-caution')), true, 'Le repère ambre')
  assert.equal(await node(361).getAttribute('href'), `/p/${PROJECT}/timeline/360?fiche=361`, 'Une carte qui t’attend ouvre sa fiche')
  assert.equal(await node(362).getByText('ajoutée').isVisible(), true)
  assert.equal(await waves.getByText('Ajoutées depuis le lancement : #362').isVisible(), true)
  assert.equal(await waves.getByText('ce qui part ensemble, de gauche à droite · 2 à la fois').isVisible(), true, 'La concurrence du pilotage')
  await page.screenshot({ path: `/tmp/milestones-page-lance-${width}.png` })
  await band.getByRole('button', { name: 'Répondre', exact: true }).click()
  await page.getByRole('dialog', { name: 'Carte #361' }).waitFor()
  assert.equal(await where(), `/p/${PROJECT}/timeline/360?fiche=361`)

  console.log(width, 'une carte ordinaire n’est pas un jalon')
  await mount(page, `/p/${PROJECT}/timeline/301`, 'page')
  await page.getByText('#301 n’est pas un jalon').waitFor()

  assert.deepEqual(errors, [])
  await context.close()
}

/* ------------------------------------------------------------------ étape « affinage » */

const SPLIT = 'split-370'
const refineSession = (extra = {}) => ({
  conversationId: SPLIT, title: 'Affiner : Hors ligne', status: 'awaiting_input', mode: 'questions', createdAt: now - DAY,
  draft: { requestId: 'd1', count: 3 }, change: null, ...extra,
})
const DRAFT_370 = {
  parent: { kind: 'existing', card: { cardId: 'card-370', number: 370, title: 'Hors ligne' } },
  cards: [
    { key: 'a', title: 'Cache des cartes', description: '', subtasks: ['Lire', 'Écrire'], after: [], blockedBy: [], related: [] },
    { key: 'b', title: 'File des envois', description: '', subtasks: [], after: ['a'], blockedBy: [], related: [] },
    { key: 'c', title: 'Bandeau hors ligne', description: '', subtasks: [], after: [], blockedBy: [], related: [] },
  ],
}
const askOf = (requestId, blocking, ...questions) => ({
  kind: 'question', requestId, requestedAt: now - 60_000,
  event: {
    type: 'question.requested', requestId, blocking,
    questions: questions.map(([id, question]) => ({ id, header: id, question, options: [], multiSelect: false, allowOther: true, secret: false })),
  },
})

/** Les jalons de l'étape : un par état que la session d'affinage peut prendre. */
function refineBoard() {
  return [
    // Questions et brouillon : elle t'attend.
    card(370, 'Hors ligne', 'todo', { milestone: true, refinement: refineSession() }),
    // Elle travaille : son outil en cours.
    card(380, 'Recherche plein texte', 'todo', { milestone: true, refinement: refineSession({ conversationId: 'split-380', status: 'running', mode: 'direct', draft: null }) }),
    // Une question asynchrone de Codex : la session tourne, mais elle t'attend.
    card(385, 'Notifications', 'todo', { milestone: true, refinement: refineSession({ conversationId: 'split-385', status: 'running', draft: null }) }),
    // Au repos sans rien proposer, sans cartes : la suite se dit dans la session.
    card(390, 'Thèmes', 'todo', { milestone: true, refinement: refineSession({ conversationId: 'split-390', status: 'idle', draft: null }) }),
    // Une idée : rien n'est lancé.
    card(395, 'Partage d’écran', 'todo', { milestone: true, description: 'Montrer une session à un collègue.' }),
  ]
}

async function refineStep(width) {
  const phone = width < 700
  const context = await browser.newContext({ viewport: { width, height: 860 }, hasTouch: phone, isMobile: phone, locale: 'fr-FR', serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let cards = refineBoard()
  // Le serveur de l'essai : la demande de questions de #370 se lève à la réponse, son
  // brouillon à la validation, qui range les cartes sous le jalon.
  let prompt370 = askOf('q1', true, ['cible', 'À quoi verra-t-on que c’est fini ?'], ['sync', 'On synchronise au retour du réseau ?'])
  let draft370 = DRAFT_370
  const answers = []
  const decisions = []
  const detailOf = (number) => {
    const milestone = cards.find((entry) => entry.number === number)
    const session = milestone.refinement
    if (!session) return { session: null, activity: null, prompt: null, draft: null, change: null }
    const base = { session, activity: null, prompt: null, draft: null, change: null }
    if (number === 370) return { ...base, prompt: prompt370, draft: draft370 && { requestId: 'd1', conversationId: SPLIT, draft: draft370 } }
    if (number === 380) return { ...base, activity: { toolCallId: 't1', toolName: 'Read', startedAt: now - 3000, nested: false, input: { file_path: 'docs/specs/recherche.md' } } }
    if (number === 385) return { ...base, prompt: askOf('q9', false, ['canal', 'Par courriel ou par le navigateur ?']) }
    return base
  }
  await page.route('**/__milestones_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === `/api/projects/${PROJECT}/cards`) return route.fulfill({ json: cards })
    if (path === `/api/projects/${PROJECT}/milestones/active`) return route.fulfill({ json: [] })
    const detail = /^\/api\/cards\/card-(\d+)\/refinement$/.exec(path)
    if (detail) return route.fulfill({ json: detailOf(Number(detail[1])) })
    if (/^\/api\/cards\/[^/]+\/milestone$/.test(path)) return route.fulfill({ json: null })
    if (path === '/api/conversations') {
      return route.fulfill({ json: [SPLIT, 'split-380', 'split-385', 'split-390'].map((id) => conversation({ id, title: id, status: 'idle', archivedAt: null, createdAt: now - DAY }, { card: null })) })
    }
    if (path === `/api/projects/${PROJECT}/prompts`) return route.fulfill({ json: { prompts: prompt370 ? [{ conversationId: SPLIT, ...prompt370 }] : [] } })
    if (path === '/api/awaiting') return route.fulfill({ json: { requests: [] } })
    if (/^\/api\/cards\/[^/]+\/notes$/.test(path)) return route.fulfill({ json: [] })
    if (path === `/api/conversations/${SPLIT}/questions/q1` && request.method() === 'POST') {
      answers.push(request.postDataJSON())
      prompt370 = null
      cards = cards.map((entry) => (entry.number === 370 ? { ...entry, refinement: { ...entry.refinement, status: 'idle' } } : entry))
      return route.fulfill({ json: {} })
    }
    if (path === `/api/conversations/${SPLIT}/card-drafts/d1` && request.method() === 'POST') {
      const body = request.postDataJSON()
      decisions.push(body)
      draft370 = null
      const milestone = cards.find((entry) => entry.number === 370)
      const kids = body.draft.cards.map((entry, index) => card(371 + index, entry.title, 'todo', { parent: link(milestone) }))
      cards = [...cards.map((entry) => (entry.number === 370 ? { ...entry, children: kids.map(link), refinement: { ...entry.refinement, draft: null } } : entry)), ...kids]
      return route.fulfill({ json: {} })
    }
    return route.fulfill({ status: 404, json: {} })
  })
  const where = () => page.evaluate(() => window.where)
  const panel = page.getByRole('region', { name: 'Session d’affinage' })
  const state = (word) => panel.getByText(word, { exact: true })

  console.log(width, 'questions et brouillon : elle t’attend, « Ouvrir la session » en geste principal')
  await mount(page, `/p/${PROJECT}/timeline/370`, 'page')
  await panel.getByText('À quoi verra-t-on que c’est fini ?').waitFor()
  assert.equal(await state('t’attend').isVisible(), true)
  assert.equal(await panel.getByText('· questions d’abord').isVisible(), true)
  assert.equal(await panel.getByRole('link', { name: 'Ouvrir la session' }).getAttribute('href'), `/p/${PROJECT}/c/${SPLIT}`)
  assert.ok((await page.locator('#affinage').boundingBox()).y < (await page.getByRole('region', { name: 'Vagues' }).boundingBox()).y, 'Elle attend : en tête')
  const validate = panel.getByRole('button', { name: 'Valider le découpage' })
  assert.equal(await validate.isDisabled(), true, 'Une question ouverte retient la validation')
  assert.equal(await panel.getByText('Réponds d’abord à la question ouverte.').isVisible(), true)
  await page.locator('#affinage').screenshot({ path: `/tmp/milestones-affinage-${width}.png` })

  console.log(width, 'les réponses se gardent, et partent ensemble à la dernière')
  await panel.getByRole('button', { name: 'Répondre ici' }).first().click()
  const first = panel.getByRole('textbox', { name: 'À quoi verra-t-on que c’est fini ?' })
  assert.equal(await first.evaluate((element) => element === document.activeElement), true, 'Le champ prend le focus')
  assert.equal(await panel.getByRole('button', { name: 'Envoyer' }).isDisabled(), true, '↵ grisé tant que c’est vide')
  await first.fill('Les cartes se lisent sans réseau')
  await first.press('Enter')
  await panel.getByText('Gardée, elle part avec les autres réponses : Les cartes se lisent sans réseau').waitFor()
  assert.equal(answers.length, 0, 'Rien ne part avant la dernière')
  await panel.getByRole('button', { name: 'Répondre ici' }).click()
  await panel.getByRole('textbox', { name: 'On synchronise au retour du réseau ?' }).fill('Oui, en tâche de fond')
  await panel.getByRole('textbox', { name: 'On synchronise au retour du réseau ?' }).press('Enter')
  await page.waitForFunction(() => !document.body.innerText.includes('Réponds d’abord à la question ouverte.'))
  assert.deepEqual(answers, [{ status: 'answered', answers: { cible: ['Les cartes se lisent sans réseau'], sync: ['Oui, en tâche de fond'] } }])
  await panel.getByText('Un découpage attend ta validation, ci-dessous ou dans la session.').waitFor()

  console.log(width, 'le brouillon se corrige : renommer, monter, lier, retirer, ajouter')
  assert.equal(await panel.getByText('3 cartes · corrige, puis valide').isVisible(), true)
  assert.equal(await panel.getByRole('list', { name: 'Sous-tâches proposées' }).getByText('Lire').isVisible(), true)
  assert.equal(await panel.getByRole('button', { name: 'Monter' }).first().isDisabled(), true, 'La première ne monte pas')
  assert.equal(await panel.getByRole('button', { name: 'Descendre' }).last().isDisabled(), true, 'La dernière ne descend pas')
  const titleB = panel.getByRole('textbox', { name: 'Titre de la carte B' })
  await titleB.fill('File des envois hors ligne')
  await titleB.press('Enter')
  // C monte au-dessus de B, puis attend A.
  await panel.getByRole('button', { name: 'Monter' }).nth(2).click()
  assert.equal(await panel.getByRole('textbox', { name: 'Titre de la carte B' }).inputValue(), 'Bandeau hors ligne')
  const afterA = panel.getByRole('button', { name: 'Après A : Cache des cartes' }).first()
  assert.equal(await afterA.getAttribute('aria-pressed'), 'false')
  await afterA.click()
  assert.equal(await afterA.getAttribute('aria-pressed'), 'true')
  // Une carte ajoutée vient à la fin, après la dernière.
  const add = panel.getByRole('textbox', { name: 'Ajouter une carte au brouillon' })
  await add.fill('Conflits de synchronisation')
  await add.press('Enter')
  assert.equal(await panel.getByRole('textbox', { name: 'Titre de la carte D' }).inputValue(), 'Conflits de synchronisation')
  assert.equal(await panel.getByText('4 cartes · corrige, puis valide').isVisible(), true)
  // Retirer A défait les liens qui la citaient.
  await panel.getByRole('button', { name: 'Retirer' }).first().click()
  assert.equal(await panel.getByRole('textbox', { name: 'Titre de la carte A' }).inputValue(), 'Bandeau hors ligne')
  assert.equal(await panel.getByText('part tout de suite', { exact: true }).isVisible(), true)
  await page.locator('#affinage').screenshot({ path: `/tmp/milestones-affinage-brouillon-${width}.png` })

  console.log(width, 'valider crée les cartes du brouillon corrigé, enfants du jalon')
  await validate.click()
  await state('terminée').waitFor()
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].decision, 'created')
  assert.deepEqual(decisions[0].draft.parent, DRAFT_370.parent)
  assert.deepEqual(
    decisions[0].draft.cards.map(({ key, title, after }) => ({ key, title, after })),
    [
      { key: 'c', title: 'Bandeau hors ligne', after: [] },
      { key: 'b', title: 'File des envois hors ligne', after: [] },
      { key: 'k1', title: 'Conflits de synchronisation', after: ['b'] },
    ],
  )
  await panel.getByText('Le jalon est découpé. « Ajouter au jalon » relance l’agent sur ce que tu ajoutes.').waitFor()
  await page.getByRole('region', { name: 'Vagues' }).getByRole('link', { name: /^#373 / }).waitFor()

  console.log(width, 'elle travaille : son outil en cours, résumé comme dans le fil')
  await mount(page, `/p/${PROJECT}/timeline/380`, 'page')
  await panel.getByText('docs/specs/recherche.md').waitFor()
  assert.equal(await state('travaille').isVisible(), true)
  assert.equal(await panel.getByText('· découpage direct').isVisible(), true)
  await page.locator('#affinage').screenshot({ path: `/tmp/milestones-affinage-travaille-${width}.png` })

  console.log(width, 'une question asynchrone de Codex : la session tourne, mais elle t’attend')
  await mount(page, `/p/${PROJECT}/timeline/385`, 'page')
  await panel.getByText('Par courriel ou par le navigateur ?').waitFor()
  assert.equal(await state('t’attend').isVisible(), true)

  console.log(width, 'au repos, sans rien proposer ni cartes : la suite se dit dans la session')
  await mount(page, `/p/${PROJECT}/timeline/390`, 'page')
  await panel.getByText('Elle attend ta réponse dans la session.').waitFor()
  assert.equal(await state('t’attend').isVisible(), true)

  console.log(width, 'pas encore lancée : « Découper directement » et « Affiner avec un agent »')
  await mount(page, `/p/${PROJECT}/timeline/395`, 'page')
  await state('pas encore lancée').waitFor()
  assert.equal(await panel.getByText('/affiner-un-jalon').isVisible(), true)
  await page.locator('#affinage').screenshot({ path: `/tmp/milestones-affinage-idee-${width}.png` })
  const direct = new URL(await panel.getByRole('link', { name: 'Découper directement' }).getAttribute('href'), origin)
  assert.equal(direct.searchParams.get('split'), 'card-395')
  assert.equal(direct.searchParams.get('mode'), 'direct')
  assert.equal(direct.searchParams.get('prompt'), '/affiner-un-jalon #395 --decouper\n\nPartage d’écran\n\nMontrer une session à un collègue.')
  await panel.getByRole('button', { name: 'Affiner avec un agent' }).click()
  await page.waitForFunction(() => window.where.includes('/c/new'))
  const refine = new URL(await where(), origin)
  assert.equal(refine.searchParams.get('mode'), null)
  assert.equal(refine.searchParams.get('prompt'), '/affiner-un-jalon #395\n\nPartage d’écran\n\nMontrer une session à un collègue.')

  assert.deepEqual(errors, [])
  await context.close()
}

try {
  for (let i = 0; i < 150; i++) {
    if (await fetch(origin).then((r) => r.ok).catch(() => false)) break
    if (vite.exitCode !== null) throw new Error(diagnostics)
    await delay(100)
  }
  browser = await launchBrowser()
  for (const width of [1280, 390]) await horizonStep(width)
  for (const width of [1280, 390]) await pageStep(width)
  for (const width of [1280, 390]) await refineStep(width)
  for (const width of [1280, 390]) {
    const phone = width < 700
    const context = await browser.newContext({ viewport: { width, height: 860 }, hasTouch: phone, isMobile: phone, locale: 'fr-FR', serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))

    let cards = board()
    const writes = []
    await page.route('**/__milestones_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      const method = request.method()
      if (path === `/api/projects/${PROJECT}/cards`) return route.fulfill({ json: cards })
      if (path === '/api/conversations') return route.fulfill({ json: cards.find((entry) => entry.number === 199).conversations.map((entry) => conversation(entry)) })
      if (path === `/api/projects/${PROJECT}/prompts`) return route.fulfill({ json: { prompts: [QUESTION] } })
      if (path === '/api/awaiting') return route.fulfill({ json: { requests: [] } })
      if (path === '/api/cards/card-199/notes') return route.fulfill({ json: NOTES })
      if (/^\/api\/cards\/[^/]+\/notes$/.test(path)) return route.fulfill({ json: [] })
      const subtask = /^\/api\/cards\/([^/]+)\/subtasks$/.exec(path)
      if (subtask && method === 'POST') {
        const body = request.postDataJSON()
        writes.push({ kind: 'subtask', id: subtask[1], ...body })
        const target = cards.find((entry) => entry.id === subtask[1])
        let seen = -1
        target.description = target.description.split('\n').map((line) => {
          if (!/^- \[[ x]\] /.test(line)) return line
          seen += 1
          return seen === body.index ? line.replace(/\[[ x]\]/, body.checked ? '[x]' : '[ ]') : line
        }).join('\n')
        return route.fulfill({ json: target })
      }
      const patch = /^\/api\/cards\/([^/]+)$/.exec(path)
      if (patch && method === 'PATCH') {
        const body = request.postDataJSON()
        writes.push({ kind: 'patch', id: patch[1], ...body })
        const target = cards.find((entry) => entry.id === patch[1])
        Object.assign(target, body)
        return route.fulfill({ json: target })
      }
      return route.fulfill({ status: 404, json: {} })
    })

    const sheet = (number) => page.getByRole('dialog', { name: `Carte #${number}` })
    const settle = () => page.waitForTimeout(260)
    const where = () => page.evaluate(() => window.where)

    console.log(width, 'ℹ ouvre la fiche, pas la session, et l’adresse la retient')
    await mount(page, `/p/${PROJECT}/timeline`)
    const row = page.getByRole('list', { name: 'Cartes' }).getByRole('listitem').filter({ hasText: '#199' })
    const info = row.getByRole('button', { name: 'Détail de la carte #199' })
    await info.click()
    await sheet(199).waitFor()
    await settle()
    assert.equal(await where(), `/p/${PROJECT}/timeline?fiche=199`, 'Le clic sur ℹ ne suit pas le lien de la ligne')
    assert.equal(await sheet(199).evaluate((element) => element.parentElement.id), 'drawer-layer', 'La fiche se pose dans le tiroir commun')

    console.log(width, 'en-tête : titre, #, t’attend, jalon parent, échéance en retard')
    const fiche = sheet(199)
    assert.equal(await fiche.getByRole('heading', { name: 'Fiche de carte sur place' }).isVisible(), true)
    assert.equal(await fiche.getByText('#199', { exact: true }).isVisible(), true)
    assert.equal(await fiche.getByText('t’attend').first().isVisible(), true, 'Une session attend : l’état le dit')
    const parent = fiche.getByRole('link', { name: 'Jalon #182 Page projet v2 · Jalons' })
    assert.equal(await parent.getAttribute('href'), `/p/${PROJECT}/timeline/182`)
    const due = fiche.locator('header .text-critical')
    assert.equal(await due.count(), 1, 'L’échéance dépassée est en rouge')
    await page.screenshot({ path: `/tmp/milestones-fiche-${width}.png` })

    console.log(width, 'la demande et la réponse sur place')
    const inbox = fiche.getByRole('region', { name: 'Ce qui t’attend' })
    await inbox.getByText('Fiche : composants').waitFor()
    assert.equal(await inbox.getByText('Session rangée').count(), 0, 'Une session rangée ne répond pas ici')
    await inbox.getByRole('button', { name: 'Répondre' }).first().click()
    await inbox.getByRole('paragraph').filter({ hasText: 'Je garde l’ancien composant derrière un réglage ?' }).waitFor()
    assert.equal(await inbox.getByText('Le garder').first().isVisible(), true, 'Les options de la question, pour répondre ici')

    console.log(width, 'sessions : les vivantes et au repos, archivées exclues, état en mots')
    const sessions = fiche.getByRole('region', { name: 'Sessions' })
    assert.equal(await sessions.getByRole('link').count(), 2, 'La session rangée n’y est pas')
    assert.equal(await sessions.getByRole('link').first().getAttribute('href'), `/p/${PROJECT}/c/s-wait`, 'La plus récente d’abord')
    assert.equal(await sessions.getByText('au repos').isVisible(), true)
    assert.equal(await sessions.getByText('feat/199-fiche-de-carte').isVisible(), !phone, 'La branche dès sm')

    console.log(width, 'sous-tâches : x / y, barre, case cochée par la route du board')
    const subtasks = fiche.getByRole('region', { name: 'Sous-tâches' })
    assert.equal(await subtasks.getByText('1 / 3').isVisible(), true)
    assert.equal(await subtasks.getByRole('progressbar').getAttribute('aria-valuenow'), '1')
    await subtasks.getByRole('checkbox', { name: 'Les composants' }).check()
    await subtasks.getByText('2 / 3').waitFor()
    assert.deepEqual(writes.at(-1), { kind: 'subtask', id: 'card-199', index: 1, checked: true, label: 'Les composants' })

    console.log(width, 'description sans ses cases, notes récentes « 3 sur 5 »')
    const description = fiche.getByRole('region', { name: 'Description' })
    assert.equal(await description.getByText('hors du board').isVisible(), true)
    assert.equal(await description.getByText('Le module pur').count(), 0, 'Les cases ne se répètent pas dans la description')
    const notes = fiche.getByRole('region', { name: 'Notes récentes' })
    assert.equal(await notes.getByText('3 sur 5').isVisible(), true)
    assert.equal(await notes.getByRole('listitem').count(), 3)
    assert.equal(await notes.getByRole('listitem').first().getByText('Note numéro 1.').isVisible(), true, 'La plus récente d’abord')

    console.log(width, 'pied : ouvrir la session la plus active, voir dans le tableau')
    assert.equal(await fiche.getByRole('link', { name: 'Ouvrir la session' }).getAttribute('href'), `/p/${PROJECT}/c/s-wait`)
    assert.equal(await fiche.getByRole('link', { name: 'Voir dans le tableau' }).getAttribute('href'), `/p/${PROJECT}/board?carte=199`)

    console.log(width, 'case « C’est un jalon » grisée sous une parente')
    const flag = (locator) => locator.getByRole('checkbox', { name: 'C’est un jalon' })
    assert.equal(await flag(fiche).isDisabled(), true)
    assert.equal(await flag(fiche).isChecked(), false)
    assert.equal(await fiche.getByText('Une carte rangée dans un jalon ne peut pas en être un').isVisible(), phone, 'Au doigt, la raison s’écrit sous la case')

    console.log(width, 'liens : « Bloquée par » passe à la fiche de la carte liée')
    const links = fiche.getByRole('region', { name: 'Liens' })
    await links.getByRole('button', { name: /#161/ }).click()
    await sheet(161).waitFor()
    assert.equal(await where(), `/p/${PROJECT}/timeline?fiche=161`)
    await sheet(161).getByRole('region', { name: 'Liens' }).getByRole('button', { name: /#199/ }).waitFor()
    assert.equal(await sheet(161).getByRole('link', { name: 'Lancer une session' }).getAttribute('href'), `/p/${PROJECT}/c/new?card=card-161`, 'Sans session, le pied en lance une')
    assert.equal(await sheet(161).getByText('Aucune session sur cette carte pour l’instant.').isVisible(), true)
    assert.equal(await sheet(161).getByText('Pas de description.').isVisible(), true)

    console.log(width, 'un lien partagé rouvre la fiche ; le jalon a sa case cochée d’office')
    await mount(page, `/p/${PROJECT}/timeline?vue=gantt&fiche=182`)
    await sheet(182).waitFor()
    await settle()
    assert.equal(await flag(sheet(182)).isChecked(), true)
    assert.equal(await flag(sheet(182)).isDisabled(), true)
    const inside = sheet(182).getByRole('region', { name: 'Liens' })
    assert.equal(await inside.getByText('Dedans').isVisible(), true)
    assert.equal(await inside.getByRole('button').count(), 2)

    console.log(width, 'Échap ferme et garde les autres paramètres de l’adresse')
    await page.keyboard.press('Escape')
    await sheet(182).waitFor({ state: 'detached' })
    assert.equal(await where(), `/p/${PROJECT}/timeline?vue=gantt`)

    console.log(width, 'une carte libre : la case se coche et se décoche')
    await page.getByRole('button', { name: 'Détail de la carte #240' }).click()
    const free = sheet(240)
    await free.waitFor()
    await settle()
    assert.equal(await flag(free).isDisabled(), false)
    await flag(free).check()
    await page.waitForFunction(() => document.querySelector('[role=dialog] input[type=checkbox]:checked'))
    assert.deepEqual(writes.at(-1), { kind: 'patch', id: 'card-240', milestone: true })
    await flag(free).uncheck()
    await page.waitForFunction(() => !document.querySelector('[role=dialog] input[type=checkbox]:checked'))
    assert.deepEqual(writes.at(-1), { kind: 'patch', id: 'card-240', milestone: false })
    await page.screenshot({ path: `/tmp/milestones-fiche-libre-${width}.png` })

    console.log(width, 'un numéro inconnu n’ouvre rien')
    await mount(page, `/p/${PROJECT}/timeline?fiche=999`)
    await page.getByRole('list', { name: 'Cartes' }).getByRole('listitem').first().waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)

    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('OK : horizon — trois temps et leur ordre, chaîne, axe (barre, lancement, retard, infobulle), tuiles, ℹ, recherche, filtres et puces, échelle, cap, « + Jalon », carte cochée en idée ; ordinateur et téléphone.')
  console.log('OK : page — en-tête, prochaine action et son geste (défiler, affiner, fusionner, fiche), étapes expliquées, affinage en tête quand il attend, vagues (colonnes, arêtes, cycle, chaîne, empilées au téléphone, ambre, ajoutées) ; ordinateur et téléphone.')
  console.log('OK : affinage — quatre états et le mode, outil en cours, question asynchrone de Codex, réponses gardées puis envoyées ensemble, brouillon corrigé (renommer, monter, lier, ajouter, retirer) puis validé, affinage pré-rempli (questions d’abord, découpage direct) ; ordinateur et téléphone.')
  console.log('OK : fiche — ℹ sans la session, ?fiche= partageable, en-tête, réponse sur place, sessions, sous-tâches, description, notes, pied, liens qui changent de fiche, case « C’est un jalon » (d’office, grisée, cochable) ; ordinateur et téléphone.')
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  await once(vite, 'exit')
}
