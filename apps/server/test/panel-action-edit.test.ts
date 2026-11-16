import assert from 'node:assert/strict'
import { test } from 'node:test'

// `lib/panel.ts` relit ses préférences à son chargement.
const store = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) },
})

const { requestActionEdit, takeActionEdit, onActionEditRequest } = await import('../../web/src/lib/panel.js')

test('requestActionEdit : la graine attend l’onglet Actions, et ne se prend qu’une fois', () => {
  // L'onglet Actions n'est pas monté au moment de la demande : il la prendra en montant.
  requestActionEdit({ prefill: { label: 'Vite', command: 'pnpm dev' } })
  assert.deepEqual(takeActionEdit(), { prefill: { label: 'Vite', command: 'pnpm dev' } })
  assert.equal(takeActionEdit(), null)
})

test('requestActionEdit : un onglet monté est prévenu, et la dernière demande l’emporte', () => {
  let heard = 0
  const off = onActionEditRequest(() => heard++)
  requestActionEdit({ prefill: { command: 'a' } })
  requestActionEdit({ prefill: { command: 'b' } })
  assert.equal(heard, 2)
  assert.deepEqual(takeActionEdit(), { prefill: { command: 'b' } })
  off()
  requestActionEdit({ prefill: { command: 'c' } })
  assert.equal(heard, 2, 'désabonné, il n’entend plus rien')
  takeActionEdit()
})
