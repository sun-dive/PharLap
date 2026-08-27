// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, LockingScript, Spend } from '@bsv/sdk'
import type { FundingInput } from '../src/collectionBuilder.ts'
import { buildPaymentTx } from '../src/payment.ts'
import { buildAirgapPaymentRequest, signAirgapRequest, encodeAirgapRequest, decodeAirgapRequest } from '../src/airgap.ts'

function faucet(key: PrivateKey, sats: number): FundingInput {
  const tx = new Transaction()
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: sats })
  return { utxo: { txId: tx.id('hex'), outputIndex: 0, satoshis: sats, script: '' }, sourceTx: tx }
}

// Validate every input of a signed tx against the Spend interpreter using each input's source output.
function allInputsValid(tx: Transaction, funding: FundingInput[]): boolean {
  const txidOf = (inp: typeof tx.inputs[number]): string => inp.sourceTXID ?? inp.sourceTransaction!.id('hex')
  return tx.inputs.every((inp, i) => {
    const src = funding[i].sourceTx.outputs[funding[i].utxo.outputIndex]
    const others = tx.inputs.filter((_, j) => j !== i).map(o => ({
      sourceTXID: txidOf(o), sourceOutputIndex: o.sourceOutputIndex, sequence: o.sequence ?? 0xffffffff,
    }))
    return new Spend({
      sourceTXID: txidOf(inp), sourceOutputIndex: inp.sourceOutputIndex, lockingScript: src.lockingScript as LockingScript,
      sourceSatoshis: src.satoshis!, transactionVersion: tx.version, otherInputs: others, unlockingScript: inp.unlockingScript!,
      inputSequence: inp.sequence ?? 0xffffffff, inputIndex: i, outputs: tx.outputs, lockTime: tx.lockTime,
    }).validate()
  })
}

const recipient = PrivateKey.fromRandom().toAddress()

test('payment: amount + change, every input valid, fee is sane', async () => {
  const key = PrivateKey.fromRandom()
  const funding = [faucet(key, 200000)]
  const r = await buildPaymentTx({ key, toAddress: recipient, amountSats: 50000, funding })
  assert.equal(r.tx.outputs[0].satoshis, 50000)            // recipient gets exactly the amount
  assert.equal(r.sentSats, 50000)
  assert.equal(r.changeVout, 1)                            // change returns to self
  const fee = 200000 - r.tx.outputs.reduce((s, o) => s + (o.satoshis ?? 0), 0)
  assert.ok(fee > 0 && fee < 5000, `fee out of range: ${fee}`)
  assert.equal(allInputsValid(r.tx, funding), true)
})

test('payment sendMax: sweeps everything (minus fee), no change output', async () => {
  const key = PrivateKey.fromRandom()
  const funding = [faucet(key, 123456), faucet(key, 7000)]
  const r = await buildPaymentTx({ key, toAddress: recipient, amountSats: 0, sendMax: true, funding })
  assert.equal(r.tx.outputs.length, 1)                     // only the recipient output
  assert.equal(r.changeVout, null)
  const fee = 130456 - r.tx.outputs[0].satoshis!
  assert.ok(fee > 0 && fee < 5000, `fee out of range: ${fee}`)
  assert.equal(r.sentSats, r.tx.outputs[0].satoshis)
  assert.equal(allInputsValid(r.tx, funding), true)
})

test('payment rejects an invalid address and a zero amount', async () => {
  const key = PrivateKey.fromRandom()
  const funding = [faucet(key, 100000)]
  await assert.rejects(() => buildPaymentTx({ key, toAddress: 'not-an-address', amountSats: 1000, funding }), /Invalid BSV address/)
  await assert.rejects(() => buildPaymentTx({ key, toAddress: recipient, amountSats: 0, funding }), /at least 1 sat/)
})

test('air-gap PAYMENT: build request → encode/decode → sign offline → inputs valid', async () => {
  const key = PrivateKey.fromRandom()
  const funding = [faucet(key, 200000)]
  const req = buildAirgapPaymentRequest({ toAddress: recipient, amountSats: 75000, funding })
  const { rawTx } = await signAirgapRequest(decodeAirgapRequest(encodeAirgapRequest(req)), key)
  const signed = Transaction.fromHex(rawTx)
  assert.equal(signed.outputs[0].satoshis, 75000)
  assert.equal(allInputsValid(signed, funding), true)
})

test('air-gap payment signer refuses funding it does not own', async () => {
  const owner = PrivateKey.fromRandom(), attacker = PrivateKey.fromRandom()
  const req = buildAirgapPaymentRequest({ toAddress: recipient, amountSats: 50000, funding: [faucet(owner, 200000)] })
  await assert.rejects(() => signAirgapRequest(req, attacker), /does not own/)
})
