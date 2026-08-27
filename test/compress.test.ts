// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compressIfSmaller, decompress } from '../src/compress.ts'

test('compress: shrinks repetitive data and round-trips it exactly', async () => {
  const data = Array.from(new TextEncoder().encode('SMART NFTs — built on Bitcoin SV. '.repeat(40)))
  const c = await compressIfSmaller(data)
  assert.equal(c.compressed, true)
  assert.ok(c.bytes.length < data.length)
  assert.deepEqual(await decompress(c.bytes), data) // lossless round-trip
})

test('compress: tiny payloads stay raw (gzip overhead would only enlarge them)', async () => {
  const tiny = [0x53, 0x56, 0x21, 0x42] // < MIN_COMPRESS
  const c = await compressIfSmaller(tiny)
  assert.equal(c.compressed, false)
  assert.deepEqual(c.bytes, tiny)
})

test('compress: keep-if-smaller guarantee — output is never larger than input', async () => {
  // A non-repetitive blob gzip can't beat → must be returned uncompressed (not enlarged).
  const blob = Array.from({ length: 512 }, (_, i) => (i * 2654435761) & 0xff)
  const c = await compressIfSmaller(blob)
  assert.ok(c.bytes.length <= blob.length)
  if (c.compressed) assert.deepEqual(await decompress(c.bytes), blob)
  else assert.deepEqual(c.bytes, blob)
})
