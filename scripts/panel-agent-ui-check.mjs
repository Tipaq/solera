import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './checks/browser.mjs'
import { viteDependency } from './checks/vite-deps.mjs'

// L'onglet Agent du panneau d'une conversation (#228, PAG-1 à PAG-7 et PAG-12), monté
// seul : composants réels, API simulée, aucun CLI. Les gestes se vérifient par les
// requêtes qu'ils envoient et l'état du panneau qu'ils changent. Une capture par bloc,
// en 1280 et 390 px.
const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const captures = fileURLToPath(new URL('../docs/audits/2026-11-page-projet-v2/228-agent/', import.meta.url))
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

const HERE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROOT = '/srv/solera/apps/web/src'
const now = Date.now()
const MIN = 60_000

const tool = (id, name, input, parent, extra = {}) => ({
  kind: 'tool', id, ts: now - 2 * MIN, name, input, output: null, outputBytes: null, status: 'done', durationMs: 40, parentToolCallId: parent, ...extra,
})
const said = (id, parent, text) => ({
  kind: 'message', id, role: 'assistant', ts: now - MIN, seq: 0, blocks: [{ type: 'text', text }], streamingText: '', streamingThinking: '', parentToolCallId: parent,
})
const subAgent = (id, description, status, items, extra = {}) => ({
  id, type: 'Explore', description, status, startedAt: now - 2 * MIN, durationMs: null, activity: null, items,
  toolCount: items.filter((item) => item.kind === 'tool').length, totalTokens: 0, parentId: null, ...extra,
})

const RESULT = [
  'Le panneau Agent lit trois sources : les sous-agents, les travaux de fond et les tours qui ont écrit.',
  'Les sous-agents viennent des appels de spawn ; leur fil porte leur identifiant.',
  'Les travaux de fond viennent de la liste de niveau du CLI.',
  'Les écritures viennent des tours, chacune rattachée à son appel.',
  'Rien d’autre à signaler.',
].join('\n')

const explorer = subAgent('a1', 'Explorer le panneau', 'running', [
  tool('r1', 'Read', { file_path: `${ROOT}/components/panel/SidePanel.tsx` }, 'a1'),
  tool('e1', 'Edit', { file_path: `${ROOT}/components/panel/AgentsPane.tsx`, old_string: 'a\nb', new_string: 'a\nb\nc\nd' }, 'a1'),
  said('m1', 'a1', RESULT),
], { startedAt: now - 3 * MIN, totalTokens: 18_400 })
const reviewer = subAgent('a2', 'Relire les specs', 'done', [
  tool('w1', 'Write', { file_path: `${ROOT}/lib/agent-files.ts`, content: 'un\ndeux\ntrois' }, 'a2'),
  said('m2', 'a2', 'Les specs sont cohérentes.'),
], { startedAt: now - 10 * MIN, durationMs: 90_000 })
const cut = subAgent('a3', 'Chercher les clés i18n', 'interrupted', [], { startedAt: now - 8 * MIN })
const late = subAgent('a4', 'Mesurer la hauteur des lignes', 'running', [], { startedAt: now - MIN })
const AGENTS = [reviewer, explorer, cut, late]

const DEV = { id: 'k1', kind: 'local_bash', description: 'Serveur de dev', command: 'pnpm exec vite --port 5418', activity: null, lastTool: null, toolUses: 0, totalTokens: 0 }
const FLOW = { id: 'k2', kind: 'workflow', description: 'Revue des PR', command: null, activity: 'lit la PR #211', lastTool: 'Read', toolUses: 4, totalTokens: 12_000 }
const BACKGROUND = [DEV, FLOW]

const TURNS = [
  { id: 't1', ts: now - 9 * MIN, label: 'Réécrire le panneau', files: [
    { path: `${ROOT}/lib/panel.ts`, action: 'modified', toolCallIds: ['p1', 'p2'] },
    { path: `${ROOT}/components/panel/AgentsPane.tsx`, action: 'modified', toolCallIds: ['e1'] },
  ] },
  { id: 't2', ts: now - 4 * MIN, label: 'Les tests', files: [
    { path: `${ROOT}/lib/agent-files.ts`, action: 'created', toolCallIds: ['w1'] },
  ] },
]

/* ------------------------------------------------------------------ montage */

async function mount(page, props) {
  const modules = {
    react: await viteDependency(origin, 'react', '/src/components/panel/AgentsPane.tsx'),
    reactDom: await viteDependency(origin, 'react-dom/client', '/src/main.tsx'),
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/conversations.ts'),
    router: await viteDependency(origin, 'react-router-dom', '/src/components/automations/session-works/parts.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/panel/AgentsPane.tsx'),
  }
  await page.goto(`${origin}/__agent_check`)
  await page.evaluate(async ({ modules, props, here }) => {
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
    const { MemoryRouter } = await import(modules.router)
    const { TooltipProvider } = await import(modules.ui)
    const { FileLinkContext } = await import('/src/lib/file-links.ts')
    const { AgentsPane } = await import('/src/components/panel/AgentsPane.tsx')
    const panel = await import('/src/lib/panel.ts')
    const h = React.createElement
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    panel.setPanelOpen(true)
    window.opened = []
    function Harness() {
      window.panelTab = panel.usePanelTab()
      window.panelOpen = panel.usePanelOpen()
      panel.useActionEditRequest((seed) => { window.seed = seed })
      const selectedId = panel.useSelectedSubAgent()
      return h(FileLinkContext.Provider, { value: here },
        // Le fil principal : l'appel du sous-agent, pour « Dans le fil principal ».
        h('main', { className: 'flex-1 overflow-y-auto p-4' },
          h('div', { style: { height: '1400px' } }),
          h('div', { 'data-tool-id': 'a1', className: 'rounded border border-line p-2 text-sm' }, 'Agent · Explorer le panneau')),
        h('aside', { 'aria-label': 'Panneau', className: 'surface flex h-dvh w-[26rem] max-w-full flex-col border-l border-line' },
          h(AgentsPane, { conversationId: here, title: 'Onglet Agent', agent: 'claude', ...props, selectedId, onOpenFile: (path) => window.opened.push(path) })))
    }
    createRoot(document.getElementById('check')).render(h(QueryClientProvider, { client },
      h(MemoryRouter, { initialEntries: [`/c/${here}`] }, h(TooltipProvider, null, h(Harness)))))
  }, { modules, props, here: HERE })
}

async function routeApi(page, state) {
  await page.route('**/__agent_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check" class="flex h-dvh"></div></body></html>' }))
  await page.route('**/api/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      state.sent.push({ method: request.method(), path })
      return route.fulfill({ json: { ok: true } })
    }
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
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
    const open = async (props = { agents: AGENTS, background: BACKGROUND, editTurns: TURNS }) => {
      const page = await context.newPage()
      page.setDefaultTimeout(8000)
      const state = { sent: [], errors: [] }
      page.on('pageerror', (error) => state.errors.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error' && !/WebSocket|\[vite\]/.test(message.text())) state.errors.push(message.text()) })
      await routeApi(page, state)
      await mount(page, props)
      return { page, state, pane: page.getByRole('complementary', { name: 'Panneau' }) }
    }
    const shot = (locator, name) => locator.screenshot({ path: `${captures}impl-${width}-${name}.png` })
    const click = (locator) => (phone ? locator.tap() : locator.click())
    const back = (pane) => pane.getByRole('button', { name: 'Agent', exact: true })

    /* ------------------------------------------------------------ la liste */
    {
      const { page, state, pane } = await open()
      // PAG-1 : pas de ligne d'outils, « En cours » mêle sous-agents (du plus ancien) et travaux de fond.
      const running = pane.getByRole('region', { name: 'En cours' })
      await running.waitFor()
      assert.equal(await pane.locator('div.h-12').count(), 0, 'pas de ligne d’outils')
      const lines = running.getByRole('listitem')
      assert.equal(await lines.count(), 4)
      assert.match(await lines.nth(0).textContent(), /Explorer le panneau.*3 min · 2 outils/)
      assert.match(await lines.nth(1).textContent(), /Mesurer la hauteur des lignes.*1 min/)
      assert.match(await lines.nth(2).textContent(), /Serveur de dev/)
      assert.match(await lines.nth(3).textContent(), /Revue des PR.*4 outils/)
      // PAG-2 : une ligne de 36 px (44 au doigt), le point qui bat.
      const height = (await lines.nth(0).getByRole('button').boundingBox()).height
      assert.equal(Math.round(height), phone ? 44 : 36)
      assert.equal(await lines.nth(0).locator('.animate-pulse, [class*="animate-pulse"]').count(), 1)
      // PAG-4 : les terminés, repliés en une ligne.
      const toggle = pane.getByRole('button', { name: /^2 terminés/ })
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      await shot(pane.locator('div.overflow-y-auto').first(), 'liste')

      // PAG-3 : au survol, « Ouvrir :5418 » remplace la méta.
      const dev = lines.nth(2)
      if (!phone) await dev.hover()
      const openPort = dev.getByRole('link', { name: /Ouvrir :5418/ })
      await openPort.waitFor()
      assert.equal(await openPort.getAttribute('href'), 'http://localhost:5418')
      await shot(running, 'en-cours-survol')

      await click(toggle)
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
      await pane.getByRole('button', { name: /Relire les specs.*2 min · 1 outil/ }).waitFor()
      await pane.getByRole('button', { name: /Chercher les clés i18n.*arrêté/ }).waitFor()
      await shot(pane.locator('div.overflow-y-auto').first(), 'termines')

      // PAG-5 : le pied « Modifié par la session », déplié.
      const footer = pane.getByRole('button', { name: 'Modifié par la session · 3 fichiers' })
      assert.equal(await footer.getAttribute('aria-expanded'), 'false')
      await click(footer)
      const files = footer.locator('xpath=..').getByRole('listitem')
      assert.equal(await files.count(), 3)
      assert.match(await files.nth(0).textContent(), /panel\.ts.*agent principal.*2 passes/)
      assert.match(await files.nth(1).textContent(), /AgentsPane\.tsx.*Explorer le panneau.*\+4.*−2/)
      assert.match(await files.nth(2).textContent(), /agent-files\.ts.*Relire les specs.*\+3.*−0/)
      await shot(footer.locator('xpath=..'), 'pied')
      // Le nom ouvre le fichier, l'icône mène au diff dans Git.
      await click(files.nth(1).getByRole('button', { name: /AgentsPane\.tsx/ }))
      assert.deepEqual(await page.evaluate(() => window.opened), [`${ROOT}/components/panel/AgentsPane.tsx`])
      if (!phone) await files.nth(1).hover()
      await click(files.nth(1).getByRole('button', { name: 'Diff de AgentsPane.tsx dans Git' }))
      await page.waitForFunction(() => window.panelTab === 'git')

      assert.deepEqual(state.errors, [])
      await noOverflow(pane)
      await page.close()
    }

    /* ------------------------------------------------------ un sous-agent */
    {
      const { page, state, pane } = await open()
      await click(pane.getByRole('button', { name: /Explorer le panneau/ }))
      // PAG-6 : « ‹ Agent », type · travaille depuis… · outils · tokens.
      await back(pane).waitFor()
      await pane.getByText('Explore · travaille depuis 3 min · 2 outils · 18.4 k tokens').waitFor()
      const filesBlock = pane.getByRole('region', { name: 'Fichiers modifiés' })
      assert.match(await filesBlock.textContent(), /Fichiers modifiés\s*1\s*AgentsPane\.tsx\s*\+4 −2/)
      await shot(filesBlock, 'sous-agent-fichiers')
      // Le résultat : trois lignes, « Tout lire » / « Replier ».
      const result = pane.getByRole('region', { name: 'Résultat' })
      const text = result.locator('p').first()
      assert.match(await text.getAttribute('class'), /line-clamp-3/)
      await shot(result, 'sous-agent-resultat')
      await click(result.getByRole('button', { name: 'Tout lire' }))
      assert.doesNotMatch(await text.getAttribute('class'), /line-clamp-3/)
      await result.getByRole('button', { name: 'Replier' }).waitFor()
      // Son fil, rendu par ChatThread.
      const thread = pane.getByRole('region', { name: 'Son fil' })
      await thread.getByText('Rien d’autre à signaler.', { exact: false }).waitFor()
      await shot(pane, 'sous-agent')

      // Copier le résultat : le presse-papiers le reçoit.
      await click(pane.getByRole('button', { name: 'Copier le résultat' }))
      await pane.getByRole('status').filter({ hasText: 'Résultat copié.' }).waitFor()
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), RESULT)

      // Dans le fil principal : l'appel est rendu, il défile jusqu'à lui ; en feuille, le panneau s'écarte.
      await click(pane.getByRole('button', { name: 'Dans le fil principal' }))
      await page.waitForFunction(() => {
        const node = document.querySelector('[data-tool-id="a1"]').getBoundingClientRect()
        return node.top >= 0 && node.bottom <= window.innerHeight
      })
      if (phone) await page.waitForFunction(() => window.panelOpen === false)

      // Interrompre la session : la vraie route, avec l'explication en infobulle.
      const interrupt = pane.getByRole('button', { name: 'Interrompre la session' })
      assert.match(await interrupt.getAttribute('title'), /c’est toute la session qui s’interrompt/)
      await click(interrupt)
      await assertSent(state, { method: 'POST', path: `/api/conversations/${HERE}/interrupt` })

      // Échap remonte à la liste.
      await page.keyboard.press('Escape')
      await pane.getByRole('region', { name: 'En cours' }).waitFor()
      assert.deepEqual(state.errors, [])
      await page.close()
    }

    /* ------------------------------------------- un sous-agent fini, sans rien */
    {
      const { page, pane } = await open({ agents: [cut], background: [], editTurns: [] })
      await click(pane.getByRole('button', { name: /^1 terminé/ }))
      await click(pane.getByRole('button', { name: /Chercher les clés i18n/ }))
      await pane.getByText('Il n’a rien écrit.').waitFor()
      await pane.getByText('Aucun texte rendu à l’agent principal.').waitFor()
      assert.equal(await pane.getByRole('button', { name: 'Copier le résultat' }).isDisabled(), true)
      assert.equal(await pane.getByRole('button', { name: 'Interrompre la session' }).count(), 0, 'pas d’interruption pour un sous-agent arrêté')
      // L'appel n'est pas rendu dans le fil : une explication.
      await page.evaluate(() => document.querySelector('[data-tool-id]').remove())
      await click(pane.getByRole('button', { name: 'Dans le fil principal' }))
      await pane.getByRole('status').filter({ hasText: 'L’appel n’est pas rendu dans le fil' }).waitFor()
      await click(back(pane))
      await pane.getByText('Rien ne tourne.').waitFor()
      await shot(pane, 'vide')
      await page.close()
    }

    /* ---------------------------------------------------- un travail de fond */
    {
      const { page, state, pane } = await open()
      await click(pane.getByRole('button', { name: /Serveur de dev/ }))
      // PAG-7 : ce qu'on en sait.
      await back(pane).waitFor()
      await pane.getByText('travail de fond · en cours').waitFor()
      const facts = pane.locator('dl')
      assert.equal(await facts.textContent(), 'Naturecommande de fondÀ l’instantrien d’annoncéCommandepnpm exec vite --port 5418Port:5418')
      await pane.getByText('Sa sortie ne remonte pas jusqu’à Solera.').waitFor()
      await shot(pane, 'travail')
      // Arrêter : la vraie route.
      await click(pane.getByRole('button', { name: 'Arrêter' }))
      await assertSent(state, { method: 'POST', path: `/api/conversations/${HERE}/background/k1/stop` })
      assert.equal(await pane.getByRole('button', { name: 'Arrêter' }).isDisabled(), true)
      // Ouvrir :port passe par la vue Web du panneau.
      await click(pane.getByRole('link', { name: /Ouvrir :5418/ }))
      await page.waitForFunction(() => window.panelTab === 'web')
      // PAG-12 : En faire une action → l'onglet Actions, l'éditeur pré-rempli.
      await click(pane.getByRole('button', { name: 'En faire une action' }))
      await page.waitForFunction(() => window.panelTab === 'actions' && window.seed)
      const seed = await page.evaluate(() => window.seed)
      assert.deepEqual(seed.preset, { what: 'command', kind: 'service' })
      assert.equal(seed.prefill.command, 'pnpm exec vite --port 5418')
      assert.match(seed.prefill.description, /Onglet Agent/)
      // Échap remonte.
      await page.keyboard.press('Escape')
      await pane.getByRole('region', { name: 'En cours' }).waitFor()
      assert.deepEqual(state.errors, [])
      await page.close()
    }

    /* ----------------------------------- un CLI qui n'arrête pas ses travaux */
    {
      const { page, pane } = await open({ agents: [], background: [FLOW], editTurns: [], agent: 'codex' })
      await click(pane.getByRole('button', { name: /Revue des PR/ }))
      assert.match(await pane.locator('dl').textContent(), /Natureworkflow.*À l’instantlit la PR #211.*Outils4.*Tokens12\.0 k/)
      assert.equal(await pane.getByRole('button', { name: 'Arrêter' }).count(), 0, 'pas de geste qui ne ferait rien')
      assert.equal(await pane.getByRole('link', { name: /Ouvrir :/ }).count(), 0)
      await shot(pane, 'travail-sans-arret')
      await page.close()
    }

    console.log(`OK ${width} : PAG-1 à PAG-7, PAG-12`)
    await context.close()
  }
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  if (vite.exitCode === null) await once(vite, 'exit')
}

/** Attend qu'une écriture soit partie. */
async function assertSent(state, expected) {
  for (let i = 0; i < 50; i++) {
    if (state.sent.some((entry) => entry.method === expected.method && entry.path === expected.path)) return
    await delay(100)
  }
  assert.fail(`Écriture attendue : ${JSON.stringify(expected)}\nEnvoyées : ${JSON.stringify(state.sent)}`)
}

/** Rien ne déborde du panneau en largeur. */
async function noOverflow(pane) {
  const overflow = await pane.evaluate((node) => [...node.querySelectorAll('*')].some((child) => child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).overflowX === 'visible' && child.getBoundingClientRect().right > node.getBoundingClientRect().right + 1))
  assert.equal(overflow, false, 'le panneau déborde en largeur')
}
