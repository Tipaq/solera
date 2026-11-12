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
    const { Button, ConfirmDialog, Menu, MenuItem, TooltipProvider } = await import(modules.ui)
    const { PanelFocus } = await import('/src/components/PanelFocus.tsx')
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
      const [editor, setEditor] = React.useState(false)
      const [detail, setDetail] = React.useState(false)
      const [tools, setTools] = React.useState(false)
      const [confirm, setConfirm] = React.useState(false)
      const close = () => setOpen(false)
      const inside = h(React.Fragment, null,
        h('div', { className: 'flex items-center gap-2 p-5' },
          h(Menu, { trigger: h(Button, { size: 'sm' }, 'Plus') }, h(MenuItem, { onSelect: () => {} }, 'Copier le lien')),
          h(Button, { size: 'sm', onClick: () => setConfirm(true) }, 'Supprimer')),
        h(ConfirmDialog, { open: confirm, onOpenChange: setConfirm, title: 'Supprimer la carte ?', confirmLabel: 'Supprimer', onConfirm: () => setConfirm(false) }, 'La carte disparaît du tableau.'),
        h(Mention))
      // Un panneau ancré, comme le panneau git d'un lieu : sous le calque des tiroirs.
      const anchored = tools
        ? h(PanelFocus, { open: true, modal: false, onClose: () => setTools(false) },
            h('aside', { 'aria-label': 'Outils', className: 'absolute inset-y-0 right-0 z-20 border-l border-line bg-canvas p-3', style: { width: 'min(24rem, 50%)' } }, 'Panneau git'))
        : null
      return h('div', { className: 'flex h-dvh flex-col' },
        h('nav', { className: 'h-12 shrink-0 border-b border-line', 'aria-label': 'Rangée' }),
        h('div', { 'data-place-content': '', className: 'relative flex min-h-0 flex-1 flex-col overflow-clip md:flex-row' },
          h('div', { className: 'min-w-0 p-6 md:flex-1' },
            h(Button, { size: 'sm', onClick: () => setOpen(true) }, 'Ouvrir la fiche'),
            ' ',
            h(Button, { size: 'sm', onClick: () => setDetail(true) }, 'Ouvrir l’action'),
            ' ',
            h(Button, { size: 'sm', onClick: () => setEditor(true) }, 'Ouvrir l’éditeur'),
            ' ',
            h(Button, { size: 'sm', onClick: () => setTools(true) }, 'Ouvrir le panneau'),
            h('input', { 'aria-label': 'Composer', className: 'mt-3 block border border-line px-2 py-1' })),
          anchored,
          surface === 'panel'
            ? h('aside', { 'data-panel': '', 'aria-label': 'Panneau', className: 'flex min-h-0 flex-1 flex-col border-line max-md:border-t md:w-80 md:flex-none md:border-l' },
                detail ? null : h('p', { className: 'p-3' }, 'Liste des actions'),
                h(Detail, { open: detail, onClose: () => setDetail(false), label: 'Action', title: 'Lancer les tests', back: 'Actions' }, h('p', { className: 'p-3' }, 'Détail de l’action')))
            : h(Detail, { open: detail, onClose: () => setDetail(false), label: 'Action', title: 'Lancer les tests', back: 'Actions' }, h('p', { className: 'p-3' }, 'Détail de l’action')),
          h(Drawer, { open, onClose: close, label: 'Carte #161', title: 'Tiroir commun', subtitle: '#161 · en cours' }, inside),
          h(Drawer, { open: editor, onClose: () => setEditor(false), label: 'Nouvelle action', title: 'Nouvelle action', width: 'wide' },
            h('input', { 'aria-label': 'Nom de l’action', autoFocus: true, className: 'm-5 border border-line px-2 py-1' })),
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
    assert.equal(await drawer.getAttribute('aria-modal'), phone ? 'true' : null, 'Modal au téléphone seulement')
    await page.screenshot({ path: `/tmp/shell-drawer-${width}.png` })

    if (phone) {
      // Le tiroir prend le focus sur lui-même, ou sur un clic dans son blanc : Maj+Tab
      // depuis le conteneur boucle sur son dernier élément, Tab sur le premier (#254).
      const dialogOfFocus = () => page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute('aria-label') ?? null)
      const lastOf = () => drawer.evaluate((element) => document.activeElement === element.querySelector('input'))
      console.log(width, 'Maj+Tab depuis le conteneur reste dans le tiroir')
      assert.equal(await drawer.evaluate((element) => element === document.activeElement), true, 'Le conteneur a le focus')
      await page.keyboard.press('Shift+Tab')
      assert.equal(await dialogOfFocus(), 'Carte #161', 'Maj+Tab depuis le conteneur reste dans le tiroir')
      assert.equal(await lastOf(), true, 'Maj+Tab depuis le conteneur va au dernier élément')
      await page.keyboard.press('Tab')
      assert.equal(await dialogOfFocus(), 'Carte #161', 'Tab depuis le dernier élément boucle')
      await drawer.getByRole('heading', { name: 'Tiroir commun' }).click()
      await page.keyboard.press('Shift+Tab')
      assert.equal(await lastOf(), true, 'Maj+Tab après un clic dans le blanc du tiroir')
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Shift+Tab')
        assert.equal(await dialogOfFocus(), 'Carte #161', 'Maj+Tab répété reste dans le tiroir')
      }
    }

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

    console.log(width, 'Échap : une confirmation Radix d’abord, le tiroir ensuite')
    await opener.click()
    await drawer.waitFor()
    await settle()
    await drawer.getByRole('button', { name: 'Supprimer', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Supprimer la carte ?' })
    await confirm.waitFor()
    await page.keyboard.press('Escape')
    await confirm.waitFor({ state: 'detached' })
    assert.equal(await drawer.isVisible(), true, 'La confirmation ferme, pas le tiroir')
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

    console.log(width, 'un champ autoFocus garde le focus, qui revient au déclencheur ; 48 rem')
    const editorOpener = page.getByRole('button', { name: 'Ouvrir l’éditeur', exact: true })
    await editorOpener.click()
    const editor = page.getByRole('dialog', { name: 'Nouvelle action' })
    await editor.waitFor()
    await settle()
    assert.ok(await isFocused(editor.getByRole('textbox', { name: 'Nom de l’action' })), 'Le champ autoFocus garde le focus')
    assert.equal(Math.round((await editor.boundingBox()).width), phone ? width : Math.min(768, width - 48))
    await page.keyboard.press('Escape')
    await editor.waitFor({ state: 'detached' })
    assert.ok(await isFocused(editorOpener), 'Le focus revient au déclencheur, malgré l’autoFocus')

    console.log(width, 'un tiroir recouvre le panneau ancré, et Échap le ferme d’abord')
    await page.getByRole('button', { name: 'Ouvrir le panneau', exact: true }).click()
    const tools = page.getByRole('complementary', { name: 'Outils' })
    await tools.waitFor()
    await opener.click()
    await drawer.waitFor()
    await settle()
    const toolsBox = await tools.boundingBox()
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role=dialog]')?.getAttribute('aria-label') ?? null, { x: toolsBox.x + toolsBox.width - 20, y: toolsBox.y + 200 }), 'Carte #161', 'Le tiroir passe au-dessus du panneau')
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'detached' })
    assert.equal(await tools.isVisible(), true, 'Le panneau reste ouvert')
    await tools.click()
    await page.keyboard.press('Escape')

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
    // Échap tapé ailleurs — le champ de la conversation — n'est pas au détail.
    await page.getByRole('textbox', { name: 'Composer' }).press('Escape')
    assert.equal(await panel.getByText('Détail de l’action').isVisible(), true, 'Échap dans le composer laisse le détail')
    await panel.getByText('Détail de l’action').click()
    await page.keyboard.press('Escape')
    await panel.getByText('Liste des actions').waitFor()
    await page.getByRole('button', { name: 'Ouvrir l’action', exact: true }).click()
    await panel.getByRole('button', { name: 'Actions' }).click()
    await panel.getByText('Liste des actions').waitFor()

    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('OK : calque, géométrie, en-tête, focus, ✕, clic dehors, Échap par couches (menu et confirmation Radix, autocomplétion, panneau dessous), autoFocus, 48 rem, détail en tiroir ou en pile ; ordinateur et téléphone.')
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  await once(vite, 'exit')
}
