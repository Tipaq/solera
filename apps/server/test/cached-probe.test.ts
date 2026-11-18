import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CachedProbe } from '../src/agents/cached-probe.js'

/**
 * Une installation qui aboutit pendant une sonde l'invalide : ce que cette sonde a vu
 * d'un disque à moitié écrit ne s'installe pas en cache, et la lecture suivante ne s'y
 * greffe pas.
 */
test("une sonde en vol pendant l'invalidation ne remplit pas le cache", async () => {
  let release: (value: { n: number }) => void = () => {}
  let calls = 0
  const probe = new CachedProbe(60_000, () => {
    calls++
    return calls === 1 ? new Promise<{ n: number }>((resolve) => (release = resolve)) : Promise.resolve({ n: calls })
  })

  const stale = probe.read()
  probe.invalidate()
  const fresh = await probe.read()
  assert.equal(fresh.n, 2)
  release({ n: 1 })
  assert.equal((await stale).n, 1)
  assert.equal((await probe.read()).n, 2)
  assert.equal(calls, 2)
})
