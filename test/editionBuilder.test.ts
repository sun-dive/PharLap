// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, Spend, Hash } from '@bsv/sdk'
import {
  buildEditionGenesisTx, buildReplicateTx, buildReplicateV2Tx, buildEditionGenesisV2Tx, buildEditionTransferTx,
  type EditionUtxo, type EditionTerms,
} from '../src/editionBuilder.ts'
import { buildEditionLockV2, p2pkhScript } from '../src/covenant.ts'
import { readNoteFromTx } from '../src/sellerNote.ts'
import { parseNoteScript } from '../src/tokenCodec.ts'
import type { FundingInput } from '../src/collectionBuilder.ts'

const TX1REF = 'ab'.repeat(32)
function pub(k: PrivateKey) { return k.toPublicKey().encode(true) as number[] }

// A synthetic funding source: a tx with one P2PKH output to `key` worth `sats`.
function faucet(key: PrivateKey, sats: number): FundingInput {
  const tx = new Transaction()
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: sats })
  return { utxo: { txId: tx.id('hex'), outputIndex: 0, satoshis: sats, script: '' }, sourceTx: tx }
}

// Validate input 0 (the covenant input) of a built tx against the Spend interpreter, passing the
// real other-inputs so the owner's SIGHASH_ALL signature (transfer) hashes correctly.
function spendOk(tx: Transaction, sourceLock: LockingScript, sourceSats: number): boolean {
  const i0 = tx.inputs[0]
  const others = tx.inputs.slice(1).map(inp => ({
    sourceTXID: inp.sourceTransaction!.id('hex'),
    sourceOutputIndex: inp.sourceOutputIndex,
    sequence: inp.sequence ?? 0xffffffff,
  }))
  const interp = new Spend({
    sourceTXID: i0.sourceTransaction!.id('hex'), sourceOutputIndex: i0.sourceOutputIndex,
    lockingScript: sourceLock, sourceSatoshis: sourceSats, transactionVersion: tx.version,
    otherInputs: others, unlockingScript: i0.unlockingScript!, inputSequence: i0.sequence ?? 0xffffffff,
    inputIndex: 0, outputs: tx.outputs, lockTime: tx.lockTime,
  })
  return interp.validate()
}

const holder = PrivateKey.fromRandom()
const creator = PrivateKey.fromRandom()
const terms: EditionTerms = {
  creatorPubKeyHash: Hash.hash160(pub(creator)), creatorFeeSats: 5000, holderFeeSats: 1000, tokenSats: 1,
}

async function genesisEdition(): Promise<{ genesis: Awaited<ReturnType<typeof buildEditionGenesisTx>>; utxo: EditionUtxo }> {
  const genesis = await buildEditionGenesisTx({
    key: creator, funding: [faucet(creator, 200000)], tx1Ref: TX1REF, terms, ownerPubKey: pub(holder),
  })
  const vout = genesis.editionVouts[0]
  const utxo: EditionUtxo = {
    txId: genesis.txId, outputIndex: vout, satoshis: 1,
    lockBytes: genesis.tx.outputs[vout].lockingScript.toBinary(), sourceTx: genesis.tx,
  }
  return { genesis, utxo }
}

test('genesis: mints an edition covenant output funded by the creator', async () => {
  const { genesis } = await genesisEdition()
  assert.equal(genesis.editionVouts.length, 1)
  assert.ok(genesis.changeVout != null) // funding left change
})

test('replicate: builds a valid permissionless mint (token, replica, fees, change)', async () => {
  const { utxo } = await genesisEdition()
  const buyer = PrivateKey.fromRandom()
  const rep = await buildReplicateTx({ edition: utxo, terms, buyerKey: buyer, funding: [faucet(buyer, 200000)] })
  assert.equal(rep.tx.outputs.length, 5)
  assert.equal(spendOk(rep.tx, LockingScript.fromBinary(utxo.lockBytes), 1), true)
})

test('replicate with a seller-note echoes a NOTE output to the buyer, covenant still valid', async () => {
  const { utxo } = await genesisEdition()
  const buyer = PrivateKey.fromRandom()
  const rep = await buildReplicateTx({
    edition: utxo, terms, buyerKey: buyer, funding: [faucet(buyer, 200000)], note: { text: 'Bonus inside 🎁' },
  })
  // 4 enforced outputs + note + change = 6, and the covenant input still validates (note is trailing).
  assert.equal(rep.tx.outputs.length, 6)
  assert.equal(spendOk(rep.tx, LockingScript.fromBinary(utxo.lockBytes), 1), true)
  // The note rode in, readable and tied to the collection, locked to the BUYER.
  assert.equal(readNoteFromTx(rep.tx, TX1REF)?.text, 'Bonus inside 🎁')
  const noteOut = rep.tx.outputs.find(o => parseNoteScript(o.lockingScript))!
  assert.equal(parseNoteScript(noteOut.lockingScript)!.authorPubKeyHex, buyer.toPublicKey().toString())
})

test('replicate WITHOUT a note keeps the original 5-output shape (no echo)', async () => {
  const { utxo } = await genesisEdition()
  const buyer = PrivateKey.fromRandom()
  const rep = await buildReplicateTx({ edition: utxo, terms, buyerKey: buyer, funding: [faucet(buyer, 200000)] })
  assert.equal(rep.tx.outputs.length, 5)
  assert.equal(readNoteFromTx(rep.tx, TX1REF), null)
})

test('transfer with a seller-note carries a NOTE output to the new owner, covenant still valid', async () => {
  const { utxo } = await genesisEdition()
  const newOwner = PrivateKey.fromRandom()
  const xfer = await buildEditionTransferTx({
    edition: utxo, ownerKey: holder, newOwnerPubKey: pub(newOwner), funding: [faucet(holder, 200000)],
    note: { text: 'see you downstream' },
  })
  assert.equal(spendOk(xfer.tx, LockingScript.fromBinary(utxo.lockBytes), 1), true)
  assert.equal(readNoteFromTx(xfer.tx, TX1REF)?.text, 'see you downstream')
  const noteOut = xfer.tx.outputs.find(o => parseNoteScript(o.lockingScript))!
  assert.equal(parseNoteScript(noteOut.lockingScript)!.authorPubKeyHex, newOwner.toPublicKey().toString())
})

test('transfer: builds a valid owner-signed move that re-creates the covenant', async () => {
  const { utxo } = await genesisEdition()
  const newOwner = PrivateKey.fromRandom()
  const xfer = await buildEditionTransferTx({
    edition: utxo, ownerKey: holder, newOwnerPubKey: pub(newOwner), funding: [faucet(holder, 200000)],
  })
  assert.equal(spendOk(xfer.tx, LockingScript.fromBinary(utxo.lockBytes), 1), true)
})

test('transfer: rejects a non-owner signer', async () => {
  const { utxo } = await genesisEdition()
  const imposter = PrivateKey.fromRandom()
  const newOwner = PrivateKey.fromRandom()
  const xfer = await buildEditionTransferTx({
    edition: utxo, ownerKey: imposter, newOwnerPubKey: pub(newOwner), funding: [faucet(imposter, 200000)],
  })
  assert.throws(() => spendOk(xfer.tx, LockingScript.fromBinary(utxo.lockBytes), 1))
})

// --- Covenant v2: buildReplicateV2Tx pays the COMPUTED percentage split (matches the covenant) ---
const V2_PRICE = 100_000
const V2_CBPS = 250 // 2.5%

function u64le(n: number): number[] { const o: number[] = []; let v = n; for (let i = 0; i < 8; i++) { o.push(v & 0xff); v = Math.floor(v / 256) } return o }

function v2Edition() {
  const holder = PrivateKey.fromRandom()
  const creatorHash = Hash.hash160(pub(PrivateKey.fromRandom()))
  const lock = buildEditionLockV2({
    tx1Ref: TX1REF.length ? Array.from({ length: 32 }, (_, i) => (i * 5 + 1) & 0xff) : [],
    ownerPubKey: pub(holder), price: u64le(V2_PRICE), stateData: [0xde, 0xad],
    creatorPubKeyHash: creatorHash, cBps: V2_CBPS, tokenSats: 1,
  })
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: 1 })
  const utxo: EditionUtxo = { txId: src.id('hex'), outputIndex: 0, satoshis: 1, lockBytes: lock.toBinary(), sourceTx: src }
  return { holder, creatorHash, lock, utxo }
}

test('v2 builder: replicate pays ⌊P·c%⌋ to creator + remainder to reseller, and the covenant accepts it', async () => {
  const { holder, creatorHash, lock, utxo } = v2Edition()
  const buyer = PrivateKey.fromRandom()
  const rep = await buildReplicateV2Tx({ edition: utxo, buyerKey: buyer, funding: [faucet(buyer, 200000)] })

  const expectedCreator = Math.floor((V2_PRICE * V2_CBPS) / 10000) // 2500
  assert.equal(rep.creatorCut, expectedCreator)
  assert.equal(rep.resellerCut, V2_PRICE - expectedCreator)        // 97500
  assert.equal(rep.tx.outputs[2].satoshis, expectedCreator)        // [2] creator cut
  assert.equal(rep.tx.outputs[3].satoshis, V2_PRICE - expectedCreator) // [3] reseller cut
  // out[2] pays the baked creator hash; out[3] pays the holder.
  assert.deepEqual(rep.tx.outputs[2].lockingScript.toBinary(), p2pkhScript(creatorHash))
  assert.deepEqual(rep.tx.outputs[3].lockingScript.toBinary(), p2pkhScript(Hash.hash160(pub(holder))))
  // The covenant input validates — builder's amounts match what the script recomputes & enforces.
  assert.equal(spendOk(rep.tx, lock, 1), true)
})

test('v2 lifecycle: genesis mints a v2 edition → replicate from it enforces the split', async () => {
  const creatorHash = Hash.hash160(pub(PrivateKey.fromRandom()))
  const minter = PrivateKey.fromRandom()
  const tx1Ref = Array.from({ length: 32 }, (_, i) => (i * 9 + 3) & 0xff)
  const genesis = await buildEditionGenesisV2Tx({
    key: minter, funding: [faucet(minter, 200000)], tx1Ref: Buffer.from(tx1Ref).toString('hex'),
    terms: { creatorPubKeyHash: creatorHash, cBps: V2_CBPS }, initialPriceSats: V2_PRICE, ownerPubKey: pub(minter),
  })
  const vout = genesis.editionVouts[0]
  const lock = genesis.tx.outputs[vout].lockingScript
  const utxo: EditionUtxo = { txId: genesis.txId, outputIndex: vout, satoshis: 1, lockBytes: lock.toBinary(), sourceTx: genesis.tx }

  const buyer = PrivateKey.fromRandom()
  const rep = await buildReplicateV2Tx({ edition: utxo, buyerKey: buyer, funding: [faucet(buyer, 200000)] })
  const expectedCreator = Math.floor((V2_PRICE * V2_CBPS) / 10000)
  assert.equal(rep.tx.outputs[2].satoshis, expectedCreator)
  assert.equal(rep.tx.outputs[3].satoshis, V2_PRICE - expectedCreator)
  assert.equal(spendOk(rep.tx, lock, 1), true)
})
