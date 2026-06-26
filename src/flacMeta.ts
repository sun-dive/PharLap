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
