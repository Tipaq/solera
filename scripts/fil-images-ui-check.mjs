import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/*
 * La visionneuse ouverte depuis le fil.
 *
 * Ce que la suite vérifie et qu'une relecture ne verrait pas :
 *
 * - **une image lue par un outil s'ouvre dans la visionneuse**, et non dans un onglet ;
 * - **c'est une vraie boîte de dialogue** : le focus y entre, Tab n'en sort pas, Échap
 *   la ferme et rend le focus à la vignette ;
 * - **Échap ne ferme qu'elle** : la recherche du fil, qui écoute la même touche, reste
 *   ouverte ;
 * - **une image du web s'ouvre sans requête de plus** vers son site : ni `HEAD`, ni
 *   autre chose que le `GET` de l'image elle-même.
 *
 * Playwright a besoin de ses bibliothèques, qui ne sont pas dans le système :
 *   export LD_LIBRARY_PATH="$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu"
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const serverDir = join(root, 'apps/server')
const webDir = join(root, 'apps/web')
const data = await mkdtemp(join(tmpdir(), 'solera-images-check-'))
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


/** Un PNG uni, de la taille demandée : la visionneuse n'a besoin que de ses dimensions. */
function png(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x80)
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0
  const chunk = (type, body) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    const tagged = Buffer.concat([Buffer.from(type), body])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(tagged))
    return Buffer.concat([length, tagged, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function crc32(buffer) {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

/** Ajoute au fil une lecture d'image et une réponse qui cite une image du web. */
function appendImages(database, conversationId, origin, image) {
  const require = createRequire(join(serverDir, 'package.json'))
  const Database = require('better-sqlite3')
  const db = new Database(database)
  const last = db.prepare('select max(seq) as seq from events where conversation_id = ?').get(conversationId).seq
  const added = [
    { type: 'message.completed', messageId: 'msg_img_user', role: 'user', blocks: [{ type: 'text', text: 'Regarde la capture.' }], parentToolCallId: null },
    { type: 'turn.started' },
    { type: 'tool.started', toolCallId: 'toolu_img_1', name: 'Read', input: { file_path: 'capture.png' }, parentToolCallId: null },
    { type: 'tool.completed', toolCallId: 'toolu_img_1', output: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') } }], isError: false, durationMs: 40 },
    { type: 'message.completed', messageId: 'msg_img_answer', role: 'assistant', blocks: [{ type: 'text', text: `Comparée au schéma de référence :\n\n![Le schéma](${origin}/schema.png)` }], parentToolCallId: null },
    { type: 'turn.completed', stopReason: 'success', costUsd: 0.01, inputTokens: 10, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 },
  ]
  const insert = db.prepare('insert into events (conversation_id, seq, ts, type, payload) values (?, ?, ?, ?, ?)')
  const now = Date.now()
  added.forEach((event, index) => insert.run(conversationId, last + index + 1, now + index, event.type, JSON.stringify(event)))
  db.prepare('update conversations set last_seq = ?, last_notable_seq = ? where id = ?').run(last + added.length, last + added.length, conversationId)
  db.close()
}

try {
  const image = png(1600, 900)
  const requests = []
  const site = createHttpServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' })
    response.end(request.method === 'HEAD' ? undefined : image)
  })
  site.listen(0, '127.0.0.1')
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
  appendImages(join(data, 'data', 'solera.db'), thread.id, origin, image)

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = join(root, 'docs/audits/2026-10-17-visionneuse-du-fil')
  await mkdir(shots, { recursive: true })

  await page.goto(`${base}/p/${nimbus.id}/c/${thread.id}`)
  await page.getByText('Regarde la capture.').first().waitFor()

  // ─── Une image lue par un outil s'ouvre dans la visionneuse ───────────────
  await page.getByText('capture.png').first().click()
  const thumbnail = page.getByTitle('Ouvrir dans la visionneuse').first()
  await thumbnail.click()
  const dialog = page.getByRole('dialog', { name: /capture\.png en plein écran/ })
  await dialog.waitFor()
  assert.equal(context.pages().length, 1, 'pas d’onglet du navigateur')
  // Les repères et le zoom sont ceux du panneau.
  await dialog.getByRole('status').waitFor()
  await page.keyboard.press('0')
  assert.equal(Number((await dialog.getByRole('status').textContent()).replace(/[^\d]/g, '')), 100)
  await page.screenshot({ animations: 'disabled', path: join(shots, 'visionneuse.png') })
  console.log('OK : une image lue par un outil s’ouvre dans la visionneuse, avec son zoom.')

  // ─── Une vraie boîte de dialogue ──────────────────────────────────────────
  const focusInside = () => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
  assert.ok(await focusInside(), 'le focus entre dans la visionneuse')
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    assert.ok(await focusInside(), 'Tab ne sort pas de la visionneuse')
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.ok(await thumbnail.evaluate((node) => node === document.activeElement), 'le focus revient à la vignette')
  console.log('OK : le focus entre, reste et revient ; Échap ferme.')

  // ─── Une image du brouillon se relit avant l'envoi ────────────────────────
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'brouillon.png', mimeType: 'image/png', buffer: image })
  await page.getByRole('button', { name: 'Retirer brouillon.png' }).waitFor()
  await page.getByRole('img', { name: 'brouillon.png' }).click()
  const draftDialog = page.getByRole('dialog', { name: /brouillon\.png en plein écran/ })
  await draftDialog.waitFor()
  await page.keyboard.press('Escape')
  await draftDialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Retirer brouillon.png' }).click()
  await page.getByRole('img', { name: 'brouillon.png' }).waitFor({ state: 'detached' })
  console.log('OK : une image jointe au brouillon s’ouvre dans la visionneuse.')

  // ─── Échap ne ferme qu'elle ───────────────────────────────────────────────
  await page.keyboard.press('Control+f')
  const search = page.getByPlaceholder(/Rechercher/)
  await search.waitFor()
  await page.getByRole('img', { name: 'Le schéma' }).click()
  const webDialog = page.getByRole('dialog', { name: /Le schéma en plein écran/ })
  await webDialog.waitFor()
  await page.keyboard.press('Escape')
  await webDialog.waitFor({ state: 'hidden' })
  await delay(200)
  assert.ok(await search.isVisible(), 'la recherche du fil reste ouverte')
  console.log('OK : Échap ferme la visionneuse et laisse la recherche du fil ouverte.')

  // ─── Aucune requête de plus vers le site de l'image ───────────────────────
  assert.deepEqual([...new Set(requests)], ['GET /schema.png'], `requêtes vues : ${requests.join(', ')}`)
  console.log('OK : une image du web s’ouvre sans requête de plus vers son site.')

  assert.deepEqual(errors, [])
  site.close()
  console.log(`Captures : ${shots}`)
} finally {
  if (browser) await browser.close()
  for (const child of processes) child.kill('SIGKILL')
  await rm(data, { recursive: true, force: true })
}
