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
 * « Lancés par les sessions » (AC-17), montés seuls avec les données de leurs stories :
 * un serveur vite lancé ici, des tests en surveillance et un Storybook au titre de session
 * très long lancés ailleurs, une surveillance de CI sans processus. Les tuiles du Lanceur
 * ont toutes la même hauteur et rien n'en déborde ; les lignes de la Liste et du panneau
 * tiennent à 390 px ; la ligne du panneau fait 36 px et ne porte pas la pastille de
 * cette session. Le parcours réel (scan, arrêt) est dans `services-ui-check.mjs`.
 *
 * Les captures vont hors du dépôt (`SESSION_WORKS_UI_OUTPUT`, par défaut sous ~/.cache),
 * une image par bloc.
 */
const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const output = process.env.SESSION_WORKS_UI_OUTPUT ?? join(homedir(), '.cache', 'solera-session-works')
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

const rect = (locator) => locator.evaluate((node) => {
  const box = node.getBoundingClientRect()
  return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height }
})

let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fetch(origin).then((response) => response.ok).catch(() => false)) { ready = true; break }
    await setTimeout(100)
  }
  assert.ok(ready, diagnostics || 'Vite failed to start')
  const importer = '/src/components/automations/session-works/SessionWorkTile.tsx'
  const modules = {
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/services.ts'),
    router: await viteDependency(origin, 'react-router-dom', importer),
    ui: await viteDependency(origin, '@solera/ui', importer),
  }
  browser = await launchBrowser()
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const wide = viewport.width > 700
    const page = await browser.newPage({ viewport, locale: 'fr-FR' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    // Rien ne doit partir : les requêtes sont préremplies.
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await page.route('**/__session_works_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><body><main id="check" style="padding:16px"></main></body></html>' }))
    await page.goto(`${origin}/__session_works_check`)
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
      const stories = await import('/src/components/automations/session-works/SessionWorks.stories.tsx')
      const { SeededSessionWorks } = await import('/src/components/automations/session-works/session-work-fixtures.tsx')
      const root = createRoot(document.getElementById('check'))
      let mounts = 0
      window.mount = (name) => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
        const story = stories[name]
        const args = { ...stories.default.args, ...story.args }
        const element = story.render ? story.render(args) : React.createElement(stories.default.component, args)
        root.render(
          React.createElement(QueryClientProvider, { client, key: ++mounts },
            React.createElement(TooltipProvider, null,
              React.createElement(MemoryRouter, null,
                React.createElement(SeededSessionWorks, null, element)))))
      }
      window.mount('Tuiles')
    }, modules)

    const check = page.locator('#check')
    const shot = (locator, name) => locator.screenshot({ path: join(output, `${name}-${viewport.width}.png`) })
    const noOverflow = async (what) =>
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${what} déborde à ${viewport.width}px`)

    // PRC-3 : les tuiles du Lanceur, une par processus, dans l'ordre des départs.
    const tiles = check.locator('article[data-session-work]')
    await tiles.first().waitFor({ timeout: 10_000 }).catch(async (error) => {
      throw new Error(`${error.message}\n${errors.join('\n')}\n${diagnostics}`)
    })
    assert.deepEqual(
      await tiles.locator('header .text-sm').allTextContents(),
      ['Storybook', 'Serveur vite', 'Tests (server) en surveillance', 'Surveiller la CI de la PR #118'],
    )
    await check.getByRole('heading', { name: 'Lancés par les sessions' }).waitFor()
    const vite = tiles.filter({ hasText: 'Serveur vite' })
    await vite.getByText(/^En marche · :5418 · depuis 47\s?min$/).waitFor()
    await vite.getByText('$ vite --port 5418 --strictPort').waitFor()
    await vite.getByRole('link', { name: 'Ouvrir :5418' }).waitFor()
    await tiles.filter({ hasText: 'Tests (server)' }).getByRole('button', { name: 'Arrêter « Tests (server) en surveillance »' }).waitFor()
    // Le gabarit : même hauteur partout, rien hors de la boîte, le geste en bas.
    const heights = new Set()
    for (const tile of await tiles.all()) {
      const box = await rect(tile)
      heights.add(Math.round(box.height))
      for (const part of await tile.locator('header, div, footer').all()) {
        const inner = await rect(part)
        assert.ok(inner.right <= box.right + 0.5 && inner.bottom <= box.bottom + 0.5, `déborde de sa tuile : ${await tile.textContent()}`)
      }
      const gesture = await rect(tile.locator('footer > *').first())
      assert.ok(gesture.bottom <= box.bottom - 8, 'le geste reste dans la tuile')
    }
    assert.deepEqual([...heights], [152], `hauteurs : ${[...heights]}`)
    // La charge et la mémoire passent dans le ⋯.
    await vite.getByRole('button', { name: 'Plus pour « Serveur vite »' }).click()
    for (const item of ['En faire une action', 'Aller à la session', 'Arrêter']) await page.getByRole('menuitem', { name: item, exact: true }).waitFor()
    await page.getByRole('menu').getByText('4 % · 182.0 Mo').waitFor()
    await page.keyboard.press('Escape')
    await noOverflow('le Lanceur')
    await shot(check.locator('section').first(), 'tuiles')

    // PRC-4 : la Liste.
    await page.evaluate(() => window.mount('Lignes'))
    const rows = check.locator('li[data-session-work]')
    await rows.first().waitFor()
    assert.equal(await rows.count(), 4)
    const row = rows.filter({ hasText: 'Serveur vite' })
    await row.getByText('$ vite --port 5418 --strictPort').waitFor()
    await row.getByRole('link', { name: 'Repenser la page projet' }).waitFor()
    await row.getByRole('button', { name: 'En faire une action' }).waitFor()
    await row.getByRole('button', { name: 'Arrêter « Serveur vite »' }).waitFor()
    await noOverflow('la Liste')
    await shot(check.locator('section').first(), 'lignes')

    // PRC-7 : le panneau, celui de cette session d'abord et sans pastille.
    await page.evaluate(() => window.mount('Panneau'))
    const lines = check.locator('li[data-session-work]')
    await lines.first().waitFor()
    await check.getByText('Processus des sessions').waitFor()
    const first = lines.first()
    await first.getByText('Serveur vite', { exact: true }).waitFor()
    assert.equal(await first.getByText('Repenser la page projet').count(), 0, 'pas de pastille pour cette session')
    // Une autre session : sa pastille ; sous 26 rem de ligne, l'icône du CLI seule.
    const pill = lines.filter({ hasText: 'Tests (server)' }).getByTitle('Lancé dans « Sessions autonomes confinées »')
    await pill.waitFor()
    assert.equal(await pill.getByText('Sessions autonomes confinées').isVisible(), wide)
    assert.equal(Math.round((await rect(first.locator('> div'))).height), wide ? 36 : 44)
    await first.getByRole('link', { name: ':5418' }).waitFor()
    const other = lines.filter({ hasText: 'Tests (server)' })
    await other.getByRole('button', { name: /^Tests \(server\) en surveillance/ }).click()
    await other.getByText('Lancé par « Sessions autonomes confinées »').waitFor()
    await other.getByText('$ pnpm --filter @nimbus/server test --watch').waitFor()
    await other.getByText(/La sortie ne remonte pas jusqu’ici/).waitFor()
    // Une session au titre très long : la pastille se tronque, la ligne garde sa hauteur.
    const long = lines.filter({ hasText: 'Storybook' })
    assert.equal(Math.round((await rect(long.locator('> div'))).height), wide ? 36 : 44)
    await noOverflow('le panneau')
    await shot(check.locator('section').first(), 'panneau')

    assert.deepEqual(errors, [])
    console.log(`OK : tuiles au gabarit, Liste, ligne de panneau (${viewport.width}px).`)
    await page.close()
  }
} finally {
  await browser?.close()
  vite.kill()
}
