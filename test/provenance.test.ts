// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
// Provenance: for PUBLIC content, fileHash commits to the ORIGINAL plaintext (not the stored, compressed
// blob), so an on-chain object is a provable "timestamped exact replica" of an off-chain file. A verifier
// decompresses the on-chain bytes and matches H(plaintext); because DEFLATE decompression is deterministic,
// the proof is independent of the (non-reproducible) gzip encoding. This mirrors what editionBuilder writes
// and what app.ts onView verifies, without needing a WalletProvider.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, Hash, Utils } from '@bsv/sdk'
import { compressIfSmaller, decompress } from '../src/compress.ts'
import {
  buildTemplateScript, parseTemplateScript, buildFileScript, parseFileScript,
  encodeTokenRules, decodeTokenRules, RESTRICTION_COMPRESSED,
} from '../src/tokenCodec.ts'

const sha = (b: number[]) => Utils.toHex(Hash.sha256(b))
const publisher = PrivateKey.fromRandom().toPublicKey().toString()
const plaintext = Utils.toArray('The quick brown fox. '.repeat(120), 'utf8') as number[] // compressible

test('public content: fileHash binds the original plaintext, and the on-chain blob round-trips to it', async () => {
  // Build side (mirrors editionBuilder, public branch): compress, store the blob, commit to the PLAINTEXT.
  const z = await compressIfSmaller(plaintext)
  assert.equal(z.compressed, true, 'payload should actually compress for this test to be meaningful')
  assert.notDeepEqual(z.bytes, plaintext, 'stored blob differs from plaintext')
  const fileHash = sha(plaintext) // ← the rule: public → plaintext, NOT sha(z.bytes)

  const template = buildTemplateScript(publisher, {
    tokenName: 'Notarized doc',
    tokenRules: encodeTokenRules(0, 0, RESTRICTION_COMPRESSED, 1),
    covenantScript: '', fileHash,
  })
  const fileOut = buildFileScript(publisher, { mimeType: 'text/plain', fileName: 'doc.txt', fileBytes: z.bytes })

  // Read side (mirrors app.ts onView, public branch): parse, unwind, verify the recovered plaintext.
  const t = parseTemplateScript(template)!.fields
  const f = parseFileScript(fileOut)!.fields
  const recovered = decodeTokenRules(t.tokenRules).isCompressed ? await decompress(f.fileBytes) : f.fileBytes

  assert.deepEqual(recovered, plaintext, 'on-chain blob decompresses to the exact original')
  assert.equal(sha(recovered), t.fileHash, '✓ verified exact replica: H(recovered plaintext) == on-chain commitment')
  // And confirm the commitment is to plaintext, not the stored blob (the old, encoding-dependent behavior).
  assert.notEqual(t.fileHash, sha(f.fileBytes), 'commitment is NOT the hash of the compressed blob')
})
