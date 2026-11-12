import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './checks/browser.mjs'
import { viteDependency } from './checks/vite-deps.mjs'

// L'onglet Projet du panneau d'une conversation (#229, PPR-1 à PPR-5), monté seul :
// composants réels, API simulée, aucun CLI. Les gestes se vérifient par les requêtes
// qu'ils envoient. Une capture par bloc, en 1280 et 390 px.
const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const captures = fileURLToPath(new URL('../docs/audits/2026-11-page-projet-v2/229-projet/', import.meta.url))
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise((resolve) => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const vite = spawn(process.execPath, [web + 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: web, stdio: 'pipe' })
let diagnostics = ''
for (const stream of [vite.stdout, vite.stderr]) stream.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-6000) })
let browser

/* ------------------------------------------------------------------ données */

const PROJECT = '11111111-1111-4111-8111-111111111111'
const HERE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WAIT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RUN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OLD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const now = Date.now()
const DAY = 86_400_000
const HOUR = 3_600_000

const link = (card) => ({ id: card.id, number: card.number, title: card.title, column: card.column })
const cardSession = (id, title, status, agent = 'claude') =>
  ({ id, title, agent, status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: now - DAY })
const card = (number, title, column, extra = {}) => ({
  id: `card-${number}`, projectId: PROJECT, number, title, description: '', column, position: number,
  dueAt: null, parent: null, milestone: false, children: [], branch: null, branchPr: null, refinement: null,
  acceptedAt: now - 3 * DAY, toClarifySince: null, createdBy: 'u1', createdByName: 'Tim', createdAt: now - 3 * DAY,
  updatedAt: now - DAY, columnSince: now - 2 * DAY, conversations: [], attachmentCount: 0, noteCount: 0,
  references: [], referencedBy: [], blocks: [], blockedBy: [], related: [], duplicateOf: null, duplicates: [], issue: null,
  ...extra,
})

const milestone = card(42, 'Page projet v2 · Panneau de conversation', 'in_progress', { milestone: true })
const done = card(30, 'Cadre commun du panneau', 'done', { parent: link(milestone) })
const next = card(21, 'Onglet Agent', 'todo', { parent: link(milestone) })
const current = card(27, 'Panneau : l’onglet Projet', 'in_progress', {
  parent: link(milestone),
  dueAt: now - 2 * DAY,
  description: 'Réécrire ProjectPane sur le cadre.\n\n- [x] Le pur et ses tests\n- [ ] Le composant\n- [ ] Les captures',
  blockedBy: [link(done)],
  blocks: [link(next)],
  conversations: [cardSession(HERE, 'Onglet projet du panneau', 'running'), cardSession(OLD, 'Première approche', 'idle', 'codex')],
})
next.blockedBy = [link(current)]
milestone.children = [link(current), link(next), link(done)]
const ready = [50, 51, 52, 53].map((number) => card(number, `Carte prête ${number}`, 'todo'))
// Une session y travaille : elle n'est plus prête à partir.
ready[0].conversations = [cardSession(RUN, 'Jetons générés', 'running')]
const review = card(60, 'Relire la ligne d’outils Git', 'review')
const CARDS = [milestone, current, next, done, ...ready, review]

const conversation = (id, title, status, extra = {}) => ({
  id, projectId: PROJECT, worktreeId: null, worktreeGone: false, card: null, milestone: null, userId: 'u1', title,
  titleSetByUser: false, agent: 'claude', forkedFromId: null, handoffFromId: null, config: {}, status, lastSeq: 1,
  lastNotableSeq: 1, lastReadSeq: 1, costUsd: 0, inputTokens: 0, outputTokens: 0, metrics: null, pinned: false,
  archivedAt: null, createdAt: now - HOUR, updatedAt: now - 60_000, isOwner: true, origin: null, scheduleId: null, ...extra,
})
const CONVERSATIONS = [
  conversation(HERE, 'Onglet projet du panneau', 'running', { card: link(current) }),
  conversation(RUN, 'Jetons générés', 'running', { card: link(ready[0]) }),
  conversation(WAIT, 'Vérifier la release', 'awaiting_input', { agent: 'codex' }),
  conversation(OLD, 'Première approche', 'idle', { card: link(current) }),
]

const NOTES = [
  ['n1', 'Le pur est vert : readyCards, otherActiveSessions, sessionWorktree.', 40 * 60_000],
  ['n2', 'Décidé : la fiche de carte s’empile dans le panneau, jamais un second tiroir.', 3 * HOUR],
  ['n3', 'Les cartes ajoutées après le lancement entrent dans la file.', 26 * HOUR],
  ['n4', 'Première version.', 3 * DAY],
].map(([id, body, ago], index) => ({
  id, body, createdAt: now - ago,
  author: index === 1 ? { kind: 'user', name: 'Tim' } : { kind: 'agent', agent: 'claude', conversationId: HERE, conversationTitle: 'Onglet projet du panneau' },
}))

const TREES = {
  base: 'main', computedAt: now, fresh: true, branches: [], branchesPending: false,
  worktrees: [{
    id: 'w-27', name: 'feat-27', path: '/w/feat-27', branch: 'feat/229-panneau-projet', external: false, state: 'active',
    ahead: 4, behind: 3, modified: 2, untracked: 0, conflicts: false, unmergedCommits: true, mergedPullRequest: null,
    head: 'a093fcd', lastCommitAt: now, lastEditAt: now, conversations: [{ id: HERE, link: 'session' }], sizeBytes: null,
    card: null, cardSource: null,
  }],
}
const PULL_REQUESTS = {
  available: true, fetchedAt: now,
  pullRequests: [{
    number: 214, url: 'https://github.com/tipaq/solera/pull/214', title: 'Panneau : l’onglet Projet', branch: 'feat/229-panneau-projet',
    base: 'main', state: 'checks', checks: { passed: 6, pending: 2, failed: [] }, review: null, updatedAt: now,
  }],
}
const PROJECTS = [{
  id: PROJECT, name: 'Solera', image: null, workspacePath: '/srv/solera', ownerId: 'u1', ownerName: 'Tim', visibility: 'private',
  color: null, isOwner: true, position: 0, archivedAt: null, createdAt: now - 60 * DAY, conversationCount: 4,
  configLayer: { shared: {}, claude: {}, codex: {}, opencode: {}, grok: {} }, instructionsMode: null, activeTerminals: 0,
  git: { branch: 'main', isDirty: false, changedFiles: 0, added: 0, removed: 0 },
}]

/** Le plan de l'agent, tel que `TodoWrite` le publie. */
const PLAN = {
  kind: 'tool', id: 't1', ts: 0, name: 'TodoWrite', output: null, outputBytes: null, status: 'done', durationMs: 12, parentToolCallId: null,
  input: { todos: [
    { content: 'Écrire les tests du pur', status: 'completed' },
    { content: 'Réécrire ProjectPane', status: 'in_progress' },
    { content: 'Captures', status: 'pending' },
  ] },
}
/** Un fil qui cite trois fois #21 : c'est elle qu'on proposera de rattacher. */
const CITING = {
  kind: 'message', id: 'm1', role: 'user', ts: 0, seq: 1, streamingText: '', streamingThinking: '', parentToolCallId: null,
  blocks: [{ type: 'text', text: 'On reprend #21. Le geste de #21 doit marcher comme #21 le décrit.' }],
}
const SESSION = {
  title: 'Onglet projet du panneau', card: link(current), items: [PLAN], running: true,
  activity: 'Édition de ProjectPane.tsx', model: 'opus-5.5', contextRatio: 0.38,
}

/* ------------------------------------------------------------------ montage */

async function mount(page, session) {
  const modules = {
    react: await viteDependency(origin, 'react', '/src/components/panel/ProjectPane.tsx'),
    reactDom: await viteDependency(origin, 'react-dom/client', '/src/main.tsx'),
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/cards.ts'),
    router: await viteDependency(origin, 'react-router-dom', '/src/components/panel/ProjectPane.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/panel/ProjectPane.tsx'),
  }
  await page.goto(`${origin}/__project_check`)
  await page.evaluate(async ({ modules, session, project, here }) => {
    const refresh = (await import('/@react-refresh')).default
    refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    localStorage.setItem('solera.locale', 'fr')
    await (await import('/src/lib/i18n/index.ts')).initLocale()
    document.documentElement.dataset.theme = 'light'
    await import('/src/styles/index.css')
    const React = (await import(modules.react)).default
    const { createRoot } = (await import(modules.reactDom)).default
    const { QueryClient, QueryClientProvider } = await import(modules.query)
    const { MemoryRouter, useLocation } = await import(modules.router)
    const { TooltipProvider } = await import(modules.ui)
    const { DetailSurfaceContext } = await import('/src/lib/detail-surface.ts')
    const { ProjectPane } = await import('/src/components/panel/ProjectPane.tsx')
    const { usePanelTab } = await import('/src/lib/panel.ts')
    const h = React.createElement
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    function Where() {
      const location = useLocation()
      window.where = location.pathname + location.search
      window.panelTab = usePanelTab()
      return null
    }
    function Harness() {
      return h(DetailSurfaceContext.Provider, { value: 'panel' },
        h(Where),
        h('aside', { 'aria-label': 'Panneau', className: 'surface flex h-dvh w-[26rem] max-w-full flex-col border-l border-line' },
          h(ProjectPane, { projectId: project, conversationId: here, session })))
    }
    createRoot(document.getElementById('check')).render(h(QueryClientProvider, { client },
      h(MemoryRouter, { initialEntries: [`/p/${project}/c/${here}`] }, h(TooltipProvider, null, h(Harness)))))
  }, { modules, session, project: PROJECT, here: HERE })
}

/** L'API simulée ; `sent` reçoit les écritures, `board` décide si le tableau se lit. */
async function routeApi(page, state) {
  await page.route('**/__project_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check" class="flex justify-end"></div></body></html>' }))
  await page.route('**/api/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      state.sent.push({ method: request.method(), path, body: request.postDataJSON() })
      if (path === `/api/projects/${PROJECT}/cards`) return route.fulfill({ json: card(99, 'Créée', 'in_progress') })
      if (path.startsWith('/api/cards/')) return route.fulfill({ json: current })
      return route.fulfill({ json: { ok: true } })
    }
    if (path === `/api/projects/${PROJECT}/cards`) {
      return state.board === 'error' ? route.fulfill({ status: 500, json: { error: 'boom' } }) : route.fulfill({ json: CARDS })
    }
    if (path === '/api/projects') return route.fulfill({ json: PROJECTS })
    if (path === '/api/conversations') return route.fulfill({ json: CONVERSATIONS })
    if (path === `/api/cards/${current.id}/notes`) return route.fulfill({ json: NOTES })
    if (/^\/api\/cards\/[^/]+\/(notes|attachments)$/.test(path)) return route.fulfill({ json: [] })
    if (path === `/api/projects/${PROJECT}/worktrees/status`) return route.fulfill({ json: TREES })
    if (path === `/api/projects/${PROJECT}/pull-requests`) return route.fulfill({ json: PULL_REQUESTS })
    if (path === `/api/projects/${PROJECT}/milestones/active`) return route.fulfill({ json: [] })
    if (path.endsWith('/prompts')) return route.fulfill({ json: { prompts: [] } })
    if (path === '/api/awaiting') return route.fulfill({ json: { requests: [] } })
    return route.fulfill({ json: {} })
  })
}

try {
  let up = false
  for (let i = 0; i < 150; i++) {
    if (await fetch(origin).then((r) => r.ok).catch(() => false)) { up = true; break }
    if (vite.exitCode !== null) break
    await delay(100)
  }
  assert.ok(up, diagnostics)
  await mkdir(captures, { recursive: true })
  browser = await launchBrowser()

  for (const width of [1280, 390]) {
    const phone = width < 700
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: phone, isMobile: phone, locale: 'fr-FR', serviceWorkers: 'block' })
    const open = async (session = SESSION, board = 'ok') => {
      const page = await context.newPage()
      page.setDefaultTimeout(8000)
      const state = { sent: [], board, errors: [] }
      page.on('pageerror', (error) => state.errors.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error' && !/WebSocket|\[vite\]|500/.test(message.text())) state.errors.push(message.text()) })
      await routeApi(page, state)
      await mount(page, session)
      return { page, state, pane: page.getByRole('complementary', { name: 'Panneau' }) }
    }
    const shot = (locator, name) => locator.screenshot({ path: `${captures}${width}-${name}-impl.png` })
    const section = (pane, name) => pane.getByRole('region', { name })
    const click = (locator) => (phone ? locator.tap() : locator.click())

    /* ---------------------------------------------------------- Cette session */
    {
      const { page, state, pane } = await open()
      // PPR-1 : la ligne d'outils, « #27 », les segments.
      const toolbar = pane.locator('div.h-12').first()
      await toolbar.getByText('#27').waitFor()
      assert.equal(await pane.getByRole('radio', { name: 'Cette session' }).getAttribute('aria-checked'), 'true')
      await shot(toolbar, 'outils')

      // PPR-2 : la bande d'activité.
      const activity = pane.getByRole('status').filter({ hasText: 'Travaille' })
      await activity.getByText('Édition de ProjectPane.tsx').waitFor()
      await activity.getByText('opus-5.5 · contexte 38 %').waitFor()

      // PPR-4 : la carte à plat — colonne, jalon, échéance en retard, gestes.
      const head = section(pane, 'Carte')
      await head.getByText('Panneau : l’onglet Projet').waitFor()
      await head.getByText('En cours').waitFor()
      await head.getByText(/^#42 Page projet v2/).waitFor()
      assert.match(await head.getByText(/^échéance/).getAttribute('class'), /text-critical/, 'une échéance dépassée est rouge')
      await shot(head, 'carte')

      // Sous-tâches : 1/3, la barre, une case cochée pour de vrai.
      const subtasks = section(pane, 'Sous-tâches')
      await subtasks.getByText('1/3').waitFor()
      assert.equal(await subtasks.getByRole('progressbar').getAttribute('aria-valuenow'), '1')
      await shot(subtasks, 'sous-taches')
      await click(subtasks.getByRole('checkbox', { name: 'Le composant' }))
      await assertSent(state, { method: 'POST', path: `/api/cards/${current.id}/subtasks`, body: { index: 1, checked: true, label: 'Le composant' } })

      // Dépendances : la fermée barrée, la voisine en pile (PPR-5).
      const deps = section(pane, 'Dépendances')
      assert.match(await deps.getByText('Cadre commun du panneau').getAttribute('class'), /line-through/)
      await deps.getByText('bloque', { exact: true }).waitFor()
      await shot(deps, 'dependances')

      // Sessions de la carte : l'autre, au repos ; celle du panneau n'y est pas.
      const sessions = section(pane, 'Sessions')
      await sessions.getByText('Première approche').waitFor()
      await sessions.getByText('au repos').waitFor()
      assert.equal(await sessions.getByRole('button').count(), 1)
      await shot(sessions, 'sessions')

      // Notes : trois sur quatre, « Tout voir ».
      const notes = section(pane, 'Notes')
      assert.equal(await notes.getByRole('listitem').count(), 3)
      await notes.getByRole('button', { name: 'Tout voir' }).waitFor()
      await shot(notes, 'notes')

      // Le plan de l'agent.
      const plan = section(pane, 'Plan de l’agent')
      await plan.getByText('1/3').waitFor()
      await shot(plan, 'plan')

      // La branche et sa PR.
      const branch = pane.getByRole('button', { name: /feat\/229-panneau-projet/ })
      await branch.getByText('↑4 ↓3 · 2 non commités').waitFor()
      const pr = pane.getByRole('link', { name: /#214/ })
      await pr.getByText('CI en cours · 6/8').waitFor()
      assert.equal(await pr.getAttribute('target'), '_blank')
      await shot(section(pane, 'Branche'), 'branche')

      // Colonne ▾ : la coche sur l'actuelle, puis un vrai déplacement.
      await click(head.getByRole('button', { name: 'Colonne' }))
      const menu = page.getByRole('menu')
      await menu.getByRole('menuitem', { name: 'À vérifier' }).waitFor()
      await click(menu.getByRole('menuitem', { name: 'À vérifier' }))
      await assertSent(state, { method: 'PATCH', path: `/api/cards/${current.id}`, body: { column: 'review' } })

      // Le titre ouvre la fiche en pile : « ‹ Projet », puis retour.
      await click(head.getByRole('button', { name: /^#27/ }))
      const back = pane.getByRole('button', { name: 'Projet', exact: true })
      await back.waitFor()
      await pane.getByText('Panneau : l’onglet Projet').first().waitFor()
      await shot(pane, 'fiche')
      await click(back)
      await section(pane, 'Carte').waitFor()

      // Une dépendance s'ouvre aussi en pile.
      await click(section(pane, 'Dépendances').getByRole('button', { name: /Onglet Agent/ }))
      await pane.getByText('Onglet Agent').first().waitFor()
      await click(pane.getByRole('button', { name: 'Projet', exact: true }))

      // « Tout voir » ouvre la fiche de la carte.
      await click(section(pane, 'Notes').getByRole('button', { name: 'Tout voir' }))
      await pane.getByRole('button', { name: 'Projet', exact: true }).waitFor()
      await click(pane.getByRole('button', { name: 'Projet', exact: true }))

      // La branche mène à l'onglet Git.
      await click(pane.getByRole('button', { name: /feat\/229-panneau-projet/ }))
      await page.waitForFunction(() => window.panelTab === 'git')

      // Le jalon parent mène à sa page.
      await click(section(pane, 'Carte').getByRole('button', { name: /^#42/ }))
      await page.waitForFunction((path) => window.where === path, `/p/${PROJECT}/timeline/42`)

      // Détacher : la conversation perd sa carte.
      await click(section(pane, 'Carte').getByRole('button', { name: 'Détacher' }))
      await assertSent(state, { method: 'PATCH', path: `/api/conversations/${HERE}`, body: { cardId: null } })

      assert.deepEqual(state.errors, [])
      await noOverflow(pane)
      await page.close()
    }

    /* ---------------------------------------------------------------- Projet */
    {
      const { page, pane } = await open()
      await click(pane.getByRole('radio', { name: 'Projet' }))

      // PPR-3 : ce qui t'attend — la session qui attend, la carte à relire.
      const inbox = section(pane, 'Ce qui t’attend')
      await inbox.getByText('Vérifier la release').waitFor()
      await inbox.getByText(/Relire la ligne d’outils Git/).waitFor()
      await shot(inbox.locator('xpath=ancestor::section[1]'), 'attend')

      // Le jalon en cours : avancement, vague, cette session en fait partie.
      const milestoneBlock = section(pane, 'Jalon en cours')
      await milestoneBlock.getByText('Page projet v2 · Panneau de conversation').waitFor()
      await milestoneBlock.getByText('1/3').waitFor()
      await milestoneBlock.getByText(/Vague \d · \d\/\d · cette session y travaille \(#27\)/).waitFor()
      await shot(milestoneBlock, 'jalon')

      // Les autres sessions : celle qui attend d'abord, sans la session du panneau.
      const others = section(pane, 'Autres sessions actives')
      const rows = others.getByRole('button')
      assert.equal(await rows.count(), 2)
      assert.match(await rows.nth(0).textContent(), /Vérifier la release.*t’attend/)
      assert.match(await rows.nth(1).textContent(), /Jetons générés.*#50.*travaille/)
      await shot(others, 'sessions-actives')

      // Prêtes à partir : trois sur quatre (#50 a une session vivante), et Lancer.
      const readyBlock = section(pane, 'Prêtes à partir')
      await readyBlock.getByText('3', { exact: true }).waitFor()
      assert.equal(await readyBlock.getByRole('listitem').count(), 3)
      assert.equal(await readyBlock.getByText('#50').count(), 0, 'une carte qu’une session travaille n’est pas prête')
      await readyBlock.getByRole('listitem').first().hover().catch(() => {})
      await shot(readyBlock, 'pretes')
      await click(readyBlock.getByRole('button', { name: 'Lancer une session' }).first())
      await page.waitForFunction((path) => window.where === path, `/p/${PROJECT}/c/new?card=card-51`)

      // Les vues du projet.
      const views = pane.getByRole('navigation', { name: 'Vues du projet' })
      await shot(views, 'vues')
      await click(views.getByRole('button', { name: 'Tableau' }))
      await page.waitForFunction((path) => window.where === path, `/p/${PROJECT}/board`)

      // Une carte prête s'ouvre en pile, avec « ‹ Projet ».
      await click(readyBlock.getByRole('button', { name: /#52/ }))
      await pane.getByRole('button', { name: 'Projet', exact: true }).waitFor()
      await noOverflow(pane)
      await page.close()
    }

    /* ------------------------------------------------------------ sans carte */
    {
      const { page, state, pane } = await open({ ...SESSION, card: null, items: [CITING, PLAN], running: false, activity: null })
      const block = section(pane, 'Carte')
      await block.getByText('Pas de carte.').waitFor()
      await pane.getByRole('status').filter({ hasText: 'Au repos' }).waitFor()
      const suggestion = block.getByRole('button', { name: 'Rattacher #21' })
      await suggestion.waitFor()
      if (!phone) await block.getByText('citée 3×').waitFor()
      await shot(block, 'sans-carte')
      await click(suggestion)
      await assertSent(state, { method: 'PATCH', path: `/api/conversations/${HERE}`, body: { cardId: next.id } })
      await click(block.getByRole('button', { name: 'Créer depuis la session' }))
      await assertSent(state, { method: 'POST', path: `/api/projects/${PROJECT}/cards`, body: { title: SESSION.title, column: 'in_progress' } })
      await assertSent(state, { method: 'PATCH', path: `/api/conversations/${HERE}`, body: { cardId: 'card-99' } })
      assert.deepEqual(state.errors, [])
      await page.close()
    }

    /* ------------------------------------------------------- tableau illisible */
    {
      const { page, pane } = await open(SESSION, 'error')
      await pane.getByText('Le tableau n’a pas pu être lu.').waitFor()
      await pane.getByRole('button', { name: 'Réessayer' }).waitFor()
      await shot(pane.locator('div.overflow-y-auto').first(), 'erreur')
      await page.close()
    }

    console.log(`OK ${width} : PPR-1 à PPR-5`)
    await context.close()
  }
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  if (vite.exitCode === null) await once(vite, 'exit')
}

/** Attend qu'une écriture soit partie, telle quelle. */
async function assertSent(state, expected) {
  for (let i = 0; i < 50; i++) {
    if (state.sent.some((entry) => entry.method === expected.method && entry.path === expected.path && JSON.stringify(entry.body) === JSON.stringify(expected.body))) return
    await delay(100)
  }
  assert.fail(`Écriture attendue : ${JSON.stringify(expected)}\nEnvoyées : ${JSON.stringify(state.sent)}`)
}

/** Rien ne déborde du panneau en largeur. */
async function noOverflow(pane) {
  const overflow = await pane.evaluate((node) => [...node.querySelectorAll('*')].some((child) => child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).overflowX === 'visible' && child.getBoundingClientRect().right > node.getBoundingClientRect().right + 1))
  assert.equal(overflow, false, 'le panneau déborde en largeur')
}
