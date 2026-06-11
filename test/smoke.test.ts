/**
 * Phase 0 smoke test — confirms the test runner + toolchain work end to end:
 *   - Node 26 runs .ts files directly (native type stripping, no build step)
 *   - @bsv/sdk imports as ESM and its crypto primitives behave
 *
 * Run with:  npm test   (alias for `node --test`)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hash } from '@bsv/sdk'

const toHex = (bytes: number[]): string =>
  bytes.map(b => b.toString(16).padStart(2, '0')).join('')

test('toolchain: Node runs TypeScript without a build step', () => {
  const x: number = 41 + 1
  assert.equal(x, 42)
})

test('@bsv/sdk: SHA-256("abc") matches the known vector', () => {
  // "abc" => ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  const digest = Hash.sha256([0x61, 0x62, 0x63])
  assert.equal(
    toHex(digest),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})
