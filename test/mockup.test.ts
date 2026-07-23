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
  packProp, parseProp, isProp, ratioOf, RATIOS, PROP_FIELD,
  type MockupCover, type PropManifest,
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

test('cover: place adds 9 bytes and round-trips (incl. skew) within quantization tolerance', () => {
  const c: MockupCover = {
    version: 1, prop: { tx: A, index: null }, design: { tx: B, index: null },
    place: { x: 0.5, y: 0.46, scale: 0.9, rot: 90, skewX: -0.3, skewY: 0.2, fabric: 1 }, warp: null,
  }
  const packed = packCover(c)
  assert.equal(packed.length, 67 + 10) // x,y,scale u16 + rot u8 + skewX,skewY i8 + fabric u8
  const back = parseCover(packed)!
  assert.ok(Math.abs(back.place!.x - 0.5) < 1e-4)
  assert.ok(Math.abs(back.place!.y - 0.46) < 1e-4)
  assert.ok(Math.abs(back.place!.scale - 0.9) < 1e-3)
  assert.ok(Math.abs(back.place!.rot - 90) < 1.5) // u8 over 360°
  assert.ok(Math.abs(back.place!.skewX - (-0.3)) < 0.008) // i8/127
  assert.ok(Math.abs(back.place!.skewY - 0.2) < 0.008)
  assert.ok(Math.abs(back.place!.fabric - 1) < 0.004) // u8/255
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
  assert.equal((json.P as number[]).length, 7) // x, y, scale, rot, skewX, skewY
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

// ─── canonical socket ratios ─────────────────────────────────────────
test('ratioOf classifies dimensions to the nearest canonical ratio', () => {
  assert.equal(RATIOS[ratioOf(1024, 1024)].name, '1:1')
  assert.equal(RATIOS[ratioOf(1080, 1350)].name, '4:5')   // IG portrait
  assert.equal(RATIOS[ratioOf(1200, 1800)].name, '2:3')   // 2:3 print
  assert.equal(RATIOS[ratioOf(1920, 1080)].name, '16:9')  // wide
  assert.equal(RATIOS[ratioOf(1080, 1920)].name, '9:16')  // phone
  assert.equal(RATIOS[ratioOf(900, 1200)].name, '4:5')    // 3:4 ≈ nearest 4:5 (log-aspect)
})

// ─── PROP manifest (TLV, extensible) ─────────────────────────────────
const DISP = 'c'.repeat(64)

test('prop: full manifest round-trips through packed TLV', () => {
  const p: PropManifest = {
    version: 1, ratio: 1, fabric: 0.83,
    place: { x: 0.5, y: 0.62, scale: 0.4, rot: 0, skewX: 0.1, skewY: -0.05 },
    quad: null,
    warp: [{ t: 'persp', kx: 0.2, ky: -0.1 }, { t: 'cyl', curve: 0.3, bow: 0.1, axis: 0 }],
    disp: { tx: DISP, str: 0.5 }, mask: null, shade: null,
    dims: { wmm: 300, hmm: 375 }, name: 'Tee — front', ext: [],
  }
  const back = parseProp(packProp(p))!
  assert.ok(back)
  assert.equal(back.ratio, 1)
  assert.ok(Math.abs(back.fabric - 0.83) < 0.01)
  assert.ok(Math.abs(back.place!.x - 0.5) < 0.001)
  assert.equal(back.warp!.length, 2)
  assert.equal(back.warp![0].t, 'persp')
  assert.equal(back.disp!.tx, DISP)
  assert.ok(Math.abs(back.disp!.str - 0.5) < 0.01)
  assert.deepEqual(back.dims, { wmm: 300, hmm: 375 })
  assert.equal(back.name, 'Tee — front')
})

test('prop: minimal (ratio + fabric only) is tiny and round-trips', () => {
  const p: PropManifest = { version: 1, ratio: 0, fabric: 0.8, place: null, quad: null, warp: null, disp: null, mask: null, shade: null, dims: null, name: null }
  const packed = packProp(p)
  assert.equal(packed.length, 2 + 3 + 3) // TAG+VER + RATIO block(3) + FABRIC block(3)
  assert.equal(parseProp(packed)!.ratio, 0)
})

test('prop: a QUAD block round-trips its 4 corners', () => {
  const p: PropManifest = { version: 1, ratio: 3, fabric: 0.8, place: null, quad: [[0.1, 0.1], [0.9, 0.12], [0.88, 0.9], [0.12, 0.88]], warp: null, disp: null, mask: null, shade: null, dims: null, name: null }
  const back = parseProp(packProp(p))!
  assert.equal(back.quad!.length, 4)
  assert.ok(Math.abs(back.quad![1][0] - 0.9) < 0.001)
})

test('prop: FORWARD-COMPAT — an unknown block id is skipped, preserved, and known blocks still parse', () => {
  // Simulate a prop minted by a NEWER version carrying a field this parser doesn't know (id 0x7e, 3 bytes)
  // sandwiched between RATIO and FABRIC. Old parser must skip it and still read the known fields.
  const p: PropManifest = { version: 1, ratio: 2, fabric: 0.5, place: null, quad: null, warp: null, disp: null, mask: null, shade: null, dims: null, name: null, ext: [{ id: 0x7e, data: [9, 9, 9] }] }
  const packed = packProp(p)
  const back = parseProp(packed)!
  assert.equal(back.ratio, 2)                       // known field before the unknown still fine
  assert.ok(Math.abs(back.fabric - 0.5) < 0.01)     // known field after the unknown still fine
  assert.deepEqual(back.ext, [{ id: 0x7e, data: [9, 9, 9] }]) // unknown preserved verbatim
  assert.equal(packProp(back).join(','), packed.join(',')) // and re-packs identically (no data loss)
})

test('prop: isProp / isMockup discriminate prop (0x50) vs cover (0x4D)', () => {
  const propBytes = packProp({ version: 1, ratio: 0, fabric: 0.8, place: null, quad: null, warp: null, disp: null, mask: null, shade: null, dims: null, name: null })
  const coverBytes = packCover({ version: 1, prop: { tx: A, index: null }, design: null, place: null, warp: null })
  assert.equal(isProp(propBytes), true)
  assert.equal(isProp(coverBytes), false)
  assert.equal(parseProp(coverBytes), null)   // a cover is not a prop
  assert.equal(parseCover(propBytes), null)   // a prop is not a cover
  assert.equal(isMockup(null, propBytes), true) // both are "mockup" records
  assert.equal(isMockup(null, coverBytes), true)
})
