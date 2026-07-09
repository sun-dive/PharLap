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
 *   TEMPLATE (lock = publisher) [ P, version, 0x01, tokenName, tokenRules(8B), covenantScript, fileHash?(32B) ]
 *   FILE     (lock = publisher) [ P, version, 0x03, mimeType, fileName, fileBytes ]
 *
 * Identity = Collection ID = the txid of TX1 (the template transaction), carried by every
 * token as `TX1-ref`. There is no per-token Token ID and no on-chain proof chain — see
 * PLAN.md (Addendum C) and docs/DEVIATIONS_FROM_MPT.md.
 *
 * The PushDrop lock key carries ownership/authorship: the token's lock key is the current
 * owner; the template/file outputs' lock key is the publisher. So the publisher pubkey is
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
/** Reserved for publisher↔holder messages / announcements (encrypted or public). See PLAN.md Addendum E. */
export const RECORD_MESSAGE = 0x04
// 0x05 = RECORD_EDITION (covenant edition token; defined in covenant.ts).
/** Immutable storefront metadata (description + optional public cover image) — a TX1 output, locked to
 *  the publisher. The "what you're buying" face of a collection, public even when the content is encrypted.
 *  See PLAN.md Step 2 (D3): immutable data lives in an immutable record, never in the mutable stateData. */
export const RECORD_STOREFRONT = 0x06
/** A seller's MUTABLE promo note for a collection (review, bonuses, redemption instructions). Public,
 *  locked to the author's pubkey, keyed to a collection. Lives OUTSIDE the frozen edition covenant so a
 *  reseller can overwrite it freely (latest published wins); rides onto a buyer's purchase tx at sale
 *  time so it reaches their wallet. See PLAN.md Step 2 (D3). */
export const RECORD_NOTE = 0x07
/** A key's self-published PROFILE (display alias + small avatar image), locked to its own pubkey and posted
 *  on its own address. Resolved by pubkey (latest-by-height wins) so any reader sees a key's @name + face
 *  without a prior message. Self-gated: only that key funds txs on its address. See profile.ts. */
export const RECORD_PROFILE = 0x08
/** A key's ENCRYPTED self-backup of its local config (alias + address book + prefs), posted on its own
 *  address and ECIES-encrypted to itself — only that key can read it. Resolved by scanning your own address
 *  (latest-by-height wins) on WIF restore. See configBackup.ts. */
export const RECORD_CONFIG = 0x09
/** A publisher's PUBLIC audio preview clip for a collection — a "listen before you buy" sample. Locked to the
 *  publisher's pubkey, keyed to a collection, posted on the publisher's own address and resolved by scan
 *  (latest-by-publisher wins), exactly like a NOTE — but it carries a binary audio payload (mp3), not text, so
 *  it lives in its own record instead of bloating the 3 KB note. Plaintext/public: any prospective buyer (and
 *  the nft.sale curator, which holds no key) plays it with no decryption. See preview.ts. */
export const RECORD_PREVIEW = 0x0A

/** tokenRules restrictions bitfield. */
export const RESTRICTION_FUNGIBLE = 0x0001 // interchangeable amounts (satoshis = units)
export const RESTRICTION_REPLICABLE = 0x0002 // "unlimited mints" edition-replication covenant active
/** Reserved: transfers report to the publisher (1-sat publisher notification) so the publisher can track
 *  current holders. Publisher's explicit, visible choice at mint; private by default. See PLAN.md Addendum E. */
export const RESTRICTION_TRACK_TRANSFERS = 0x0004
/** The embedded file is Tier-1 encrypted: the FILE output holds ciphertext; the template carries the
 *  wrapped content key + keySalt (see contentCrypto / PLAN.md Addendum F). */
export const RESTRICTION_ENCRYPTED = 0x0008
/** The embedded file is gzip-compressed (see compress.ts). Decompress on view, AFTER decrypting if also
 *  encrypted (we always compress before encrypting). Set only when compression actually shrank the file. */
export const RESTRICTION_COMPRESSED = 0x0010

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
  /** Optional 32-byte hex SHA-256 of an embedded file (file bytes live in a FILE output). For encrypted
   *  collections this is SHA-256 of the *ciphertext*. */
  fileHash?: string
  /** Tier-1 encrypted content (Addendum F): wrapped content key + its keySalt. Present together, and only
   *  when fileHash is too. Raw bytes (see contentCrypto). */
  wrappedKey?: number[]
  keySalt?: number[]
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
    // wrappedKey + keySalt ride after fileHash (encrypted content always has all three).
    if (data.wrappedKey != null && data.keySalt != null) {
      fields.push(data.wrappedKey, data.keySalt)
    }
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
  if (fields.length >= 9) {
    result.wrappedKey = fields[7]
    result.keySalt = fields[8]
  }
  return result
}

/** Build a TX1 template PushDrop locking script, locked to the publisher's public key. */
export function buildTemplateScript(publisherPubKeyHex: string, data: TemplateFields): LockingScript {
  return pushDropLock(publisherPubKeyHex, encodeTemplateFields(data))
}

/** Parse a TX1 template output → publisher pubkey + template fields, or null. */
export function parseTemplateScript(
  script: LockingScript,
): { publisherPubKeyHex: string; fields: TemplateFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodeTemplateFields(d.fields)
  if (fields == null) return null
  return { publisherPubKeyHex: d.pubKeyHex, fields }
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

/** Build a FILE PushDrop locking script, locked to the publisher's public key. */
export function buildFileScript(publisherPubKeyHex: string, data: FileFields): LockingScript {
  return pushDropLock(publisherPubKeyHex, encodeFileFields(data))
}

export function parseFileScript(
  script: LockingScript,
): { publisherPubKeyHex: string; fields: FileFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodeFileFields(d.fields)
  if (fields == null) return null
  return { publisherPubKeyHex: d.pubKeyHex, fields }
}

// ─── STOREFRONT record (TX1, optional) ──────────────────────────────
// Immutable "what you're buying" metadata, carried as its own TX1 output so it stays in an immutable
// record (TX1 is the Collection ID tx, never re-created) instead of the mutable stateData field. Every
// edition binds to it via tx1Ref, and it is the public face of a collection even when the content file
// is Tier-1 encrypted. Layout mirrors FILE with a leading description field:
//   [ P, version, RECORD_STOREFRONT, description, coverMimeType, coverFileName, coverBytes ]
// A cover image is optional: when absent, the three cover fields are empty and only the description shows.

export interface StorefrontFields {
  /** Short blurb shown on the collection / sales page (set at mint, immutable). May be empty. */
  description: string
  /** Optional public (unencrypted) cover image. All three cover fields are present together or absent. */
  coverMimeType?: string
  coverFileName?: string
  coverBytes?: number[]
  /** Optional public BACK cover image (flippable on the sales page). Appended after the front cover, so older
   *  storefronts (7 fields) decode unchanged and older wallets ignore the extra fields. Present together or absent. */
  backCoverMimeType?: string
  backCoverFileName?: string
  backCoverBytes?: number[]
}

export function encodeStorefrontFields(data: StorefrontFields): number[][] {
  const out = [
    P_PREFIX,
    [P_VERSION],
    [RECORD_STOREFRONT],
    utf8ToBytes(data.description ?? ''),
    utf8ToBytes(data.coverMimeType ?? ''),
    utf8ToBytes(data.coverFileName ?? ''),
    data.coverBytes ?? [],
  ]
  // Only append the back-cover fields when there's a back cover — no-back-cover storefronts stay byte-identical.
  if (data.backCoverBytes != null && data.backCoverBytes.length > 0) {
    out.push(utf8ToBytes(data.backCoverMimeType ?? ''), utf8ToBytes(data.backCoverFileName ?? ''), data.backCoverBytes)
  }
  return out
}

export function decodeStorefrontFields(fields: number[][]): StorefrontFields | null {
  if (fields.length < 7) return null
  if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null
  if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null
  if (fields[2].length !== 1 || fields[2][0] !== RECORD_STOREFRONT) return null
  // Empty fields round-trip to "00" via OP_0 (see isEmptyOrZero); normalize those back to empty.
  const hasCover = !isEmptyOrZero(fields[6])
  const hasBack = fields.length >= 10 && !isEmptyOrZero(fields[9])
  return {
    description: isEmptyOrZero(fields[3]) ? '' : bytesToUtf8(fields[3]),
    coverMimeType: hasCover ? bytesToUtf8(fields[4]) : undefined,
    coverFileName: hasCover ? bytesToUtf8(fields[5]) : undefined,
    coverBytes: hasCover ? fields[6] : undefined,
    backCoverMimeType: hasBack ? bytesToUtf8(fields[7]) : undefined,
    backCoverFileName: hasBack ? bytesToUtf8(fields[8]) : undefined,
    backCoverBytes: hasBack ? fields[9] : undefined,
  }
}

/** Build a STOREFRONT PushDrop locking script, locked to the publisher's public key. */
export function buildStorefrontScript(publisherPubKeyHex: string, data: StorefrontFields): LockingScript {
  return pushDropLock(publisherPubKeyHex, encodeStorefrontFields(data))
}

export function parseStorefrontScript(
  script: LockingScript,
): { publisherPubKeyHex: string; fields: StorefrontFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodeStorefrontFields(d.fields)
  if (fields == null) return null
  return { publisherPubKeyHex: d.pubKeyHex, fields }
}

// ─── PROFILE record (a key's self-published identity) ───────────────
//   [ P, version, RECORD_PROFILE, alias, avatarMimeType, avatarBytes ]
// Locked to the publisher's own pubkey, posted on their own address; resolved by pubkey. Both fields
// optional: alias-only, avatar-only, or both. The avatar is a small pre-downscaled image (see profile.ts).

export interface ProfileFields {
  alias?: string
  avatarMimeType?: string
  avatarBytes?: number[]
}

export function encodeProfileFields(data: ProfileFields): number[][] {
  return [
    P_PREFIX,
    [P_VERSION],
    [RECORD_PROFILE],
    utf8ToBytes(data.alias ?? ''),
    utf8ToBytes(data.avatarMimeType ?? ''),
    data.avatarBytes ?? [],
  ]
}

export function decodeProfileFields(fields: number[][]): ProfileFields | null {
  if (fields.length < 6) return null
  if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null
  if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null
  if (fields[2].length !== 1 || fields[2][0] !== RECORD_PROFILE) return null
  const hasAvatar = !isEmptyOrZero(fields[5])
  return {
    alias: isEmptyOrZero(fields[3]) ? undefined : bytesToUtf8(fields[3]),
    avatarMimeType: hasAvatar ? bytesToUtf8(fields[4]) : undefined,
    avatarBytes: hasAvatar ? fields[5] : undefined,
  }
}

/** Build a PROFILE PushDrop locking script, locked to the owner's public key. */
export function buildProfileScript(ownerPubKeyHex: string, data: ProfileFields): LockingScript {
  return pushDropLock(ownerPubKeyHex, encodeProfileFields(data))
}

export function parseProfileScript(
  script: LockingScript,
): { ownerPubKeyHex: string; fields: ProfileFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodeProfileFields(d.fields)
  if (fields == null) return null
  return { ownerPubKeyHex: d.pubKeyHex, fields }
}

// ─── NOTE record (seller's mutable promo note) ──────────────────────
// A public, author-locked note keyed to a collection: [ P, version, RECORD_NOTE, collectionRef(32), text ].
// Published standalone by a seller (discoverable via their address history) and/or carried on a buyer's
// purchase tx as the notification output. Not part of the edition covenant, so it is freely mutable.

/** Optional bonus a seller attaches to a note, claimable by the buyer. */
export type BonusKind = 'link' | 'code'
// Trailing note fields are TYPED PAIRs: a 1-byte type marker + its value. Extensible and backward-compatible
// (old notes' bonus pair still reads; old clients reading new notes ignore unknown trailing pairs, and — since
// the bonus is written first — still find the bonus where they expect it).
const BONUS_LINK = 1
const BONUS_CODE = 2
const NOTE_HEADING = 3 // a seller-authored listing heading (distinct from the immutable collection title)
const NOTE_TAGS = 4    // space/comma-separated category hashtags

export interface NoteFields {
  /** Collection id (TX1 txid, 32-byte hex) this note is about. */
  collectionRef: string
  /** The note text (UTF-8) — the listing description / promo. */
  text: string
  /** Optional seller-authored listing heading (updatable; not the immutable collection title). */
  heading?: string
  /** Optional category tags (slug-like, no leading '#'). */
  tags?: string[]
  /** Optional buyer bonus: an external link (seller's site delivers it) or a redeemable code. */
  bonusKind?: BonusKind
  bonusValue?: string
}

export function encodeNoteFields(data: NoteFields): number[][] {
  const fields: number[][] = [
    P_PREFIX,
    [P_VERSION],
    [RECORD_NOTE],
    hexToBytes(data.collectionRef),
    utf8ToBytes(data.text),
  ]
  // Bonus FIRST (so an un-updated client still reads it at fields[5..6]), then the new typed pairs.
  if (data.bonusKind != null && data.bonusValue != null && data.bonusValue.length > 0) {
    fields.push([data.bonusKind === 'link' ? BONUS_LINK : BONUS_CODE], utf8ToBytes(data.bonusValue))
  }
  if (data.heading != null && data.heading.length > 0) fields.push([NOTE_HEADING], utf8ToBytes(data.heading))
  if (data.tags != null && data.tags.length > 0) fields.push([NOTE_TAGS], utf8ToBytes(data.tags.join(' ')))
  return fields
}

export function decodeNoteFields(fields: number[][]): NoteFields | null {
  if (fields.length < 5) return null
  if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null
  if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null
  if (fields[2].length !== 1 || fields[2][0] !== RECORD_NOTE) return null
  if (fields[3].length !== 32) return null
  const result: NoteFields = {
    collectionRef: bytesToHex(fields[3]),
    text: isEmptyOrZero(fields[4]) ? '' : bytesToUtf8(fields[4]),
  }
  // Trailing typed pairs (any order): [typeByte][value].
  for (let i = 5; i + 1 < fields.length; i += 2) {
    const type = fields[i].length === 1 ? fields[i][0] : 0
    const val = fields[i + 1]
    if (type === BONUS_LINK || type === BONUS_CODE) { result.bonusKind = type === BONUS_LINK ? 'link' : 'code'; result.bonusValue = bytesToUtf8(val) }
    else if (type === NOTE_HEADING) { result.heading = bytesToUtf8(val) }
    else if (type === NOTE_TAGS) { const t = bytesToUtf8(val).split(/[\s,]+/).filter(Boolean); if (t.length > 0) result.tags = t }
  }
  return result
}

/** Build a NOTE PushDrop locking script, locked to the author's public key. */
export function buildNoteScript(authorPubKeyHex: string, data: NoteFields): LockingScript {
  return pushDropLock(authorPubKeyHex, encodeNoteFields(data))
}

export function parseNoteScript(
  script: LockingScript,
): { authorPubKeyHex: string; fields: NoteFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodeNoteFields(d.fields)
  if (fields == null) return null
  return { authorPubKeyHex: d.pubKeyHex, fields }
}

// ─── PREVIEW record (a publisher's public audio sample) ─────────────
//   [ P, version, RECORD_PREVIEW, collectionRef(32B), mimeType, previewBytes ]
// Collection-keyed like NOTE + binary payload like FILE. Locked to the publisher's pubkey, posted on their own
// address; resolved by scanning that address (latest-by-publisher wins). Public/plaintext — no encryption.

export interface PreviewFields {
  /** Collection id (TX1 txid, 32-byte hex) this preview is for. */
  collectionRef: string
  /** Audio MIME (e.g. 'audio/mpeg' for mp3). */
  mimeType: string
  /** The preview clip bytes (a short public sample; ~200–500 KB). */
  previewBytes: number[]
}

export function encodePreviewFields(data: PreviewFields): number[][] {
  return [
    P_PREFIX,
    [P_VERSION],
    [RECORD_PREVIEW],
    hexToBytes(data.collectionRef),
    utf8ToBytes(data.mimeType),
    data.previewBytes,
  ]
}

export function decodePreviewFields(fields: number[][]): PreviewFields | null {
  if (fields.length < 6) return null
  if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null
  if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null
  if (fields[2].length !== 1 || fields[2][0] !== RECORD_PREVIEW) return null
  if (fields[3].length !== 32) return null
  return {
    collectionRef: bytesToHex(fields[3]),
    mimeType: bytesToUtf8(fields[4]),
    previewBytes: fields[5],
  }
}

/** Build a PREVIEW PushDrop locking script, locked to the publisher's public key. */
export function buildPreviewScript(publisherPubKeyHex: string, data: PreviewFields): LockingScript {
  return pushDropLock(publisherPubKeyHex, encodePreviewFields(data))
}

export function parsePreviewScript(
  script: LockingScript,
): { publisherPubKeyHex: string; fields: PreviewFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodePreviewFields(d.fields)
  if (fields == null) return null
  return { publisherPubKeyHex: d.pubKeyHex, fields }
}

// ─── CONFIG record (a key's encrypted self-backup) ──────────────────
//   [ P, version, RECORD_CONFIG, envelope ]
// Locked to your own pubkey, posted on your own address. The `envelope` is an ECIES-to-self message envelope
// (see messageCodec) carrying the JSON config blob, so only your key decrypts it. Resolved latest-by-height.

export interface ConfigFields {
  /** Encrypted-to-self envelope bytes (header + ECIES body) carrying the config JSON. */
  envelope: number[]
}

export function encodeConfigFields(data: ConfigFields): number[][] {
  return [P_PREFIX, [P_VERSION], [RECORD_CONFIG], data.envelope]
}

export function decodeConfigFields(fields: number[][]): ConfigFields | null {
  if (fields.length < 4) return null
  if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null
  if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null
  if (fields[2].length !== 1 || fields[2][0] !== RECORD_CONFIG) return null
  return { envelope: fields[3] }
}

/** Build a CONFIG PushDrop locking script, locked to the owner's own public key. */
export function buildConfigScript(ownerPubKeyHex: string, data: ConfigFields): LockingScript {
  return pushDropLock(ownerPubKeyHex, encodeConfigFields(data))
}

export function parseConfigScript(
  script: LockingScript,
): { ownerPubKeyHex: string; fields: ConfigFields } | null {
  const d = pushDropDecode(script)
  if (d == null) return null
  const fields = decodeConfigFields(d.fields)
  if (fields == null) return null
  return { ownerPubKeyHex: d.pubKeyHex, fields }
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
  /** Transfers report to the publisher (RESTRICTION_TRACK_TRANSFERS) — reserved, see Addendum E. */
  isTracked: boolean
  /** The embedded file is Tier-1 encrypted (RESTRICTION_ENCRYPTED) — see Addendum F. */
  isEncrypted: boolean
  /** The embedded file is gzip-compressed (RESTRICTION_COMPRESSED) — decompress after decrypt. */
  isCompressed: boolean
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
    isEncrypted: (restrictions & RESTRICTION_ENCRYPTED) !== 0,
    isCompressed: (restrictions & RESTRICTION_COMPRESSED) !== 0,
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
