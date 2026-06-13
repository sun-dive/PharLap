// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
// Covenant v2 Layer 1: the 8-byte price field sits AFTER the owner pubkey, keeping the owner offset (40)
// fixed; it round-trips through build → extract → parse. (Fee logic is unchanged in Layer 1 — the price is
// inert carried data here; the existing 26 covenant/edition Spend tests still pass with it present.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, Utils } from '@bsv/sdk'
import {
  buildEditionLock, editionPrice, editionOwnerPubKey, parseEditionScript, editionPriceField,
  EDITION_OWNER_SCRIPT_OFFSET, EDITION_PRICE_SCRIPT_OFFSET,
} from '../src/covenant.ts'

const creator = PrivateKey.fromRandom()
const holder = PrivateKey.fromRandom()
const ownerPub = holder.toPublicKey().encode(true) as number[]
const tx1Ref = Array.from({ length: 32 }, (_, i) => (i * 3 + 1) & 0xff)
const u64le = (n: number) => { const o: number[] = []; let v = n; for (let i = 0; i < 8; i++) { o.push(v & 0xff); v = Math.floor(v / 256) } return o }
const terms = { creatorPubKeyHash: creator.toPublicKey().toHash() as number[], creatorFeeSats: 5000, holderFeeSats: 1000, tokenSats: 1 }

test('offsets are stable: owner at 40, price at 74', () => {
  assert.equal(EDITION_OWNER_SCRIPT_OFFSET, 40)
  assert.equal(EDITION_PRICE_SCRIPT_OFFSET, 74)
})

test('price field round-trips through build → extract → parse, owner offset unchanged', () => {
  const price = u64le(54321)
  const lock = buildEditionLock({ tx1Ref, ownerPubKey: ownerPub, price, stateData: [], ...terms })
  const bin = lock.toBinary()
  assert.deepEqual(editionOwnerPubKey(bin), ownerPub)          // owner still at 40
  assert.deepEqual(editionPrice(bin), price)                   // price at 74
  const parsed = parseEditionScript(lock)
  assert.ok(parsed)
  assert.equal(parsed!.priceSats, 54321)
  assert.equal(parsed!.ownerPubKeyHex, Utils.toHex(ownerPub))
})

test('a zero / default price still produces a valid 8-byte field', () => {
  const lock = buildEditionLock({ tx1Ref, ownerPubKey: ownerPub, stateData: [], ...terms })
  assert.deepEqual(editionPrice(lock.toBinary()), new Array(8).fill(0))
  assert.equal(parseEditionScript(lock)!.priceSats, 0)
})

test('editionPriceField pads to 8 bytes and rejects oversize', () => {
  assert.deepEqual(editionPriceField([0x39, 0x30]), [0x39, 0x30, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(editionPriceField(), new Array(8).fill(0))
  assert.throws(() => editionPriceField(new Array(9).fill(0)))
})
