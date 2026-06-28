import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packManifest, parseManifest, isManifest, MANIFEST_MIME, MAX_MANIFEST_REFS, type ManifestRef } from '../src/refManifest.ts'

const ID_A = 'a'.repeat(64), ID_B = 'b'.repeat(64)
const H_A = '1'.repeat(64), H_B = '2'.repeat(64)
const refs: ManifestRef[] = [
  { id: ID_A, hash: H_A, name: 'Track 1', mimeType: 'audio/flac' },
  { id: ID_B, hash: H_B, name: 'Track 2', mimeType: 'audio/mpeg' },
]

test('pack → parse round-trips references in order', () => {
  const out = parseManifest(packManifest(refs))
  assert.deepEqual(out, refs)
})

test('isManifest detects the MIME and the PREF magic', () => {
  const bytes = packManifest(refs)
  assert.equal(isManifest(MANIFEST_MIME), true)
  assert.equal(isManifest(null, bytes), true)
  assert.equal(isManifest('audio/flac'), false)
  assert.equal(isManifest(null, [1, 2, 3, 4]), false)
})

test('uppercase txid/hash input is normalised to lowercase', () => {
  const out = parseManifest(packManifest([{ id: ID_A.toUpperCase(), hash: H_A.toUpperCase(), name: 'x', mimeType: 'audio/flac' }]))
  assert.equal(out?.[0].id, ID_A)
  assert.equal(out?.[0].hash, H_A)
})

test('rejects empty and over-cap packing', () => {
  assert.throws(() => packManifest([]))
  const many = Array.from({ length: MAX_MANIFEST_REFS + 1 }, () => refs[0])
  assert.throws(() => packManifest(many))
})

test('rejects non-64-hex id or hash at pack time', () => {
  assert.throws(() => packManifest([{ id: 'nope', hash: H_A, name: 'x', mimeType: 'audio/flac' }]))
  assert.throws(() => packManifest([{ id: ID_A, hash: 'short', name: 'x', mimeType: 'audio/flac' }]))
})

test('a malformed pointer rejects the whole manifest at parse', () => {
  // hand-build a manifest whose JSON has one bad id
  const bad = { v: 1, refs: [{ i: ID_A, h: H_A, n: 'ok', m: 'audio/flac' }, { i: 'BAD', h: H_B, n: 'bad', m: 'audio/flac' }] }
  const headerBytes = Array.from(new TextEncoder().encode(JSON.stringify(bad)))
  const len = headerBytes.length
  const bytes = [0x50, 0x52, 0x45, 0x46, 1, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...headerBytes]
  assert.equal(parseManifest(bytes), null)
})

test('returns null for non-manifest / truncated bytes', () => {
  assert.equal(parseManifest([1, 2, 3]), null)
  assert.equal(parseManifest([...new TextEncoder().encode('PLEP')]), null) // album magic, not manifest
  const valid = packManifest(refs)
  assert.equal(parseManifest(valid.slice(0, valid.length - 2)), null) // truncated header
})
