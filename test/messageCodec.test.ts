// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, Hash } from '@bsv/sdk'
import { encodeParts, decodeParts, buildEnvelope, openEnvelope, type Part } from '../src/messageCodec.ts'

const sender = PrivateKey.fromRandom()
const recipient = PrivateKey.fromRandom()
const recipientPubHex = recipient.toPublicKey().toString()
const senderPubHex = sender.toPublicKey().toString()

const sampleParts: Part[] = [
  { kind: 'text', text: 'Thanks for buying — here is your key 🔑' },
  { kind: 'key', key: Array.from({ length: 32 }, (_, i) => i) },
  { kind: 'file', mimeType: 'text/plain', fileName: 'bonus.txt', bytes: [...Hash.sha256([1, 2, 3])] },
  { kind: 'fileRef', sha256: Hash.sha256([9, 9, 9]), uri: 'https://example.com/bonus.pdf' },
]

test('TLV: parts round-trip (text/key/file/fileRef, composite)', () => {
  const decoded = decodeParts(encodeParts(sampleParts))
  assert.deepEqual(decoded, sampleParts)
})

test('envelope: encrypted round-trip recovers parts + authenticates sender', () => {
  const env = buildEnvelope({ senderPriv: sender, recipientPubKeyHex: recipientPubHex, parts: sampleParts })
  const opened = openEnvelope(env, recipient)
  assert.ok(opened)
  assert.equal(opened!.encrypted, true)
  assert.equal(opened!.senderPubKeyHex, senderPubHex)
  assert.deepEqual(opened!.parts, sampleParts)
})

test('envelope: a different recipient cannot open it', () => {
  const env = buildEnvelope({ senderPriv: sender, recipientPubKeyHex: recipientPubHex, parts: sampleParts })
  const stranger = PrivateKey.fromRandom()
  assert.equal(openEnvelope(env, stranger), null)
})

test('envelope: plaintext (unencrypted) round-trip', () => {
  const env = buildEnvelope({ senderPriv: sender, recipientPubKeyHex: recipientPubHex, parts: [{ kind: 'text', text: 'public note' }], encrypt: false })
  const opened = openEnvelope(env, PrivateKey.fromRandom()) // anyone can read a plaintext envelope
  assert.ok(opened)
  assert.equal(opened!.encrypted, false)
  assert.equal(opened!.senderPubKeyHex, senderPubHex)
  assert.deepEqual(opened!.parts, [{ kind: 'text', text: 'public note' }])
})

test('envelope: a key-only message (the encrypted-content delivery case)', () => {
  const contentKey = [...Hash.sha256([0xde, 0xad, 0xbe, 0xef])]
  const env = buildEnvelope({ senderPriv: sender, recipientPubKeyHex: recipientPubHex, parts: [{ kind: 'key', key: contentKey }] })
  const opened = openEnvelope(env, recipient)
  assert.ok(opened)
  const keyPart = opened!.parts.find(p => p.kind === 'key')
  assert.ok(keyPart && keyPart.kind === 'key')
  assert.deepEqual(keyPart.key, contentKey)
})
