// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
//
// CO-SIGNING — completing a transaction somebody else assembled.
//
// Nothing in src/cosign.ts knows what a battery, an edition or a covenant is, and these tests are
// arranged to keep it that way: the general cases come first and use nothing but ordinary P2PKH, and
// the covenant case at the end is included to show it is not special — the same code path treats an
// input it cannot understand exactly as it treats a stranger's: leave it alone, sign your own.
//
// The property everything rests on is that signing one input does not disturb another. A sighash
// preimage commits to the outpoints, the values, the outputs and the scriptCode of the input being
// signed — never to another input's unlocking script.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, UnlockingScript, Spend, OP } from '@bsv/sdk'
import { analyseCosign, cosignTransaction, type CosignSource } from '../src/cosign.ts'

/** A blank to be filled in later. An input with NO unlocking script cannot even be serialized — the
 *  hand-over format is an EMPTY script, which is what battery.html emits for the same reason. */
const BLANK = (): UnlockingScript => new UnlockingScript([])

/** A coin belonging to `key`, and the source record a co-signer needs to value it. */
function coin(key: PrivateKey, sats: number): { tx: Transaction; source: CosignSource } {
  const tx = new Transaction()
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: sats })
  return { tx, source: { txId: tx.id('hex'), sourceTxHex: tx.toHex() } }
}

function validateInput(tx: Transaction, i: number, lock: LockingScript, sats: number): boolean {
  const inp = tx.inputs[i]
  const txidOf = (x: typeof inp): string => x.sourceTXID ?? x.sourceTransaction!.id('hex')
  return new Spend({
    sourceTXID: txidOf(inp), sourceOutputIndex: inp.sourceOutputIndex, lockingScript: lock,
    sourceSatoshis: sats, transactionVersion: tx.version,
    otherInputs: tx.inputs.filter((_, k) => k !== i).map(x => ({
      sourceTXID: txidOf(x), sourceOutputIndex: x.sourceOutputIndex, sequence: x.sequence ?? 0xffffffff,
    })),
    unlockingScript: inp.unlockingScript!, inputSequence: inp.sequence ?? 0xffffffff,
    inputIndex: i, outputs: tx.outputs, lockTime: tx.lockTime,
  }).validate()
}

// ── THE GENERAL CASE: two strangers splitting a bill, no covenant anywhere ────────────────────────
test('co-sign: signs only this wallet’s input and leaves a partner’s signature intact', async () => {
  const alice = PrivateKey.fromRandom(), bob = PrivateKey.fromRandom()
  const payee = PrivateKey.fromRandom().toAddress()
  const a = coin(alice, 50_000), b = coin(bob, 50_000)

  // Alice assembles: both coins in, one payment out, change back to each of them.
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: a.tx, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(alice) })
  tx.addInput({ sourceTransaction: b.tx, sourceOutputIndex: 0, unlockingScript: BLANK() })
  tx.addOutput({ lockingScript: new P2PKH().lock(payee), satoshis: 80_000 })
  tx.addOutput({ lockingScript: new P2PKH().lock(alice.toAddress()), satoshis: 9_800 })
  tx.addOutput({ lockingScript: new P2PKH().lock(bob.toAddress()), satoshis: 9_800 })
  await tx.sign()                                   // signs Alice's input only — Bob's has no template

  const sources = [a.source, b.source]
  const raw = tx.toHex()

  // Bob's wallet reads it cold.
  const seen = analyseCosign(raw, sources, bob.toAddress())
  assert.deepEqual(seen.blockers, [], 'nothing should block a well-formed co-sign')
  assert.deepEqual(seen.toSign, [1], 'Bob signs input #2 and nothing else')
  assert.equal(seen.youSpend, 50_000)
  assert.equal(seen.youReceive, 9_800)
  assert.equal(seen.youPay, 40_200)
  assert.equal(seen.fee, 400)
  // Every field the UI prints must actually be populated — an `undefined` here reaches the signer as
  // "undefined bytes signed", which is exactly the sort of thing that erodes trust in the figures.
  assert.equal(typeof seen.signedSize, 'number')
  assert.ok(seen.signedSize > seen.size, 'the signed size accounts for the blank being filled in')

  const signed = await cosignTransaction(raw, sources, bob)
  const done = Transaction.fromHex(signed.rawTx)
  assert.ok(validateInput(done, 1, new P2PKH().lock(bob.toAddress()), 50_000), 'Bob’s input validates')
  assert.ok(validateInput(done, 0, new P2PKH().lock(alice.toAddress()), 50_000),
    'Alice’s signature SURVIVES Bob signing beside it')
})

// REGRESSION. `Transaction.fromHex` fills `rawBytesCache` with the bytes it parsed, and `toHex()`
// returns that cache when it is populated — so assigning `inputs[i].unlockingScript` on a parsed
// transaction is discarded at serialization unless the cache is invalidated. The bug returns a txid
// and reports success while handing back the UNSIGNED transaction, which is the worst way for a
// signer to fail. Asserting on the returned bytes, not on the object we mutated.
test('co-sign: the signature survives serialization — the returned hex is really signed', async () => {
  const bob = PrivateKey.fromRandom()
  const c = coin(bob, 50_000)
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: c.tx, sourceOutputIndex: 0, unlockingScript: BLANK() })
  tx.addOutput({ lockingScript: new P2PKH().lock(bob.toAddress()), satoshis: 49_800 })
  const raw = tx.toHex()

  const out = await cosignTransaction(raw, [c.source], bob)
  assert.notEqual(out.rawTx, raw, 'the returned transaction must differ from the unsigned one')
  const done = Transaction.fromHex(out.rawTx)
  assert.ok(done.inputs[0].unlockingScript!.toBinary().length > 100, 'the signature is in the BYTES')
  assert.equal(out.txId, done.id('hex'), 'and the reported txid is the signed transaction’s')
  assert.ok(validateInput(done, 0, new P2PKH().lock(bob.toAddress()), 50_000))
})

test('co-sign: refuses when no input belongs to this wallet', () => {
  const alice = PrivateKey.fromRandom(), stranger = PrivateKey.fromRandom()
  const a = coin(alice, 10_000)
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: a.tx, sourceOutputIndex: 0, unlockingScript: BLANK() })
  tx.addOutput({ lockingScript: new P2PKH().lock(alice.toAddress()), satoshis: 9_800 })

  const seen = analyseCosign(tx.toHex(), [a.source], stranger.toAddress())
  assert.equal(seen.toSign.length, 0)
  assert.ok(seen.blockers.some(b => b.includes('nothing here for it to sign')), seen.blockers.join(' / '))
})

test('co-sign: refuses when a source transaction is missing — an unknown fee is an unknown cost', async () => {
  const alice = PrivateKey.fromRandom(), bob = PrivateKey.fromRandom()
  const a = coin(alice, 50_000), b = coin(bob, 50_000)
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: a.tx, sourceOutputIndex: 0, unlockingScript: BLANK() })
  tx.addInput({ sourceTransaction: b.tx, sourceOutputIndex: 0, unlockingScript: BLANK() })
  tx.addOutput({ lockingScript: new P2PKH().lock(bob.toAddress()), satoshis: 99_000 })

  const seen = analyseCosign(tx.toHex(), [b.source], bob.toAddress())   // Alice's source withheld
  assert.ok(seen.blockers.some(b => b.includes('fee cannot be worked out')), seen.blockers.join(' / '))
  await assert.rejects(() => cosignTransaction(tx.toHex(), [b.source], bob))
})

test('co-sign: refuses a source transaction that does not hash to the txid it claims', async () => {
  const bob = PrivateKey.fromRandom()
  const b = coin(bob, 50_000)
  const lie = coin(PrivateKey.fromRandom(), 999_999)
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: b.tx, sourceOutputIndex: 0, unlockingScript: BLANK() })
  tx.addOutput({ lockingScript: new P2PKH().lock(bob.toAddress()), satoshis: 49_000 })

  // The same txid, a different body — the way an assembler would overstate what a coin is worth.
  const forged: CosignSource = { txId: b.source.txId, sourceTxHex: lie.tx.toHex() }
  const seen = analyseCosign(tx.toHex(), [forged], bob.toAddress())
  assert.ok(seen.blockers.some(x => x.includes('does not hash to the txid')), seen.blockers.join(' / '))
  await assert.rejects(() => cosignTransaction(tx.toHex(), [forged], bob))
})

test('co-sign: an inflated fee is reported loudly, because nothing on the transaction’s face shows it', () => {
  const bob = PrivateKey.fromRandom()
  const big = coin(bob, 1_000_000)
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: big.tx, sourceOutputIndex: 0, unlockingScript: BLANK() })
  tx.addOutput({ lockingScript: new P2PKH().lock(bob.toAddress()), satoshis: 900_000 })  // 100,000 sat to the miner

  const seen = analyseCosign(tx.toHex(), [big.source], bob.toAddress())
  assert.equal(seen.fee, 100_000)
  assert.equal(seen.youPay, 100_000, 'the cost of signing IS the surplus — it does not come back')
  assert.ok(seen.warnings.some(w => w.includes('THE FEE IS')), seen.warnings.join(' / '))
})

test('co-sign: a modest fee raises nothing', () => {
  const bob = PrivateKey.fromRandom()
  const c = coin(bob, 50_000)
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: c.tx, sourceOutputIndex: 0, unlockingScript: BLANK() })
  tx.addOutput({ lockingScript: new P2PKH().lock(bob.toAddress()), satoshis: 49_980 })
  const seen = analyseCosign(tx.toHex(), [c.source], bob.toAddress())
  assert.equal(seen.warnings.filter(w => w.toLowerCase().includes('fee')).length, 0)
})

test('co-sign: OP_RETURN payloads are decoded for display, as text', () => {
  const bob = PrivateKey.fromRandom()
  const c = coin(bob, 50_000)
  const mark = '🏁 Bitcoin Racers... ask me how I know.'
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: c.tx, sourceOutputIndex: 0, unlockingScript: BLANK() })
  tx.addOutput({ lockingScript: new P2PKH().lock(bob.toAddress()), satoshis: 49_800 })
  tx.addOutput({ lockingScript: LockingScript.fromASM(`OP_FALSE OP_RETURN ${Buffer.from(mark, 'utf8').toString('hex')}`), satoshis: 0 })

  const seen = analyseCosign(tx.toHex(), [c.source], bob.toAddress())
  const data = seen.outputs.find(o => o.kind === 'data')
  assert.ok(data != null, 'the data output is recognised')
  assert.equal(data!.text, mark, 'and decoded, emoji intact')
  assert.equal(seen.outputs[0].kind, 'yours', 'the change output is recognised as this wallet’s')
})

// ── AND THE CASE THAT MOTIVATED IT — deliberately last, and deliberately unremarkable ─────────────
// An input whose locking script this wallet cannot parse, cannot rebuild and has never heard of. It is
// handled by the general path with no special case: not mine, already complete, leave it alone.
test('co-sign: an unknown pre-authorised input is simply not this wallet’s problem', async () => {
  const bob = PrivateKey.fromRandom()
  const b = coin(bob, 100_000)

  // Stand in for a covenant: an output anyone can spend, "authorised" before we ever saw it.
  const alien = LockingScript.fromASM('OP_DROP OP_TRUE')
  const alienSrc = new Transaction()
  alienSrc.addOutput({ lockingScript: alien, satoshis: 170 })

  const tx = new Transaction()
  tx.addInput({ sourceTransaction: alienSrc, sourceOutputIndex: 0, unlockingScript: UnlockingScript.fromASM('OP_1') })
  tx.addInput({ sourceTransaction: b.tx, sourceOutputIndex: 0, unlockingScript: BLANK() })
  tx.addOutput({ lockingScript: alien, satoshis: 30_170 })
  tx.addOutput({ lockingScript: new P2PKH().lock(bob.toAddress()), satoshis: 69_653 })

  const sources = [{ txId: alienSrc.id('hex'), sourceTxHex: alienSrc.toHex() }, b.source]
  const seen = analyseCosign(tx.toHex(), sources, bob.toAddress())

  assert.deepEqual(seen.toSign, [1], 'only the wallet’s own input is signed')
  assert.equal(seen.inputs[0].mine, false)
  assert.equal(seen.outputs[0].kind, 'script', 'an output it cannot name is reported as such, not hidden')
  assert.equal(seen.youSpend, 100_000)
  assert.equal(seen.youReceive, 69_653)
  assert.equal(seen.youPay, 30_347, 'fuel plus fee — the true cost, derived, not claimed')

  const signed = await cosignTransaction(tx.toHex(), sources, bob)
  const done = Transaction.fromHex(signed.rawTx)
  assert.ok(validateInput(done, 1, new P2PKH().lock(bob.toAddress()), 100_000))
  assert.equal(done.inputs[0].unlockingScript!.toASM(), 'OP_1', 'the alien input was not touched')
})
