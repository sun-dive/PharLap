// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey } from '@bsv/sdk'
import {
  buildStorefrontScript, parseStorefrontScript,
  encodeStorefrontFields, decodeStorefrontFields,
  classifyRecord, RECORD_STOREFRONT,
  type StorefrontFields,
} from '../src/tokenCodec.ts'

const publisher = PrivateKey.fromRandom()
const publisherPub = publisher.toPublicKey().toString()
const coverBytes = Array.from({ length: 512 }, (_, i) => (i * 7 + 3) & 0xff)

test('storefront with cover image: fields round-trip through the PushDrop', () => {
  const sf: StorefrontFields = {
    description: 'A tokenized eBook — holders unlock the full PDF.',
    coverMimeType: 'image/png',
    coverFileName: 'cover.png',
    coverBytes,
  }
  const parsed = parseStorefrontScript(buildStorefrontScript(publisherPub, sf))
  assert.ok(parsed)
  assert.equal(parsed!.publisherPubKeyHex, publisherPub)
  assert.equal(parsed!.fields.description, sf.description)
  assert.equal(parsed!.fields.coverMimeType, 'image/png')
  assert.equal(parsed!.fields.coverFileName, 'cover.png')
  assert.deepEqual(parsed!.fields.coverBytes, coverBytes)
})

test('storefront without a cover: description-only round-trips, cover fields undefined', () => {
  const sf: StorefrontFields = { description: 'Just a blurb, no cover art.' }
  const parsed = parseStorefrontScript(buildStorefrontScript(publisherPub, sf))
  assert.ok(parsed)
  assert.equal(parsed!.fields.description, sf.description)
  assert.equal(parsed!.fields.coverMimeType, undefined)
  assert.equal(parsed!.fields.coverFileName, undefined)
  assert.equal(parsed!.fields.coverBytes, undefined)
})

test('storefront with empty description (cover only) decodes to empty string, not a null char', () => {
  const sf: StorefrontFields = {
    description: '',
    coverMimeType: 'image/jpeg', coverFileName: 'art.jpg', coverBytes,
  }
  const parsed = parseStorefrontScript(buildStorefrontScript(publisherPub, sf))
  assert.ok(parsed)
  assert.equal(parsed!.fields.description, '')
  assert.deepEqual(parsed!.fields.coverBytes, coverBytes)
})

test('a storefront output classifies as RECORD_STOREFRONT (0x06)', () => {
  const script = buildStorefrontScript(publisherPub, { description: 'hi' })
  assert.equal(classifyRecord(script), RECORD_STOREFRONT)
})

test('decodeStorefrontFields rejects too-few fields', () => {
  assert.equal(decodeStorefrontFields(encodeStorefrontFields({ description: 'x' }).slice(0, 5)), null)
})
