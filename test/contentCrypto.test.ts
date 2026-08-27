// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  newContentKey, newKeySalt, encryptContent, decryptContent, wrapContentKey, unwrapContentKey, contentHash,
} from '../src/contentCrypto.ts'

const file = Array.from({ length: 500 }, (_, i) => (i * 7 + 13) & 0xff)

test('content: encrypt → decrypt round-trips with K', () => {
  const K = newContentKey()
  assert.equal(K.length, 32)
  const ct = encryptContent(file, K)
  assert.notDeepEqual(ct, file)
  assert.deepEqual(decryptContent(ct, K), file)
})

test('content: a wrong K cannot decrypt', () => {
  const ct = encryptContent(file, newContentKey())
  assert.throws(() => decryptContent(ct, newContentKey()))
})

test('wrap: any holder unwraps K from the public keySalt', () => {
  const K = newContentKey()
  const keySalt = newKeySalt()
  const wrapped = wrapContentKey(K, keySalt)
  assert.notDeepEqual(wrapped, K) // not the raw key
  assert.deepEqual(unwrapContentKey(wrapped, keySalt), K)
})

test('wrap: unwrapping under a different keySalt fails', () => {
  const K = newContentKey()
  const wrapped = wrapContentKey(K, newKeySalt())
  assert.equal(unwrapContentKey(wrapped, newKeySalt()), null)
})

test('end-to-end: encrypt file, wrap K, then unwrap + decrypt', () => {
  const K = newContentKey()
  const keySalt = newKeySalt()
  const ct = encryptContent(file, K)
  const hash = contentHash(ct)
  // ...later, a holder with only the public keySalt + wrappedK + ciphertext:
  const wrapped = wrapContentKey(K, keySalt)
  const recoveredK = unwrapContentKey(wrapped, keySalt)
  assert.ok(recoveredK)
  assert.deepEqual(decryptContent(ct, recoveredK!), file)
  assert.equal(contentHash(ct), hash) // ciphertext is what the template binds
})
