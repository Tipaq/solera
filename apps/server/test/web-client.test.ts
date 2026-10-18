import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Fastify from 'fastify'
import { registerWebClient } from '../src/http/web-client.js'

test('l\'interface refuse tout cadre, sans toucher aux fichiers ni à l\'API', async (t) => {
  // Le mode *Direct* encadre des pages tierces avec leur origine : l'une d'elles qui
  // redirigerait le cadre vers Solera y chargerait la session, bac à sable levé.
  const root = await mkdtemp(join(tmpdir(), 'solera-web-client-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Solera</title>')
  await writeFile(join(root, 'manifest.webmanifest'), '{}')
  const app = Fastify()
  await registerWebClient(app, root)
  t.after(() => app.close())

  for (const url of ['/', '/index.html', '/p/projet/c/fil']) {
    const response = await app.inject({ url })
    assert.equal(response.statusCode, 200, url)
    assert.equal(response.headers['content-security-policy'], "frame-ancestors 'none'", url)
  }
  assert.equal((await app.inject({ url: '/manifest.webmanifest' })).headers['content-security-policy'], undefined)
  assert.equal((await app.inject({ url: '/api/absente' })).headers['content-security-policy'], undefined)
})
