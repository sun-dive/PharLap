// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
// Covenant v2 Layer 2: the COMPUTED-fee replicate branch (Addendum G), Spend-validated in isolation before
// wiring into the full edition lock. Mirrors the L4 harness but with an 8-byte price field after the pubkey
// and a percentage split (creator = ⌊P×cBps/10000⌋, reseller = P − creatorCut) instead of fixed fees.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, UnlockingScript, Spend, OP, Hash, Utils, type ScriptChunk } from '@bsv/sdk'
import { pushTxConstants, pushTxPreimage, pushData } from '../src/pushtx.ts'
import {
  replicateBranchV2Ops, buildEditionLockV2, editionReplicateUnlockChunks, EDITION_SCOPE,
  parseEditionScriptV2, parseEditionScript, serializeOutput, p2pkhScript,
} from '../src/covenant.ts'

const buyer = PrivateKey.fromRandom()
const op = (code: number): ScriptChunk => ({ op: code })
const u64le = (n: number) => { const o: number[] = []; let v = n; for (let i = 0; i < 8; i++) { o.push(v & 0xff); v = Math.floor(v / 256) } return o }

const PUBKEY_OFFSET = 1 // test layout: leading `0x21 <holderPub>` push, pubkey data at byte 1
const PRICE = 100_000   // reseller's price, sats
const CBPS = 250        // 2.5%
const CREATOR_CUT = Math.floor((PRICE * CBPS) / 10000) // 2500
const RESELLER_CUT = PRICE - CREATOR_CUT               // 97500

// Lock layout mirrors the real edition's pubkey→price adjacency: <holderPub><price(8)> OP_2DROP <v2 branch>.
function buildV2Lock(F: number, holderPub: number[], creatorHash: number[]) {
  return new LockingScript([
    { op: holderPub.length, data: holderPub },
    { op: 8, data: u64le(PRICE) },
    op(OP.OP_2DROP),
    ...replicateBranchV2Ops({ fieldPubkeyOffset: F, tokenSats: 1, creatorPubKeyHash: creatorHash, cBps: CBPS, c: pushTxConstants() }),
  ])
}
function v2FieldOffset(holderPub: number[], creatorHash: number[]): number {
  const len = buildV2Lock(0, holderPub, creatorHash).toBinary().length
  return (len < 253 ? 1 : len < 65536 ? 3 : 5) + PUBKEY_OFFSET
}

interface Override { creatorFee?: number; resellerFee?: number; out1Pub?: number[]; creatorHash?: number[] }
function runReplicateV2(ov: Override = {}): boolean {
  const holderPub = PrivateKey.fromRandom().toPublicKey().encode(true) as number[]
  const buyerPub = PrivateKey.fromRandom().toPublicKey().encode(true) as number[]
  const creatorHash = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
  const lock = buildV2Lock(v2FieldOffset(holderPub, creatorHash), holderPub, creatorHash)
  const lockBytes = lock.toBinary()

  const out0 = lockBytes                                    // token back to holder (verbatim, price carried)
  const out1 = [...lockBytes]                               // replica to buyer (pubkey swapped, price carried)
  const rep = ov.out1Pub ?? buyerPub
  for (let i = 0; i < 33; i++) out1[PUBKEY_OFFSET + i] = rep[i]
  const creatorScript = p2pkhScript(ov.creatorHash ?? creatorHash)
  const resellerScript = p2pkhScript(Hash.hash160(holderPub))
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()

  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(out0), satoshis: 1 })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(out1), satoshis: 1 })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(creatorScript), satoshis: ov.creatorFee ?? CREATOR_CUT })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(resellerScript), satoshis: ov.resellerFee ?? RESELLER_CUT })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(changeScript), satoshis: 500 })

  const preimage = pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1000,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime,
  })
  const interp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: 1000,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime,
    unlockingScript: new UnlockingScript([
      pushData(serializeOutput(500, changeScript)), pushData(buyerPub), pushData(preimage),
    ]),
  })
  return interp.validate()
}

test('v2 replicate: enforces the computed percentage split (creator ⌊P·c%⌋, reseller remainder)', () => {
  assert.equal(runReplicateV2(), true)
})

test('v2 replicate: rejects short-paying the computed creator cut', () => {
  assert.throws(() => runReplicateV2({ creatorFee: CREATOR_CUT - 1 }))
})

test('v2 replicate: rejects over-paying the reseller (must equal P − creatorCut exactly)', () => {
  assert.throws(() => runReplicateV2({ resellerFee: RESELLER_CUT + 1 }))
})

test('v2 replicate: rejects redirecting the creator cut to another address', () => {
  const attacker = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
  assert.throws(() => runReplicateV2({ creatorHash: attacker }))
})

test('v2 replicate: rejects a replica that does not carry the covenant forward', () => {
  const bogus = PrivateKey.fromRandom().toPublicKey().encode(true) as number[]
  assert.throws(() => runReplicateV2({ out1Pub: bogus }))
})

// --- The v2 tail inside the FULL edition lock (7 data fields incl. a real price field + selector + transfer) ---
const OWNER_OFFSET = 40

function runEditionV2Replicate(ov: { creatorFee?: number } = {}): boolean {
  const holder = PrivateKey.fromRandom()
  const buyerK = PrivateKey.fromRandom()
  const holderPub = holder.toPublicKey().encode(true) as number[]
  const buyerPub = buyerK.toPublicKey().encode(true) as number[]
  const creatorHash = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
  const tx1Ref = Array.from({ length: 32 }, (_, i) => (i * 5 + 1) & 0xff)
  const lock = buildEditionLockV2({
    tx1Ref, ownerPubKey: holderPub, price: u64le(PRICE), stateData: [0xaa, 0xbb, 0xcc],
    creatorPubKeyHash: creatorHash, cBps: CBPS, tokenSats: 1,
  })
  const lockBytes = lock.toBinary()
  const out1 = [...lockBytes]
  for (let i = 0; i < 33; i++) out1[OWNER_OFFSET + i] = buyerPub[i] // replica → buyer (price carried verbatim)
  const changeScript = new P2PKH().lock(buyerK.toAddress()).toBinary()

  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  sp.addOutput({ lockingScript: lock, satoshis: 1 })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(out1), satoshis: 1 })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(creatorHash)), satoshis: ov.creatorFee ?? CREATOR_CUT })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(Hash.hash160(holderPub))), satoshis: RESELLER_CUT })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(changeScript), satoshis: 500 })

  const preimage = pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1000, transactionVersion: 2,
    inputIndex: 0, subscript: lock, outputs: sp.outputs, inputSequence: 0xffffffff, lockTime: sp.lockTime,
    scope: EDITION_SCOPE,
  })
  const unlock = editionReplicateUnlockChunks({
    buyerPubKey: buyerPub, buyerChange: serializeOutput(500, changeScript), preimage,
  })
  const interp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: 1000,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime, unlockingScript: new UnlockingScript(unlock),
  })
  return interp.validate()
}

test('v2 FULL edition lock: permissionless replicate enforces the computed split (selector → replicate branch)', () => {
  assert.equal(runEditionV2Replicate(), true)
})

test('v2 FULL edition lock: rejects short-paying the creator cut', () => {
  assert.throws(() => runEditionV2Replicate({ creatorFee: CREATOR_CUT - 1 }))
})

test('parseEditionScriptV2 recovers owner, price, creator hash + cBps; v1 parser rejects a v2 lock', () => {
  const holderPub = PrivateKey.fromRandom().toPublicKey().encode(true) as number[]
  const creatorHash = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
  const tx1Ref = Array.from({ length: 32 }, (_, i) => (i * 7 + 2) & 0xff)
  const lock = buildEditionLockV2({
    tx1Ref, ownerPubKey: holderPub, price: u64le(PRICE), stateData: [0x01, 0x02],
    creatorPubKeyHash: creatorHash, cBps: CBPS, tokenSats: 1,
  })
  const parsed = parseEditionScriptV2(lock)
  assert.ok(parsed)
  assert.equal(parsed!.ownerPubKeyHex, Utils.toHex(holderPub))
  assert.equal(parsed!.priceSats, PRICE)
  assert.deepEqual(parsed!.terms.creatorPubKeyHash, creatorHash)
  assert.equal(parsed!.terms.cBps, CBPS)
  assert.equal(parsed!.tx1RefHex, Utils.toHex(tx1Ref))
  assert.equal(parseEditionScript(lock), null) // v1 parser rejects v2 (version 0x04)
})
