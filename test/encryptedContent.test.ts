// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, Hash, Utils } from '@bsv/sdk'
import {
  buildTemplateScript, parseTemplateScript, buildFileScript, parseFileScript,
  encodeTokenRules, decodeTokenRules, RESTRICTION_REPLICABLE, RESTRICTION_ENCRYPTED,
  type TemplateFields, type FileFields,
} from '../src/tokenCodec.ts'
import {
  newContentKey, newKeySalt, encryptContent, decryptContent, wrapContentKey, unwrapContentKey, contentHash,
} from '../src/contentCrypto.ts'

const creator = PrivateKey.fromRandom()
const creatorPub = creator.toPublicKey().toString()
const plainFile = Array.from({ length: 1234 }, (_, i) => (i * 9 + 5) & 0xff)

function encryptedTemplate(ciphertext: number[], wrappedKey: number[], keySalt: number[]): TemplateFields {
  return {
    tokenName: 'Secret eBook',
    tokenRules: encodeTokenRules(0, 0, RESTRICTION_REPLICABLE | RESTRICTION_ENCRYPTED, 1),
    covenantScript: '',
    fileHash: contentHash(ciphertext),
    wrappedKey,
    keySalt,
  }
}

test('encrypted template: wrappedKey + keySalt + encrypted flag round-trip through the PushDrop', () => {
  const K = newContentKey(); const keySalt = newKeySalt()
  const ciphertext = encryptContent(plainFile, K)
  const wrappedKey = wrapContentKey(K, keySalt)
  const parsed = parseTemplateScript(buildTemplateScript(creatorPub, encryptedTemplate(ciphertext, wrappedKey, keySalt)))
  assert.ok(parsed)
  assert.deepEqual(parsed!.fields.wrappedKey, wrappedKey)
  assert.deepEqual(parsed!.fields.keySalt, keySalt)
  assert.equal(parsed!.fields.fileHash, contentHash(ciphertext))
  assert.equal(decodeTokenRules(parsed!.fields.tokenRules).isEncrypted, true)
})

test('encrypted content: full viewer path — parse template + FILE, verify hash, unwrap, decrypt', () => {
  const K = newContentKey(); const keySalt = newKeySalt()
  const ciphertext = encryptContent(plainFile, K)
  const wrappedKey = wrapContentKey(K, keySalt)
  const fileFields: FileFields = { mimeType: 'application/pdf', fileName: 'book.pdf', fileBytes: ciphertext }

  // Round-trip through the on-chain scripts, then run exactly what onView does.
  const t = parseTemplateScript(buildTemplateScript(creatorPub, encryptedTemplate(ciphertext, wrappedKey, keySalt)))!
  const f = parseFileScript(buildFileScript(creatorPub, fileFields))!

  assert.equal(t.fields.fileHash, Utils.toHex(Hash.sha256(f.fields.fileBytes))) // ciphertext bound to collection
  assert.equal(decodeTokenRules(t.fields.tokenRules).isEncrypted, true)
  const recoveredK = unwrapContentKey(t.fields.wrappedKey!, t.fields.keySalt!)
  assert.ok(recoveredK)
  assert.deepEqual(decryptContent(f.fields.fileBytes, recoveredK!), plainFile) // back to the original plaintext
})

test('plain (unencrypted) template carries no wrappedKey and isEncrypted=false', () => {
  const template: TemplateFields = {
    tokenName: 'Open collection', tokenRules: encodeTokenRules(1, 0, 0, 1), covenantScript: '', fileHash: 'ab'.repeat(32),
  }
  const t = parseTemplateScript(buildTemplateScript(creatorPub, template))!
  assert.equal(t.fields.wrappedKey, undefined)
  assert.equal(t.fields.keySalt, undefined)
  assert.equal(decodeTokenRules(t.fields.tokenRules).isEncrypted, false)
})
