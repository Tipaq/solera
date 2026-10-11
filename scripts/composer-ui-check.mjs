import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

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
  await page.goto(`${origin}/__composer_check`)
  await page.evaluate(async () => {
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
    const hookSource = await (await fetch('/src/lib/conversation-config.ts')).text()
    const queryModule = hookSource.match(/from ["']([^"']*tanstack[^"']+)["']/)[1]
    const { QueryClient, QueryClientProvider } = await import(queryModule)
    const composerSource = await (await fetch('/src/components/chat/Composer.tsx')).text()
    const routerModule = composerSource.match(/from ["']([^"']*react-router-dom[^"']+)["']/)[1]
    const { MemoryRouter } = await import(routerModule)
    const { Composer } = await import('/src/components/chat/Composer.tsx')
    // `TooltipProvider` vient du paquet d'interface : le chemin résolu se lit dans la
    // source transformée du composer, comme pour les autres dépendances.
    const uiModule = composerSource.match(/from ["']([^"']*\/packages\/ui\/[^"']+)["']/)[1]
    const { TooltipProvider } = await import(uiModule)
    const { useConversationConfig } = await import('/src/lib/conversation-config.ts')
    const { useConversation } = await import('/src/lib/conversations.ts')
    const { useVisualViewport } = await import('/src/lib/viewport.ts')
    const { api } = await import('/src/lib/api.ts')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    window.client = client
    // `steered` garde ce que l'envoi a infléchi plutôt qu'envoyé : c'est la seule
    // façon de distinguer les deux gestes, le bouton étant le même.
    window.steered = []
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
        commands: [], skills: [], mcpInventory: [{ name: 'CLI externe', external: true, tools: [{ name: 'read' }] }],
        appliedConfig: data?.config.agent === 'claude' ? { ...data.config, permissionMode: 'manual' } : null,
        onConfigChange: settings.change, configError: settings.error?.message, onConfigRetry: settings.retry,
        context: { usedTokens: 38_000, maxTokens: 200_000, ratio: 0.19 },
        onSend: async (text) => { await settings.flush(); await api.post(`/api/conversations/${id}/messages`, { text }) },
        onSteer: async (text) => { window.steered.push(text) },
        onInterrupt: () => {},
      })
    }
    createRoot(document.getElementById('check')).render(React.createElement(QueryClientProvider, { client }, React.createElement(MemoryRouter, null, React.createElement(TooltipProvider, null, React.createElement(Harness)))))
  })
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
  browser = await chromium.launch({ channel: 'chromium', chromiumSandbox: true })
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
      if (path === '/api/mcp/servers') return route.fulfill({ json: { servers: [{ id: 'docs', name: 'Documentation', enabled: true }], soleraServer: true } })
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
    // Radix rend le focus à son déclencheur après la fermeture, et ce retour est
    // asynchrone : ouvrir un autre panneau avant qu'il soit fait le refermait aussitôt.
    const settle = async () => { await dialog.waitFor({ state: 'hidden' }); await delay(80) }
    const escape = async () => { await page.keyboard.press('Escape'); await settle() }
    const chosenEffort = async () => {
      await openModel()
      const label = (await efforts().getByRole('radio', { checked: true }).textContent()).trim()
      await escape()
      return label
    }
    const openAll = async () => {
      await plus.click()
      await dialog.waitFor()
      await page.getByRole('button', { name: /^Réglages de la session/ }).click()
      await page.getByRole('button', { name: 'Terminé', exact: true }).waitFor()
    }
    const close = async () => { await page.getByRole('button', { name: 'Terminé', exact: true }).click(); await settle() }

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
    await model().click()
    await page.getByRole('radio', { name: /^Modèle Beta/ }).click()
    await settle()
    await page.getByRole('button', { name: 'Modèle : Modèle Beta', exact: true }).waitFor()
    if (viewport.width >= 700) {
      await page.waitForFunction(() => document.activeElement.tagName === 'TEXTAREA')
      assert.deepEqual(await field.evaluate((node) => [node.selectionStart, node.selectionEnd]), [3, 9])
    } else assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA')
    assert.equal(await chosenEffort(), 'Moyen', 'Effort falls back immediately')
    // L'effort s'applique sans fermer : seul le choix du modèle referme, les niveaux
    // proposés n'étant plus les mêmes après.
    await openModel()
    await efforts().getByRole('radio', { name: 'Faible', exact: true }).click()
    await efforts().getByRole('radio', { name: 'Faible', exact: true }).and(page.locator('[aria-checked="true"]')).waitFor()
    assert.equal(await dialog.isVisible(), true, 'Choisir un niveau ne referme pas le menu du modèle')
    await escape()
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
    await openAll()
    await page.getByRole('radio', { name: /^Modèle Alpha/ }).click()
    await page.getByRole('radio', { name: 'Élevé', exact: true }).click()
    await page.getByRole('radio', { name: 'Plan', exact: true }).click()
    await page.getByRole('radio', { name: /^Accès total/ }).click()
    await page.getByRole('radio', { name: /^Jamais/ }).click()
    await page.getByRole('switch', { name: 'Documentation', exact: true }).click()
    assert.equal(await dialog.isVisible(), true)
    assert.equal(await page.getByRole('switch', { name: 'CLI externe' }).count(), 0)
    const panelBounds = await dialog.boundingBox()
    assert.ok(panelBounds.y >= 0 && panelBounds.y + panelBounds.height <= viewport.height + 1)
    await close()
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

    failNext = true
    await openModel()
    await efforts().getByRole('radio', { name: 'Moyen', exact: true }).click()
    await escape()
    await page.getByRole('alert').filter({ hasText: 'Les réglages' }).waitFor()
    assert.equal(await field.inputValue(), 'Encore un brouillon')
    await page.getByRole('button', { name: 'Envoyer le message', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('textarea').value === 'Encore un brouillon')
    assert.equal(messages.length, 1, 'An unsaved configuration must not be used to send')
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Les réglages' }).waitFor({ state: 'hidden' })
    await page.evaluate(() => window.settings.flush())
    assert.equal(stored.codex.reasoningEffort, 'medium')

    await openAll()
    failNext = true
    await page.getByRole('radio', { name: 'Faible', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    await dialog.getByRole('button', { name: 'Réessayer', exact: true }).click()
    await dialog.getByRole('alert').waitFor({ state: 'hidden' })
    assert.equal(await dialog.isVisible(), true, 'Retry does not leave the complete panel')
    await close()
    await page.evaluate(() => window.settings.flush())

    await model().focus()
    await page.keyboard.press('Enter')
    // La feuille prend le focus après son ouverture : une touche envoyée avant se perd
    // hors de la liste, et l'Entrée suivante rouvre au lieu de choisir.
    await dialog.waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'radio')
    await page.keyboard.press('End')
    assert.equal(await dialog.isVisible(), true)
    await page.keyboard.press('Enter')
    await settle()
    assert.equal(await field.inputValue(), 'Encore un brouillon')
    await openModel()
    assert.equal(await efforts().count(), 0, 'Un modèle sans niveaux ne montre pas de rail vide')
    await escape()
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
      await openModel()
      await page.getByRole('searchbox', { name: 'Rechercher un modèle', exact: true }).fill('Archive 9')
      assert.equal(await page.getByRole('radiogroup', { name: 'Modèle', exact: true }).getByRole('radio').count(), 1)
      await escape()
      await openAll()
      const approval = page.getByRole('radiogroup', { name: 'Approbations', exact: true })
      assert.equal(await approval.getByRole('radio', { name: /^Granulaire/ }).isDisabled(), true)
      assert.equal(await approval.getByRole('radio', { name: /^Défaut du CLI/ }).getAttribute('tabindex'), '0')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('dialog', { name: 'Réglages de la conversation', exact: true }).waitFor()
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
      await close()
      await page.setViewportSize(viewport)

      hold = new Promise((resolve) => { release = resolve })
      await openAll()
      await page.getByRole('radio', { name: /^Sur demande/ }).click()
      await close()
      await page.evaluate(() => window.setConversation('claude'))
      await page.getByRole('button', { name: 'Modèle : Modèle Alpha', exact: true }).waitFor()
      release()
      await page.waitForFunction(() => window.client.getQueryData(['conversation', 'codex'])?.config.askForApproval === 'on-request')
      assert.equal(await page.evaluate(() => window.settings.config.agent), 'claude', 'A late write belongs to its conversation')
    }

    await page.evaluate(() => window.setConversation('claude'))
    await model().waitFor()
    await openAll()
    await page.getByRole('radio', { name: /^Tout autoriser/ }).click()
    await page.getByText('En vigueur : Demander', { exact: true }).waitFor()
    await page.getByRole('switch', { name: /^N'utiliser que les serveurs/ }).click()
    assert.equal(await page.getByRole('switch', { name: /^Mémoire et coordination/ }).isDisabled(), true)
    await close()
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
    // Le menu « + » : tout ce qui a quitté la rangée doit s'y retrouver, et chaque
    // vue doit pouvoir revenir à la racine sans refermer la surface.
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
