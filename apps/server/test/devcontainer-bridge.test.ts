import assert from 'node:assert/strict'
import { createServer, type AddressInfo } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import test from 'node:test'
import { BridgeListeners } from '../src/environments/devcontainer/bridge.js'

/** 127.0.0.2 tient lieu de passerelle Docker : toute la plage 127/8 se lie sous Linux. */
const GATEWAY = '127.0.0.2'

test("sous Linux natif, le serveur écoute aussi sur la passerelle Docker, à son port, avec ses routes", async (t) => {
  const main = createHttpServer((req, res) => res.end(`${req.url} depuis ${req.socket.remoteAddress}`))
  await new Promise<void>((resolve) => main.listen(0, '127.0.0.1', resolve))
  t.after(() => main.close())
  const port = (main.address() as AddressInfo).port
  const bridges = new BridgeListeners()
  bridges.serve(main)

  await bridges.ensure(GATEWAY)
  await bridges.ensure(GATEWAY)

  const answer = await fetch(`http://${GATEWAY}:${port}/mcp`).then((res) => res.text())
  assert.equal(answer, '/mcp depuis 127.0.0.1', 'la requête arrive au serveur principal')
})

test("une passerelle où l'on ne peut pas écouter est refusée, puis retentée au conteneur suivant", async (t) => {
  const main = createHttpServer((_req, res) => res.end('ok'))
  await new Promise<void>((resolve) => main.listen(0, '127.0.0.1', resolve))
  t.after(() => main.close())
  const port = (main.address() as AddressInfo).port
  const squatter = createServer()
  await new Promise<void>((resolve) => squatter.listen(port, GATEWAY, resolve))
  const bridges = new BridgeListeners()
  bridges.serve(main)

  await assert.rejects(bridges.ensure(GATEWAY), /EADDRINUSE/)
  await new Promise<void>((resolve) => squatter.close(() => resolve()))
  await bridges.ensure(GATEWAY)
  assert.equal(await fetch(`http://${GATEWAY}:${port}/`).then((res) => res.text()), 'ok')
})

test('avant que le serveur écoute, aucune passerelle ne s’ouvre', async () => {
  await assert.rejects(new BridgeListeners().ensure(GATEWAY), /not listening yet/)
})
