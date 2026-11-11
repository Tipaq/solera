import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './checks/browser.mjs'
import { viteDependency } from './checks/vite-deps.mjs'

// Le champ d'écriture à mentions (#192, WRT-1 à WRT-10, PJ-1 à PJ-5, CMP-5), monté seul
// dans un tiroir commun : composants réels, sans daemon ni base.
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

async function mount(page) {
  const modules = {
    react: await viteDependency(origin, 'react', '/src/components/writing/BriefField.tsx'),
    reactDom: await viteDependency(origin, 'react-dom/client', '/src/main.tsx'),
    ui: await viteDependency(origin, '@solera/ui', '/src/components/writing/BriefField.tsx'),
  }
  await page.goto(origin)
  await page.evaluate(async ({ modules }) => {
    const refresh = (await import('/@react-refresh')).default
    refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    localStorage.setItem('solera.locale', 'fr')
    await (await import('/src/lib/i18n/index.ts')).initLocale()
    document.documentElement.dataset.theme = 'dark'
    await import('/src/styles/index.css')
    const React = (await import(modules.react)).default
    const { createRoot } = (await import(modules.reactDom)).default
    const { Button, TooltipProvider } = await import(modules.ui)
    const { Drawer, DrawerLayer } = await import('/src/components/shell/Drawer.tsx')
    const { BriefField, DueField } = await import('/src/components/writing/BriefField.tsx')
    const { AttachedPieces } = await import('/src/components/writing/AttachedPieces.tsx')
    const { BriefSpotted } = await import('/src/components/writing/BriefSpotted.tsx')
    const { useBriefAttachments } = await import('/src/components/writing/use-brief-attachments.ts')
    const { readBrief } = await import('/src/lib/brief.ts')
    const { CARDS } = await import('/src/components/board/card-fixtures.tsx')
    const h = React.createElement

    function Writing({ low }) {
      const [text, setText] = React.useState('')
      const [due, setDue] = React.useState('')
      const [sent, setSent] = React.useState(0)
      const textRef = React.useRef(null)
      const attachments = useBriefAttachments(CARDS, text, setText)
      const reading = React.useMemo(() => readBrief(text), [text])
      return h('div', { className: 'flex flex-col gap-4 px-6 pt-2 pb-5' },
        // Pousse le champ en bas de la fenêtre : la liste des cartes passe au-dessus.
        low ? h('div', { style: { height: 'calc(100dvh - 22rem)' } }) : null,
        h(BriefField, {
          value: text, onChange: setText, label: 'Brief du jalon', placeholder: 'ex. Mode hors-ligne complet', rows: low ? 4 : 12,
          cards: CARDS, attachments, onSubmitShortcut: () => setSent((count) => count + 1), textRef,
          aside: h(DueField, { value: due, onChange: setDue }),
        }),
        h(AttachedPieces, { attachments, allowInclude: true }),
        h(BriefSpotted, { reading, attachments }),
        h('output', { 'aria-label': 'Envois' }, String(sent)))
    }

    function Page() {
      const [open, setOpen] = React.useState(false)
      const [low, setLow] = React.useState(false)
      return h('div', { className: 'flex h-dvh flex-col' },
        h('nav', { className: 'h-12 shrink-0 border-b border-line', 'aria-label': 'Rangée' }),
        h('div', { 'data-place-content': '', className: 'relative flex min-h-0 flex-1 flex-col overflow-clip' },
          h('div', { className: 'p-6' },
            h(Button, { size: 'sm', onClick: () => { setLow(false); setOpen(true) } }, 'Nouveau jalon'),
            ' ',
            h(Button, { size: 'sm', onClick: () => { setLow(true); setOpen(true) } }, 'Champ en bas')),
          h(Drawer, { open, onClose: () => setOpen(false), label: 'Nouveau jalon', title: 'Nouveau jalon', width: 'wide' },
            h('div', { className: 'min-h-0 flex-1 overflow-y-auto' }, h(Writing, { low }))),
          h(DrawerLayer)))
    }

    createRoot(document.getElementById('check')).render(h(TooltipProvider, null, h(Page)))
  }, { modules })
}

/** Une image PNG d'un pixel, de 70 octets. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Colle dans la zone : des fichiers (en base 64), ou du texte. */
async function paste(area, { text = '', files = [] }) {
  await area.evaluate((element, { text, files }) => {
    const data = new DataTransfer()
    if (text) data.setData('text/plain', text)
    for (const file of files) data.items.add(new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, { type: file.type }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, { text, files })
}

try {
  for (let i = 0; i < 150; i++) {
    if (await fetch(origin).then((r) => r.ok).catch(() => false)) break
    if (vite.exitCode !== null) throw new Error(diagnostics)
    await delay(100)
  }
  browser = await launchBrowser()
  for (const width of [1280, 390]) {
    const phone = width < 700
    const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: phone, isMobile: phone, serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    // Les avertissements de React comptent ; la connexion HMR de Vite, refusée ici, non.
    page.on('console', (message) => { if (message.type() === 'error' && !/WebSocket|\[vite\]/.test(message.text())) errors.push(message.text()) })
    await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="check"></div></body></html>' }))
    await page.route(`${origin}/api/**`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await mount(page)

    const drawer = page.getByRole('dialog', { name: 'Nouveau jalon' })
    const area = drawer.getByRole('textbox', { name: 'Brief du jalon' })
    const frame = drawer.locator('[data-brief-field]')
    const list = drawer.getByRole('listbox', { name: 'Cartes' })
    const joined = drawer.getByRole('region', { name: 'Pièces jointes' })
    const settle = () => page.waitForTimeout(260)
    const shot = (locator, name) => locator.screenshot({ path: `/tmp/brief-field-${name}-${width}.png` })

    await page.getByRole('button', { name: 'Nouveau jalon', exact: true }).click()
    await drawer.waitFor()
    await settle()

    console.log(width, 'WRT-1, WRT-8 : un seul cadre, la barre et l’échéance à droite')
    assert.equal(await area.evaluate((element) => element === document.activeElement), true, 'La zone prend le focus')
    for (const name of ['Joindre une carte', 'Joindre un lien', 'Joindre un fichier']) {
      assert.equal(await frame.getByRole('button', { name, exact: true }).isVisible(), true, name)
    }
    const due = frame.getByText('Échéance', { exact: true })
    const fileButton = await frame.getByRole('button', { name: 'Joindre un fichier' }).boundingBox()
    assert.ok((await due.boundingBox()).x > fileButton.x + 40, 'L’échéance à droite de la barre')
    assert.equal(await area.evaluate((element) => getComputedStyle(element).resize), 'none', 'Sans poignée')
    assert.equal(await joined.count(), 0, 'PJ-1 : rien de joint, pas de rangée')
    await shot(frame, 'vide')

    console.log(width, 'WRT-4 : `#` ouvre la liste, sous le cadre entier')
    await area.pressSequentially('Cache local, voir #')
    await list.waitFor()
    const options = list.getByRole('option')
    assert.equal(await options.count(), 6, 'Au plus six')
    assert.match(await options.first().innerText(), /#62[\s\S]*menu du compte[\s\S]*À faire/, 'Numéro, titre, colonne')
    assert.equal(await list.getByText('↑↓ choisir · Entrée joindre · Échap fermer').isVisible(), true)
    const frameBox = await frame.boundingBox()
    const listBox = await list.boundingBox()
    assert.ok(listBox.y >= frameBox.y + frameBox.height, 'Sous le cadre, barre comprise : la barre reste visible')
    assert.equal(await area.getAttribute('aria-expanded'), 'true')
    await shot(drawer, 'liste')

    console.log(width, 'WRT-5 : ↑↓ circulent, Entrée insère `#N `')
    await area.press('ArrowDown')
    assert.equal(await options.nth(1).getAttribute('aria-selected'), 'true')
    await area.press('ArrowUp')
    await area.press('ArrowUp')
    assert.equal(await options.last().getAttribute('aria-selected'), 'true', 'En boucle')
    await area.press('ArrowDown')
    await area.press('Enter')
    await list.waitFor({ state: 'detached' })
    assert.equal(await area.inputValue(), 'Cache local, voir #62 ')

    console.log(width, 'WRT-2, WRT-10 : la mention surlignée devient une pièce jointe')
    const mark = frame.locator('[aria-hidden] span', { hasText: '#62' })
    assert.equal(await mark.count(), 1, 'Surlignée')
    await joined.waitFor()
    assert.equal(await joined.getByText('Joint · 1').isVisible(), true)
    assert.equal(await joined.getByText('Le menu du compte déborde sur mobile').isVisible(), true)

    console.log(width, 'WRT-4 : une recherche par titre')
    await area.pressSequentially('et #fils')
    await list.waitFor()
    assert.equal(await options.count(), 2)
    await options.filter({ hasText: '#21' }).click()
    await list.waitFor({ state: 'detached' })
    assert.equal(await area.inputValue(), 'Cache local, voir #62 et #21 ')
    assert.equal(await joined.getByText('Joint · 2').isVisible(), true)

    console.log(width, 'WRT-5 : Échap retire un `#` seul, sans fermer le tiroir')
    await area.pressSequentially('#')
    await list.waitFor()
    await page.keyboard.press('Escape')
    await list.waitFor({ state: 'detached' })
    assert.equal(await area.inputValue(), 'Cache local, voir #62 et #21 ')
    assert.equal(await drawer.isVisible(), true, 'Le tiroir reste')

    console.log(width, 'WRT-5 : une recherche entamée reste, et la liste ne se rouvre pas pour elle')
    await area.pressSequentially('#Lir')
    await list.waitFor()
    await page.keyboard.press('Escape')
    await list.waitFor({ state: 'detached' })
    await area.pressSequentially('e')
    await settle()
    assert.equal(await list.count(), 0, 'Pas rouverte')
    assert.equal(await area.inputValue(), 'Cache local, voir #62 et #21 #Lire')
    await area.press('Control+a')
    await area.pressSequentially('Cache local, voir #62 et #21 ')

    console.log(width, 'WRT-5 : la perte de focus ferme et retire le `#` seul')
    await area.pressSequentially('#')
    await list.waitFor()
    await drawer.getByRole('heading', { name: 'Nouveau jalon' }).click()
    await list.waitFor({ state: 'detached' })
    assert.equal(await area.inputValue(), 'Cache local, voir #62 et #21 ')

    console.log(width, 'WRT-8 : le bouton « Carte » insère `#` et ouvre la liste')
    await area.click()
    await area.press('End')
    await page.keyboard.press('Control+End')
    await frame.getByRole('button', { name: 'Joindre une carte' }).click()
    await list.waitFor()
    assert.equal(await area.inputValue(), 'Cache local, voir #62 et #21 #')
    await page.keyboard.press('Escape')
    await list.waitFor({ state: 'detached' })

    console.log(width, 'WRT-6 : une URL seule collée devient une puce, rien dans le texte')
    await paste(area, { text: 'https://github.com/Tipaq/solera/pull/212' })
    const pr = joined.getByText('PR #212')
    await pr.waitFor()
    assert.equal(await joined.getByText('Tipaq/solera').isVisible(), true, 'PJ-4 : owner/repo')
    assert.equal(await area.inputValue(), 'Cache local, voir #62 et #21 ', 'Le texte ne bouge pas')
    await paste(area, { text: 'voir aussi https://github.com/Tipaq/solera/issues/34, et la doc' })
    await joined.getByText('Issue #34').waitFor()

    console.log(width, 'WRT-9 : le champ de lien en place, Entrée ajoute, Échap annule')
    await frame.getByRole('button', { name: 'Joindre un lien' }).click()
    const linkInput = frame.getByRole('textbox', { name: 'Adresse du lien' })
    await linkInput.waitFor()
    assert.equal(await frame.getByRole('button', { name: 'Joindre une carte' }).count(), 0, 'Remplace les icônes')
    await shot(frame, 'lien')
    await linkInput.fill('example.com/docs/offline-first_sync.html')
    await linkInput.press('Enter')
    await joined.getByText('Offline first sync').waitFor()
    assert.equal(await joined.getByRole('link', { name: /Offline first sync/ }).getAttribute('href'), 'https://example.com/docs/offline-first_sync.html', 'https:// ajouté')
    await frame.getByRole('button', { name: 'Joindre un lien' }).click()
    await linkInput.fill('presque')
    await page.keyboard.press('Escape')
    await linkInput.waitFor({ state: 'detached' })
    assert.equal(await drawer.isVisible(), true, 'Échap ferme le champ de lien, pas le tiroir')
    assert.equal(await joined.getByText('presque').count(), 0)

    console.log(width, 'PJ-5 : un fichier par le bouton, une image collée avec sa vignette')
    await frame.locator('input[type=file]').setInputFiles([{ name: 'notes-reunion.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(12 * 1024 + 100) }])
    await joined.getByText('notes-reunion.pdf').waitFor()
    assert.equal(await joined.getByText('12 Ko').isVisible(), true)
    await paste(area, { files: [{ name: 'capture.png', type: 'image/png', base64: PIXEL }] })
    await joined.getByText('capture.png').waitFor()
    assert.equal(await joined.getByText('70 o').isVisible(), true)
    const thumb = joined.locator('[data-piece]', { hasText: 'capture.png' })
    assert.equal(await thumb.locator('img').count(), 1, 'Vignette')
    assert.equal(Math.round((await thumb.boundingBox()).height), 40, 'Puce haute avec vignette')
    assert.equal(Math.round((await joined.locator('[data-piece]', { hasText: 'notes-reunion.pdf' }).boundingBox()).height), 28, 'Puce de 28 px')

    console.log(width, 'WRT-7 : déposer, avec le voile pendant le survol')
    await frame.evaluate((element) => {
      const data = new DataTransfer()
      data.items.add(new File(['plan'], 'plan.txt', { type: 'text/plain' }))
      element.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }))
    })
    await frame.getByText('Dépose pour joindre').waitFor()
    await shot(frame, 'depot')
    await frame.evaluate((element) => {
      const data = new DataTransfer()
      data.items.add(new File(['plan'], 'plan.txt', { type: 'text/plain' }))
      element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
    })
    await joined.getByText('plan.txt').waitFor()
    assert.equal(await frame.getByText('Dépose pour joindre').count(), 0, 'Le voile part')
    await frame.evaluate((element) => {
      const data = new DataTransfer()
      data.setData('text/uri-list', 'https://example.com/guide-du-cache')
      element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
    })
    await joined.getByText('Guide du cache').waitFor()
    assert.equal(await joined.getByText('Joint · 9').isVisible(), true)

    console.log(width, 'CMP-12 : Réf. par défaut, Inclure au clic')
    const switcher = joined.getByRole('radiogroup', { name: '#62 : référence ou incluse' })
    assert.equal(await switcher.getByRole('radio', { name: 'Réf.' }).getAttribute('aria-checked'), 'true')
    await switcher.getByRole('radio', { name: 'Inclure' }).click()
    assert.equal(await switcher.getByRole('radio', { name: 'Inclure' }).getAttribute('aria-checked'), 'true')
    await shot(joined, 'joint')

    console.log(width, 'Repéré : ce qui est joint se compte')
    assert.equal(await drawer.getByText('2 cartes').isVisible(), true)
    assert.equal(await drawer.getByText('4 liens').isVisible(), true)
    assert.equal(await drawer.getByText('3 fichiers').isVisible(), true)

    console.log(width, 'PJ-2, WRT-10 : ⌫ sur une puce de carte la retire, et sa mention avec')
    await joined.locator('[data-piece]', { hasText: 'Le menu du compte' }).focus()
    await page.keyboard.press('Backspace')
    await joined.getByText('Le menu du compte déborde sur mobile').waitFor({ state: 'detached' })
    assert.equal(await area.inputValue(), 'Cache local, voir et #21 ')
    await joined.locator('[data-piece]', { hasText: 'plan.txt' }).focus()
    await page.keyboard.press('Delete')
    await joined.getByText('plan.txt').waitFor({ state: 'detached' })
    await joined.getByRole('button', { name: 'Retirer PR #212' }).click()
    await joined.getByText('PR #212').waitFor({ state: 'detached' })

    console.log(width, 'CMP-5 : l’échéance, puis son ✕')
    await frame.getByLabel('Échéance', { exact: true }).fill('2026-12-12')
    await frame.getByText('12 déc. 2026').waitFor()
    await frame.getByRole('button', { name: 'Retirer l’échéance' }).click()
    await due.waitFor()

    console.log(width, 'CMP-11 : ⌘/Ctrl+Entrée appelle le geste principal')
    await area.click()
    await area.press('Control+Enter')
    assert.equal(await drawer.getByRole('status', { name: 'Envois' }).innerText(), '1')

    console.log(width, 'WRT-3 : la zone grandit jusqu’à 384 px, puis défile')
    const minHeight = await area.evaluate((element) => element.getBoundingClientRect().height)
    assert.equal(Math.round(minHeight), 12 * 24 + 20, '12 lignes au départ')
    await area.fill(Array.from({ length: 30 }, (_, index) => `- étape ${index + 1}`).join('\n'))
    const grown = await area.evaluate((element) => ({ height: element.getBoundingClientRect().height, overflow: getComputedStyle(element).overflowY }))
    assert.equal(Math.round(grown.height), 384)
    assert.equal(grown.overflow, 'auto')
    const widths = await frame.evaluate((element) => [element.querySelector('[aria-hidden]').clientWidth, element.querySelector('textarea').clientWidth])
    assert.equal(widths[0], widths[1], 'WRT-2 : le calque garde la largeur de la zone, barre de défilement comprise')

    console.log(width, 'Échap, toutes couches fermées, ferme le tiroir')
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'detached' })

    console.log(width, 'WRT-4 : sans place en bas, la liste passe au-dessus du cadre')
    await page.getByRole('button', { name: 'Champ en bas', exact: true }).click()
    await drawer.waitFor()
    await settle()
    await area.pressSequentially('#')
    await list.waitFor()
    const lowFrame = await frame.boundingBox()
    const lowList = await list.boundingBox()
    assert.ok(lowList.y + lowList.height <= lowFrame.y, 'Au-dessus du cadre')
    await shot(drawer, 'liste-dessus')
    await page.keyboard.press('Escape')
    await list.waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'detached' })

    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('OK : cadre, barre, liste `#` (ordre, clavier, dessous/dessus, Échap par couches, focus), surlignage, mentions jointes et retirées, URL collée, lien en place, fichiers (bouton, collé, déposé), Réf./Inclure, Repéré, échéance, ⌘↵, hauteur ; ordinateur et téléphone.')
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  await once(vite, 'exit')
}
