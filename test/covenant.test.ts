// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, UnlockingScript, Spend } from '@bsv/sdk'
import { pushTxConstants, pushTxPreimage, pushData } from '../src/pushtx.ts'
import { OP, Hash } from '@bsv/sdk'
import {
  outputPrefixCovenantOps, selfReplicateCovenantOps, swapPubkeyOut0CovenantOps,
  replicateBranchOps, serializeOutput, p2pkhScript,
} from '../src/covenant.ts'

const publisher = PrivateKey.fromRandom()
const buyer = PrivateKey.fromRandom()

// Build a spend of an L1-covenant output with the given actual outputs, and the spender's supplied
// trailing-output bytes; return whether Spend validates.
function runCovenant(opts: {
  enforcedPrefixBytes: number[]
  actualOutputs: Array<{ script: number[]; sats: number }>
  spenderOutputsBytes: number[]
}): boolean {
  const c = pushTxConstants()
  const lock = new LockingScript(outputPrefixCovenantOps(opts.enforcedPrefixBytes, c))
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  for (const o of opts.actualOutputs) {
    sp.addOutput({ lockingScript: LockingScript.fromBinary(o.script), satoshis: o.sats })
  }
  const preimage = pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1000,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime,
  })
  const interp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: 1000,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime,
    unlockingScript: new UnlockingScript([pushData(opts.spenderOutputsBytes), pushData(preimage)]),
  })
  return interp.validate()
}

test('L1: enforces a fixed output prefix; spender appends free change', () => {
  const feeScript = new P2PKH().lock(publisher.toAddress()).toBinary()
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()
  const enforced = serializeOutput(1000, feeScript)       // out[0] forced: 1000 sats to publisher
  const spenderOut = serializeOutput(500, changeScript)   // out[1] spender's own change
  assert.equal(runCovenant({
    enforcedPrefixBytes: enforced,
    actualOutputs: [{ script: feeScript, sats: 1000 }, { script: changeScript, sats: 500 }],
    spenderOutputsBytes: spenderOut,
  }), true)
})

test('L1: rejects when the enforced output amount is altered', () => {
  const feeScript = new P2PKH().lock(publisher.toAddress()).toBinary()
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()
  const enforced = serializeOutput(1000, feeScript)       // covenant demands 1000 to publisher
  const spenderOut = serializeOutput(500, changeScript)
  assert.throws(() => runCovenant({
    enforcedPrefixBytes: enforced,
    actualOutputs: [{ script: feeScript, sats: 999 }, { script: changeScript, sats: 500 }], // paid only 999
    spenderOutputsBytes: spenderOut,
  }))
})

test('L1: rejects when the enforced output script is altered', () => {
  const feeScript = new P2PKH().lock(publisher.toAddress()).toBinary()
  const attackerScript = new P2PKH().lock(buyer.toAddress()).toBinary() // buyer tries to redirect the fee
  const enforced = serializeOutput(1000, feeScript)
  const spenderOut = serializeOutput(500, attackerScript)
  assert.throws(() => runCovenant({
    enforcedPrefixBytes: enforced,
    actualOutputs: [{ script: attackerScript, sats: 1000 }, { script: attackerScript, sats: 500 }],
    spenderOutputsBytes: spenderOut,
  }))
})

// --- L2: self-replicating ("quine") covenant ---
function runSelfReplicate(out0Script: number[], out0Sats: number): boolean {
  const c = pushTxConstants()
  const lock = new LockingScript(selfReplicateCovenantOps(1, c))
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()
  sp.addOutput({ lockingScript: LockingScript.fromBinary(out0Script), satoshis: out0Sats })
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
    unlockingScript: new UnlockingScript([pushData(serializeOutput(500, changeScript)), pushData(preimage)]),
  })
  return interp.validate()
}

test('L2: token can be spent into an exact copy of its own covenant', () => {
  const lockBytes = new LockingScript(selfReplicateCovenantOps(1, pushTxConstants())).toBinary()
  assert.equal(runSelfReplicate(lockBytes, 1), true)
})

test('L2: rejects spending into a different (non-covenant) script', () => {
  const plain = new P2PKH().lock(buyer.toAddress()).toBinary()
  assert.throws(() => runSelfReplicate(plain, 1))
})

test('L2: rejects re-creating the covenant with the wrong value', () => {
  const lockBytes = new LockingScript(selfReplicateCovenantOps(1, pushTxConstants())).toBinary()
  assert.throws(() => runSelfReplicate(lockBytes, 2)) // covenant fixes 1 sat
})

// --- L3: pubkey-substitution (replica / enforced transfer to a new owner) ---
const PUBKEY_OFFSET_IN_SCRIPT = 1 // test layout: leading `0x21 <pubkey>` push, so data starts at byte 1

// Build a token-like lock carrying a 33-byte owner pubkey at byte offset 1, plus the L3 body.
function buildL3Lock(F: number, oldPub: number[]) {
  return new LockingScript([
    { op: oldPub.length, data: oldPub }, { op: OP.OP_DROP },
    ...swapPubkeyOut0CovenantOps(F, 1, pushTxConstants()),
  ])
}
function l3FieldOffset(oldPub: number[]): number {
  const probeLen = buildL3Lock(0, oldPub).toBinary().length
  const varIntSize = probeLen < 253 ? 1 : probeLen < 65536 ? 3 : 5
  return varIntSize + PUBKEY_OFFSET_IN_SCRIPT
}

function runSwap(out0Override?: number[]): boolean {
  const oldPub = PrivateKey.fromRandom().toPublicKey().encode(true) as number[]
  const newPub = PrivateKey.fromRandom().toPublicKey().encode(true) as number[]
  const lock = buildL3Lock(l3FieldOffset(oldPub), oldPub)
  const lockBytes = lock.toBinary()
  const swapped = [...lockBytes]
  for (let i = 0; i < 33; i++) swapped[PUBKEY_OFFSET_IN_SCRIPT + i] = newPub[i]
  const out0Script = out0Override ?? swapped
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()
  sp.addOutput({ lockingScript: LockingScript.fromBinary(out0Script), satoshis: 1 })
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
      pushData(serializeOutput(500, changeScript)), pushData(newPub), pushData(preimage),
    ]),
  })
  return interp.validate()
}

test('L3: re-creates the covenant with the unlock-supplied owner pubkey', () => {
  assert.equal(runSwap(), true)
})

test('L3: rejects an output that keeps the old pubkey (no real swap)', () => {
  // out0 = the original script (old pubkey) while the unlock claims a new one → mismatch.
  const oldPub = PrivateKey.fromRandom().toPublicKey().encode(true) as number[]
  const lock = buildL3Lock(l3FieldOffset(oldPub), oldPub)
  assert.throws(() => runSwap(lock.toBinary()))
})

// --- L4: full Addendum-A replicate branch (token + replica + publisher fee + holder fee + change) ---
const L4_PUBKEY_OFFSET = 1 // test layout: leading `0x21 <holderPub>` push, data at byte 1
const PUBLISHER_FEE = 5000
const HOLDER_FEE = 1000

function buildL4Lock(F: number, holderPub: number[], publisherHash: number[]) {
  return new LockingScript([
    { op: holderPub.length, data: holderPub }, { op: OP.OP_DROP },
    ...replicateBranchOps({
      fieldPubkeyOffset: F, tokenSats: 1, publisherPubKeyHash: publisherHash,
      publisherFeeSats: PUBLISHER_FEE, holderFeeSats: HOLDER_FEE, c: pushTxConstants(),
    }),
  ])
}
function l4FieldOffset(holderPub: number[], publisherHash: number[]): number {
  const len = buildL4Lock(0, holderPub, publisherHash).toBinary().length
  return (len < 253 ? 1 : len < 65536 ? 3 : 5) + L4_PUBKEY_OFFSET
}

interface L4Override { publisherFee?: number; holderFee?: number; out1Pub?: number[]; publisherHash?: number[] }
function runReplicate(ov: L4Override = {}): boolean {
  const holderPub = PrivateKey.fromRandom().toPublicKey().encode(true) as number[]
  const buyerPub = PrivateKey.fromRandom().toPublicKey().encode(true) as number[]
  const publisherHash = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
  const lock = buildL4Lock(l4FieldOffset(holderPub, publisherHash), holderPub, publisherHash)
  const lockBytes = lock.toBinary()

  // Build the four enforced outputs (+ change) the covenant expects, applying any attacker overrides.
  const out0 = lockBytes                                   // token back to holder (verbatim)
  const out1 = [...lockBytes]                              // replica to buyer (pubkey swapped)
  const rep = ov.out1Pub ?? buyerPub
  for (let i = 0; i < 33; i++) out1[L4_PUBKEY_OFFSET + i] = rep[i]
  const publisherScript = p2pkhScript(ov.publisherHash ?? publisherHash)
  const holderScript = p2pkhScript(Hash.hash160(holderPub))
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()

  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(out0), satoshis: 1 })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(out1), satoshis: 1 })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(publisherScript), satoshis: ov.publisherFee ?? PUBLISHER_FEE })
  sp.addOutput({ lockingScript: LockingScript.fromBinary(holderScript), satoshis: ov.holderFee ?? HOLDER_FEE })
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

test('L4: valid replicate — token, replica, publisher fee, holder fee, change', () => {
  assert.equal(runReplicate(), true)
})

test('L4: rejects short-paying the publisher fee', () => {
  assert.throws(() => runReplicate({ publisherFee: PUBLISHER_FEE - 1 }))
})

test('L4: rejects short-paying the holder fee', () => {
  assert.throws(() => runReplicate({ holderFee: HOLDER_FEE - 1 }))
})

test('L4: rejects redirecting the publisher fee to another address', () => {
  const attacker = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
  assert.throws(() => runReplicate({ publisherHash: attacker }))
})

test('L4: rejects a replica that does not carry the covenant forward', () => {
  // Replica output uses a plain pubkey region that does not match the buyer key in the unlock.
  const bogus = PrivateKey.fromRandom().toPublicKey().encode(true) as number[]
  assert.throws(() => runReplicate({ out1Pub: bogus }))
})
