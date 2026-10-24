import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './checks/browser.mjs'
import { viteDependency } from './checks/vite-deps.mjs'

// Vrai composer et vraie file de sauvegarde ; API simulée, aucun CLI lancé.
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

const efforts = [
  { value: 'low', label: 'Faible', hint: 'Réflexion limitée' },
  { value: 'medium', label: 'Moyen', hint: 'Réflexion intermédiaire' },
  { value: 'high', label: 'Élevé', hint: 'Réflexion approfondie' },
]
const models = [
  { value: 'alpha', displayName: 'Modèle Alpha', description: 'Premier modèle', hint: 'alpha-v1', isDefault: true, efforts, defaultEffort: 'medium' },
  { value: 'beta', displayName: 'Modèle Beta', description: 'Second modèle', hint: null, isDefault: false, efforts: efforts.slice(0, 2), defaultEffort: 'medium' },
  { value: 'none', displayName: 'Sans réflexion', description: 'Sans niveau configurable', hint: null, isDefault: false, efforts: [], defaultEffort: null },
]
const initial = {
  codex: { agent: 'codex', model: 'alpha', reasoningEffort: 'high', askForApproval: 'on-request', collaborationMode: 'default', sandbox: 'workspace-write', soleraMcp: true, mcpServers: [] },
  claude: { agent: 'claude', model: 'alpha', effort: 'high', permissionMode: 'manual', strictMcp: false, soleraMcp: true, mcpServers: [] },
}

async function mount(page) {
  // Les fournisseurs viennent des mêmes modules que les composants : voir `viteDependency`.
  // Le composer n'importe plus le routeur lui-même : il se lit chez un voisin qui l'importe encore.
  const modules = {
    query: await viteDependency(origin, '@tanstack/react-query', '/src/lib/conversation-config.ts'),
    router: await viteDependency(origin, 'react-router-dom', '/src/components/chat/MessageBubble.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/chat/Composer.tsx'),
  }
  await page.goto(`${origin}/__composer_check`)
  await page.evaluate(async (modules) => {
    const refresh = (await import('/@react-refresh')).default
    refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    localStorage.setItem('solera.locale', 'fr')
    document.documentElement.dataset.theme = 'light'
    await import('/src/styles/index.css')
    const React = (await import('/node_modules/.vite/deps/react.js')).default
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
    const { QueryClient, QueryClientProvider } = await import(modules.query)
    const { MemoryRouter } = await import(modules.router)
    const { Composer } = await import('/src/components/chat/Composer.tsx')
    const { TooltipProvider } = await import(modules.ui)
    const { useConversationConfig } = await import('/src/lib/conversation-config.ts')
    const { useConversation } = await import('/src/lib/conversations.ts')
    const { useVisualViewport } = await import('/src/lib/viewport.ts')
    const { api } = await import('/src/lib/api.ts')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    window.client = client
    // `steered` garde ce que l'envoi a infléchi plutôt qu'envoyé : c'est la seule
    // façon de distinguer les deux gestes, le bouton étant le même.
    window.steered = []
    window.claudeContext = {
      usedTokens: 38_000, maxTokens: 200_000, ratio: 0.19,
      breakdown: {
        axis: 'categories',
        categories: [
          { label: 'System tools', tokens: 11_600, kind: 'used' },
          { label: 'Messages', tokens: 24_600, kind: 'used' },
          { label: 'Memory files', tokens: 1800, kind: 'used' },
          { label: 'MCP tools (deferred)', tokens: 7300, kind: 'deferred' },
          { label: 'Autocompact buffer', tokens: 13_000, kind: 'buffer' },
          { label: 'Free space', tokens: 149_000, kind: 'free' },
        ],
        memoryFiles: [{ name: '/w/CLAUDE.md', source: 'Project', tokens: 1800 }],
        mcpTools: [{ name: 'mcp__docs__search', source: 'docs', tokens: 410 }],
        agents: [],
        skills: [],
      },
    }
    window.codexContext = {
      usedTokens: 12_000, maxTokens: 272_000, ratio: 0.044,
      breakdown: {
        axis: 'tokens',
        last: { totalTokens: 13_200, inputTokens: 12_000, cachedInputTokens: 9000, cacheWriteInputTokens: 1500, outputTokens: 1200, reasoningOutputTokens: 800 },
        total: { totalTokens: 38_794, inputTokens: 34_000, cachedInputTokens: 25_000, cacheWriteInputTokens: 4000, outputTokens: 4794, reasoningOutputTokens: 3100 },
      },
    }
    function Harness() {
      const [id, setId] = React.useState('codex')
      const [disabled, setDisabled] = React.useState(false)
      const [status, setStatus] = React.useState('idle')
      useVisualViewport()
      const { data } = useConversation(id)
      const settings = useConversationConfig(data)
      window.setConversation = setId
      window.setReadOnly = setDisabled
      window.setStatus = setStatus
      window.settings = settings
      if (!settings.config) return null
      return React.createElement(Composer, {
        key: id, config: settings.config, draftKey: `composer-test-${id}`, status, disabled,
        commands: [{ name: '/compact', description: 'Déclarée par le CLI' }], skills: [], mcpInventory: [{ name: 'CLI externe', external: true, tools: [{ name: 'read' }] }],
        appliedConfig: data?.config.agent === 'claude' ? { ...data.config, permissionMode: 'manual' } : null,
        onConfigChange: settings.change, configError: settings.error?.message, onConfigRetry: settings.retry,
        // La modale du contexte change d'axe selon le CLI : Claude découpe la fenêtre
        // par catégorie, Codex ne sait parler que de la nature des jetons.
        context: id === 'claude' ? window.claudeContext : window.codexContext,
        onSend: async (text) => { await settings.flush(); await api.post(`/api/conversations/${id}/messages`, { text }) },
        onSteer: async (text) => { window.steered.push(text) },
        onInterrupt: () => {},
      })
    }
    createRoot(document.getElementById('check')).render(React.createElement(QueryClientProvider, { client }, React.createElement(MemoryRouter, null, React.createElement(TooltipProvider, null, React.createElement(Harness)))))
  }, modules)
  await page.getByRole('button', { name: 'Modèle : Modèle Alpha', exact: true }).waitFor()
}

try {
  let ready = false
  for (let i = 0; i < 150; i++) {
    if (await fetch(origin).then((r) => r.ok).catch(() => false)) { ready = true; break }
    if (vite.exitCode !== null) break
    await delay(100)
  }
  assert.ok(ready, diagnostics)
  browser = await launchBrowser()
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 640 }, { width: 667, height: 375 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 700, isMobile: viewport.width < 700, locale: 'fr-FR', serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const stored = structuredClone(initial)
    const patches = []
    const messages = []
    let hold = null
    let failNext = false
    let active = 0
    let maxActive = 0
    await page.route('**/__composer_check', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main class="app-layer" style="display:flex;flex-direction:column;justify-content:flex-end"><div id="check"></div></main></body></html>' }))
    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      const id = path.split('/')[3]
      if (path.endsWith('/models')) return route.fulfill({ json: { models, modes: id === 'codex' ? [{ mode: 'default', label: 'Standard' }, { mode: 'plan', label: 'Plan' }] : [], account: null, fetchedAt: Date.now() } })
      if (path === '/api/mcp/servers') return route.fulfill({ json: { servers: [{ id: 'docs', name: 'Documentation', enabled: true }], soleraServer: true, agentMemory: true, projectFiling: true, cardFiling: true } })
      // La bibliothèque de skills : son interrupteur de session vit avec la liste
      // qu'il commande, dans le menu des skills.
      if (path === '/api/skill-library') return route.fulfill({ json: { enabled: true, skills: [{ id: 'dataviz', name: 'dataviz', description: 'Graphiques et palettes', scope: 'global', projectId: null, enabled: true, problem: null }] } })
      if (path.endsWith('/messages')) {
        messages.push({ text: request.postDataJSON().text, config: structuredClone(stored[id]) })
        return route.fulfill({ json: { ok: true } })
      }
      if (path.startsWith('/api/conversations/')) {
        if (request.method() === 'GET') return route.fulfill({ json: { id, config: stored[id] } })
        if (request.method() === 'PATCH') {
          const config = request.postDataJSON().config
          patches.push(config)
          active++
          maxActive = Math.max(maxActive, active)
          if (hold) { const gate = hold; hold = null; await gate }
          active--
          if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: { code: 'test', message: 'Erreur simulée' } } }) }
          stored[id] = config
          return route.fulfill({ json: { ok: true } })
        }
      }
      return route.fulfill({ json: {} })
    })
    await mount(page)
    const field = page.getByPlaceholder('Écris ton message...')
    // Tout ce qui a quitté la rangée vit derrière le « + » : joindre, les skills, les
    // serveurs MCP et les réglages. Sa pastille porte ce qui sort du défaut.
    const plus = page.getByRole('button', { name: /^Joindre, skills, serveurs, réglages/ })
    const model = () => page.getByRole('button', { name: /^Modèle :/ })
    const dialog = page.getByRole('dialog')
    const row = page.locator('[data-composer-row]')
    // L'effort a quitté la barre : il se règle dans le menu du modèle, avec lui, parce
    // que les niveaux proposés dépendent du modèle choisi.
    const efforts = () => page.getByRole('radiogroup', { name: 'Effort de réflexion', exact: true })
    const openModel = async () => { await model().click(); await dialog.waitFor() }
    // La puce a les deux mêmes présentations que le « + » : menu au pointeur, panneau
    // au doigt. L'effort y est un sous-menu d'un côté, un rail déplié de l'autre.
    const menuNow = () =>
      page.evaluate(() => !matchMedia('(max-width: 34rem), (pointer: coarse)').matches)
    const menuGone = () => page.getByRole('menu').first().waitFor({ state: 'hidden' })
    const pickModel = async (name) => {
      const asMenu = await menuNow()
      await model().click()
      if (asMenu) {
        await page.getByRole('menuitemradio', { name }).click()
        await menuGone()
      } else {
        await dialog.waitFor()
        await page.getByRole('radio', { name }).click()
        await settle()
      }
    }
    const pickEffort = async (name) => {
      const asMenu = await menuNow()
      await model().click()
      if (asMenu) {
        await page.getByRole('menuitem', { name: /^Effort de réflexion/ }).click()
        await page.getByRole('menuitemradio', { name }).click()
        await menuGone()
      } else {
        await dialog.waitFor()
        await efforts().getByRole('radio', { name }).click()
        await efforts().getByRole('radio', { name }).and(page.locator('[aria-checked="true"]')).waitFor()
        // Au doigt, le rail s'applique sans refermer : seul le modèle referme.
        assert.equal(await dialog.isVisible(), true, 'Choisir un niveau ne referme pas le panneau du modèle')
        await escape()
      }
    }
    // Radix rend le focus à son déclencheur après la fermeture, et ce retour est
    // asynchrone : ouvrir un autre panneau avant qu'il soit fait le refermait aussitôt.
    const settle = async () => { await dialog.waitFor({ state: 'hidden' }); await delay(80) }
    const escape = async () => { await page.keyboard.press('Escape'); await settle() }
    /** Le niveau en vigueur, lu là où la présentation l'écrit. */
    const chosenEffort = async () => {
      const asMenu = await menuNow()
      await model().click()
      if (asMenu) {
        // La valeur se lit sur l'entrée qui ouvre le sous-menu, sans l'ouvrir.
        const entry = page.getByRole('menuitem', { name: /^Effort de réflexion/ })
        const label = (await entry.textContent()).replace('Effort de réflexion', '').trim()
        await page.keyboard.press('Escape')
        await menuGone()
        return label
      }
      await dialog.waitFor()
      const label = (await efforts().getByRole('radio', { checked: true }).textContent()).trim()
      await escape()
      return label
    }
    // Deux présentations du « + », comme pour la puce. La bascule se relit à chaque
    // usage : un test change de viewport en cours de route.
    const submenus = viewport.width >= 700
    // Il n'y a plus de panneau « tous les réglages » : chaque catégorie s'ouvre pour
    // elle-même, par son sous-menu au pointeur et par sa vue au doigt.
    const openSetting = async (label) => {
      const asMenu = await menuNow()
      await plus.click()
      const entry = (name) => page.getByRole(asMenu ? 'menuitem' : 'button', { name })
      if (!asMenu) await dialog.waitFor()
      await entry(/^Réglages de la session/).click()
      await entry(new RegExp(`^${label}`)).click()
    }
    /**
     * Choisit un mode depuis la puce du modèle : le second chemin de la carte #47.
     *
     * Le même réglage que sous le « + », et non une copie — ce qui se vérifie en
     * relisant ce que la conversation a enregistré.
     */
    const pickMode = async (label, option) => {
      const asMenu = await menuNow()
      await model().click()
      if (asMenu) {
        await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click()
        await page.getByRole('menuitemradio', { name: option }).click()
        await menuGone()
      } else {
        await dialog.waitFor()
        await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
        await page.getByRole('radio', { name: option }).click()
        // Choisir rend la première vue du panneau plutôt que de le refermer.
        await page.getByRole('radiogroup', { name: 'Modèle', exact: true }).waitFor()
        await escape()
      }
    }
    /** Choisit une option d'un réglage, depuis la rangée, et rend la main au repos. */
    const pick = async (label, option) => {
      const asMenu = await menuNow()
      await openSetting(label)
      if (asMenu) {
        await page.getByRole('menuitemradio', { name: option }).click()
        await page.getByRole('menu').first().waitFor({ state: 'hidden' })
      } else {
        await page.getByRole('radio', { name: option }).click()
        await escape()
      }
    }

    /**
     * La rangée tient dans le cadre, et l'envoi avec elle.
     *
     * Mesuré et non jugé à l'œil : quelques pixels de débordement poussent l'envoi
     * hors du cadre sans que ça se voie sur une capture.
     */
    const fits = async (where, width = viewport.width) => {
      const bounds = await row.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
      assert.ok(bounds.scroll <= bounds.client, `La rangée déborde ${where} (${bounds.scroll} > ${bounds.client})`)
      const send = page.getByRole('button', { name: /^(Envoyer le message|Infléchir le tour en cours|Mettre le message en file)$/ })
      if (await send.count() > 0) {
        const box = await send.boundingBox()
        assert.ok(box.x + box.width <= width + 1, `L'envoi sort du cadre ${where}`)
      }
    }

    // La cible tactile ne se mesure qu'au doigt : au large et à la souris, la rangée
    // descend à 36 px, c'est la règle du catalogue (`md:` et `pointer-coarse:`).
    const tall = viewport.width < 700 ? 44 : 36
    for (const button of [model(), plus]) {
      const bounds = await button.boundingBox()
      assert.ok(bounds.height >= tall, `Cible trop basse : ${bounds.height}`)
    }
    assert.ok((await plus.boundingBox()).width >= tall)
    await fits('au repos')

    await field.fill('Brouillon conservé')
    await field.evaluate((node) => node.setSelectionRange(3, 9))
    let release
    hold = new Promise((resolve) => { release = resolve })
    await pickModel(/^Modèle Beta/)
    await page.getByRole('button', { name: 'Modèle : Modèle Beta', exact: true }).waitFor()
    if (viewport.width >= 700) {
      await page.waitForFunction(() => document.activeElement.tagName === 'TEXTAREA')
      assert.deepEqual(await field.evaluate((node) => [node.selectionStart, node.selectionEnd]), [3, 9])
    } else assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA')
    assert.equal(await chosenEffort(), 'Moyen', 'Effort falls back immediately')
    await pickEffort('Faible')
    await page.getByRole('button', { name: 'Envoyer le message', exact: true }).click()
    assert.equal(messages.length, 0, 'Sending waits for the pending settings')
    release()
    await page.waitForResponse((response) => response.url().endsWith('/messages'))
    assert.equal(maxActive, 1, 'Config writes are serialized')
    assert.equal(messages[0].config.model, 'beta')
    assert.equal(messages[0].config.reasoningEffort, 'low')
    assert.equal(patches[1].model, 'beta', 'The second edit includes the first')

    await field.fill('Encore un brouillon')
    const compactHeight = (await page.locator('form').boundingBox()).height
    await pick('Modèle', /^Modèle Alpha/)
    await pick('Effort de réflexion', 'Élevé')
    await pick('Mode', 'Plan')
    await pick('Bac à sable', /^Accès total/)
    await pick('Approbations', /^Jamais/)
    // Les serveurs MCP sont un choix multiple : leur menu reste ouvert, et ceux que
    // le CLI déclare lui-même n'y sont pas réglables.
    await plus.click()
    if (submenus) {
      await page.getByRole('menuitem', { name: /^Serveurs MCP/ }).click()
      // La ligne porte maintenant sa provenance et son état sous le nom : le nom
      // accessible les reprend, et ne peut plus être comparé au mot seul.
      const server = page.getByRole('menuitemcheckbox', { name: /^Documentation/ })
      await server.click()
      assert.equal(await server.getAttribute('aria-checked'), 'true')
      assert.equal(await page.getByRole('menuitemcheckbox', { name: /^CLI externe/ }).count(), 0)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.getByRole('menu').first().waitFor({ state: 'hidden' })
    } else {
      await dialog.waitFor()
      await page.getByRole('button', { name: /^Serveurs MCP/ }).click()
      await page.getByRole('switch', { name: /^Documentation/ }).click()
      assert.equal(await dialog.isVisible(), true)
      assert.equal(await page.getByRole('switch', { name: /^CLI externe/ }).count(), 0)
      const panelBounds = await dialog.boundingBox()
      assert.ok(panelBounds.y >= 0 && panelBounds.y + panelBounds.height <= viewport.height + 1)
      await escape()
    }
    assert.equal(await field.inputValue(), 'Encore un brouillon')
    await page.evaluate(() => window.settings.flush())
    assert.equal(stored.codex.collaborationMode, 'plan')
    assert.equal(stored.codex.askForApproval, 'never')
    assert.deepEqual(stored.codex.mcpServers, ['docs'])
    assert.match(await plus.getAttribute('aria-label'), /Accès total/)
    if (viewport.width >= 700) {
      await plus.hover()
      await page.getByRole('tooltip').waitFor()
      assert.match(await page.getByRole('tooltip').textContent(), /Plan.*Approbations : Jamais.*Accès total/)
      await page.keyboard.press('Escape')
      await page.mouse.move(0, 0)
    }
    // L'étiquette du mode Plan et la pastille du « + » tiennent dans la rangée : ce
    // qui sort du défaut se lit sans rien ajouter sous le champ.
    assert.equal((await page.locator('form').boundingBox()).height, compactHeight, 'Permission indicators do not add a row')
    await page.getByText('Plan', { exact: true }).first().waitFor()
    await fits('en mode Plan')

    // Les modes sont dupliqués dans le menu du modèle, et Codex en a deux : le bac à
    // sable s'y change et revient, sans quitter la puce.
    await pickMode('Bac à sable', /^Lecture seule/)
    await page.evaluate(() => window.settings.flush())
    assert.equal(stored.codex.sandbox, 'read-only', 'La puce du modèle écrit le réglage du « + »')
    await pickMode('Bac à sable', /^Accès total/)
    await page.evaluate(() => window.settings.flush())
    assert.equal(stored.codex.sandbox, 'danger-full-access')

    failNext = true
    await pickEffort('Moyen')
    await page.getByRole('alert').filter({ hasText: 'Les réglages' }).waitFor()
    assert.equal(await field.inputValue(), 'Encore un brouillon')
    await page.getByRole('button', { name: 'Envoyer le message', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('textarea').value === 'Encore un brouillon')
    assert.equal(messages.length, 1, 'An unsaved configuration must not be used to send')
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Les réglages' }).waitFor({ state: 'hidden' })
    await page.evaluate(() => window.settings.flush())
    assert.equal(stored.codex.reasoningEffort, 'medium')

    // L'échec d'enregistrement et sa reprise se lisent dans le composer, au-dessus de
    // la rangée : le menu qui a servi à choisir est refermé depuis longtemps.
    failNext = true
    await pick('Effort de réflexion', 'Faible')
    await page.getByRole('alert').filter({ hasText: 'Les réglages' }).waitFor()
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Les réglages' }).waitFor({ state: 'hidden' })
    await page.evaluate(() => window.settings.flush())

    // Au clavier : la liste prend le focus dès l'ouverture, et le dernier modèle —
    // celui qui n'a pas de niveaux — se choisit sans toucher la souris.
    const keyboardMenu = await menuNow()
    await model().focus()
    await page.keyboard.press('Enter')
    if (keyboardMenu) {
      await page.getByRole('menu').first().waitFor()
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitemradio')
      // Les flèches parcourent les modèles, depuis celui qui est en vigueur.
      await delay(120)
      await page.keyboard.press('ArrowDown')
      await delay(60)
      await page.keyboard.press('ArrowDown')
      await page.waitForFunction(() => document.activeElement?.textContent?.startsWith('Sans'))
      await page.keyboard.press('Enter')
      await menuGone()
    } else {
      // La feuille prend le focus après son ouverture : une touche envoyée avant se
      // perd hors de la liste, et l'Entrée suivante rouvre au lieu de choisir.
      await dialog.waitFor()
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'radio')
      await page.keyboard.press('End')
      assert.equal(await dialog.isVisible(), true)
      await page.keyboard.press('Enter')
      await settle()
    }
    assert.equal(await field.inputValue(), 'Encore un brouillon')
    await model().click()
    if (keyboardMenu) {
      assert.equal(await page.getByRole('menuitem', { name: /^Effort de réflexion/ }).count(), 0,
        'Un modèle sans niveaux ne montre pas de réglage d\'effort')
      await page.keyboard.press('Escape')
      await menuGone()
    } else {
      await dialog.waitFor()
      assert.equal(await efforts().count(), 0, 'Un modèle sans niveaux ne montre pas de rail vide')
      await escape()
    }
    await page.evaluate(() => window.settings.flush())

    if (viewport.width === 1440) {
      // Catalogue long, valeur enregistrée hors catalogue et politique granulaire.
      await page.evaluate(async () => {
        const catalog = window.client.getQueryData(['agents', 'codex', 'models'])
        window.client.setQueryData(['agents', 'codex', 'models'], {
          ...catalog,
          models: [...catalog.models, ...Array.from({ length: 10 }, (_, i) => ({ ...catalog.models[0], value: `archive-${i}`, displayName: `Archive ${i}`, isDefault: false }))],
        })
        window.settings.change({ ...window.settings.config, model: 'saved-model', askForApproval: { granular: { sandbox_approval: true, rules: true, skill_approval: true, request_permissions: true, mcp_elicitations: true } } })
        await window.settings.flush()
      })
      await page.getByRole('button', { name: 'Modèle : saved-model', exact: true }).waitFor()
      // La puce ne montre que les modèles courants ; le catalogue entier est derrière
      // « Plus de modèles… » — un tiroir au pointeur, une vue cherchable au doigt.
      if (await menuNow()) {
        await model().click()
        await page.getByRole('menuitem', { name: /^Plus de modèles/ }).click()
        await page.getByRole('menuitemradio', { name: 'Archive 9', exact: true }).waitFor()
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await menuGone()
      } else {
        await openModel()
        await page.getByRole('button', { name: /^Plus de modèles/ }).click()
        await page.getByRole('searchbox', { name: 'Rechercher un modèle', exact: true }).fill('Archive 9')
        assert.equal(await page.getByRole('radiogroup', { name: 'Modèle', exact: true }).getByRole('radio').count(), 1)
        await escape()
      }
      /*
       * La ligne par défaut emprunte le nom de la jumelle qu'elle désigne — « Défaut :
       * Modèle Alpha » — et c'est elle qui porte la sélection tant qu'aucun modèle
       * n'est épinglé, la configuration gardant la sentinelle. La puce, elle, ne
       * montre que le modèle : « Default (recommended) » n'a pas à occuper la barre.
       * À guetter : une barre vide ou des niveaux d'effort disparus.
       */
      await page.evaluate(async () => {
        const catalog = window.client.getQueryData(['agents', 'codex', 'models'])
        const named = catalog.models.slice(0, 3).map((model) => ({ ...model, isDefault: false }))
        window.client.setQueryData(['agents', 'codex', 'models'], {
          ...catalog,
          models: [
            { ...named[0], value: 'default', displayName: 'Default (recommended)', isDefault: true },
            ...named,
          ],
        })
        window.settings.change({ ...window.settings.config, model: '', reasoningEffort: '' })
        await window.settings.flush()
      })
      await page.getByRole('button', { name: 'Modèle : Défaut : Modèle Alpha', exact: true }).waitFor()
      assert.equal(await model().locator('span.truncate').first().innerText(), 'Modèle Alpha',
        'La puce dit le modèle, pas le rang')
      await model().click()
      assert.equal(await page.getByRole('menuitemradio', { name: /^Default \(recommended\)/ }).count(), 0,
        'La ligne par défaut n\'y garde pas le libellé du CLI')
      const chosenModel = page.getByRole('menuitemradio', { checked: true })
      assert.equal(await chosenModel.count(), 1)
      assert.match(await chosenModel.textContent(), /^Défaut : Modèle Alpha/,
        'La ligne par défaut nomme le modèle qu\'elle désigne, et porte la sélection')
      assert.match(await page.getByRole('menuitem', { name: /^Effort de réflexion/ }).textContent(), /Moyen/,
        'Les niveaux d\'effort du modèle résolu restent trouvables')
      await page.keyboard.press('Escape')
      await menuGone()

      /*
       * Le même catalogue, sur une conversation déjà lancée. La sentinelle ne survit
       * pas à la création : `resolveDefaults` l'écrit `default`, la valeur de la ligne
       * par défaut. C'est ce cas, et non le brouillon, qui a montré deux « Opus 5.5 »
       * quand la ligne était cachée : la valeur enregistrée, absente de la liste, y
       * revenait sous le nom court de sa jumelle. Une seule ligne par modèle, et le
       * défaut en tête.
       */
      await page.evaluate(async () => {
        window.settings.change({ ...window.settings.config, model: 'default' })
        await window.settings.flush()
      })
      await page.getByRole('button', { name: 'Modèle : Défaut : Modèle Alpha', exact: true }).waitFor()
      /*
       * Les trois listes qui montrent le catalogue : la puce au pointeur, le « + » →
       * Réglages → Modèle, et la puce au doigt. Chacune doit compter ses lignes et non
       * chercher un nom : un doublon de la ligne par défaut ne s'appelle pas forcément
       * comme sa jumelle — ici « Default (recommended) », le fixture n'ayant pas un
       * identifiant de marque.
       */
      const twinned = ['Défaut : Modèle Alpha', 'Modèle Alpha', 'Modèle Beta', 'Sans réflexion']
      const assertListed = (names, where) => {
        assert.equal(names.length, twinned.length, `${where} : une ligne par entrée du catalogue (${names.join(' | ')})`)
        // Au doigt, chaque ligne porte aussi sa phrase d'explication : le nom en tête suffit.
        twinned.forEach((name, i) => assert.ok(names[i].startsWith(name), `${where} : « ${name} » en position ${i + 1}, lu « ${names[i]} »`))
      }
      await model().click()
      assertListed(await page.getByRole('menuitemradio').allTextContents(), 'Puce, au pointeur')
      assert.match(await page.getByRole('menuitemradio', { checked: true }).textContent(), /^Défaut : Modèle Alpha/)
      await page.keyboard.press('Escape')
      await menuGone()
      await openSetting('Modèle')
      assertListed(await page.getByRole('menuitemradio').allTextContents(), '« + » → Réglages → Modèle')
      assert.match(await page.getByRole('menuitemradio', { checked: true }).textContent(), /^Défaut : Modèle Alpha/)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await menuGone()
      await page.setViewportSize({ width: 390, height: 844 })
      await openModel()
      const sheetModels = page.getByRole('radiogroup', { name: 'Modèle', exact: true }).getByRole('radio')
      assertListed(await sheetModels.allTextContents(), 'Puce, au doigt')
      assert.match(await sheetModels.and(page.locator('[aria-checked="true"]')).textContent(), /^Défaut : Modèle Alpha/)
      await escape()
      await page.setViewportSize(viewport)

      // L'aller-retour : la jumelle épingle son modèle, la ligne par défaut rend la
      // main au CLI. Deux gestes différents, donc deux valeurs enregistrées.
      await pickModel(/^Modèle Alpha/)
      await page.evaluate(() => window.settings.flush())
      assert.equal(stored.codex.model, 'alpha', 'Choisir la jumelle épingle le modèle')
      await page.getByRole('button', { name: 'Modèle : Modèle Alpha', exact: true }).waitFor()
      await pickModel(/^Défaut : Modèle Alpha/)
      await page.evaluate(() => window.settings.flush())
      assert.equal(stored.codex.model, 'default', 'Revenir sur le défaut le réenregistre')
      await page.getByRole('button', { name: 'Modèle : Défaut : Modèle Alpha', exact: true }).waitFor()

      // Une approbation granulaire, posée hors de Solera, se lit sans être modifiable.
      if (submenus) {
        await plus.click()
        await page.getByRole('menuitem', { name: /^Réglages de la session/ }).click()
        await page.getByRole('menuitem', { name: /^Approbations/ }).click()
        assert.equal(await page.getByRole('menuitemradio', { name: /^Granulaire/ }).isDisabled(), true)
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await page.getByRole('menu').first().waitFor({ state: 'hidden' })
      }
      // Au doigt, la vue d'un réglage tient le focus et suit le viewport visuel.
      await page.setViewportSize({ width: 390, height: 844 })
      await openSetting('Approbations')
      const approval = page.getByRole('radiogroup', { name: 'Approbations', exact: true })
      assert.equal(await approval.getByRole('radio', { name: /^Granulaire/ }).isDisabled(), true)
      assert.equal(await approval.getByRole('radio', { name: /^Défaut du CLI/ }).getAttribute('tabindex'), '0')
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), true)
      }
      // Le clavier réduit le viewport visuel sans forcément modifier 100dvh.
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--sg-app-height', '420px')
        document.documentElement.style.setProperty('--sg-viewport-top', '30px')
      })
      const keyboardBounds = await dialog.boundingBox()
      assert.ok(keyboardBounds.y >= 30 && keyboardBounds.y + keyboardBounds.height <= 451)
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('--sg-app-height')
        document.documentElement.style.removeProperty('--sg-viewport-top')
      })
      await escape()
      await page.setViewportSize(viewport)

      hold = new Promise((resolve) => { release = resolve })
      await pick('Approbations', /^Sur demande/)
      await page.evaluate(() => window.setConversation('claude'))
      await page.getByRole('button', { name: 'Modèle : Modèle Alpha', exact: true }).waitFor()
      release()
      await page.waitForFunction(() => window.client.getQueryData(['conversation', 'codex'])?.config.askForApproval === 'on-request')
      assert.equal(await page.evaluate(() => window.settings.config.agent), 'claude', 'A late write belongs to its conversation')
    }

    await page.evaluate(() => window.setConversation('claude'))
    await model().waitFor()
    await pick('Permissions', /^Tout autoriser/)
    // Ce que la session applique encore se lit à côté du choix qui attend la relance.
    await openSetting('Permissions')
    await page.getByText('En vigueur : Demander', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await settle()
    // Le même réglage depuis la puce, avec la mention d'attente : Claude n'a qu'un
    // mode, et c'est bien le même état qu'on y change.
    await pickMode('Permissions', /^Demander/)
    await page.evaluate(() => window.settings.flush())
    assert.equal(stored.claude.permissionMode, 'manual')
    await pickMode('Permissions', /^Tout autoriser/)
    await page.evaluate(() => window.settings.flush())
    assert.equal(stored.claude.permissionMode, 'bypassPermissions')
    await model().click()
    if (await menuNow()) {
      await page.getByRole('menuitem', { name: /^Permissions/ }).click()
      await page.getByText('En vigueur : Demander', { exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await menuGone()
    } else {
      await dialog.waitFor()
      await page.getByRole('button', { name: /^Permissions/ }).click()
      await page.getByText('En vigueur : Demander', { exact: true }).waitFor()
      await escape()
    }
    await plus.click()
    if (submenus) {
      await page.getByRole('menuitem', { name: /^Serveurs MCP/ }).click()
      await page.getByRole('menuitemcheckbox', { name: /^N'utiliser que les serveurs/ }).click()
      assert.equal(await page.getByRole('menuitemcheckbox', { name: /^Mémoire et coordination/ }).isDisabled(), true)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.getByRole('menu').first().waitFor({ state: 'hidden' })
    } else {
      await dialog.waitFor()
      await page.getByRole('button', { name: /^Serveurs MCP/ }).click()
      await page.getByRole('switch', { name: /^N'utiliser que les serveurs/ }).click()
      assert.equal(await page.getByRole('switch', { name: /^Mémoire et coordination/ }).isDisabled(), true)
      await escape()
    }
    await page.evaluate(() => window.settings.flush())
    assert.equal(stored.claude.strictMcp, true)
    assert.match(await plus.getAttribute('aria-label'), /Tout autoriser/)
    if (viewport.width >= 700) {
      await plus.hover()
      await page.getByRole('tooltip').waitFor()
      assert.match(await page.getByRole('tooltip').textContent(), /Tout autoriser/)
      await page.keyboard.press('Escape')
      await page.mouse.move(0, 0)
    }
    // Le menu « + » : tout ce qui a quitté la rangée doit s'y retrouver.
    if (submenus) {
      // Au pointeur, chaque réglage ouvre son sous-menu à côté : ni titre ni croix à
      // chaque niveau, et le parent reste visible.
      await plus.click()
      await page.getByRole('menuitem', { name: 'Joindre un fichier', exact: true }).waitFor()
      await page.getByRole('menuitem', { name: /^Serveurs MCP/ }).click()
      await page.getByRole('menuitemcheckbox', { name: /^Mémoire et coordination/ }).waitFor()
      await page.getByRole('menuitem', { name: /^Réglages de la session/ }).click()
      await page.getByRole('menuitem', { name: /^Permissions/ }).click()
      // La valeur en vigueur se lit sur l'entrée qui ouvre le sous-menu, et la coche
      // la confirme dedans : « Tout autoriser » vient d'être choisi plus haut.
      await page.getByRole('menuitemradio', { name: /^Demander/ }).waitFor()
      const checked = page.getByRole('menuitemradio', { checked: true })
      assert.equal(await checked.count(), 1)
      assert.match(await checked.textContent(), /^Tout autoriser/)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.getByRole('menu').waitFor({ state: 'hidden' })
      // Les skills ont leur sous-menu, et le réglage de session qui les livre y vit
      // avec eux : c'est le même sujet que la liste qu'il commande.
      await plus.click()
      await page.getByRole('menuitem', { name: /^Skills et commandes/ }).click()
      await page.getByRole('menuitemcheckbox', { name: /^Bibliothèque de skills/ }).waitFor()
      await page.getByRole('menuitem', { name: /^Dans la session/ }).click()
      await page.getByText('Déclarée par le CLI').waitFor()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.getByRole('menu').first().waitFor({ state: 'hidden' })
    } else {
      // Au doigt, les vues s'empilent dans une seule surface, et chacune revient à la
      // racine sans la refermer.
      await plus.click()
      await dialog.waitFor()
      const attach = page.getByRole('button', { name: 'Joindre un fichier', exact: true })
      assert.ok((await attach.boundingBox()).height >= 44, 'Une entrée de menu reste une cible au doigt')
      await page.getByRole('button', { name: /^Serveurs MCP/ }).click()
      await page.getByRole('switch', { name: /^Mémoire et coordination/ }).waitFor()
      await page.getByRole('button', { name: 'Retour', exact: true }).click()
      await page.getByRole('button', { name: 'Skills et commandes', exact: true }).click()
      await page.getByRole('textbox', { name: 'Rechercher un skill…', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Retour', exact: true }).click()
      await attach.waitFor()
      await escape()
      // Rouvrir rend la racine : un panneau qui se souvient de sa branche fait manquer
      // les trois autres.
      await plus.click()
      await dialog.waitFor()
      await attach.waitFor()
      await escape()
    }

    /*
     * Les quatre états du bouton de droite (carte #5). Infléchir est le défaut : avec
     * un brouillon en cours, l'envoi l'emporte sur l'arrêt. La mise en file est le
     * seul cas où les deux coexistent, et l'horloge est alors le seul signe visible
     * que le départ est différé.
     */
    const send = page.getByRole('button', { name: 'Envoyer le message', exact: true })
    const steer = page.getByRole('button', { name: 'Infléchir le tour en cours', exact: true })
    const queue = page.getByRole('button', { name: 'Mettre le message en file', exact: true })
    const stop = page.getByRole('button', { name: "Interrompre l'agent", exact: true })

    await field.fill('')
    assert.equal(await send.isDisabled(), true, 'Au repos, rien de tapé : la flèche est grisée')
    assert.equal(await stop.count(), 0)

    await page.evaluate(() => window.setStatus('running'))
    await stop.waitFor()
    assert.equal(await send.count() + await steer.count() + await queue.count(), 0, 'Tour en cours, rien de tapé : le carré seul')
    await fits('pendant un tour')

    await field.fill('Plutôt en TypeScript.')
    await steer.waitFor()
    assert.equal(await stop.count(), 0, "Infléchir l'emporte sur arrêter tant qu'il y a un brouillon")
    await fits('pendant un tour, un message tapé')
    await steer.click()
    await page.waitForFunction(() => window.steered.length === 1)
    assert.equal(await field.inputValue(), '')

    await page.evaluate(() => window.settings.change({ ...window.settings.config, queueMessages: true }))
    await field.fill('Plutôt en TypeScript.')
    await queue.waitFor()
    await stop.waitFor()
    await fits('pendant un tour, mise en file')
    await queue.click()
    await page.waitForFunction((count) => window.steered.length === count, 1)
    assert.equal(await page.evaluate(() => window.steered.length), 1, 'La mise en file ne passe pas par le steer')

    await page.evaluate(() => window.setStatus('idle'))
    await page.evaluate(() => window.settings.change({ ...window.settings.config, queueMessages: false }))
    await page.evaluate(() => window.settings.flush())
    await field.fill('')

    /*
     * La jauge de contexte, et le détail qu'elle ouvre. Les trois CLI n'ont pas le même
     * axe, et c'est précisément ce que cette vérification garde : rabattre Codex sur le
     * découpage de Claude demanderait d'inventer un détail qu'il ne donne pas.
     *
     * Sous 352 px de rangée, la jauge cède sa place aux commandes : la vérification ne
     * s'applique qu'aux largeurs où elle est encore là.
     */
    const gauge = page.getByRole('button', { name: /^Contexte occupé à/ })
    if (await gauge.isVisible()) {
      // La pastille et la modale doivent dire le même pourcentage : 38 k sur 200 k.
      assert.match(await gauge.getAttribute('aria-label'), /19 %/)
      await gauge.click()
      await dialog.waitFor()
      await dialog.getByText('38 k sur 200 k tokens', { exact: true }).waitFor()
      await dialog.getByText('19 %', { exact: true }).waitFor()
      await dialog.getByText('Dans la fenêtre', { exact: true }).waitFor()
      await dialog.getByText('Messages', { exact: true }).waitFor()
      // Les schémas d'outils hors fenêtre sont listés à part : les mêler aux autres
      // ferait une somme qui ne tombe pas sur le total affiché en haut.
      await dialog.getByText('Hors fenêtre', { exact: true }).waitFor()
      await dialog.getByText('MCP tools (deferred)', { exact: true }).waitFor()
      // Le nominatif est replié : la modale répond d'abord « qu'est-ce qui occupe ».
      const files = dialog.getByText('Fichiers de mémoire (1)', { exact: true })
      await files.waitFor()
      assert.equal(await dialog.getByText('CLAUDE.md · Project', { exact: true }).isVisible(), false)
      await files.click()
      await dialog.getByText('CLAUDE.md · Project', { exact: true }).waitFor()
      await escape()

      await page.evaluate(() => window.setConversation('codex'))
      await model().waitFor()
      await gauge.click()
      await dialog.waitFor()
      await dialog.getByText('Nature des jetons de la dernière requête', { exact: true }).waitFor()
      await dialog.getByText('Relus depuis le cache', { exact: true }).waitFor()
      // Le cumul du fil n'est pas une occupation : il dépasse la fenêtre sans y entrer.
      await dialog.getByText('Cumul du fil', { exact: true }).waitFor()
      await dialog.getByText('39 k', { exact: true }).waitFor()
      assert.equal(await dialog.getByText('Dans la fenêtre', { exact: true }).count(), 0)
      await escape()
      await page.evaluate(() => window.setConversation('claude'))
      await model().waitFor()
    }

    if (viewport.width === 1440) {
      /*
       * Le pire cas de la rangée, à toutes les largeurs : le mode Plan garde son
       * étiquette, la mise en file fait coexister le carré et la flèche, et un
       * brouillon occupe le champ. C'est le téléphone qui décide, où la rangée ne
       * dispose que de 346 px, mais un débordement peut apparaître à n'importe quel
       * seuil de repli : la mesure balaie l'intervalle au lieu de parier dessus.
       */
      await page.evaluate(async () => {
        window.settings.change({ ...window.settings.config, permissionMode: 'plan', queueMessages: true })
        await window.settings.flush()
      })
      await page.evaluate(() => window.setStatus('running'))
      await field.fill('Plutôt en TypeScript, et garde le test existant.')
      await page.getByRole('button', { name: 'Mettre le message en file', exact: true }).waitFor()
      for (let width = 320; width <= 1440; width += 16) {
        await page.setViewportSize({ width, height: 844 })
        await fits(`à ${width} px, dans le pire cas`, width)
      }
      await page.setViewportSize(viewport)
      await page.evaluate(() => window.setStatus('idle'))
      await field.fill('')
      await page.evaluate(async () => {
        window.settings.change({ ...window.settings.config, permissionMode: 'bypassPermissions', queueMessages: false })
        await window.settings.flush()
      })
    }

    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.evaluate(() => window.setReadOnly(true))
    await page.waitForFunction(() => document.querySelector('button[aria-label^="Modèle :"]').disabled)
    assert.equal(await model().isDisabled(), true)
    assert.equal(await plus.isDisabled(), true)
    assert.deepEqual(errors, [])
    console.log(`OK ${viewport.width}×${viewport.height}: quick choices, ordered saves, send waits, retry, draft, Claude/Codex, MCP, send states, bounds`)
    await context.close()
  }
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  if (vite.exitCode === null) await once(vite, 'exit')
}
