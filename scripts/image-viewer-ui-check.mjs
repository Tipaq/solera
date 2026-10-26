import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './checks/browser.mjs'
import { viteDependency } from './checks/vite-deps.mjs'

// Composants réels et images locales, sans daemon ni base de production.
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

// La visionneuse ouverte depuis le fil : celle du panneau (`panel/ImageView.tsx`), en
// boîte de dialogue. Le panneau lui-même est vérifié par `frontend-ui-check`.
async function mount(page) {
  // Les fournisseurs viennent des mêmes modules que les composants : voir `viteDependency`.
  const modules = {
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/conversation-config.ts'),
    router: await viteDependency(origin, 'react-router-dom', '/src/components/chat/MessageBubble.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/ImageThumbnail.tsx'),
  }
  await page.goto(origin)
  await page.evaluate(async (modules) => {
    const refresh = (await import('/@react-refresh')).default
    refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    localStorage.setItem('solera.locale', 'fr')
    // readableView est appelé hors rendu : son libellé se fige, il faut le catalogue d'abord.
    await (await import('/src/lib/i18n/index.ts')).initLocale()
    document.documentElement.dataset.theme = 'dark'
    await import('/src/styles/index.css')
    const React = (await import('/node_modules/.vite/deps/react.js')).default
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
    const { QueryClient, QueryClientProvider } = await import(modules.query)
    const { MemoryRouter } = await import(modules.router)
    const { TooltipProvider } = await import(modules.ui)
    const { Markdown } = await import('/src/components/chat/Markdown.tsx')
    const { readableView } = await import('/src/components/tools/registry.tsx')
    const canvas = document.createElement('canvas')
    canvas.width = 1600; canvas.height = 1000
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#367a90'; ctx.fillRect(0, 0, 1600, 1000)
    ctx.fillStyle = '#efc873'; ctx.fillRect(400, 200, 800, 600)
    const src = canvas.toDataURL('image/png')
    const data = src.split(',')[1]
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const h = React.createElement
    createRoot(document.getElementById('check')).render(
      h(QueryClientProvider, { client }, h(MemoryRouter, null, h(TooltipProvider, null, h('main', null,
        h(Markdown, { text: `![markdown.png](${src})` }),
        readableView({ name: 'Read', input: { file_path: 'shots/read.png' }, status: 'completed', output: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] }),
        readableView({ name: 'ViewImage', input: { path: 'shots/view.png' }, status: 'completed', output: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] }),
      )))),
    )
  }, modules)
}

const percent = async (dialog) => Number((await dialog.getByRole('status').textContent()).replace(/\D/g, ''))

try {
  for (let i = 0; i < 150; i++) {
    if (await fetch(origin).then((r) => r.ok).catch(() => false)) break
    if (vite.exitCode !== null) throw new Error(diagnostics)
    await delay(100)
  }
  browser = await launchBrowser()
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 700, isMobile: width < 700, serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
    await page.route(`${origin}/api/**`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await mount(page)

    console.log(width, 'ouverture')
    const opener = page.getByRole('button', { name: 'shots/read.png', exact: true })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'read.png en plein écran' })
    await dialog.waitFor()
    const image = dialog.locator('img')
    await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.naturalWidth === 1600)
    const fit = await percent(dialog)
    assert.ok(fit > 0 && fit < 100, `ajustée à ${fit} %`)
    assert.ok(await image.evaluate((img) => img.getBoundingClientRect().width <= innerWidth))

    console.log(width, 'zoom et glissement')
    await dialog.getByRole('button', { name: 'Agrandir', exact: true }).click()
    assert.equal(await percent(dialog), Math.round(fit * 1.25))
    await dialog.getByRole('button', { name: 'Réduire', exact: true }).click()
    assert.equal(await percent(dialog), fit)
    const box = await dialog.locator('.touch-none').boundingBox()
    if (width >= 700) {
      await page.mouse.move(box.x + 100, box.y + 100)
      await page.mouse.down()
      await page.mouse.move(box.x + 130, box.y + 120)
      await page.mouse.up()
      assert.match(await image.getAttribute('style'), /translate\(30px, 20px\)/)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -100)
      await page.waitForFunction((fit) => Number(document.querySelector('[role=dialog] [role=status]').textContent.replace(/\D/g, '')) > fit, fit)
    } else {
      const cdp = await context.newCDPSession(page)
      const y = box.y + box.height / 2
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 130, y, id: 1 }, { x: 230, y, id: 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 110, y, id: 1 }, { x: 250, y, id: 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y, id: 1 }, { x: 280, y, id: 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await cdp.detach()
      assert.ok(await percent(dialog) > fit, 'le pincement zoome')
    }

    console.log(width, 'raccourcis')
    await page.keyboard.press('0')
    await dialog.getByText('100 %', { exact: true }).waitFor()
    assert.ok(await image.evaluate((img) => img.getBoundingClientRect().width >= 1599))
    await page.keyboard.press('f')
    await page.waitForFunction((fit) => document.querySelector('[role=dialog] [role=status]').textContent.replace(/\D/g, '') === String(fit), fit)
    assert.equal(await image.evaluate((img) => img.style.transform), 'translate(0px, 0px)')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `/tmp/image-viewer-${width}.png` })

    console.log(width, 'fermeture')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    // Radix rend le focus à la vignette qui a ouvert la visionneuse.
    assert.equal(await opener.evaluate((element) => element === document.activeElement), true)
    await page.getByRole('button', { name: 'shots/view.png', exact: true }).click()
    const view = page.getByRole('dialog', { name: 'view.png en plein écran' })
    await view.waitFor()
    await view.getByRole('button', { name: 'Fermer', exact: true }).click()
    await view.waitFor({ state: 'hidden' })
    await page.getByRole('img', { name: 'markdown.png', exact: true }).click()
    const markdown = page.getByRole('dialog', { name: 'markdown.png en plein écran' })
    await markdown.waitFor()
    await page.keyboard.press('Escape')
    await markdown.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('OK : vignettes Read et ViewImage, image markdown, zoom, glissement, molette, pincement, raccourcis, Échap et focus ; ordinateur et téléphone.')
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  await once(vite, 'exit')
}
