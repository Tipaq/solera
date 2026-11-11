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

async function mount(page, entry) {
  // Les fournisseurs viennent des mêmes modules que les composants : voir `viteDependency`.
  const modules = {
    react: await viteDependency(origin, 'react', '/src/components/shell/Drawer.tsx'),
    reactDom: await viteDependency(origin, 'react-dom/client', '/src/main.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/shell/Drawer.tsx'),
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/cards.ts'),
    router: await viteDependency(origin, 'react-router-dom', '/src/components/cards/CardInfoButton.tsx'),
  }
  await page.goto(`${origin}/__milestones_check`)
  await page.evaluate(async ({ modules, project, entry }) => {
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
    const { MemoryRouter, Link, useLocation } = await import(modules.router)
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

    createRoot(document.getElementById('check')).render(
      h(QueryClientProvider, { client },
        h(MemoryRouter, { initialEntries: [entry] },
          h(TooltipProvider, null,
            h(DetailSurfaceContext.Provider, { value: 'drawer' }, h(Where), h(Page))))))
  }, { modules, project: PROJECT, entry })
}

try {
  for (let i = 0; i < 150; i++) {
    if (await fetch(origin).then((r) => r.ok).catch(() => false)) break
    if (vite.exitCode !== null) throw new Error(diagnostics)
    await delay(100)
  }
  browser = await launchBrowser()
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
  console.log('OK : fiche — ℹ sans la session, ?fiche= partageable, en-tête, réponse sur place, sessions, sous-tâches, description, notes, pied, liens qui changent de fiche, case « C’est un jalon » (d’office, grisée, cochable) ; ordinateur et téléphone.')
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  await once(vite, 'exit')
}
