// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
// The sales-page tip resolver derives a holder's edition script deterministically from the collection's
// covenant TEMPLATE (TX1) + holder pubkey, then finds its UTXO by script hash. This proves the
// reconstruction is byte-for-byte identical to a real edition — the guarantee the script-hash lookup relies on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, Utils, LockingScript } from '@bsv/sdk'
import { buildEditionLock, buildHolderEditionScript, parseEditionScript } from '../src/covenant.ts'
import { wocScriptHash } from '../src/editionBuilder.ts'

const creator = PrivateKey.fromRandom()
const holder = PrivateKey.fromRandom()
const creatorPubKeyHash = creator.toPublicKey().toHash() as number[]
const tx1Ref = Array.from({ length: 32 }, (_, i) => (i * 7 + 11) & 0xff)
const ownerPub = holder.toPublicKey().encode(true) as number[]
const stateData = Utils.toArray('0118416e2065426f6f6b00', 'hex') // a non-empty immutable storefront-ish blob

const terms = { creatorPubKeyHash, creatorFeeSats: 5000, holderFeeSats: 1000, tokenSats: 1 }

test('buildHolderEditionScript reproduces a real edition script byte-for-byte', () => {
  // The TX1 covenant TEMPLATE: identity zeroed, everything else (stateData, fees, tokenSats) real.
  const template = buildEditionLock({
    tx1Ref: new Array(32).fill(0), ownerPubKey: new Array(33).fill(0), stateData, ...terms,
  })
  // A real edition minted with the actual identity.
  const real = buildEditionLock({ tx1Ref, ownerPubKey: ownerPub, stateData, ...terms })

  const spliced = buildHolderEditionScript(template.toBinary(), tx1Ref, ownerPub)
  assert.deepEqual(spliced, real.toBinary())
  // => identical script hash => WoC script-hash lookup finds this holder's UTXO.
  assert.equal(wocScriptHash(spliced), wocScriptHash(real.toBinary()))
})

test('the reconstructed script parses back to the right collection, owner, and terms', () => {
  const template = buildEditionLock({
    tx1Ref: new Array(32).fill(0), ownerPubKey: new Array(33).fill(0), stateData, ...terms,
  })
  const spliced = buildHolderEditionScript(template.toBinary(), tx1Ref, ownerPub)
  const ed = parseEditionScript(LockingScript.fromHex(Utils.toHex(spliced)))
  assert.ok(ed)
  assert.equal(ed!.tx1RefHex, Utils.toHex(tx1Ref))
  assert.equal(ed!.ownerPubKeyHex, Utils.toHex(ownerPub))
  assert.equal(ed!.terms.creatorFeeSats, 5000)
  assert.equal(ed!.terms.holderFeeSats, 1000)
})

test('buildHolderEditionScript rejects malformed identity fields', () => {
  const template = buildEditionLock({
    tx1Ref: new Array(32).fill(0), ownerPubKey: new Array(33).fill(0), stateData, ...terms,
  }).toBinary()
  assert.throws(() => buildHolderEditionScript(template, new Array(31).fill(0), ownerPub))
  assert.throws(() => buildHolderEditionScript(template, tx1Ref, new Array(32).fill(0)))
})
