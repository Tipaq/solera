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
// Étape « composer » (#193, CMP-1..16, BAR-7) : le tiroir « Nouveau jalon » de la page —
// titre tiré du texte, gestes et leurs désactivations, pied (étape d'arrivée, phrase de
// l'agent, repéré, aperçu au survol), brouillon gardé à la fermeture, échéance, Réf. et
// Inclure, lien et fichier ; la création réelle (carte drapeautée et datée, relation,
// enfant, pièce jointe), `Ctrl+Entrée` vers le brouillon d'affinage pré-rempli, l'idée
// notée, et une pièce qui ne suit pas. Aucune session ne part : l'API est simulée.
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
// Étape « lancer » (#197, LCH-1..12) : le panneau Lancer avant le lancement — à la main
// (environnements filtrés, cartes, lancer une carte), en autonome (confiné d'office,
// concurrence remontée aux vagues, quota, vérifications, lancer), livré, rien à lancer.
// Les lancements ne partent que vers l'API simulée : aucune session ne s'ouvre.
// Puis le suivi d'un jalon lancé (#198, RUN-1..12) : titre et durée, bascule de mode,
// places, branche, confinement, statut de chaque carte (ce qui t'attend en ambre, sa raison
// en infobulle), « Lancer » à la main, ajout de carte, pause, reprise, arrêt confirmé ; la
// PR finale ouverte (« Fusionner dans main », « Ouvrir la PR », l'erreur de forge lue) ou
// fermée sans fusion. Aucune vraie PR n'est fusionnée.
//
// Étape « à régler et ajout » (#196, RGL-1..6, ADD-1..4, AFF-7, JAL-3) : préciser une
// carte (à sa session, sinon dans sa description), l'accepter, rompre un cycle ; le
// tiroir « Ajouter au jalon » (à la session d'affinage, sinon un brouillon pré-rempli) ;
// l'ajout proposé, en sous-tâches ou en cartes, accepté ou laissé.
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
    branch: 'jalon/340-comptes-nommes', branchPr: { number: 77, url: 'https://github.com/tipaq/solera/pull/77', base: 'main', mergedAt: null, closedAt: null },
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
  await dialog.getByRole('textbox', { name: 'Le jalon, en une phrase ou en brief' }).fill('Tableau de bord des coûts')
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

const COMPOSER_BRIEF = `# Mode hors-ligne complet

## Objectif
Pouvoir relire et répondre aux sessions sans réseau.
## Étapes
- Cache local des fils, voir #931
- File d'envoi des réponses, avec #960
- Resynchronisation au retour du réseau
## Hors champ
- Lancer une session hors ligne`

async function composerStep(width) {
  const phone = width < 700
  const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: phone, isMobile: phone, locale: 'fr-FR', serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  let cards = horizonBoard()
  let next = 970
  const writes = []
  /** Les chemins qui échouent une fois, pour la pièce qui ne suit pas. */
  const failing = new Set()
  /** Une création lente, pour fermer pendant l'envoi. */
  let slow = false
  await page.route('**/__milestones_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (failing.delete(`${method} ${path}`)) return route.fulfill({ status: 409, json: { error: { code: 'refused', message: 'Lien refusé' } } })
    if (path === '/api/projects') return route.fulfill({ json: [projectOf(null)] })
    if (path === `/api/projects/${PROJECT}/cards` && method === 'POST') {
      const body = request.postDataJSON()
      writes.push({ kind: 'create', ...body })
      if (slow) await delay(800)
      const created = card(next++, body.title, 'todo', { description: body.description, dueAt: body.dueAt, milestone: body.milestone, position: 970, createdAt: Date.now() })
      cards = [...cards, created]
      return route.fulfill({ json: created })
    }
    if (path === `/api/projects/${PROJECT}/cards`) return route.fulfill({ json: cards })
    if (path === `/api/projects/${PROJECT}/milestones/active`) return route.fulfill({ json: [RUN] })
    if (path === `/api/projects/${PROJECT}/prompts`) return route.fulfill({ json: { prompts: [] } })
    if (path === '/api/conversations') return route.fulfill({ json: [] })
    if (path === '/api/awaiting') return route.fulfill({ json: { requests: [] } })
    if (path === '/api/auth/me') return route.fulfill({ json: { id: 'u1', name: 'Tim', email: 'tim@example.com' } })
    const relation = /^\/api\/cards\/([^/]+)\/relations$/.exec(path)
    if (relation && method === 'POST') {
      const body = request.postDataJSON()
      writes.push({ kind: 'relation', id: relation[1], relation: body.kind, targetId: body.targetId })
      return route.fulfill({ json: cards.find((entry) => entry.id === relation[1]) })
    }
    const attachment = /^\/api\/cards\/([^/]+)\/attachments$/.exec(path)
    if (attachment && method === 'POST') {
      const name = /filename="([^"]+)"/.exec(request.postDataBuffer()?.toString('latin1') ?? '')?.[1]
      writes.push({ kind: 'attachment', id: attachment[1], name })
      return route.fulfill({ json: { id: 'att-1', name, size: 1, mimeType: 'application/pdf', createdAt: Date.now() } })
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

  const where = () => page.evaluate(() => window.where)
  const drawer = page.getByRole('dialog', { name: 'Nouveau jalon' })
  const field = drawer.getByRole('textbox', { name: 'Le jalon, en une phrase ou en brief' })
  const title = drawer.getByRole('textbox', { name: 'Titre du jalon' })
  const footer = drawer.locator('footer')
  const gesture = (name) => footer.getByRole('button', { name, exact: true })
  const shot = (locator, name) => locator.screenshot({ animations: 'disabled', path: `/tmp/milestones-composer-${name}-${width}.png` })
  const open = async () => {
    await page.getByRole('button', { name: 'Jalon', exact: true }).click()
    await field.waitFor()
  }

  console.log(width, 'CMP-1, CMP-2 : le tiroir large, son en-tête, vide')
  await mountHorizon(page, `/p/${PROJECT}/timeline`)
  await open()
  assert.equal(await field.evaluate((element) => element === document.activeElement), true, 'le champ prend le focus')
  assert.equal(await title.getAttribute('placeholder'), 'Sans titre')
  assert.equal(await drawer.getByText('Une phrase suffit, ou colle ton brief : l’agent s’adapte.').isVisible(), true)
  if (!phone) assert.ok((await drawer.boundingBox()).width > 700, 'tiroir large')

  console.log(width, 'CMP-8 : texte vide, les trois gestes retenus, et pourquoi')
  for (const name of ['Noter l’idée', 'Affiner avec un agent', 'Découper directement']) assert.equal(await gesture(name).isDisabled(), true, name)
  assert.equal(await footer.getByText('Écris une phrase, ou colle ton brief.').isVisible(), true, 'CMP-10 : vide')
  assert.equal(await footer.getByText('À affiner', { exact: true }).isVisible(), true, 'CMP-6 : entre en À affiner')
  if (!phone) {
    await gesture('Noter l’idée').locator('xpath=..').hover()
    await page.getByRole('tooltip').filter({ hasText: 'Écris d’abord le jalon.' }).first().waitFor()
    await page.mouse.move(0, 0, { steps: 4 })
  }
  await shot(drawer, 'vide')

  console.log(width, 'CMP-2, CMP-7 : une phrase — titre tiré du texte, Affiner en geste principal')
  await field.fill('Un mode hors-ligne pour relire les sessions dans le train')
  assert.equal(await title.getAttribute('placeholder'), 'Un mode hors-ligne pour relire les sessions dans le train')
  assert.equal(await drawer.getByText('Titre tiré de ton texte, modifiable.').isVisible(), true)
  assert.equal(await gesture('Affiner avec un agent').isEnabled(), true)
  assert.equal(await gesture('Noter l’idée').isEnabled(), true)
  assert.equal(await gesture('Découper directement').isDisabled(), true, 'une phrase ne suffit pas à découper')
  assert.equal(await footer.getByText('l’agent lira le projet, puis te posera d’abord quelques questions.').isVisible(), true, 'CMP-10 : phrase')
  if (!phone) {
    assert.equal(await gesture('Affiner avec un agent').getByText('Ctrl').isVisible(), true, 'le raccourci sur le geste principal')
    await gesture('Découper directement').locator('xpath=..').hover()
    await page.getByRole('tooltip').filter({ hasText: 'Il faut au moins deux étapes, ou un objectif et un peu de matière.' }).first().waitFor()
    await page.mouse.move(0, 0, { steps: 4 })
  }

  console.log(width, 'CMP-9 : survoler ou focaliser un geste montre son étape et sa phrase')
  await gesture('Noter l’idée').focus()
  await footer.getByText('Idée', { exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('[role=tooltip]'))
  assert.equal(await footer.getByText('Aucune session ne part : tu l’affineras plus tard.').isVisible(), true)
  await shot(footer, 'apercu-noter')
  await gesture('Affiner avec un agent').focus()
  await footer.getByText('À affiner', { exact: true }).waitFor()

  console.log(width, 'CMP-16 : fermé sans envoi, le brouillon reste')
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'detached' })
  await open()
  assert.equal(await field.inputValue(), 'Un mode hors-ligne pour relire les sessions dans le train')

  console.log(width, 'CMP-7, CMP-10 : un brief qui suffit — Découper en geste principal, repéré')
  await field.fill(COMPOSER_BRIEF)
  assert.equal(await title.getAttribute('placeholder'), 'Mode hors-ligne complet')
  assert.equal(await gesture('Découper directement').isEnabled(), true)
  if (!phone) assert.equal(await gesture('Découper directement').getByText('Ctrl').isVisible(), true)
  assert.equal(await footer.getByText('l’agent proposera directement un découpage.').isVisible(), true)
  const spotted = footer.getByText('Repéré').locator('xpath=..')
  assert.match(await spotted.textContent(), /objectif.*3 étapes.*1 hors champ.*2 cartes/)

  console.log(width, 'CMP-5 : l’échéance')
  await drawer.getByLabel('Échéance', { exact: true }).fill('2026-12-12')
  await drawer.getByText('12 déc. 2026').waitFor()

  console.log(width, 'CMP-12 : Réf. par défaut, Inclure fait de la carte une carte du jalon')
  const joined = drawer.getByRole('region', { name: 'Pièces jointes' })
  const include960 = joined.getByRole('radiogroup', { name: /#960/ })
  assert.equal(await joined.getByRole('radiogroup', { name: /#931/ }).getByRole('radio', { name: 'Réf.' }).getAttribute('aria-checked'), 'true')
  await include960.getByRole('radio', { name: 'Inclure' }).click()
  assert.equal(await include960.getByRole('radio', { name: 'Inclure' }).getAttribute('aria-checked'), 'true')

  console.log(width, 'CMP-4 : un lien et un fichier')
  await drawer.getByRole('button', { name: 'Joindre un lien' }).click()
  const linkInput = drawer.getByRole('textbox', { name: 'Adresse du lien' })
  await linkInput.fill('https://github.com/Tipaq/solera/pull/212')
  await linkInput.press('Enter')
  await joined.getByText('PR #212').waitFor()
  await drawer.locator('input[type=file]').setInputFiles([{ name: 'maquette.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2048) }])
  await joined.getByText('maquette.pdf').waitFor()
  await shot(drawer, 'brief')
  await shot(joined, 'joint')

  console.log(width, 'CMP-11, CMP-14, CMP-15 : Ctrl+Entrée découpe — carte drapeautée et datée, relation, enfant, fichier, brouillon pré-rempli')
  await field.focus()
  await page.keyboard.press('Control+Enter')
  await page.getByText('ailleurs').waitFor()
  const created = writes.find((entry) => entry.kind === 'create')
  assert.equal(created.title, 'Mode hors-ligne complet')
  assert.equal(created.milestone, true)
  assert.equal(created.dueAt, new Date(2026, 11, 12).getTime(), 'minuit local du jour')
  assert.ok(!created.description.startsWith('# '), 'le titre quitte la description')
  assert.match(created.description, /^## Objectif/)
  assert.match(created.description, /\*\*Liens\*\*\n- https:\/\/github\.com\/Tipaq\/solera\/pull\/212$/)
  assert.deepEqual(writes.filter((entry) => entry.kind !== 'create'), [
    { kind: 'relation', id: 'card-970', relation: 'related', targetId: 'card-931' },
    { kind: 'patch', id: 'card-960', parentId: 'card-970' },
    { kind: 'attachment', id: 'card-970', name: 'maquette.pdf' },
  ])
  const draft = new URL(await where(), origin)
  assert.equal(draft.pathname, `/p/${PROJECT}/c/new`)
  assert.equal(draft.searchParams.get('split'), 'card-970')
  assert.equal(draft.searchParams.get('mode'), 'direct')
  const prompt = draft.searchParams.get('prompt')
  assert.ok(prompt.startsWith('/affiner-un-jalon #970 --decouper\n\n# Mode hors-ligne complet'), prompt)
  assert.match(prompt, /Cartes jointes : #931 \(référence\), #960 \(à inclure dans le jalon\)/)
  assert.match(prompt, /Liens :\n- https:\/\/github\.com\/Tipaq\/solera\/pull\/212$/)

  console.log(width, 'CMP-13, CMP-16 : envoyé, le brouillon part ; pas de fermeture pendant l’envoi ; Noter l’idée reste sur l’horizon et le dit')
  writes.length = 0
  await mountHorizon(page, `/p/${PROJECT}/timeline`)
  await open()
  assert.equal(await field.inputValue(), '', 'le brouillon envoyé ne revient pas')
  assert.equal(await joined.count(), 0)
  await field.fill('Tableau de bord des coûts')
  await title.fill('Coûts par projet')
  slow = true
  await gesture('Noter l’idée').click()
  await page.waitForFunction(() => [...document.querySelectorAll('footer button')].some((button) => button.textContent === 'Noter l’idée' && button.disabled))
  await page.keyboard.press('Escape')
  await delay(200)
  assert.equal(await drawer.isVisible(), true, 'on ne ferme pas pendant l’envoi : la suite se perdrait')
  await drawer.waitFor({ state: 'detached' })
  slow = false
  const noted = page.getByRole('status').filter({ hasText: 'Idée notée : #971, dans « Plus tard ». Tu l’affineras quand tu voudras.' })
  await noted.waitFor()
  assert.deepEqual(writes, [{ kind: 'create', title: 'Coûts par projet', description: 'Tableau de bord des coûts', dueAt: null, milestone: true }])
  assert.match(await where(), /\/timeline/, 'on reste sur l’horizon')
  await page.getByRole('region', { name: 'Plus tard', exact: true }).getByText('Coûts par projet').waitFor()
  await shot(noted, 'notee')
  await noted.getByRole('button', { name: 'Fermer' }).click()
  await noted.waitFor({ state: 'detached' })

  console.log(width, 'CMP-15 : une pièce qui ne suit pas — la carte existe, le message le dit et mène à la session')
  failing.add('POST /api/cards/card-972/relations')
  await open()
  await field.fill('Relire le module de paiement, voir #931')
  await gesture('Affiner avec un agent').click()
  await drawer.waitFor({ state: 'detached' })
  const partial = page.getByRole('status').filter({ hasText: '#972 est créé, mais une pièce n’a pas suivi : Lien refusé' })
  await partial.waitFor()
  await shot(partial, 'partielle')
  await partial.getByRole('link', { name: 'Ouvrir la session d’affinage' }).click()
  await page.getByText('ailleurs').waitFor()
  const session = new URL(await where(), origin)
  assert.equal(session.searchParams.get('split'), 'card-972')
  assert.equal(session.searchParams.get('mode'), null, 'Affiner : questions d’abord')
  assert.ok(session.searchParams.get('prompt').startsWith('/affiner-un-jalon #972\n\nRelire le module de paiement'))

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
  const settle = page.locator('#affinage').getByRole('region', { name: 'À régler avant de partir' })
  assert.equal(await settle.getByText('1 point en attente').isVisible(), true)
  assert.equal(await settle.getByText('#303 Infobulle flottante', { exact: true }).isVisible(), true)

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
    milestone: true, branch: 'jalon/370-comptes-nommes', branchPr: { number: 78, url: 'https://github.com/tipaq/solera/pull/78', base: 'main', mergedAt: now - DAY, closedAt: null },
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
  const target = await concurrency.getByRole('radio', { name: '1', exact: true }).boundingBox()
  assert.equal(Math.round(target.height), phone ? 44 : 28, 'Au doigt, 44 px')
  if (phone) assert.equal(Math.round(target.width), 44)
  const label = await panel.getByText('Concurrence', { exact: true }).boundingBox()
  assert.equal(target.y > label.y + label.height, phone, phone ? 'Au doigt, dessous le libellé' : 'À la souris, à côté du libellé')
  const [six, box] = [await concurrency.getByRole('radio', { name: '6', exact: true }).boundingBox(), await panel.boundingBox()]
  assert.ok(six.x + six.width <= box.x + box.width, 'Les six tiennent dans le panneau')
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

/* ------------------------------------------------------------------ étape « à régler et ajout » */

/** Les jalons de l'étape : ce qui reste à régler, et ce qu'un ajout devient. */
function settleBoard() {
  const all = []
  const parent = (number, title, kids, extra = {}) => {
    const milestone = card(number, title, 'todo', { milestone: true, ...extra })
    for (const kid of kids) kid.parent = link(milestone)
    milestone.children = kids.map(link)
    all.push(milestone, ...kids)
    return milestone
  }
  // À régler : à préciser avec ou sans session, pas acceptée, un cycle.
  const asked = card(401, 'Cache des fils', 'todo', { toClarifySince: now - DAY, conversations: [cardSession('c-401', 'Cache', 'idle', DAY)] })
  const bare = card(402, 'File d’envoi', 'todo', { toClarifySince: now - 2 * DAY, description: 'Envoyer plus tard.' })
  const outside = card(403, 'Issue importée', 'todo', { acceptedAt: null })
  const loopA = card(404, 'Synchro', 'todo')
  const loopB = card(405, 'Conflits', 'todo')
  loopA.blockedBy.push(link(loopB)); loopB.blocks.push(link(loopA))
  loopB.blockedBy.push(link(loopA)); loopA.blocks.push(link(loopB))
  parent(400, 'Hors ligne', [asked, bare, outside, loopA, loopB])
  // Un ajout rangé en sous-tâches, l'une déjà dans la carte.
  parent(410, 'Pièces jointes', [card(411, 'Téléversement', 'todo', { description: '## Sous-tâches\n- [ ] Lire hors ligne' }), card(412, 'Aperçu', 'todo')], {
    refinement: { conversationId: 'split-410', title: 'Affiner', status: 'idle', mode: 'questions', createdAt: now - DAY, draft: null, change: { requestId: 'c1', count: 1 } },
  })
  // Un ajout en nouvelles cartes.
  parent(420, 'Export', [card(421, 'Format CSV', 'todo')], {
    refinement: { conversationId: 'split-420', title: 'Affiner', status: 'idle', mode: 'questions', createdAt: now - DAY, draft: { requestId: 'd2', count: 2 }, change: null },
  })
  // Découpé, sans session d'affinage.
  parent(430, 'Notes', [card(431, 'Éditeur', 'todo')])
  // Livré : plus rien à ajouter.
  parent(440, 'Thèmes', [card(441, 'Sombre', 'done')], { column: 'done' })
  return all
}

async function settleStep(width) {
  const phone = width < 700
  const context = await browser.newContext({ viewport: { width, height: 860 }, hasTouch: phone, isMobile: phone, locale: 'fr-FR', serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let cards = settleBoard()
  let change410 = {
    requestId: 'c1', conversationId: 'split-410',
    changes: [{ cardId: 'card-411', number: 411, title: 'Téléversement', fromColumn: 'todo', reason: 'Elle téléverse déjà.', addSubtasks: ['Lire hors ligne', 'Reprendre un envoi coupé'] }],
  }
  let draft420 = {
    requestId: 'd2', conversationId: 'split-420',
    draft: {
      parent: { kind: 'existing', card: { cardId: 'card-420', number: 420, title: 'Export' } },
      cards: [
        { key: 'a', title: 'Format JSON', description: '', subtasks: [], after: [], blockedBy: [{ cardId: 'card-421', number: 421, title: 'Format CSV' }], related: [] },
        { key: 'b', title: 'Export planifié', description: '', subtasks: [], after: [], blockedBy: [], related: [] },
      ],
    },
  }
  const writes = []
  const patchCard = (id, patch) => { cards = cards.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) }
  await page.route('**/__milestones_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    if (path === `/api/projects/${PROJECT}/cards`) return route.fulfill({ json: cards })
    if (path === `/api/projects/${PROJECT}/milestones/active`) return route.fulfill({ json: [] })
    if (/^\/api\/cards\/[^/]+\/milestone$/.test(path)) return route.fulfill({ json: null })
    if (path === '/api/conversations') {
      return route.fulfill({ json: ['split-410', 'split-420'].map((id) => conversation({ id, title: id, status: 'idle', archivedAt: null, createdAt: now - DAY }, { card: null })) })
    }
    if (path === `/api/projects/${PROJECT}/prompts`) return route.fulfill({ json: { prompts: [] } })
    if (path === '/api/awaiting') return route.fulfill({ json: { requests: [] } })
    if (path === '/api/auth/me') return route.fulfill({ json: { id: 'u1', username: 'tim', displayName: 'Tim', isAdmin: true } })
    const detail = /^\/api\/cards\/card-(\d+)\/refinement$/.exec(path)
    if (detail) {
      const milestone = cards.find((entry) => entry.number === Number(detail[1]))
      return route.fulfill({ json: { session: milestone.refinement, activity: null, prompt: null, draft: milestone.number === 420 ? draft420 : null, change: milestone.number === 410 ? change410 : null } })
    }
    if (method === 'POST' && /^\/api\/conversations\/[^/]+\/messages$/.test(path)) {
      writes.push({ kind: 'message', path, text: request.postDataJSON().text })
      return route.fulfill({ json: {} })
    }
    if (method === 'PATCH' && path === '/api/cards/card-402') {
      const body = request.postDataJSON()
      writes.push({ kind: 'patch', ...body })
      patchCard('card-402', { description: body.description, toClarifySince: body.toClarify === false ? null : now })
      return route.fulfill({ json: {} })
    }
    if (method === 'POST' && path === '/api/cards/card-403/accept') {
      writes.push({ kind: 'accept' })
      patchCard('card-403', { acceptedAt: now })
      return route.fulfill({ json: {} })
    }
    if (method === 'DELETE' && path === '/api/cards/card-404/blocks/card-405') {
      writes.push({ kind: 'unblock' })
      patchCard('card-404', { blocks: [] })
      patchCard('card-405', { blockedBy: [] })
      return route.fulfill({ json: {} })
    }
    if (method === 'POST' && path === '/api/conversations/split-410/card-filings/c1') {
      writes.push({ kind: 'filing', ...request.postDataJSON() })
      change410 = null
      patchCard('card-410', { refinement: { ...cards.find((entry) => entry.id === 'card-410').refinement, change: null } })
      return route.fulfill({ json: {} })
    }
    if (method === 'POST' && path === '/api/conversations/split-420/card-drafts/d2') {
      writes.push({ kind: 'draft', ...request.postDataJSON() })
      draft420 = null
      patchCard('card-420', { refinement: { ...cards.find((entry) => entry.id === 'card-420').refinement, draft: null } })
      return route.fulfill({ json: {} })
    }
    return route.fulfill({ status: 404, json: {} })
  })
  const where = () => page.evaluate(() => window.where)
  const settle = page.getByRole('region', { name: 'À régler avant de partir' })
  const panel = page.getByRole('region', { name: 'Session d’affinage' })
  const drawer = page.getByRole('dialog', { name: 'Ajouter au jalon' })

  console.log(width, 'à régler : une liste, ses points comptés, sans recopier de demande')
  await mount(page, `/p/${PROJECT}/timeline/400`, 'page')
  await settle.getByText('4 points en attente').waitFor()
  assert.equal(await settle.getByText('#401 Cache des fils', { exact: true }).isVisible(), true)
  assert.equal(await settle.getByText(/^à préciser depuis /).first().isVisible(), true)
  assert.equal(await settle.getByText('pas encore acceptée').isVisible(), true)
  assert.equal(await settle.getByText('Cycle de blocages : aucune de ces cartes ne peut partir.').isVisible(), true)
  assert.equal(await settle.getByText('#405 bloque #404').isVisible(), true)
  await settle.screenshot({ path: `/tmp/milestones-regler-${width}.png` })

  console.log(width, 'préciser une carte qui a sa session : la précision lui part')
  const askField = settle.getByRole('textbox', { name: 'La précision attendue · #401 Cache des fils' })
  assert.equal(await settle.getByRole('button', { name: 'Préciser' }).first().isDisabled(), true, 'Grisé tant que c’est vide')
  await askField.fill('Les sept derniers jours')
  await askField.press('Enter')
  await settle.getByText('Envoyée à la session : « Les sept derniers jours »').waitFor()
  assert.deepEqual(writes.at(-1), { kind: 'message', path: '/api/conversations/c-401/messages', text: 'Les sept derniers jours' })

  console.log(width, 'sans session : dans sa description, datée et signée, et l’état levé')
  await settle.getByRole('textbox', { name: 'La précision attendue · #402 File d’envoi' }).fill('Au retour du réseau')
  await settle.getByRole('button', { name: 'Préciser' }).last().click()
  await settle.getByText('#402 File d’envoi', { exact: true }).waitFor({ state: 'detached' })
  const patch = writes.at(-1)
  assert.equal(patch.toClarify, false)
  assert.match(patch.description, /^Envoyer plus tard\.\n\n## Précisions\n\n\*\*\d{4}-\d{2}-\d{2} · Tim\*\*\n\nAu retour du réseau$/)

  console.log(width, 'accepter une carte, rompre le cycle : la liste se vide puis disparaît')
  await settle.getByRole('button', { name: 'Accepter' }).click()
  await settle.getByText('#403 Issue importée').waitFor({ state: 'detached' })
  await settle.getByText('#404 bloque #405').waitFor()
  await settle.getByRole('button', { name: 'retirer ce lien' }).last().click()
  await settle.getByText('Cycle de blocages', { exact: false }).waitFor({ state: 'detached' })
  assert.deepEqual(writes.slice(-2).map((write) => write.kind), ['accept', 'unblock'])
  assert.equal(await settle.getByText('1 point en attente').isVisible(), true, 'Reste #401, que sa session lèvera')

  console.log(width, 'l’ajout proposé en sous-tâches : « Ranger dans #N », celle qu’elle a déjà')
  await mount(page, `/p/${PROJECT}/timeline/410`, 'page')
  await panel.getByText('Ranger dans #411, en sous-tâches').waitFor()
  assert.equal(await panel.getByText('déjà dans la carte').isVisible(), true)
  assert.equal(await panel.getByText('Un ajout au jalon attend ta décision dans la session.').count(), 0, 'Il se décide ici')
  assert.equal(await settle.count(), 0, 'Rien à régler : pas de liste')
  await page.locator('#affinage').screenshot({ path: `/tmp/milestones-ajout-soustache-${width}.png` })
  await panel.getByRole('button', { name: 'Ajouter la sous-tâche' }).click()
  await panel.getByText('Ranger dans #411, en sous-tâches').waitFor({ state: 'detached' })
  assert.deepEqual(writes.at(-1), { kind: 'filing', decision: 'accepted' })

  console.log(width, '« Ajouter au jalon » : le tiroir, et l’ajout part à la session d’affinage')
  await page.getByRole('button', { name: 'Ajouter au jalon' }).click()
  await drawer.waitFor()
  assert.equal(await drawer.getByRole('heading', { name: '#410 Pièces jointes' }).isVisible(), true)
  const propose = drawer.getByRole('button', { name: 'Proposer à l’agent' })
  assert.equal(await propose.isDisabled(), true)
  assert.equal(await drawer.getByText('Écris une phrase, ou colle ton brief.').isVisible(), true)
  const field = drawer.getByRole('textbox', { name: 'Ce que tu ajoutes au jalon' })
  await field.fill('Reprendre un envoi coupé (#412)')
  await drawer.getByText('L’agent le range dans une carte existante, ou propose de nouvelles cartes.').waitFor()
  await drawer.screenshot({ path: `/tmp/milestones-ajouter-${width}.png` })
  await field.press('Control+Enter')
  await drawer.waitFor({ state: 'detached' })
  assert.deepEqual(writes.at(-1), { kind: 'message', path: '/api/conversations/split-410/messages', text: 'Ajout au jalon : Reprendre un envoi coupé (#412)' })

  console.log(width, 'l’ajout proposé en cartes : la liste, après quoi chacune part ; le laisser')
  await mount(page, `/p/${PROJECT}/timeline/420`, 'page')
  await panel.getByText('2 nouvelles cartes dans le jalon').waitFor()
  assert.equal(await panel.getByText('après #421').isVisible(), true)
  assert.equal(await panel.getByText('peut partir tout de suite').isVisible(), true)
  assert.equal(await panel.getByText('Découpage proposé').count(), 0, 'Pas de second découpage à valider')
  await page.locator('#affinage').screenshot({ path: `/tmp/milestones-ajout-cartes-${width}.png` })
  await panel.getByRole('button', { name: 'Laisser tel quel' }).click()
  await panel.getByText('2 nouvelles cartes dans le jalon').waitFor({ state: 'detached' })
  assert.deepEqual(writes.at(-1), { kind: 'draft', decision: 'refused' })

  console.log(width, 'sans session d’affinage : l’ajout ouvre un brouillon de découpage pré-rempli')
  await mount(page, `/p/${PROJECT}/timeline/430`, 'page')
  await page.getByRole('button', { name: 'Ajouter au jalon' }).click()
  await drawer.getByRole('textbox', { name: 'Ce que tu ajoutes au jalon' }).fill('Un export Markdown')
  await drawer.getByRole('button', { name: 'Proposer à l’agent' }).click()
  await page.waitForFunction(() => window.where.includes('/c/new'))
  const opened = new URL(await where(), origin)
  assert.equal(opened.searchParams.get('split'), 'card-430')
  assert.equal(opened.searchParams.get('prompt'), '/affiner-un-jalon #430\n\nAjout au jalon : Un export Markdown')

  console.log(width, 'livré : plus de « Ajouter au jalon »')
  await mount(page, `/p/${PROJECT}/timeline/440`, 'page')
  await page.getByRole('heading', { name: '#440 Thèmes' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Ajouter au jalon' }).count(), 0)

  assert.deepEqual(errors, [])
  await context.close()
}

/** Le suivi d'un jalon lancé (#198, RUN-1..12) et sa PR finale, à une largeur. */
async function runStep(width) {
  const phone = width < 700
  const context = await browser.newContext({ viewport: { width, height: 1400 }, hasTouch: phone, isMobile: phone, locale: 'fr-FR', serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  // Un jalon en route : chaque statut du pilotage, une session qui t'attend, une en file.
  const kids = [
    card(401, 'Adresse de secours', 'done'),
    card(402, 'Sonde réseau', 'in_progress', { conversations: [cardSession('s-402', 'Sonde', 'running', DAY)] }),
    card(403, 'Doc mobile', 'review', { conversations: [cardSession('s-403', 'Doc', 'idle', DAY)] }),
    card(404, 'Journal des coupures', 'in_progress', { conversations: [cardSession('s-404', 'Journal', 'awaiting_input', DAY)] }),
    card(405, 'Reprise après coupure', 'todo'),
    card(406, 'Alerte longue', 'todo'),
  ]
  kids[5].blockedBy = [link(kids[3])]
  const parent = card(400, 'Accès distant fiable', 'in_progress', { milestone: true, branch: 'jalon/400-acces-distant-fiable' })
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  // La PR finale : ouverte (410), fermée sans fusion (420).
  const prCard = (number, closedAt) => {
    const done = [card(number + 1, 'Alias', 'done')]
    const milestone = card(number, 'Comptes nommés', 'done', {
      milestone: true, branch: `jalon/${number}-comptes-nommes`,
      branchPr: { number: 77, url: 'https://github.com/tipaq/solera/pull/77', base: 'main', mergedAt: null, closedAt },
    })
    done[0].parent = link(milestone)
    milestone.children = done.map(link)
    return [milestone, ...done]
  }
  const cards = [parent, ...kids, ...prCard(410, null), ...prCard(420, now - DAY)]
  const pilot = (kid, status, extra = {}) => ({
    cardId: kid.id, number: kid.number, title: kid.title, layer: 0, status, blockReason: null, blockedBy: [], conversationId: null,
    conversationTitle: null, conversationStatus: null, worktreeName: null, agent: null, model: null, error: null, ...extra,
  })
  const run = {
    id: 'run-400', cardId: 'card-400', cardNumber: 400, cardTitle: parent.title, state: 'running', mode: 'auto', concurrency: 3,
    confined: null, agent: 'claude', model: 'claude-opus-5-5', branch: 'jalon/400-acces-distant-fiable', busy: 2,
    cards: [
      pilot(kids[0], 'done'), pilot(kids[1], 'working'), pilot(kids[2], 'reviewing'),
      pilot(kids[3], 'blocked', { blockReason: 'escalated' }), pilot(kids[4], 'queued'), pilot(kids[5], 'waiting'),
    ],
    createdAt: now - 2 * 3_600_000 - 5 * 60_000, endedAt: null,
  }
  const writes = []
  await page.route('**/__milestones_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (path === `/api/projects/${PROJECT}/cards` && method === 'POST') {
      const body = request.postDataJSON()
      writes.push({ kind: 'card', ...body })
      const added = card(407, body.title, 'todo', { parent: link(parent), createdAt: Date.now() })
      cards.push(added)
      parent.children = [...parent.children, link(added)]
      return route.fulfill({ json: added })
    }
    if (path === `/api/projects/${PROJECT}/cards`) return route.fulfill({ json: cards })
    if (path === `/api/projects/${PROJECT}/milestones/active`) return route.fulfill({ json: run.state === 'stopped' ? [] : [run] })
    if (path === `/api/projects/${PROJECT}/environments`) return route.fulfill({ json: ENVIRONMENTS })
    if (path === '/api/cards/card-400/milestone' && method === 'PATCH') {
      const body = request.postDataJSON()
      writes.push({ kind: 'run', ...body })
      if (body.confined === true && phone) {
        // Au téléphone, le serveur refuse : l'erreur se lit dans le suivi.
        return route.fulfill({ status: 409, json: { error: { code: 'environment_unavailable', message: 'Confinement indisponible' } } })
      }
      Object.assign(run, body)
      return route.fulfill({ json: run })
    }
    if (path === '/api/cards/card-400/milestone/cards/card-405/launch') {
      writes.push({ kind: 'launch', body: request.postDataJSON() })
      return route.fulfill({ json: run })
    }
    if (path === '/api/cards/card-410/branch-pr/merge') {
      writes.push({ kind: 'merge' })
      // Aucune vraie PR : la forge simulée refuse, et son message se lit.
      return route.fulfill({ status: 502, json: { error: { code: 'forge_failed', message: 'The forge refused', params: { error: 'Base branch was modified' } } } })
    }
    if (/^\/api\/cards\/[^/]+\/milestone$/.test(path)) return route.fulfill({ json: null })
    if (path === '/api/conversations') return route.fulfill({ json: [] })
    if (path === `/api/projects/${PROJECT}/prompts`) return route.fulfill({ json: { prompts: [] } })
    if (path === '/api/awaiting') return route.fulfill({ json: { requests: [] } })
    if (/^\/api\/cards\/[^/]+\/notes$/.test(path)) return route.fulfill({ json: [] })
    return route.fulfill({ status: 404, json: {} })
  })
  const slot = page.locator('#lancer')
  const panel = slot.getByRole('region', { name: 'Suivi du jalon' })
  const band = page.getByRole('region', { name: 'Prochaine action' })
  const list = panel.getByRole('list', { name: 'Cartes du jalon' })
  const row = (number) => list.getByRole('listitem').filter({ has: page.getByRole('link', { name: new RegExp(`^#${number} `) }) })
  const mode = panel.getByRole('radiogroup', { name: 'Mode du pilotage' })
  const shot = async (name, locator = slot) => {
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await locator.scrollIntoViewIfNeeded()
    await locator.screenshot({ animations: 'disabled', path: `/tmp/milestones-suivi-${name}-${width}.png` })
  }
  const lastWrite = async (count) => {
    for (let i = 0; i < 50 && writes.length < count; i++) await delay(100)
    assert.equal(writes.length, count, 'Un geste, un appel')
    return writes.at(-1)
  }

  console.log(width, 'lancé en autonome : le titre, la durée, le mode, les places, la branche')
  await mount(page, `/p/${PROJECT}/timeline/400`, 'page')
  await panel.waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Lancer' }).count(), 0, 'Le suivi remplace le panneau Lancer')
  assert.equal(await panel.getByRole('heading', { name: 'Lancé en autonome' }).isVisible(), true)
  assert.equal(await panel.getByText(/^depuis 2\s?h$/).isVisible(), true)
  assert.equal(await mode.getByRole('radio', { name: 'Autonome' }).getAttribute('aria-checked'), 'true')
  assert.equal(await panel.getByRole('button', { name: /^2\/3 places occupées/ }).isVisible(), true)
  assert.equal(await panel.locator('code', { hasText: 'jalon/400-acces-distant-fiable' }).isVisible(), true)
  const confined = panel.getByRole('checkbox', { name: 'Sessions confinées, sans demandes d’autorisation (pour les prochaines)' })
  assert.equal(await confined.isChecked(), false, 'Le réglage du projet : non confiné')
  assert.equal(await panel.getByText('Seuls les blocages te reviennent : ils s’affichent dans Affinage et dans « Ce qui t’attend ».').isVisible(), true)

  console.log(width, 'les cartes : chaque statut, ce qui t’attend en ambre et pourquoi')
  assert.deepEqual(
    await list.getByRole('listitem').evaluateAll((items) => items.map((item) => item.lastElementChild.textContent)),
    ['fusionnée', 'au travail', 'en revue', 't’attend', 'en file', 'attend ses bloqueurs'],
  )
  assert.equal(await row(404).evaluate((element) => element.className.includes('bg-caution')), true, 'Le repère ambre')
  assert.equal(await row(402).locator('.animate-pulse').count(), 1, 'Au travail : la pastille pulse')
  assert.equal(await row(405).getByRole('button', { name: /^Lancer/ }).count(), 0, 'En autonome, le serveur lance')
  assert.equal(await row(402).getByRole('link').first().getAttribute('href'), `/p/${PROJECT}/c/s-402`, 'Une carte mène à sa session')
  assert.equal(await row(402).getByRole('button', { name: 'Détail de la carte #402' }).isVisible(), true)
  const reason = 'Sa revue a atteint son plafond de tours : tu tranches.'
  if (phone) {
    assert.equal(await row(404).getByText(reason).isVisible(), true, 'Au doigt, la raison sous la carte')
  } else {
    assert.equal(await row(404).getByText(reason).isVisible(), false, 'À la souris, en infobulle')
    await row(404).getByText('t’attend').hover()
    await page.getByRole('tooltip').filter({ hasText: reason }).first().waitFor()
    await page.mouse.move(2, 2)
    await page.keyboard.press('Escape')
    await page.getByRole('tooltip').waitFor({ state: 'detached' })
  }
  await shot('autonome')

  console.log(width, 'les places en cours de route')
  await panel.getByRole('button', { name: /^2\/3 places occupées/ }).click()
  await page.getByRole('menuitemradio', { name: '4' }).click()
  assert.deepEqual(await lastWrite(1), { kind: 'run', concurrency: 4 })
  await panel.getByRole('button', { name: /^2\/4 places occupées/ }).waitFor()
  await page.getByRole('region', { name: 'Vagues' }).getByText('· 4 à la fois').waitFor()

  console.log(width, 'à la main : la ligne manuelle, « Lancer » sur la carte en file')
  await mode.getByRole('radio', { name: 'À la main' }).click()
  assert.deepEqual(await lastWrite(2), { kind: 'run', mode: 'manual' })
  await panel.getByRole('heading', { name: 'Lancé à la main' }).waitFor()
  assert.equal(await panel.getByText('Tu lances les cartes ; les sessions avancent seules').isVisible(), true)
  await row(405).getByRole('button', { name: 'Lancer #405' }).click()
  assert.deepEqual(await lastWrite(3), { kind: 'launch', body: { confined: null } }, 'Le pilotage vivant garde son confinement')
  assert.equal(await row(406).getByRole('button', { name: /^Lancer/ }).count(), 0, 'Elle attend ses bloqueurs')
  await shot('main')

  console.log(width, 'le confinement des prochaines sessions')
  // Cochée quand le serveur l'a pris en compte, pas avant : le geste peut être refusé.
  await confined.click()
  assert.deepEqual(await lastWrite(4), { kind: 'run', confined: true })
  if (phone) {
    await panel.getByRole('alert').waitFor()
    assert.match(await panel.getByRole('alert').innerText(), /^Le geste a échoué : /)
    await confined.waitFor()
    assert.equal(await confined.isChecked(), false, 'Refusé : rien ne change')
  } else {
    await page.waitForFunction(() => document.querySelector('#lancer input[type=checkbox]')?.checked)
  }

  console.log(width, 'ajouter une carte : elle entre au jalon, « +1 depuis le lancement »')
  const add = panel.getByRole('button', { name: 'Ajouter', exact: true })
  assert.equal(await add.isDisabled(), true, 'Rien à ajouter')
  await panel.getByRole('textbox', { name: 'Ajouter une carte au jalon' }).fill('Test au téléphone')
  await add.click()
  assert.deepEqual(await lastWrite(5), { kind: 'card', title: 'Test au téléphone', parentId: 'card-400' })
  await row(407).waitFor()
  assert.equal(await row(407).getByRole('button', { name: 'Lancer #407' }).isVisible(), true, 'Pas encore adoptée : en file, et à la main on la lance')
  assert.equal(await panel.getByText('+1 depuis le lancement').isVisible(), true)
  assert.equal(await panel.getByRole('textbox', { name: 'Ajouter une carte au jalon' }).inputValue(), '')

  console.log(width, 'pause, reprise')
  await panel.getByRole('button', { name: 'Pause' }).click()
  assert.deepEqual(await lastWrite(6), { kind: 'run', state: 'paused' })
  await panel.getByRole('heading', { name: 'En pause' }).waitFor()
  await shot('pause')
  await panel.getByRole('button', { name: 'Reprendre' }).click()
  assert.deepEqual(await lastWrite(7), { kind: 'run', state: 'running' })
  await panel.getByRole('heading', { name: 'Lancé à la main' }).waitFor()

  console.log(width, 'arrêter : confirmé d’abord, puis le panneau Lancer revient')
  await panel.getByRole('button', { name: 'Arrêter' }).click()
  const dialog = page.getByRole('dialog', { name: 'Arrêter le jalon ?' })
  await dialog.waitFor()
  assert.equal(writes.length, 7, 'Rien ne part avant la confirmation')
  // Le libellé vient de `UiLabelsProvider`, que cette page réduite ne pose pas.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(writes.length, 7)
  await panel.getByRole('button', { name: 'Arrêter' }).click()
  await dialog.getByRole('button', { name: 'Arrêter' }).click()
  assert.deepEqual(await lastWrite(8), { kind: 'run', state: 'stopped' })
  await slot.getByRole('heading', { name: 'Lancer' }).waitFor()

  console.log(width, 'PR finale ouverte : « Fusionner dans main », « Ouvrir la PR », l’erreur de forge')
  await mount(page, `/p/${PROJECT}/timeline/410`, 'page')
  const pr = slot.getByRole('complementary', { name: 'PR du jalon ouverte' })
  await pr.waitFor()
  assert.equal(await pr.getByText(/Toutes les cartes sont fusionnées dans jalon\/410-comptes-nommes\. Solera a ouvert la PR #77 vers main/).isVisible(), true)
  assert.equal(await pr.getByRole('link', { name: 'Ouvrir la PR' }).getAttribute('href'), 'https://github.com/tipaq/solera/pull/77')
  await shot('pr')
  await pr.getByRole('button', { name: 'Fusionner dans main' }).click()
  await pr.getByRole('alert').waitFor()
  assert.equal(await pr.getByRole('alert').innerText(), 'La PR du jalon n’a pas été fusionnée : La forge a refusé : Base branch was modified')
  assert.deepEqual(await lastWrite(9), { kind: 'merge' })

  console.log(width, 'PR fermée sans fusion : plus de fusion proposée, la PR à rouvrir')
  await mount(page, `/p/${PROJECT}/timeline/420`, 'page')
  const closed = slot.getByRole('complementary', { name: 'PR du jalon fermée' })
  await closed.waitFor()
  assert.equal(await closed.getByRole('button', { name: /^Fusionner/ }).count(), 0)
  assert.equal(await closed.getByRole('link', { name: 'Ouvrir la PR' }).isVisible(), true)
  assert.equal(await band.getByText('La PR #77 du jalon a été fermée sans fusion : rouvre-la sur la forge pour le livrer.').isVisible(), true)
  assert.equal(await page.locator('header').getByText('Lancé', { exact: true }).isVisible(), true)
  await shot('pr-fermee')

  assert.equal(writes.length, 9, 'Aucun autre appel')
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
  for (const width of [1280, 390]) await composerStep(width)
  for (const width of [1280, 390]) await pageStep(width)
  for (const width of [1280, 390]) await refineStep(width)
  for (const width of [1280, 390]) await settleStep(width)
  for (const width of [1280, 390]) await launchStep(width)
  for (const width of [1280, 390]) await runStep(width)
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
  console.log('OK : composer — tiroir large, titre tiré du texte, gestes retenus et pourquoi, pied (étape, phrase, repéré, aperçu au survol), brouillon gardé, échéance, Réf./Inclure, lien, fichier, pas de fermeture pendant l’envoi, Ctrl+Entrée (carte drapeautée et datée, relation, enfant, fichier, brouillon d’affinage pré-rempli), idée notée, pièce qui ne suit pas ; ordinateur et téléphone.')
  console.log('OK : page — en-tête, prochaine action et son geste (défiler, affiner, fusionner, fiche), étapes expliquées, affinage en tête quand il attend, vagues (colonnes, arêtes, cycle, chaîne, empilées au téléphone, ambre, ajoutées) ; ordinateur et téléphone.')
  console.log('OK : affinage — quatre états et le mode, outil en cours, question asynchrone de Codex, réponses gardées puis envoyées ensemble, brouillon corrigé (renommer, monter, lier, ajouter, retirer) puis validé, affinage pré-rempli (questions d’abord, découpage direct) ; ordinateur et téléphone.')
  console.log('OK : à régler et ajout — préciser (à la session, sinon dans la description), accepter, rompre un cycle, liste absente quand vide ; « Ajouter au jalon » (à la session d’affinage, sinon brouillon pré-rempli), absent d’un jalon livré ; ajout proposé en sous-tâches (déjà là signalée) accepté, en cartes laissé ; ordinateur et téléphone.')
  console.log('OK : lancer — à la main (environnements du projet, cartes, lancer une carte, refus lu), autonome (confiné d’office, avertissement, concurrence jusqu’aux vagues, quota, branche, CLI, vérifications échecs d’abord, lancer), livré, rien à lancer ; ordinateur et téléphone.')
  console.log('OK : suivi — titre et durée, mode, places en cours, branche, confinement (refus lu), statuts (ambre et raison), lancer à la main, ajout de carte, pause, reprise, arrêt confirmé ; PR finale ouverte (fusion, lien, erreur de forge) et fermée ; ordinateur et téléphone.')
  console.log('OK : fiche — ℹ sans la session, ?fiche= partageable, en-tête, réponse sur place, sessions, sous-tâches, description, notes, pied, liens qui changent de fiche, case « C’est un jalon » (d’office, grisée, cochable) ; ordinateur et téléphone.')
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  await once(vite, 'exit')
}
