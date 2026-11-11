import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './checks/browser.mjs'
import { viteDependency } from './checks/vite-deps.mjs'

// Le tiroir commun et la règle « un seul comportement de panneau par page » (TIR-1 à
// TIR-8), montés seuls : composants réels, sans daemon ni base.
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

/**
 * Une page de lieu réduite à l'essentiel : une rangée, puis la zone de contenu `relative`
 * qui porte le calque des tiroirs. `surface` dit si la page a un panneau (une
 * conversation) ou non (une vue de lieu).
 */
async function mount(page, surface) {
  // Les fournisseurs viennent des mêmes modules que les composants : voir `viteDependency`.
  const modules = {
    react: await viteDependency(origin, 'react', '/src/components/shell/Drawer.tsx'),
    reactDom: await viteDependency(origin, 'react-dom/client', '/src/main.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/shell/Drawer.tsx'),
  }
  await page.goto(origin)
  await page.evaluate(async ({ modules, surface }) => {
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
    const { Button, Menu, MenuItem, TooltipProvider } = await import(modules.ui)
    const { Drawer, DrawerLayer } = await import('/src/components/shell/Drawer.tsx')
    const { Detail } = await import('/src/components/shell/Detail.tsx')
    const { DetailSurfaceContext } = await import('/src/lib/detail-surface.ts')
    const { useEscapeLayer } = await import('/src/lib/escape-layers.ts')
    const h = React.createElement

    // Une autocomplétion `#` : une couche à elle, inscrite dans la pile.
    function Mention() {
      const [value, setValue] = React.useState('')
      const [open, setOpen] = React.useState(false)
      useEscapeLayer(open, () => setOpen(false))
      return h('div', { className: 'p-5' },
        h('input', { 'aria-label': 'Mention', className: 'w-full border border-line px-2 py-1', value, onChange: (event) => { setValue(event.target.value); setOpen(event.target.value.endsWith('#')) } }),
        open ? h('ul', { role: 'listbox', 'aria-label': 'Suggestions', className: 'border border-line' }, h('li', { role: 'option', 'aria-selected': false }, '#161')) : null)
    }

    function Page() {
      const [open, setOpen] = React.useState(false)
      const [detail, setDetail] = React.useState(false)
      const close = () => setOpen(false)
      const inside = h(React.Fragment, null,
        h('div', { className: 'flex items-center gap-2 p-5' },
          h(Menu, { trigger: h(Button, { size: 'sm' }, 'Plus') }, h(MenuItem, { onSelect: () => {} }, 'Copier le lien'))),
        h(Mention))
      return h('div', { className: 'flex h-dvh flex-col' },
        h('nav', { className: 'h-12 shrink-0 border-b border-line', 'aria-label': 'Rangée' }),
        h('div', { 'data-place-content': '', className: 'relative flex min-h-0 flex-1 flex-col overflow-clip md:flex-row' },
          h('div', { className: 'min-w-0 p-6 md:flex-1' },
            h(Button, { size: 'sm', onClick: () => setOpen(true) }, 'Ouvrir la fiche'),
            ' ',
            h(Button, { size: 'sm', onClick: () => setDetail(true) }, 'Ouvrir l’action')),
          surface === 'panel'
            ? h('aside', { 'data-panel': '', 'aria-label': 'Panneau', className: 'flex min-h-0 flex-1 flex-col border-line max-md:border-t md:w-80 md:flex-none md:border-l' },
                detail ? null : h('p', { className: 'p-3' }, 'Liste des actions'),
                h(Detail, { open: detail, onClose: () => setDetail(false), label: 'Action', title: 'Lancer les tests', back: 'Actions' }, h('p', { className: 'p-3' }, 'Détail de l’action')))
            : h(Detail, { open: detail, onClose: () => setDetail(false), label: 'Action', title: 'Lancer les tests', back: 'Actions' }, h('p', { className: 'p-3' }, 'Détail de l’action')),
          h(Drawer, { open, onClose: close, label: 'Carte #161', title: 'Tiroir commun', subtitle: '#161 · en cours' }, inside),
          h(DrawerLayer)))
    }

    createRoot(document.getElementById('check')).render(
      h(TooltipProvider, null, h(DetailSurfaceContext.Provider, { value: surface }, h(Page))))
  }, { modules, surface })
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
    const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: phone, isMobile: phone, serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
    await page.route(`${origin}/api/**`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await mount(page, 'drawer')

    const opener = page.getByRole('button', { name: 'Ouvrir la fiche', exact: true })
    const drawer = page.getByRole('dialog', { name: 'Carte #161' })
    const isFocused = (locator) => locator.evaluate((element) => element === document.activeElement || element.contains(document.activeElement))
    const settle = () => page.waitForTimeout(260)

    console.log(width, 'ouverture : le calque de la coque, la géométrie, le focus')
    await opener.click()
    await drawer.waitFor()
    await settle()
    assert.equal(await drawer.evaluate((element) => element.parentElement.id), 'drawer-layer', 'Le tiroir se pose dans le calque sous la rangée')
    const box = await drawer.boundingBox()
    const content = await page.locator('[data-place-content]').boundingBox()
    assert.equal(box.y, content.y, 'Sous la rangée')
    assert.equal(Math.round(box.y + box.height), Math.round(content.y + content.height), "Jusqu'en bas")
    assert.equal(Math.round(box.x + box.width), width, 'Contre le bord droit')
    assert.equal(Math.round(box.width), phone ? width : Math.min(576, width - 48), phone ? 'Plein écran au téléphone' : '36 rem')
    const style = await drawer.evaluate((element) => { const s = getComputedStyle(element); return { radius: s.borderRadius, border: s.borderLeftWidth, shadow: s.boxShadow } })
    assert.equal(style.radius, '0px')
    assert.equal(style.border, '1px')
    assert.notEqual(style.shadow, 'none', 'Le tiroir porte une ombre')
    assert.equal(await drawer.getByRole('heading', { name: 'Tiroir commun' }).isVisible(), true)
    assert.equal(await drawer.getByText('#161 · en cours').isVisible(), true)
    assert.ok(await isFocused(drawer), 'Le focus entre dans le tiroir')
    await page.screenshot({ path: `/tmp/shell-drawer-${width}.png` })

    console.log(width, '✕ ferme et rend le focus au déclencheur')
    await drawer.getByRole('button', { name: 'Fermer', exact: true }).click()
    await drawer.waitFor({ state: 'detached' })
    assert.ok(await isFocused(opener), 'Le focus revient au déclencheur')

    if (!phone) {
      console.log(width, 'un clic dehors ferme')
      await opener.click()
      await drawer.waitFor()
      await settle()
      await page.mouse.click(content.x + 40, content.y + 200)
      await drawer.waitFor({ state: 'detached' })
    }

    console.log(width, 'Échap : le menu Radix d’abord, le tiroir ensuite')
    await opener.click()
    await drawer.waitFor()
    await settle()
    await drawer.getByRole('button', { name: 'Plus', exact: true }).click()
    const menu = page.getByRole('menu')
    await menu.waitFor()
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    assert.equal(await drawer.isVisible(), true, 'Le menu ferme, pas le tiroir')
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'detached' })

    console.log(width, 'Échap : l’autocomplétion inscrite d’abord, le tiroir ensuite')
    await opener.click()
    await drawer.waitFor()
    await settle()
    await drawer.getByRole('textbox', { name: 'Mention' }).fill('voir #')
    const suggestions = page.getByRole('listbox', { name: 'Suggestions' })
    await suggestions.waitFor()
    await page.keyboard.press('Escape')
    await suggestions.waitFor({ state: 'detached' })
    assert.equal(await drawer.isVisible(), true, 'L’autocomplétion ferme, pas le tiroir')
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'detached' })

    console.log(width, 'page sans panneau : le détail s’ouvre dans le tiroir')
    await page.getByRole('button', { name: 'Ouvrir l’action', exact: true }).click()
    const action = page.getByRole('dialog', { name: 'Action' })
    await action.waitFor()
    await page.keyboard.press('Escape')
    await action.waitFor({ state: 'detached' })

    console.log(width, 'page avec panneau : le détail s’ouvre dans le panneau, en pile')
    await mount(page, 'panel')
    await page.getByRole('button', { name: 'Ouvrir l’action', exact: true }).click()
    const panel = page.getByRole('complementary', { name: 'Panneau' })
    await panel.getByText('Détail de l’action').waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0, 'Pas de tiroir à côté du panneau')
    assert.equal(await panel.getByText('Liste des actions').count(), 0, 'Le détail remplace la liste')
    await page.screenshot({ path: `/tmp/shell-panel-${width}.png` })
    await page.keyboard.press('Escape')
    await panel.getByText('Liste des actions').waitFor()
    await page.getByRole('button', { name: 'Ouvrir l’action', exact: true }).click()
    await panel.getByRole('button', { name: 'Actions' }).click()
    await panel.getByText('Liste des actions').waitFor()

    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('OK : calque, géométrie, en-tête, focus, ✕, clic dehors, Échap par couches (menu Radix, autocomplétion), détail en tiroir ou en pile ; ordinateur et téléphone.')
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  await once(vite, 'exit')
}
