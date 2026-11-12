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
 * L'Agenda des actions (AGD-1 à AGD-10), monté seul avec les données de sa story : une
 * semaine chargée où la nuit de 3 h se dispute entre deux actions. Les blocs, leurs
 * couloirs et leurs chevauchements, les heures vides resserrées puis dépliées, la ligne
 * « maintenant », le bandeau des services, la navigation, la portée Jour, et la liste par
 * jour sous 44 rem de conteneur. Le navigateur est réglé sur New York, le serveur sur
 * Paris : un passage lu à l'heure du poste se verrait.
 *
 * Les captures vont hors du dépôt (`AGENDA_UI_OUTPUT`, par défaut sous ~/.cache), une
 * image par bloc.
 */
const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const output = process.env.AGENDA_UI_OUTPUT ?? join(homedir(), '.cache', 'solera-agenda')
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
  return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
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
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/schedules.ts'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/automations/ActionsAgenda.tsx'),
  }
  browser = await launchBrowser()
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const wide = viewport.width > 700
    const page = await browser.newPage({ viewport, locale: 'fr-FR', timezoneId: 'America/New_York' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await page.route('**/__agenda_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><body><main id="check" style="padding:16px"></main></body></html>' }))
    await page.goto(`${origin}/__agenda_check`)
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
      const { TooltipProvider } = await import(modules.ui)
      const stories = await import('/src/components/automations/ActionsAgenda.stories.tsx')
      const Harness = stories.default.component
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const root = createRoot(document.getElementById('check'))
      let mounts = 0
      window.mount = (story) => root.render(
        React.createElement(QueryClientProvider, { client },
          React.createElement(TooltipProvider, null,
            React.createElement(Harness, { key: ++mounts, ...stories.default.args, ...stories[story].args }))))
      window.mount('Semaine')
    }, modules)

    const check = page.locator('#check')
    const heading = check.getByRole('heading', { level: 2 })
    const header = check.locator('div.flex-wrap').first()
    const grid = check.locator('div.rounded-lg.border').first()
    const shot = (locator, name) => locator.screenshot({ path: join(output, `${name}-${viewport.width}.png`) })
    const opened = () => page.getByTestId('opened').textContent()

    // AGD-1 : l'en-tête — le mois, la navigation, la portée, le compte des chevauchements, la légende.
    await heading.filter({ hasText: 'novembre 2026' }).waitFor({ timeout: 10_000 }).catch(async (error) => {
      throw new Error(`${error.message}\n${errors.join('\n')}\n${diagnostics}`)
    })
    // Lundi et mercredi joués, vendredi prévu : la revue de 3 h et la sauvegarde de 3 h 10.
    await check.getByText('3 chevauchements').waitFor()
    assert.equal(await check.getByRole('radio', { name: 'Semaine' }).getAttribute('aria-checked'), 'true')
    for (const word of ['agent', 'commande', 'service', 'prévu', 'verdict']) await check.getByText(word, { exact: true }).first().waitFor()
    await shot(header, 'en-tete')

    if (wide) {
      // AGD-2/3 : les passages passés à liseré, ceux à venir en pointillé ; au fuseau du serveur.
      const blocks = grid.locator('[data-agenda-shot]')
      assert.ok((await blocks.count()) > 15, `blocs : ${await blocks.count()}`)
      assert.ok((await grid.locator('[data-agenda-shot="planned"]').count()) >= 4)
      const review = grid.getByRole('button', { name: /^Revue des dépendances · mer\. 11 nov\., 03:00 · échoué · Agent · chevauche une autre action$/ })
      await review.waitFor()
      assert.match(await review.textContent(), /03:00/)
      assert.match(await review.getAttribute('class'), /before:bg-critical/)
      assert.match(await grid.locator('[data-agenda-shot="planned"]').first().getAttribute('class'), /border-dashed/)
      // Le passage en cours pulse.
      assert.match(await grid.locator('[data-agenda-shot="running"]').getAttribute('class'), /animate-pulse/)

      // AGD-4 : deux actions qui se recouvrent, côte à côte, cerclées d'ambre, sans se superposer.
      const backup = grid.getByRole('button', { name: /^Sauvegarde · mer\. 11 nov\., 03:10/ })
      const [left, right] = [await rect(review), await rect(backup)]
      assert.ok(left.right <= right.left + 1, `superposés : ${JSON.stringify([left, right])}`)
      assert.equal(await grid.locator('[data-overlaps]').count(), 6)
      await shot(grid, 'grille-semaine')

      // AGD-6 : la colonne du jour, sa pastille, la ligne « maintenant » entre 9 h et 11 h.
      const now = grid.locator('[data-agenda-now]')
      assert.equal(await now.count(), 1)
      const line = await rect(now)
      const nine = await rect(grid.getByText('09:00', { exact: true }))
      const eleven = await rect(grid.getByText('11:00', { exact: true }))
      assert.ok(line.top > nine.top && line.top < eleven.top, 'la ligne « maintenant » est à 10 h')

      // AGD-7 : le service en marche, en bandeau du jour, ouvre son action.
      await grid.getByRole('button', { name: /^Serveur de dev · service/ }).click()
      assert.equal(await opened(), 'Serveur de dev')
      // AGD-3 : un clic sur un bloc ouvre son action.
      await backup.click()
      assert.equal(await opened(), 'Sauvegarde')

      // AGD-5 : les heures vides resserrées ; un « ⋯ » déplie tout, « Resserrer » revient.
      const folds = grid.getByRole('button', { name: /^Déplier/ })
      assert.ok((await folds.count()) >= 3)
      assert.equal(await grid.getByText('05:00', { exact: true }).count(), 0, '5 h est vide')
      const folded = (await rect(grid)).bottom - (await rect(grid)).top
      await folds.first().click()
      assert.equal(await folds.count(), 0)
      await grid.getByText('05:00', { exact: true }).waitFor()
      await shot(grid, 'grille-depliee')
      await grid.getByRole('button', { name: 'Resserrer les heures vides' }).click()
      assert.equal((await rect(grid)).bottom - (await rect(grid)).top, folded)

      // La navigation : la semaine d'après n'a pas de « maintenant », « Aujourd'hui » revient.
      await check.getByRole('button', { name: 'Période suivante' }).click()
      await grid.getByText('16', { exact: true }).waitFor()
      assert.equal(await now.count(), 0)
      assert.equal(await grid.locator('[data-agenda-shot]:not([data-agenda-shot="planned"])').count(), 0, 'que du prévu')
      await check.getByRole('button', { name: "Aujourd'hui" }).click()
      await grid.getByText('9', { exact: true }).waitFor()

      // La portée Jour : la date entière, une seule colonne.
      await check.getByRole('radio', { name: 'Jour' }).click()
      await heading.filter({ hasText: 'mercredi 11 novembre 2026' }).waitFor()
      assert.equal(await grid.locator('[data-agenda-now]').count(), 1)
      await check.getByText('1 chevauchement').waitFor()
      await shot(grid, 'grille-jour')
      await check.getByRole('button', { name: 'Période précédente' }).click()
      await heading.filter({ hasText: 'mardi 10 novembre 2026' }).waitFor()

      // AGD-9 : sous 44 rem de conteneur, la liste, même sur un grand écran.
      await page.evaluate(() => window.mount('Etroit'))
      await check.getByRole('heading', { name: 'mercredi 11 novembre', level: 3 }).waitFor()
      assert.equal(await grid.isVisible(), false)

      // AGD-8 : rien de planifié — la phrase, et la grille quand même.
      await page.evaluate(() => window.mount('Vide'))
      await check.getByText("Rien de planifié pour l'instant.", { exact: false }).waitFor()
      assert.equal(await grid.isVisible(), true)
      assert.equal(await grid.locator('[data-agenda-shot]').count(), 0)
      await shot(check.locator('xpath=./div/div[1]'), 'vide')
    } else {
      // AGD-9 : au téléphone, une liste par jour.
      assert.equal(await grid.isVisible(), false)
      const wednesday = check.locator('section').filter({ has: page.getByRole('heading', { name: 'mercredi 11 novembre', level: 3 }) })
      const lines = wednesday.getByRole('listitem')
      assert.deepEqual(
        (await lines.allTextContents()).map((line) => line.replace(/\s+/g, ' ').trim()),
        ['03:00Revue des dépendanceséchoué', '03:10Sauvegarderéussi', '08:45Rapport du matinréussi', '09:50Revue de sécuritéen cours', '14:00Tri des ticketsprévu'],
      )
      await shot(wednesday, 'liste-jour')
      const sunday = check.locator('section').filter({ has: page.getByRole('heading', { name: 'dimanche 15 novembre', level: 3 }) })
      await sunday.getByText('03:00').waitFor()
      await lines.nth(1).click()
      assert.equal(await opened(), 'Sauvegarde')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'l’agenda déborde')
      await shot(header, 'en-tete')
    }

    assert.deepEqual(errors, [])
    console.log(`OK : agenda des actions, couloirs, replis, maintenant, ${wide ? 'grille' : 'liste'} (${viewport.width}px).`)
    await page.close()
  }
} finally {
  await browser?.close()
  vite.kill()
}
