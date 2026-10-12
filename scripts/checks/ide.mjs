import assert from 'node:assert/strict'
import { closePanelButton } from './panel.mjs'

/** Navigation IDE et continuité du contexte d'édition, dans la démo temporaire. */
export async function checkIde({ page, context, base, project }) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/p/${project.id}/board`)
  await page.getByRole('button', { name: 'Ouvrir le panneau', exact: true }).click()
  const panel = page.locator('[data-panel="workspace"]')
  const picker = page.getByRole('dialog', { name: 'Ouvrir un fichier', exact: true })
  const input = picker.getByRole('combobox', { name: 'Nom ou chemin du fichier', exact: true })
  const code = panel.locator('.cm-content')
  // Les trois géométries se règlent à la poignée depuis que le panneau n'a plus
  // d'en-tête : accolé, posé par-dessus, puis sorti de la coque.
  const grip = page.getByRole('separator', { name: /^Largeur du panneau/ })
  const toFullscreen = async () => {
    await grip.focus()
    for (let i = 0; i < 3 && (await panel.getAttribute('data-fullscreen')) === null; i++) await page.keyboard.press('Enter')
  }
  // L'ouverture rapide n'a plus de bouton : le panneau n'a plus d'en-tête où le
  // poser, et la vue *Recherche* fait le même travail à la vue de tous. Reste le
  // raccourci, que le panneau n'écoute que s'il vient de chez lui.
  const openPicker = async () => {
    await panel.focus()
    await page.keyboard.press('Control+p')
    await picker.waitFor()
  }
  const openFile = async (path) => {
    await openPicker()
    await input.fill(path)
    await picker.getByRole('option', { name: path, exact: true }).click()
    await page.waitForFunction((path) => document.activeElement?.closest('[data-editor-file]')?.getAttribute('data-editor-file') === path, path)
  }
  const pos = panel.getByRole('button', { name: /^Ligne \d+, colonne \d+\. Aller à la ligne$/ })
  // CodeMirror ne rend que les lignes visibles : juste après une annulation, le texte
  // lu peut n'être qu'un fragment de ce qui est revenu. On attend qu'il se stabilise
  // avant de comparer, sinon l'assertion départage un rendu en cours.
  const settled = async (expected) => {
    for (let i = 0; i < 100; i++) {
      if ((await code.innerText()).trimEnd() === expected) return
      await page.waitForTimeout(50)
    }
  }

  await openFile('vite.config.ts')
  const original = await code.innerText()
  await pos.click()
  await panel.locator('.cm-panel input[name="line"]').fill('3')
  await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: /^Ligne 3, colonne 1\./ }).waitFor()
  await panel.getByRole('button', { name: 'Rechercher dans le fichier', exact: true }).click()
  await panel.locator('.cm-search input[name="search"]').fill('defineConfig')
  await page.keyboard.press('Escape')
  assert.equal(await panel.isVisible(), true)

  const large = Array.from({ length: 180 }, (_, i) => `// Ligne ${i + 1}`).join('\n')
  await code.fill(large)
  await page.keyboard.press('Control+End')
  await page.waitForFunction(() => document.querySelector('[data-panel="workspace"] .cm-scroller')?.scrollTop > 500)
  const location = await pos.getAttribute('aria-label')
  const scroll = await panel.locator('.cm-scroller').evaluate(node => node.scrollTop)
  await page.keyboard.press('Meta+p')
  await input.waitFor()
  await input.fill('index.html')
  await picker.getByRole('option', { name: 'index.html', exact: true }).waitFor()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.closest('[data-editor-file]')?.getAttribute('data-editor-file') === 'index.html')
  await page.keyboard.press('Control+p')
  await input.waitFor()
  await input.fill('vite.config.ts')
  await picker.getByRole('option', { name: 'vite.config.ts', exact: true }).waitFor()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.closest('[data-editor-file]')?.getAttribute('data-editor-file') === 'vite.config.ts')
  assert.equal(await pos.getAttribute('aria-label'), location, 'Returning to a file restores the selection')
  await page.waitForFunction((scroll) => Math.abs(document.querySelector('[data-panel="workspace"] .cm-scroller').scrollTop - scroll) < 30, scroll)
  await page.keyboard.press('Control+z')
  await settled(original.trimEnd())
  assert.equal((await code.innerText()).trimEnd(), original.trimEnd(), 'Undo must survive changing files')
  await page.keyboard.press('Control+Shift+z')
  await (await closePanelButton(page)).click()
  await panel.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Ouvrir le panneau', exact: true }).click()
  await code.waitFor()
  await code.focus()
  await page.keyboard.press('Control+z')
  await settled(original.trimEnd())
  assert.equal((await code.innerText()).trimEnd(), original.trimEnd(), 'Undo must survive closing the workspace')
  console.log('OK : ouverture rapide ⌘/Ctrl P, recherche dans le fichier, ligne, curseur, défilement et annulation conservés.')

  await code.evaluate(node => { window.ideCodeNode = node })
  await toFullscreen()
  await page.waitForFunction(() => {
    const bounds = document.querySelector('[data-panel="workspace"]').getBoundingClientRect()
    return Math.round(bounds.width) === innerWidth && Math.round(bounds.x) === 0
  })
  const full = await panel.boundingBox()
  assert.equal(Math.round(full.x), 0)
  assert.equal(Math.round(full.height), 900)
  await panel.getByText('Nimbus · workspace', { exact: true }).waitFor()
  assert.equal(await code.evaluate(node => node === window.ideCodeNode), true)
  await (await closePanelButton(page)).focus()
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-panel="workspace"]'))), true)
  }
  await code.focus()
  await page.keyboard.press('Control+p')
  await input.waitFor()
  await page.keyboard.press('Escape')
  await picker.waitFor({ state: 'hidden' })
  assert.equal(await panel.getAttribute('data-fullscreen'), 'true')
  await panel.getByRole('button', { name: 'Quitter le plein écran', exact: true }).focus()
  // Au clavier, le premier Échap ferme l'aide du bouton avant le plein écran.
  await page.getByRole('tooltip').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('tooltip').waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  assert.equal(await panel.getAttribute('data-fullscreen'), null, 'Escape outside the editor exits full screen first')
  assert.equal(await panel.isVisible(), true)
  assert.equal(await code.evaluate(node => node === window.ideCodeNode), true)

  // Deux fichiers homonymes, créés uniquement dans le workspace temporaire.
  for (const data of [{ parent: '', name: 'ui-check', kind: 'directory' }, { parent: 'ui-check', name: 'package.json', kind: 'file' }]) {
    assert.ok((await context.request.post(`${base}/api/projects/${project.id}/entries`, { data })).ok())
  }
  for (const path of ['package.json', 'ui-check/package.json', 'src/App.tsx', 'src/components/CityList.tsx', 'src/components/ForecastCard.tsx', 'src/lib/forecast.ts']) await openFile(path)
  const showTree = panel.getByRole('button', { name: "Afficher l'arborescence", exact: true })
  if (await showTree.count()) await showTree.click()
  await panel.locator('button[aria-current="true"]').filter({ hasText: 'forecast.ts' }).waitFor()
  const tabs = panel.locator('[data-file-tabs]')
  assert.equal(await tabs.locator('span').filter({ hasText: /^ui-check$/ }).count(), 1, 'Duplicate names show their parent folder')
  const selectedTab = tabs.locator('[data-editor-tab][aria-pressed="true"]')
  await page.waitForFunction(() => {
    const strip = document.querySelector('[data-file-tabs]').getBoundingClientRect()
    const tab = document.querySelector('[data-editor-tab][aria-pressed="true"]').closest('[data-index]').getBoundingClientRect()
    return tab.x >= strip.x - 1 && tab.x + tab.width <= strip.x + strip.width + 1
  })
  const visibleTab = await selectedTab.locator('..').boundingBox(), strip = await tabs.boundingBox()
  assert.ok(visibleTab.x >= strip.x - 1 && visibleTab.x + visibleTab.width <= strip.x + strip.width + 1, 'The active tab scrolls into view')
  await selectedTab.focus()
  await page.keyboard.press('Home')
  assert.equal(await tabs.locator('[data-editor-tab]').first().getAttribute('aria-pressed'), 'true')
  // La liste des fichiers ouverts a quitté le « ⋯ » : la rangée les porte déjà et
  // défile. Le menu ne garde que les gestes, et l'onglet s'active où il est.
  await tabs.locator('[data-editor-tab]').filter({ hasText: 'ui-check' }).first().click()
  await panel.locator('[data-editor-file="ui-check/package.json"]').waitFor()
  await panel.getByRole('button', { name: 'Actions des onglets', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Fermer cet onglet', exact: true }).click()
  await panel.locator('[data-editor-file="ui-check/package.json"]').waitFor({ state: 'detached' })
  await panel.getByRole('button', { name: 'Actions des onglets', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Rouvrir le dernier fermé', exact: true }).click()
  await panel.locator('[data-editor-file="ui-check/package.json"]').waitFor()

  await openPicker()
  await input.fill('zzzz-ui-no-such-file')
  await picker.getByText('Aucun fichier trouvé.', { exact: true }).waitFor()
  const searchRoute = `**/api/projects/${project.id}/tree/search?q=ui-network-failure`
  await page.route(searchRoute, route => route.fulfill({ status: 503, json: { error: { code: 'ui_search_failed', message: 'Unavailable' } } }))
  await input.fill('ui-network-failure')
  await picker.getByRole('alert').waitFor()
  await page.unroute(searchRoute)
  await picker.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await picker.getByText('Aucun fichier trouvé.', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  console.log('OK : plein écran sans remontage, focus, onglets homonymes, sélection visible et erreur de recherche récupérable.')

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await openPicker()
    await input.fill('CityList')
    await picker.getByRole('option', { name: 'src/components/CityList.tsx', exact: true }).click()
    await panel.locator('[data-editor-file="src/components/CityList.tsx"]').waitFor()
    await code.waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `IDE overflow at ${width}px`)
    assert.equal(await code.isVisible(), true, 'Quick open exposes the file when the mobile tree was covering it')
  }
  const terminalResponse = await context.request.post(`${base}/api/projects/${project.id}/terminals`, { data: {} })
  assert.ok(terminalResponse.ok())
  const terminal = await terminalResponse.json()
  try {
    await panel.getByRole('button', { name: 'Terminaux', exact: true }).click()
    const term = panel.locator('.xterm').first()
    await term.waitFor()
    await term.evaluate(node => { window.ideTerminalNode = node })
    await toFullscreen()
    await panel.getByRole('button', { name: 'Git', exact: true }).click()
    await panel.getByRole('button', { name: 'Terminaux', exact: true }).click()
    assert.equal(await term.evaluate(node => node === window.ideTerminalNode), true, 'Fullscreen and Git must retain the terminal DOM')
    await panel.getByRole('button', { name: 'Quitter le plein écran', exact: true }).click()
    assert.equal(await term.evaluate(node => node === window.ideTerminalNode), true)
    await panel.getByRole('button', { name: 'Fichiers', exact: true }).click()
  } finally {
    assert.ok((await context.request.delete(`${base}/api/projects/${project.id}/terminals/${terminal.id}`)).ok())
  }
  await (await closePanelButton(page)).click()
  await panel.waitFor({ state: 'hidden' })
  console.log('OK : ouverture et palette de 320 à 1440 px, terminal conservé en plein écran et au passage par Git.')
}
