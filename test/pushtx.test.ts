// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, UnlockingScript, Spend } from '@bsv/sdk'
import {
  pushTxConstants, pushTxCheckOps, pushTxVerifyOps, pushTxPreimage, reverseBytesOps, pushData,
} from '../src/pushtx.ts'

const owner = PrivateKey.fromRandom()

// Build a source output with `lockChunks`, spend it (v2), pushing `unlockChunks`, and validate.
function evaluate(lockChunks: any[], unlockChunks: any[], extraOutputs: number[] = [500]) {
  const lock = new LockingScript(lockChunks)
  const src = new Transaction()
  src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction()
  sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  for (const sats of extraOutputs) {
    sp.addOutput({ lockingScript: new P2PKH().lock(owner.toAddress()), satoshis: sats })
  }
  return { lock, src, sp }
}

function spendValidates(lock: LockingScript, src: Transaction, sp: Transaction, unlockChunks: any[]): boolean {
  const interp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: 1000,
    transactionVersion: 2, otherInputs: [], unlockingScript: new UnlockingScript(unlockChunks),
    inputSequence: 0xffffffff, inputIndex: 0, outputs: sp.outputs, lockTime: sp.lockTime,
  })
  return interp.validate()
}

test('reverseBytesOps reverses a fixed-length item', () => {
  const v = Array.from({ length: 16 }, (_, i) => i + 1)
  const { lock, src, sp } = evaluate(
    [pushData(v), ...reverseBytesOps(16), pushData([...v].reverse()), { op: 0x87 /* OP_EQUAL */ }], [],
  )
  assert.equal(spendValidates(lock, src, sp, []), true)
})

test('optimal OP_PUSH_TX validates with the genuine preimage', () => {
  const c = pushTxConstants()
  const lock = new LockingScript(pushTxCheckOps(c))
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  sp.addOutput({ lockingScript: new P2PKH().lock(owner.toAddress()), satoshis: 500 })
  const preimage = pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1000,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime,
  })
  assert.equal(spendValidates(lock, src, sp, [pushData(preimage)]), true)
})

test('optimal OP_PUSH_TX rejects a tampered preimage (the binding)', () => {
  const c = pushTxConstants()
  const lock = new LockingScript(pushTxCheckOps(c))
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  sp.addOutput({ lockingScript: new P2PKH().lock(owner.toAddress()), satoshis: 500 })
  const preimage = pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1000,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime,
  })
  const tampered = [...preimage]
  tampered[tampered.length - 1] ^= 0xff // flip a byte in the committed outputs region
  assert.throws(() => spendValidates(lock, src, sp, [pushData(tampered)]))
})

test('pushTxVerifyOps leaves the verified preimage on the stack', () => {
  const c = pushTxConstants()
  // After verify, the preimage is on top; assert it is non-empty (truthy) to make the spend succeed.
  const lock = new LockingScript([...pushTxVerifyOps(c), { op: 0x82 /* OP_SIZE */ }, { op: 0x69 /* OP_VERIFY */ }, { op: 0x51 /* OP_1 */ }])
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1000 })
  const sp = new Transaction(); sp.version = 2
  sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  sp.addOutput({ lockingScript: new P2PKH().lock(owner.toAddress()), satoshis: 500 })
  const preimage = pushTxPreimage({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1000,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: sp.outputs,
    inputSequence: 0xffffffff, lockTime: sp.lockTime,
  })
  assert.equal(spendValidates(lock, src, sp, [pushData(preimage)]), true)
})
