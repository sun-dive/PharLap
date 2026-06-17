// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, Hash } from '@bsv/sdk'
import { buildEditionGenesisTx, buildReplicateTx, type EditionUtxo, type EditionTerms } from '../src/editionBuilder.ts'
import { walkNodeAncestors, nodeFeedHash160, rootFeedHash160 } from '../src/discussion.ts'
import type { FundingInput } from '../src/collectionBuilder.ts'

const TX1REF = 'cd'.repeat(32)
const pub = (k: PrivateKey): number[] => k.toPublicKey().encode(true) as number[]
function faucet(key: PrivateKey, sats: number): FundingInput {
  const tx = new Transaction()
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: sats })
  return { utxo: { txId: tx.id('hex'), outputIndex: 0, satoshis: sats, script: '' }, sourceTx: tx }
}

const publisher = PrivateKey.fromRandom()
const terms: EditionTerms = { publisherPubKeyHash: Hash.hash160(pub(publisher)), publisherFeeSats: 5000, holderFeeSats: 1000, tokenSats: 2100 }
const editionUtxo = (tx: Transaction, txId: string, vout: number): EditionUtxo =>
  ({ txId, outputIndex: vout, satoshis: 2100, lockBytes: tx.outputs[vout].lockingScript.toBinary(), sourceTx: tx })

test('walkNodeAncestors: returns root→self node chain through a 3-deep lineage', async () => {
  const holder = PrivateKey.fromRandom(), b1 = PrivateKey.fromRandom(), b2 = PrivateKey.fromRandom()
  // Genesis copy → owned by `holder`.
  const genesis = await buildEditionGenesisTx({ key: publisher, funding: [faucet(publisher, 300000)], tx1Ref: TX1REF, terms, ownerPubKey: pub(holder) })
  const gVout = genesis.editionVouts[0]
  // b1 replicates from holder's copy → b1's copy at rep1.out[1].
  const rep1 = await buildReplicateTx({ edition: editionUtxo(genesis.tx, genesis.txId, gVout), terms, buyerKey: b1, funding: [faucet(b1, 300000)] })
  // b2 replicates from b1's copy → b2's copy at rep2.out[1].
  const rep2 = await buildReplicateTx({ edition: editionUtxo(rep1.tx, rep1.txId, 1), terms, buyerKey: b2, funding: [faucet(b2, 300000)] })

  const byId: Record<string, Transaction> = { [genesis.txId]: genesis.tx, [rep1.txId]: rep1.tx, [rep2.txId]: rep2.tx }
  const provider = { getSourceTransaction: async (id: string) => byId[id] ?? (() => { throw new Error(`no tx ${id}`) })() }

  const nodes = await walkNodeAncestors(provider, rep2.txId, 1, TX1REF)
  assert.equal(nodes.length, 3) // genesis(holder) → b1 → b2
  assert.equal(nodes[0].isGenesis, true)
  assert.equal(nodes[0].ownerPubKeyHex, holder.toPublicKey().toString())   // root = the genesis copy's owner
  assert.equal(nodes[1].ownerPubKeyHex, b1.toPublicKey().toString())       // upline
  assert.equal(nodes[2].ownerPubKeyHex, b2.toPublicKey().toString())       // self
  assert.equal(nodes[2].birthTxId, rep2.txId)
  assert.equal(nodes[2].birthVout, 1)
  assert.equal(nodes[1].isGenesis, false)
})

test('walkNodeAncestors: a genesis copy is its own only node', async () => {
  const holder = PrivateKey.fromRandom()
  const genesis = await buildEditionGenesisTx({ key: publisher, funding: [faucet(publisher, 300000)], tx1Ref: TX1REF, terms, ownerPubKey: pub(holder) })
  const gVout = genesis.editionVouts[0]
  const provider = { getSourceTransaction: async (id: string) => (id === genesis.txId ? genesis.tx : (() => { throw new Error('no tx') })()) }
  const nodes = await walkNodeAncestors(provider, genesis.txId, gVout, TX1REF)
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].isGenesis, true)
  assert.equal(nodes[0].birthTxId, genesis.txId)
})

test('feed hashes are deterministic + separated by node / collection / root', () => {
  const c = 'ab'.repeat(32), t = 'ef'.repeat(32)
  assert.deepEqual(nodeFeedHash160(c, t, 1), nodeFeedHash160(c, t, 1))         // deterministic
  assert.notDeepEqual(nodeFeedHash160(c, t, 1), nodeFeedHash160(c, t, 0))      // per-vout
  assert.notDeepEqual(nodeFeedHash160(c, t, 1), nodeFeedHash160('11'.repeat(32), t, 1)) // per-collection
  assert.notDeepEqual(rootFeedHash160(c), nodeFeedHash160(c, c, 0))            // root distinct from a node
  assert.equal(nodeFeedHash160(c, t, 1).length, 20)
})
