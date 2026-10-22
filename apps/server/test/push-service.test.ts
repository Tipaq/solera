import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_NOTIFICATION_PREFS, storedUserSettingsSchema } from '@solera/protocol'
import { pushServiceOf, vapidSubject } from '../src/push/push-service.js'

test("le sujet VAPID est l'origine https de l'instance, jamais une adresse locale", () => {
  assert.equal(vapidSubject('https://solera.example.ts.net/settings'), 'https://solera.example.ts.net')
  assert.equal(vapidSubject('https://solera.example.ts.net:8081'), 'https://solera.example.ts.net:8081')
  // Apple refuse ces sujets : mieux vaut le repli que le refus.
  assert.equal(vapidSubject('http://solera.example.ts.net'), null)
  assert.equal(vapidSubject('https://localhost:7517'), null)
  assert.equal(vapidSubject('https://127.0.0.1:7517'), null)
  assert.equal(vapidSubject('https://machine.local'), null)
  assert.equal(vapidSubject(''), null)
  assert.equal(vapidSubject('pas une adresse'), null)
})

test("le service d'un abonnement se lit dans son adresse", () => {
  assert.equal(pushServiceOf('https://web.push.apple.com/abc'), 'apple')
  assert.equal(pushServiceOf('https://fcm.googleapis.com/fcm/send/abc'), 'google')
  assert.equal(pushServiceOf('https://updates.push.services.mozilla.com/wpush/v2/abc'), 'mozilla')
  assert.equal(pushServiceOf('https://wns2-par02p.notify.windows.com/w/?token=abc'), 'microsoft')
  assert.equal(pushServiceOf('https://push.example/abc'), 'other')
  assert.equal(pushServiceOf('illisible'), 'other')
})

test('des réglages écrits avant les sortes de notifications les reçoivent toutes allumées', () => {
  assert.deepEqual(storedUserSettingsSchema.parse({}).notifications, DEFAULT_NOTIFICATION_PREFS)
  // Une sorte ajoutée depuis l'écriture arrive allumée, sans éteindre les autres.
  assert.deepEqual(storedUserSettingsSchema.parse({ notifications: { turnCompleted: false } }).notifications, {
    decision: true,
    cliRequest: true,
    turnCompleted: false,
  })
})
