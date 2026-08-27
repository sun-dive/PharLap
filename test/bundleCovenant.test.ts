// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
//
// Bundle covenant — a quine that self-replicates to a new holder AND forces N fixed creator-fee outputs
// bound to each component's genesis address. Validated end-to-end by the @bsv/sdk Spend interpreter (the
// same one that checks live transactions): a valid resale pays every creator; tampering is rejected.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, UnlockingScript, Spend, Hash, TransactionSignature } from '@bsv/sdk'
import { pushTxPreimage } from '../src/pushtx.ts'
import { serializeOutput, p2pkhScript, EDITION_SCOPE } from '../src/covenant.ts'
import { buildBundleLock, bundleTransferUnlockChunks, swapBundleOwner, BUNDLE_OWNER_OFFSET, type BundlePayee } from '../src/bundleCovenant.ts'

const BOND = 2100
const pk = () => PrivateKey.fromRandom()
const pub = (k: PrivateKey) => k.toPublicKey().encode(true) as number[]
const payees = (n: number): BundlePayee[] => Array.from({ length: n }, (_, i) => ({ pubKeyHash: Hash.hash160(pub(pk())), feeSats: 1000 * (i + 1) }))

// Run a resale, with optional tampering, and report whether the covenant accepts it (catch → rejected).
function runBundleResale(opts: {
  payees: BundlePayee[]
  drop?: number                          // omit the i-th creator's fee output
  amount?: { i: number; sats: number }   // pay the i-th creator a wrong amount
  redirect?: number                      // send the i-th creator's fee to an attacker
}): boolean {
  try {
    const holder = pk(), newOwner = pk(), attacker = pk()
    const manifestRef = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)
    const lock = buildBundleLock({ manifestRef, ownerPubKey: pub(holder), payees: opts.payees, tokenSats: BOND })
    const lockBytes = lock.toBinary()
    const changeScript = new P2PKH().lock(newOwner.toAddress()).toBinary()

    const outputs: Array<{ script: number[]; sats: number }> = [{ script: swapBundleOwner(lockBytes, pub(newOwner)), sats: BOND }]
    opts.payees.forEach((pe, i) => {
      if (opts.drop === i) return
      const dest = opts.redirect === i ? Hash.hash160(pub(attacker)) : pe.pubKeyHash
      const sats = opts.amount?.i === i ? opts.amount.sats : pe.feeSats
      outputs.push({ script: p2pkhScript(dest), sats })
    })
    outputs.push({ script: changeScript, sats: 500 })

    const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: BOND })
    const sp = new Transaction(); sp.version = 2
    sp.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
    for (const o of outputs) sp.addOutput({ lockingScript: LockingScript.fromBinary(o.script), satoshis: o.sats })

    const fmt = (scope: number) => pushTxPreimage({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: BOND, transactionVersion: 2,
      inputIndex: 0, subscript: lock, outputs: sp.outputs, inputSequence: 0xffffffff, lockTime: sp.lockTime, scope,
    })
    const introspectionPreimage = fmt(EDITION_SCOPE)
    const ownerScope = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
    const raw = holder.sign(Hash.sha256(fmt(ownerScope)))
    const ownerSig = new TransactionSignature(raw.r, raw.s, ownerScope).toChecksigFormat()

    const unlock = new UnlockingScript(bundleTransferUnlockChunks({
      newOwnerPubKey: pub(newOwner), ownerSig, change: serializeOutput(500, changeScript), preimage: introspectionPreimage,
    }))
    const interp = new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, lockingScript: lock, sourceSatoshis: BOND,
      transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: sp.outputs,
      inputSequence: 0xffffffff, lockTime: sp.lockTime, unlockingScript: unlock,
    })
    return interp.validate()
  } catch { return false }
}

test('bundle: holder pubkey sits at the expected script offset', () => {
  const holder = pk()
  const lock = buildBundleLock({ manifestRef: new Array(32).fill(1), ownerPubKey: pub(holder), payees: payees(2), tokenSats: BOND })
  assert.deepEqual(lock.toBinary().slice(BUNDLE_OWNER_OFFSET, BUNDLE_OWNER_OFFSET + 33), pub(holder))
})

test('bundle resale: self-replicates to the new holder AND pays all N creators (N=3)', () => {
  assert.equal(runBundleResale({ payees: payees(3) }), true)
})

test('bundle resale: works across different N (1 and 5) — variable-length payee tail', () => {
  assert.equal(runBundleResale({ payees: payees(1) }), true)
  assert.equal(runBundleResale({ payees: payees(5) }), true)
})

test('bundle resale: REJECTS skipping a creator payout', () => {
  assert.equal(runBundleResale({ payees: payees(3), drop: 1 }), false)
})

test('bundle resale: REJECTS underpaying a creator', () => {
  const p = payees(3)
  assert.equal(runBundleResale({ payees: p, amount: { i: 2, sats: p[2].feeSats - 1 } }), false)
})

test('bundle resale: REJECTS redirecting a creator fee to an attacker', () => {
  assert.equal(runBundleResale({ payees: payees(3), redirect: 0 }), false)
})
