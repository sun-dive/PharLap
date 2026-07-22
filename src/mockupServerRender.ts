// Server-side mockup render — composite a mockup cover to a flat PNG in Node (the Big Red curator), using the
// SHARED renderer (mockupRenderShared.cjs, a copy of Pole Position's mockup-render.js) driven by @napi-rs/canvas.
// A tiny document shim lets the unmodified browser renderer run in Node.
//
// @napi-rs/canvas is a NATIVE module → it can't be bundled into the self-contained server-curate.mjs. build-
// curator.sh marks it --external; the curator host installs it in node_modules (prebuilt binary, no compile).
// This file is imported ONLY by the curator, never by the browser app bundle.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { parseCover } from './mockup.ts'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — UMD CJS module, no types; esbuild resolves module.exports
import Renderer from './mockupRenderShared.cjs'

// The renderer's makeCanvas() calls document.createElement('canvas'); give it a Node canvas instead.
const g = globalThis as unknown as { document?: unknown }
if (g.document == null) g.document = { createElement: (t: string) => (t === 'canvas' ? createCanvas(1, 1) : {}) }

/**
 * Composite a mockup cover → PNG bytes. `base` is the prop base image, `cover` is the product's preview design
 * (both raw bytes), `manifest` is the packed cover record from TX1. Renders at the prop's native resolution.
 * Returns null if the manifest doesn't parse. maps are omitted for now (base-only props / procedural warp).
 */
export async function renderMockupCover(base: number[], cover: number[], manifest: number[]): Promise<Uint8Array | null> {
  const mc = parseCover(manifest)
  if (mc == null) return null
  const baseImg = await loadImage(Buffer.from(base))
  const design = await loadImage(Buffer.from(cover))
  const W = baseImg.width, H = baseImg.height
  const p = mc.place
  // place is normalized to the base; box height comes from the design's aspect (only the width is stored).
  const box = p == null ? null : {
    cx: p.x * W, cy: p.y * H,
    w: p.scale * W, h: (p.scale * W) / (design.width / design.height),
    rot: p.rot, skewX: p.skewX, skewY: p.skewY,
  }
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  Renderer.renderCover(ctx, {
    base: baseImg, design, maps: {}, stageW: W, stageH: H, dpr: 1,
    box, warp: mc.warp ?? [], fabric: p != null ? p.fabric : 0.8,
  })
  return canvas.toBuffer('image/png')
}
