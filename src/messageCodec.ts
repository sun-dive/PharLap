// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP message envelope codec (Messaging v1).
 *
 * A message is a RECORD_MESSAGE PushDrop output locked to the recipient's pubkey (see tokenCodec),
 * carrying an `envelope` field that this module builds and opens. The envelope is the typed payload:
 *
 *   header:  version(1) ‖ flags(1) ‖ senderPubKey(33)
 *   body:    flags.encrypted ? ECIES(TLV, recipientPub, senderPriv) : TLV
 *
 * The body is a TLV list of parts, so one message can carry several things at once (a key + a note +
 * a bonus file). Encryption is authenticated real-key ECIES (electrum): only the holder of the
 * sender's private key could have produced ciphertext that the recipient decrypts under
 * (recipientPriv, senderPub) — so the recipient learns *and verifies* who sent it.
 *
 * Permanence caveat: on-chain payloads are forever. A leaked content key means the ciphertext is
 * permanently decryptable — an inconvenience, not DRM.
 */
import { ECIES, PublicKey, type PrivateKey, Utils } from '@bsv/sdk'

export const ENVELOPE_VERSION = 0x01
const FLAG_ENCRYPTED = 0x01

/** Part type bytes. */
export const PART_TEXT = 0x01
export const PART_KEY = 0x02
export const PART_FILE_INLINE = 0x03
export const PART_FILE_REF = 0x04

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: number[] }
  | { kind: 'file'; mimeType: string; fileName: string; bytes: number[] }
  | { kind: 'fileRef'; sha256: number[]; uri: string }

// ─── CompactSize varint ─────────────────────────────────────────────
function writeVarInt(n: number): number[] {
  if (n < 0xfd) return [n]
  if (n <= 0xffff) return [0xfd, n & 0xff, (n >> 8) & 0xff]
  if (n <= 0xffffffff) return [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
  throw new Error('writeVarInt: value too large')
}
function readVarInt(b: number[], off: number): [number, number] {
  const first = b[off]
  if (first < 0xfd) return [first, off + 1]
  if (first === 0xfd) return [b[off + 1] | (b[off + 2] << 8), off + 3]
  if (first === 0xfe) return [b[off + 1] | (b[off + 2] << 8) | (b[off + 3] << 16) | (b[off + 4] << 24), off + 5]
  throw new Error('readVarInt: 64-bit lengths unsupported')
}
function lenPrefixed(bytes: number[]): number[] { return [...writeVarInt(bytes.length), ...bytes] }

// ─── TLV body (one or more parts) ───────────────────────────────────
function encodePartValue(p: Part): { type: number; value: number[] } {
  switch (p.kind) {
    case 'text': return { type: PART_TEXT, value: Utils.toArray(p.text, 'utf8') }
    case 'key': return { type: PART_KEY, value: [...p.key] }
    case 'file': return {
      type: PART_FILE_INLINE,
      value: [...lenPrefixed(Utils.toArray(p.mimeType, 'utf8')), ...lenPrefixed(Utils.toArray(p.fileName, 'utf8')), ...p.bytes],
    }
    case 'fileRef': {
      if (p.sha256.length !== 32) throw new Error('fileRef sha256 must be 32 bytes')
      return { type: PART_FILE_REF, value: [...p.sha256, ...Utils.toArray(p.uri, 'utf8')] }
    }
  }
}

export function encodeParts(parts: Part[]): number[] {
  const out: number[] = []
  for (const p of parts) {
    const { type, value } = encodePartValue(p)
    out.push(type, ...lenPrefixed(value))
  }
  return out
}

export function decodeParts(bytes: number[]): Part[] | null {
  const parts: Part[] = []
  let off = 0
  try {
    while (off < bytes.length) {
      const type = bytes[off++]
      let len: number
      ;[len, off] = readVarInt(bytes, off)
      const value = bytes.slice(off, off + len)
      if (value.length !== len) return null
      off += len
      switch (type) {
        case PART_TEXT: parts.push({ kind: 'text', text: Utils.toUTF8(value) }); break
        case PART_KEY: parts.push({ kind: 'key', key: value }); break
        case PART_FILE_INLINE: {
          let o = 0, mlen = 0, nlen = 0
          ;[mlen, o] = readVarInt(value, o); const mime = value.slice(o, o + mlen); o += mlen
          ;[nlen, o] = readVarInt(value, o); const name = value.slice(o, o + nlen); o += nlen
          parts.push({ kind: 'file', mimeType: Utils.toUTF8(mime), fileName: Utils.toUTF8(name), bytes: value.slice(o) })
          break
        }
        case PART_FILE_REF:
          parts.push({ kind: 'fileRef', sha256: value.slice(0, 32), uri: Utils.toUTF8(value.slice(32)) })
          break
        default: return null // unknown part type
      }
    }
  } catch { return null }
  return parts
}

// ─── Envelope (header + body) ───────────────────────────────────────
export function buildEnvelope(opts: {
  senderPriv: PrivateKey
  recipientPubKeyHex: string
  parts: Part[]
  /** Default true (authenticated ECIES to the recipient). */
  encrypt?: boolean
}): number[] {
  const encrypt = opts.encrypt ?? true
  const senderPub = opts.senderPriv.toPublicKey().encode(true) as number[]
  if (senderPub.length !== 33) throw new Error('senderPub must be 33 bytes')
  const tlv = encodeParts(opts.parts)
  // noKey=true: we already carry senderPub in the header, so don't duplicate it in the ciphertext.
  const body = encrypt
    ? ECIES.electrumEncrypt(tlv, PublicKey.fromString(opts.recipientPubKeyHex), opts.senderPriv, true)
    : tlv
  return [ENVELOPE_VERSION, encrypt ? FLAG_ENCRYPTED : 0, ...senderPub, ...body]
}

export interface OpenedMessage {
  senderPubKeyHex: string
  encrypted: boolean
  parts: Part[]
}

/** Open (and, if encrypted, decrypt + authenticate) an envelope with the recipient's private key. */
export function openEnvelope(envelope: number[], recipientPriv: PrivateKey): OpenedMessage | null {
  if (envelope.length < 35) return null
  if (envelope[0] !== ENVELOPE_VERSION) return null
  const encrypted = (envelope[1] & FLAG_ENCRYPTED) !== 0
  const senderPub = envelope.slice(2, 35)
  const senderPubKeyHex = Utils.toHex(senderPub)
  const body = envelope.slice(35)
  let tlv: number[]
  if (encrypted) {
    try {
      tlv = ECIES.electrumDecrypt(body, recipientPriv as never, PublicKey.fromString(senderPubKeyHex))
    } catch { return null } // wrong key, tampered, or not for us
  } else {
    tlv = body
  }
  const parts = decodeParts(tlv)
  if (parts == null) return null
  return { senderPubKeyHex, encrypted, parts }
}
