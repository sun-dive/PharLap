/**
 * Phase 2 — token codec tests.
 *
 *  - TOKEN / TEMPLATE / FILE field round-trips (both raw encode/decode and through a real
 *    PushDrop locking script).
 *  - record classification (classifyRecord) distinguishes the three types and rejects non-PHAR-LAP scripts.
 *  - tokenRules round-trip incl. flag decoding.
 *  - the documented empty-field quirk (empty stateData round-trips to "00" through a PushDrop script).
 *  - identity sanity: a 32-byte TX1-ref is required and is the Collection ID.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, P2PKH, LockingScript } from '@bsv/sdk'
import {
  P_PREFIX,
  P_VERSION,
  RECORD_TOKEN,
  RECORD_TEMPLATE,
  RECORD_FILE,
  RESTRICTION_FUNGIBLE,
  RESTRICTION_REPLICABLE,
  encodeTokenFields,
  decodeTokenFields,
  buildTokenScript,
  parseTokenScript,
  encodeTemplateFields,
  decodeTemplateFields,
  buildTemplateScript,
  parseTemplateScript,
  encodeFileFields,
  decodeFileFields,
  buildFileScript,
  parseFileScript,
  classifyRecord,
  encodeTokenRules,
  decodeTokenRules,
  collectionId,
} from '../src/tokenCodec.ts'

const KEY = PrivateKey.fromRandom()
const PUB = KEY.toPublicKey().toString()
const TX1 = 'a'.repeat(64) // a 32-byte txid (hex) standing in for the Collection ID

// ─── TOKEN ──────────────────────────────────────────────────────────

test('TOKEN: raw encode/decode round-trip', () => {
  const data = { tx1Ref: TX1, stateData: 'deadbeef' }
  const decoded = decodeTokenFields(encodeTokenFields(data))
  assert.deepEqual(decoded, data)
})

test('TOKEN: build/parse through a real PushDrop script', () => {
  const data = { tx1Ref: TX1, stateData: 'cafe' }
  const parsed = parseTokenScript(buildTokenScript(PUB, data))
  assert.ok(parsed)
  assert.equal(parsed.ownerPubKeyHex, PUB)
  assert.deepEqual(parsed.fields, data)
})

test('TOKEN: empty stateData round-trips to "00" through a PushDrop script (documented quirk)', () => {
  // Raw encode/decode keeps it empty…
  assert.equal(decodeTokenFields(encodeTokenFields({ tx1Ref: TX1, stateData: '' }))?.stateData, '')
  // …but through PushDrop minimal-push, empty -> OP_0 -> [0] -> "00".
  const parsed = parseTokenScript(buildTokenScript(PUB, { tx1Ref: TX1, stateData: '' }))
  assert.equal(parsed?.fields.stateData, '00')
})

test('TOKEN: rejects a TX1-ref that is not 32 bytes', () => {
  const badFields = encodeTokenFields({ tx1Ref: 'abcd', stateData: '00' }) // 2-byte ref
  assert.equal(decodeTokenFields(badFields), null)
})

test('collectionId is the TX1-ref', () => {
  assert.equal(collectionId(TX1), TX1)
})

// ─── TEMPLATE ───────────────────────────────────────────────────────

test('TEMPLATE: round-trip with covenant + fileHash', () => {
  const data = {
    tokenName: 'PHAR LAP Editions',
    tokenRules: encodeTokenRules(0, 0, RESTRICTION_REPLICABLE, 1),
    covenantScript: '51', // OP_1 placeholder
    fileHash: 'b'.repeat(64),
  }
  const parsed = parseTemplateScript(buildTemplateScript(PUB, data))
  assert.ok(parsed)
  assert.equal(parsed.publisherPubKeyHex, PUB)
  assert.deepEqual(parsed.fields, data)
})

test('TEMPLATE: round-trip with no covenant and no file', () => {
  const data = {
    tokenName: 'Plain',
    tokenRules: encodeTokenRules(1, 0, 0, 1),
    covenantScript: '',
  }
  const parsed = parseTemplateScript(buildTemplateScript(PUB, data))
  assert.ok(parsed)
  assert.equal(parsed.fields.tokenName, 'Plain')
  assert.equal(parsed.fields.covenantScript, '') // empty covenant normalizes back to ''
  assert.equal(parsed.fields.fileHash, undefined)
})

// ─── FILE ───────────────────────────────────────────────────────────

test('FILE: round-trip', () => {
  const data = { mimeType: 'image/png', fileName: 'art.png', fileBytes: [0x89, 0x50, 0x4e, 0x47, 0x00, 0xff] }
  const parsed = parseFileScript(buildFileScript(PUB, data))
  assert.ok(parsed)
  assert.deepEqual(parsed.fields, data)
})

// ─── classifyRecord ─────────────────────────────────────────────────

test('classifyRecord distinguishes record types and rejects non-PHAR-LAP scripts', () => {
  assert.equal(classifyRecord(buildTokenScript(PUB, { tx1Ref: TX1, stateData: '00' })), RECORD_TOKEN)
  assert.equal(
    classifyRecord(buildTemplateScript(PUB, { tokenName: 'x', tokenRules: encodeTokenRules(1, 0, 0, 1), covenantScript: '' })),
    RECORD_TEMPLATE,
  )
  assert.equal(
    classifyRecord(buildFileScript(PUB, { mimeType: 't', fileName: 'f', fileBytes: [1, 2, 3] })),
    RECORD_FILE,
  )
  assert.equal(classifyRecord(new P2PKH().lock(KEY.toAddress()) as LockingScript), null)
})

// ─── tokenRules ─────────────────────────────────────────────────────

test('tokenRules: round-trip and flag decoding', () => {
  const hex = encodeTokenRules(0, 3, RESTRICTION_FUNGIBLE | RESTRICTION_REPLICABLE, 2)
  const r = decodeTokenRules(hex)
  assert.equal(r.supply, 0)
  assert.equal(r.divisibility, 3)
  assert.equal(r.version, 2)
  assert.equal(r.isFungible, true)
  assert.equal(r.isReplicable, true)
  assert.equal(r.isUnlimited, true) // supply 0 => unlimited

  const r2 = decodeTokenRules(encodeTokenRules(100, 0, 0, 1))
  assert.equal(r2.isFungible, false)
  assert.equal(r2.isReplicable, false)
  assert.equal(r2.isUnlimited, false)
})

test('prefix/version constants are as specified ("P" 0x50 / v0x03)', () => {
  assert.deepEqual(P_PREFIX, [0x50])
  assert.equal(P_VERSION, 0x03)
})
