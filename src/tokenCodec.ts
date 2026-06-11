// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP token field codec.
 *
 * Defines what goes inside the PushDrop data fields for each PHAR LAP record type, and
 * ties the field layouts to the raw-key PushDrop template in `pushDrop.ts`.
 *
 * Three record types, distinguished by `recordType` (data field [2]):
 *
 *   TOKEN    (lock = owner)   [ P, version, 0x02, TX1-ref(32B), stateData ]
 *   TEMPLATE (lock = creator) [ P, version, 0x01, tokenName, tokenRules(8B), covenantScript, fileHash?(32B) ]
 *   FILE     (lock = creator) [ P, version, 0x03, mimeType, fileName, fileBytes ]
 *
 * Identity = Collection ID = the txid of TX1 (the template transaction), carried by every
 * token as `TX1-ref`. There is no per-token Token ID and no on-chain proof chain — see
 * PLAN.md (Addendum C) and docs/DEVIATIONS_FROM_MPT.md.
 *
 * The PushDrop lock key carries ownership/authorship: the token's lock key is the current
 * owner; the template/file outputs' lock key is the creator. So the creator pubkey is
 * recovered from the template output via `pushDrop.decode`, not stored as a field.
 */
import { LockingScript, Utils } from '@bsv/sdk'
import { lock as pushDropLock, decode as pushDropDecode } from './pushDrop.ts'

// ─── Constants ──────────────────────────────────────────────────────

export const P_PREFIX: number[] = [0x50] // "P"
export const P_VERSION = 0x03

export const RECORD_TEMPLATE = 0x01
export const RECORD_TOKEN = 0x02
export const RECORD_FILE = 0x03
/** Reserved for creator↔holder messages / announcements (encrypted or public). See PLAN.md Addendum E. */
export const RECORD_MESSAGE = 0x04

/** tokenRules restrictions bitfield. */
export const RESTRICTION_FUNGIBLE = 0x0001 // interchangeable amounts (satoshis = units)
export const RESTRICTION_REPLICABLE = 0x0002 // "unlimited mints" edition-replication covenant active
/** Reserved: transfers report to the creator (1-sat creator notification) so the creator can track
 *  current holders. Creator's explicit, visible choice at mint; private by default. See PLAN.md Addendum E. */
export const RESTRICTION_TRACK_TRANSFERS = 0x0004

// ─── Byte / hex / utf8 helpers ──────────────────────────────────────

function hexToBytes(hex: string): number[] {
  return hex.length === 0 ? [] : Utils.toArray(hex, 'hex')
}
function bytesToHex(bytes: number[]): string {
  return Utils.toHex(bytes)
}
function utf8ToBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s))
}
function bytesToUtf8(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/**
 * PushDrop minimal-push collapses an empty field to OP_0, which `pushDrop.decode`
 * normalizes back to `[0]`. So an empty hex field round-trips to "00". This only matters
 * for mutable fields (stateData / covenantScript); identity fields are fixed-length, so the
 * Collection ID is unaffected (see DEVIATIONS_FROM_MPT.md §4).
 */
function isEmptyOrZero(bytes: number[]): boolean {
  return bytes.length === 0 || (bytes.length === 1 && bytes[0] === 0)
}

// ─── Record-type classification ─────────────────────────────────────

/** Read the record type (0x01/0x02/0x03) of a PushDrop output, or null if not a PHAR LAP record. */
export function classifyRecord(script: LockingScript): number | null {
  const d = pushDropDecode(script)
  if (d == null || d.fields.length < 3) return null
  const prefix = d.fields[0]
  const version = d.fields[1]
  const recordType = d.fields[2]
  if (prefix.length !== 1 || prefix[0] !== P_PREFIX[0]) return null
  if (version.length !== 1 || version[0] !== P_VERSION) return null
  if (recordType.length !== 1) return null
  return recordType[0]
}

// ─── TOKEN record ───────────────────────────────────────────────────

export interface TokenFields {
  /** Collection ID — the txid of TX1 (the template tx), 32 bytes hex. */
  tx1Ref: string
  /** Mutable per-UTXO state (hex). Empty round-trips to "00". Not part of identity. */
  stateData: string
}

export function encodeTokenFields(data: TokenFields): number[][] {
  return [
    P_PREFIX,
    [P_VERSION],
    [RECORD_TOKEN],
    hexToBytes(data.tx1Ref),
    hexToBytes(data.stateData),
  ]
}

export function decodeTokenFields(fields: number[][]): TokenFields | null {
  if (fields.length < 5) return null
  if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null
  if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null
  if (fields[2].length !== 1 || fields[2][0] !== RECORD_TOKEN) return null
  if (fields[3].length !== 32) return null // TX1-ref must be a 32-byte txid
  return {
    tx1Ref: bytesToHex(fields[3]),
    stateData: bytesToHex(fields[4]),
  }
}

/** Build a token PushDrop locking script, locked to the owner's public key. */
export function buildTokenScript(ownerPubKeyHex: string, data: TokenFields): LockingScript {
  return pushDropLock(ownerPubKeyHex, encodeTokenFields(data))
}

/** Parse a token PushDrop output → owner pubkey + token fields, or null. */
export function parseTokenScript(
  script: LockingScript,
): { ownerPubKeyHex: string; fields: TokenFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodeTokenFields(d.fields)
  if (fields == null) return null
  return { ownerPubKeyHex: d.pubKeyHex, fields }
}

// ─── MESSAGE record (Messaging v1) ──────────────────────────────────
// A message is a PushDrop output locked to the RECIPIENT's pubkey, structurally a twin of a token:
// [P, version, RECORD_MESSAGE, ref(32), envelope]. The `ref` mirrors `tx1Ref` (context: collection id
// or thread-root txid, or 32 zero bytes for a standalone DM); the `envelope` mirrors `stateData` and
// carries the typed payload (see messageCodec).

export interface MessageFields {
  /** Context reference (32-byte hex): collection id / thread-root txid, or 64 zeros for a standalone DM. */
  ref: string
  /** The message envelope bytes (header + body; built/opened by messageCodec). */
  envelope: number[]
}

export function encodeMessageFields(data: MessageFields): number[][] {
  return [
    P_PREFIX,
    [P_VERSION],
    [RECORD_MESSAGE],
    hexToBytes(data.ref),
    data.envelope,
  ]
}

export function decodeMessageFields(fields: number[][]): MessageFields | null {
  if (fields.length < 5) return null
  if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null
  if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null
  if (fields[2].length !== 1 || fields[2][0] !== RECORD_MESSAGE) return null
  if (fields[3].length !== 32) return null // ref must be a 32-byte value
  return {
    ref: bytesToHex(fields[3]),
    envelope: fields[4],
  }
}

/** Build a message PushDrop locking script, locked to the RECIPIENT's public key. */
export function buildMessageScript(recipientPubKeyHex: string, data: MessageFields): LockingScript {
  return pushDropLock(recipientPubKeyHex, encodeMessageFields(data))
}

/** Parse a message PushDrop output → recipient pubkey + message fields, or null. */
export function parseMessageScript(
  script: LockingScript,
): { recipientPubKeyHex: string; fields: MessageFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodeMessageFields(d.fields)
  if (fields == null) return null
  return { recipientPubKeyHex: d.pubKeyHex, fields }
}

// ─── TEMPLATE record (TX1) ──────────────────────────────────────────

export interface TemplateFields {
  tokenName: string
  /** 8-byte hex: supply, divisibility, restrictions, version (see encodeTokenRules). */
  tokenRules: string
  /** Covenant script bytes (hex). Empty = no covenant (plain PushDrop tokens). */
  covenantScript: string
  /** Optional 32-byte hex SHA-256 of an embedded file (file bytes live in a FILE output). */
  fileHash?: string
}

export function encodeTemplateFields(data: TemplateFields): number[][] {
  const fields: number[][] = [
    P_PREFIX,
    [P_VERSION],
    [RECORD_TEMPLATE],
    utf8ToBytes(data.tokenName),
    hexToBytes(data.tokenRules),
    hexToBytes(data.covenantScript),
  ]
  if (data.fileHash != null && data.fileHash.length > 0) {
    fields.push(hexToBytes(data.fileHash))
  }
  return fields
}

export function decodeTemplateFields(fields: number[][]): TemplateFields | null {
  if (fields.length < 6) return null
  if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null
  if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null
  if (fields[2].length !== 1 || fields[2][0] !== RECORD_TEMPLATE) return null
  const result: TemplateFields = {
    tokenName: bytesToUtf8(fields[3]),
    tokenRules: bytesToHex(fields[4]),
    // Empty covenant normalizes to "00" via OP_0; treat that as "no covenant".
    covenantScript: isEmptyOrZero(fields[5]) ? '' : bytesToHex(fields[5]),
  }
  if (fields.length >= 7 && fields[6].length === 32) {
    result.fileHash = bytesToHex(fields[6])
  }
  return result
}

/** Build a TX1 template PushDrop locking script, locked to the creator's public key. */
export function buildTemplateScript(creatorPubKeyHex: string, data: TemplateFields): LockingScript {
  return pushDropLock(creatorPubKeyHex, encodeTemplateFields(data))
}

/** Parse a TX1 template output → creator pubkey + template fields, or null. */
export function parseTemplateScript(
  script: LockingScript,
): { creatorPubKeyHex: string; fields: TemplateFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodeTemplateFields(d.fields)
  if (fields == null) return null
  return { creatorPubKeyHex: d.pubKeyHex, fields }
}

// ─── FILE record (TX1, optional) ────────────────────────────────────

export interface FileFields {
  mimeType: string
  fileName: string
  fileBytes: number[]
}

export function encodeFileFields(data: FileFields): number[][] {
  return [
    P_PREFIX,
    [P_VERSION],
    [RECORD_FILE],
    utf8ToBytes(data.mimeType),
    utf8ToBytes(data.fileName),
    data.fileBytes,
  ]
}

export function decodeFileFields(fields: number[][]): FileFields | null {
  if (fields.length < 6) return null
  if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null
  if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null
  if (fields[2].length !== 1 || fields[2][0] !== RECORD_FILE) return null
  return {
    mimeType: bytesToUtf8(fields[3]),
    fileName: bytesToUtf8(fields[4]),
    fileBytes: fields[5],
  }
}

/** Build a FILE PushDrop locking script, locked to the creator's public key. */
export function buildFileScript(creatorPubKeyHex: string, data: FileFields): LockingScript {
  return pushDropLock(creatorPubKeyHex, encodeFileFields(data))
}

export function parseFileScript(
  script: LockingScript,
): { creatorPubKeyHex: string; fields: FileFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodeFileFields(d.fields)
  if (fields == null) return null
  return { creatorPubKeyHex: d.pubKeyHex, fields }
}

// ─── Token rules (8 bytes: 4 × uint16 LE) ───────────────────────────

/**
 *   Bytes 0-1: supply        (whole tokens minted at genesis; 0 = unlimited / replicable)
 *   Bytes 2-3: divisibility  (fragments per whole; 0 = indivisible)
 *   Bytes 4-5: restrictions  (bitfield; see RESTRICTION_*)
 *   Bytes 6-7: version       (rules schema version)
 */
export function encodeTokenRules(
  supply: number,
  divisibility: number,
  restrictions: number,
  version: number,
): string {
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setUint16(0, supply, true)
  view.setUint16(2, divisibility, true)
  view.setUint16(4, restrictions, true)
  view.setUint16(6, version, true)
  return bytesToHex(Array.from(new Uint8Array(buf)))
}

export interface DecodedTokenRules {
  supply: number
  divisibility: number
  restrictions: number
  version: number
  isFungible: boolean
  isReplicable: boolean
  isUnlimited: boolean
  /** Transfers report to the creator (RESTRICTION_TRACK_TRANSFERS) — reserved, see Addendum E. */
  isTracked: boolean
}

export function decodeTokenRules(rulesHex: string): DecodedTokenRules {
  const bytes = hexToBytes(rulesHex)
  const view = new DataView(new Uint8Array(bytes).buffer)
  const supply = view.getUint16(0, true)
  const restrictions = view.getUint16(4, true)
  return {
    supply,
    divisibility: view.getUint16(2, true),
    restrictions,
    version: view.getUint16(6, true),
    isFungible: (restrictions & RESTRICTION_FUNGIBLE) !== 0,
    isReplicable: (restrictions & RESTRICTION_REPLICABLE) !== 0,
    isUnlimited: supply === 0,
    isTracked: (restrictions & RESTRICTION_TRACK_TRANSFERS) !== 0,
  }
}

// ─── Collection ID ──────────────────────────────────────────────────

/**
 * The Collection ID is simply the txid of TX1 (the template transaction), which every token
 * carries as `tx1Ref`. This helper exists for readability/intent at call sites.
 */
export function collectionId(tx1Ref: string): string {
  return tx1Ref
}
