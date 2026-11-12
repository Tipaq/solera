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
 * La planification lisible (PLA-1 à PLA-11), montée seule avec le banc de sa story :
 * chaque fréquence rend la cadence attendue, l'heure se tape, la plage garde sa fin
 * après son début, Personnalisé garde le cron de ce qu'on voyait et dit quand il est
 * faux, la date d'« une fois » refuse les jours passés. L'aperçu compte les passages à
 * l'heure **du serveur** (Paris) dans un navigateur réglé sur New York : un jour ou une
 * heure lus dans le fuseau du poste se verraient.
 *
 * Les captures vont hors du dépôt (`SCHEDULE_BUILDER_UI_OUTPUT`, par défaut sous
 * ~/.cache), une image par bloc.
 */
const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const output = process.env.SCHEDULE_BUILDER_UI_OUTPUT ?? join(homedir(), '.cache', 'solera-schedule-builder')
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
  return { height: Math.round(rect.height), right: Math.round(rect.right) }
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
    ui: await viteDependency(origin, '@solera/ui', '/src/components/automations/ScheduleBuilder.tsx'),
  }
  browser = await launchBrowser()
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, locale: 'fr-FR', timezoneId: 'America/New_York' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await page.route('**/__schedule_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><body><main id="check" style="padding:16px"></main></body></html>' }))
    await page.goto(`${origin}/__schedule_check`)
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
      const Harness = (await import('/src/components/automations/ScheduleBuilder.stories.tsx')).default.component
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const root = createRoot(document.getElementById('check'))
      let mounts = 0
      window.mount = (initial) => root.render(
        React.createElement(QueryClientProvider, { client },
          React.createElement(TooltipProvider, null,
            React.createElement(Harness, { key: ++mounts, initial }))))
      window.mount(null)
    }, modules)

    const check = page.locator('#check')
    const cadence = async () => JSON.parse(await page.getByTestId('cadence').textContent())
    const expectCadence = async (expected, when) => {
      await page.waitForFunction((json) => document.querySelector('[data-testid="cadence"]').textContent === json, JSON.stringify(expected))
        .catch(async () => assert.deepEqual(await cadence(), expected, when))
    }
    const sentence = (text) => check.getByText(text, { exact: true }).waitFor({ timeout: 10_000 }).catch(async (error) => {
      throw new Error(`${error.message}\n${errors.join('\n')}\n${(await check.textContent()).slice(0, 800)}`)
    })
    const frequency = async (from, to) => {
      await check.getByRole('button', { name: from, exact: true }).click()
      await page.getByRole('menuitemradio', { name: to }).click()
    }
    const phrase = check.locator('div.flex-wrap').first()
    const preview = check.locator('div.rounded-md.bg-surface\\/60')
    const shot = (locator, name) => locator.screenshot({ path: join(output, `${name}-${viewport.width}.png`) })

    // PLA-1 : la phrase par défaut, chaque contrôle à 36 px, rien ne déborde.
    await sentence('Chaque jour à 3 h 00')
    await expectCadence({ kind: 'cron', expression: '0 3 * * *' }, 'défaut')
    const heights = await Promise.all((await phrase.locator('button').all()).map((button) => box(button)))
    assert.ok(heights.every((part) => part.height === 36), `hauteurs ${heights.map((part) => part.height)}`)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'la phrase déborde')
    await shot(phrase, 'phrase-jour')

    // PLA-11 : l'aperçu, au fuseau du serveur — 03:00 à Paris, pas à New York.
    await check.getByText('Fuseau du serveur : Europe/Paris').waitFor()
    const next = preview.locator('ol li')
    assert.equal(await next.count(), 5)
    assert.match(await next.first().textContent(), /demain.*03:00/i)
    // Le 11 au matin, 03:00 est passé : du 12 au 30 novembre, dix-neuf jours marqués.
    assert.equal(await preview.locator('span[title]').count(), 19)
    await shot(preview, 'apercu-jour')

    // PLA-9 : l'heure se tape (« 930 »), et Entrée la valide.
    await check.getByRole('button', { name: '03:00' }).click()
    const timeDialog = page.getByRole('dialog', { name: 'Heure' })
    await timeDialog.getByRole('textbox').fill('930')
    await shot(timeDialog, 'heure')
    await timeDialog.getByRole('textbox').press('Enter')
    await timeDialog.waitFor({ state: 'detached' })
    await expectCadence({ kind: 'cron', expression: '30 9 * * *' }, 'heure tapée')

    // PLA-5 : jours ouvrés.
    await check.getByRole('switch', { name: 'jours ouvrés seulement' }).click()
    await expectCadence({ kind: 'cron', expression: '30 9 * * 1-5' }, 'jours ouvrés')
    await sentence('Chaque jour ouvré (lundi à vendredi) à 9 h 30')

    // PLA-2 : le menu en trois groupes.
    await check.getByRole('button', { name: 'chaque jour', exact: true }).click()
    const menu = page.getByRole('menu')
    assert.equal(await menu.getByRole('menuitemradio').count(), 6)
    assert.equal(await menu.getByRole('separator').count(), 2)
    await shot(menu, 'frequence')
    await menu.getByRole('menuitemradio', { name: 'chaque semaine' }).click()

    // PLA-6 : lundi d'abord, au moins un jour.
    const days = check.getByRole('group', { name: 'Jours de la semaine' })
    assert.equal((await days.getByRole('checkbox').first().getAttribute('aria-label')), 'lundi')
    await days.getByRole('checkbox', { name: 'jeudi' }).click()
    await expectCadence({ kind: 'cron', expression: '30 9 * * 1,4' }, 'lundi et jeudi')
    await sentence('Chaque lundi et jeudi à 9 h 30')
    await shot(phrase, 'phrase-semaine')
    await days.getByRole('checkbox', { name: 'lundi' }).click()
    await days.getByRole('checkbox', { name: 'jeudi' }).click()
    await check.getByRole('alert').getByText('Choisis au moins un jour.').waitFor()
    await sentence('Règle incomplète.')
    await expectCadence(null, 'aucun jour')
    await days.getByRole('checkbox', { name: 'mardi' }).click()

    // PLA-7 : le jour du mois, l'aide au-delà de 28, le dernier jour.
    await frequency('chaque semaine', 'chaque mois')
    await check.getByRole('button', { name: '1er' }).click()
    const monthDays = page.getByRole('dialog', { name: 'Jour du mois' })
    await shot(monthDays, 'jour-du-mois')
    await monthDays.getByRole('radio', { name: '31', exact: true }).click()
    await check.getByText('Les mois sans 31, rien ne part', { exact: false }).waitFor()
    await expectCadence({ kind: 'cron', expression: '30 9 31 * *' }, 'le 31')
    await check.getByRole('button', { name: '31', exact: true }).click()
    await page.getByRole('dialog', { name: 'Jour du mois' }).getByRole('radio', { name: 'Dernier jour' }).click()
    await expectCadence({ kind: 'cron', expression: '30 9 L * *' }, 'dernier jour')
    await sentence('Le dernier jour de chaque mois à 9 h 30')
    // Novembre : seul le 30 est marqué.
    assert.equal(await preview.locator('span[title]').count(), 1)

    // PLA-4 : toutes les N heures, puis sur une plage dont la fin suit le début.
    await frequency('chaque mois', 'Toutes les N heures')
    await check.getByRole('button', { name: '6 heures' }).click()
    await page.getByRole('dialog', { name: 'Intervalle' }).getByRole('radio', { name: '2 h', exact: true }).click()
    await expectCadence({ kind: 'cron', expression: '0 */2 * * *' }, 'toutes les 2 heures')
    await check.getByRole('button', { name: '+ sur une plage horaire' }).click()
    await expectCadence({ kind: 'cron', expression: '0 8-20/2 * * *' }, 'plage')
    await sentence('Toutes les 2 heures, entre 8 h et 20 h')
    await check.getByRole('button', { name: '8 h', exact: true }).click()
    await page.getByRole('dialog', { name: 'Heure' }).getByRole('button', { name: '21', exact: true }).click()
    await expectCadence({ kind: 'cron', expression: '0 21-22/2 * * *' }, 'la fin suit le début')
    await shot(phrase, 'phrase-heures')
    // Un jour d'aperçu compte ses passages : 21 h au mur de Paris, aujourd'hui compris.
    assert.match(await preview.locator('span[title]').first().getAttribute('title'), /1 passage$/)
    await check.getByRole('button', { name: 'toute la journée' }).click()
    await expectCadence({ kind: 'cron', expression: '0 */2 * * *' }, 'toute la journée')

    // PLA-8 : Personnalisé garde le cron de ce qu'on voyait, et dit quand il est faux.
    await frequency('toutes les', 'Personnalisé (cron)')
    const cron = check.getByRole('textbox', { name: 'Expression cron' })
    assert.equal(await cron.inputValue(), '0 */2 * * *')
    await check.getByText('minute · heure · jour du mois · mois · jour de la semaine').waitFor()
    await cron.fill('0 9 * *')
    await check.getByRole('alert').getByText('Il faut 5 champs', { exact: false }).waitFor()
    assert.equal(await cron.getAttribute('aria-invalid'), 'true')
    await expectCadence(null, 'cron invalide')
    await shot(check.locator('xpath=./div/div[1]'), 'personnalise-invalide')
    await cron.fill('0 9 * * 1')
    await expectCadence({ kind: 'cron', expression: '0 9 * * 1' }, 'cron valide')

    // PLA-3 : une fois — jours passés désactivés, aujourd'hui cerclé, l'heure du serveur.
    await frequency('Personnalisé (cron)', 'Une seule fois')
    await check.getByRole('button', { name: 'jeu. 12 nov.' }).click()
    const dates = page.getByRole('dialog', { name: 'Date' })
    assert.equal(await dates.getByRole('button', { name: 'mardi 10 novembre' }).isDisabled(), true, 'hier ne se choisit pas')
    await shot(dates, 'date')
    await dates.getByRole('button', { name: 'vendredi 20 novembre' }).click()
    await check.getByRole('button', { name: '09:30' }).click()
    await page.getByRole('dialog', { name: 'Heure' }).getByRole('textbox').fill('14:30')
    await page.getByRole('dialog', { name: 'Heure' }).getByRole('textbox').press('Enter')
    // 14:30 à Paris, quel que soit le fuseau du navigateur.
    await expectCadence({ kind: 'once', at: Date.UTC(2026, 10, 20, 13, 30) }, 'une fois')
    await sentence('Une seule fois, le vendredi 20 novembre à 14 h 30')
    assert.equal(await next.count(), 1)
    await shot(check.locator('xpath=./div/div[1]'), 'une-fois')

    // PLA-10 : une cadence existante se relit ; ce qui ne se relit pas reste tel quel.
    await page.evaluate(() => window.mount({ kind: 'cron', expression: '0 3 * * 1,4' }))
    await check.getByRole('button', { name: 'chaque semaine' }).waitFor()
    assert.equal(await check.getByRole('group', { name: 'Jours de la semaine' }).getByRole('checkbox', { checked: true }).count(), 2)
    await page.evaluate(() => window.mount({ kind: 'cron', expression: '15 4 1 1 *' }))
    assert.equal(await check.getByRole('textbox', { name: 'Expression cron' }).inputValue(), '15 4 1 1 *')
    // Un intervalle relu repart tel quel : il ne devient le motif affiché qu'au premier geste.
    await page.evaluate(() => window.mount({ kind: 'interval', minutes: 90 }))
    await expectCadence({ kind: 'interval', minutes: 90 }, 'intervalle relu')
    await sentence('Toutes les 90 min')
    await check.getByRole('textbox', { name: 'Expression cron' }).fill('0 */3 * * *')
    await expectCadence({ kind: 'cron', expression: '0 */3 * * *' }, 'intervalle modifié')

    assert.deepEqual(errors, [])
    console.log(`OK : planification lisible, chaque fréquence, aperçu à l'heure du serveur (${viewport.width}px).`)
    await page.close()
  }
} finally {
  await browser?.close()
  vite.kill()
}
