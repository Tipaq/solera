import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareVersions, parseVersion } from '../src/update/version.js'

test('un describe git vaut sa version de base', () => {
  assert.deepEqual(parseVersion('0.18.0-113-g29f39cc4'), [0, 18, 0])
  assert.deepEqual(parseVersion('v0.18.0-113-g29f39cc4-dirty'), [0, 18, 0])
  assert.equal(parseVersion('dev'), null)
})

test('une release plus récente dépasse un describe, la même non', () => {
  assert.ok(compareVersions('v0.19.0', '0.18.0-113-g29f39cc4') > 0)
  assert.equal(compareVersions('v0.18.0', '0.18.0-113-g29f39cc4'), 0)
  assert.ok(compareVersions('v0.18.0', '0.19.0-2-gabc1234') < 0)
})
