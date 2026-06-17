// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Transaction, P2PKH, PrivateKey, LockingScript, UnlockingScript, Spend, Hash, TransactionSignature,
} from '@bsv/sdk'
import { pushTxPreimage } from '../src/pushtx.ts'
import {
  buildEditionLock, editionReplicateUnlockChunks, editionTransferUnlockChunks, editionBurnUnlockChunks,
  EDITION_SCOPE, serializeOutput, p2pkhScript, parseEditionScript,
} from '../src/covenant.ts'

const OWNER_OFFSET = 40 // P(2)+ver(2)+record(2)+tx1Ref(33)+pushOpcode(1) — owner pubkey data offset in the script
const PUBLISHER_FEE = 5000
const HOLDER_FEE = 1000
const TOKEN_SATS = 1

function pk() { return PrivateKey.fromRandom() }
function pub(k: PrivateKey) { return k.toPublicKey().encode(true) as number[] }

function makeEdition(tokenSats = TOKEN_SATS) {
  const holder = pk()
  const publisherHash = Hash.hash160(pub(pk()))
  const tx1Ref = Array.from({ length: 32 }, (_, i) => (i * 5 + 1) & 0xff)
  const stateData = [0xaa, 0xbb, 0xcc]
  const lock = buildEditionLock({
    tx1Ref, ownerPubKey: pub(holder), stateData,
    publisherPubKeyHash: publisherHash, publisherFeeSats: PUBLISHER_FEE, holderFeeSats: HOLDER_FEE, tokenSats,
  })
  return { holder, publisherHash, lock, lockBytes: lock.toBinary() }
}

// Run a replicate Spend at a given bond. `replicaSats` defaults to the bond; pass a different value to
// prove the covenant rejects a replica that doesn't carry the full bond.
function runReplicate(opts: { bond?: number; replicaSats?: number } = {}): boolean {
  const bond = opts.bond ?? TOKEN_SATS
  const replicaSats = opts.replicaSats ?? bond
  const { holder, publisherHash, lock, lockBytes } = makeEdition(bond)
  const buyer = pk()
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()
  const outputs = [
    { script: lockBytes, sats: bond },                                       // [0] token → holder (bond)
    { script: withOwner(lockBytes, pub(buyer)), sats: replicaSats },         // [1] replica → buyer
    { script: p2pkhScript(publisherHash), sats: PUBLISHER_FEE },             // [2] publisher fee
    { script: p2pkhScript(Hash.hash160(pub(holder))), sats: HOLDER_FEE },    // [3] holder fee
    { script: changeScript, sats: 500 },                                     // [4] buyer change
  ]
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: bond })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  for (const o of outputs) sp.addOutput({ lockingScript: LockingScript.fromBinary(o.script), satoshis: o.sats })
  const preimage = pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: bond, transactionVersion: 2,
    inputIndex: 0, subscript: lock, outputs: sp.outputs, inputSequence: 0xffffffff, lockTime: sp.lockTime, scope: EDITION_SCOPE,
  })
  const unlock = editionReplicateUnlockChunks({ buyerPubKey: pub(buyer), buyerChange: serializeOutput(500, changeScript), preimage })
  const interp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: bond,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime, unlockingScript: new UnlockingScript(unlock),
  })
  return interp.validate()
}

// Swap the 33-byte owner pubkey in a copy of the edition script.
function withOwner(lockBytes: number[], newPub: number[]): number[] {
  const out = [...lockBytes]
  for (let i = 0; i < 33; i++) out[OWNER_OFFSET + i] = newPub[i]
  return out
}

test('edition: owner pubkey sits at the expected script offset', () => {
  const { lockBytes, holder } = makeEdition()
  assert.deepEqual(lockBytes.slice(OWNER_OFFSET, OWNER_OFFSET + 33), pub(holder))
})

test('edition: parseEditionScript recovers fields + terms from the covenant', () => {
  const { lock, holder, publisherHash } = makeEdition()
  const parsed = parseEditionScript(lock)
  assert.ok(parsed)
  assert.equal(parsed!.ownerPubKeyHex, Buffer.from(pub(holder)).toString('hex'))
  assert.deepEqual(parsed!.terms.publisherPubKeyHash, publisherHash)
  assert.equal(parsed!.terms.publisherFeeSats, PUBLISHER_FEE)
  assert.equal(parsed!.terms.holderFeeSats, HOLDER_FEE)
  // A plain P2PKH script is not an edition.
  assert.equal(parseEditionScript(new P2PKH().lock(holder.toAddress())), null)
})

test('edition REPLICATE: buyer mints a replica, returns the token, pays both fees', () => {
  const { holder, publisherHash, lock, lockBytes } = makeEdition()
  const buyer = pk()
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()
  const outputs = [
    { script: lockBytes, sats: TOKEN_SATS },                                  // [0] token → holder (verbatim)
    { script: withOwner(lockBytes, pub(buyer)), sats: TOKEN_SATS },           // [1] replica → buyer
    { script: p2pkhScript(publisherHash), sats: PUBLISHER_FEE },                  // [2] publisher fee
    { script: p2pkhScript(Hash.hash160(pub(holder))), sats: HOLDER_FEE },     // [3] holder fee
    { script: changeScript, sats: 500 },                                      // [4] buyer change
  ]
  // Build the tx first (need its outputs for the preimage), then attach the unlock.
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  for (const o of outputs) sp.addOutput({ lockingScript: LockingScript.fromBinary(o.script), satoshis: o.sats })
  const preimage = pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1000, transactionVersion: 2,
    inputIndex: 0, subscript: lock, outputs: sp.outputs, inputSequence: 0xffffffff, lockTime: sp.lockTime,
    scope: EDITION_SCOPE,
  })
  const unlock = editionReplicateUnlockChunks({
    buyerPubKey: pub(buyer), buyerChange: serializeOutput(500, changeScript), preimage,
  })
  const interp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: 1000,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime, unlockingScript: new UnlockingScript(unlock),
  })
  assert.equal(interp.validate(), true)
})

test('edition BONDED (2100): replicate preserves the full bond on both token outputs', () => {
  assert.equal(runReplicate({ bond: 2100 }), true)
})

test('edition BONDED: replicate rejects a replica funded below the bond (the bond cannot be dodged)', () => {
  assert.throws(() => runReplicate({ bond: 2100, replicaSats: 1 }))
})

// Helper to run an owner-signed transfer with optional tampering.
function runTransfer(opts: { signer?: PrivateKey; out0Pub?: number[]; bond?: number; out0Sats?: number } = {}): boolean {
  const bond = opts.bond ?? TOKEN_SATS
  const { holder, lock, lockBytes } = makeEdition(bond)
  const newOwner = pk()
  const signer = opts.signer ?? holder
  const changeScript = new P2PKH().lock(newOwner.toAddress()).toBinary()
  const out0Script = withOwner(lockBytes, opts.out0Pub ?? pub(newOwner))
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: bond })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(out0Script), satoshis: opts.out0Sats ?? bond })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(changeScript), satoshis: 500 })
  const fmt = (scope: number) => pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: bond, transactionVersion: 2,
    inputIndex: 0, subscript: lock, outputs: sp.outputs, inputSequence: 0xffffffff, lockTime: sp.lockTime, scope,
  })
  const introspectionPreimage = fmt(EDITION_SCOPE)            // for the covenant's OP_PUSH_TX
  const ownerScope = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  const raw = signer.sign(Hash.sha256(fmt(ownerScope)))       // owner authorization signature
  const ownerSig = new TransactionSignature(raw.r, raw.s, ownerScope).toChecksigFormat()
  const unlock = editionTransferUnlockChunks({
    newOwnerPubKey: pub(newOwner), ownerSig, change: serializeOutput(500, changeScript), preimage: introspectionPreimage,
  })
  const interp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: bond,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime, unlockingScript: new UnlockingScript(unlock),
  })
  return interp.validate()
}

test('edition TRANSFER: owner moves the token, re-creating the covenant for the new owner', () => {
  assert.equal(runTransfer(), true)
})

test('edition TRANSFER: rejects a forged owner signature', () => {
  assert.throws(() => runTransfer({ signer: PrivateKey.fromRandom() }))
})

test('edition TRANSFER: rejects an output that drops the covenant (wrong new-owner script)', () => {
  // out0 keeps the holder's pubkey instead of the new owner the unlock declares → hashOutputs mismatch.
  const k = PrivateKey.fromRandom()
  assert.throws(() => runTransfer({ out0Pub: pub(k) }))
})

test('edition BONDED (2100): transfer preserves the bond, and rejects out0 funded below it', () => {
  assert.equal(runTransfer({ bond: 2100 }), true)
  assert.throws(() => runTransfer({ bond: 2100, out0Sats: 1 })) // covenant enforces VALUE1 = the bond
})

// Helper to run an owner-signed BURN (reclaim the bond, destroy the token). The owner sweeps the bonded
// sats to any output(s) of their choosing; the covenant enforces NO outputs, only the owner's signature.
const BOND = 2100
function runBurn(opts: { signer?: PrivateKey } = {}): boolean {
  const { holder, lock } = makeEdition()
  const signer = opts.signer ?? holder
  const reclaimScript = new P2PKH().lock(holder.toAddress()).toBinary()
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: BOND })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(reclaimScript), satoshis: BOND - 100 }) // bond minus fee
  const fmt = (scope: number) => pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: BOND, transactionVersion: 2,
    inputIndex: 0, subscript: lock, outputs: sp.outputs, inputSequence: 0xffffffff, lockTime: sp.lockTime, scope,
  })
  const introspectionPreimage = fmt(EDITION_SCOPE)
  const ownerScope = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  const raw = signer.sign(Hash.sha256(fmt(ownerScope)))
  const ownerSig = new TransactionSignature(raw.r, raw.s, ownerScope).toChecksigFormat()
  const unlock = editionBurnUnlockChunks({ ownerSig, preimage: introspectionPreimage })
  const interp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: BOND,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime, unlockingScript: new UnlockingScript(unlock),
  })
  return interp.validate()
}

test('edition BURN: owner reclaims the bond and destroys the token (no covenant output re-created)', () => {
  assert.equal(runBurn(), true)
})

test('edition BURN: rejects a non-owner signature (only the current owner can burn)', () => {
  assert.throws(() => runBurn({ signer: PrivateKey.fromRandom() }))
})
