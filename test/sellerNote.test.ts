// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey } from '@bsv/sdk'
import {
  buildNoteScript, parseNoteScript, encodeNoteFields, decodeNoteFields,
  classifyRecord, RECORD_NOTE,
} from '../src/tokenCodec.ts'

const seller = PrivateKey.fromRandom()
const sellerPub = seller.toPublicKey().toString()
const collectionRef = 'ab'.repeat(32)

test('note round-trips through the PushDrop with author + collection + text', () => {
  const parsed = parseNoteScript(buildNoteScript(sellerPub, {
    collectionRef, text: 'Bonus: DM me this txid for a signed print 🎁',
  }))
  assert.ok(parsed)
  assert.equal(parsed!.authorPubKeyHex, sellerPub)
  assert.equal(parsed!.fields.collectionRef, collectionRef)
  assert.equal(parsed!.fields.text, 'Bonus: DM me this txid for a signed print 🎁')
})

test('a note output classifies as RECORD_NOTE (0x07)', () => {
  assert.equal(classifyRecord(buildNoteScript(sellerPub, { collectionRef, text: 'hi' })), RECORD_NOTE)
})

test('empty note text decodes to empty string, not a null char', () => {
  const parsed = parseNoteScript(buildNoteScript(sellerPub, { collectionRef, text: '' }))
  assert.ok(parsed)
  assert.equal(parsed!.fields.text, '')
})

test('decodeNoteFields rejects a bad collection ref length', () => {
  const fields = encodeNoteFields({ collectionRef, text: 'x' })
  fields[3] = [1, 2, 3] // not 32 bytes
  assert.equal(decodeNoteFields(fields), null)
})
