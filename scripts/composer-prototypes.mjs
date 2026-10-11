/*
 * Captures des maquettes de rangée unique du composer, pour choisir une disposition.
 * Jetable, comme `ComposerRowPrototypes` : à retirer avec elle.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const out = fileURLToPath(new URL('../docs/audits/2026-10-11-composer-une-ligne/', import.meta.url))
await mkdir(out, { recursive: true })
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise((resolve) => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const vite = spawn(process.execPath, [web + 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: web, stdio: 'pipe' })
let diagnostics = ''
for (const stream of [vite.stdout, vite.stderr]) stream.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-4000) })
let browser
try {
  let ready = false
  for (let i = 0; i < 150; i++) {
    if (await fetch(origin).then((r) => r.ok).catch(() => false)) { ready = true; break }
    await delay(100)
  }
  assert.ok(ready, diagnostics)
  browser = await chromium.launch({ channel: 'chromium', chromiumSandbox: true })

  // Deux largeurs décident de tout : la conversation au large, et le téléphone.
  for (const { name, width, theme } of [
    { name: 'ordinateur-clair', width: 820, theme: 'light' },
    { name: 'ordinateur-sombre', width: 820, theme: 'dark' },
    { name: 'telephone-clair', width: 390, theme: 'light' },
    { name: 'telephone-sombre', width: 390, theme: 'dark' },
  ]) {
    // `isMobile` au téléphone : c'est lui qui bascule `pointer: coarse`, donc les
    // cibles à 44 px. Sans ça la maquette mentirait de huit pixels par bouton.
    const page = await browser.newPage({
      viewport: { width, height: 2000 },
      locale: 'fr-FR',
      deviceScaleFactor: 2,
      ...(width < 500 ? { isMobile: true, hasTouch: true } : {}),
    })
    page.on('pageerror', (error) => console.log('ERREUR', error.message))
    await page.route('**/__prototypes', (route) => route.fulfill({ contentType: 'text/html', // Sans `viewport`, Chrome en mode mobile pose une fenêtre de mise en page de
      // 980 px et la maquette ne serait jamais à l'étroit.
      body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="check"></main></body></html>' }))
    await page.goto(`${origin}/__prototypes`)
    await page.evaluate(async (theme) => {
      const refresh = (await import('/@react-refresh')).default
      refresh.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
      localStorage.setItem('solera.locale', 'fr')
      document.documentElement.dataset.theme = theme
      await import('/src/styles/index.css')
      const React = (await import('/node_modules/.vite/deps/react.js')).default
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
      const source = await (await fetch('/src/components/chat/ComposerRowPrototypes.tsx')).text()
      const { TooltipProvider } = await import(/from "([^"]*\/packages\/ui\/[^"]*)"/.exec(source)[1])
      const { ComposerRowPrototypes } = await import('/src/components/chat/ComposerRowPrototypes.tsx')
      createRoot(document.getElementById('check')).render(
        React.createElement(TooltipProvider, null, React.createElement(ComposerRowPrototypes)),
      )
    }, theme)
    await page.getByText('La modale de contexte', { exact: true }).waitFor()
    await delay(400)
    // Mesure plutôt que coup d'œil : une rangée qui déborde pousse l'envoi hors du
    // cadre, et à quelques pixels près ça ne se voit pas sur une capture.
    // La feuille de l'application fixe la hauteur du document à celle de la fenêtre :
    // sans ça, la capture pleine page s'arrête au bas de l'écran.
    await page.evaluate(() => {
      for (const node of [document.documentElement, document.body]) {
        node.style.height = 'auto'
        node.style.minHeight = '0'
        node.style.overflow = 'visible'
      }
    })
    const fits = await page.evaluate(() => Array.from(document.querySelectorAll('[data-proto]')).map((section) => {
      const row = section.querySelector('[data-proto-row]')
      const card = section.querySelector('[data-proto-card]')
      const name = section.querySelector('[data-proto-row] .truncate')
      return {
        maquette: section.dataset.proto,
        deborde: Math.round(row.scrollWidth - row.clientWidth),
        nomVisible: name ? Math.round(name.getBoundingClientRect().width) : 0,
        hauteur: Math.round(card.getBoundingClientRect().height),
      }
    }))
    console.log(name, JSON.stringify(fits))

    // Une image par bloc, à la largeur du téléphone : lues depuis un mobile, les
    // planches entières s'affichent réduites et rien n'y est lisible.
    if (theme === 'light') {
      const folder = out + (width < 500 ? 'telephone/' : 'ordinateur/')
      await mkdir(folder, { recursive: true })
      const blocks = await page.locator('[data-shot]').all()
      let rank = 0
      for (const block of blocks) {
        rank += 1
        const slug = await block.getAttribute('data-shot')
        await block.screenshot({ path: folder + String(rank).padStart(2, '0') + '-' + slug + '.png' })
      }
      console.log('découpé en', rank, 'images :', folder)
    }
    const modal = await page.evaluate(() => {
      const node = [...document.querySelectorAll('section')].find((s) => s.textContent.startsWith('La modale de contexte'))
      if (!node) return null
      const r = node.getBoundingClientRect()
      return { top: Math.round(r.top + scrollY), height: Math.round(r.height), docHeight: document.documentElement.scrollHeight }
    })
    console.log('modale', JSON.stringify(modal))
    await page.screenshot({ path: out + name + '.png', fullPage: true })
    console.log('écrit', out + name + '.png')
    await page.close()
  }
} finally {
  if (browser) await browser.close()
  vite.kill('SIGKILL')
}
