// ─── Mockup compositor renderer ──────────────────────────────────────────────────────────────────
//
// Composites a design onto a prop per the mockup warp pipeline (see docs/MOCKUP-SPEC.md §3, §6).
// Framework-free, canvas-only — the ONE renderer shared by the POC, Pole Position (authoring/preview),
// Big Red (catalog) and PHAR LAP (sales page). The format codec (pack/parse bytes) is separate
// (src/mockup.ts); this takes an already-decoded cover + loaded prop images and draws pixels.
//
// Pipeline: design → [warp stages, in order] → place on base → × multiply shading. Warping happens on
// an OFFSCREEN canvas, then composites ONCE — never draw warped slices straight under `multiply` (the
// overlap seams double-darken into vertical stripes).
//
// UMD-lite: exposes `window.MockupRender` for a plain <script> (works over file://) and `module.exports`
// for Node/bundlers. No ES `import`/`export` — those are CORS-blocked over file://.

(function (global) {
  'use strict'

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
  function makeCanvas(w, h) {
    const c = document.createElement('canvas')
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0)
    return c
  }

  // ── warp stages ────────────────────────────────────────────────────
  // Each takes a source canvas (pw×ph) and returns a new canvas the same size, so stages compose.

  /** Cylinder wrap (mugs, cans, bottles): horizontal sin() foreshorten + a vertical border bow. */
  function warpCyl(src, p) {
    const pw = src.width, ph = src.height
    const curve = clamp01(p.curve == null ? 0 : p.curve)
    const out = makeCanvas(pw, ph)
    const octx = out.getContext('2d'); octx.imageSmoothingQuality = 'high'
    const A = curve * 1.15 // wrap half-angle (max ~66°)
    if (A < 0.02) { octx.drawImage(src, 0, 0); return out }
    const sinA = Math.sin(A), cosA = Math.cos(A)
    const N = Math.max(96, Math.round(pw / 4))
    const map = (u) => 0.5 + 0.5 * Math.sin((u - 0.5) * 2 * A) / sinA
    const arc = (p.bow == null ? 0 : p.bow) * ph * 0.20 // signed: + = smile (centre dips), − = frown
    const a = Math.abs(arc)
    const nominalH = ph - a
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 1) / N, um = (u0 + u1) / 2
      const phiM = (um - 0.5) * 2 * A
      const t = (1 - Math.cos(phiM)) / (1 - cosA || 1) // 0 centre → 1 edges
      const dX0 = map(u0) * pw, dX1 = map(u1) * pw
      const yTop = arc >= 0 ? a * (1 - t) : a * t
      const sh = nominalH * (1 - 0.10 * curve * t)
      octx.drawImage(src, u0 * pw, 0, Math.max(1, (u1 - u0) * pw), ph, dX0, yTop, (dX1 - dX0) + 1.4, sh)
    }
    return out
  }

  /** Displacement warp (t-shirts, totes, fabric): offset each pixel by the prop's grayscale fold map.
   *  Basic per-pixel version — correct in principle; production may use the map's gradient direction. */
  function warpDisp(src, dispImg, p, dpr) {
    const pw = src.width, ph = src.height
    const dcan = makeCanvas(pw, ph)
    dcan.getContext('2d').drawImage(dispImg, 0, 0, pw, ph)
    const dd = dcan.getContext('2d').getImageData(0, 0, pw, ph).data
    const sd = src.getContext('2d').getImageData(0, 0, pw, ph).data
    const out = makeCanvas(pw, ph)
    const octx = out.getContext('2d')
    const od = octx.createImageData(pw, ph)
    const str = (p.str == null ? 0 : p.str) * (dpr || 1)
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const di = (y * pw + x) * 4
        const lum = dd[di] / 255 - 0.5 // −0.5..0.5
        const ox = Math.max(0, Math.min(pw - 1, Math.round(x + lum * str)))
        const oy = Math.max(0, Math.min(ph - 1, Math.round(y + lum * str)))
        const si = (oy * pw + ox) * 4
        od.data[di] = sd[si]; od.data[di + 1] = sd[si + 1]; od.data[di + 2] = sd[si + 2]; od.data[di + 3] = sd[si + 3]
      }
    }
    octx.putImageData(od, 0, 0)
    return out
  }

  /** Keystone / perspective: taper the width top→bottom (ky) and/or height left→right (kx) so a rectangle
   *  becomes a trapezoid — the illusion of a plane receding in depth (which an affine shear can't give). ky>0 =
   *  top narrower (receding away at the top); kx>0 = left narrower. Two 1-D slice passes approximate the quad. */
  function taperRows(src, ky) {
    const pw = src.width, ph = src.height
    const out = makeCanvas(pw, ph); const octx = out.getContext('2d'); octx.imageSmoothingQuality = 'high'
    // Never scale an edge ABOVE 1 (that would overflow the canvas and clip). Shrink whichever edge recedes:
    // ky>0 narrows the top, ky<0 narrows the bottom; the opposite edge stays full width.
    const topScale = ky > 0 ? 1 - ky * 0.9 : 1
    const botScale = ky < 0 ? 1 + ky * 0.9 : 1
    const N = Math.max(200, Math.round(ph / 2))
    for (let i = 0; i < N; i++) {
      const v0 = i / N, v1 = (i + 1) / N, vm = (v0 + v1) / 2
      const dw = pw * (topScale + (botScale - topScale) * vm)
      octx.drawImage(src, 0, v0 * ph, pw, Math.max(1, (v1 - v0) * ph), (pw - dw) / 2, v0 * ph, dw, (v1 - v0) * ph + 0.6)
    }
    return out
  }
  function taperCols(src, kx) {
    const pw = src.width, ph = src.height
    const out = makeCanvas(pw, ph); const octx = out.getContext('2d'); octx.imageSmoothingQuality = 'high'
    const leftScale = kx > 0 ? 1 - kx * 0.9 : 1
    const rightScale = kx < 0 ? 1 + kx * 0.9 : 1
    const N = Math.max(200, Math.round(pw / 2))
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 1) / N, um = (u0 + u1) / 2
      const dh = ph * (leftScale + (rightScale - leftScale) * um)
      octx.drawImage(src, u0 * pw, 0, Math.max(1, (u1 - u0) * pw), ph, u0 * pw, (ph - dh) / 2, (u1 - u0) * pw + 0.6, dh)
    }
    return out
  }
  function warpKeystone(src, p) {
    let cur = src
    if (Math.abs(p.ky || 0) >= 0.01) cur = taperRows(cur, p.ky)
    if (Math.abs(p.kx || 0) >= 0.01) cur = taperCols(cur, p.kx)
    return cur
  }

  // Supersample the warp: render at SS× the target, so the downscale on composite anti-aliases the strip-slice
  // step edges (the "staircase"). Softens it everywhere — editor and final output — without needing a mask.
  const SS = 2

  /** Run the design through the warp pipeline. Returns an offscreen canvas (w·dpr·SS × h·dpr·SS). */
  function warpDesign(design, w, h, stages, maps, dpr) {
    dpr = dpr || 1
    const s = dpr * SS
    const pw = Math.max(1, Math.round(w * s)), ph = Math.max(1, Math.round(h * s))
    let src = makeCanvas(pw, ph)
    const sctx = src.getContext('2d'); sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(design, 0, 0, pw, ph)
    const list = stages || []
    for (let i = 0; i < list.length; i++) {
      const st = list[i]
      if (st.t === 'cyl') src = warpCyl(src, st)
      else if (st.t === 'persp') src = warpKeystone(src, st)
      else if (st.t === 'disp' && maps && maps.disp) src = warpDisp(src, maps.disp, st, s)
      // flat / not-yet-implemented ids → passthrough (graceful degrade, per spec)
    }
    return src
  }

  /** Clip the warped design to the prop's printable region. The mask is grayscale (white = printable); we turn
   *  its luminance (× any existing alpha) into alpha and destination-in — so the design shows only inside the
   *  print area with a crisp mask edge, hiding the ragged strip-warp boundary. */
  function applyMask(layer, maskImg) {
    const pw = layer.width, ph = layer.height
    const m = makeCanvas(pw, ph); const mctx = m.getContext('2d')
    mctx.drawImage(maskImg, 0, 0, pw, ph)
    const id = mctx.getImageData(0, 0, pw, ph), d = id.data
    for (let i = 0; i < d.length; i += 4) {
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
      d[i + 3] = Math.round(lum * (d[i + 3] / 255))
    }
    mctx.putImageData(id, 0, 0)
    const out = makeCanvas(pw, ph); const octx = out.getContext('2d')
    octx.drawImage(layer, 0, 0)
    octx.globalCompositeOperation = 'destination-in'
    octx.drawImage(m, 0, 0)
    return out
  }

  /** Bake the prop's own lighting into the design: multiply the shade map over it at `strength`, then re-clip to
   *  the design's coverage (multiply can bleed into transparent areas). Used when the prop supplies a shade map
   *  instead of relying on the base beneath. */
  function applyShade(layer, shadeImg, strength) {
    const pw = layer.width, ph = layer.height
    const out = makeCanvas(pw, ph); const octx = out.getContext('2d')
    octx.drawImage(layer, 0, 0)
    octx.globalAlpha = Math.max(0, Math.min(1, strength))
    octx.globalCompositeOperation = 'multiply'
    octx.drawImage(shadeImg, 0, 0, pw, ph)
    octx.globalAlpha = 1
    octx.globalCompositeOperation = 'destination-in'
    octx.drawImage(layer, 0, 0)
    return out
  }

  /**
   * Render a full cover: base, then the warped design multiplied onto it.
   * @param ctx  target 2D context
   * @param o    { base, design, maps?, stageW, stageH, dpr?, box:{cx,cy,w,h,rot?}, warp?, fabric? }
   *             box is in CSS px (ctx is dpr-scaled here); fabric 0..1 = shading strength.
   */
  function renderCover(ctx, o) {
    const dpr = o.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingQuality = 'high' // smooth downscale of the supersampled warp layer
    ctx.clearRect(0, 0, o.stageW, o.stageH)
    if (o.base) ctx.drawImage(o.base, 0, 0, o.stageW, o.stageH)
    if (!o.design || !o.box) return
    const maps = o.maps || {}
    let layer = warpDesign(o.design, o.box.w, o.box.h, o.warp, maps, dpr)
    if (maps.mask) layer = applyMask(layer, maps.mask) // clip to the printable region → crisp edge
    const f = o.fabric == null ? 0.8 : o.fabric
    const w = o.box.w, h = o.box.h
    ctx.save()
    ctx.translate(o.box.cx, o.box.cy)
    ctx.rotate((o.box.rot || 0) * Math.PI / 180)
    // Affine skew — matches a mildly-angled surface (parallelogram). Full perspective (a receding plane, far edge
    // shorter) is the print-region QUAD's job in production; this is its affine subset, handy for authoring.
    if (o.box.skewX || o.box.skewY) ctx.transform(1, o.box.skewY || 0, o.box.skewX || 0, 1, 0, 0)
    if (maps.shade) {
      // The prop supplies its own lighting: bake shade × design at the shading strength, then draw once.
      layer = applyShade(layer, maps.shade, f)
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1
      ctx.drawImage(layer, -w / 2, -h / 2, w, h)
    } else {
      // No shade map: crossfade sticker (source-over) ↔ fabric (multiply with the base beneath).
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1 - f
      ctx.drawImage(layer, -w / 2, -h / 2, w, h)
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = f
      ctx.drawImage(layer, -w / 2, -h / 2, w, h)
    }
    ctx.restore()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  const api = { renderCover, warpDesign }
  global.MockupRender = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this)
