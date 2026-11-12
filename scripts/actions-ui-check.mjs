import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './checks/browser.mjs'
import { viteDependency } from './checks/vite-deps.mjs'

// Actions de projet, de bout en bout : vraie API, vrai serveur MCP, vrais terminaux, et
// sous Linux une vraie unité systemd utilisateur (`solera-app-action-*`), arrêtée et
// retirée à la fin. Les captures vont dans ACTIONS_SHOTS, ou dans un dossier temporaire.
const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-actions-check-'))
const shots = process.env.ACTIONS_SHOTS ?? (await mkdtemp(join(tmpdir(), 'solera-actions-shots-')))
const processes = []
let browser
/** Unité du service d'essai : arrêtée à la fin même si la suite échoue avant de la supprimer. */
let serviceUnit = null
/** Les instances par worktree de l'essai (AC-06), arrêtées à la fin de même. */
const instanceUnits = []
/** Le service allumé depuis l'onglet Actions, arrêté à la fin de même. */
const tabUnits = []

async function freePort() {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return port
}

function run(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'pipe' })
  processes.push(child)
  child.diagnostics = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { child.diagnostics = (child.diagnostics + chunk).slice(-6000) })
  }
  return child
}

async function ready(url, child) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(child.diagnostics)
    if (await fetch(url).then((response) => response.ok).catch(() => false)) return
    await delay(100)
  }
  throw new Error(`Server did not start: ${child.diagnostics}`)
}

/** Un appel d'outil sur le vrai serveur MCP, comme le ferait un CLI. */
async function mcp(env, conversationId, projectId, name, args) {
  const child = spawn(process.execPath, [join(serverDir, 'src/mcp/solera-mcp.mjs')], {
    env: {
      ...process.env,
      SOLERA_MCP_DB: join(env.SOLERA_DATA_DIR, 'solera.db'),
      SOLERA_MCP_PROJECT: projectId,
      SOLERA_MCP_CONVERSATION: conversationId,
    },
  })
  let stdout = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n')
  for (let i = 0; i < 300 && !stdout.includes('\n'); i++) await delay(100)
  child.kill()
  return JSON.parse(stdout).result
}

/**
 * Les pièces d'une action (`components/automations/`), montées seules sur les fixtures de
 * leurs stories : les gestes d'une tuile et d'une ligne, l'en-tête du tiroir et du panneau.
 * Au doigt, chaque geste fait 44 px ; à la souris, 36 en tuile et 32 en ligne.
 */
async function checkPieces(base) {
  const modules = {
    query: await viteDependency(base, '@tanstack/react-query', '/src/lib/conversation-config.ts'),
    router: await viteDependency(base, 'react-router-dom', '/src/components/chat/MessageBubble.tsx'),
    ui: await viteDependency(base, '@solera/ui', '/src/components/ImageThumbnail.tsx'),
  }
  for (const width of [1280, 390]) {
    const touch = width < 700
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch, locale: 'fr-FR', serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route(`${base}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="bg-canvas"><div id="check" style="padding:16px"></div></body></html>' }))
    await page.route(`${base}/api/**`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await page.goto(base)
    await page.evaluate(async (modules) => {
      const refresh = (await import('/@react-refresh')).default
      refresh.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
      localStorage.setItem('solera.locale', 'fr')
      await (await import('/src/lib/i18n/index.ts')).initLocale()
      document.documentElement.dataset.theme = 'dark'
      await import('/src/styles/index.css')
      const React = (await import('/node_modules/.vite/deps/react.js')).default
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
      const { QueryClient, QueryClientProvider } = await import(modules.query)
      const { MemoryRouter } = await import(modules.router)
      const { TooltipProvider } = await import(modules.ui)
      const { ActionGesture } = await import('/src/components/automations/ActionGestures.tsx')
      const { ActionChromeProvider, ActionHeader } = await import('/src/components/automations/ActionSheet.tsx')
      const { natureOf } = await import('/src/lib/automations.ts')
      const fixtures = await import('/src/components/automations/automation-fixtures.tsx')
      const h = React.createElement
      const ignore = () => {}
      function Switchable({ item, size }) {
        // L'interrupteur suit son état, comme le ferait la vraie mutation.
        const [on, setOn] = React.useState(false)
        const live = on ? { kind: 'service', ports: [], since: null, href: null } : null
        return h(ActionGesture, { item: { ...item, live }, size, onReview: ignore, onToggleService: setOn, onTerminal: ignore, onLaunch: ignore })
      }
      const row = (size) => h('div', { 'data-size': size, style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' } },
        h(ActionGesture, { item: fixtures.NEVER, size, onReview: ignore, onToggleService: ignore, onTerminal: ignore, onLaunch: ignore }),
        h(ActionGesture, { item: fixtures.PROPOSED, size, onReview: ignore, onToggleService: ignore, onTerminal: ignore, onLaunch: ignore }),
        h(ActionGesture, { item: fixtures.AGENT, size, onReview: ignore, onToggleService: ignore, onTerminal: ignore, onLaunch: ignore }),
        h(Switchable, { item: fixtures.SERVICE_OFF, size }),
      )
      const header = (inline) => h(ActionChromeProvider, { value: inline ? { inline: true, backLabel: 'Actions', onBack: ignore } : { inline: false } },
        h('div', { 'data-header': inline ? 'inline' : 'drawer', style: { maxWidth: inline ? '22rem' : '34rem', marginBottom: '16px', border: '1px solid var(--color-line)' } },
          h(ActionHeader, { nature: natureOf(fixtures.SERVICE_ON), title: fixtures.SERVICE_ON.label, when: ['À la demande'], onClose: ignore })))
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      createRoot(document.getElementById('check')).render(
        h(QueryClientProvider, { client }, h(MemoryRouter, null, h(TooltipProvider, null,
          h(fixtures.SeededWorktrees, null, row('tile'), row('row'), header(false), header(true))))),
      )
    }, modules)

    const heightOf = async (locator) => Math.round((await locator.boundingBox()).height)
    const tile = page.locator('[data-size="tile"]')
    const line = page.locator('[data-size="row"]')
    await tile.getByRole('button', { name: 'Lancer « Remplir la base »', exact: true }).waitFor()
    for (const [scope, expected] of [[tile, touch ? 44 : 36], [line, touch ? 44 : 32]]) {
      for (const gesture of [
        scope.getByRole('button', { name: 'Lancer « Remplir la base »', exact: true }),
        scope.getByRole('button', { name: 'Lancer « Remplir la base » dans…', exact: true }),
        scope.getByRole('button', { name: 'Relire « Migrer la base »', exact: true }),
        scope.getByRole('button', { name: 'Lancer « Revue des dépendances »', exact: true }),
        scope.getByRole('switch', { name: 'Démarrer « Storybook »', exact: true }),
      ]) assert.equal(await heightOf(gesture), expected, `${width} px : ${await gesture.getAttribute('aria-label')}`)
    }
    // Une tâche d'agent part dans une nouvelle session, sans chevron (Q6).
    assert.equal(await tile.getByRole('button', { name: 'Lancer « Revue des dépendances » dans…', exact: true }).count(), 0)
    assert.equal(await tile.getByRole('button', { name: 'Lancer « Revue des dépendances »', exact: true }).getAttribute('title'), 'Lancer dans une nouvelle session')
    // L'interrupteur dit ce qu'un clic fera, et son mot ce qui est.
    const toggle = tile.getByRole('switch', { name: 'Démarrer « Storybook »', exact: true })
    assert.equal(await toggle.getAttribute('aria-checked'), 'false')
    assert.match(await toggle.textContent(), /Arrêté/)
    await toggle.click()
    const stop = tile.getByRole('switch', { name: 'Arrêter « Storybook »', exact: true })
    assert.equal(await stop.getAttribute('aria-checked'), 'true')
    assert.match(await stop.textContent(), /En marche/)
    assert.equal(await line.getByRole('switch', { name: 'Démarrer « Storybook »', exact: true }).textContent(), '')
    // L'en-tête : ✕ en tiroir, « ‹ Actions » dans le panneau.
    await page.locator('[data-header="drawer"]').getByRole('button', { name: 'Fermer', exact: true }).waitFor()
    await page.locator('[data-header="inline"]').getByRole('button', { name: 'Actions', exact: true }).waitFor()
    assert.equal(await page.locator('[data-header="inline"]').getByRole('button', { name: 'Fermer', exact: true }).count(), 0)
    await page.screenshot({ path: join(shots, `actions-pieces-${width}.png`) })
    // « Lancer dans » : la racine, puis les arbres du projet.
    await tile.getByRole('button', { name: 'Lancer « Remplir la base » dans…', exact: true }).click()
    const items = await page.getByRole('menuitem').allTextContents()
    assert.deepEqual(items, ['La racine du projet', 'feat/factures', 'fix/connexion-lente', 'feat/export-csv'])
    await page.screenshot({ path: join(shots, `actions-pieces-launch-${width}.png`) })
    assert.deepEqual(errors, [])
    await context.close()
  }
}

/**
 * L'éditeur unifié (`ActionEditor`), ouvert par « Nouvelle action » du panneau : chaque
 * nature s'enregistre par la vraie API, et ce qui est refusé l'est avant d'arriver au
 * serveur, sous son champ.
 */
async function checkEditor(page, base, project, conversation, api, context) {
  // Dans le panneau d'une conversation, l'éditeur s'ouvre en pile, à la place de la liste.
  const editor = page.locator('[data-action-stack]')
  const open = async () => {
    await page.getByRole('button', { name: 'Nouvelle action', exact: true }).click()
    await editor.getByRole('heading', { name: 'Nouvelle action' }).waitFor()
  }
  const save = editor.getByRole('button', { name: 'Enregistrer', exact: true })
  const mine = async (label) => (await api('/api/actions')).find((action) => action.projectId === project.id && action.label === label)

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${base}/p/${project.id}/c/${conversation.id}`)
  await page.getByRole('button', { name: 'Ouvrir le panneau' }).first().click()
  await page.locator('button[aria-pressed][aria-label^="Actions"]').click()

  // --- Une commande : suggestion du dépôt, dossier choisi dans l'arbre, essai, planifiée.
  await open()
  await editor.locator('[data-suggestions]').getByRole('button', { name: /^Tests/ }).click()
  assert.equal(await editor.getByRole('textbox', { name: 'Libellé', exact: true }).inputValue(), 'Tests')
  await editor.getByRole('textbox', { name: 'Libellé', exact: true }).fill('Tests (éditeur)')
  await editor.getByRole('textbox', { name: 'Commande', exact: true }).fill('echo essai-editeur')
  await editor.getByRole('button', { name: /^Dossier :/ }).click()
  await page.getByRole('treeitem', { name: 'src', exact: true }).click()
  await editor.getByRole('button', { name: 'Dossier : src', exact: true }).waitFor()
  await editor.getByText('s’exécutera dans <worktree>/src', { exact: false }).waitFor()
  await editor.getByRole('button', { name: 'Essayer', exact: true }).click()
  await editor.getByRole('region', { name: 'Sortie de l’essai' }).or(editor.getByLabel('Sortie de l’essai')).getByText('essai-editeur').first().waitFor({ timeout: 15000 })
  // Toute modification de la commande efface l'essai.
  await editor.getByRole('textbox', { name: 'Commande', exact: true }).fill('echo essai-editeur; exit 0')
  assert.equal(await editor.getByLabel('Sortie de l’essai').count(), 0)
  await editor.getByRole('checkbox', { name: /^Planifiée/ }).click()
  await editor.getByRole('checkbox', { name: /^À la demande/ }).click()
  await editor.locator('[data-editor-summary]').getByText(/^Commande · tâche · /).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'editor-command.png') })
  await save.click()
  await editor.waitFor({ state: 'hidden' })
  const planned = await mine('Tests (éditeur)')
  assert.equal(planned.command, 'echo essai-editeur; exit 0')
  assert.equal(planned.subdir, 'src')
  assert.equal(planned.onDemand, false)
  assert.equal(planned.schedule?.cadence.kind, 'cron')

  // --- Un service : lien {port}, placement, et son cas limite planifié (AC-06).
  await open()
  await editor.getByRole('radio', { name: /^Service/ }).click()
  await editor.getByRole('textbox', { name: 'Commande', exact: true }).fill('python3 -m http.server 0')
  // Une erreur s'affiche quand on quitte le champ, pas avant.
  await editor.getByRole('textbox', { name: 'Lien du service', exact: true }).fill('localhost:{port}')
  assert.equal(await editor.getByText('Une adresse http(s), avec {port} si tu veux.').count(), 0)
  await editor.getByRole('textbox', { name: 'Libellé', exact: true }).click()
  await editor.getByText('Une adresse http(s), avec {port} si tu veux.').waitFor()
  await editor.getByRole('textbox', { name: 'Lien du service', exact: true }).fill('http://localhost:{port}/')
  await editor.getByText('quand il écoute sur :5173, le lien sera http://localhost:5173/').waitFor()
  await editor.getByRole('textbox', { name: 'Libellé', exact: true }).fill('Aperçu statique')
  // Une instance par worktree (cas limite) : chaque arbre a son port, que le lien doit dire.
  const perTree = editor.getByRole('radio', { name: /^Une instance par worktree/ })
  assert.match(await perTree.textContent(), /cas limite/)
  await perTree.click()
  await editor.getByText(/^Coût : un processus et un port par arbre ouvert/).waitFor()
  await editor.getByRole('textbox', { name: 'Lien du service', exact: true }).fill('http://localhost:5173/')
  await editor.getByRole('button', { name: /^Enregistrer — À compléter : Chaque instance a son port : le lien doit contenir \{port\}\./ }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'editor-service-per-worktree.png') })
  await editor.getByRole('textbox', { name: 'Lien du service', exact: true }).fill('http://localhost:{port}/')
  await editor.getByRole('radio', { name: /^Toujours la racine du projet/ }).click()
  // Planifié (cas limite) : « Démarrer », puis l'encart « Arrêter », 19 h en semaine d'office.
  await editor.getByRole('checkbox', { name: /^Planifiée/ }).click()
  const stopWindow = editor.locator('[data-service-schedule]')
  await stopWindow.getByText('Cas limite : un service planifié').waitFor()
  await stopWindow.getByText('Arrêter', { exact: true }).waitFor()
  await editor.getByText('Démarrer', { exact: true }).waitFor()
  await editor.locator('[data-service-schedule]').scrollIntoViewIfNeeded()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'editor-service-scheduled.png') })
  await editor.getByRole('checkbox', { name: /^Planifiée/ }).click()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'editor-service.png') })
  await save.click()
  await editor.waitFor({ state: 'hidden' })
  const service = await mine('Aperçu statique')
  assert.equal(service.kind, 'service')
  assert.equal(service.placement, 'root')
  assert.equal(service.url, 'http://localhost:{port}/')
  assert.equal(service.status, 'approved')

  // --- Un agent, à la demande seulement : une tâche sans cadence.
  await open()
  await editor.getByRole('radio', { name: /^Un agent/ }).click()
  await editor.getByRole('textbox', { name: 'Libellé', exact: true }).fill('Revue (éditeur)')
  await editor.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Réponds seulement « OK ».')
  await editor.getByRole('radio', { name: /^Nouveau worktree/ }).click()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'editor-agent.png') })
  await save.click()
  await editor.waitFor({ state: 'hidden' })
  const task = (await api('/api/schedules')).find((entry) => entry.projectId === project.id && entry.name === 'Revue (éditeur)')
  assert.ok(task, 'la tâche d’agent est créée')
  assert.equal(task.cadence, null)
  assert.equal(task.onDemand, true)
  assert.equal(task.worktreeMode, 'new')

  // --- Modifier : l'éditeur relit l'action, sa nature est figée.
  await page.locator('li', { hasText: 'Aperçu statique' }).getByRole('button', { name: 'Plus' }).click()
  await page.getByRole('menuitem', { name: 'Modifier' }).click()
  assert.equal(await editor.getByRole('textbox', { name: 'Libellé', exact: true }).inputValue(), 'Aperçu statique')
  assert.equal(await editor.getByRole('radio', { name: /^Un agent/ }).count(), 0)
  assert.equal(await editor.getByRole('radio', { name: /^Toujours la racine du projet/ }).getAttribute('aria-checked'), 'true')
  await editor.getByRole('button', { name: 'Annuler', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  void context
}

/**
 * Le tiroir unifié d'une action (`ActionDrawer`), monté seul sur les fixtures de ses
 * stories : dans le tiroir commun et en pile dans le panneau. La relecture montre ce qui
 * a changé ; « Modifier » bascule le même tiroir et Annuler y revient ; en pile, Échap
 * remonte d'un niveau ; Supprimer se confirme sur place, et Échap annule la confirmation.
 */
async function checkDrawer(base) {
  const modules = {
    query: await viteDependency(base, '@tanstack/react-query', '/src/lib/conversation-config.ts'),
    router: await viteDependency(base, 'react-router-dom', '/src/components/chat/MessageBubble.tsx'),
    ui: await viteDependency(base, '@solera/ui', '/src/components/ImageThumbnail.tsx'),
  }
  for (const width of [1280, 390]) {
    const touch = width < 700
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch, locale: 'fr-FR', serviceWorkers: 'block' })
    const errors = []
    const mount = async (story) => {
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route(`${base}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="bg-canvas"><div id="check"></div></body></html>' }))
      await page.route(`${base}/api/**`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
      await page.goto(base)
      await page.evaluate(async ({ modules, story }) => {
        const refresh = (await import('/@react-refresh')).default
        refresh.injectIntoGlobalHook(window)
        window.$RefreshReg$ = () => {}
        window.$RefreshSig$ = () => (type) => type
        window.__vite_plugin_react_preamble_installed__ = true
        localStorage.setItem('solera.locale', 'fr')
        await (await import('/src/lib/i18n/index.ts')).initLocale()
        document.documentElement.dataset.theme = 'dark'
        await import('/src/styles/index.css')
        const React = (await import('/node_modules/.vite/deps/react.js')).default
        const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
        const { QueryClient, QueryClientProvider } = await import(modules.query)
        const { MemoryRouter } = await import(modules.router)
        const { TooltipProvider } = await import(modules.ui)
        const stories = await import('/src/components/automations/ActionDrawer.stories.tsx')
        const h = React.createElement
        const args = { ...stories.default.args, ...(stories[story].args ?? {}) }
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        createRoot(document.getElementById('check')).render(
          h(QueryClientProvider, { client }, h(MemoryRouter, null, h(TooltipProvider, null, h(stories.default.component, args)))),
        )
      }, { modules, story })
      return page
    }

    // Dans le tiroir commun : l'état, la frise, l'extrait du dernier échec déplié d'office.
    let page = await mount('Planifiee')
    let drawer = page.getByRole('dialog', { name: 'Tests de bout en bout', exact: true })
    await drawer.getByText('Dernier passage échoué il y a 21 h (code 1).').waitFor()
    await drawer.getByRole('img', { name: 'Les 16 derniers passages' }).waitFor()
    await drawer.getByLabel('Sortie du passage').getByText('1 failed', { exact: false }).waitFor()
    await drawer.getByText('Prochain passage :', { exact: false }).waitFor()
    assert.equal(await drawer.getByText(/^puis /).count(), 2)
    await page.screenshot({ path: join(shots, `drawer-detail-${width}.png`) })
    // « Modifier » bascule le même tiroir, Annuler revient au détail.
    await drawer.getByRole('button', { name: 'Modifier', exact: true }).click()
    const editing = page.getByRole('dialog', { name: 'Modifier « Tests de bout en bout »', exact: true })
    assert.equal(await editing.getByRole('textbox', { name: 'Libellé', exact: true }).inputValue(), 'Tests de bout en bout')
    await editing.getByRole('button', { name: 'Annuler', exact: true }).click()
    await drawer.getByText('Dernier passage échoué', { exact: false }).waitFor()
    // Dupliquer : une nouvelle action, « (copie) ».
    await drawer.getByRole('button', { name: 'Dupliquer', exact: true }).click()
    const copy = page.getByRole('dialog', { name: 'Nouvelle action', exact: true })
    assert.equal(await copy.getByRole('textbox', { name: 'Libellé', exact: true }).inputValue(), 'Tests de bout en bout (copie)')
    await copy.getByRole('button', { name: 'Annuler', exact: true }).click()
    // Supprimer se confirme sur place ; Échap annule la confirmation, pas le tiroir.
    await drawer.getByRole('button', { name: 'Supprimer', exact: true }).click()
    await drawer.getByText('Supprimer « Tests de bout en bout » ?').waitFor()
    await page.keyboard.press('Escape')
    await drawer.getByRole('button', { name: 'Dupliquer', exact: true }).waitFor()
    assert.equal(await drawer.getByText('Supprimer « Tests de bout en bout » ?').count(), 0)
    await drawer.getByRole('button', { name: 'Fermer', exact: true }).click()
    await drawer.waitFor({ state: 'detached' })
    await page.close()

    // La relecture d'une commande modifiée : ce qui a changé, champ par champ.
    page = await mount('Relecture')
    drawer = page.getByRole('dialog', { name: 'Déployer la préprod', exact: true })
    const review = drawer.getByRole('region', { name: 'Relecture' })
    const changes = review.getByRole('group', { name: 'Ce qui a changé depuis la dernière validation' })
    await changes.locator('del').first().waitFor()
    assert.deepEqual(await changes.locator('del').allTextContents(), ['- pnpm build && ./scripts/deploy.sh --env staging', '- dossier : (aucun)'])
    assert.deepEqual(await changes.locator('ins').allTextContents(), ['+ pnpm build && ./scripts/deploy.sh --env staging --force', '+ dossier : apps/web'])
    await review.getByRole('button', { name: 'Valider', exact: true }).waitFor()
    await review.getByRole('button', { name: 'Refuser', exact: true }).waitFor()
    await review.screenshot({ path: join(shots, `drawer-review-${width}.png`) })
    await page.close()

    // « Planifier une action existante » : ni le déjà planifié, ni ce qui attend une relecture.
    page = await mount('Choisir')
    drawer = page.getByRole('dialog', { name: 'Planifier une action existante', exact: true })
    await drawer.getByText('Pas encore planifiées · 3').waitFor()
    await drawer.getByRole('button', { name: 'Planifier « Sauvegarde »', exact: true }).click()
    await page.getByRole('dialog', { name: 'Modifier « Sauvegarde »', exact: true }).getByRole('checkbox', { name: /^Planifiée/ }).waitFor()
    await page.close()

    // En pile dans le panneau : « ‹ Actions » au lieu du ✕, Échap remonte d'un niveau.
    page = await mount('Panneau')
    const stack = page.locator('[data-action-stack]')
    await stack.getByText('Dernier passage échoué', { exact: false }).waitFor()
    assert.equal(await stack.getByRole('button', { name: 'Fermer', exact: true }).count(), 0)
    await stack.getByRole('button', { name: 'Actions', exact: true }).waitFor()
    await page.screenshot({ path: join(shots, `drawer-panel-${width}.png`) })
    await stack.getByRole('button', { name: 'Modifier', exact: true }).click()
    await stack.getByRole('textbox', { name: 'Libellé', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await stack.getByText('Dernier passage échoué', { exact: false }).waitFor()
    await page.keyboard.press('Escape')
    await stack.waitFor({ state: 'detached' })
    await page.close()

    assert.deepEqual(errors, [])
    await context.close()
  }
}

/**
 * Le détail d'une action, ouvert en pile dans le panneau, sur la vraie API : ses passages
 * (code, extrait de la sortie), la pause d'une commande planifiée enregistrée et lue tout
 * de suite, Dupliquer, Échap qui remonte d'un niveau, et Supprimer confirmé sur place.
 */
async function checkDetail(page, base, project, api, context) {
  const actionsTab = page.locator('button[aria-pressed][aria-label^="Actions"]')
  const stack = page.locator('[data-action-stack]')
  const list = page.locator(':not([data-command-runs]) > ul', { hasText: 'Dire bonjour' }).first()
  await actionsTab.click()

  // Les passages de « Dire bonjour » : le code, et la fin de sa sortie dépliée d'office.
  await list.getByRole('button', { name: 'Dire bonjour', exact: true }).click()
  await stack.getByText(/^Dernier passage échoué il y a .* \(code 2\)\.$/).waitFor()
  await stack.locator('[data-run]').first().getByText('code 2').waitFor()
  await stack.getByLabel('Sortie du passage').getByText('hello-from-action', { exact: false }).waitFor({ timeout: 15000 })
  // Un agent l'a modifiée depuis (la relecture refusée plus haut) : l'origine le dit.
  await stack.getByText('Proposée par un agent dans', { exact: false }).waitFor()
  // Depuis une conversation, « Lancer » part droit dans son arbre : pas de chevron.
  await stack.getByRole('button', { name: 'Lancer « Dire bonjour »', exact: true }).first().waitFor()
  assert.equal(await stack.getByRole('button', { name: 'Lancer « Dire bonjour » dans…', exact: true }).count(), 0)
  await page.screenshot({ path: join(shots, 'detail-runs-1280.png') })
  await page.keyboard.press('Escape')
  await stack.waitFor({ state: 'detached' })

  // Une commande planifiée : la pause s'enregistre, et se lit tout de suite.
  const created = await context.request.post(`${base}/api/projects/${project.id}/actions`, {
    data: { label: 'Nettoyer', kind: 'task', command: 'echo nettoyage', schedule: { cadence: { kind: 'cron', expression: '0 3 * * *' }, maxDurationMinutes: 10 } },
  })
  assert.equal(created.status(), 201, await created.text())
  const nightly = await created.json()
  const scheduleOf = async () => (await api('/api/actions')).find((entry) => entry.id === nightly.id)?.schedule
  const until = async (check) => {
    for (let i = 0; i < 50 && !(await check()); i++) await delay(100)
    assert.ok(await check())
  }
  // La liste se relit toutes les dix secondes.
  await list.getByRole('button', { name: 'Nettoyer', exact: true }).click({ timeout: 15000 })
  await stack.getByText('Prochain passage :', { exact: false }).waitFor()
  await stack.getByRole('button', { name: 'Mettre en pause', exact: true }).click()
  await stack.getByText(/\(en pause\)$/).first().waitFor()
  await stack.getByText('— en pause', { exact: false }).waitFor()
  assert.equal(await stack.getByText('Prochain passage :', { exact: false }).count(), 0)
  await until(async () => (await scheduleOf())?.enabled === false)
  await page.screenshot({ path: join(shots, 'detail-paused-1280.png') })
  await stack.getByRole('button', { name: 'Reprendre', exact: true }).click()
  await stack.getByText('Prochain passage :', { exact: false }).waitFor()
  await until(async () => (await scheduleOf())?.enabled === true)

  // Dupliquer ouvre l'éditeur sur une copie ; Annuler revient au détail.
  await stack.getByRole('button', { name: 'Dupliquer', exact: true }).click()
  assert.equal(await stack.getByRole('textbox', { name: 'Libellé', exact: true }).inputValue(), 'Nettoyer (copie)')
  await stack.getByRole('button', { name: 'Annuler', exact: true }).click()
  await stack.getByRole('heading', { name: 'Nettoyer', exact: true }).waitFor()
  // Échap remonte d'un niveau : de l'édition au détail d'où l'on vient.
  await stack.getByRole('button', { name: 'Modifier', exact: true }).click()
  await stack.getByRole('textbox', { name: 'Libellé', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await stack.getByRole('button', { name: 'Mettre en pause', exact: true }).waitFor()

  // Supprimer se confirme sur place ; Échap annule la confirmation seule.
  await stack.getByRole('button', { name: 'Supprimer', exact: true }).click()
  await stack.getByText('Supprimer « Nettoyer » ?').waitFor()
  await page.keyboard.press('Escape')
  await stack.getByRole('button', { name: 'Dupliquer', exact: true }).waitFor()
  await stack.getByRole('button', { name: 'Supprimer', exact: true }).click()
  await stack.getByRole('button', { name: 'Supprimer', exact: true }).click()
  await stack.waitFor({ state: 'detached' })
  await until(async () => (await api('/api/actions')).every((entry) => entry.id !== nightly.id))
}

/**
 * « Ce qu'il sert » (`components/automations/served/`), monté seul sur les fixtures de ses
 * stories : la ligne d'une tuile, « Servir… » et son dialogue, le bloc du détail, « Où
 * tourne-t-il ». Au doigt, « Servir… » fait 44 px comme les autres gestes de la tuile.
 */
async function checkServed(base) {
  const modules = {
    query: await viteDependency(base, '@tanstack/react-query', '/src/lib/conversation-config.ts'),
    router: await viteDependency(base, 'react-router-dom', '/src/components/chat/MessageBubble.tsx'),
    ui: await viteDependency(base, '@solera/ui', '/src/components/ImageThumbnail.tsx'),
  }
  for (const width of [1280, 390]) {
    const touch = width < 700
    const context = await browser.newContext({ viewport: { width, height: 1400 }, hasTouch: touch, isMobile: touch, locale: 'fr-FR', serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route(`${base}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="bg-canvas"><div id="check" style="padding:16px"></div></body></html>' }))
    await page.route(`${base}/api/**`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await page.goto(base)
    await page.evaluate(async (modules) => {
      const refresh = (await import('/@react-refresh')).default
      refresh.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
      localStorage.setItem('solera.locale', 'fr')
      await (await import('/src/lib/i18n/index.ts')).initLocale()
      document.documentElement.dataset.theme = 'dark'
      await import('/src/styles/index.css')
      const React = (await import('/node_modules/.vite/deps/react.js')).default
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
      const { QueryClient, QueryClientProvider } = await import(modules.query)
      const { MemoryRouter } = await import(modules.router)
      const { TooltipProvider } = await import(modules.ui)
      const stories = await import('/src/components/automations/served/Served.stories.tsx')
      const h = React.createElement
      const part = (name, story) => h('section', { 'data-part': name, style: { marginBottom: '20px' } }, story.render())
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      createRoot(document.getElementById('check')).render(
        h(QueryClientProvider, { client }, h(MemoryRouter, null, h(TooltipProvider, null,
          part('tile', stories.Tuile), part('block', stories.Bloc), part('pinned', stories.BlocFixe), part('placement', stories.Placement),
          part('instances', stories.ParArbre)))),
      )
    }, modules)

    // La tuile : la branche abrégée, le commit, le retard, les non commités.
    const tile = page.locator('[data-part="tile"]')
    const line = tile.locator('span[title="/srv/nimbus/.worktrees/w1/apps/api"]')
    await line.waitFor()
    const said = await line.textContent()
    assert.match(said, /^sert\s*feat\/905-vue-horizon-et-ses…@ e4f5a6b3/)
    // ↓ et ● se disent aussi en toutes lettres, l'infobulle n'existant pas au doigt.
    assert.match(said, /3 commits en retard sur la base●22 fichiers non commités, servis tels quels$/)
    assert.equal(await line.locator('[title="Fichiers non commités : c’est l’arbre de travail qui est servi"]').count(), 1)
    const serve = tile.getByRole('button', { name: 'Servir une autre branche avec « API »', exact: true })
    assert.equal(Math.round((await serve.boundingBox()).height), touch ? 44 : 36)
    await page.screenshot({ path: join(shots, `served-tile-${width}.png`), clip: await tile.boundingBox() })
    // « Servir… » : la racine et les worktrees, sans l'arbre servi ni le fusionné.
    await serve.click()
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['la racine (main)', 'fix/connexion-lente'])
    await page.screenshot({ path: join(shots, `served-menu-${width}.png`) })
    await page.getByRole('menuitem', { name: 'fix/connexion-lente' }).click()
    const dialog = page.getByRole('dialog', { name: '« API » sert déjà feat/905-vue-horizon-et-ses-jalons' })
    await dialog.waitFor()
    assert.match(await dialog.textContent(), /Il tourne depuis feat\/905-vue-horizon-et-ses-jalons sur :8080\. Le basculer sur fix\/connexion-lente le redémarre : ce que tu as ouvert dans le navigateur se recharge\./)
    assert.equal(await dialog.getByRole('link', { name: 'Ouvrir plutôt celui qui tourne' }).getAttribute('href'), 'http://127.0.0.1:8080')
    await dialog.getByRole('button', { name: 'Basculer sur fix/connexion-lente' }).waitFor()
    await page.screenshot({ path: join(shots, `served-dialog-${width}.png`) })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })

    // Le bloc du détail : l'arbre mène à Travail, les non commités sont servis tels quels.
    const block = page.locator('[data-part="block"]')
    assert.equal(await block.getByRole('link', { name: 'w1' }).getAttribute('href'), '/p/p-nimbus/travail?arbre=%2Fsrv%2Fnimbus%2F.worktrees%2Fw1')
    await block.getByText('2 fichiers — servis tels quels (HMR)').waitFor()
    await block.getByText('4 en avance').waitFor()
    await block.getByText('3 en retard').waitFor()
    await block.getByText('#905 Vue horizon · Jalon #900').waitFor()
    await block.getByRole('button', { name: 'Servir une autre branche…' }).waitFor()
    await page.screenshot({ path: join(shots, `served-block-${width}.png`), clip: await block.boundingBox() })
    // Fixé à la racine, il ne se bascule pas, et le bloc le dit.
    const pinned = page.locator('[data-part="pinned"]')
    await pinned.getByText('Il sert toujours la racine du projet : son placement le fixe.').waitFor()
    assert.equal(await pinned.getByRole('button', { name: 'Servir une autre branche…' }).count(), 0)

    // « Où tourne-t-il » : la première conseillée et choisie, la quatrième un cas limite.
    const placement = page.locator('[data-part="placement"]')
    const follow = placement.getByRole('radio', { name: /^Une seule instance, qu’on bascule/ })
    assert.equal(await follow.getAttribute('aria-checked'), 'true')
    assert.match(await follow.textContent(), /conseillé/)
    const perTree = placement.getByRole('radio', { name: /^Une instance par worktree/ })
    assert.equal(await perTree.isDisabled(), false)
    assert.match(await perTree.textContent(), /cas limite/)
    await placement.getByRole('radio', { name: /^Toujours une branche/ }).click()
    await placement.getByText('La racine est sur cette branche : il y tournera.').waitFor()
    await page.screenshot({ path: join(shots, `served-placement-${width}.png`), clip: await placement.boundingBox() })

    // Une instance par worktree : chacune son arbre, son port et son lien ; l'échec dit d'où.
    const instances = page.locator('[data-part="instances"]')
    const list = instances.getByRole('list', { name: 'Ses instances, une par arbre' })
    assert.equal(await list.getByRole('listitem').count(), 3)
    assert.equal(await list.getByRole('link', { name: ':41873' }).getAttribute('href'), 'http://127.0.0.1:41873')
    assert.equal(await list.getByRole('link', { name: ':41207' }).getAttribute('href'), 'http://127.0.0.1:41207')
    await list.getByRole('link', { name: 'Racine du projet' }).waitFor()
    await list.getByText('en échec').waitFor()
    await list.getByText('/srv/nimbus/.worktrees/w2', { exact: true }).waitFor()
    await page.screenshot({ path: join(shots, `served-instances-${width}.png`), clip: await instances.boundingBox() })
    assert.deepEqual(errors, [])
    await context.close()
  }
}

/**
 * L'onglet Actions d'un projet (AC-19), de bout en bout sur la vraie API, à 1280 puis à
 * 390 px : le Lanceur (groupes, tuiles de taille égale, un seul geste), la barre (recherche,
 * Filtrer ▾, puces, méta, Affichage ▾, + Action ▾), la Liste par état, l'Agenda, et le
 * tiroir que `?action=` et `?nouvelle=` ouvrent et suivent. Sur Atlas API, que la démo
 * laisse sans action : rien d'autre ne s'y mêle.
 */
async function checkProjectTab(base, env, api) {
  const project = (await api('/api/projects')).find((entry) => entry.name === 'Atlas API')
  const conversation = (await api(`/api/projects/${project.id}/conversations`))[0]
  assert.ok(conversation, 'Atlas API a une conversation de démo')
  const request = await browser.newContext()
  await request.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  const create = async (data) => {
    const response = await request.request.post(`${base}/api/projects/${project.id}/actions`, { data })
    assert.equal(response.status(), 201, await response.text())
    return response.json()
  }
  const hello = await create({ label: 'Bonjour', kind: 'task', command: 'echo hello-from-tab' })
  const backup = await create({
    label: 'Sauvegarde', kind: 'task', command: 'echo sauvegarde',
    schedule: { cadence: { kind: 'cron', expression: '0 3 * * *' }, maxDurationMinutes: 30 },
  })
  const doomed = await create({ label: 'À supprimer', kind: 'task', command: 'true' })
  const proposed = await mcp(env, conversation.id, project.id, 'register_action', {
    label: 'Statique', kind: 'service', command: 'python3 -m http.server --bind 127.0.0.1 0', description: 'Proposé par un agent',
  })
  assert.ok(!proposed.isError, proposed.content[0].text)
  const tab = `${base}/p/${project.id}/actions`
  const idOf = (action) => `a-${action.id}`

  for (const width of [1280, 390]) {
    const phone = width < 500
    const context = await browser.newContext({
      viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, locale: 'fr-FR', serviceWorkers: 'block',
    })
    await context.addInitScript((origin) => {
      if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
    }, new URL(base).origin)
    await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const search = () => new URL(page.url()).searchParams
    const tile = (label) => page.locator('[data-action-tile]', { has: page.getByText(label, { exact: true }) })

    // Le Lanceur par défaut : Services, Commandes, Agents, chacun avec sa tuile d'ajout.
    await page.goto(tab)
    for (const group of ['Services', 'Commandes', 'Agents']) await page.getByRole('heading', { name: group, exact: true }).waitFor()
    for (const add of ['Nouveau service', 'Nouvelle commande', 'Nouvelle tâche d’agent']) await page.getByRole('button', { name: add, exact: true }).waitFor()
    // À 1280, rien n'a encore tourné ; à 390, « Bonjour » a été lancée et « À supprimer » n'est plus.
    await tile('Bonjour').getByText(phone ? /^Réussie/ : 'Jamais lancée').waitFor()
    await tile('Sauvegarde').getByText('À 03:00').waitFor()
    await tile('Statique').getByRole('button', { name: 'Relire « Statique »', exact: true }).waitFor()
    // Des tuiles de taille égale, une colonne au téléphone ; rien ne déborde de la page.
    const boxes = await page.locator('[data-action-tile]').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))
    // À 390, « À supprimer » n'est plus, et « Statique servi » s'est ajouté là où systemd le permet.
    assert.equal(boxes.length, phone && !linuxServices ? 3 : 4)
    assert.ok(boxes.every((box) => Math.abs(box.height - 152) < 1), `tuiles de 9,5 rem : ${boxes.map((box) => box.height)}`)
    assert.ok(boxes.every((box) => Math.abs(box.width - boxes[0].width) < 1), 'tuiles de même largeur')
    if (phone) assert.ok(boxes.every((box) => Math.abs(box.x - boxes[0].x) < 1), 'une colonne au téléphone')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: join(shots, `tab-launcher-${width}.png`) })

    // Le compte de l'onglet dans la rangée (ACT-2) : ce qui attend passe avant ce qui
    // tourne, en ambre.
    const actionsCount = page.getByRole('navigation', { name: 'Vues du projet', exact: true })
      .getByRole('link', { name: /^Actions/ }).locator('span[title]')
    if (!phone) {
      assert.equal(await actionsCount.getAttribute('title'), '1 à relire')
      assert.match(await actionsCount.getAttribute('class'), /text-caution/)
    }

    // La méta et Filtrer ▾ : un filtre pose sa puce, la puce l'efface.
    const chips = page.locator('[data-filter-chip]')
    if (!phone) {
      await page.getByRole('button', { name: '1 à relire', exact: true }).click()
      await chips.getByText('À relire').waitFor()
      await tile('Bonjour').waitFor({ state: 'detached' })
      assert.equal(await page.locator('[data-action-tile]').count(), 1)
      await chips.getByRole('button', { name: 'Retirer ce filtre' }).click()
      await tile('Bonjour').waitFor()
    }
    await page.getByRole('button', { name: 'Filtrer', exact: true }).click()
    const filters = page.getByRole('dialog', { name: 'Filtrer' })
    await filters.getByRole('checkbox', { name: /^Planifiées/ }).click()
    await filters.getByRole('checkbox', { name: /^Planifiées/ }).getByText('1').waitFor()
    await page.keyboard.press('Escape')
    await chips.getByText('Planifiées').waitFor()
    assert.equal(await page.locator('[data-action-tile]').count(), 1)
    await chips.getByRole('button', { name: 'Retirer ce filtre' }).click()
    // La recherche lit le libellé et la commande.
    await page.getByRole('searchbox', { name: 'Chercher une action' }).fill('hello-from')
    await tile('Sauvegarde').waitFor({ state: 'detached' })
    assert.equal(await page.locator('[data-action-tile]').count(), 1)
    // Rien ne correspond : le Lanceur garde ses groupes et leurs tuiles d'ajout (LAN-1).
    await page.getByRole('searchbox', { name: 'Chercher une action' }).fill('rien-de-tel')
    await page.locator('[data-action-tile]').first().waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Nouvelle commande', exact: true }).waitFor()
    await page.getByRole('searchbox', { name: 'Chercher une action' }).fill('')
    await tile('Sauvegarde').waitFor()

    // « Lancer ▾ » : le chevron propose la racine du projet, puis ses arbres.
    await tile('Bonjour').getByRole('button', { name: 'Lancer « Bonjour » dans…', exact: true }).click()
    await page.getByRole('menuitem', { name: 'La racine du projet', exact: true }).waitFor()
    await page.keyboard.press('Escape')

    // Le libellé ouvre le détail, l'adresse le dit ; Échap le ferme et l'adresse l'oublie.
    await tile('Bonjour').getByRole('button', { name: /^Bonjour/ }).click()
    const detail = page.getByRole('dialog', { name: 'Bonjour', exact: true })
    await detail.waitFor()
    assert.equal(search().get('action'), idOf(hello))
    await page.keyboard.press('Escape')
    await detail.waitFor({ state: 'hidden' })
    assert.equal(search().get('action'), null)

    // « Relire » ouvre le détail sur la relecture.
    await tile('Statique').getByRole('button', { name: 'Relire « Statique »', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Statique', exact: true })
    await review.getByText('python3 -m http.server --bind 127.0.0.1 0').first().waitFor()
    await page.screenshot({ path: join(shots, `tab-review-${width}.png`) })
    await page.keyboard.press('Escape')
    await review.waitFor({ state: 'hidden' })

    // Lancer : la commande part à la racine, son passage s'ouvre dans le tiroir.
    if (!phone) {
      await tile('Bonjour').getByRole('button', { name: 'Lancer « Bonjour »', exact: true }).click()
      const run = page.getByRole('dialog', { name: 'Passage de « Bonjour »' })
      await run.getByText('hello-from-tab').first().waitFor({ timeout: 15000 })
      assert.equal(search().get('action'), idOf(hello))
      await page.screenshot({ path: join(shots, `tab-run-${width}.png`) })
      // Dans le tiroir commun, Échap le ferme d'un coup ; l'adresse l'oublie.
      await page.keyboard.press('Escape')
      await run.waitFor({ state: 'hidden' })
      assert.equal(search().get('action'), null)
      await tile('Bonjour').getByText(/^Réussie/).waitFor({ timeout: 15000 })
    }

    // ⋯ : Dupliquer ouvre l'éditeur sur une copie.
    await tile('Bonjour').getByRole('button', { name: 'Plus pour « Bonjour »', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click()
    const copy = page.getByRole('dialog', { name: 'Nouvelle action', exact: true })
    assert.equal(await copy.getByRole('textbox', { name: 'Libellé', exact: true }).inputValue(), 'Bonjour (copie)')
    await copy.getByRole('button', { name: 'Annuler', exact: true }).click()
    await copy.waitFor({ state: 'hidden' })

    // + Action ▾ : planifier une action existante.
    await page.getByRole('button', { name: 'Nouvelle action', exact: true }).click()
    await page.getByRole('button', { name: /^Planifier une action existante…/ }).click()
    const pick = page.getByRole('dialog', { name: 'Planifier une action existante', exact: true })
    await pick.getByRole('button', { name: 'Planifier « Bonjour »', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await pick.waitFor({ state: 'hidden' })

    // L'adresse ouvre le tiroir : ?nouvelle= l'éditeur pré-réglé, ?action= le détail.
    await page.goto(`${tab}?nouvelle=service`)
    const fresh = page.getByRole('dialog', { name: 'Nouvelle action', exact: true })
    assert.equal(await fresh.getByRole('radio', { name: /^Service/ }).getAttribute('aria-checked'), 'true')
    await fresh.getByRole('button', { name: 'Annuler', exact: true }).click()
    await fresh.waitFor({ state: 'hidden' })
    assert.equal(search().get('nouvelle'), null)
    await page.goto(`${tab}?action=${idOf(backup)}`)
    await page.getByRole('dialog', { name: 'Sauvegarde', exact: true }).waitFor()
    await page.keyboard.press('Escape')

    // Affichage ▾ : la Liste, par état.
    await page.getByRole('button', { name: 'Affichage : Lanceur' }).click()
    await page.getByRole('radio', { name: 'Liste' }).click()
    await page.keyboard.press('Escape')
    for (const section of ['À relire', 'Planifiées', 'À la demande']) await page.getByRole('heading', { name: section, exact: true }).waitFor()
    const row = (label) => page.locator('[data-action-row]', { has: page.getByText(label, { exact: true }) })
    await row('Statique').getByRole('button', { name: 'Relire « Statique »', exact: true }).waitFor()
    await row('Bonjour').getByRole('button', { name: 'Lancer « Bonjour »', exact: true }).waitFor()
    await row('Sauvegarde').getByText('dans', { exact: false }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: join(shots, `tab-list-${width}.png`) })
    // « Planifier » d'une action à la demande ouvre l'éditeur sur Quand.
    await row('Bonjour').getByRole('button', { name: /Planifier/ }).click()
    const when = page.getByRole('dialog', { name: 'Modifier « Bonjour »', exact: true })
    assert.equal(await when.getByRole('checkbox', { name: /^Planifiée/ }).getAttribute('aria-checked'), 'true')
    await when.getByRole('button', { name: 'Annuler', exact: true }).click()

    // L'Agenda ; la vue choisie se retient pour le projet.
    await page.getByRole('button', { name: 'Affichage : Liste' }).click()
    await page.getByRole('radio', { name: 'Agenda' }).click()
    // En Agenda, « Affichage ▾ » règle aussi la période (AO-5).
    await page.getByRole('radiogroup', { name: 'Période' }).getByRole('radio', { name: 'Jour', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('radio', { name: 'Jour', exact: true }).and(page.locator('[aria-checked="true"]')).first().waitFor()
    await page.getByRole('button', { name: 'Affichage : Agenda' }).click()
    await page.getByRole('radiogroup', { name: 'Période' }).getByRole('radio', { name: 'Semaine', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.locator(':text("Sauvegarde"):visible').first().waitFor()
    await page.screenshot({ path: join(shots, `tab-agenda-${width}.png`) })
    await page.goto(tab)
    await page.getByRole('button', { name: 'Affichage : Agenda' }).waitFor()
    await page.getByRole('button', { name: 'Affichage : Agenda' }).click()
    await page.getByRole('radio', { name: 'Lanceur' }).click()
    await page.keyboard.press('Escape')

    // Un service, allumé et éteint depuis l'onglet (LAN-7, AO-4, LST-3), pour de vrai.
    if (!phone && linuxServices) {
      const port = await freePort()
      const served = await create({ label: 'Statique servi', kind: 'service', command: `python3 -m http.server --bind 127.0.0.1 ${port}`, url: 'http://127.0.0.1:{port}/' })
      tabUnits.push(`solera-app-action-${served.id.slice(0, 8)}.service`)
      await tile('Statique servi').getByRole('switch', { name: 'Démarrer « Statique servi »' }).click()
      await tile('Statique servi').getByText(/^En marche ·/).waitFor({ timeout: 20000 })
      await tile('Statique servi').getByRole('link', { name: /^Ouvrir/ }).waitFor()
      await page.getByRole('button', { name: '1 en marche', exact: true }).waitFor()
      assert.equal(await actionsCount.getAttribute('title'), '1 à relire', 'l’ambre reste devant le vert')
      await page.getByRole('button', { name: '1 en marche', exact: true }).click()
      await chips.getByText('En cours').waitFor()
      assert.equal(await page.locator('[data-action-tile]').count(), 1)
      await page.screenshot({ path: join(shots, `tab-service-${width}.png`) })
      await chips.getByRole('button', { name: 'Retirer ce filtre' }).click()
      await page.getByRole('button', { name: 'Affichage : Lanceur' }).click()
      await page.getByRole('radio', { name: 'Liste' }).click()
      await page.keyboard.press('Escape')
      const live = page.locator('section', { has: page.getByRole('heading', { name: 'En cours', exact: true }) })
      await live.getByRole('button', { name: 'Arrêter « Statique servi »', exact: true }).click()
      await live.waitFor({ state: 'detached', timeout: 20000 })
      await page.getByRole('button', { name: 'Affichage : Liste' }).click()
      await page.getByRole('radio', { name: 'Lanceur' }).click()
      await page.keyboard.press('Escape')
      await tile('Statique servi').getByRole('switch', { name: 'Démarrer « Statique servi »' }).waitFor()
    }

    // ⋯ Supprimer, confirmé.
    if (!phone) {
      await tile('À supprimer').getByRole('button', { name: 'Plus pour « À supprimer »' }).click()
      await page.getByRole('menuitem', { name: 'Supprimer' }).click()
      await page.getByRole('dialog', { name: 'Supprimer « À supprimer » ?' }).getByRole('button', { name: 'Supprimer', exact: true }).click()
      await tile('À supprimer').waitFor({ state: 'detached' })
      assert.equal((await api('/api/actions')).some((entry) => entry.id === doomed.id), false)
    }

    assert.deepEqual(errors, [])
    await context.close()
  }
  for (const action of await api('/api/actions')) {
    if (action.projectId === project.id) await request.request.delete(`${base}/api/actions/${action.id}`)
  }
  await request.close()
}

/**
 * L'onglet Actions du portefeuille (#241, PF-32 à PF-37) : les actions de deux projets,
 * rangées par projet ; les filtres Projet, Quoi, Quand et la recherche sur le nom du
 * projet ; ce qui tourne sur l'instance ; la Liste et l'Agenda ; et chaque geste qui
 * ouvre quelque chose mène à l'onglet Actions du projet.
 */
async function checkPortfolioTab(base, env, api) {
  const projects = await api('/api/projects')
  const atlas = projects.find((entry) => entry.name === 'Atlas API')
  const nimbus = projects.find((entry) => entry.name === 'Nimbus')
  const conversation = (await api(`/api/projects/${nimbus.id}/conversations`))[0]
  const request = await browser.newContext()
  await request.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  const create = async (project, data) => {
    const response = await request.request.post(`${base}/api/projects/${project.id}/actions`, { data })
    assert.equal(response.status(), 201, await response.text())
    return response.json()
  }
  const lint = await create(atlas, { label: 'Pf Lint', kind: 'task', command: 'echo pf-lint' })
  const nightly = await create(atlas, {
    label: 'Pf Nuit', kind: 'task', command: 'echo pf-nuit',
    schedule: { cadence: { kind: 'cron', expression: '0 3 * * *' }, maxDurationMinutes: 30 },
  })
  const waiting = await create(nimbus, { label: 'Pf Attente', kind: 'task', command: 'echo pf-attente; sleep 120' })
  const proposed = await mcp(env, conversation.id, nimbus.id, 'register_action', { label: 'Pf Proposée', kind: 'task', command: 'echo pf-proposee' })
  assert.ok(!proposed.isError, proposed.content[0].text)
  // Une commande qui tourne dans un terminal : elle « tourne maintenant ».
  const launched = await request.request.post(`${base}/api/actions/${waiting.id}/run`, { data: {} })
  assert.ok(launched.ok(), await launched.text())
  const tab = `${base}/projects/actions`
  const idOf = (action) => `a-${action.id}`

  for (const width of [1280, 390]) {
    const phone = width < 500
    const context = await browser.newContext({
      viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, locale: 'fr-FR', serviceWorkers: 'block',
    })
    await context.addInitScript((origin) => {
      if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
    }, new URL(base).origin)
    await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const url = () => new URL(page.url())
    const tile = (label) => page.locator('[data-action-tile]', { has: page.getByText(label, { exact: true }) })
    const launcher = (project) => page.locator(`[data-portfolio-launcher="${project.id}"]`)
    const chips = page.locator('[data-filter-chip]')
    const shot = (name) => page.screenshot({ path: join(shots, `portfolio-${name}-${width}.png`) })

    // L'onglet est dans la rangée du portefeuille, avec le compte d'un projet : ambre, « à relire » d'abord.
    await page.goto(`${base}/projects`)
    const row = page.getByRole('navigation', { name: 'Vues du portefeuille', exact: true })
    const actionsTab = row.getByRole('link', { name: /^Actions/ })
    await actionsTab.locator('[title$="à relire"]').waitFor()
    assert.match(await actionsTab.locator('[title$="à relire"]').getAttribute('title'), /^\d+ à relire$/)
    await actionsTab.click()
    await page.waitForURL(tab)

    // Le Lanceur par défaut : un groupe par projet, ses trois groupes de nature.
    await tile('Pf Lint').waitFor()
    await launcher(atlas).getByRole('link', { name: 'Atlas API', exact: true }).waitFor()
    await launcher(nimbus).getByRole('link', { name: 'Nimbus', exact: true }).waitFor()
    for (const group of ['Services', 'Commandes', 'Agents']) await launcher(atlas).getByRole('heading', { name: group, exact: true }).waitFor()
    assert.equal(await launcher(atlas).locator('[data-action-tile]', { hasText: 'Pf Attente' }).count(), 0, 'chaque projet ses tuiles')
    await launcher(nimbus).getByRole('button', { name: 'Relire « Pf Proposée »', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    // La méta : un bilan neutre, à partir de lg.
    if (!phone) assert.match(await page.locator('[data-toolbar]').getByText(/^\d+ actions$/).textContent(), /^\d+ actions$/)

    // Tourne maintenant, tous projets : la commande lancée, son projet, et la page Services.
    const runningNow = page.locator('[data-portfolio-running]')
    await runningNow.getByRole('heading', { name: 'Tourne maintenant, tous projets' }).waitFor()
    assert.equal(await runningNow.getByRole('link', { name: /^Page Services/ }).getAttribute('href'), '/services')
    const pill = runningNow.getByRole('button', { name: /Pf Attente/ })
    await pill.getByText('Nimbus').waitFor()
    await page.screenshot({ path: join(shots, `portfolio-launcher-${width}.png`) })
    await runningNow.screenshot({ path: join(shots, `portfolio-running-${width}.png`) })
    await launcher(atlas).screenshot({ path: join(shots, `portfolio-launcher-group-${width}.png`) })
    // Elle mène à son détail, dans l'onglet Actions du projet.
    await pill.click()
    await page.waitForURL((next) => next.pathname === `/p/${nimbus.id}/actions`)
    assert.equal(url().searchParams.get('action'), idOf(waiting))
    await page.getByRole('dialog', { name: 'Pf Attente', exact: true }).waitFor()
    await page.goBack()
    await tile('Pf Lint').waitFor()

    // Filtrer ▾ : le projet d'abord, avec son compte ; puis Quoi, Quand.
    await page.getByRole('button', { name: /^Filtrer/ }).click()
    const filters = page.getByRole('dialog', { name: 'Filtrer' })
    for (const heading of ['Projet', 'Quoi', 'Quand']) await filters.getByText(heading, { exact: true }).waitFor()
    await filters.getByRole('checkbox', { name: /Atlas API/ }).click()
    if (!phone) await filters.screenshot({ path: join(shots, `portfolio-filter-${width}.png`) })
    await page.keyboard.press('Escape')
    await chips.getByText('Atlas API').waitFor()
    await launcher(nimbus).waitFor({ state: 'detached' })
    await tile('Pf Nuit').waitFor()
    await page.getByRole('button', { name: /^Filtrer/ }).click()
    await filters.getByRole('checkbox', { name: /^Planifiées/ }).click()
    await page.keyboard.press('Escape')
    await chips.getByText('Planifiées').waitFor()
    await tile('Pf Lint').waitFor({ state: 'detached' })
    await tile('Pf Nuit').waitFor()
    // « Effacer tous les filtres » vide le projet et les filtres de la page.
    await page.getByRole('button', { name: /^Filtrer/ }).click()
    await filters.getByRole('button', { name: 'Effacer tous les filtres' }).click()
    await page.keyboard.press('Escape')
    await launcher(nimbus).waitFor()
    assert.equal(await chips.count(), 0)
    // Quoi : les agents seuls n'ont rien de ces projets d'essai.
    await page.getByRole('button', { name: /^Filtrer/ }).click()
    await filters.getByRole('checkbox', { name: /^Agents/ }).click()
    await page.keyboard.press('Escape')
    await tile('Pf Lint').waitFor({ state: 'detached' })
    await chips.getByRole('button', { name: 'Retirer ce filtre' }).click()
    await tile('Pf Lint').waitFor()

    // La recherche lit aussi le nom du projet.
    const search = page.getByRole('searchbox', { name: 'Chercher une action' })
    await search.fill('atlas')
    await launcher(nimbus).waitFor({ state: 'detached' })
    await tile('Pf Lint').waitFor()
    await search.fill('pf-attente')
    await launcher(atlas).waitFor({ state: 'detached' })
    await tile('Pf Attente').waitFor()
    await search.fill('rien-de-tel')
    await page.getByRole('status').getByText('Aucune action ne correspond à ces filtres.').waitFor()
    await search.fill('')

    // Une tuile d'ajout ouvre l'éditeur dans les Actions du projet, pré-réglé.
    await launcher(atlas).getByRole('button', { name: 'Nouveau service', exact: true }).click()
    await page.waitForURL((next) => next.pathname === `/p/${atlas.id}/actions`)
    assert.equal(url().searchParams.get('nouvelle'), 'service')
    await page.getByRole('dialog', { name: 'Nouvelle action' }).waitFor()
    await page.goBack()
    await tile('Pf Lint').waitFor()
    // Le libellé d'une tuile ouvre son détail, chez son projet.
    await tile('Pf Lint').getByRole('button', { name: /^Pf Lint/ }).click()
    await page.waitForURL((next) => next.searchParams.get('action') === idOf(lint))
    assert.equal(url().pathname, `/p/${atlas.id}/actions`)
    await page.getByRole('dialog', { name: 'Pf Lint', exact: true }).waitFor()
    await page.goBack()
    await tile('Pf Lint').waitFor()

    // « + Action » : dans quel projet ? Puis sa création, chez lui.
    await page.getByRole('button', { name: 'Nouvelle action', exact: true }).click()
    await page.getByRole('menu').getByText('Dans quel projet ?').waitFor()
    await page.getByRole('menuitem', { name: 'Nimbus' }).click()
    await page.waitForURL((next) => next.pathname === `/p/${nimbus.id}/actions`)
    assert.equal(url().searchParams.get('nouvelle'), '1')
    await page.goBack()
    await tile('Pf Lint').waitFor()

    // La Liste : projet, libellé et commande, nature, état ; un clic, son détail.
    await page.getByRole('button', { name: 'Affichage : Lanceur' }).click()
    await page.getByRole('radio', { name: 'Liste' }).click()
    await page.keyboard.press('Escape')
    const line = (action) => page.locator(`[data-portfolio-action="${idOf(action)}"]`)
    await line(nightly).getByText('$ echo pf-nuit').waitFor()
    await line(nightly).getByText('planifiée', { exact: true }).waitFor()
    await line(lint).getByText('à la demande', { exact: true }).waitFor()
    await line(nightly).getByText('Atlas API').waitFor()
    if (!phone) await line(lint).getByText('Commande', { exact: true }).waitFor()
    await page.locator('[data-portfolio-action]', { hasText: 'Pf Proposée' }).getByText('à relire', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await shot('list')
    await page.locator('[data-portfolio-actions-list]').screenshot({ path: join(shots, `portfolio-list-rows-${width}.png`) })
    await line(nightly).click()
    await page.waitForURL((next) => next.searchParams.get('action') === idOf(nightly))
    await page.getByRole('dialog', { name: 'Pf Nuit', exact: true }).waitFor()
    await page.goBack()

    // L'Agenda commun : sans « Tourne maintenant », la planifiée à 03:00.
    await page.getByRole('button', { name: 'Affichage : Liste' }).click()
    await page.getByRole('radio', { name: 'Agenda' }).click()
    await page.keyboard.press('Escape')
    await page.locator('[data-portfolio-actions-list]').waitFor({ state: 'detached' })
    await runningNow.waitFor({ state: 'detached' })
    await page.locator(':text("Pf Nuit"):visible').first().waitFor()
    await shot('agenda')
    // La vue se retient.
    await page.reload()
    await page.getByRole('button', { name: 'Affichage : Agenda' }).waitFor()
    await page.getByRole('button', { name: 'Affichage : Agenda' }).click()
    await page.getByRole('radio', { name: 'Lanceur' }).click()
    await page.keyboard.press('Escape')

    assert.deepEqual(errors, [])
    await context.close()
  }
  await request.request.post(`${base}/api/actions/${waiting.id}/run`, { data: { op: 'stop' } }).catch(() => {})
  for (const action of await api('/api/actions')) {
    if (action.label.startsWith('Pf ')) await request.request.delete(`${base}/api/actions/${action.id}`)
  }
  await request.close()
}

const linuxServices = process.platform === 'linux' &&
  (() => { try { execFileSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' }); return true } catch { return false } })()

try {
  const apiPort = await freePort()
  const webPort = await freePort()
  const httpPort = await freePort()
  const config = join(data, 'config.toml')
  await writeFile(config, '[agents.codex]\nenabled = false\n[agents.opencode]\nenabled = false\n')
  const env = {
    ...process.env,
    SOLERA_PORT: String(apiPort),
    SOLERA_HOST: '127.0.0.1',
    SOLERA_CONFIG: config,
    SOLERA_DATA_DIR: join(data, 'data'),
    SOLERA_WEB_ROOT: join(data, 'web'),
  }
  const server = run(['--import', 'tsx', 'src/main.ts'], serverDir, env)
  const vite = run([join(webDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], webDir, env)
  const base = `http://127.0.0.1:${webPort}`
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`, server), ready(base, vite)])
  browser = await launchBrowser()
  console.log('actions-ui-check : pièces')
  await checkPieces(base)
  console.log('actions-ui-check : ce qu\'il sert')
  await checkServed(base)
  console.log('actions-ui-check : tiroir d\'une action')
  await checkDrawer(base)

  const seed = run(['--import', 'tsx', 'src/cli/demo-seed.ts'], serverDir, env)
  const [seedCode] = await once(seed, 'exit')
  assert.equal(seedCode, 0, seed.diagnostics)

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript((origin) => {
    if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())
  const api = async (path) => (await context.request.get(`${base}${path}`)).json()
  const project = (await api('/api/projects')).find((entry) => entry.name === 'Nimbus')
  const conversation = (await api(`/api/projects/${project.id}/conversations`))[0]
  assert.ok(conversation, 'Nimbus a une conversation de démo')

  console.log('actions-ui-check : onglet Actions du projet')
  await checkProjectTab(base, env, api)
  console.log('actions-ui-check : onglet Actions du portefeuille')
  await checkPortfolioTab(base, env, api)

  // Une tâche créée depuis l'API, donc validée d'office.
  const created = await context.request.post(`${base}/api/projects/${project.id}/actions`, {
    data: { label: 'Dire bonjour', kind: 'task', command: 'echo hello-from-action; exit 2', description: 'Un essai qui échoue exprès' },
  })
  assert.equal(created.status(), 201)
  const task = await created.json()
  assert.equal(task.status, 'approved')

  // Un service proposé par un agent, par le vrai serveur MCP.
  const registered = await mcp(env, conversation.id, project.id, 'register_action', {
    label: 'Serveur statique',
    kind: 'service',
    command: `python3 -m http.server --bind 127.0.0.1 ${httpPort}`,
    description: 'Sert le dossier du projet',
    url: 'http://127.0.0.1:{port}/',
  })
  assert.ok(!registered.isError, registered.content[0].text)
  const listed = await mcp(env, conversation.id, project.id, 'list_actions', {})
  assert.match(listed.content[0].text, /Serveur statique.*en attente de validation/)
  const service = (await api('/api/actions')).find((action) => action.label === 'Serveur statique')
  serviceUnit = `solera-app-action-${service.id.slice(0, 8)}.service`
  assert.equal(service.status, 'proposed')

  // Un clic ne lance pas une action proposée.
  const refused = await context.request.post(`${base}/api/actions/${service.id}/run`, { data: {} })
  assert.equal(refused.status(), 409)

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/p/${project.id}/c/${conversation.id}`)
  const actionsTab = page.locator('button[aria-pressed][aria-label^="Actions"]')
  // Le ⚡ est retiré (ACT-5) : le bouton du panneau dit ce qu'il disait, par un point (ACT-3).
  const panelToggle = page.getByRole('button', { name: /^(Ouvrir|Fermer) le panneau/ }).first()
  await page.locator('[data-panel-dot="caution"]').waitFor()
  assert.equal(await panelToggle.getAttribute('aria-label'), 'Ouvrir le panneau — 1 à relire')
  assert.equal(await page.locator('header').getByRole('button', { name: /^Actions/ }).count(), 0, 'plus de ⚡ dans l’en-tête')
  await panelToggle.click()
  await page.getByRole('button', { name: 'Actions, 1 à relire', exact: true }).waitFor()
  await actionsTab.click()
  // La liste des actions, pas le groupe des commandes lancées ici qui la précède.
  const panel = page.locator(':not([data-command-runs]) > ul', { hasText: 'Dire bonjour' }).first()
  await panel.getByText('À relire').waitFor()
  await page.screenshot({ path: join(shots, 'actions-desktop.png') })

  // La tâche : le disque la lance, son terminal passe devant avec la sortie et le code.
  await page.getByRole('button', { name: 'Lancer : Dire bonjour' }).first().click()
  await page.locator('.xterm-rows', { hasText: 'hello-from-action' }).waitFor({ timeout: 10000 })
  await page.locator('.xterm-rows', { hasText: '[exit 2]' }).waitFor({ timeout: 10000 })
  assert.equal(await page.getByText('Connexion au terminal impossible.').count(), 0)
  await page.screenshot({ path: join(shots, 'actions-task-terminal.png') })
  await actionsTab.click()
  await panel.getByText(/Sortie en code 2/).waitFor({ timeout: 15000 })

  // Le service proposé : relu dans son détail, en pile dans le panneau (commande en
  // clair), validé sans être lancé (Q3), puis lancé d'un geste.
  await page.getByRole('button', { name: 'Relire : Serveur statique' }).first().click()
  const stack = page.locator('[data-action-stack]')
  const review = stack.getByRole('region', { name: 'Relecture' })
  await review.getByText(`$ python3 -m http.server --bind 127.0.0.1 ${httpPort}`).waitFor()
  await stack.getByText('Proposée par un agent dans', { exact: false }).waitFor()
  await page.screenshot({ path: join(shots, 'actions-review.png') })
  await review.getByRole('button', { name: 'Valider', exact: true }).click()
  await stack.waitFor({ state: 'detached' })
  assert.equal((await api('/api/actions')).find((entry) => entry.id === service.id).status, 'approved')
  assert.equal((await api('/api/actions')).find((entry) => entry.id === service.id).service?.state ?? 'inactive', 'inactive', 'valider ne lance pas')

  // Refuser une action neuve la supprime.
  const proposedAgain = await mcp(env, conversation.id, project.id, 'register_action', { label: 'Tout effacer', kind: 'task', command: 'rm -rf ./build' })
  assert.ok(!proposedAgain.isError, proposedAgain.content[0].text)
  await page.getByRole('button', { name: 'Relire : Tout effacer' }).first().click({ timeout: 15000 })
  await review.getByText('$ rm -rf ./build').waitFor()
  await review.getByRole('button', { name: 'Refuser', exact: true }).click()
  await stack.waitFor({ state: 'detached' })
  assert.equal((await api('/api/actions')).some((entry) => entry.label === 'Tout effacer'), false)

  // Refuser une commande validée qu'un agent a modifiée rétablit ce qui avait été validé.
  const modified = await mcp(env, conversation.id, project.id, 'register_action', { id: task.id, label: 'Dire bonjour', kind: 'task', command: 'echo autre-chose' })
  assert.ok(!modified.isError, modified.content[0].text)
  await page.getByRole('button', { name: 'Relire : Dire bonjour' }).first().click({ timeout: 15000 })
  const changes = review.getByRole('group', { name: 'Ce qui a changé depuis la dernière validation' })
  assert.deepEqual(await changes.locator('del').allTextContents(), ['- echo hello-from-action; exit 2'])
  assert.deepEqual(await changes.locator('ins').allTextContents(), ['+ echo autre-chose'])
  await review.getByRole('button', { name: 'Refuser', exact: true }).click()
  await stack.waitFor({ state: 'detached' })
  const restored = (await api('/api/actions')).find((entry) => entry.id === task.id)
  assert.equal(restored.command, 'echo hello-from-action; exit 2')
  assert.equal(restored.status, 'approved')

  await page.getByRole('button', { name: 'Lancer : Serveur statique' }).first().click()

  if (linuxServices) {
    await panel.getByText(`Écoute sur :${httpPort}`).waitFor({ timeout: 20000 })
    const open = panel.getByRole('link', { name: `127.0.0.1:${httpPort}/` })
    assert.equal(await open.getAttribute('href'), `http://127.0.0.1:${httpPort}/`)
    const served = await fetch(`http://127.0.0.1:${httpPort}/`).then((response) => response.status)
    assert.equal(served, 200)
    await page.screenshot({ path: join(shots, 'actions-service-running.png') })
    // Son détail dit ce qu'il sert, et l'arrête d'un geste.
    await panel.getByRole('button', { name: 'Serveur statique', exact: true }).click()
    await stack.getByText('Ce qu’il sert').waitFor()
    await stack.getByRole('button', { name: 'Arrêter', exact: true }).first().waitFor()
    await stack.getByRole('link', { name: 'Ouvrir' }).first().waitFor()
    await page.screenshot({ path: join(shots, 'actions-detail-service.png') })
    // Son journal et sa relance, sous ⋯ (Q1) ; Échap ferme le menu, puis remonte à la liste.
    await stack.getByRole('button', { name: 'Plus', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Redémarrer' }).waitFor()
    await page.getByRole('menuitem', { name: 'Journal' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('menuitem', { name: 'Journal' }).waitFor({ state: 'detached' })
    await stack.getByText('Ce qu’il sert').waitFor()
    await page.keyboard.press('Escape')
    await stack.waitFor({ state: 'detached' })

    // Plus rien à relire : l'onglet du panneau et le point passent au vert, ce qui tourne.
    const runningTab = page.getByRole('button', { name: 'Actions, 1 en marche', exact: true })
    await runningTab.waitFor()
    await page.locator('[data-panel-dot="running"]').waitFor()
    assert.match(await runningTab.locator('span.rounded-full').getAttribute('class'), /text-positive/)
    assert.equal(await panelToggle.getAttribute('aria-label'), 'Fermer le panneau — 1 en marche')
    await page.screenshot({ path: join(shots, 'actions-panel-running.png') })

    // La palette suit l'état : un service en marche s'arrête, il ne se relance pas. À
    // l'ouverture, elle propose déjà les actions du projet sous les yeux.
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Rechercher' })
    const paletteRow = (name) => palette.getByRole('button', { name })
    await palette.getByText('Actions du projet').waitFor()
    await paletteRow(/Arrêter : Serveur statique/).waitFor()
    await paletteRow(/Ouvrir : Serveur statique/).waitFor()
    assert.equal(await paletteRow(/Lancer : Serveur statique/).count(), 0)
    await page.screenshot({ path: join(shots, 'actions-palette.png') })
    await paletteRow(/Arrêter : Serveur statique/).click()
    await panel.getByText('Arrêté').waitFor({ timeout: 20000 })

    // Arrêté, le service se relance depuis la recherche de la palette, et le journal
    // s'ouvre du menu.
    await page.keyboard.press('Control+k')
    await palette.getByRole('textbox').fill('serveur statique')
    await paletteRow(/Lancer : Serveur statique/).click()
    await panel.getByText(`Écoute sur :${httpPort}`).waitFor({ timeout: 20000 })
    await panel.locator('li', { hasText: 'Serveur statique' }).getByRole('button', { name: 'Plus' }).click()
    await page.getByRole('menuitem', { name: 'Suivre le journal' }).click()
    await page.getByText('Serveur statique · logs').waitFor()
    await actionsTab.click()
    await page.getByRole('button', { name: 'Arrêter : Serveur statique' }).first().click()
    await panel.getByText('Arrêté').waitFor({ timeout: 20000 })

    // Ce qu'il sert, et la bascule réelle d'un arbre à l'autre. Démarré à la racine, il le
    // dit. Lancé depuis la conversation, dont le worktree est feat/offline-cache, alors que
    // la liste le croit encore arrêté (relue toutes les dix secondes), le serveur refuse en
    // 409 au lieu de se taire, et le refus ouvre le dialogue : « Basculer » le redémarre
    // dans le worktree. « Basculer sur » le ramène ensuite à la racine.
    console.log('actions-ui-check : bascule d\'un service')
    const started = await context.request.post(`${base}/api/actions/${service.id}/run`, { data: {} })
    assert.ok(started.ok(), await started.text())
    const offline = (await api(`/api/projects/${project.id}/worktrees`)).find((entry) => entry.git?.branch === 'feat/offline-cache')
    assert.ok(offline, 'Nimbus a le worktree feat/offline-cache')
    assert.equal(conversation.worktreeId, offline.id, 'la conversation de démo vit dans feat/offline-cache')
    let stale = true
    const actionsList = `${base}/api/actions`
    await page.route(actionsList, async (route) => {
      // La page peut abandonner la requête pendant qu'on la relit (rechargement, relecture
      // de React Query) : la route est alors déjà réglée, et il n'y a rien à rendre.
      try {
        const response = await route.fetch()
        const list = await response.json()
        for (const entry of stale ? list : []) {
          if (entry.id === service.id) entry.service = { ...entry.service, state: 'inactive', cwd: null, ports: [], startedAt: null, served: null }
        }
        await route.fulfill({ response, json: list })
      } catch (error) {
        if (!/already handled|closed/i.test(error.message)) throw error
      }
    })
    await page.reload()
    // Le panneau peut rester ouvert d'un chargement à l'autre.
    await actionsTab.or(page.getByRole('button', { name: 'Ouvrir le panneau' }).first()).first().waitFor()
    if (!(await actionsTab.isVisible())) await page.getByRole('button', { name: 'Ouvrir le panneau' }).first().click()
    await actionsTab.click()
    const row = panel.locator('li', { hasText: 'Serveur statique' })
    await row.getByRole('button', { name: 'Lancer : Serveur statique' }).click()
    const refused = page.getByRole('dialog', { name: '« Serveur statique » sert déjà la racine (main)' })
    await refused.getByText(`Il tourne depuis la racine (main) sur :${httpPort}.`, { exact: false }).waitFor()
    await refused.getByRole('link', { name: 'Ouvrir plutôt celui qui tourne' }).waitFor()
    assert.equal(await page.getByText('tourne déjà depuis').count(), 0, 'le refus ne s\'affiche pas en plus en bandeau')
    await page.screenshot({ path: join(shots, 'served-switch-dialog.png') })
    stale = false
    await refused.getByRole('button', { name: 'Basculer sur feat/offline-cache' }).click()
    await refused.waitFor({ state: 'detached', timeout: 20000 })
    await page.unroute(actionsList)
    await row.getByText('feat/offline-cache').waitFor({ timeout: 20000 })
    const moved = (await api('/api/actions')).find((entry) => entry.id === service.id)
    assert.equal(moved.service.served.worktreeId, offline.id)
    assert.equal(moved.service.cwd, offline.path)
    assert.equal(await fetch(`http://127.0.0.1:${httpPort}/`).then((response) => response.status), 200)
    await page.screenshot({ path: join(shots, 'served-switched.png') })

    // « Basculer sur » depuis le menu de la ligne : retour à la racine.
    await row.getByRole('button', { name: 'Plus' }).click()
    await page.getByRole('menuitem', { name: 'la racine (main)' }).click()
    const back = page.getByRole('dialog', { name: '« Serveur statique » sert déjà feat/offline-cache' })
    await back.getByRole('button', { name: 'Basculer sur la racine (main)' }).click()
    await back.waitFor({ state: 'detached', timeout: 20000 })
    await row.getByText('la racine (main)').waitFor({ timeout: 20000 })
    assert.equal((await api('/api/actions')).find((entry) => entry.id === service.id).service.served.root, true)
    await page.getByRole('button', { name: 'Arrêter : Serveur statique' }).first().click()
    await panel.getByText('Arrêté').waitFor({ timeout: 20000 })

    // Une instance par worktree (AC-06), pour de vrai : la racine et feat/offline-cache ont
    // chacune leur unité, sur le port libre que `PORT` leur donne, sans refus ni bascule.
    console.log('actions-ui-check : une instance par worktree')
    const perTreeCreated = await context.request.post(`${base}/api/projects/${project.id}/actions`, {
      data: {
        label: 'Statique par arbre', kind: 'service', placement: 'per-worktree',
        command: 'python3 -m http.server --bind 127.0.0.1 "$PORT"', url: 'http://127.0.0.1:{port}/',
      },
    })
    assert.equal(perTreeCreated.status(), 201, await perTreeCreated.text())
    const perTree = await perTreeCreated.json()
    instanceUnits.push(`solera-app-action-${perTree.id.slice(0, 8)}-root.service`, `solera-app-action-${perTree.id.slice(0, 8)}-${offline.id.slice(0, 8)}.service`)
    const atRoot = await context.request.post(`${base}/api/actions/${perTree.id}/run`, { data: {} })
    assert.equal(atRoot.status(), 201, await atRoot.text())
    const inTree = await context.request.post(`${base}/api/actions/${perTree.id}/run`, { data: { conversationId: conversation.id } })
    assert.equal(inTree.status(), 201, await inTree.text())
    let both = []
    for (let i = 0; i < 100 && both.filter((entry) => entry.ports.length > 0).length < 2; i++) {
      both = (await api('/api/actions')).find((entry) => entry.id === perTree.id).instances
      await delay(200)
    }
    assert.deepEqual(both.map((entry) => entry.unit).sort(), [...instanceUnits].sort())
    const ports = both.map((entry) => entry.ports[0])
    assert.notEqual(ports[0], ports[1])
    for (const port of ports) assert.equal(await fetch(`http://127.0.0.1:${port}/`).then((response) => response.status), 200)
    // Le panneau de la conversation : ses instances listées, chacune avec son lien.
    const perTreeRow = panel.locator('li', { hasText: 'Statique par arbre' })
    for (const port of ports) await perTreeRow.getByRole('link', { name: `:${port}`, exact: true }).waitFor({ timeout: 20000 })
    await perTreeRow.getByRole('button', { name: 'Arrêter : Statique par arbre' }).waitFor()
    await perTreeRow.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shots, 'per-worktree-panel.png') })
    // Arrêter depuis la conversation n'arrête que l'instance de son arbre.
    await perTreeRow.getByRole('button', { name: 'Arrêter : Statique par arbre' }).click()
    for (let i = 0; i < 100; i++) {
      both = (await api('/api/actions')).find((entry) => entry.id === perTree.id).instances
      if (both.length === 1) break
      await delay(200)
    }
    assert.deepEqual(both.map((entry) => entry.served?.root), [true])
    const removedPerTree = await context.request.delete(`${base}/api/actions/${perTree.id}`)
    assert.equal(removedPerTree.status(), 204)
  } else {
    // Sans systemd utilisateur, le service retombe dans un terminal.
    await page.locator('.xterm-rows', { hasText: 'python3 -m http.server' }).waitFor({ timeout: 10000 })
  }


  // Les commandes lancées ici (RUN-*) : une vraie suite node:test qui échoue, lancée
  // depuis la conversation, se lit dans l'onglet Actions — verdict, test en échec, lien
  // vers le fichier, relance des seuls échecs ; puis une commande qui tourne, arrêtée.
  console.log('actions-ui-check : commandes lancées ici')
  const here = (await api(`/api/projects/${project.id}/terminals`)).find((entry) => entry.actionId === task.id)
  await mkdir(join(here.cwd, 'check'), { recursive: true })
  await writeFile(join(here.cwd, 'check/cart.test.mjs'), [
    "import { describe, it } from 'node:test'",
    "import assert from 'node:assert/strict'",
    "describe('panier', () => {",
    "  it('additionne les lignes', () => { assert.equal(1 + 1, 3) })",
    "  it('garde la remise', () => {})",
    '})',
    '',
  ].join('\n'))
  const createTask = async (label, command) => {
    const response = await context.request.post(`${base}/api/projects/${project.id}/actions`, { data: { label, kind: 'task', command } })
    assert.equal(response.status(), 201)
    return response.json()
  }
  const suite = await createTask('Tests du panier', 'node --test check/cart.test.mjs')
  const launched = await context.request.post(`${base}/api/actions/${suite.id}/run`, { data: { conversationId: conversation.id } })
  assert.ok(launched.ok(), await launched.text())
  await actionsTab.click()
  const runs = page.locator('[data-command-runs]')
  const suiteRow = runs.locator('li', { hasText: 'Tests du panier' })
  await suiteRow.getByText(/Échec \(code 1\) · \d+ s · 1 test en échec/).waitFor({ timeout: 20000 })
  await page.screenshot({ path: join(shots, 'runs-list-1280.png') })
  await suiteRow.getByRole('button', { name: /^Tests du panier/ }).click()
  const detail = page.locator('[data-command-run]')
  await detail.getByText('Tests en échec · 1').waitFor()
  await detail.getByText(/Échec \(code 1\) en \d+ s · tests 2 · pass 1 · fail 1/).waitFor()
  await detail.getByText('$ node --test check/cart.test.mjs', { exact: true }).waitFor()
  await detail.getByText('panier › additionne les lignes', { exact: true }).waitFor()
  assert.equal(await detail.getByText('attendu').count(), 1)
  const rerunFailed = detail.getByRole('button', { name: 'Relancer seulement les échecs' })
  assert.equal(await rerunFailed.getAttribute('title'), "node --test check/cart.test.mjs '--test-name-pattern=additionne les lignes'")
  await page.screenshot({ path: join(shots, 'runs-detail-1280.png') })
  // Le lien fichier:ligne ouvre le fichier dans Fichiers.
  await detail.getByRole('button', { name: 'check/cart.test.mjs:4' }).click()
  await page.locator('[data-editor-file="check/cart.test.mjs"]').waitFor()
  // Relancer seulement les échecs : le détail suit la relance, sans quitter l'onglet.
  await actionsTab.click()
  await suiteRow.getByRole('button', { name: /^Tests du panier/ }).click()
  await rerunFailed.click()
  // L'en-tête dit ce qui a tourné, arguments de relance compris. La sortie commence par
  // la même ligne quand le shell la répète : on lit l'en-tête, pas la sortie.
  await detail.locator('code').getByText("$ node --test check/cart.test.mjs '--test-name-pattern=additionne les lignes'", { exact: true }).waitFor({ timeout: 20000 })
  await detail.getByText(/Échec \(code 1\)/).waitFor({ timeout: 20000 })
  assert.equal(await detail.getByText('Tests en échec · 1').count(), 1)
  // Échap remonte à la liste.
  await page.keyboard.press('Escape')
  await runs.waitFor()
  assert.equal(await detail.count(), 0)

  // Une commande qui tourne : la durée avance, « Arrêter » l'arrête pour de vrai, et elle
  // se lit « Arrêtée », pas « Échec ».
  const waiting = await createTask('Attendre', 'echo en-attente; sleep 60')
  await context.request.post(`${base}/api/actions/${waiting.id}/run`, { data: { conversationId: conversation.id } })
  await actionsTab.click()
  const waitingRow = runs.locator('li', { hasText: 'Attendre' })
  await runs.getByText(/^En cours/).waitFor()
  await waitingRow.getByText('en-attente').waitFor({ timeout: 10000 })
  const first = await waitingRow.getByText(/^\d+ s/).textContent()
  await page.waitForTimeout(1500)
  assert.notEqual(await waitingRow.getByText(/^\d+ s/).textContent(), first, 'la durée avance')
  await page.screenshot({ path: join(shots, 'runs-running-1280.png') })
  await waitingRow.getByRole('button', { name: 'Arrêter « Attendre »' }).click()
  await waitingRow.getByText(/^Arrêtée · \d+ s$/).waitFor({ timeout: 10000 })
  await runs.getByText(/^Dernières commandes/).waitFor()
  // Écarter ferme son terminal.
  await waitingRow.hover()
  await waitingRow.getByRole('button', { name: 'Écarter « Attendre » et fermer son terminal' }).click()
  await waitingRow.waitFor({ state: 'detached' })
  assert.equal((await api(`/api/projects/${project.id}/terminals`)).some((entry) => entry.actionId === waiting.id), false)

  // Au téléphone.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' })
  await phone.addInitScript((origin) => {
    if (window === window.top && location.origin === origin) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  await phone.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  const mobile = await phone.newPage()
  mobile.on('pageerror', (error) => errors.push(error.message))
  await mobile.goto(`${base}/p/${project.id}/c/${conversation.id}`)
  await mobile.getByRole('button', { name: /^Ouvrir le panneau/ }).first().waitFor()
  assert.equal(await mobile.locator('header').getByRole('button', { name: /^Actions/ }).count(), 0, 'plus de ⚡ au téléphone')
  await mobile.screenshot({ path: join(shots, 'actions-phone-header.png') })
  await mobile.getByRole('button', { name: 'Ouvrir le panneau' }).first().click()
  await mobile.locator('button[aria-pressed][aria-label^="Actions"]').click()
  await mobile.locator(':not([data-command-runs]) > ul', { hasText: 'Dire bonjour' }).first().waitFor()
  await mobile.locator('[data-command-runs]').getByText('Tests du panier').waitFor()
  await mobile.screenshot({ path: join(shots, 'actions-phone.png') })
  await mobile.locator('[data-command-runs] li', { hasText: 'Tests du panier' }).getByRole('button', { name: /^Tests du panier/ }).click()
  await mobile.locator('[data-command-run]').getByText('Tests en échec · 1').waitFor()
  await mobile.screenshot({ path: join(shots, 'runs-detail-390.png') })

  // Le détail d'une action, en pile dans le panneau.
  console.log('actions-ui-check : détail d\'une action')
  await checkDetail(page, base, project, api, context)

  // L'éditeur unifié : une commande planifiée, un service et un agent, créés pour de vrai.
  await checkEditor(page, base, project, conversation, api, context)

  // Supprimer le service arrête et retire son unité.
  for (const action of await api('/api/actions')) {
    if (action.projectId !== project.id) continue
    const removed = await context.request.delete(`${base}/api/actions/${action.id}`)
    assert.equal(removed.status(), 204)
  }
  for (const task of await api('/api/schedules')) {
    if (task.projectId === project.id && task.name === 'Revue (éditeur)') await context.request.delete(`${base}/api/schedules/${task.id}`)
  }
  assert.deepEqual(errors, [])
  console.log(`actions-ui-check: ok — captures dans ${shots}`)
} finally {
  await browser?.close()
  for (const unit of linuxServices ? [serviceUnit, ...instanceUnits, ...tabUnits].filter(Boolean) : []) {
    try { execFileSync('systemctl', ['--user', 'stop', unit], { stdio: 'ignore' }) } catch { /* déjà retirée */ }
  }
  for (const child of processes) child.kill()
  // Le serveur écrit encore la relecture de ses terminaux en s'arrêtant : effacer avant
  // sa sortie fait échouer `rm` sur un dossier qui se remplit.
  await Promise.all(processes.map((child) => (child.exitCode === null && child.signalCode === null ? once(child, 'exit') : null)))
  await rm(data, { recursive: true, force: true })
}
