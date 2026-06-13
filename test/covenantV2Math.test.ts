// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
// De-risk Covenant v2 (Addendum G): the in-script arithmetic the percentage-split + range-check rely on
// EXECUTES in the @bsv/sdk Spend interpreter (these opcodes were disabled in legacy Bitcoin, re-enabled in
// BSV). Confirms before touching covenant.ts that ⌊P×c%⌋, the reseller remainder, an 8-byte value encoding,
// and the [min,max] range check all work.
//
// KEY FINDING for the covenant build: the interpreter enforces minimal encoding. Small-integer operands —
// notably the SIZE operand of OP_NUM2BIN — must be pushed with the minimal opcode (OP_1..OP_16), e.g.
// op(OP.OP_8), NOT pushData([8]) (= 0x01 0x08, rejected as non-minimal). A computed result that evaluates
// to false makes validate() throw, which models a rejected spend.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OP, LockingScript, UnlockingScript, Spend, Transaction, P2PKH, PrivateKey, type ScriptChunk } from '@bsv/sdk'
import { pushData } from '../src/pushtx.ts'
import { u64le, numLE } from '../src/covenant.ts'

const op = (code: number): ScriptChunk => ({ op: code })

/** True iff (unlock, lock) validates with a truthy result; false on a falsy result or any script error. */
function valid(lockChunks: ScriptChunk[], unlockChunks: ScriptChunk[]): boolean {
  try {
    const lock = new LockingScript(lockChunks)
    const unlock = new UnlockingScript(unlockChunks)
    const sourceTx = new Transaction()
    sourceTx.addOutput({ lockingScript: lock, satoshis: 1000 })
    const tx = new Transaction()
    tx.addInput({ sourceTransaction: sourceTx, sourceOutputIndex: 0, unlockingScript: unlock })
    tx.addOutput({ lockingScript: new P2PKH().lock(PrivateKey.fromRandom().toAddress()), satoshis: 500 })
    const interp = new Spend({
      sourceTXID: sourceTx.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: 1000,
      transactionVersion: tx.version, otherInputs: [], unlockingScript: unlock, inputSequence: 0xffffffff,
      inputIndex: 0, outputs: tx.outputs, lockTime: 0,
    })
    return interp.validate()
  } catch { return false }
}

/** Compute ⌊P × pBps / 10000⌋ as the covenant will, leaving the 8-byte LE value on the stack. */
function publisherCutOps(pBps: number): ScriptChunk[] {
  return [op(OP.OP_BIN2NUM), pushData(numLE(pBps)), op(OP.OP_MUL), pushData(numLE(10000)), op(OP.OP_DIV)]
}

test('percentage fee math: ⌊P × pBps / 10000⌋ → 8-byte LE value', () => {
  // P=12345 sat, c=2.5% (pBps=250) → ⌊308.625⌋ = 308.
  const ok = valid(
    [...publisherCutOps(250), op(OP.OP_8), op(OP.OP_NUM2BIN), pushData(u64le(308)), op(OP.OP_EQUAL)],
    [pushData(u64le(12345))],
  )
  assert.equal(ok, true)
})

test('reseller remainder: P − ⌊P × pBps / 10000⌋ → 8-byte LE value', () => {
  // P=12345, publisherCut=308 → reseller=12037.
  const ok = valid(
    [op(OP.OP_BIN2NUM), op(OP.OP_DUP), pushData(numLE(250)), op(OP.OP_MUL), pushData(numLE(10000)), op(OP.OP_DIV),
      op(OP.OP_SUB), op(OP.OP_8), op(OP.OP_NUM2BIN), pushData(u64le(12037)), op(OP.OP_EQUAL)],
    [pushData(u64le(12345))],
  )
  assert.equal(ok, true)
})

test('range check: OP_WITHIN enforces min ≤ P ≤ max (max+1 makes it inclusive)', () => {
  const min = 1000, max = 1_000_000
  const within = (P: number) => valid(
    [pushData(numLE(min)), pushData(numLE(max + 1)), op(OP.OP_WITHIN)],
    [pushData(numLE(P))],
  )
  assert.equal(within(5000), true)     // in band
  assert.equal(within(min), true)      // lower bound inclusive
  assert.equal(within(max), true)      // upper bound inclusive
  assert.equal(within(min - 1), false) // below → spend rejected
  assert.equal(within(max + 1), false) // above → spend rejected
})

test('a large in-band price stays exact (BSV big-int math, no overflow)', () => {
  // 1000 BSV = 100,000,000,000 sat at 5% → 5,000,000,000 (a 5-byte script number).
  const P = 100_000_000_000, expected = 5_000_000_000
  const ok = valid(
    [...publisherCutOps(500), op(OP.OP_8), op(OP.OP_NUM2BIN), pushData(u64le(expected)), op(OP.OP_EQUAL)],
    [pushData(u64le(P))],
  )
  assert.equal(ok, true)
})
