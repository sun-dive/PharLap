/**
 * BMF manifest parsing — the JSON (on-chain txid) form and the LRC-style cue form, plus detection.
 * Run with:  npm test   (alias for `node --test`)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBmf, parseBmf, fmtLrcTime } from '../src/bmf.ts'

const toBytes = (s: string): number[] => Array.from(new TextEncoder().encode(s))
const TX = 'a'.repeat(64)
const TX2 = 'b'.repeat(64)

test('parseBmf: JSON form resolves audio + timed scenes, sorted by t', () => {
  const j = JSON.stringify({
    bmf: 0,
    audio: { tx: TX, name: 'supersonic.flac' },
    tempo: 110,
    scenes: [
      { t: 4.36, tx: TX2, name: 'b.webp' },
      { t: 0, tx: TX, name: 'a.webp' },
    ],
  })
  const m = parseBmf(toBytes(j))
  assert.ok(m != null)
  assert.equal(m!.audio!.tx, TX)
  assert.equal(m!.audio!.name, 'supersonic.flac')
  assert.equal(m!.tempo, 110)
  assert.equal(m!.scenes.length, 2)
  assert.equal(m!.scenes[0].t, 0)        // sorted
  assert.equal(m!.scenes[1].name, 'b.webp')
})

test('parseBmf: an outpoint "txid:vout" resolves to the genesis txid', () => {
  const m = parseBmf(toBytes(JSON.stringify({ bmf: 0, scenes: [{ t: 0, tx: `${TX}:0`, name: 'x.webp' }] })))
  assert.equal(m!.scenes[0].tx, TX)
})

test('parseBmf: a non-hex tx becomes null (local/name-only reference)', () => {
  const m = parseBmf(toBytes(JSON.stringify({ bmf: 0, scenes: [{ t: 0, tx: 'nope', name: 'x.webp' }] })))
  assert.equal(m!.scenes[0].tx, null)
})

test('parseBmf: cue form parses headers + [mm:ss.cc]name lines', () => {
  const cue = '# bmf: 0\n# audio: supersonic.flac\n# tempo: 110\n[00:00.00]a.webp\n[00:04.36]b.webp\n'
  const m = parseBmf(toBytes(cue))
  assert.ok(m != null)
  assert.equal(m!.audio!.name, 'supersonic.flac')
  assert.equal(m!.audio!.tx, null)
  assert.equal(m!.tempo, 110)
  assert.equal(m!.scenes.length, 2)
  assert.equal(Math.round(m!.scenes[1].t * 100), 436)
})

test('parseBmf: rejects non-manifests', () => {
  assert.equal(parseBmf(toBytes('just some text')), null)
  assert.equal(parseBmf(toBytes('{}')), null)
  assert.equal(parseBmf(toBytes('{ bad json')), null)
})

test('isBmf: detects by mime, JSON content, and cue header', () => {
  assert.equal(isBmf('application/x.bmf'), true)
  assert.equal(isBmf(null, toBytes('{ "bmf": 0, "scenes": [] }')), true)
  assert.equal(isBmf(null, toBytes('# bmf: 0\n[00:00.00]a.webp')), true)
  assert.equal(isBmf('image/webp', toBytes('RIFF....WEBP')), false)
  assert.equal(isBmf(null, toBytes('# just a normal cue\n[00:00.00]a.webp')), false)
})

test('fmtLrcTime: seconds → mm:ss.cc with carry', () => {
  assert.equal(fmtLrcTime(0), '00:00.00')
  assert.equal(fmtLrcTime(4.36), '00:04.36')
  assert.equal(fmtLrcTime(65.5), '01:05.50')
})
