/*
 * Captures des maquettes de la page projet (carte #73). Jetable, comme
 * `ProjectActivityPrototypes` : à retirer avec elle.
 *
 * Même mécanique que `sidebar-prototypes.mjs` : vite sert une page vide, le composant y
 * est monté, et chaque bloc `data-shot` sort en une image — une par bloc, parce qu'une
 * planche entière est illisible sans zoom. Clair et sombre à chaque fois.
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
const out = fileURLToPath(new URL('../docs/audits/2026-10-21-page-projet/', import.meta.url))
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

  const planches = [
    { component: 'ProjetFinal', dir: 'final/', width: 1240, dernier: 'e1-activite-au-telephone' },
  ]
  for (const planche of planches)
  for (const { theme, folder } of [{ theme: 'light', folder: 'clair' }, { theme: 'dark', folder: 'sombre' }]) {
    const page = await browser.newPage({ viewport: { width: planche.width, height: 2000 }, locale: 'fr-FR', deviceScaleFactor: 2 })
    page.on('pageerror', (error) => console.log('ERREUR', error.message))
    page.on('console', (message) => { if (message.type() === 'error') console.log('CONSOLE', message.text()) })
    await page.route('**/__projet', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="check"></main></body></html>',
    }))
    await page.goto(`${origin}/__projet`)
    await page.evaluate(async ([theme, component]) => {
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
      const module = await import('/src/components/ProjectActivityPrototypes.tsx')
      createRoot(document.getElementById('check')).render(React.createElement(module[component]))
    }, [theme, planche.component])
    await page.locator(`[data-shot="${planche.dernier}"]`).waitFor()
    await delay(500)
    // La feuille de l'application fixe la hauteur du document à celle de la fenêtre :
    // sans ça la capture pleine page s'arrête au bas de l'écran.
    await page.evaluate(() => {
      for (const node of [document.documentElement, document.body]) {
        node.style.height = 'auto'
        node.style.minHeight = '0'
        node.style.overflow = 'visible'
      }
    })

    // Mesure plutôt que coup d'œil : une liste qui dépasse de son cadre ne se voit pas
    // à quelques pixels près sur une capture.
    const debords = await page.evaluate(() => Array.from(document.querySelectorAll('[data-proto]')).map((section) => {
      const box = section.children[1]
      return {
        maquette: section.dataset.proto,
        largeur: Math.round(Math.max(box.scrollWidth - box.clientWidth, 0)),
        hauteur: Math.round(Math.max(box.scrollHeight - box.clientHeight, 0)),
      }
    }).filter((entry) => entry.largeur > 0 || entry.hauteur > 0))
    console.log(planche.component, theme, 'débordements :', JSON.stringify(debords))

    const dir = out + planche.dir + folder + '/'
    await mkdir(dir, { recursive: true })
    let rank = 0
    for (const block of await page.locator('[data-shot]').all()) {
      rank += 1
      const slug = await block.getAttribute('data-shot')
      await block.screenshot({ path: dir + String(rank).padStart(2, '0') + '-' + slug + '.png' })
    }
    console.log('découpé en', rank, 'images :', dir)
    await page.close()
  }
} finally {
  if (browser) await browser.close()
  vite.kill('SIGKILL')
}
