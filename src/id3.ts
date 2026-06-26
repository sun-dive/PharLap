// Extract embedded picture frames (cover art) from an MP3's ID3v2 tag, so the player shows MP3 cover art the
// same way it does FLAC PICTURE blocks. ID3v2 sits at the START of the file: a 10-byte header ("ID3", 2 version
// bytes, flags, then a 4-byte SYNCSAFE size) followed by frames. The picture frame is "APIC" (v2.3/v2.4) or
// "PIC" (v2.2). Fully bounds-checked + defensive — anything unexpected yields []. Supports v2.2/2.3/2.4; bails
// on unsynchronised tags (rare). Frame sizes: v2.2 = 3-byte plain, v2.3 = 4-byte plain, v2.4 = 4-byte syncsafe.

export interface Id3Picture { pictureType: number; mimeType: string; data: number[] }

const syncsafe = (b: number[], o: number): number => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
const u32 = (b: number[], o: number): number => (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0)
const u24 = (b: number[], o: number): number => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]
const latin1 = (b: number[], s: number, e: number): string => { let r = ''; for (let i = s; i < e; i++) r += String.fromCharCode(b[i]); return r }

function normalizeMime(m: string): string {
  const s = m.trim().toLowerCase()
  if (s.startsWith('image/')) return s
  if (s.includes('png')) return 'image/png'
  if (s.includes('jpg') || s.includes('jpeg')) return 'image/jpeg'
  if (s.includes('gif')) return 'image/gif'
  if (s.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}

// Skip a null-terminated description; UTF-16 (encoding 1/2) terminates on a 00 00 pair.
function skipDescription(b: number[], o: number, end: number, encoding: number): number {
  if (encoding === 1 || encoding === 2) {
    while (o + 1 < end) { if (b[o] === 0 && b[o + 1] === 0) return o + 2; o += 2 }
    return end
  }
  while (o < end) { if (b[o] === 0) return o + 1; o++ }
  return end
}

function parseApic(b: number[], start: number, end: number): Id3Picture | null {
  let o = start
  if (o >= end) return null
  const encoding = b[o]; o++
  let m = o; while (m < end && b[m] !== 0) m++
  const mimeType = latin1(b, o, m); o = m + 1
  if (o >= end) return null
  const pictureType = b[o]; o++
  o = skipDescription(b, o, end, encoding)
  if (o > end) return null
  return { pictureType, mimeType: normalizeMime(mimeType), data: b.slice(o, end) }
}

// v2.2 "PIC": encoding(1) + 3-char image format + picture type(1) + description + data.
function parsePic(b: number[], start: number, end: number): Id3Picture | null {
  let o = start
  if (o + 5 > end) return null
  const encoding = b[o]; o++
  const fmt = latin1(b, o, o + 3); o += 3
  const pictureType = b[o]; o++
  o = skipDescription(b, o, end, encoding)
  if (o > end) return null
  return { pictureType, mimeType: normalizeMime(fmt), data: b.slice(o, end) }
}

export function parseId3Pictures(bytes: number[]): Id3Picture[] {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return [] // "ID3"
  const major = bytes[3]
  const flags = bytes[5]
  if ((flags & 0x80) !== 0) return [] // unsynchronised — would need de-unsync first; skip (rare)
  const end = Math.min(10 + syncsafe(bytes, 6), bytes.length)
  let o = 10
  if ((flags & 0x40) !== 0) { // extended header — skip it
    if (o + 4 > end) return []
    o += major >= 4 ? syncsafe(bytes, o) : u32(bytes, o) + 4 // v2.4 size includes itself; v2.3 size excludes the 4 size bytes
  }
  const pics: Id3Picture[] = []
  const idLen = major === 2 ? 3 : 4
  const hdrLen = major === 2 ? 6 : 10
  for (let guard = 0; guard < 4096 && o + hdrLen <= end; guard++) {
    if (bytes[o] === 0) break // padding
    const id = latin1(bytes, o, o + idLen)
    const frameSize = major === 2 ? u24(bytes, o + 3) : (major >= 4 ? syncsafe(bytes, o + 4) : u32(bytes, o + 4))
    const fstart = o + hdrLen
    if (frameSize <= 0 || fstart + frameSize > end) break
    if (major === 2 && id === 'PIC') { const p = parsePic(bytes, fstart, fstart + frameSize); if (p != null) pics.push(p) }
    else if (id === 'APIC') { const p = parseApic(bytes, fstart, fstart + frameSize); if (p != null) pics.push(p) }
    o = fstart + frameSize
  }
  return pics
}
