// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey } from '@bsv/sdk'
import { deriveVoucherKey } from '../src/editionBuilder.ts'

const pub = PrivateKey.fromRandom()
const tx1 = 'aa'.repeat(32)

test('deriveVoucherKey: deterministic, and separated by index / collection / publisher', () => {
  // Same inputs → same key (this is what makes gift links recoverable from the publisher's WIF + chain).
  assert.equal(deriveVoucherKey(pub, tx1, 0).toWif(), deriveVoucherKey(pub, tx1, 0).toWif())
  assert.equal(deriveVoucherKey(pub, tx1, 7).toWif(), deriveVoucherKey(pub, tx1, 7).toWif())
  // Distinct per index, per collection, and per publisher key.
  assert.notEqual(deriveVoucherKey(pub, tx1, 0).toWif(), deriveVoucherKey(pub, tx1, 1).toWif())
  assert.notEqual(deriveVoucherKey(pub, tx1, 0).toWif(), deriveVoucherKey(pub, 'bb'.repeat(32), 0).toWif())
  assert.notEqual(deriveVoucherKey(pub, tx1, 0).toWif(), deriveVoucherKey(PrivateKey.fromRandom(), tx1, 0).toWif())
})
