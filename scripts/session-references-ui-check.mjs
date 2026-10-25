import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './checks/browser.mjs'
import { viteDependency } from './checks/vite-deps.mjs'

// Citer une session (carte #105) : le menu « Insérer », la liste `@@`, la puce au-dessus
// du champ et dans le fil, son aperçu au pointeur et au doigt, la largeur du fil.
// Vrai composer, vrai rendu markdown ; API simulée, aucun CLI lancé.
const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const captures = fileURLToPath(new URL('../docs/audits/2026-10-25-sessions-citees/', import.meta.url))
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
const HERE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SIDEBAR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OLD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const FOREIGN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const now = Date.now()
const session = (id, title, extra = {}) => ({
  id, projectId: PROJECT, worktreeId: null, worktreeGone: false, card: null, userId: 'u', title, titleSetByUser: false,
  agent: 'claude', forkedFromId: null, handoffFromId: null, config: {}, status: 'idle', lastSeq: 1, lastNotableSeq: 1,
  lastReadSeq: 1, costUsd: 0, inputTokens: 0, outputTokens: 0, metrics: null, pinned: false, archivedAt: null,
  createdAt: now - 3_600_000, updatedAt: now - 120_000, isOwner: true, origin: null, scheduleId: null, ...extra,
})
const sessions = [
  session(HERE, 'Cette conversation-ci', { agent: 'codex' }),
  session(SIDEBAR, 'Refonte de la sidebar', { card: { id: 'k', number: 73, title: 'Page projet', column: 'doing' } }),
  session(OLD, 'Ancienne piste écartée', { archivedAt: now - 86_400_000, updatedAt: now - 86_400_000, agent: 'codex' }),
]

const thread = [
  `Comme dans session:${SIDEBAR}, et aussi ${origin}/p/${PROJECT}/c/${OLD}.`,
  '',
  `Un identifiant nu qui en nomme une : ${SIDEBAR}. Une référence d'ailleurs : session:${FOREIGN}.`,
  '',
  `Une commande reste du code : \`solera read session:${SIDEBAR}\`.`,
].join('\n')

async function mount(page) {
  const modules = {
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/conversation-config.ts'),
    router: await viteDependency(origin, 'react-router-dom', '/src/components/chat/MessageBubble.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/chat/Composer.tsx'),
  }
  await page.goto(`${origin}/__refs_check`)
  await page.evaluate(async ({ modules, here, project, thread }) => {
    const refresh = (await import('/@react-refresh')).default
    refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    localStorage.setItem('solera.locale', 'fr')
    document.documentElement.dataset.theme = 'light'
    await import('/src/styles/index.css')
    const React = (await import('/node_modules/.vite/deps/react.js')).default
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
    const { QueryClient, QueryClientProvider } = await import(modules.query)
    const { MemoryRouter, useLocation } = await import(modules.router)
    const { TooltipProvider } = await import(modules.ui)
    const { Composer } = await import('/src/components/chat/Composer.tsx')
    const { Markdown } = await import('/src/components/chat/Markdown.tsx')
    const { CardRefContext } = await import('/src/lib/card-refs.ts')
    const { useConversationConfig } = await import('/src/lib/conversation-config.ts')
    const { useConversation } = await import('/src/lib/conversations.ts')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    window.sent = []
    function Where() {
      window.location2 = useLocation().pathname
      return null
    }
    function Harness() {
      const { data } = useConversation(here)
      const settings = useConversationConfig(data)
      if (!settings.config) return null
      return React.createElement(CardRefContext.Provider, { value: project },
        React.createElement(Where),
        React.createElement('div', { className: 'sg-conversation-width mx-auto', 'data-thread': '' },
          React.createElement(Markdown, { text: thread })),
        React.createElement(Composer, {
          config: settings.config, draftKey: here, projectId: project, status: 'idle', disabled: false,
          commands: [{ name: 'review', description: 'Relit le diff', argumentHint: '', aliases: [] }], skills: [], mcpInventory: [],
          onConfigChange: settings.change, onSend: async (text) => { window.sent.push(text) }, onInterrupt: () => {},
        }))
    }
    createRoot(document.getElementById('check')).render(React.createElement(QueryClientProvider, { client },
      React.createElement(MemoryRouter, null, React.createElement(TooltipProvider, null, React.createElement(Harness)))))
  }, { modules, here: HERE, project: PROJECT, thread })
  await page.getByRole('button', { name: /^Modèle :/ }).waitFor()
}

try {
  let ready = false
  for (let i = 0; i < 150; i++) {
    if (await fetch(origin).then((r) => r.ok).catch(() => false)) { ready = true; break }
    if (vite.exitCode !== null) break
    await delay(100)
  }
  assert.ok(ready, diagnostics)
  await mkdir(captures, { recursive: true })
  browser = await launchBrowser()
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const touch = viewport.width < 700
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, locale: 'fr-FR', serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/__refs_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main class="app-layer" style="display:flex;flex-direction:column;gap:2rem;padding:1rem"><div id="check"></div></main></body></html>' }))
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/conversations') return route.fulfill({ json: sessions })
      if (path === `/api/conversations/${HERE}`) return route.fulfill({ json: { ...sessions[0], config: { agent: 'codex', model: 'alpha', reasoningEffort: 'high', askForApproval: 'on-request', collaborationMode: 'default', sandbox: 'workspace-write', soleraMcp: true, mcpServers: [] } } })
      if (path.endsWith('/models')) return route.fulfill({ json: { models: [{ value: 'alpha', displayName: 'Modèle Alpha', description: '', hint: null, isDefault: true, efforts: [], defaultEffort: null }], modes: [], account: null, fetchedAt: Date.now() } })
      if (path.endsWith('/cards')) return route.fulfill({ json: [] })
      if (path.endsWith('/worktrees')) return route.fulfill({ json: [] })
      if (path.includes('/files')) return route.fulfill({ json: { files: [] } })
      if (path.includes('/cards/')) return route.fulfill({ json: { cards: [] } })
      if (path === '/api/mcp/servers') return route.fulfill({ json: { servers: [], soleraServer: true, agentMemory: true, projectFiling: true, cardFiling: true } })
      return route.fulfill({ json: {} })
    })
    await mount(page)
    const field = page.getByPlaceholder('Écris ton message...')
    const markdown = page.locator('[data-thread]')
    const plus = page.getByRole('button', { name: /^Joindre, skills, serveurs, réglages/ })

    // Dans le fil : deux puces au titre courant, l'UUID nu reconnu, la référence
    // d'ailleurs muette, la commande laissée en code.
    await markdown.getByRole('link', { name: 'Refonte de la sidebar' }).first().waitFor()
    assert.equal(await markdown.getByRole('link', { name: 'Refonte de la sidebar' }).count(), 2)
    assert.equal(await markdown.getByRole('link', { name: 'Ancienne piste écartée' }).count(), 1)
    assert.equal(await markdown.getByText('Session introuvable').count(), 1)
    assert.match(await markdown.locator('code').textContent(), new RegExp(`session:${SIDEBAR}`))
    assert.equal(await markdown.getByRole('link', { name: 'Refonte de la sidebar' }).first().getAttribute('href'), `/p/${PROJECT}/c/${SIDEBAR}`)

    // L'aperçu : au survol au pointeur, par le ⓘ au doigt, qui seul y est visible.
    const chip = markdown.getByRole('link', { name: 'Refonte de la sidebar' }).first()
    const info = markdown.getByRole('button', { name: 'Aperçu de « Refonte de la sidebar »' }).first()
    assert.equal(await info.isVisible(), touch, 'Le ⓘ ne se montre qu’au doigt')
    if (touch) {
      await info.tap()
      const panel = page.getByRole('dialog', { name: 'Aperçu de « Refonte de la sidebar »' })
      await panel.getByText('Racine du projet').waitFor()
      await panel.getByText('#73').waitFor()
      await page.screenshot({ path: `${captures}apercu-doigt.png` })
      await panel.getByRole('link', { name: 'Ouvrir la session' }).tap()
      await panel.waitFor({ state: 'hidden' })
    } else {
      await chip.hover()
      const tooltip = page.getByRole('tooltip')
      await tooltip.getByText(/Dernier échange/).waitFor()
      await tooltip.getByText('Racine du projet').waitFor()
      await tooltip.getByText('Page projet').waitFor()
      await page.screenshot({ path: `${captures}apercu-survol.png`, clip: await tooltip.evaluate((node) => {
        const box = node.getBoundingClientRect()
        const anchor = document.querySelector('[data-thread]').getBoundingClientRect()
        const top = Math.min(box.top, anchor.top) - 8
        return { x: 0, y: Math.max(0, top), width: innerWidth, height: Math.max(box.bottom, anchor.bottom) - top + 16 }
      }) })
      await chip.click()
    }
    await page.waitForFunction((path) => window.location2 === path, `/p/${PROJECT}/c/${SIDEBAR}`)

    // « Insérer », sous le « + » : choisir une ligne écrit son préfixe au curseur et ouvre
    // la liste, comme la frappe. Pas de « $ » : ce CLI n'a publié aucun skill.
    await field.fill('Regarde ')
    await plus.click()
    if (touch) {
      await page.getByRole('dialog').getByRole('button', { name: /^Insérer/ }).tap()
      await page.getByRole('dialog').getByRole('button', { name: /^Une session/ }).waitFor()
      await page.screenshot({ path: `${captures}inserer-doigt.png` })
      assert.equal(await page.getByRole('dialog').getByRole('button', { name: /^Un skill/ }).count(), 0)
      await page.getByRole('dialog').getByRole('button', { name: /^Une session/ }).tap()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
    } else {
      await page.getByRole('menuitem', { name: /^Insérer/ }).hover()
      await page.getByRole('menuitem', { name: /^Une session/ }).waitFor()
      assert.deepEqual(
        await page.getByRole('menu').last().getByRole('menuitem').allTextContents(),
        ['Un fichier@', 'Une session@@', 'Une carte#', 'Une commande/'],
      )
      await page.screenshot({ path: `${captures}inserer-pointeur.png` })
      await page.getByRole('menuitem', { name: /^Une session/ }).click()
    }
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA')
    assert.equal(await field.inputValue(), 'Regarde @@')
    const list = page.getByRole('listbox', { name: 'Sessions de ce projet' })
    // Sans mot : les vivantes seulement, et pas la conversation où l'on écrit.
    assert.deepEqual((await list.getByRole('option').allTextContents()).map((text) => text.split('il y a')[0].trim()), ['Refonte de la sidebar'])
    // Une recherche trouve aussi les archivées, accents ignorés.
    await field.pressSequentially('ecartee')
    await list.getByRole('option', { name: /Ancienne piste écartée/ }).waitFor()
    await page.keyboard.press('Enter')
    assert.equal(await field.inputValue(), `Regarde session:${OLD} `)
    // La puce au-dessus du champ dit de quelle session il s'agit.
    await page.getByLabel('Sessions citées').getByRole('link', { name: 'Ancienne piste écartée' }).waitFor()

    // L'adresse d'un fil de ce projet part sous sa forme stable.
    await field.pressSequentially(`et ${origin}/p/${PROJECT}/c/${SIDEBAR}`)
    await page.getByLabel('Sessions citées').getByRole('link', { name: 'Refonte de la sidebar' }).waitFor()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.sent.length === 1)
    assert.deepEqual(await page.evaluate(() => window.sent), [`Regarde session:${OLD} et session:${SIDEBAR}`])

    // « Insérer » une commande la met en tête : le texte déjà écrit devient son argument.
    await field.fill('résume en trois points')
    await plus.click()
    if (touch) {
      await page.getByRole('dialog').getByRole('button', { name: /^Insérer/ }).tap()
      await page.getByRole('dialog').getByRole('button', { name: /^Une commande/ }).tap()
    } else {
      await page.getByRole('menuitem', { name: /^Insérer/ }).hover()
      await page.getByRole('menuitem', { name: /^Une commande/ }).click()
    }
    await page.getByRole('listbox', { name: /commande/i }).waitFor()
    assert.equal(await field.inputValue(), '/résume en trois points')
    await page.keyboard.press('Escape')

    // La largeur du fil suit le réglage, sans déborder de la place disponible.
    const width = () => markdown.evaluate((node) => node.getBoundingClientRect().width)
    assert.equal(await width(), Math.min(768, viewport.width - 32))
    await page.evaluate(() => document.documentElement.style.setProperty('--sg-conversation-width', '1200'))
    assert.equal(await width(), Math.min(1200, viewport.width - 32))

    assert.deepEqual(errors, [])
    console.log(`OK ${viewport.width}×${viewport.height}: rendered references, preview, Insert, @@, send, width`)
    await context.close()
  }
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  if (vite.exitCode === null) await once(vite, 'exit')
}
