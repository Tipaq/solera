import assert from 'node:assert/strict'
import dns from 'node:dns'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { after, test } from 'node:test'
import Fastify from 'fastify'
import type { UserRow } from '@solera/db'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerWebRoutes } from '../src/http/routes/web.js'
import { sanitizeReaderTree, type ReaderElement, type ReaderNode } from '@solera/protocol'
import { embeddable, parseLimits, readWebPage, safeUrl, sanitizeHtml, WebReadError } from '../src/web-reader.js'

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

test('un nœud dont les propriétés sont masquées est retiré sans qu\'on les appelle', () => {
  // Dans le navigateur, `<form><input name="tagName"><input name="remove">` fait de
  // `form.tagName` et `form.remove` des champs : rien de ce qu'ils disent ne vaut.
  const removed: ReaderNode[] = []
  const field = { nodeType: 1, tagName: 'INPUT' }
  const masked = [
    { nodeType: 1, tagName: field, remove: field },
    { nodeType: field, tagName: 'FORM', remove: field },
  ]
  const root = {
    nodeType: 1,
    tagName: 'DIV',
    childNodes: masked,
    removeChild: (child: ReaderNode) => removed.push(child),
  } as unknown as ReaderElement
  sanitizeReaderTree(root, 'https://site.test/')
  assert.deepEqual(removed, masked)
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

test('un nom se vérifie sur la résolution même de la connexion', async (t) => {
  // Un DNS de rebinding : la première réponse est sans danger, les suivantes visent
  // l'adresse interdite. Il n'y a qu'une résolution, et c'est elle qui est vérifiée.
  const { port } = new URL(base)
  let calls = 0
  const original = dns.lookup
  t.mock.method(dns, 'lookup', (hostname: string, options: object, callback: (...args: unknown[]) => void) => {
    if (hostname === 'reserved.test') return callback(null, [{ address: '169.254.169.254', family: 4 }])
    if (hostname === 'rebind.test') {
      calls++
      return callback(null, [{ address: calls === 1 ? '127.0.0.1' : '169.254.169.254', family: 4 }])
    }
    return Reflect.apply(original, dns, [hostname, options, callback])
  })
  await assert.rejects(readWebPage(`http://reserved.test:${port}/article`), /reserved/)
  assert.equal((await readWebPage(`http://rebind.test:${port}/article`)).title, 'Un article')
  assert.equal(calls, 1, 'une seule résolution par connexion')
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

test('une extraction trop longue est arrêtée, et la file reste bornée', async (t) => {
  const limits = { ...parseLimits }
  t.after(() => Object.assign(parseLimits, limits))

  parseLimits.timeoutMs = 1
  await assert.rejects(readWebPage(`${base}/article`), /too long/)

  Object.assign(parseLimits, limits, { parallel: 1, waiting: 0 })
  const results = await Promise.allSettled([readWebPage(`${base}/article`), readWebPage(`${base}/article`)])
  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected'])
  assert.match(String((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason), /Too many/)
})

test('la route exige une session, et n\'est appelée que par le client de Solera', async () => {
  const app = Fastify()
  registerErrorHandler(app)
  app.addHook('preHandler', async (request) => {
    if (request.headers['x-test-user']) request.user = { id: 'owner' } as UserRow
  })
  registerWebRoutes(app)
  const read = (headers: Record<string, string>) =>
    app.inject({ url: `/api/web/read?url=${encodeURIComponent(`${base}/article`)}`, headers })
  const client = { 'x-test-user': '1', 'x-solera-request': '1' }

  assert.equal((await read({})).statusCode, 401)
  for (const site of ['cross-site', 'same-site', 'none']) {
    const response = await read({ ...client, 'sec-fetch-site': site })
    assert.equal(response.statusCode, 403, site)
    assert.equal(response.json().error.code, 'web_cross_site')
  }
  // Une navigation, ou une image d'une page lue, partie de l'origine de Solera.
  assert.equal((await read({ 'x-test-user': '1', 'sec-fetch-site': 'same-origin' })).statusCode, 403)
  assert.equal((await read({ 'x-test-user': '1' })).statusCode, 403, 'un vieux navigateur, sans Sec-Fetch-Site')
  assert.equal((await read({ ...client, 'sec-fetch-site': 'same-origin' })).statusCode, 200)
  assert.equal((await read(client)).statusCode, 200, 'le client, sans Sec-Fetch-Site')
  await app.close()
})
