// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, UnlockingScript, Spend } from '@bsv/sdk'
import { pushTxConstants, pushTxPreimage, pushData } from '../src/pushtx.ts'
import { OP } from '@bsv/sdk'
import { outputPrefixCovenantOps, selfReplicateCovenantOps, swapPubkeyOut0CovenantOps, serializeOutput } from '../src/covenant.ts'

const creator = PrivateKey.fromRandom()
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
  const feeScript = new P2PKH().lock(creator.toAddress()).toBinary()
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()
  const enforced = serializeOutput(1000, feeScript)       // out[0] forced: 1000 sats to creator
  const spenderOut = serializeOutput(500, changeScript)   // out[1] spender's own change
  assert.equal(runCovenant({
    enforcedPrefixBytes: enforced,
    actualOutputs: [{ script: feeScript, sats: 1000 }, { script: changeScript, sats: 500 }],
    spenderOutputsBytes: spenderOut,
  }), true)
})

test('L1: rejects when the enforced output amount is altered', () => {
  const feeScript = new P2PKH().lock(creator.toAddress()).toBinary()
  const changeScript = new P2PKH().lock(buyer.toAddress()).toBinary()
  const enforced = serializeOutput(1000, feeScript)       // covenant demands 1000 to creator
  const spenderOut = serializeOutput(500, changeScript)
  assert.throws(() => runCovenant({
    enforcedPrefixBytes: enforced,
    actualOutputs: [{ script: feeScript, sats: 999 }, { script: changeScript, sats: 500 }], // paid only 999
    spenderOutputsBytes: spenderOut,
  }))
})

test('L1: rejects when the enforced output script is altered', () => {
  const feeScript = new P2PKH().lock(creator.toAddress()).toBinary()
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
