// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, Spend, Hash } from '@bsv/sdk'
import { buildEditionGenesisTx, type EditionUtxo, type EditionTerms } from '../src/editionBuilder.ts'
import type { FundingInput } from '../src/collectionBuilder.ts'
import { buildAirgapRequest, signAirgapRequest, encodeAirgapRequest, decodeAirgapRequest } from '../src/airgap.ts'

const TX1REF = 'ab'.repeat(32)
const pub = (k: PrivateKey): number[] => k.toPublicKey().encode(true) as number[]
function faucet(key: PrivateKey, sats: number): FundingInput {
  const tx = new Transaction()
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: sats })
  return { utxo: { txId: tx.id('hex'), outputIndex: 0, satoshis: sats, script: '' }, sourceTx: tx }
}
const publisher = PrivateKey.fromRandom()
const terms: EditionTerms = { publisherPubKeyHash: Hash.hash160(pub(publisher)), publisherFeeSats: 5000, holderFeeSats: 1000, tokenSats: 2100 }

// Validate input 0 (the covenant input) of a signed tx against the Spend interpreter (the covenant oracle).
function spendOk(tx: Transaction, sourceLock: LockingScript, sourceSats: number): boolean {
  const i0 = tx.inputs[0]
  const txidOf = (inp: typeof i0): string => inp.sourceTXID ?? inp.sourceTransaction!.id('hex') // from-hex tx has sourceTXID, no sourceTransaction
  const others = tx.inputs.slice(1).map(inp => ({
    sourceTXID: txidOf(inp), sourceOutputIndex: inp.sourceOutputIndex, sequence: inp.sequence ?? 0xffffffff,
  }))
  return new Spend({
    sourceTXID: txidOf(i0), sourceOutputIndex: i0.sourceOutputIndex, lockingScript: sourceLock,
    sourceSatoshis: sourceSats, transactionVersion: tx.version, otherInputs: others, unlockingScript: i0.unlockingScript!,
    inputSequence: i0.sequence ?? 0xffffffff, inputIndex: 0, outputs: tx.outputs, lockTime: tx.lockTime,
  }).validate()
}

async function heldEdition(owner: PrivateKey): Promise<EditionUtxo> {
  const genesis = await buildEditionGenesisTx({ key: publisher, funding: [faucet(publisher, 300000)], tx1Ref: TX1REF, terms, ownerPubKey: pub(owner) })
  const vout = genesis.editionVouts[0]
  return { txId: genesis.txId, outputIndex: vout, satoshis: 2100, lockBytes: genesis.tx.outputs[vout].lockingScript.toBinary(), sourceTx: genesis.tx }
}

test('air-gap BURN: build request → encode/decode → sign offline → covenant accepts', async () => {
  const owner = PrivateKey.fromRandom()
  const ed = await heldEdition(owner)
  const req = buildAirgapRequest('burn', ed)
  const back = decodeAirgapRequest(encodeAirgapRequest(req)) // round-trips through JSON (the file)
  const { rawTx } = await signAirgapRequest(back, owner)     // OFFLINE signer
  const signed = Transaction.fromHex(rawTx)
  assert.equal(spendOk(signed, LockingScript.fromBinary(ed.lockBytes), ed.satoshis), true)
})

test('air-gap TRANSFER: build request (with funding) → sign offline → covenant accepts', async () => {
  const owner = PrivateKey.fromRandom(), recipient = PrivateKey.fromRandom()
  const ed = await heldEdition(owner)
  const req = buildAirgapRequest('transfer', ed, { newOwnerPubKeyHex: recipient.toPublicKey().toString(), funding: [faucet(owner, 200000)] })
  const { rawTx } = await signAirgapRequest(decodeAirgapRequest(encodeAirgapRequest(req)), owner)
  const signed = Transaction.fromHex(rawTx)
  assert.equal(spendOk(signed, LockingScript.fromBinary(ed.lockBytes), ed.satoshis), true)
  // out[0] re-creates the covenant for the recipient (owner swapped).
  assert.equal(signed.outputs.length >= 3, true)
})

test('air-gap signer refuses an edition the key does not own', async () => {
  const owner = PrivateKey.fromRandom(), attacker = PrivateKey.fromRandom()
  const req = buildAirgapRequest('burn', await heldEdition(owner))
  await assert.rejects(() => signAirgapRequest(req, attacker), /does not own/)
})

test('air-gap decode rejects a wrong-version / malformed request', () => {
  assert.throws(() => decodeAirgapRequest(JSON.stringify({ v: 999, action: 'burn' })), /version/)
  assert.throws(() => decodeAirgapRequest(JSON.stringify({ v: 1, action: 'nope' })), /action/)
})
