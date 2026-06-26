import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFlacPictures } from '../src/flacMeta.ts'

const u32be = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const str = (s: string): number[] => Array.from(new TextEncoder().encode(s))

function pictureBlock(pictureType: number, mime: string, desc: string, data: number[], last: boolean): number[] {
  const body = [
    ...u32be(pictureType),
    ...u32be(str(mime).length), ...str(mime),
    ...u32be(str(desc).length), ...str(desc),
    ...u32be(0), ...u32be(0), ...u32be(0), ...u32be(0), // width, height, depth, colors
    ...u32be(data.length), ...data,
  ]
  return [(last ? 0x80 : 0) | 6, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff, ...body]
}

test('parses FLAC PICTURE blocks (front + back cover) in order', () => {
  const front = [1, 2, 3, 4, 5], back = [9, 8, 7]
  const flac = [0x66, 0x4c, 0x61, 0x43, // "fLaC"
    ...pictureBlock(3, 'image/jpeg', 'Front', front, false),
    ...pictureBlock(4, 'image/jpeg', 'Back', back, true)]
  const pics = parseFlacPictures(flac)
  assert.equal(pics.length, 2)
  assert.equal(pics[0].pictureType, 3); assert.equal(pics[0].mimeType, 'image/jpeg'); assert.deepEqual(pics[0].data, front)
  assert.equal(pics[1].pictureType, 4); assert.deepEqual(pics[1].data, back)
})

test('skips non-PICTURE blocks and stops at the last-block flag', () => {
  const flac = [0x66, 0x4c, 0x61, 0x43,
    0x00, 0x00, 0x00, 0x02, 0xAA, 0xBB,                      // a non-last STREAMINFO-ish block (type 0), len 2
    ...pictureBlock(3, 'image/png', '', [42, 42], true)]
  const pics = parseFlacPictures(flac)
  assert.equal(pics.length, 1)
  assert.equal(pics[0].mimeType, 'image/png'); assert.deepEqual(pics[0].data, [42, 42])
})

test('returns [] for non-FLAC or truncated data', () => {
  assert.deepEqual(parseFlacPictures([0, 1, 2, 3, 4, 5, 6, 7]), [])
  const flac = [0x66, 0x4c, 0x61, 0x43, ...pictureBlock(3, 'image/png', '', [1, 2, 3, 4], true)]
  assert.deepEqual(parseFlacPictures(flac.slice(0, flac.length - 2)), [])
})
