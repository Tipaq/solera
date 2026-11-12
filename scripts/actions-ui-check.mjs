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
          part('tile', stories.Tuile), part('block', stories.Bloc), part('pinned', stories.BlocFixe), part('placement', stories.Placement)))),
      )
    }, modules)

    // La tuile : la branche abrégée, le commit, le retard, les non commités.
    const tile = page.locator('[data-part="tile"]')
    const line = tile.locator('span[title="/srv/nimbus/.worktrees/w1/apps/api"]')
    await line.waitFor()
    assert.match(await line.textContent(), /^sert\s*feat\/905-vue-horizon-et-ses…@ e4f5a6b3●2$/)
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

    // « Où tourne-t-il » : la première conseillée et choisie, la quatrième grisée.
    const placement = page.locator('[data-part="placement"]')
    const follow = placement.getByRole('radio', { name: /^Une seule instance, qu’on bascule/ })
    assert.equal(await follow.getAttribute('aria-checked'), 'true')
    assert.match(await follow.textContent(), /conseillé/)
    assert.equal(await placement.getByRole('radio', { name: /^Une instance par worktree/ }).isDisabled(), true)
    await placement.getByRole('radio', { name: /^Toujours une branche/ }).click()
    await placement.getByText('La racine est sur cette branche : il y tournera.').waitFor()
    await page.screenshot({ path: join(shots, `served-placement-${width}.png`), clip: await placement.boundingBox() })
    assert.deepEqual(errors, [])
    await context.close()
  }
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
  await page.getByRole('button', { name: 'Ouvrir le panneau' }).first().click()
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

  // Le service proposé : relu (commande en clair), validé, lancé d'un geste.
  await page.getByRole('button', { name: 'Relire : Serveur statique' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText(`python3 -m http.server --bind 127.0.0.1 ${httpPort}`).waitFor()
  await page.screenshot({ path: join(shots, 'actions-review.png') })
  await dialog.getByRole('button', { name: 'Valider et lancer' }).click()

  if (linuxServices) {
    await panel.getByText(`Écoute sur :${httpPort}`).waitFor({ timeout: 20000 })
    const open = panel.getByRole('link', { name: `127.0.0.1:${httpPort}/` })
    assert.equal(await open.getAttribute('href'), `http://127.0.0.1:${httpPort}/`)
    const served = await fetch(`http://127.0.0.1:${httpPort}/`).then((response) => response.status)
    assert.equal(served, 200)
    await page.screenshot({ path: join(shots, 'actions-service-running.png') })

    // Le lanceur de l'en-tête compte le service en marche et montre la même liste.
    const launcher = page.getByRole('button', { name: 'Actions, 1 en marche' })
    await launcher.click()
    const popover = page.getByRole('dialog', { name: 'Actions' })
    await popover.getByRole('button', { name: 'Arrêter : Serveur statique' }).waitFor()
    await page.screenshot({ path: join(shots, 'actions-launcher.png') })
    await page.keyboard.press('Escape')

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

    // Ce qu'il sert, et la bascule réelle d'un arbre à l'autre : démarré à la racine, il
    // le dit ; relancé depuis un worktree, il refuse (409) au lieu de se taire ; « Basculer
    // sur » redémarre l'unité dans le worktree, et la ligne le dit.
    console.log('actions-ui-check : bascule d\'un service')
    const started = await context.request.post(`${base}/api/actions/${service.id}/run`, { data: {} })
    assert.ok(started.ok(), await started.text())
    const row = panel.locator('li', { hasText: 'Serveur statique' })
    await row.getByText('la racine (main)').waitFor({ timeout: 20000 })
    const offline = (await api(`/api/projects/${project.id}/worktrees`)).find((entry) => entry.git?.branch === 'feat/offline-cache')
    assert.ok(offline, 'Nimbus a le worktree feat/offline-cache')
    const elsewhere = await context.request.post(`${base}/api/actions/${service.id}/run`, { data: { worktreeId: offline.id } })
    assert.equal(elsewhere.status(), 409)
    const refusal = (await elsewhere.json()).error
    assert.equal(refusal.code, 'service_running_elsewhere')
    assert.equal(refusal.params.root, 'true')
    assert.equal(refusal.params.ports, `:${httpPort}`)
    await row.getByRole('button', { name: 'Plus' }).click()
    await page.getByRole('menuitem', { name: 'feat/offline-cache' }).click()
    const switching = page.getByRole('dialog', { name: '« Serveur statique » sert déjà la racine (main)' })
    await switching.getByText(`Il tourne depuis la racine (main) sur :${httpPort}.`, { exact: false }).waitFor()
    await page.screenshot({ path: join(shots, 'served-switch-dialog.png') })
    await switching.getByRole('button', { name: 'Basculer sur feat/offline-cache' }).click()
    await switching.waitFor({ state: 'detached', timeout: 20000 })
    await row.getByText('feat/offline-cache').waitFor({ timeout: 20000 })
    const moved = (await api('/api/actions')).find((entry) => entry.id === service.id)
    assert.equal(moved.service.served.worktreeId, offline.id)
    assert.equal(moved.service.cwd, offline.path)
    assert.equal(await fetch(`http://127.0.0.1:${httpPort}/`).then((response) => response.status), 200)
    await page.screenshot({ path: join(shots, 'served-switched.png') })
    await page.getByRole('button', { name: 'Arrêter : Serveur statique' }).first().click()
    await panel.getByText('Arrêté').waitFor({ timeout: 20000 })
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
  await mobile.getByRole('button', { name: 'Actions', exact: true }).click()
  await mobile.getByRole('dialog', { name: 'Actions' }).getByText('Dire bonjour').waitFor()
  await mobile.screenshot({ path: join(shots, 'actions-phone-launcher.png') })
  await mobile.keyboard.press('Escape')
  await mobile.getByRole('button', { name: 'Ouvrir le panneau' }).first().click()
  await mobile.locator('button[aria-pressed][aria-label^="Actions"]').click()
  await mobile.locator(':not([data-command-runs]) > ul', { hasText: 'Dire bonjour' }).first().waitFor()
  await mobile.locator('[data-command-runs]').getByText('Tests du panier').waitFor()
  await mobile.screenshot({ path: join(shots, 'actions-phone.png') })
  await mobile.locator('[data-command-runs] li', { hasText: 'Tests du panier' }).getByRole('button', { name: /^Tests du panier/ }).click()
  await mobile.locator('[data-command-run]').getByText('Tests en échec · 1').waitFor()
  await mobile.screenshot({ path: join(shots, 'runs-detail-390.png') })

  // Supprimer le service arrête et retire son unité.
  for (const action of await api('/api/actions')) {
    if (action.projectId !== project.id) continue
    const removed = await context.request.delete(`${base}/api/actions/${action.id}`)
    assert.equal(removed.status(), 204)
  }
  assert.deepEqual(errors, [])
  console.log(`actions-ui-check: ok — captures dans ${shots}`)
} finally {
  await browser?.close()
  if (serviceUnit && linuxServices) {
    try { execFileSync('systemctl', ['--user', 'stop', serviceUnit], { stdio: 'ignore' }) } catch { /* déjà retirée */ }
  }
  for (const child of processes) child.kill()
  // Le serveur écrit encore la relecture de ses terminaux en s'arrêtant : effacer avant
  // sa sortie fait échouer `rm` sur un dossier qui se remplit.
  await Promise.all(processes.map((child) => (child.exitCode === null && child.signalCode === null ? once(child, 'exit') : null)))
  await rm(data, { recursive: true, force: true })
}
