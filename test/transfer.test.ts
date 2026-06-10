/**
 * Phase 4 — transfer + detection tests (offline).
 *
 *  - buildTransferTx recreates the token for the recipient (same tx1Ref), carries/updates stateData,
 *    and (by default) adds a 1-sat P2PKH notification output to the recipient's address.
 *  - the token spend (Input 0, pushDrop.unlock) is valid in a full transfer (Spend interpreter).
 *  - findOwnedTokenOutputs detects the recipient's token in the transfer tx.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, Transaction, P2PKH, PublicKey, Spend } from '@bsv/sdk'
import { buildGenesisTx, type FundingInput } from '../src/collectionBuilder.ts'
import { buildTransferTx, findOwnedTokenOutputs } from '../src/transfer.ts'
import { parseTokenScript } from '../src/tokenCodec.ts'

const SENDER = PrivateKey.fromRandom()
const RECIP = PrivateKey.fromRandom()
const RECIP_PUB = RECIP.toPublicKey().toString()
const TX1 = 'a'.repeat(64)

function makeFunding(key: PrivateKey, sats: number): FundingInput {
  const sourceTx = new Transaction()
  sourceTx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: sats })
  return { utxo: { txId: sourceTx.id('hex'), outputIndex: 0, satoshis: sats, script: '' }, sourceTx }
}

/** Mint one token owned by SENDER, referencing TX1. */
async function mintToken(stateData = 'beef') {
  return buildGenesisTx({ key: SENDER, funding: [makeFunding(SENDER, 100_000)], tx1Id: TX1, mintCount: 1, stateData })
}

test('buildTransferTx: recipient token + notification, token spend is valid (Spend)', async () => {
  const minted = await mintToken('beef')
  const xfer = await buildTransferTx({
    key: SENDER,
    tokenOutputIndex: 0,
    tokenSourceTx: minted.tx,
    recipientPubKeyHex: RECIP_PUB,
    funding: [makeFunding(SENDER, 100_000)],
  })

  // Recipient token: same collection, locked to recipient, stateData carried forward.
  const recipTok = parseTokenScript(xfer.tx.outputs[xfer.recipientVout].lockingScript)
  assert.ok(recipTok)
  assert.equal(recipTok.ownerPubKeyHex, RECIP_PUB)
  assert.equal(recipTok.fields.tx1Ref, TX1)
  assert.equal(recipTok.fields.stateData, 'beef')

  // Notification output: 1-sat P2PKH to the recipient's address.
  assert.ok(xfer.notifyVout != null)
  assert.equal(xfer.tx.outputs[xfer.notifyVout].satoshis, 1)
  const expectedNotify = new P2PKH().lock(PublicKey.fromString(RECIP_PUB).toAddress()).toHex()
  assert.equal(xfer.tx.outputs[xfer.notifyVout].lockingScript.toHex(), expectedNotify)

  // The token input (Input 0) must satisfy the token's PushDrop lock.
  const unlockingScript = xfer.tx.inputs[0].unlockingScript
  assert.ok(unlockingScript)
  const sp = new Spend({
    sourceTXID: minted.tx.id('hex'),
    sourceOutputIndex: 0,
    lockingScript: minted.tx.outputs[0].lockingScript,
    sourceSatoshis: minted.tx.outputs[0].satoshis ?? 1,
    transactionVersion: xfer.tx.version,
    otherInputs: xfer.tx.inputs.filter((_, i) => i !== 0),
    unlockingScript,
    inputSequence: xfer.tx.inputs[0].sequence ?? 0xffffffff,
    inputIndex: 0,
    outputs: xfer.tx.outputs,
    lockTime: xfer.tx.lockTime,
  })
  assert.equal(sp.validate(), true)
})

test('buildTransferTx: notify=false omits the notification output; newStateData overrides', async () => {
  const minted = await mintToken('beef')
  const xfer = await buildTransferTx({
    key: SENDER,
    tokenOutputIndex: 0,
    tokenSourceTx: minted.tx,
    recipientPubKeyHex: RECIP_PUB,
    funding: [makeFunding(SENDER, 100_000)],
    notify: false,
    newStateData: 'cafe',
  })
  assert.equal(xfer.notifyVout, null)
  assert.equal(parseTokenScript(xfer.tx.outputs[0].lockingScript)?.fields.stateData, 'cafe')
})

test('findOwnedTokenOutputs detects the recipient token in a transfer', async () => {
  const minted = await mintToken()
  const xfer = await buildTransferTx({
    key: SENDER,
    tokenOutputIndex: 0,
    tokenSourceTx: minted.tx,
    recipientPubKeyHex: RECIP_PUB,
    funding: [makeFunding(SENDER, 100_000)],
  })
  const mine = findOwnedTokenOutputs(xfer.tx, RECIP_PUB)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].outputIndex, xfer.recipientVout)
  assert.equal(mine[0].fields.tx1Ref, TX1)
  // The sender does not own the recipient's token.
  assert.equal(findOwnedTokenOutputs(xfer.tx, SENDER.toPublicKey().toString()).length, 0)
})
