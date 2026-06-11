// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  newContentKey, encryptContent, decryptContent, wrapContentKey, unwrapContentKey, contentHash,
} from '../src/contentCrypto.ts'

const tx1Ref = 'ab'.repeat(32)
const otherCollection = 'cd'.repeat(32)
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

test('wrap: any holder unwraps K from the public collection id', () => {
  const K = newContentKey()
  const wrapped = wrapContentKey(K, tx1Ref)
  assert.notDeepEqual(wrapped, K) // not the raw key
  assert.deepEqual(unwrapContentKey(wrapped, tx1Ref), K)
})

test('wrap: unwrapping under a different collection id fails', () => {
  const K = newContentKey()
  const wrapped = wrapContentKey(K, tx1Ref)
  assert.equal(unwrapContentKey(wrapped, otherCollection), null)
})

test('end-to-end: encrypt file, wrap K, then unwrap + decrypt', () => {
  const K = newContentKey()
  const ct = encryptContent(file, K)
  const hash = contentHash(ct)
  // ...later, a holder with only the collection id + wrappedK + ciphertext:
  const wrapped = wrapContentKey(K, tx1Ref)
  const recoveredK = unwrapContentKey(wrapped, tx1Ref)
  assert.ok(recoveredK)
  assert.deepEqual(decryptContent(ct, recoveredK!), file)
  assert.equal(contentHash(ct), hash) // ciphertext is what the template binds
})
