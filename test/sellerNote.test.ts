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

test('note carries an optional link bonus through the PushDrop', () => {
  const parsed = parseNoteScript(buildNoteScript(sellerPub, {
    collectionRef, text: 'Thanks!', bonusKind: 'link', bonusValue: 'https://seller.example/claim',
  }))
  assert.ok(parsed)
  assert.equal(parsed!.fields.bonusKind, 'link')
  assert.equal(parsed!.fields.bonusValue, 'https://seller.example/claim')
})

test('note carries an optional code bonus; a note with no bonus has undefined bonus fields', () => {
  const withCode = parseNoteScript(buildNoteScript(sellerPub, { collectionRef, text: '', bonusKind: 'code', bonusValue: 'FREEGIFT' }))
  assert.equal(withCode!.fields.bonusKind, 'code')
  assert.equal(withCode!.fields.bonusValue, 'FREEGIFT')
  const plain = parseNoteScript(buildNoteScript(sellerPub, { collectionRef, text: 'just a note' }))
  assert.equal(plain!.fields.bonusKind, undefined)
  assert.equal(plain!.fields.bonusValue, undefined)
})

test('note carries a heading + tags through the PushDrop', () => {
  const parsed = parseNoteScript(buildNoteScript(sellerPub, {
    collectionRef, text: 'A zip of the app build', heading: 'Phar Lap App — June', tags: ['software', 'phar-lap'],
  }))!
  assert.equal(parsed.fields.heading, 'Phar Lap App — June')
  assert.deepEqual(parsed.fields.tags, ['software', 'phar-lap'])
  assert.equal(parsed.fields.text, 'A zip of the app build')
})

test('note carries heading + tags + bonus together (all typed pairs, any order)', () => {
  const parsed = parseNoteScript(buildNoteScript(sellerPub, {
    collectionRef, text: 'desc', heading: 'Title', tags: ['art', 'music'], bonusKind: 'link', bonusValue: 'https://x/claim',
  }))!
  assert.equal(parsed.fields.heading, 'Title')
  assert.deepEqual(parsed.fields.tags, ['art', 'music'])
  assert.equal(parsed.fields.bonusKind, 'link')
  assert.equal(parsed.fields.bonusValue, 'https://x/claim')
})

test('backward compat: a bonus-only note (no heading/tags) still decodes its bonus', () => {
  const parsed = parseNoteScript(buildNoteScript(sellerPub, { collectionRef, text: 'hi', bonusKind: 'code', bonusValue: 'OLD' }))!
  assert.equal(parsed.fields.bonusKind, 'code')
  assert.equal(parsed.fields.bonusValue, 'OLD')
  assert.equal(parsed.fields.heading, undefined)
  assert.equal(parsed.fields.tags, undefined)
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
