// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Transaction, P2PKH, PrivateKey, LockingScript, UnlockingScript, Spend, Hash, TransactionSignature,
} from '@bsv/sdk'
import { pushTxPreimage } from '../src/pushtx.ts'
import {
  buildEditionLock, editionReplicateUnlockChunks, editionTransferUnlockChunks,
  EDITION_SCOPE, serializeOutput, p2pkhScript,
} from '../src/covenant.ts'

const OWNER_OFFSET = 40 // P(2)+ver(2)+record(2)+tx1Ref(33)+pushOpcode(1) — owner pubkey data offset in the script
const CREATOR_FEE = 5000
const HOLDER_FEE = 1000
const TOKEN_SATS = 1

function pk() { return PrivateKey.fromRandom() }
function pub(k: PrivateKey) { return k.toPublicKey().encode(true) as number[] }

function makeEdition() {
  const holder = pk()
  const creatorHash = Hash.hash160(pub(pk()))
  const tx1Ref = Array.from({ length: 32 }, (_, i) => (i * 5 + 1) & 0xff)
  const stateData = [0xaa, 0xbb, 0xcc]
  const lock = buildEditionLock({
    tx1Ref, ownerPubKey: pub(holder), stateData,
    creatorPubKeyHash: creatorHash, creatorFeeSats: CREATOR_FEE, holderFeeSats: HOLDER_FEE, tokenSats: TOKEN_SATS,
  })
  return { holder, creatorHash, lock, lockBytes: lock.toBinary() }
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

test('edition REPLICATE: buyer mints a replica, returns the token, pays both fees', () => {
  const { holder, creatorHash, lock, lockBytes } = makeEdition()
  const buyer = pk()
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()
  const outputs = [
    { script: lockBytes, sats: TOKEN_SATS },                                  // [0] token → holder (verbatim)
    { script: withOwner(lockBytes, pub(buyer)), sats: TOKEN_SATS },           // [1] replica → buyer
    { script: p2pkhScript(creatorHash), sats: CREATOR_FEE },                  // [2] creator fee
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

// Helper to run an owner-signed transfer with optional tampering.
function runTransfer(opts: { signer?: PrivateKey; out0Pub?: number[] } = {}): boolean {
  const { holder, lock, lockBytes } = makeEdition()
  const newOwner = pk()
  const signer = opts.signer ?? holder
  const changeScript = new P2PKH().lock(newOwner.toAddress()).toBinary()
  const out0Script = withOwner(lockBytes, opts.out0Pub ?? pub(newOwner))
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(out0Script), satoshis: TOKEN_SATS })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(changeScript), satoshis: 500 })
  const fmt = (scope: number) => pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1000, transactionVersion: 2,
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
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: 1000,
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
