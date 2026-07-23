// ─── Mockup cover manifest + prop descriptor codec ───────────────────────────────────────────────
//
// A product cover (a design shown on a tee / mug / tote…) is a RECIPE, not a baked image: a reusable
// prop atom + a design + a little placement, composited in the browser. See docs/MOCKUP-SPEC.md.
//
// This module is the format layer, shared by every app: Pole Position AUTHORS covers; PHAR LAP and Big
// Red READ them to render. Two encodings interconvert:
//   • PACKED bytes — the on-chain form (primary). Two 32-byte txids dominate; everything else quantizes
//     to ≤2 bytes and defaults are omitted via flags → a minimal cover is 66 bytes. Hashes don't compress,
//     so the record is stored raw (compress-if-smaller only helps content, never this — see the spec).
//   • JSON shorthand — for authoring / interop: { v, p, d, P:[x,y,scale,rot], w:[{t,…}] }.

export const MOCKUP_MIME = 'application/vnd.bmf-mockup'
const TAG = 0x4d // 'M'
const HEX64 = /^[0-9a-f]{64}$/i

// FLAGS byte (see §5). Defaults are omitted via these bits so the common cover is just header + refs.
const FLAG_PLACE = 0x01           // a place block follows
const FLAG_WARP = 0x02            // a warp block follows
const FLAG_PROP_IDX = 0x04        // prop is a u16 set-index, not a 32-byte txid
const FLAG_DESIGN_IDX = 0x08      // design is a u16 set-index, not a 32-byte txid
const FLAG_DESIGN_EMBEDDED = 0x10 // no design ref at all — the design IS the product's own storefront cover

// ─── canonical socket ratios (frozen ids — see spec §2) ──────────────
// A design is a plain image; its pixel dimensions classify it into ONE of these ratios, and it composites only
// onto props whose socketRatio matches. Order is FROZEN — the index is the on-chain socket id. Fewer ratios =
// one sample reuses across more props (that's the whole point of the prop/design split).
export const RATIOS = [
  { id: 0, name: '1:1', w: 1, h: 1 },     // square — tote, sticker, mug (centred), matted poster, phone (centred)
  { id: 1, name: '4:5', w: 4, h: 5 },     // portrait — apparel fronts, posters
  { id: 2, name: '2:3', w: 2, h: 3 },     // tall portrait — art prints, posters
  { id: 3, name: '16:9', w: 16, h: 9 },   // wide landscape — banners, laptop skins, mug wraps
  { id: 4, name: '9:16', w: 9, h: 16 },   // tall — phone cases, story format
] as const

/** Classify pixel dimensions into the nearest canonical ratio id (nearest by log-aspect, so 3:4≈4:5 etc.). */
export function ratioOf(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0
  const target = Math.log(width / height)
  let best = 0, bestD = Infinity
  for (const r of RATIOS) { const d = Math.abs(Math.log(r.w / r.h) - target); if (d < bestD) { bestD = d; best = r.id } }
  return best
}

/** Ratio id → { w, h } for laying out a print box / display frame. */
export function ratioDims(id: number): { w: number; h: number } {
  const r = RATIOS[id] ?? RATIOS[0]
  return { w: r.w, h: r.h }
}

// ─── warp registry (frozen ids — see spec §3) ────────────────────────
// Each stage packs as [typeId:u8, plen:u8, plen param bytes]. Known types have a fixed param schema
// (name → quantization); unknown/variable types (mesh/fold/ext) round-trip via raw param bytes.

type Enc = 'u8' | 'i8' | 'unit' | 'sunit' | 'deg' | 'q4'
const SIGNED: Record<Enc, boolean> = { u8: false, i8: true, unit: false, sunit: true, deg: false, q4: false }

/** id → type name. Index is the on-chain id; order is FROZEN. */
export const WARP_TYPES = [
  'flat', 'cyl', 'disp', 'persp', 'bulge', 'sphere', 'cone', 'mesh',
  'ripple', 'wave', 'curl', 'emboss', 'fold', 'skew', '_r14', 'ext',
] as const
const WARP_ID: Record<string, number> = Object.fromEntries(WARP_TYPES.map((t, i) => [t, i]))

/** Fixed param schema per known type (name, quantization). Absent from this table ⇒ raw-bytes round-trip. */
const WARP_SCHEMA: Record<string, [string, Enc][]> = {
  flat: [],
  cyl: [['curve', 'unit'], ['bow', 'sunit'], ['axis', 'u8']],
  disp: [['str', 'q4'], ['map', 'u8']],
  persp: [['kx', 'sunit'], ['ky', 'sunit']],
  bulge: [['amt', 'sunit']],
  sphere: [['curve', 'unit']],
  cone: [['taper', 'unit'], ['curve', 'unit']],
  ripple: [['amp', 'u8'], ['freq', 'u8'], ['phase', 'u8'], ['axis', 'u8']],
  wave: [['amp', 'u8'], ['len', 'u8'], ['angle', 'deg']],
  curl: [['amt', 'u8'], ['corner', 'u8']],
  emboss: [['depth', 'sunit']],
  skew: [['sx', 'sunit'], ['sy', 'sunit']],
  // mesh, fold, ext: variable-length → carried as `raw` bytes on the stage.
}

export interface WarpStage {
  t: string
  /** Named params (present for known types after decode). */
  [param: string]: number | string | number[] | undefined
  /** Raw param bytes for variable/unknown types (mesh/fold/ext). */
  raw?: number[]
}

export interface Ref { tx: string | null; index: number | null }
export interface MockupCover {
  version: number
  prop: Ref
  /** The design reference — or null when the design is EMBEDDED (it's the product's own storefront cover, so no
   *  ref is stored). Embedded is the TeeStrip product case; a ref is used when the design is a shared atom. */
  design: Ref | null
  /** Placement within the prop's print region. null = fill the region (identity). */
  /** Placement of the design within the base: centre x,y and scale (all normalized to the base), rotation°, an
   *  affine skew (parallelogram tilt for an angled surface), and the fabric-shading strength (0..1 — how strongly
   *  the prop's own shadows multiply over the print). null = fill the print region. */
  place: { x: number; y: number; scale: number; rot: number; skewX: number; skewY: number; fabric: number } | null
  /** Warp override. null = inherit the prop's default warp. */
  warp: WarpStage[] | null
}

// ─── on-chain PROP manifest (TLV blocks — extensible; see spec §6) ───
// The prop's own record (rides RECORD_MOCKUP on the PROP mint). A stream of tagged blocks: [id:u8, len:u8
// (0xFF→u16), value]. A parser reads the ids it knows and SKIPS any unknown id by its length — so a prop minted
// later with new params still renders on old code, and old props render on new code. New params = new ids, never
// a format break. Distinct TAG (0x50 'P') from a cover (0x4D 'M').
const TAG_PROP = 0x50
/** Field ids — FROZEN, additive. 0x0B–0xFE reserved for future params (folds, wrinkle, exclusion zones, light…). */
export const PROP_FIELD = {
  RATIO: 0x01, FABRIC: 0x02, PLACE: 0x03, WARP: 0x04, QUAD: 0x05,
  DISP: 0x06, MASK: 0x07, SHADE: 0x08, DIMS: 0x09, NAME: 0x0a,
} as const

export interface PropManifest {
  version: number
  /** Socket ratio id (index into RATIOS) — the design aspect this prop accepts. */
  ratio: number
  /** Fabric-shading strength 0..1. */
  fabric: number
  /** Print box on the base (centre x,y + scale, all normalized; rotation°, affine skew). null = fill/identity. */
  place: { x: number; y: number; scale: number; rot: number; skewX: number; skewY: number } | null
  /** 4-corner perspective quad on the base (alt/added to place). null = none. */
  quad: [number, number][] | null
  /** Warp pipeline. null = none. */
  warp: WarpStage[] | null
  /** Displacement / contour map atom (txid) + strength 0..1 — bends the print to the surface (e.g. shirt folds). */
  disp: { tx: string; str: number } | null
  /** Print-area mask atom (txid). */
  mask: string | null
  /** Baked shade/AO map atom (txid). */
  shade: string | null
  /** Physical print size in mm. */
  dims: { wmm: number; hmm: number } | null
  name: string | null
  /** Unknown blocks, preserved verbatim for forward-compatible round-trips. */
  ext?: { id: number; data: number[] }[]
}

export interface PropDescriptor {
  version: number
  /** Socket ratio id (index into RATIOS) — the design aspect this prop accepts. A design composites onto this
   *  prop only when ratioOf(design) === ratio. This is the whole reuse contract: prop owns geometry, design is a
   *  plain image of the matching shape. */
  ratio: number
  /** Print-region quad on the base, normalized (4 [x,y] corners). */
  print: [number, number][]
  warp: WarpStage[]
  /** Fabric-shading strength (0..1) — how strongly the prop's own shadows multiply over the print. A PROP
   *  property (belongs with the prop, not the design). */
  fabric: number
  roles: { base?: string; mask?: string; shade?: string; disp?: string }
  meta?: { name?: string; wmm?: number; hmm?: number }
}

// ─── tiny byte writer / reader ───────────────────────────────────────
class W {
  b: number[] = []
  u8(v: number): W { this.b.push(v & 0xff); return this }
  i8(v: number): W { this.b.push((v | 0) & 0xff); return this }
  u16(v: number): W { this.b.push(v & 0xff, (v >>> 8) & 0xff); return this }
  bytes(a: number[]): W { for (const x of a) this.b.push(x & 0xff); return this }
  out(): number[] { return this.b }
}
class R {
  b: number[]
  i = 0
  constructor(b: number[]) { this.b = b }
  u8(): number { return this.b[this.i++] }
  i8(): number { const v = this.b[this.i++]; return v > 127 ? v - 256 : v }
  u16(): number { const v = this.b[this.i] | (this.b[this.i + 1] << 8); this.i += 2; return v }
  bytes(n: number): number[] { const s = this.b.slice(this.i, this.i + n); this.i += n; return s }
  rem(): number { return this.b.length - this.i }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
function hexToBytes(hex: string): number[] { const o: number[] = []; for (let i = 0; i < hex.length; i += 2) o.push(parseInt(hex.slice(i, i + 2), 16)); return o }
function bytesToHex(b: number[]): string { return b.map(x => x.toString(16).padStart(2, '0')).join('') }
function utf8ToBytes(s: string): number[] { return Array.from(new TextEncoder().encode(s)) }
function bytesToUtf8(b: number[]): string { return new TextDecoder().decode(new Uint8Array(b)) }

function encParam(enc: Enc, v: number): number {
  switch (enc) {
    case 'u8': return clamp(Math.round(v), 0, 255)
    case 'i8': return clamp(Math.round(v), -128, 127)
    case 'unit': return clamp(Math.round(v * 255), 0, 255)
    case 'sunit': return clamp(Math.round(v * 127), -127, 127)
    case 'deg': return clamp(Math.round((((v % 360) + 360) % 360) / 360 * 255), 0, 255)
    case 'q4': return clamp(Math.round(v * 4), 0, 255)
  }
}
function decParam(enc: Enc, byte: number): number {
  switch (enc) {
    case 'u8': case 'i8': return byte
    case 'unit': return byte / 255
    case 'sunit': return byte / 127
    case 'deg': return byte / 255 * 360
    case 'q4': return byte / 4
  }
}

// ─── warp pipeline pack / parse ──────────────────────────────────────
function packWarp(stages: WarpStage[]): number[] {
  const w = new W().u8(stages.length)
  for (const st of stages) {
    const id = WARP_ID[st.t] ?? WARP_ID.ext
    const schema = WARP_SCHEMA[st.t]
    const pw = new W()
    if (schema != null) {
      for (const [name, enc] of schema) {
        const q = encParam(enc, Number(st[name] ?? 0))
        SIGNED[enc] ? pw.i8(q) : pw.u8(q)
      }
    } else if (Array.isArray(st.raw)) {
      pw.bytes(st.raw)
    }
    const pb = pw.out()
    w.u8(id).u8(pb.length).bytes(pb)
  }
  return w.out()
}
function parseWarp(r: R): WarpStage[] {
  const n = r.u8()
  const stages: WarpStage[] = []
  for (let i = 0; i < n; i++) {
    const id = r.u8(), plen = r.u8()
    const name = WARP_TYPES[id] ?? 'ext'
    const schema = WARP_SCHEMA[name]
    const start = r.i
    if (schema != null) {
      const st: WarpStage = { t: name }
      for (const [pn, enc] of schema) {
        const byte = SIGNED[enc] ? r.i8() : r.u8()
        st[pn] = decParam(enc, byte)
      }
      // Skip any trailing bytes the writer added beyond the known schema.
      r.i = start + plen
      stages.push(st)
    } else {
      stages.push({ t: name, raw: r.bytes(plen) })
    }
  }
  return stages
}

// ─── cover manifest: packed bytes ────────────────────────────────────
export function packCover(c: MockupCover): number[] {
  const d = c.design
  const propIdx = c.prop.index != null
  const designIdx = d != null && d.index != null
  let flags = 0
  if (c.place) flags |= FLAG_PLACE
  if (c.warp) flags |= FLAG_WARP
  if (propIdx) flags |= FLAG_PROP_IDX
  if (designIdx) flags |= FLAG_DESIGN_IDX
  if (d == null) flags |= FLAG_DESIGN_EMBEDDED

  const w = new W().u8(TAG).u8(c.version & 0xff).u8(flags)
  propIdx ? w.u16(c.prop.index as number) : w.bytes(hexToBytes(c.prop.tx as string))
  if (d != null) {
    d.index != null ? w.u16(d.index) : w.bytes(hexToBytes(d.tx as string))
  }
  if (c.place) {
    w.u16(clamp(Math.round(c.place.x * 65535), 0, 65535))
      .u16(clamp(Math.round(c.place.y * 65535), 0, 65535))
      .u16(clamp(Math.round(c.place.scale * 1024), 0, 65535))
      .u8(clamp(Math.round((((c.place.rot % 360) + 360) % 360) / 360 * 255), 0, 255))
      .i8(clamp(Math.round(c.place.skewX * 127), -127, 127))
      .i8(clamp(Math.round(c.place.skewY * 127), -127, 127))
      .u8(clamp(Math.round(c.place.fabric * 255), 0, 255))
  }
  if (c.warp) w.bytes(packWarp(c.warp))
  return w.out()
}

/** Parse a packed cover record. Returns null if it isn't one. */
export function parseCover(bytes: number[]): MockupCover | null {
  if (bytes == null || bytes.length < 3 || bytes[0] !== TAG) return null
  const r = new R(bytes)
  r.u8() // TAG
  const version = r.u8()
  const flags = r.u8()
  try {
    const prop: Ref = (flags & FLAG_PROP_IDX) ? { tx: null, index: r.u16() } : { tx: bytesToHex(r.bytes(32)), index: null }
    let design: Ref | null = null
    if (!(flags & FLAG_DESIGN_EMBEDDED)) {
      design = (flags & FLAG_DESIGN_IDX) ? { tx: null, index: r.u16() } : { tx: bytesToHex(r.bytes(32)), index: null }
    }
    let place: MockupCover['place'] = null
    if (flags & FLAG_PLACE) {
      place = { x: r.u16() / 65535, y: r.u16() / 65535, scale: r.u16() / 1024, rot: r.u8() / 255 * 360, skewX: r.i8() / 127, skewY: r.i8() / 127, fabric: r.u8() / 255 }
    }
    const warp = (flags & FLAG_WARP) ? parseWarp(r) : null
    return { version, prop, design, place, warp }
  } catch {
    return null
  }
}

export function isMockup(mimeType: string | null | undefined, bytes?: number[]): boolean {
  if (mimeType === MOCKUP_MIME) return true
  return bytes != null && bytes.length >= 2 && (bytes[0] === TAG || bytes[0] === TAG_PROP)
}

/** True if these bytes are a packed PROP manifest (TAG 0x50), vs a cover (0x4D). */
export function isProp(bytes?: number[] | null): boolean {
  return bytes != null && bytes.length >= 2 && bytes[0] === TAG_PROP
}

// ─── prop manifest: packed TLV bytes (extensible) ────────────────────
/** Write one TLV block: [id, len (0xFF→u16), value]. */
function putBlock(w: W, id: number, val: number[]): void {
  w.u8(id)
  if (val.length < 0xff) w.u8(val.length)
  else w.u8(0xff).u16(val.length)
  w.bytes(val)
}

export function packProp(p: PropManifest): number[] {
  const w = new W().u8(TAG_PROP).u8(p.version & 0xff)
  putBlock(w, PROP_FIELD.RATIO, [p.ratio & 0xff])
  putBlock(w, PROP_FIELD.FABRIC, [clamp(Math.round(p.fabric * 255), 0, 255)])
  if (p.place) {
    putBlock(w, PROP_FIELD.PLACE, new W()
      .u16(clamp(Math.round(p.place.x * 65535), 0, 65535))
      .u16(clamp(Math.round(p.place.y * 65535), 0, 65535))
      .u16(clamp(Math.round(p.place.scale * 1024), 0, 65535))
      .u8(clamp(Math.round((((p.place.rot % 360) + 360) % 360) / 360 * 255), 0, 255))
      .i8(clamp(Math.round(p.place.skewX * 127), -127, 127))
      .i8(clamp(Math.round(p.place.skewY * 127), -127, 127))
      .out())
  }
  if (p.quad && p.quad.length === 4) {
    const qw = new W()
    for (const [x, y] of p.quad) qw.u16(clamp(Math.round(x * 65535), 0, 65535)).u16(clamp(Math.round(y * 65535), 0, 65535))
    putBlock(w, PROP_FIELD.QUAD, qw.out())
  }
  if (p.warp && p.warp.length) putBlock(w, PROP_FIELD.WARP, packWarp(p.warp))
  if (p.disp) putBlock(w, PROP_FIELD.DISP, [...hexToBytes(p.disp.tx), clamp(Math.round(p.disp.str * 255), 0, 255)])
  if (p.mask) putBlock(w, PROP_FIELD.MASK, hexToBytes(p.mask))
  if (p.shade) putBlock(w, PROP_FIELD.SHADE, hexToBytes(p.shade))
  if (p.dims) putBlock(w, PROP_FIELD.DIMS, new W().u16(p.dims.wmm).u16(p.dims.hmm).out())
  if (p.name) putBlock(w, PROP_FIELD.NAME, utf8ToBytes(p.name))
  for (const e of p.ext ?? []) putBlock(w, e.id, e.data)
  return w.out()
}

/** Parse a packed prop manifest. Unknown block ids are preserved in `ext` and skipped by length. Null if not one. */
export function parseProp(bytes: number[]): PropManifest | null {
  if (bytes == null || bytes.length < 2 || bytes[0] !== TAG_PROP) return null
  const r = new R(bytes)
  r.u8() // TAG
  const p: PropManifest = {
    version: r.u8(), ratio: 0, fabric: 0.8, place: null, quad: null, warp: null,
    disp: null, mask: null, shade: null, dims: null, name: null, ext: [],
  }
  try {
    while (r.rem() >= 2) {
      const id = r.u8()
      let len = r.u8(); if (len === 0xff) len = r.u16()
      if (len > r.rem()) break
      const start = r.i
      switch (id) {
        case PROP_FIELD.RATIO: p.ratio = r.u8(); break
        case PROP_FIELD.FABRIC: p.fabric = r.u8() / 255; break
        case PROP_FIELD.PLACE: p.place = { x: r.u16() / 65535, y: r.u16() / 65535, scale: r.u16() / 1024, rot: r.u8() / 255 * 360, skewX: r.i8() / 127, skewY: r.i8() / 127 }; break
        case PROP_FIELD.QUAD: { const q: [number, number][] = []; for (let k = 0; k < 4; k++) q.push([r.u16() / 65535, r.u16() / 65535]); p.quad = q; break }
        case PROP_FIELD.WARP: p.warp = parseWarp(r); break
        case PROP_FIELD.DISP: p.disp = { tx: bytesToHex(r.bytes(32)), str: r.u8() / 255 }; break
        case PROP_FIELD.MASK: p.mask = bytesToHex(r.bytes(32)); break
        case PROP_FIELD.SHADE: p.shade = bytesToHex(r.bytes(32)); break
        case PROP_FIELD.DIMS: p.dims = { wmm: r.u16(), hmm: r.u16() }; break
        case PROP_FIELD.NAME: p.name = bytesToUtf8(r.bytes(len)); break
        default: p.ext!.push({ id, data: r.bytes(len) }); break
      }
      r.i = start + len // advance EXACTLY len — skip-unknown, and tolerant of a block longer than the known schema
    }
    return p
  } catch { return null }
}

// ─── cover manifest: JSON shorthand (authoring / interop) ────────────
function refFromJson(x: unknown): Ref {
  if (typeof x === 'number') return { tx: null, index: x }
  const s = String(x ?? '').toLowerCase()
  return HEX64.test(s) ? { tx: s, index: null } : { tx: null, index: 0 }
}
function refToJson(r: Ref): string | number { return r.index != null ? r.index : (r.tx ?? '') }

function warpFromJson(w: unknown): WarpStage[] {
  const arr = Array.isArray(w) ? w : [w]
  return arr.filter(Boolean).map(s => {
    const o = s as Record<string, unknown>
    const st: WarpStage = { t: String(o.t ?? 'flat') }
    for (const k of Object.keys(o)) if (k !== 't') st[k] = o[k] as number
    return st
  })
}

export function coverFromJson(obj: Record<string, unknown>): MockupCover {
  const P = obj.P as number[] | undefined
  return {
    version: Number(obj.v ?? 1),
    prop: refFromJson(obj.p),
    design: obj.d == null ? null : refFromJson(obj.d), // absent/null d = embedded (the storefront cover)
    place: Array.isArray(P) ? { x: P[0] ?? 0.5, y: P[1] ?? 0.5, scale: P[2] ?? 1, rot: P[3] ?? 0, skewX: P[4] ?? 0, skewY: P[5] ?? 0, fabric: P[6] ?? 0.8 } : null,
    warp: obj.w != null ? warpFromJson(obj.w) : null,
  }
}
export function coverToJson(c: MockupCover): Record<string, unknown> {
  const o: Record<string, unknown> = { v: c.version, p: refToJson(c.prop) }
  if (c.design) o.d = refToJson(c.design)
  if (c.place) o.P = [c.place.x, c.place.y, c.place.scale, c.place.rot, c.place.skewX, c.place.skewY, c.place.fabric]
  if (c.warp) o.w = c.warp
  return o
}

// ─── prop descriptor (rides in the .bmc as readable JSON) ────────────
export function propFromJson(obj: Record<string, unknown>): PropDescriptor | null {
  const print = obj.print as [number, number][] | undefined
  if (!Array.isArray(print) || print.length !== 4) return null
  return {
    version: Number(obj.v ?? 1),
    ratio: Number(obj.ratio ?? 0),
    print,
    warp: obj.warp != null ? warpFromJson(obj.warp) : [],
    fabric: obj.fabric != null ? Number(obj.fabric) : 0.8,
    roles: (obj.roles as PropDescriptor['roles']) ?? {},
    meta: obj.meta as PropDescriptor['meta'],
  }
}
export function propToJson(p: PropDescriptor): Record<string, unknown> {
  const o: Record<string, unknown> = { v: p.version, ratio: p.ratio, print: p.print, warp: p.warp, fabric: p.fabric, roles: p.roles }
  if (p.meta) o.meta = p.meta
  return o
}
