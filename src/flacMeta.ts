// Extract embedded PICTURE blocks (cover art etc.) from a FLAC file's metadata, so the player can show the
// artwork the artist embedded (e.g. via Kid3). FLAC layout: the "fLaC" marker, then a chain of metadata
// blocks — each a 4-byte header (1 last-block flag bit, 7 type bits, 24 length bits, big-endian) + a body.
// PICTURE is type 6. We read only the metadata at the start of the file (the audio frames follow), and are
// fully bounds-checked — anything malformed yields []. All multi-byte integers are big-endian.

export interface FlacPicture { pictureType: number; mimeType: string; description: string; data: number[] }

function u32(b: number[], o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}

/** All PICTURE blocks in a FLAC byte array, in file order (front cover is pictureType 3, back cover 4). */
export function parseFlacPictures(bytes: number[]): FlacPicture[] {
  if (bytes.length < 8 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) return [] // "fLaC"
  const pics: FlacPicture[] = []
  let off = 4
  for (let guard = 0; guard < 4096; guard++) {
    if (off + 4 > bytes.length) break
    const header = bytes[off]
    const isLast = (header & 0x80) !== 0
    const type = header & 0x7f
    const len = (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]
    const body = off + 4
    if (body + len > bytes.length) break
    if (type === 6) { const p = parsePictureBlock(bytes, body, body + len); if (p != null) pics.push(p) }
    off = body + len
    if (isLast) break
  }
  return pics
}

// Read embedded lyrics from a FLAC's VORBIS_COMMENT block (type 4). Vorbis comments are "KEY=value" UTF-8
// strings; lyrics live under LYRICS / UNSYNCEDLYRICS / SYNCEDLYRICS (the field Kid3 writes). Returns the first
// match, preferring any value that carries [mm:ss.xx] LRC timestamps (synced) over a plain block. Note: Vorbis
// comment lengths are LITTLE-endian — unlike every other big-endian field in FLAC. Fully bounds-checked → null.
const LYRIC_KEYS = new Set(['LYRICS', 'UNSYNCEDLYRICS', 'SYNCEDLYRICS', 'LYRICS-XXX'])
const u32le = (b: number[], o: number): number => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0)

export function parseFlacLyrics(bytes: number[]): string | null {
  if (bytes.length < 8 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) return null // "fLaC"
  let off = 4
  for (let guard = 0; guard < 4096; guard++) {
    if (off + 4 > bytes.length) break
    const header = bytes[off]
    const isLast = (header & 0x80) !== 0
    const type = header & 0x7f
    const len = (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]
    const body = off + 4
    if (body + len > bytes.length) break
    if (type === 4) {
      const found = readVorbisLyrics(bytes, body, body + len)
      if (found != null) return found
    }
    off = body + len
    if (isLast) break
  }
  return null
}

function readVorbisLyrics(b: number[], start: number, end: number): string | null {
  const dec = new TextDecoder()
  let o = start
  if (o + 4 > end) return null
  o += 4 + u32le(b, o) // skip vendor string
  if (o + 4 > end) return null
  const count = u32le(b, o); o += 4
  let fallback: string | null = null
  for (let i = 0; i < count && i < 4096; i++) {
    if (o + 4 > end) break
    const clen = u32le(b, o); o += 4
    if (o + clen > end) break
    const comment = dec.decode(new Uint8Array(b.slice(o, o + clen))); o += clen
    const eq = comment.indexOf('=')
    if (eq <= 0) continue
    const key = comment.slice(0, eq).toUpperCase()
    if (!LYRIC_KEYS.has(key)) continue
    const val = comment.slice(eq + 1)
    if (val.trim() === '') continue
    if (/\[\d{1,2}:\d{1,2}/.test(val)) return val // synced (LRC) — prefer it outright
    if (fallback == null) fallback = val
  }
  return fallback
}

function parsePictureBlock(b: number[], start: number, end: number): FlacPicture | null {
  let o = start
  const dec = new TextDecoder()
  if (o + 4 > end) return null
  const pictureType = u32(b, o); o += 4
  if (o + 4 > end) return null
  const mimeLen = u32(b, o); o += 4
  if (o + mimeLen + 4 > end) return null
  const mimeType = dec.decode(new Uint8Array(b.slice(o, o + mimeLen))); o += mimeLen
  const descLen = u32(b, o); o += 4
  if (o + descLen + 16 + 4 > end) return null
  const description = dec.decode(new Uint8Array(b.slice(o, o + descLen))); o += descLen
  o += 16 // width(4) height(4) depth(4) colors(4) — unused
  const dataLen = u32(b, o); o += 4
  if (o + dataLen > end) return null
  return { pictureType, mimeType, description, data: b.slice(o, o + dataLen) }
}
