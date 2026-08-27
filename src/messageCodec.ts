// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
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
import { compressIfSmaller, decompress } from './compress.ts'

export const ENVELOPE_VERSION = 0x01
const FLAG_ENCRYPTED = 0x01
const FLAG_COMPRESSED = 0x02

/** Part type bytes. */
export const PART_TEXT = 0x01
export const PART_KEY = 0x02
export const PART_FILE_INLINE = 0x03
export const PART_FILE_REF = 0x04
/** Sender's self-asserted display alias (metadata, not content) — bound to senderPub by the envelope auth. */
export const PART_ALIAS = 0x05
/** Sender's self-asserted send time, UTC epoch milliseconds (metadata). Absolute instant — each reader
 *  renders it in their own local timezone, so there's no timezone ambiguity in the stored value. */
export const PART_TIME = 0x06

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: number[] }
  | { kind: 'file'; mimeType: string; fileName: string; bytes: number[] }
  | { kind: 'fileRef'; sha256: number[]; uri: string }
  | { kind: 'alias'; alias: string }
  | { kind: 'time'; ms: number }

/** Encode an epoch-ms timestamp as 6 little-endian bytes (good past the year 10000). */
function encodeTimeMs(ms: number): number[] {
  const out: number[] = []
  let v = Math.max(0, Math.floor(ms))
  for (let i = 0; i < 6; i++) { out.push(v & 0xff); v = Math.floor(v / 256) }
  return out
}
function decodeTimeMs(b: number[]): number {
  let n = 0
  for (let i = b.length - 1; i >= 0; i--) n = n * 256 + b[i]
  return n
}

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
    case 'alias': return { type: PART_ALIAS, value: Utils.toArray(p.alias, 'utf8') }
    case 'time': return { type: PART_TIME, value: encodeTimeMs(p.ms) }
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
        case PART_ALIAS: parts.push({ kind: 'alias', alias: Utils.toUTF8(value) }); break
        case PART_TIME: parts.push({ kind: 'time', ms: decodeTimeMs(value) }); break
        default: return null // unknown part type
      }
    }
  } catch { return null }
  return parts
}

// ─── Envelope (header + body) ───────────────────────────────────────
export async function buildEnvelope(opts: {
  senderPriv: PrivateKey
  recipientPubKeyHex: string
  parts: Part[]
  /** Default true (authenticated ECIES to the recipient). */
  encrypt?: boolean
  /** Sender's self-asserted display alias; carried as a PART_ALIAS so recipients can show @name. */
  senderAlias?: string
  /** Sender's send time (UTC epoch ms); carried as a PART_TIME so recipients can show + order by it. */
  sentAt?: number
}): Promise<number[]> {
  const encrypt = opts.encrypt ?? true
  const senderPub = opts.senderPriv.toPublicKey().encode(true) as number[]
  if (senderPub.length !== 33) throw new Error('senderPub must be 33 bytes')
  // Prepend metadata parts (alias, send time) ahead of the content parts.
  const meta: Part[] = []
  if (opts.senderAlias != null && opts.senderAlias !== '') meta.push({ kind: 'alias', alias: opts.senderAlias })
  if (opts.sentAt != null && opts.sentAt > 0) meta.push({ kind: 'time', ms: opts.sentAt })
  const allParts: Part[] = meta.length > 0 ? [...meta, ...opts.parts] : opts.parts
  // Smart-compress the TLV (keep only if smaller), BEFORE encrypting — ciphertext is incompressible.
  let payload = encodeParts(allParts)
  let flags = 0
  const c = await compressIfSmaller(payload)
  if (c.compressed) { payload = c.bytes; flags |= FLAG_COMPRESSED }
  // noKey=true: we already carry senderPub in the header, so don't duplicate it in the ciphertext.
  const body = encrypt
    ? ECIES.electrumEncrypt(payload, PublicKey.fromString(opts.recipientPubKeyHex), opts.senderPriv, true)
    : payload
  if (encrypt) flags |= FLAG_ENCRYPTED
  return [ENVELOPE_VERSION, flags, ...senderPub, ...body]
}

export interface OpenedMessage {
  senderPubKeyHex: string
  encrypted: boolean
  parts: Part[]
  /** Sender's self-asserted alias (from PART_ALIAS), if they attached one. */
  senderAlias?: string
  /** Sender's self-asserted send time, UTC epoch ms (from PART_TIME), if attached. */
  sentAt?: number
}

/** Split sender metadata (alias, send time) out of the content parts. */
function splitMeta(parts: Part[]): { senderAlias?: string; sentAt?: number; parts: Part[] } {
  const aliasPart = parts.find(p => p.kind === 'alias')
  const timePart = parts.find(p => p.kind === 'time')
  return {
    senderAlias: aliasPart != null && aliasPart.kind === 'alias' ? aliasPart.alias : undefined,
    sentAt: timePart != null && timePart.kind === 'time' ? timePart.ms : undefined,
    parts: parts.filter(p => p.kind !== 'alias' && p.kind !== 'time'),
  }
}

/** Open (and, if encrypted, decrypt + authenticate) an envelope with the recipient's private key. */
export async function openEnvelope(envelope: number[], recipientPriv: PrivateKey): Promise<OpenedMessage | null> {
  if (envelope.length < 35) return null
  if (envelope[0] !== ENVELOPE_VERSION) return null
  const encrypted = (envelope[1] & FLAG_ENCRYPTED) !== 0
  const compressed = (envelope[1] & FLAG_COMPRESSED) !== 0
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
  if (compressed) { try { tlv = await decompress(tlv) } catch { return null } } // decompress AFTER decrypt
  const decoded = decodeParts(tlv)
  if (decoded == null) return null
  const { senderAlias, sentAt, parts } = splitMeta(decoded)
  return { senderPubKeyHex, encrypted, parts, senderAlias, sentAt }
}

/** Open a PUBLIC (unencrypted) envelope with no key — for broadcasts/announcements anyone can read.
 *  Returns null for encrypted envelopes (those need `openEnvelope` with the recipient's key). */
export async function openPublicEnvelope(envelope: number[]): Promise<OpenedMessage | null> {
  if (envelope.length < 35 || envelope[0] !== ENVELOPE_VERSION) return null
  if ((envelope[1] & FLAG_ENCRYPTED) !== 0) return null
  const senderPubKeyHex = Utils.toHex(envelope.slice(2, 35))
  let tlv = envelope.slice(35)
  if ((envelope[1] & FLAG_COMPRESSED) !== 0) { try { tlv = await decompress(tlv) } catch { return null } }
  const decoded = decodeParts(tlv)
  if (decoded == null) return null
  const { senderAlias, sentAt, parts } = splitMeta(decoded)
  return { senderPubKeyHex, encrypted: false, parts, senderAlias, sentAt }
}
