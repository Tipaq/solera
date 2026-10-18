import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import dns from 'node:dns'
import { after, mock, test } from 'node:test'
import Fastify from 'fastify'
import type { UserRow } from '@solera/db'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerFrameGuard } from '../src/http/frame-guard.js'
import { registerWebRoutes } from '../src/http/routes/web.js'
import { embeddable, readWebPage, safeUrl, sanitizeHtml, WebReadError } from '../src/web-reader.js'

/**
 * Le HTML lu part tel quel dans le panneau, sur l'origine de Solera : le nettoyage est
 * la seule barrière entre un site tiers et la session de l'utilisateur.
 */

test('le nettoyage retire tout ce qui s\'exécute, et garde le texte', () => {
  const html = sanitizeHtml(
    '<p onclick="steal()" style="color:red">Bonjour <b>toi</b><script>steal()</script></p>'
      + '<iframe src="https://evil.test"></iframe><custom-el>texte gardé</custom-el>'
      + '<a href="javascript:steal()">piège</a><img src="x" onerror="steal()">',
    'https://site.test/blog/',
  )
  assert.doesNotMatch(html, /script|onclick|onerror|style=|iframe|javascript:/)
  assert.match(html, /Bonjour <b>toi<\/b>/)
  assert.match(html, /texte gardé/)
  assert.match(html, /<a rel="noopener noreferrer">piège<\/a>/, 'un lien dangereux perd son adresse, pas son texte')
  assert.match(html, /<img [^>]*src="https:\/\/site\.test\/blog\/x"/, 'une image relative devient absolue')
  assert.match(html, /<img [^>]*referrerpolicy="no-referrer"/, 'et ne dit pas d’où on la regarde')
})

test('commentaires, CDATA et instructions de traitement disparaissent : les analyseurs y divergent', () => {
  // linkedom lit ce qui suit comme un seul commentaire ; le navigateur le ferme sur
  // `--!>`, et l'image qui suit devenait un vrai élément, son script exécuté.
  for (const trap of [
    '<!--x--!><img src=x onerror="steal()">-->',
    '<!--!><img src=x onerror="steal()">-->',
    '<![CDATA[><img src=x onerror="steal()">]]>',
    '<?x <img src=x onerror="steal()">?>',
  ]) {
    const html = sanitizeHtml(`<p>avant</p>${trap}<p>après</p>`, 'https://site.test/')
    assert.doesNotMatch(html, /onerror|<!--|<\?/, trap)
    assert.match(html, /<p>avant<\/p>/)
  }
})

test('les adresses relatives se résolvent sur la page, les schémas exotiques tombent', () => {
  assert.equal(safeUrl('../a', 'https://site.test/b/c'), 'https://site.test/a')
  assert.equal(safeUrl('mailto:x@y.z', 'https://site.test/'), 'mailto:x@y.z')
  assert.equal(safeUrl('javascript:alert(1)', 'https://site.test/'), null)
  assert.equal(safeUrl('data:text/html,<b>', 'https://site.test/', true), null)
  assert.ok(safeUrl('data:image/png;base64,AAAA', 'https://site.test/', true))
})

test('une page qui interdit le cadre est reconnue', () => {
  assert.equal(embeddable(new Headers()), true)
  assert.equal(embeddable(new Headers({ 'x-frame-options': 'SAMEORIGIN' })), false)
  assert.equal(embeddable(new Headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" })), false)
  assert.equal(embeddable(new Headers({ 'content-security-policy': 'frame-ancestors *' })), true)
  assert.equal(embeddable(new Headers({ 'content-security-policy': "default-src 'self'" })), true)
})

test('le cadre se juge sur toutes les politiques, et comme le navigateur', () => {
  const headers = (pairs: [string, string][]) => {
    const result = new Headers()
    for (const [name, value] of pairs) result.append(name, value)
    return result
  }
  assert.equal(embeddable(headers([
    ['content-security-policy', "default-src 'self'"],
    ['content-security-policy', "frame-ancestors 'none'"],
  ])), false, 'deux en-têtes CSP : le second compte')
  assert.equal(embeddable(headers([['x-frame-options', 'ALLOWALL']])), true, 'une valeur inconnue est ignorée')
  assert.equal(embeddable(headers([['x-frame-options', 'deny']])), false)
  assert.equal(embeddable(headers([['content-security-policy', 'frame-ancestors https:']])), true)
  assert.equal(embeddable(headers([['content-security-policy', 'frame-ancestors']])), false, 'sans source, rien n’est permis')
  assert.equal(embeddable(headers([
    ['x-frame-options', 'SAMEORIGIN'],
    ['content-security-policy', 'frame-ancestors *'],
  ])), true, 'frame-ancestors l’emporte sur X-Frame-Options')
})

const server = createServer((request, response) => {
  if (request.url === '/metadata') {
    response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
    response.end()
    return
  }
  if (request.url === '/missing') {
    response.writeHead(404, { 'content-type': 'text/html' })
    response.end('<p>absent</p>')
    return
  }
  if (request.url === '/bare') {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('du texte nu')
    return
  }
  if (request.url === '/heavy') {
    // Du balisage dense : à ce volume, l'extraction dépasse le tas de son fil.
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<html><body><article>${'<p>mot <b>gras</b> fin</p>'.repeat(180_000)}</article></body></html>`)
    return
  }
  if (request.url === '/moved') {
    response.writeHead(302, { location: '/article' })
    response.end()
    return
  }
  if (request.url === '/image') {
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end('png')
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' })
  response.end(`<!doctype html><html><head><title>Un article</title></head><body>
    <nav>menu menu menu</nav>
    <article><h1>Un article</h1>
    ${'<p>Un long paragraphe qui raconte quelque chose d’assez long pour être retenu comme article. </p>'.repeat(12)}
    <script>alert(1)</script></article></body></html>`)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
after(() => server.close())

test('une page se lit redirections suivies, sans script, et dit qu\'elle refuse le cadre', async () => {
  const page = await readWebPage(`${base}/moved`)
  assert.equal(page.url, `${base}/article`)
  assert.equal(page.title, 'Un article')
  assert.equal(page.embeddable, false)
  assert.ok(page.html?.includes('Un long paragraphe'))
  assert.doesNotMatch(page.html ?? '', /<script|alert/)
})

test('ce qui n\'est pas du HTML est laissé au mode direct', async () => {
  const page = await readWebPage(`${base}/image`)
  assert.equal(page.html, null)
  assert.equal(page.contentType, 'image/png')
})

test('seuls http et https se lisent', async () => {
  await assert.rejects(readWebPage('file:///etc/passwd'))
  await assert.rejects(readWebPage('javascript:alert(1)'))
})

test('une adresse de liaison locale est refusée, en direct comme au bout d\'une redirection', async () => {
  // `/reserved/` et pas seulement `WebReadError` : un simple échec réseau en est une aussi.
  for (const address of [
    'http://169.254.169.254/latest/meta-data/',
    'http://2852039166/',
    'http://[::ffff:169.254.169.254]/',
    'http://[fe80::1]/',
    'http://100.100.100.100/',
    'http://[fd7a:115c:a1e0::53]/',
  ]) {
    await assert.rejects(readWebPage(address), /reserved/, address)
  }
  await assert.rejects(readWebPage(`${base}/metadata`), /reserved/)
})

/** Joue un serveur DNS : `answer` reçoit le nom et le rang de la question. */
function fakeDns(t: { after(fn: () => void): void }, answer: (hostname: string, count: number) => string | null) {
  const original = dns.lookup
  let count = 0
  const lookup = mock.method(dns, 'lookup', (hostname: string, options: unknown, callback: unknown) => {
    const done = (typeof options === 'function' ? options : callback) as (...args: unknown[]) => void
    const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all
    const address = hostname.endsWith('.test') ? answer(hostname, count++) : null
    if (!hostname.endsWith('.test')) return (original as (...args: unknown[]) => void)(hostname, options, callback)
    process.nextTick(() => {
      if (address === null) done(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }))
      else if (all) done(null, [{ address, family: 4 }])
      else done(null, address, 4)
    })
  })
  t.after(() => lookup.mock.restore())
}

test('un nom qui se résout en adresse réservée est refusé à la connexion', async (t) => {
  fakeDns(t, () => '169.254.169.254')
  await assert.rejects(readWebPage('http://metadata.test/'), /reserved/)
})

test('la connexion se fait sur la résolution vérifiée, pas sur une seconde (DNS rebinding)', async (t) => {
  // Un serveur de rebinding : une première réponse acceptable, puis l'adresse interdite.
  const port = (server.address() as { port: number }).port
  fakeDns(t, (_hostname, count) => (count === 0 ? '127.0.0.1' : '169.254.169.254'))
  const page = await readWebPage(`http://rebind.test:${port}/article`)
  assert.equal(page.title, 'Un article', 'une seule résolution, celle qui a été vérifiée')
})

test('un nom qui ne se résout pas n\'est pas lu', async (t) => {
  fakeDns(t, () => null)
  await assert.rejects(readWebPage('http://nowhere.test/'), (err) => err instanceof WebReadError && !/reserved/.test(err.message))
})

test('les échecs sortent en erreurs de lecture, pas en erreurs du serveur', async () => {
  await assert.rejects(readWebPage(`${base}/missing`), (err) => err instanceof WebReadError && /404/.test(err.message))
})

test('du texte nu servi en HTML se lit quand même', async () => {
  assert.match((await readWebPage(`${base}/bare`)).html ?? '', /du texte nu/)
})

test('le mode direct ne lit que les en-têtes', async () => {
  const page = await readWebPage(`${base}/article`, { frameOnly: true })
  assert.equal(page.html, null)
  assert.equal(page.contentType, 'text/html')
  assert.equal(page.embeddable, false)
})

test('une page trop lourde tue son processus d\'extraction, pas le serveur', async () => {
  await assert.rejects(readWebPage(`${base}/heavy`), /too heavy/)
  // Le serveur lit toujours.
  assert.equal((await readWebPage(`${base}/article`)).title, 'Un article')
})

test('la route exige une session, et l\'en-tête que seul le client de l\'API pose', async () => {
  const app = Fastify()
  registerErrorHandler(app)
  app.addHook('preHandler', async (request) => {
    if (request.headers['x-test-user']) request.user = { id: 'owner' } as UserRow
  })
  registerWebRoutes(app)
  const read = (headers: Record<string, string>) =>
    app.inject({ url: `/api/web/read?url=${encodeURIComponent(`${base}/article`)}`, headers })

  assert.equal((await read({ 'x-solera-request': '1' })).statusCode, 401)
  // Un lien ouvert depuis une autre application (`none`), une image d'une page lue
  // (`same-origin`), un navigateur sans Sec-Fetch-Site : aucun ne pose l'en-tête.
  for (const site of [undefined, 'none', 'same-origin', 'cross-site']) {
    const response = await read({ 'x-test-user': '1', ...(site ? { 'sec-fetch-site': site } : {}) })
    assert.equal(response.statusCode, 403, site)
    assert.equal(response.json().error.code, 'web_cross_site')
  }
  assert.equal((await read({ 'x-test-user': '1', 'x-solera-request': '1' })).statusCode, 200)
  await app.close()
})

test('Solera ne s\'affiche dans le cadre de personne, sauf un contenu qu\'il encadre lui-même', async () => {
  const app = Fastify()
  registerFrameGuard(app)
  app.get('/page', async () => ({ ok: true }))
  app.get('/inert', async (_request, reply) => reply.header('content-security-policy', "default-src 'none'; sandbox").send('x'))
  app.get('/pdf', async (_request, reply) => reply.header('content-security-policy', "frame-ancestors 'self'").send('x'))
  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send('absent'))

  const policy = async (url: string) => (await app.inject({ url })).headers['content-security-policy']
  assert.equal(await policy('/page'), "frame-ancestors 'none'")
  assert.equal(await policy('/inert'), "default-src 'none'; sandbox; frame-ancestors 'none'")
  assert.equal(await policy('/pdf'), "frame-ancestors 'self'")
  assert.equal(await policy('/ailleurs'), "frame-ancestors 'none'", 'le repli aussi')
  await app.close()
})
