// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transaction, P2PKH, PrivateKey, Spend } from '@bsv/sdk'
import { buildMessageTx } from '../src/messageBuilder.ts'
import { buildEnvelope, openEnvelope, type Part } from '../src/messageCodec.ts'
import { parseMessageScript } from '../src/tokenCodec.ts'
import type { FundingInput } from '../src/collectionBuilder.ts'

const sender = PrivateKey.fromRandom()
const recipient = PrivateKey.fromRandom()
const recipientPubHex = recipient.toPublicKey().toString()

function faucet(key: PrivateKey, sats: number): FundingInput {
  const tx = new Transaction()
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: sats })
  return { utxo: { txId: tx.id('hex'), outputIndex: 0, satoshis: sats, script: '' }, sourceTx: tx }
}

const parts: Part[] = [
  { kind: 'text', text: 'your unlock key + a bonus 🎁' },
  { kind: 'key', key: Array.from({ length: 32 }, (_, i) => (i * 3) & 0xff) },
]

test('buildMessageTx: valid tx, message output opens for the recipient, notification to recipient addr', async () => {
  const envelope = await buildEnvelope({ senderPriv: sender, recipientPubKeyHex: recipientPubHex, parts })
  const funding = faucet(sender, 100000)
  const r = await buildMessageTx({ key: sender, funding: [funding], recipientPubKeyHex: recipientPubHex, envelope })

  // 1) the tx is valid — Spend-validate the funding input.
  const i0 = r.tx.inputs[0]
  const ok = new Spend({
    sourceTXID: i0.sourceTransaction!.id('hex'), sourceOutputIndex: 0,
    lockingScript: i0.sourceTransaction!.outputs[0].lockingScript, sourceSatoshis: 100000,
    transactionVersion: r.tx.version, otherInputs: [], unlockingScript: i0.unlockingScript!,
    inputSequence: i0.sequence ?? 0xffffffff, inputIndex: 0, outputs: r.tx.outputs, lockTime: r.tx.lockTime,
  }).validate()
  assert.equal(ok, true)

  // 2) the message output is a RECORD_MESSAGE locked to the recipient, openable by them.
  const parsed = parseMessageScript(r.tx.outputs[r.messageVout].lockingScript)
  assert.ok(parsed)
  assert.equal(parsed!.recipientPubKeyHex, recipientPubHex)
  const opened = await openEnvelope(parsed!.fields.envelope, recipient)
  assert.ok(opened)
  assert.equal(opened!.senderPubKeyHex, sender.toPublicKey().toString())
  assert.deepEqual(opened!.parts, parts)

  // 3) the notification goes to the recipient's address (the discovery breadcrumb).
  assert.ok(r.notifyVout != null)
  const notifyScript = r.tx.outputs[r.notifyVout!].lockingScript.toHex()
  assert.equal(notifyScript, new P2PKH().lock(recipient.toAddress()).toHex())
})

test('buildMessageTx: a stranger cannot open the message', async () => {
  const envelope = await buildEnvelope({ senderPriv: sender, recipientPubKeyHex: recipientPubHex, parts })
  const r = await buildMessageTx({ key: sender, funding: [faucet(sender, 100000)], recipientPubKeyHex: recipientPubHex, envelope })
  const parsed = parseMessageScript(r.tx.outputs[r.messageVout].lockingScript)
  assert.equal(await openEnvelope(parsed!.fields.envelope, PrivateKey.fromRandom()), null)
})
