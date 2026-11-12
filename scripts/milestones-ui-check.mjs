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
// Étape « page » (#194, JAL-1..8, VAG-1..10) : l'en-tête, la prochaine action et son geste,
// les étapes expliquées (fiche par étape, téléphone), la mise en page, les vagues (colonnes,
// arêtes, cycle, chaîne au survol, empilement au téléphone, repère ambre).
//
// Étape « lancer » (#197, LCH-1..12) : le panneau Lancer avant le lancement — à la main
// (environnements filtrés, cartes, lancer une carte), en autonome (confiné d'office,
// concurrence remontée aux vagues, quota, vérifications, lancer), livré, rien à lancer.
// Les lancements ne partent que vers l'API simulée : aucune session ne s'ouvre.
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
  milestone: false, children: [], branch: null, branchPr: null, acceptedAt: now - 9 * DAY, toClarifySince: null, createdBy: 'u1',
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
  assert.equal(await page.locator('#lancer').getByText('Rien à lancer tant que le jalon n’est pas découpé en cartes.').isVisible(), true, 'Rien à lancer sans cartes')
  await band.getByRole('button', { name: 'Affiner', exact: true }).click()
  await page.waitForFunction(() => window.where.includes('/c/new'))
  assert.equal(await where(), `/p/${PROJECT}/c/new?split=card-320`)

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

const ENVIRONMENTS = {
  default: { where: 'host', confined: false },
  choices: [{ where: 'host', confined: false }, { where: 'host', confined: true }, { where: 'devcontainer', confined: false }, { where: 'devcontainer', confined: true }],
  suggested: null,
  autonomousConfined: false,
}

/** Étape « lancer » : le panneau Lancer d'un jalon pas encore lancé, à une largeur. */
async function launchStep(width) {
  const phone = width < 700
  // Haute : le panneau entier tient à l'écran, et ses captures aussi.
  const context = await browser.newContext({ viewport: { width, height: 1200 }, hasTouch: phone, isMobile: phone, locale: 'fr-FR', serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const cards = milestones()
  // Une carte du jalon prêt qui travaille déjà, et un jalon livré.
  cards.find((entry) => entry.number === 333).conversations = [cardSession('s-333', 'Sonde', 'running', DAY)]
  const done = [card(371, 'Alias', 'done'), card(372, 'Migration', 'done')]
  const delivered = card(370, 'Comptes nommés', 'done', {
    milestone: true, branch: 'jalon/370-comptes-nommes', branchPr: { number: 78, url: 'https://github.com/tipaq/solera/pull/78', mergedAt: now - DAY },
  })
  for (const kid of done) kid.parent = link(delivered)
  delivered.children = done.map(link)
  cards.push(delivered, ...done)
  const launches = []
  await page.route('**/__milestones_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === `/api/projects/${PROJECT}/cards`) return route.fulfill({ json: cards })
    if (path === `/api/projects/${PROJECT}/milestones/active`) return route.fulfill({ json: [] })
    if (path === `/api/projects/${PROJECT}/environments`) return route.fulfill({ json: ENVIRONMENTS })
    const plan = /^\/api\/cards\/card-(\d+)\/milestone\/plan$/.exec(path)
    if (plan) return route.fulfill({ json: { cardId: `card-${plan[1]}`, cards: [], cycle: [], branch: `jalon/${plan[1]}-essai` } })
    if (request.method() === 'POST' && /\/milestone(\/cards\/[^/]+\/launch)?$/.test(path)) {
      launches.push({ path, body: request.postDataJSON() })
      // Le serveur refuse : la carte n'est pas prête. Rien ne s'ouvre, l'erreur se lit.
      return route.fulfill({ status: 409, json: { error: { code: 'milestone_card_not_ready', message: 'pas prête' } } })
    }
    if (/^\/api\/cards\/[^/]+\/milestone$/.test(path)) return route.fulfill({ json: null })
    if (path === '/api/conversations') return route.fulfill({ json: [] })
    if (path === `/api/projects/${PROJECT}/prompts`) return route.fulfill({ json: { prompts: [] } })
    if (path === '/api/awaiting') return route.fulfill({ json: { requests: [] } })
    return route.fulfill({ status: 404, json: {} })
  })
  const panel = page.locator('#lancer')
  const waves = page.getByRole('region', { name: 'Vagues' })
  const mode = panel.getByRole('radiogroup', { name: 'Mode de lancement' })
  const environment = panel.getByRole('radiogroup', { name: 'Environnement' })
  const list = panel.getByRole('list', { name: 'Cartes ouvertes' })
  const row = (number) => list.getByRole('listitem').filter({ has: page.getByRole('link', { name: new RegExp(`^#${number} `) }) })
  const checks = panel.getByRole('group', { name: 'Vérifications' })
  // Au thème clair, comme le prototype : les captures s'apparient.
  const shot = async (name) => {
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await panel.scrollIntoViewIfNeeded()
    await panel.screenshot({ animations: 'disabled', path: `/tmp/milestones-lancer-${name}-${width}.png` })
  }

  console.log(width, 'prêt, à la main : le mode, l’environnement du projet seulement, ses réglages')
  await mount(page, `/p/${PROJECT}/timeline/330`, 'page')
  await mode.waitFor()
  assert.equal(await panel.getByRole('heading', { name: 'Lancer' }).isVisible(), true)
  assert.equal(await panel.getByText('à la main ou autonome, au choix').isVisible(), true)
  assert.equal(await mode.getByRole('radio', { name: /^À la main/ }).getAttribute('aria-checked'), 'true')
  await environment.waitFor()
  assert.deepEqual(
    await environment.getByRole('radio').evaluateAll((radios) => radios.map((radio) => radio.textContent)),
    ['HôteSur cette machine, comme aujourd’hui', 'Hôte confinéCette machine, confinée : son worktree seulement'],
    'L’emplacement suit le projet : pas de dev container sur un projet à l’hôte',
  )
  assert.equal(await environment.getByRole('radio', { name: /^Hôte\s?Sur/ }).getAttribute('aria-checked'), 'true', 'Le réglage du projet')
  assert.equal(await panel.getByRole('link', { name: 'Réglages' }).getAttribute('href'), `/p/${PROJECT}/settings`)

  console.log(width, 'à la main : les cartes ouvertes, « Lancer », « attend », les sessions qui vivent')
  assert.equal(await list.getByRole('listitem').count(), 4)
  assert.equal(await row(331).getByRole('button', { name: 'Lancer #331' }).isVisible(), true)
  assert.equal(await row(332).getByText('attend', { exact: true }).isVisible(), true, 'Bloquée par #331')
  assert.equal(await row(333).getByRole('button', { name: /^Lancer/ }).count(), 0, 'Sa session tourne déjà')
  assert.equal(await row(333).getByText('attend', { exact: true }).count(), 0)
  assert.equal(await row(334).getByRole('button', { name: 'Détail de la carte #334' }).isVisible(), true)
  await shot('main')

  console.log(width, 'lancer une carte à la main : la route de la carte, le confinement choisi ; le refus se lit')
  await row(331).getByRole('button', { name: 'Lancer #331' }).click()
  await panel.getByRole('alert').waitFor()
  assert.match(await panel.getByRole('alert').innerText(), /^Le lancement a échoué/)
  assert.deepEqual(launches.at(-1), { path: '/api/cards/card-330/milestone/cards/card-331/launch', body: { confined: false } })

  console.log(width, 'autonome : confiné d’office, rien à avertir')
  await mode.getByRole('radio', { name: /^Autonome/ }).click()
  assert.equal(await environment.getByRole('radio', { name: /^Hôte confiné/ }).getAttribute('aria-checked'), 'true', 'Confiné d’office')
  assert.equal(await panel.getByText(/^Non confinée/).count(), 0)
  assert.equal(await panel.getByText('Le serveur lance les cartes prêtes, chacune dans son worktree, les fait relire et les fusionne dans la branche du jalon.').isVisible(), true)
  assert.equal(await panel.getByText('jalon/330-essai').isVisible(), true, 'La branche du plan')
  assert.equal(await panel.getByText('comme une session neuve de ce projet').isVisible(), true)
  assert.equal(await list.count(), 0, 'Pas de liste de cartes en autonome')

  console.log(width, 'autonome non confiné : l’avertissement')
  await environment.getByRole('radio', { name: /^Hôte\s?Sur/ }).click()
  assert.equal(await panel.getByText('Non confinée, chaque session te demandera ses autorisations : les cartes concernées attendront ta réponse.').isVisible(), true)
  await environment.getByRole('radio', { name: /^Hôte confiné/ }).click()

  console.log(width, 'concurrence : 1 à 6, remontée aux vagues, avertissement de quota au-delà de 3')
  const concurrency = panel.getByRole('radiogroup', { name: 'Concurrence' })
  assert.equal(await concurrency.getByRole('radio').count(), 6)
  assert.equal(await concurrency.getByRole('radio', { name: '3' }).getAttribute('aria-checked'), 'true')
  assert.equal(await panel.getByText(/consomment ton quota/).count(), 0)
  await concurrency.getByRole('radio', { name: '5' }).click()
  assert.equal(await panel.getByText('5 sessions à la fois consomment ton quota 5 fois plus vite.').isVisible(), true)
  assert.equal(await waves.getByText('ce qui part ensemble, de gauche à droite · 5 à la fois').isVisible(), true, 'Les vagues suivent')
  await page.waitForTimeout(300)
  const background = (name) => concurrency.getByRole('radio', { name, exact: true }).evaluate((element) => getComputedStyle(element).backgroundColor)
  assert.equal(await background('3'), await background('1'), 'L’ancien choix redevient comme les autres')

  console.log(width, 'vérifications : prêt à partir, le bouton actif, le corps du lancement')
  assert.equal(await checks.getByText('Prêt à partir').isVisible(), true)
  assert.deepEqual(await checks.getByRole('listitem').allInnerTexts(), [
    'Rien à préciser', 'Toutes les cartes acceptées', 'Pas de cycle de blocages', 'Au moins une carte peut partir', 'Concurrence : 5 à la fois',
  ])
  assert.equal(await panel.getByText('En autonome, seuls les blocages te reviennent.').isVisible(), true)
  await shot('autonome')
  await panel.getByRole('button', { name: 'Lancer en autonome' }).click()
  for (let i = 0; i < 50 && launches.length < 2; i++) await delay(100)
  assert.deepEqual(launches.at(-1), { path: '/api/cards/card-330/milestone', body: { mode: 'auto', concurrency: 5, confined: true } })

  console.log(width, 'à régler : les échecs d’abord, le bouton désactivé')
  await mount(page, `/p/${PROJECT}/timeline/300`, 'page')
  await mode.getByRole('radio', { name: /^Autonome/ }).click()
  await checks.getByText('Avant de partir : 1 point à régler').waitFor()
  assert.equal((await checks.getByRole('listitem').allInnerTexts())[0], '1 point d’affinage en attente')
  assert.equal(await panel.getByRole('button', { name: 'Lancer en autonome' }).isDisabled(), true)
  await shot('a-regler')

  console.log(width, 'cycle : nommé, et aucune carte ne peut partir')
  await mount(page, `/p/${PROJECT}/timeline/350`, 'page')
  await mode.getByRole('radio', { name: /^Autonome/ }).click()
  await checks.getByText('Avant de partir : 2 points à régler').waitFor()
  assert.deepEqual((await checks.getByRole('listitem').allInnerTexts()).slice(0, 2), ['Cycle : #351, #352', 'Aucune carte ne peut partir'])

  console.log(width, 'livré : le cadre vert')
  await mount(page, `/p/${PROJECT}/timeline/370`, 'page')
  await panel.getByRole('heading', { name: 'Livré' }).waitFor()
  assert.equal(await panel.getByText('2 cartes fusionnées. PR du jalon fusionnée.').isVisible(), true)
  await shot('livre')

  assert.equal(launches.length, 2, 'Deux lancements tentés, aucun autre')
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
  for (const width of [1280, 390]) await pageStep(width)
  for (const width of [1280, 390]) await launchStep(width)
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
  console.log('OK : page — en-tête, prochaine action et son geste (défiler, affiner, fusionner, fiche), étapes expliquées, affinage en tête quand il attend, vagues (colonnes, arêtes, cycle, chaîne, empilées au téléphone, ambre, ajoutées) ; ordinateur et téléphone.')
  console.log('OK : lancer — à la main (environnements du projet, cartes, lancer une carte, refus lu), autonome (confiné d’office, avertissement, concurrence jusqu’aux vagues, quota, branche, CLI, vérifications échecs d’abord, lancer), livré, rien à lancer ; ordinateur et téléphone.')
  console.log('OK : fiche — ℹ sans la session, ?fiche= partageable, en-tête, réponse sur place, sessions, sous-tâches, description, notes, pied, liens qui changent de fiche, case « C’est un jalon » (d’office, grisée, cochable) ; ordinateur et téléphone.')
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  await once(vite, 'exit')
}
