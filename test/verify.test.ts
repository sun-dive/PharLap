/**
 * Phase 4 — lightweight verification tests (offline, mocked fetcher + ChainTracker).
 *
 *  - a genesis token (parent is funding, not a token) verifies as a genesis of its collection.
 *  - a transferred token (parent is a same-collection token) verifies as a descendant.
 *  - a token whose TX1 has no TEMPLATE output is rejected (bad collection anchor).
 *  - the optional confirmation path verifies a Merkle proof via a ChainTracker (and fails on a bad proof).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, Transaction, P2PKH } from '@bsv/sdk'
import { buildTemplateTx, buildGenesisTx, type FundingInput } from '../src/collectionBuilder.ts'
import { buildTransferTx } from '../src/transfer.ts'
import { verifyTokenLineage, type VerifyDeps } from '../src/verify.ts'
import { encodeTokenRules } from '../src/tokenCodec.ts'

const KEY = PrivateKey.fromRandom()
const RECIP_PUB = PrivateKey.fromRandom().toPublicKey().toString()

function makeFunding(sats: number): FundingInput {
  const sourceTx = new Transaction()
  sourceTx.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: sats })
  return { utxo: { txId: sourceTx.id('hex'), outputIndex: 0, satoshis: sats, script: '' }, sourceTx }
}

/** A fetcher backed by an in-memory registry of transactions. */
function makeDeps(txs: Transaction[], extra?: Partial<VerifyDeps>): VerifyDeps {
  const reg = new Map<string, Transaction>()
  for (const t of txs) reg.set(t.id('hex'), t)
  return {
    getRawTransaction: async (id: string) => {
      const t = reg.get(id)
      if (!t) throw new Error(`not found: ${id}`)
      return t
    },
    ...extra,
  }
}

const TEMPLATE = { tokenName: 'Editions', tokenRules: encodeTokenRules(0, 0, 0, 1), covenantScript: '' }

test('genesis token verifies as a genesis of its collection', async () => {
  const f1 = makeFunding(200_000)
  const tx1 = await buildTemplateTx({ key: KEY, funding: [f1], template: TEMPLATE })
  const f2 = makeFunding(200_000)
  const t2 = await buildGenesisTx({ key: KEY, funding: [f2], tx1Id: tx1.tx1Id, mintCount: 1 })

  const deps = makeDeps([tx1.tx, t2.tx, f2.sourceTx])
  const r = await verifyTokenLineage(t2.tx, t2.tokenVouts[0], deps)
  assert.equal(r.valid, true, r.reason)
  assert.equal(r.isGenesis, true)
  assert.equal(r.collectionId, tx1.tx1Id)
})

test('transferred token verifies as a descendant', async () => {
  const tx1 = await buildTemplateTx({ key: KEY, funding: [makeFunding(200_000)], template: TEMPLATE })
  const t2 = await buildGenesisTx({ key: KEY, funding: [makeFunding(200_000)], tx1Id: tx1.tx1Id, mintCount: 1 })
  const xfer = await buildTransferTx({
    key: KEY,
    tokenOutputIndex: t2.tokenVouts[0],
    tokenSourceTx: t2.tx,
    recipientPubKeyHex: RECIP_PUB,
    funding: [makeFunding(200_000)],
  })

  const deps = makeDeps([tx1.tx, t2.tx, xfer.tx])
  const r = await verifyTokenLineage(xfer.tx, xfer.recipientVout, deps)
  assert.equal(r.valid, true, r.reason)
  assert.equal(r.isGenesis, false)
  assert.equal(r.collectionId, tx1.tx1Id)
})

test('token whose TX1 has no TEMPLATE output is rejected', async () => {
  // A "collection anchor" that is just a plain P2PKH tx (no TEMPLATE output).
  const badAnchor = new Transaction()
  badAnchor.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: 100_000 })
  const f = makeFunding(200_000)
  const t2 = await buildGenesisTx({ key: KEY, funding: [f], tx1Id: badAnchor.id('hex'), mintCount: 1 })

  const deps = makeDeps([badAnchor, t2.tx, f.sourceTx])
  const r = await verifyTokenLineage(t2.tx, t2.tokenVouts[0], deps)
  assert.equal(r.valid, false)
  assert.match(r.reason, /no TEMPLATE output/)
})

test('confirmation path: verifies a Merkle proof via ChainTracker (and rejects a bad proof)', async () => {
  const tx1 = await buildTemplateTx({ key: KEY, funding: [makeFunding(200_000)], template: TEMPLATE })
  const f2 = makeFunding(200_000)
  const t2 = await buildGenesisTx({ key: KEY, funding: [f2], tx1Id: tx1.tx1Id, mintCount: 1 })

  const chainTracker = { isValidRootForHeight: async () => true, currentHeight: async () => 800_000 }

  // Good proof → confirmed valid.
  const okDeps = makeDeps([tx1.tx, t2.tx, f2.sourceTx], {
    getProof: async () => ({ verify: async () => true }),
    chainTracker,
  })
  const ok = await verifyTokenLineage(t2.tx, t2.tokenVouts[0], okDeps)
  assert.equal(ok.valid, true)
  assert.equal(ok.unconfirmed, undefined)
  assert.match(ok.reason, /confirmed/)

  // Bad proof → rejected.
  const badDeps = makeDeps([tx1.tx, t2.tx, f2.sourceTx], {
    getProof: async () => ({ verify: async () => false }),
    chainTracker,
  })
  const bad = await verifyTokenLineage(t2.tx, t2.tokenVouts[0], badDeps)
  assert.equal(bad.valid, false)
  assert.match(bad.reason, /did not verify/)
})
