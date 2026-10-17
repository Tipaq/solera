import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { after, test } from 'node:test'
import { embeddable, readWebPage, safeUrl, sanitizeHtml } from '../src/web-reader.js'

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
  assert.match(html, /<a>piège<\/a>/, 'un lien dangereux perd son adresse, pas son texte')
  assert.match(html, /<img src="https:\/\/site\.test\/blog\/x">/, 'une image relative devient absolue')
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

const server = createServer((request, response) => {
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
