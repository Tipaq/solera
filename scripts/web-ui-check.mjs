import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/*
 * La vue *Web* du panneau.
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas :
 *
 * - **un résultat de recherche s'ouvre dans le panneau**, et non dans un onglet : la
 *   carte de l'outil rend ses liens, et le clic y mène ;
 * - **le mode Lecture montre le texte, sans rien exécuter** : la page de la fixture
 *   porte un script qui écrirait dans le titre de la fenêtre s'il tournait ;
 * - **un lien de la page lue reste dans la vue**, et l'historique en revient ;
 * - **un site qui refuse le cadre le dit**, au lieu d'un cadre vide ;
 * - **un lien d'une réponse** s'ouvre aussi dans la vue.
 *
 * Les pages viennent d'un serveur local monté ici : la suite ne dépend pas du réseau.
 *
 * Playwright a besoin de ses bibliothèques, qui ne sont pas dans le système :
 *   export LD_LIBRARY_PATH="$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu"
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-web-check-'))
const processes = []
let browser

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


/** L'origine de Solera, connue une fois le serveur lancé : le site de la fixture y renvoie. */
let solera = ''

/**
 * Le site de la fixture : un article qui refuse le cadre, une page qui l'accepte, et
 * deux pages qui mènent le cadre jusqu'à Solera — par une redirection, et par script.
 * Au lecteur du serveur, elles répondent une page sage : c'est ce que ferait un site qui
 * veut passer la sonde `frame=1` et ne piéger que le cadre.
 */
function startSite() {
  const paragraph = '<p>Une solera mélange des millésimes, en recomplétant la vieille barrique avec la jeune. </p>'
  const site = createHttpServer((request, response) => {
    if (request.url === '/article') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' })
      response.end(`<!doctype html><html><head><title>La méthode solera</title></head><body>
        <nav>Accueil · Blog · Contact</nav>
        <article><h1>La méthode solera</h1>${paragraph.repeat(10)}
        <p>Voir aussi <a href="/suite">la suite de l’article</a>.</p>
        <script>document.title = 'SCRIPT-EXECUTE'</script></article></body></html>`)
      return
    }
    if (request.url === '/vers-solera' || request.url === '/script-vers-solera') {
      const reader = /Solera\/1\.0 \(reader view\)/.test(request.headers['user-agent'] ?? '')
      if (reader) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><title>Rien</title><p>Rien à voir.</p>')
      } else if (request.url === '/vers-solera') {
        response.writeHead(302, { location: `${solera}/` })
        response.end()
      } else {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(`<!doctype html><script>location.href = ${JSON.stringify(`${solera}/`)}</script>`)
      }
      return
    }
    if (request.url === '/suite') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><title>La suite</title></head><body><article>
        <h1>La suite</h1>${'<p>La deuxième page, qui accepte d’être encadrée. </p>'.repeat(10)}
        </article></body></html>`)
      return
    }
    response.writeHead(404)
    response.end()
  })
  site.listen(0, '127.0.0.1')
  return site
}

/** Ajoute au fil une recherche web et une réponse qui cite une page. */
function appendSearch(database, conversationId, origin) {
  const require = createRequire(join(serverDir, 'package.json'))
  const Database = require('better-sqlite3')
  const db = new Database(database)
  const last = db.prepare('select max(seq) as seq from events where conversation_id = ?').get(conversationId).seq
  const links = [
    { title: 'La méthode solera — un article', url: `${origin}/article` },
    { title: 'La suite', url: `${origin}/suite` },
  ]
  const now = Date.now()
  const added = [
    { type: 'message.completed', messageId: 'msg_web_user', role: 'user', blocks: [{ type: 'text', text: 'Cherche comment marche une solera.' }], parentToolCallId: null },
    { type: 'turn.started' },
    { type: 'tool.started', toolCallId: 'toolu_web_1', name: 'WebSearch', input: { query: 'méthode solera' }, parentToolCallId: null },
    { type: 'tool.completed', toolCallId: 'toolu_web_1', output: `Web search results for query: "méthode solera"\n\nLinks: ${JSON.stringify(links)}\n\nUne solera mélange des millésimes.`, isError: false, durationMs: 900 },
    { type: 'message.completed', messageId: 'msg_web_answer', role: 'assistant', blocks: [{ type: 'text', text: `D’après [cet article](${origin}/article), on recomplète la vieille barrique avec la jeune.` }], parentToolCallId: null },
    { type: 'turn.completed', stopReason: 'success', costUsd: 0.01, inputTokens: 10, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 },
  ]
  const insert = db.prepare('insert into events (conversation_id, seq, ts, type, payload) values (?, ?, ?, ?, ?)')
  added.forEach((event, index) => insert.run(conversationId, last + index + 1, now + index, event.type, JSON.stringify(event)))
  db.prepare('update conversations set last_seq = ?, last_notable_seq = ? where id = ?').run(last + added.length, last + added.length, conversationId)
  db.close()
}

try {
  const site = startSite()
  await once(site, 'listening')
  const origin = `http://127.0.0.1:${site.address().port}`

  const apiPort = await freePort()
  const webPort = await freePort()
  const config = join(data, 'config.toml')
  await writeFile(config, '[agents.claude]\nenabled = false\n[agents.codex]\nenabled = false\n')
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
  solera = base
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`, server), ready(base, vite)])
  const seed = run(['--import', 'tsx', 'src/cli/demo-seed.ts'], serverDir, env)
  const [seedCode] = await once(seed, 'exit')
  assert.equal(seedCode, 0, seed.diagnostics)

  browser = await chromium.launch({ channel: 'chromium', chromiumSandbox: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await context.addInitScript((solera) => {
    if (window === window.top && location.origin === solera) localStorage.setItem('solera.locale', 'fr')
  }, new URL(base).origin)
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'alex', password: 'solera-demo' } })
  assert.ok(login.ok())

  const projects = await (await context.request.get(`${base}/api/projects`)).json()
  const nimbus = projects.find((entry) => entry.name === 'Nimbus')
  const threads = await (await context.request.get(`${base}/api/projects/${nimbus.id}/conversations`)).json()
  const thread = threads.find((entry) => entry.title === 'Radar tile prefetching')
  assert.ok(thread)
  appendSearch(join(data, 'data', 'solera.db'), thread.id, origin)

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-10-17-panneau-web')
  await mkdir(shots, { recursive: true })
  const panel = page.locator('[data-panel="workspace"]')

  await page.goto(`${base}/p/${nimbus.id}/c/${thread.id}`)
  await page.getByText('Cherche comment marche une solera.').first().waitFor()

  // ─── Un résultat de recherche s'ouvre dans le panneau ─────────────────────
  // La carte de l'outil se déplie pour montrer ses résultats.
  await page.getByText('méthode solera', { exact: true }).first().click()
  const result = page.getByRole('link', { name: /La méthode solera — un article/ })
  await result.waitFor()
  await result.click()
  await panel.getByRole('button', { name: 'Web', exact: true }).waitFor()
  assert.equal(page.context().pages().length, 1, 'le résultat ne quitte pas Solera')
  // L'adresse est locale : elle part en Direct, comme un aperçu. Le site refuse le
  // cadre, et la vue le dit au lieu de montrer un cadre vide.
  await panel.getByText(/refuse d’être affiché dans Solera/).waitFor()
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'direct-refuse.png') })
  console.log('OK : un résultat de recherche s’ouvre dans le panneau, et un site qui refuse le cadre le dit.')

  // ─── Lecture : le texte, sans script ni menu du site ──────────────────────
  await panel.getByRole('radio', { name: 'Lecture' }).click()
  await panel.getByRole('heading', { name: 'La méthode solera' }).waitFor()
  await panel.getByText(/recomplétant la vieille barrique/).first().waitFor()
  assert.equal(await panel.getByText('Accueil · Blog · Contact').count(), 0, 'la navigation du site est retirée')
  assert.notEqual(await page.title(), 'SCRIPT-EXECUTE', 'le script de la page ne tourne pas')
  assert.equal(await panel.locator('.sg-web-reader script').count(), 0)
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'lecture.png') })
  console.log('OK : Lecture montre le texte de la page, sans script ni menu du site.')

  // ─── Un lien de la page reste dans la vue, et l'historique en revient ──────
  await panel.getByRole('link', { name: 'la suite de l’article' }).click()
  await panel.getByRole('heading', { name: 'La suite' }).waitFor()
  await panel.getByRole('button', { name: 'Page précédente', exact: true }).click()
  await panel.getByRole('heading', { name: 'La méthode solera' }).waitFor()
  assert.equal(page.context().pages().length, 1)
  console.log('OK : un lien de la page lue reste dans la vue, et « précédente » y revient.')

  // ─── Direct : un site qui accepte le cadre s'affiche ──────────────────────
  await panel.getByRole('textbox', { name: 'Adresse de la page' }).fill(`${origin}/suite`)
  await panel.getByRole('textbox', { name: 'Adresse de la page' }).press('Enter')
  await panel.getByRole('radio', { name: 'Direct' }).click()
  const frame = panel.frameLocator('iframe')
  await frame.getByRole('heading', { name: 'La suite' }).waitFor()
  assert.equal(await panel.getByText(/refuse d’être affiché/).count(), 0)
  await panel.screenshot({ animations: 'disabled', path: join(shots, 'direct.png') })
  console.log('OK : Direct montre la vraie page quand le site l’accepte.')

  // ─── Un lien d'une réponse s'ouvre aussi dans la vue ──────────────────────
  await page.getByRole('link', { name: 'cet article' }).click()
  // Ouverte depuis le fil, l'adresse locale repart en Direct, comme un aperçu.
  await panel.getByText(/refuse d’être affiché dans Solera/).waitFor()
  assert.equal(page.context().pages().length, 1)
  console.log('OK : un lien d’une réponse s’ouvre dans la vue Web.')

  // ─── Le cadre ne peut pas être mené jusqu'à Solera ────────────────────────
  // Le mode Direct garde `allow-same-origin` pour un site tiers ; si ce site redirige
  // le cadre vers Solera, la page y aurait l'origine de Solera et la main sur
  // `parent.document`. Solera refuse tout cadre : le navigateur n'y charge rien.
  const address = panel.getByRole('textbox', { name: 'Adresse de la page' })
  for (const path of ['/vers-solera', '/script-vers-solera']) {
    await address.fill(`${origin}${path}`)
    await address.press('Enter')
    await panel.locator('iframe').waitFor()
    // Le temps que le cadre quitte la page du site, redirection ou script compris.
    const deadline = Date.now() + 5000
    const framed = () => page.frames().filter((entry) => entry !== page.mainFrame())
    while (Date.now() < deadline && framed().some((entry) => entry.url().startsWith(origin))) await delay(100)
    await delay(500)
    for (const entry of framed()) {
      assert.ok(!entry.url().startsWith(base), `${path} : Solera ne se charge pas dans le cadre (${entry.url()})`)
      const reached = await entry.evaluate(() => {
        try {
          return parent.document.title
        } catch {
          return null
        }
      }).catch(() => null)
      assert.equal(reached, null, `${path} : le cadre n'atteint pas la page de Solera`)
    }
  }
  console.log('OK : un site qui redirige le cadre vers Solera n’y charge rien.')

  // ─── Le second nettoyage, celui du navigateur, tient seul ─────────────────
  // La réponse du serveur est remplacée par du HTML brut : c'est le nettoyage du
  // panneau, sur l'arbre que le navigateur a analysé, qui est éprouvé ici. Le
  // commentaire fermé par `--!>` cache une image à linkedom, pas au navigateur ; les
  // champs nommés d'un `<form>` masquent `tagName` et `remove`.
  await page.route('**/api/web/read?*', (route) => {
    if (!route.request().url().includes(encodeURIComponent('/piege'))) return route.fallback()
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        url: `${origin}/piege`,
        title: 'Piège',
        siteName: null,
        byline: null,
        contentType: 'text/html',
        embeddable: true,
        html: '<p>Avant le piège.</p><!--x--!><img src=x onerror="document.title=\'XSS\'">-->'
          + '<form><input name="tagName"><input name="remove"><p>Dans le formulaire.</p></form>'
          + '<p>Après le piège.</p>',
      }),
    })
  })
  await address.fill(`${origin}/piege`)
  await address.press('Enter')
  await panel.getByRole('radio', { name: 'Lecture' }).click()
  await panel.getByText('Après le piège.').waitFor()
  await delay(300)
  assert.notEqual(await page.title(), 'XSS', 'l’image du commentaire ne s’exécute pas')
  // L'image existe bien pour le navigateur, mais sans rien qui s'exécute.
  const handlers = await panel.locator('.sg-web-reader *').evaluateAll((nodes) =>
    nodes.flatMap((node) => node.getAttributeNames().filter((name) => name.startsWith('on'))))
  assert.deepEqual(handlers, [], 'aucun attribut d’événement')
  assert.equal(await panel.locator('.sg-web-reader form, .sg-web-reader input').count(), 0)
  assert.equal(await panel.getByText('Dans le formulaire.').count(), 0, 'le formulaire part entier')
  await page.unroute('**/api/web/read?*')
  console.log('OK : le nettoyage du panneau tient seul, sur `--!>` comme sur un formulaire piégé.')

  // ─── Fermer la page fait disparaître l'onglet ─────────────────────────────
  await panel.getByRole('button', { name: 'Fermer la page', exact: true }).click()
  await panel.getByRole('button', { name: 'Web', exact: true }).waitFor({ state: 'detached' })
  console.log('OK : fermer la page retire l’onglet Web.')

  assert.deepEqual(errors, [])
  site.close()
  console.log(`Captures : ${shots}`)
} finally {
  await browser?.close()
  for (const child of processes) child.kill('SIGKILL')
  await rm(data, { recursive: true, force: true })
}
