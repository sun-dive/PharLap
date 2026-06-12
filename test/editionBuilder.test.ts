// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, Spend, Hash } from '@bsv/sdk'
import {
  buildEditionGenesisTx, buildReplicateTx, buildEditionTransferTx, type EditionUtxo, type EditionTerms,
} from '../src/editionBuilder.ts'
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
