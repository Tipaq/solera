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
 * La barre d'outils sur une ligne (BAR-1 à BAR-7), montée seule avec la page de
 * démonstration de sa story : une seule ligne en 1280 et 390 px, même avec des puces qui
 * débordent ; recherche qui s'élargit ; « Filtrer » qui compte et reste ouvert pendant
 * qu'on coche ; « Effacer tous les filtres » ; « Affichage » et sa mémoire de vue
 * (adresse, puis projet, puis première).
 *
 * Les captures vont hors du dépôt (`TOOLBAR_UI_OUTPUT`, par défaut sous ~/.cache), une
 * image par bloc.
 */
const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const output = process.env.TOOLBAR_UI_OUTPUT ?? join(homedir(), '.cache', 'solera-toolbar')
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

const box = (locator) => locator.evaluate((node) => {
  const rect = node.getBoundingClientRect()
  return { top: Math.round(rect.top), height: Math.round(rect.height), width: Math.round(rect.width), center: Math.round(rect.top + rect.height / 2) }
})

let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fetch(origin).then((response) => response.ok).catch(() => false)) { ready = true; break }
    await setTimeout(100)
  }
  assert.ok(ready, diagnostics || 'Vite failed to start')
  const modules = {
    router: await viteDependency(origin, 'react-router-dom', '/src/lib/use-view.ts'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/toolbar/ToolbarMenus.tsx'),
  }
  browser = await launchBrowser()
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const narrow = viewport.width < 768
    const page = await browser.newPage({ viewport, locale: 'fr-FR' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/__toolbar_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><body><main id="check"></main></body></html>' }))
    await page.goto(`${origin}/__toolbar_check`)
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
      const { MemoryRouter, useLocation } = await import(modules.router)
      const { TooltipProvider } = await import(modules.ui)
      const { ToolbarDemo } = await import('/src/components/toolbar/OneLineToolbar.stories.tsx')

      function Location() {
        return React.createElement('output', { id: 'location' }, useLocation().search)
      }
      const root = createRoot(document.getElementById('check'))
      let mounts = 0
      // Un nouveau montage, comme une page rechargée : l'adresse donnée, la mémoire gardée.
      window.mount = (entry, initial = []) => root.render(
        React.createElement(MemoryRouter, { key: ++mounts, initialEntries: [entry] },
          React.createElement(TooltipProvider, null,
            React.createElement(ToolbarDemo, { initial }),
            React.createElement(Location))))
      window.mount('/')
    }, modules)

    const toolbar = page.locator('[data-toolbar]')
    await toolbar.waitFor()
    const search = toolbar.getByRole('searchbox')
    const filter = toolbar.getByRole('button', { name: /^Filtrer/ })
    const display = toolbar.getByRole('button', { name: /^Affichage : / })
    const displayName = () => display.getAttribute('aria-label')
    const action = toolbar.getByRole('button', { name: 'Carte' })

    // BAR-1 / BAR-3 : une ligne de 48 px, les boutons à la hauteur de `Button size="sm"`.
    const oneLine = async (when) => {
      assert.equal((await box(toolbar)).height, 48, `${when} : hauteur de la barre`)
      const controls = await Promise.all([search.locator('xpath=..'), filter, display, action].map(box))
      assert.equal(new Set(controls.map((c) => c.center)).size, 1, `${when} : tout sur une ligne ${JSON.stringify(controls)}`)
      assert.equal(new Set(controls.map((c) => c.height)).size, 1, `${when} : hauteurs ${controls.map((c) => c.height)}`)
      assert.equal(controls[0].height, narrow ? 44 : 36, `${when} : hauteur des boutons`)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${when} : la barre déborde`)
    }
    await oneLine('au repos')
    await toolbar.screenshot({ path: join(output, `barre-repos-${viewport.width}.png`) })

    // BAR-2 : la recherche s'élargit au focus et quand elle a du texte, ✕ l'efface.
    const field = search.locator('xpath=..')
    const rest = (await box(field)).width
    await search.focus()
    // Au large, 224 px ; au téléphone, toute la place que les puces lui laissent.
    await page.waitForFunction((narrow) => {
      const label = document.querySelector('[data-toolbar] label').getBoundingClientRect()
      const chips = document.querySelector('[data-toolbar-chips]').getBoundingClientRect()
      return narrow ? chips.width === 0 : label.width === 224
    }, narrow)
    await search.fill('jalon')
    await page.locator('#check').getByText('« jalon »').waitFor()
    await page.mouse.click(viewport.width - 5, viewport.height - 5)
    await setTimeout(300)
    // Au téléphone, elle a déjà toute la place au repos : elle la garde, sans descendre
    // sous ce qu'il faut pour lire ce qu'on tape.
    if (narrow) assert.ok(rest >= 96 && (await box(field)).width >= rest, `largeur au téléphone : ${rest}`)
    else assert.ok((await box(field)).width > rest, 'garde sa largeur quand elle a du texte')
    await oneLine('recherche remplie')
    await toolbar.getByRole('button', { name: 'Effacer la recherche' }).click()
    assert.equal(await search.inputValue(), '')
    await setTimeout(300)
    assert.equal((await box(field)).width, rest, 'revient à sa largeur de repos')

    // BAR-4 : « Filtrer » reste ouvert pendant qu'on coche, compte, et efface tout.
    await filter.click()
    const filters = page.getByRole('dialog', { name: 'Filtrer' })
    await filters.waitFor()
    for (const name of [/#157/, /#200/, /T’attend/, /À préciser/]) await filters.getByRole('checkbox', { name }).click()
    assert.equal(await filters.getByRole('checkbox', { checked: true }).count(), 4, 'toujours ouvert, quatre coches')
    await filters.screenshot({ path: join(output, `filtrer-${viewport.width}.png`) })
    await page.keyboard.press('Escape')
    await filters.waitFor({ state: 'detached' })
    assert.equal((await filter.textContent()).replace(/\s/g, ''), 'Filtrer4')

    // BAR-5 : quatre puces, qui défilent de côté au téléphone sans passer à la ligne.
    const chips = toolbar.locator('[data-toolbar-chips]')
    assert.equal(await chips.getByRole('button', { name: 'Retirer ce filtre' }).count(), 4)
    await oneLine('quatre puces')
    if (narrow) {
      // La recherche vide se replie sur sa loupe pour laisser la place aux puces.
      assert.equal((await box(field)).width, 44, 'recherche repliée au téléphone')
      assert.ok(await chips.evaluate((node) => node.scrollWidth > node.clientWidth), 'les puces défilent')
    }
    await toolbar.screenshot({ path: join(output, `barre-puces-${viewport.width}.png`) })
    await chips.getByRole('button', { name: 'Retirer ce filtre' }).first().click()
    assert.equal((await filter.textContent()).replace(/\s/g, ''), 'Filtrer3')
    await filter.click()
    await filters.getByRole('button', { name: 'Effacer tous les filtres' }).click()
    assert.equal(await filters.getByRole('checkbox', { checked: true }).count(), 0)
    assert.equal(await filters.getByRole('button', { name: 'Effacer tous les filtres' }).count(), 0, 'le pied part avec le dernier filtre')
    await page.keyboard.press('Escape')
    assert.equal(await chips.locator('*').count(), 0)

    // BAR-6 : « Affichage » — vues en tuiles, la vue courante dans l'infobulle.
    assert.equal(await displayName(), 'Affichage : Kanban')
    assert.equal(await display.getByText('Affichage', { exact: true }).isVisible(), !narrow, 'libellé tu au téléphone')
    await display.click()
    const panel = page.getByRole('dialog', { name: 'Affichage' })
    await panel.getByRole('radio', { name: 'Liste' }).click()
    // Reste ouvert sur la vue choisie : on règle en regardant la page changer.
    await panel.getByRole('radio', { name: 'Liste', checked: true }).waitFor()
    await panel.getByRole('radio', { name: 'Couloirs par jalon' }).click()
    await panel.screenshot({ path: join(output, `affichage-${viewport.width}.png`) })
    await page.keyboard.press('Escape')
    assert.equal(await displayName(), 'Affichage : Liste')

    // BAR-7 : la vue s'écrit dans l'adresse et dans la mémoire du projet…
    assert.equal(await page.locator('#location').textContent(), '?vue=liste')
    assert.equal(await page.evaluate(() => localStorage.getItem('solera.view.demo.p1')), 'liste')
    // …revient sans adresse par la mémoire…
    await page.evaluate(() => window.mount('/'))
    await page.locator('[data-view="liste"]').waitFor()
    // …et cède à un lien partagé ; une vue inconnue retombe sur la mémoire.
    await page.evaluate(() => window.mount('/?vue=geste'))
    await page.locator('[data-view="geste"]').waitFor()
    await page.evaluate(() => window.mount('/?vue=gantt'))
    await page.locator('[data-view="liste"]').waitFor()
    await page.evaluate(() => { localStorage.removeItem('solera.view.demo.p1'); window.mount('/') })
    await page.locator('[data-view="kanban"]').waitFor()

    assert.deepEqual(errors, [])
    console.log(`OK : barre sur une ligne, recherche, Filtrer, puces, Affichage et mémoire de vue (${viewport.width}px).`)
    await page.close()
  }
} finally {
  await browser?.close()
  vite.kill()
}
