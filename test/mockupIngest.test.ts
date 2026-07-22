/**
 * Mockup-bundle ingest (offline).
 *  - readMockupBundle pulls base/design/maps + recipe from a store-only ZIP
 *  - bundleToManifest maps the recipe → a packed cover manifest (embedded design; place + warp carried)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readMockupBundle, bundleToManifest, type MockupRecipe } from '../src/mockupIngest.ts'
import { parseCover } from '../src/mockup.ts'

// Minimal store-only ZIP writer (local file headers only — all readStoreZip needs).
function storeZip(entries: { name: string; bytes: number[] }[]): number[] {
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff]
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
  const out: number[] = []
  for (const e of entries) {
    const name = [...e.name].map(c => c.charCodeAt(0))
    out.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(e.bytes.length), ...u32(e.bytes.length), ...u16(name.length), ...u16(0), ...name, ...e.bytes)
  }
  return out
}
const jsonBytes = (o: unknown) => Array.from(Buffer.from(JSON.stringify(o), 'utf8'))

test('readMockupBundle: pulls base/design/maps + recipe from a store-only zip', () => {
  const recipe: MockupRecipe = {
    v: 1, prop: { name: 'mug', roles: { base: 'base.webp', mask: 'mask.webp' }, warp: [{ t: 'cyl', curve: 0.6, bow: 0.5, axis: 0 }] },
    design: 'design.webp', place: { cx: 0.5, cy: 0.5, w: 0.6, h: 0.4, rot: 0, skewX: 0, skewY: 0 }, fabric: 1,
  }
  const zip = storeZip([
    { name: 'base.webp', bytes: [1, 2, 3] },
    { name: 'design.webp', bytes: [4, 5, 6] },
    { name: 'mask.webp', bytes: [7, 8] },
    { name: 'mockup.json', bytes: jsonBytes(recipe) },
  ])
  const b = readMockupBundle(zip)!
  assert.ok(b)
  assert.deepEqual(b.base, [1, 2, 3])
  assert.deepEqual(b.design, [4, 5, 6])
  assert.deepEqual(b.maps.mask, [7, 8])
  assert.equal(b.maps.shade, undefined)
  assert.equal(b.recipe.prop!.name, 'mug')
})

test('readMockupBundle: rejects a zip without a mockup.json', () => {
  assert.equal(readMockupBundle(storeZip([{ name: 'base.webp', bytes: [1] }])), null)
  assert.equal(readMockupBundle([1, 2, 3]), null)
})

test('bundleToManifest: recipe → packed manifest (embedded design, place + warp carried)', () => {
  const recipe: MockupRecipe = {
    v: 1, prop: { warp: [{ t: 'cyl', curve: 0.6, bow: 0.5, axis: 0 }] }, design: 'design.webp',
    place: { cx: 0.3, cy: 0.5, w: 0.6, h: 0.4, rot: 0, skewX: -0.2, skewY: 0.1 },
  }
  const txid = 'a'.repeat(64)
  const cover = parseCover(bundleToManifest(recipe, txid))!
  assert.equal(cover.prop.tx, txid)
  assert.equal(cover.design, null) // embedded → the storefront cover
  assert.ok(Math.abs(cover.place!.x - 0.3) < 1e-4)
  assert.ok(Math.abs(cover.place!.scale - 0.6) < 1e-3) // recipe width → manifest scale
  assert.ok(Math.abs(cover.place!.skewX - (-0.2)) < 0.008)
  assert.equal(cover.warp![0].t, 'cyl')
})

test('bundleToManifest: a recipe with no place packs a place-less manifest', () => {
  const cover = parseCover(bundleToManifest({ v: 1, prop: { warp: [] } }, 'b'.repeat(64)))!
  assert.equal(cover.place, null)
})
