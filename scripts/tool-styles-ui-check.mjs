import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { launchBrowser } from './checks/browser.mjs'
import { viteDependency } from './checks/vite-deps.mjs'

/*
 * Les six présentations des outils, sur les vrais composants et une API simulée :
 * même hauteur de ligne pour toutes les origines, compteurs et échecs lisibles, pas de
 * débordement au téléphone, choix enregistré sur le compte, et une suite qui ne se
 * replie qu'au texte suivant, jamais pendant qu'on lit plus haut.
 *
 * Les captures vont hors du dépôt (`TOOL_STYLES_UI_OUTPUT`, par défaut sous ~/.cache) :
 * elles servent à relire, pas à versionner.
 */
const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const output = process.env.TOOL_STYLES_UI_OUTPUT ?? join(homedir(), '.cache', 'solera-tool-styles')
await mkdir(output, { recursive: true })
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise((resolve) => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const vite = spawn(process.execPath, [web + 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: web, stdio: 'pipe',
})
let diagnostics = ''
vite.stderr.on('data', (chunk) => { diagnostics += chunk.toString() })
vite.stdout.resume()

const STYLES = [
  ['inline', 'Lignes discrètes'], ['timeline', 'Chronologie'], ['intent', 'Par intention'],
  ['cards', 'Aperçus'], ['console', 'Console'], ['classic', 'Classique'],
]

let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fetch(origin).then((response) => response.ok).catch(() => false)) { ready = true; break }
    await setTimeout(100)
  }
  assert.ok(ready, diagnostics || 'Vite failed to start')
  const modules = {
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/tool-output.ts'),
    router: await viteDependency(origin, 'react-router-dom', '/src/components/chat/MessageBubble.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/chat/ChatThread.tsx'),
  }
  browser = await launchBrowser()
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, locale: 'fr-FR' })
    const errors = []
    const patches = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/**', async (route) => {
      const request = route.request()
      if (request.method() === 'PATCH') patches.push(request.postDataJSON())
      // Un compte qui n'a encore rien enregistré : la synchronisation pousse l'état local.
      const body = request.url().endsWith('/api/me/settings') && request.method() === 'GET' ? '{"appearance":null}' : '{"ok":true}'
      await route.fulfill({ status: 200, contentType: 'application/json', body })
    })
    await page.route('**/__tool_styles_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><body><main id="check"></main></body></html>' }))
    await page.goto(`${origin}/__tool_styles_check`)
    await page.evaluate(async (modules) => {
      const refresh = (await import('/@react-refresh')).default
      refresh.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
      document.documentElement.dataset.theme = 'dark'
      localStorage.setItem('solera.locale', 'fr')
      await (await import('/src/lib/i18n/index.ts')).initLocale()
      await import('/src/styles/index.css')
      const React = (await import('/node_modules/.vite/deps/react.js')).default
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
      const { QueryClient, QueryClientProvider } = await import(modules.query)
      const { MemoryRouter } = await import(modules.router)
      const { TooltipProvider } = await import(modules.ui)
      const { ChatThread } = await import('/src/components/chat/ChatThread.tsx')
      const { ToolStyleControls } = await import('/src/components/ToolStyleControls.tsx')
      const { useAppearanceSync } = await import('/src/lib/appearance-sync.ts')
      const { buildRows } = await import('/src/lib/tool-rows.ts')

      const tool = (id, name, input, extra = {}) => ({ kind: 'tool', id, name, ts: 0, input, output: 'Sortie de ' + id, outputBytes: null, status: 'done', durationMs: 120, parentToolCallId: null, ...extra })
      const message = (id, text) => ({ kind: 'message', id, role: 'assistant', ts: 0, seq: 1, blocks: [{ type: 'text', text }], streamingText: '', streamingThinking: '', parentToolCallId: null })
      const history = Array.from({ length: 8 }, (_, i) => message('h' + i, 'Message antérieur ' + i + '. ' + 'Un paragraphe à relire. '.repeat(12)))
      const tools = [
        tool('solera', 'mcp__solera__read_card', { card_number: 104 }),
        tool('mcp', 'github/issue_read', { number: 58 }, { presentation: { origin: 'mcp', label: 'Lire le ticket' } }),
        tool('edit', 'Edit', { file_path: 'src/legacy.ts', old_string: 'garde\navant\nfin', new_string: 'garde\naprès\nen plus\nfin' }),
        tool('patch', 'Edit', { changes: [{ path: 'apps/web/src/components/chat/ToolCall.tsx', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-avant\n+après' }] }),
        tool('write', 'Write', { file_path: 'src/neuf.ts', content: 'un\ndeux\ntrois\n' }),
        tool('failed', 'Bash', { command: 'pnpm test' }, { status: 'failed', output: 'Un test échoue.' }),
        tool('titled', 'Bash', { command: 'pnpm typecheck' }, { presentation: { title: 'Vérifier les types' } }),
        tool('parsed', 'Bash', { command: '/bin/zsh -lc "cat src/a.ts"', commandActions: [{ type: 'read', path: 'src/a.ts', name: 'a.ts' }] }),
        tool('web', 'WebSearch', { query: '' }, { output: { query: "'stream-json'", action: { type: 'findInPage', url: null, pattern: 'stream-json' }, results: [] } }),
        tool('active', 'Read', { file_path: 'src/App.tsx' }, { status: 'running', durationMs: null, output: null }),
      ]
      window.items = { running: [...history, ...tools], done: [...history, ...tools.map((t) => t.status === 'running' ? { ...t, status: 'done', durationMs: 40 } : t)] }

      function Screen() {
        useAppearanceSync()
        const [items, setItems] = React.useState(window.items.running)
        const [following, setFollowing] = React.useState(true)
        const scroller = React.useRef(null)
        window.setItems = setItems
        window.setFollowing = setFollowing
        const rows = buildRows(items, null, true)
        return React.createElement('div', { className: 'mx-auto flex h-dvh max-w-3xl flex-col gap-3 p-3' },
          React.createElement('details', { id: 'settings' }, React.createElement('summary', null, 'Apparence'), React.createElement(ToolStyleControls)),
          React.createElement('div', { id: 'thread', ref: scroller, className: 'min-h-0 flex-1 overflow-y-auto' },
            React.createElement('div', { className: 'flex flex-col gap-3' }, React.createElement(ChatThread, { rows, conversationId: 'fixture', mayCollapseTools: following }))))
      }
      createRoot(document.getElementById('check')).render(
        React.createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          React.createElement(MemoryRouter, null, React.createElement(TooltipProvider, null, React.createElement(Screen)))))
    }, modules)

    const thread = page.locator('#thread')
    await thread.locator('[data-tool-id="active"][data-tool-status="running"]').waitFor()
    await page.locator('#settings summary').click()
    for (const [style, label] of STYLES) {
      await page.getByRole('radio', { name: new RegExp(`^${label}`) }).click()
      await thread.locator(`[data-tool-style="${style}"]`).first().waitFor()
      // Toutes les origines, compteurs et échecs tiennent dans la même hauteur de ligne.
      const heights = await thread.locator('[data-tool-id] > button[aria-expanded]').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)))
      assert.equal(new Set(heights).size, 1, `${style} : hauteurs ${heights}`)
      assert.ok(heights[0] >= 32 && heights[0] <= 36, `${style} : ${heights[0]}px`)
      assert.equal(await thread.locator('[data-tool-id="solera"][data-tool-origin="solera"]', { hasText: 'Lire une carte' }).count(), 1, style)
      assert.equal(await thread.locator('[data-tool-id="mcp"][data-tool-origin="mcp"]', { hasText: 'Lire le ticket' }).count(), 1, style)
      assert.equal(await thread.locator('[data-tool-id="edit"] [role="img"][aria-label^="Extrait modifié"]').textContent(), '+2−1')
      assert.equal(await thread.locator('[data-tool-id="write"] [role="img"][aria-label^="Lignes écrites"]').textContent(), '+3')
      await thread.locator('[data-tool-id="failed"]', { hasText: 'Échec' }).waitFor()
      await thread.locator('[data-tool-id="titled"]', { hasText: 'Vérifier les types' }).waitFor()
      await thread.locator('[data-tool-id="parsed"]', { hasText: 'Lire src/a.ts' }).waitFor()
      await thread.locator('[data-tool-id="web"]', { hasText: 'stream-json' }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${style} : le fil déborde`)
      // Réglages refermés : leur aperçu ne recouvre pas le fil sur la capture.
      await page.locator('#settings summary').click()
      await thread.evaluate((node) => { node.scrollTop = node.scrollHeight })
      await thread.locator('[data-tool-sequence]').first().screenshot({ path: join(output, `${style}-${viewport.width}.png`) })
      await page.locator('#settings summary').click()
    }
    // Le choix part sur le compte, et reste dans le cache local.
    await page.waitForFunction(() => localStorage.getItem('solera.toolStyle') === 'classic')
    for (let attempt = 0; attempt < 40 && !patches.some((patch) => patch?.appearance?.toolStyle === 'classic'); attempt++) await setTimeout(100)
    assert.ok(patches.some((patch) => patch?.appearance?.toolStyle === 'classic'), 'le style part sur le compte')

    // Le détail d'un appel garde le nom brut du CLI derrière son libellé.
    await thread.locator('[data-tool-id="solera"] > button').click()
    await thread.getByText('Outil : mcp__solera__read_card', { exact: true }).waitFor()
    await thread.locator('[data-tool-id="solera"] > button').click()

    // Pendant qu'on lit plus haut, la suite close ne se replie pas…
    await page.evaluate(() => {
      window.setFollowing(false)
      window.setItems([...window.items.done, { kind: 'message', id: 'answer', role: 'assistant', ts: 0, seq: 2, blocks: [{ type: 'text', text: 'Corrigé, les tests passent.' }], streamingText: '', streamingThinking: '', parentToolCallId: null }])
    })
    await thread.getByText('Corrigé, les tests passent.').waitFor()
    assert.equal(await thread.locator('[data-tool-sequence][data-folded="true"]').count(), 0, 'repliée pendant la lecture')
    // …et se replie quand on revient au bas, derrière une ligne qui garde l'échec en vue.
    await page.evaluate(() => window.setFollowing(true))
    await thread.locator('[data-tool-sequence][data-folded="true"]').waitFor()
    await thread.locator('[data-tool-sequence][data-folded="true"]', { hasText: '10 outils' }).waitFor()
    await thread.locator('[data-tool-sequence][data-folded="true"]', { hasText: '1 échec' }).waitFor()
    await page.locator('#settings summary').click()
    await thread.locator('[data-tool-sequence]').first().screenshot({ path: join(output, `folded-${viewport.width}.png`) })
    // Déplié à la main, il reste déplié : un nouvel envoi de lignes ne le referme pas.
    await thread.locator('[data-tool-sequence] > button[aria-expanded="false"]').click()
    await page.evaluate(() => window.setItems((items) => [...items]))
    await setTimeout(100)
    assert.equal(await thread.locator('[data-tool-sequence][data-folded="true"]').count(), 0, 'refermé après une ouverture manuelle')

    assert.deepEqual(errors, [])
    console.log(`OK : six présentations des outils, origines, compteurs, échecs, choix enregistré et repli à la reprise du texte (${viewport.width}px).`)
    await page.close()
  }
} finally {
  await browser?.close()
  vite.kill()
}
