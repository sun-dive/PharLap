import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packAlbum, parseAlbum, isAlbum, ALBUM_MIME, MAX_ALBUM_TRACKS } from '../src/album.ts'

test('packAlbum → parseAlbum round-trips tracks exactly', () => {
  const tracks = [
    { name: '01 Intro.mp3', mimeType: 'audio/mpeg', bytes: [1, 2, 3, 4, 5] },
    { name: '02 Verse.mp3', mimeType: 'audio/mpeg', bytes: [] },                 // empty track
    { name: '03 Outro.opus', mimeType: 'audio/ogg', bytes: [255, 0, 128, 64] },
  ]
  const packed = packAlbum(tracks)
  assert.ok(isAlbum(ALBUM_MIME))
  assert.ok(isAlbum(null, packed))            // detectable by magic bytes too
  const out = parseAlbum(packed)
  assert.deepEqual(out, tracks)
})

test('parseAlbum rejects non-container and truncated data', () => {
  assert.equal(parseAlbum([0, 1, 2, 3]), null)                 // no magic
  assert.equal(parseAlbum([0x50, 0x4c, 0x45, 0x50]), null)     // magic only, too short
  const packed = packAlbum([{ name: 'a', mimeType: 'audio/mpeg', bytes: [9, 9, 9, 9] }])
  assert.equal(parseAlbum(packed.slice(0, packed.length - 2)), null) // truncated track bytes
})

test('packAlbum enforces track count bounds', () => {
  assert.throws(() => packAlbum([]))
  const many = Array.from({ length: MAX_ALBUM_TRACKS + 1 }, (_, i) => ({ name: `${i}`, mimeType: 'audio/mpeg', bytes: [i] }))
  assert.throws(() => packAlbum(many))
})

test('handles large byte values and preserves order', () => {
  const tracks = Array.from({ length: 4 }, (_, i) => ({
    name: `track-${i}`, mimeType: 'audio/mpeg', bytes: [i, 200 + i, 0, 255],
  }))
  const out = parseAlbum(packAlbum(tracks))
  assert.deepEqual(out?.map(t => t.name), ['track-0', 'track-1', 'track-2', 'track-3'])
})
