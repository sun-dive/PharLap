/**
 * Phase 1 — PushDrop template tests.
 *
 *  1. lock() -> decode() round-trips fields + pubkey across field counts
 *     (exercises the OP_DROP vs OP_2DROP bundling and minimal-push encoding).
 *  2. decode() returns null on malformed / non-PushDrop scripts.
 *  3. Sighash correctness: a tx signed with unlock() actually satisfies lock(),
 *     verified by the @bsv/sdk `Spend` script interpreter (not just round-tripping).
 *
 * Run with:  npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PrivateKey,
  Transaction,
  P2PKH,
  LockingScript,
  Spend,
  Utils,
} from '@bsv/sdk'
import { lock, unlock, decode } from '../src/pushDrop.ts'

const PRIV = PrivateKey.fromRandom()
const PUB_HEX = PRIV.toPublicKey().toString()

function field(s: string): number[] {
  return Utils.toArray(s, 'utf8')
}

function mustDecode(script: LockingScript) {
  const d = decode(script)
  if (d === null) assert.fail('decode returned null')
  return d
}

test('lock -> decode round-trips fields and pubkey (1 field)', () => {
  const fields = [field('hello')]
  const d = decode(lock(PUB_HEX, fields))
  assert.ok(d, 'decode returned null')
  assert.equal(d.pubKeyHex, PUB_HEX)
  assert.deepEqual(d.fields, fields)
})

test('lock -> decode round-trips across field counts (1,2,3,7)', () => {
  for (const n of [1, 2, 3, 7]) {
    const fields = Array.from({ length: n }, (_, i) => field(`field-${i}-payload`))
    const d = decode(lock(PUB_HEX, fields))
    assert.ok(d, `decode null for n=${n}`)
    assert.equal(d.pubKeyHex, PUB_HEX, `pubkey mismatch for n=${n}`)
    assert.deepEqual(d.fields, fields, `fields mismatch for n=${n}`)
  }
})

test('decode handles minimal-push edge fields (OP_1..16, 0x81, single zero byte)', () => {
  // [0] (single zero) encodes to OP_0 and decodes back to [0].
  // [5] encodes to OP_5 and decodes back to [5]. [0x81] -> OP_1NEGATE -> [0x81].
  const fields = [[0], [5], [16], [0x81], field('tail')]
  const d = decode(lock(PUB_HEX, fields))
  assert.ok(d)
  assert.deepEqual(d.fields, fields)
})

test('decode returns null on non-PushDrop scripts', () => {
  // A standard P2PKH script is not a PushDrop output.
  const p2pkh = new P2PKH().lock(PRIV.toAddress())
  assert.equal(decode(p2pkh as LockingScript), null)
  // Empty script.
  assert.equal(decode(new LockingScript([])), null)
  // pubkey push but no OP_CHECKSIG following.
  const bad = new LockingScript([{ op: 33, data: new Array(33).fill(2) }, { op: 0x75 /* OP_DROP-ish wrong */ }])
  assert.equal(decode(bad), null)
})

test('sighash correctness: unlock() satisfies lock() under the Spend interpreter', async () => {
  const SRC_SATS = 1000
  const fields = [field('P'), field('v3'), field('PHAR LAP token'), field('state')]
  const lockingScript = lock(PUB_HEX, fields)

  // Source tx holding the PushDrop output we will spend.
  const source = new Transaction()
  source.addOutput({ lockingScript, satoshis: SRC_SATS })

  // Spending tx: input 0 spends the PushDrop output; one P2PKH output.
  const spend = new Transaction()
  spend.addInput({
    sourceTransaction: source,
    sourceOutputIndex: 0,
    unlockingScriptTemplate: unlock(PRIV, { sourceSatoshis: SRC_SATS, lockingScript }),
    sequence: 0xffffffff,
  })
  spend.addOutput({ lockingScript: new P2PKH().lock(PRIV.toAddress()), satoshis: 500 })
  await spend.sign()

  const unlockingScript = spend.inputs[0].unlockingScript
  assert.ok(unlockingScript, 'unlocking script was not produced by sign()')

  const interpreter = new Spend({
    sourceTXID: source.id('hex'),
    sourceOutputIndex: 0,
    lockingScript,
    sourceSatoshis: SRC_SATS,
    transactionVersion: spend.version,
    otherInputs: [],
    unlockingScript,
    inputSequence: spend.inputs[0].sequence ?? 0xffffffff,
    inputIndex: 0,
    outputs: spend.outputs,
    lockTime: spend.lockTime,
  })

  assert.equal(interpreter.validate(), true, 'Spend interpreter rejected the PushDrop spend')
})

test('sighash correctness: a wrong key fails the Spend interpreter', async () => {
  const SRC_SATS = 1000
  const fields = [field('P'), field('v3')]
  const lockingScript = lock(PUB_HEX, fields) // locked to PUB_HEX

  const source = new Transaction()
  source.addOutput({ lockingScript, satoshis: SRC_SATS })

  const wrongKey = PrivateKey.fromRandom()
  const spend = new Transaction()
  spend.addInput({
    sourceTransaction: source,
    sourceOutputIndex: 0,
    unlockingScriptTemplate: unlock(wrongKey, { sourceSatoshis: SRC_SATS, lockingScript }),
    sequence: 0xffffffff,
  })
  spend.addOutput({ lockingScript: new P2PKH().lock(wrongKey.toAddress()), satoshis: 500 })
  await spend.sign()

  const unlockingScript = spend.inputs[0].unlockingScript
  if (!unlockingScript) assert.fail('unlocking script was not produced by sign()')

  const interpreter = new Spend({
    sourceTXID: source.id('hex'),
    sourceOutputIndex: 0,
    lockingScript,
    sourceSatoshis: SRC_SATS,
    transactionVersion: spend.version,
    otherInputs: [],
    unlockingScript,
    inputSequence: spend.inputs[0].sequence ?? 0xffffffff,
    inputIndex: 0,
    outputs: spend.outputs,
    lockTime: spend.lockTime,
  })

  let ok = false
  try {
    ok = interpreter.validate()
  } catch {
    ok = false // Spend throws on script failure; treat as invalid
  }
  assert.equal(ok, false, 'Spend interpreter accepted a signature from the wrong key')
})
