// BMC — a container (store-only ZIP + a bmc.json index) for a SET of BMF media files, minted as ONE
// collection. Members stay individually referenceable by name: a BMF reference { tx: <setTxid>, name }
// resolves to the member called <name>. This decodes the container so the player can pull a member out.
// Only the store-only (no-deflate) ZIP that the BMC tool produces is supported — which is all that's minted.
import { Utils } from '@bsv/sdk'

function readStoreZip(bytes: number[]): Record<string, number[]> | null {
  const u16 = (o: number): number => bytes[o] | (bytes[o + 1] << 8)
  const u32 = (o: number): number => bytes[o] + bytes[o + 1] * 0x100 + bytes[o + 2] * 0x10000 + bytes[o + 3] * 0x1000000
  const out: Record<string, number[]> = {}
  let i = 0
  while (i + 30 <= bytes.length && u32(i) === 0x04034b50) { // local file header
    const method = u16(i + 8); const size = u32(i + 18); const nameLen = u16(i + 26); const extraLen = u16(i + 28)
    if (method !== 0) return null // store-only only
    const nameStart = i + 30
    let name = ''; for (let j = 0; j < nameLen; j++) name += String.fromCharCode(bytes[nameStart + j])
    const dataStart = nameStart + nameLen + extraLen
    out[name] = bytes.slice(dataStart, dataStart + size)
    i = dataStart + size
  }
  return Object.keys(out).length > 0 ? out : null
}
const isBmc = (b: number[]): boolean => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 // "PK\x03\x04"

export interface BmcMember { name: string; file: string; mimeType: string; bytes: number[] }
export interface BmcSet { name: string; members: BmcMember[] }

/** Parse decoded content as a BMC set → { name, members } or null (not a set). */
export function parseBmcSet(bytes: number[]): BmcSet | null {
  if (!isBmc(bytes)) return null
  const files = readStoreZip(bytes)
  if (files == null || files['bmc.json'] == null) return null
  try {
    const manifest = JSON.parse(Utils.toUTF8(files['bmc.json']))
    const members: BmcMember[] = (manifest.members ?? [])
      .map((m: { name: string; file: string; mime?: string }) => ({ name: m.name, file: m.file, mimeType: m.mime ?? 'application/octet-stream', bytes: files[m.file] }))
      .filter((m: BmcMember) => Boolean(m.name) && m.bytes != null && m.bytes.length > 0)
    return members.length > 0 ? { name: manifest.name ?? 'set', members } : null
  } catch { return null }
}

/** Pick a member from a set by its reference name (falls back to matching the file entry name). */
export function bmcMember(set: BmcSet, name: string): BmcMember | null {
  return set.members.find(m => m.name === name) ?? set.members.find(m => m.file === name) ?? null
}
