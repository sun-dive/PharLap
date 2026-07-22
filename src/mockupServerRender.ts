// Server-side mockup render — composite a mockup cover to a flat PNG in Node (the Big Red curator), using the
// SHARED renderer (mockupRenderShared.cjs, a copy of Pole Position's mockup-render.js) driven by @napi-rs/canvas.
//
// @napi-rs/canvas is a NATIVE module. It's imported LAZILY (dynamic import, try/caught) so the curator runs
// anywhere: where canvas is present (a dev machine, a capable server) it renders; where it's absent (typical
// shared hosting — no compiler, old glibc) renderMockupCover returns null and the caller keeps the raw preview
// cover. So you can run the curator LOCALLY to render the composites, then deploy covers/ + listings.json.
//
// build-curator.sh marks @napi-rs/canvas --external so esbuild leaves the dynamic import intact.
// This file is imported ONLY by the curator, never by the browser app bundle.
import { parseCover } from './mockup.ts'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — UMD CJS module, no types; esbuild resolves module.exports
import Renderer from './mockupRenderShared.cjs'

interface CanvasLib { createCanvas: (w: number, h: number) => any; loadImage: (b: Buffer) => Promise<any> }
let _lib: CanvasLib | null = null
let _tried = false

/** Load @napi-rs/canvas lazily; returns null if it isn't installed (shared host). Shims document once. */
async function canvasLib(): Promise<CanvasLib | null> {
  if (_tried) return _lib
  _tried = true
  try {
    _lib = (await import('@napi-rs/canvas')) as unknown as CanvasLib
    const g = globalThis as unknown as { document?: unknown }
    if (g.document == null) g.document = { createElement: (t: string) => (t === 'canvas' ? _lib!.createCanvas(1, 1) : {}) }
  } catch { _lib = null }
  return _lib
}

/**
 * Composite a mockup cover → PNG bytes, or null if canvas is unavailable (caller falls back to the raw preview).
 * `base` is the prop base image, `cover` the product's preview design (both raw bytes), `manifest` the packed
 * cover record from TX1. Renders at the prop's native resolution. maps omitted for now (base-only props).
 */
export async function renderMockupCover(base: number[], cover: number[], manifest: number[]): Promise<Uint8Array | null> {
  const lib = await canvasLib()
  if (lib == null) return null
  const mc = parseCover(manifest)
  if (mc == null) return null
  const baseImg = await lib.loadImage(Buffer.from(base))
  const design = await lib.loadImage(Buffer.from(cover))
  const W = baseImg.width, H = baseImg.height
  const p = mc.place
  // place is normalized to the base; box height comes from the design's aspect (only the width is stored).
  const box = p == null ? null : {
    cx: p.x * W, cy: p.y * H,
    w: p.scale * W, h: (p.scale * W) / (design.width / design.height),
    rot: p.rot, skewX: p.skewX, skewY: p.skewY,
  }
  const canvas = lib.createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  Renderer.renderCover(ctx, {
    base: baseImg, design, maps: {}, stageW: W, stageH: H, dpr: 1,
    box, warp: mc.warp ?? [], fabric: p != null ? p.fabric : 0.8,
  })
  return canvas.toBuffer('image/png')
}
