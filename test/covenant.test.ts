// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, UnlockingScript, Spend } from '@bsv/sdk'
import { pushTxConstants, pushTxPreimage, pushData } from '../src/pushtx.ts'
import { outputPrefixCovenantOps, serializeOutput } from '../src/covenant.ts'

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
