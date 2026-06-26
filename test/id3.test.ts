import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseId3Pictures } from '../src/id3.ts'

const str = (s: string): number[] => Array.from(new TextEncoder().encode(s))
const syncsafeBytes = (n: number): number[] => [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]
const u32bytes = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

// APIC frame body: encoding(0=latin1) + mime + 0x00 + pictureType + description + 0x00 + data
const apicBody = (mime: string, type: number, desc: string, data: number[]): number[] =>
  [0, ...str(mime), 0, type, ...str(desc), 0, ...data]

function id3 (major: 3 | 4, frames: { id: string; body: number[] }[]): number[] {
  let fb: number[] = []
  for (const f of frames) {
    const sz = major >= 4 ? syncsafeBytes(f.body.length) : u32bytes(f.body.length)
    fb = fb.concat([...str(f.id), ...sz, 0, 0, ...f.body])
  }
  return [0x49, 0x44, 0x33, major, 0, 0, ...syncsafeBytes(fb.length), ...fb]
}

test('parses an ID3v2.3 APIC front cover', () => {
  const data = [1, 2, 3, 4, 5]
  const pics = parseId3Pictures(id3(3, [{ id: 'APIC', body: apicBody('image/jpeg', 3, 'cover', data) }]))
  assert.equal(pics.length, 1)
  assert.equal(pics[0].pictureType, 3)
  assert.equal(pics[0].mimeType, 'image/jpeg')
  assert.deepEqual(pics[0].data, data)
})

test('parses ID3v2.4 (syncsafe frame size) and skips non-APIC frames', () => {
  const front = [9, 9, 9], back = [7, 7]
  const pics = parseId3Pictures(id3(4, [
    { id: 'TIT2', body: [0, ...str('Song Title')] },        // a text frame — must be skipped
    { id: 'APIC', body: apicBody('image/png', 3, '', front) },
    { id: 'APIC', body: apicBody('image/png', 4, 'back', back) },
  ]))
  assert.equal(pics.length, 2)
  assert.equal(pics[0].mimeType, 'image/png'); assert.deepEqual(pics[0].data, front)
  assert.equal(pics[1].pictureType, 4); assert.deepEqual(pics[1].data, back)
})

test('normalizes short MIME / format strings', () => {
  const pics = parseId3Pictures(id3(3, [{ id: 'APIC', body: apicBody('JPG', 3, '', [1, 2]) }]))
  assert.equal(pics[0].mimeType, 'image/jpeg')
})

test('returns [] for non-ID3 input', () => {
  assert.deepEqual(parseId3Pictures([0xff, 0xfb, 0, 0, 0, 0, 0, 0, 0, 0]), []) // a bare MP3 frame header, no ID3
  assert.deepEqual(parseId3Pictures([1, 2, 3]), [])
})
