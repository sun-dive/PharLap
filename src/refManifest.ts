// ─── Reference manifest (content-by-pointer container) ───────────────────────────────────────────
//
// A PharLap-native content file that, instead of EMBEDDING bytes, POINTS at content already minted
// on-chain. It lets a new collection (e.g. an "EP") reference existing single mints by their genesis
// txid + content fileHash — so the audio isn't re-uploaded; the player resolves each pointer and plays
// the referenced works as an album. To the chain it is just "a file" (like the PLEP album container):
// createEdition compresses/hash-commits the manifest exactly as any single file, so the covenant, the
// TEMPLATE record, the mint path, and the provenance hash are ALL unchanged. The fileHash committed by
// the covenant binds the pointer LIST (tamper-evident); each entry's `hash` binds the referenced CONTENT
// (so a resolved single can be integrity-checked against what the EP author intended).
//
// Layout:  "PREF" (4B magic) | version (1B) | headerLen (4B big-endian) | header JSON (utf8)
// The header JSON is { v, refs: [{ i: collectionTxid, h: contentFileHash, n: name, m: mimeType }] }.
// There are no trailing bytes — a manifest is pure pointers. headerLen is kept for forward-compat (a
// future version could append data) and to mirror the PLEP framing.

export const MANIFEST_MIME = 'application/x-pharlap-refs'
export const MAX_MANIFEST_REFS = 24

export interface ManifestRef {
  /** Referenced collection's genesis (TX1) txid — where the content lives on-chain. */
  id: string
  /** The referenced content's fileHash (sha256 hex) — integrity bind for the resolved bytes. */
  hash: string
  /** Display name (e.g. track title / filename). */
  name: string
  /** Content mimeType (e.g. audio/flac). */
  mimeType: string
}

const MAGIC = [0x50, 0x52, 0x45, 0x46] // "PREF"
const VERSION = 1
const HEX64 = /^[0-9a-fA-F]{64}$/

/** Pack reference entries into a single manifest byte array. Throws on empty/over-cap/malformed input. */
export function packManifest(refs: ManifestRef[]): number[] {
  if (refs.length === 0) throw new Error('a reference manifest needs at least one entry')
  if (refs.length > MAX_MANIFEST_REFS) throw new Error(`a reference manifest can hold at most ${MAX_MANIFEST_REFS} entries`)
  for (const r of refs) {
    if (!HEX64.test(r.id)) throw new Error(`reference id must be a 32-byte txid hex: ${r.id}`)
    if (!HEX64.test(r.hash)) throw new Error(`reference hash must be a 32-byte sha256 hex: ${r.hash}`)
  }
  const header = { v: VERSION, refs: refs.map(r => ({ i: r.id.toLowerCase(), h: r.hash.toLowerCase(), n: r.name, m: r.mimeType })) }
  const headerBytes = Array.from(new TextEncoder().encode(JSON.stringify(header)))
  const len = headerBytes.length >>> 0
  return [...MAGIC, VERSION, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...headerBytes]
}

/** True if a mimeType marks a reference manifest, or the bytes begin with the PREF magic. */
export function isManifest(mimeType: string | null | undefined, bytes?: number[]): boolean {
  if (mimeType === MANIFEST_MIME) return true
  if (bytes != null && bytes.length >= 4 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3]) return true
  return false
}

/** Unpack a manifest back into its references. Returns null if the bytes aren't a valid manifest (any
 *  malformed pointer rejects the whole manifest — a half-valid pointer list must not resolve silently). */
export function parseManifest(bytes: number[]): ManifestRef[] | null {
  if (bytes.length < 9) return null
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) return null
  // bytes[4] = version (only v1 today; future versions can branch here)
  const len = ((bytes[5] << 24) | (bytes[6] << 16) | (bytes[7] << 8) | bytes[8]) >>> 0
  const headEnd = 9 + len
  if (headEnd > bytes.length) return null
  let header: { v?: number; refs?: { i?: string; h?: string; n?: string; m?: string }[] }
  try { header = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes.slice(9, headEnd)))) } catch { return null }
  if (header == null || !Array.isArray(header.refs) || header.refs.length === 0) return null
  const refs: ManifestRef[] = []
  for (const r of header.refs) {
    const id = String(r.i ?? ''), hash = String(r.h ?? '')
    if (!HEX64.test(id) || !HEX64.test(hash)) return null // a bad pointer poisons the whole manifest
    refs.push({ id: id.toLowerCase(), hash: hash.toLowerCase(), name: String(r.n ?? 'track'), mimeType: String(r.m ?? 'application/octet-stream') })
  }
  return refs
}
