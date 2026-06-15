// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey } from '@bsv/sdk'
import { buildMessageScript, parseMessageScript } from '../src/tokenCodec.ts'
import { buildEnvelope, openPublicEnvelope, openEnvelope, type Part } from '../src/messageCodec.ts'

const TX1REF = 'cd'.repeat(32)
const isText = (p: Part): p is { kind: 'text'; text: string } => p.kind === 'text'

test('broadcast: a public announcement round-trips through the message record + public envelope', async () => {
  const publisher = PrivateKey.fromRandom()
  const pubHex = publisher.toPublicKey().toString()
  const envelope = await buildEnvelope({
    senderPriv: publisher, recipientPubKeyHex: pubHex, parts: [{ kind: 'text', text: 'New chapter live! 📚' }], encrypt: false,
  })
  const script = buildMessageScript(pubHex, { ref: TX1REF, envelope })

  // A broadcast = a message LOCKED to the publisher, KEYED to the collection, SENT by the publisher.
  const m = parseMessageScript(script)
  assert.ok(m)
  assert.equal(m!.recipientPubKeyHex, pubHex)
  assert.equal(m!.fields.ref, TX1REF)
  const opened = await openPublicEnvelope(m!.fields.envelope)
  assert.ok(opened)
  assert.equal(opened!.senderPubKeyHex, pubHex)
  assert.equal(opened!.encrypted, false)
  assert.equal(opened!.parts.find(isText)?.text, 'New chapter live! 📚')
})

test('broadcast: openPublicEnvelope refuses an ENCRYPTED envelope (those stay private DMs)', async () => {
  const sender = PrivateKey.fromRandom()
  const recipient = PrivateKey.fromRandom()
  const envelope = await buildEnvelope({
    senderPriv: sender, recipientPubKeyHex: recipient.toPublicKey().toString(), parts: [{ kind: 'text', text: 'secret' }], encrypt: true,
  })
  // Public reader rejects it…
  assert.equal(await openPublicEnvelope(envelope), null)
  // …but the intended recipient still opens it the encrypted way.
  assert.equal((await openEnvelope(envelope, recipient))?.parts.find(isText)?.text, 'secret')
})
