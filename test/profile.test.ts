// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey } from '@bsv/sdk'
import {
  buildProfileScript, parseProfileScript, encodeProfileFields, decodeProfileFields,
  classifyRecord, RECORD_PROFILE, type ProfileFields,
} from '../src/tokenCodec.ts'

const owner = PrivateKey.fromRandom()
const ownerPub = owner.toPublicKey().toString()
const avatarBytes = Array.from({ length: 1500 }, (_, i) => (i * 13 + 7) & 0xff) // ~a small webp

test('profile (alias + avatar): round-trips through the PushDrop and classifies as RECORD_PROFILE', () => {
  const p: ProfileFields = { alias: 'john123', avatarMimeType: 'image/webp', avatarBytes }
  const script = buildProfileScript(ownerPub, p)
  assert.equal(classifyRecord(script), RECORD_PROFILE)
  const parsed = parseProfileScript(script)
  assert.ok(parsed)
  assert.equal(parsed!.ownerPubKeyHex, ownerPub)
  assert.equal(parsed!.fields.alias, 'john123')
  assert.equal(parsed!.fields.avatarMimeType, 'image/webp')
  assert.deepEqual(parsed!.fields.avatarBytes, avatarBytes)
})

test('profile: alias-only (no avatar) round-trips with avatar fields absent', () => {
  const parsed = decodeProfileFields(encodeProfileFields({ alias: 'bob' }))
  assert.ok(parsed)
  assert.equal(parsed!.alias, 'bob')
  assert.equal(parsed!.avatarMimeType, undefined)
  assert.equal(parsed!.avatarBytes, undefined)
})

test('profile: avatar-only (no alias) round-trips with alias absent', () => {
  const parsed = decodeProfileFields(encodeProfileFields({ avatarMimeType: 'image/webp', avatarBytes }))
  assert.ok(parsed)
  assert.equal(parsed!.alias, undefined)
  assert.deepEqual(parsed!.avatarBytes, avatarBytes)
})
