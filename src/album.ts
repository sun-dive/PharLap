// ─── Album container (multi-track release packed into ONE content file) ──────────────────────────
//
// A PharLap-native container that bundles several tracks (or any files) into a SINGLE blob, so a
// multi-track release (e.g. a music EP) can be minted as one edition NFT WITHOUT changing the on-chain
// transaction format, the covenant, the TEMPLATE record, or the provenance hash. To the chain it is just
// "a file": createEdition compresses/encrypts and hash-commits the whole container exactly as it does any
// single file, so the entire release is one immutable, timestamped, verifiable blob. The wallet packs it
// at mint and unpacks it in the viewer to show a tracklist with an inline player per track.
//
// Layout:  "PLEP" (4B magic) | version (1B) | headerLen (4B big-endian) | header JSON (utf8) | track bytes…
// The header JSON is { v, tracks: [{ n: name, m: mimeType, l: byteLength }] }; track bytes follow in order,
// sliced by their lengths (no offsets needed). Everything is plain bytes — no external zip dependency.

export const ALBUM_MIME = 'application/x-pharlap-album'
export const MAX_ALBUM_TRACKS = 12

export interface AlbumTrack { name: string; mimeType: string; bytes: number[] }

const MAGIC = [0x50, 0x4c, 0x45, 0x50] // "PLEP"
const VERSION = 1

/** Pack tracks into a single album-container byte array. Throws on empty/over-cap input. */
export function packAlbum(tracks: AlbumTrack[]): number[] {
  if (tracks.length === 0) throw new Error('an album needs at least one track')
  if (tracks.length > MAX_ALBUM_TRACKS) throw new Error(`an album can hold at most ${MAX_ALBUM_TRACKS} tracks`)
  const header = { v: VERSION, tracks: tracks.map(t => ({ n: t.name, m: t.mimeType, l: t.bytes.length })) }
  const headerBytes = Array.from(new TextEncoder().encode(JSON.stringify(header)))
  const len = headerBytes.length >>> 0
  const out = [...MAGIC, VERSION, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...headerBytes]
  for (const t of tracks) for (const b of t.bytes) out.push(b)
  return out
}

/** True if a mimeType marks an album container, or the bytes begin with the PLEP magic. */
export function isAlbum(mimeType: string | null | undefined, bytes?: number[]): boolean {
  if (mimeType === ALBUM_MIME) return true
  if (bytes != null && bytes.length >= 4 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3]) return true
  return false
}

/** Unpack an album container back into its tracks. Returns null if the bytes aren't a valid container. */
export function parseAlbum(bytes: number[]): AlbumTrack[] | null {
  if (bytes.length < 9) return null
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) return null
  // bytes[4] = version (only v1 today; future versions can branch here)
  const len = ((bytes[5] << 24) | (bytes[6] << 16) | (bytes[7] << 8) | bytes[8]) >>> 0
  const headEnd = 9 + len
  if (headEnd > bytes.length) return null
  let header: { v?: number; tracks?: { n?: string; m?: string; l?: number }[] }
  try { header = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes.slice(9, headEnd)))) } catch { return null }
  if (header == null || !Array.isArray(header.tracks)) return null
  const tracks: AlbumTrack[] = []
  let off = headEnd
  for (const t of header.tracks) {
    const l = Math.max(0, Number(t.l) || 0)
    if (off + l > bytes.length) return null
    tracks.push({
      name: String(t.n ?? 'track'),
      mimeType: String(t.m ?? 'application/octet-stream'),
      bytes: bytes.slice(off, off + l),
    })
    off += l
  }
  return tracks
}
