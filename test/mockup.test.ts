/**
 * Mockup cover manifest + prop descriptor codec (offline).
 *
 *  - packed cover round-trips (txid refs, set-index refs, place, warp override) and hits the spec byte sizes
 *  - warp params survive quantization within tolerance; unknown warp types round-trip via raw bytes
 *  - JSON shorthand ⇄ packed; prop descriptor JSON round-trips; isMockup detects the record
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  packCover, parseCover, coverFromJson, coverToJson,
  propFromJson, propToJson, isMockup, MOCKUP_MIME,
  type MockupCover,
} from '../src/mockup.ts'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

test('cover: minimal (two txids) round-trips and is exactly 67 bytes', () => {
  const c: MockupCover = { version: 1, prop: { tx: A, index: null }, design: { tx: B, index: null }, place: null, warp: null }
  const packed = packCover(c)
  assert.equal(packed.length, 67) // TAG + VERSION + FLAGS + 32 + 32
  const back = parseCover(packed)
  assert.deepEqual(back, c)
})

test('cover: an EMBEDDED design (the storefront cover) drops the design ref — prop-txid only = 35 bytes', () => {
  const c: MockupCover = { version: 1, prop: { tx: A, index: null }, design: null, place: null, warp: null }
  const packed = packCover(c)
  assert.equal(packed.length, 35) // TAG + VERSION + FLAGS + prop 32
  const back = parseCover(packed)
  assert.deepEqual(back, c)
  assert.equal(back!.design, null)
})

test('cover: set-index refs collapse to 7 bytes', () => {
  const c: MockupCover = { version: 1, prop: { tx: null, index: 3 }, design: { tx: null, index: 7 }, place: null, warp: null }
  const packed = packCover(c)
  assert.equal(packed.length, 7) // TAG + VERSION + FLAGS + u16 + u16
  assert.deepEqual(parseCover(packed), c)
})

test('cover: place adds 7 bytes and round-trips within quantization tolerance', () => {
  const c: MockupCover = {
    version: 1, prop: { tx: A, index: null }, design: { tx: B, index: null },
    place: { x: 0.5, y: 0.46, scale: 0.9, rot: 90 }, warp: null,
  }
  const packed = packCover(c)
  assert.equal(packed.length, 67 + 7)
  const back = parseCover(packed)!
  assert.ok(Math.abs(back.place!.x - 0.5) < 1e-4)
  assert.ok(Math.abs(back.place!.y - 0.46) < 1e-4)
  assert.ok(Math.abs(back.place!.scale - 0.9) < 1e-3)
  assert.ok(Math.abs(back.place!.rot - 90) < 1.5) // u8 over 360°
})

test('cover: a cyl warp override round-trips (params within quantization tolerance), adds 6 bytes', () => {
  const c: MockupCover = {
    version: 1, prop: { tx: A, index: null }, design: { tx: B, index: null }, place: null,
    warp: [{ t: 'cyl', curve: 0.62, bow: 0.16, axis: 0 }],
  }
  const packed = packCover(c)
  assert.equal(packed.length, 67 + 6) // count(1) + id(1) + plen(1) + 3 params
  const back = parseCover(packed)!
  assert.equal(back.warp!.length, 1)
  const s = back.warp![0]
  assert.equal(s.t, 'cyl')
  assert.ok(Math.abs((s.curve as number) - 0.62) < 0.004)
  assert.ok(Math.abs((s.bow as number) - 0.16) < 0.008)
  assert.equal(s.axis, 0)
})

test('cover: an unknown/variable warp type (mesh) round-trips via raw bytes', () => {
  const c: MockupCover = {
    version: 1, prop: { tx: A, index: null }, design: { tx: B, index: null }, place: null,
    warp: [{ t: 'mesh', raw: [2, 2, 10, 250, 5, 5] }],
  }
  const back = parseCover(packCover(c))!
  assert.equal(back.warp![0].t, 'mesh')
  assert.deepEqual(back.warp![0].raw, [2, 2, 10, 250, 5, 5])
})

test('cover: a two-stage pipeline (disp then cyl) round-trips in order', () => {
  const c: MockupCover = {
    version: 1, prop: { tx: A, index: null }, design: { tx: B, index: null }, place: null,
    warp: [{ t: 'disp', str: 14, map: 0 }, { t: 'cyl', curve: 0.12, bow: 0, axis: 0 }],
  }
  const back = parseCover(packCover(c))!
  assert.equal(back.warp!.length, 2)
  assert.equal(back.warp![0].t, 'disp')
  assert.ok(Math.abs((back.warp![0].str as number) - 14) < 0.3) // q4: 0.25px steps
  assert.equal(back.warp![1].t, 'cyl')
})

test('cover: JSON shorthand ⇄ packed', () => {
  const c = coverFromJson({ v: 1, p: A, d: B, P: [0.5, 0.46, 0.9, 0], w: [{ t: 'cyl', curve: 0.62, bow: 0.16, axis: 0 }] })
  const back = parseCover(packCover(c))!
  const json = coverToJson(back)
  assert.equal(json.p, A)
  assert.equal(json.d, B)
  assert.equal((json.P as number[]).length, 4)
  assert.equal((json.w as any[])[0].t, 'cyl')
})

test('isMockup detects by mime and by the leading tag byte', () => {
  const packed = packCover({ version: 1, prop: { tx: A, index: null }, design: { tx: B, index: null }, place: null, warp: null })
  assert.equal(isMockup(MOCKUP_MIME), true)
  assert.equal(isMockup(null, packed), true)
  assert.equal(isMockup('image/png', [0x89, 0x50]), false)
})

test('parseCover rejects non-mockup bytes', () => {
  assert.equal(parseCover([0x89, 0x50, 0x4e, 0x47]), null)
  assert.equal(parseCover([]), null)
})

test('prop descriptor JSON round-trips', () => {
  const json = {
    v: 1,
    print: [[0.30, 0.34], [0.66, 0.34], [0.66, 0.72], [0.30, 0.72]],
    warp: [{ t: 'cyl', curve: 0.62, bow: 0.16 }],
    roles: { base: 'mug.webp', shade: 'mug-shade.webp' },
    meta: { name: 'white-mug-11oz', wmm: 200, hmm: 93 },
  }
  const p = propFromJson(json)!
  assert.ok(p)
  assert.equal(p.print.length, 4)
  assert.equal(p.warp[0].t, 'cyl')
  assert.equal(p.roles.base, 'mug.webp')
  const round = propToJson(p)
  assert.deepEqual(round.print, json.print)
  assert.equal((round.meta as any).name, 'white-mug-11oz')
})

test('propFromJson rejects a bad print quad', () => {
  assert.equal(propFromJson({ v: 1, print: [[0, 0], [1, 1]] }), null)
})
