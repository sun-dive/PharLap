// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP — miner-enforced covenant scripts, built on the OP_PUSH_TX primitive (`./pushtx`).
 *
 * The covenant verifies the spending transaction's sighash preimage in-script (so it is provably
 * genuine), then reads `hashOutputs` from the preimage and forces the spending tx to contain a
 * specific set of outputs — by reconstructing those outputs and asserting
 * `HASH256(reconstructed) == hashOutputs`. The spender may append arbitrary trailing outputs
 * (their own change), which they supply in the unlocking script; they cannot alter the enforced
 * prefix.
 *
 * Layers (built incrementally, each validated against the @bsv/sdk 2.x `Spend` interpreter):
 *   L1 — enforce a fixed-bytes output prefix + spender-supplied trailing outputs.  ← this file
 *   L2 — reconstruct the "token returned to holder" output from the script's own bytes (quine).
 *   L3 — reconstruct the buyer's replica output (same covenant, buyer's pubkey substituted).
 *   L4 — creator-fee + holder-fee P2PKH outputs (Addendum A edition-mint layout).
 *   L5 — transfer/replicate branching + wiring into tokenCodec/collectionBuilder.
 */
import { OP, LockingScript, Utils, type ScriptChunk } from '@bsv/sdk'
import { pushTxVerifyOps, pushData, type PushTxConstants, pushTxConstants } from './pushtx.ts'

const op = (code: number): ScriptChunk => ({ op: code })

/** Little-endian 8-byte satoshi amount. */
export function u64le(n: number): number[] {
  const out: number[] = []
  let v = n
  for (let i = 0; i < 8; i++) { out.push(v & 0xff); v = Math.floor(v / 256) }
  return out
}

/** Minimal little-endian script-number encoding of a non-negative integer (for OP_SPLIT indices). */
export function numLE(n: number): number[] {
  if (n === 0) return []
  const out: number[] = []
  let v = n
  while (v > 0) { out.push(v & 0xff); v = Math.floor(v / 256) }
  if ((out[out.length - 1] & 0x80) !== 0) out.push(0x00)
  return out
}

/** Bitcoin var-int (CompactSize). */
export function varInt(n: number): number[] {
  if (n < 0xfd) return [n]
  if (n <= 0xffff) return [0xfd, n & 0xff, (n >> 8) & 0xff]
  if (n <= 0xffffffff) return [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
  throw new Error('varInt: value too large')
}

/** Serialize a tx output exactly as it appears inside hashOutputs: value(8 LE) ‖ varint(len) ‖ script. */
export function serializeOutput(satoshis: number, scriptBytes: number[]): number[] {
  return [...u64le(satoshis), ...varInt(scriptBytes.length), ...scriptBytes]
}

/** Standard 25-byte P2PKH locking script for a 20-byte pubkey hash. */
export function p2pkhScript(hash20: number[]): number[] {
  return [0x76, 0xa9, 0x14, ...hash20, 0x88, 0xac] // OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
}

/**
 * Op fragment: consumes the verified preimage on top of the stack and leaves `hashOutputs` (32 bytes).
 * hashOutputs sits at preimage bytes [len-40, len-8): the trailing 52 bytes are
 * value(8) ‖ nSequence(4) ‖ hashOutputs(32) ‖ nLocktime(4) ‖ sighashType(4).
 */
export function extractHashOutputsOps(): ScriptChunk[] {
  return [
    op(OP.OP_SIZE), pushData([40]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP), // tail 40 bytes
    pushData([32]), op(OP.OP_SPLIT), op(OP.OP_DROP),                               // first 32 = hashOutputs
  ]
}

/**
 * Op fragment: consumes the verified preimage and leaves the `scriptCode` FIELD (varint(len) ‖ script).
 * That field is exactly the `varint(scriptLen) ‖ script` portion of an output serialization, so it can
 * be concatenated straight after an 8-byte value to rebuild "an output paying this same script".
 *
 * Preimage layout: version(4) ‖ hashPrevouts(32) ‖ hashSequence(32) ‖ outpoint(36) ‖ scriptCodeField
 * ‖ value(8) ‖ nSequence(4) ‖ hashOutputs(32) ‖ nLocktime(4) ‖ sighashType(4). So the field is bytes
 * [104, len-52) — a fixed prefix (104) and a fixed suffix (52), independent of script length and of
 * whether ANYONECANPAY zeroed the prevout/sequence hashes (still 32 bytes each).
 */
export function extractScriptCodeFieldOps(): ScriptChunk[] {
  return [
    pushData([104]), op(OP.OP_SPLIT), op(OP.OP_NIP),                                  // drop 104-byte prefix
    op(OP.OP_SIZE), pushData([52]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_DROP),   // drop 52-byte suffix
  ]
}

/**
 * L2 self-replicating ("quine") covenant. Stack on entry: [ spenderOutputs, preimage ].
 * Forces output[0] to pay `tokenSats` to the SAME script that is currently executing (extracted from
 * the preimage's scriptCode — no second copy embedded), then `spenderOutputs` for the rest. Leaves a
 * boolean. A token under this covenant can only be spent into a copy of itself.
 */
export function selfReplicateCovenantOps(tokenSats = 1, c: PushTxConstants = pushTxConstants()): ScriptChunk[] {
  return [
    ...pushTxVerifyOps(c),            // [ spenderOutputs, preimage ]
    op(OP.OP_DUP),                    // [ spenderOutputs, preimage, preimage ]
    ...extractHashOutputsOps(),       // [ spenderOutputs, preimage, hashOutputs ]
    op(OP.OP_SWAP),                   // [ spenderOutputs, hashOutputs, preimage ]
    ...extractScriptCodeFieldOps(),   // [ spenderOutputs, hashOutputs, scriptCodeField ]
    pushData(u64le(tokenSats)), op(OP.OP_SWAP), op(OP.OP_CAT), // [ .., hashOutputs, out0 = value ‖ field ]
    op(OP.OP_ROT), op(OP.OP_CAT),     // [ hashOutputs, out0 ‖ spenderOutputs ]
    op(OP.OP_HASH256), op(OP.OP_EQUAL),
  ]
}

/**
 * L3 pubkey-substitution covenant. Re-creates the covenant in output[0] but with the 33-byte owner
 * pubkey replaced by one supplied in the unlocking script — the basis for a buyer's replica (owner =
 * buyer) and for an enforced transfer (owner = recipient).
 *
 * `fieldPubkeyOffset` is the byte offset of the owner pubkey *within the scriptCode field*
 * (= varIntSize(scriptLen) + offset-of-pubkey-within-the-script); the caller computes it from the
 * token's layout. Swapping a 33-byte key for another leaves the script length — and thus the varint —
 * unchanged, so we mutate the field in place.
 *
 * Stack on entry (top last): [ spenderOutputs, newOwnerPubKey, preimage ]. Leaves a boolean.
 */
export function swapPubkeyOut0CovenantOps(fieldPubkeyOffset: number, tokenSats = 1, c: PushTxConstants = pushTxConstants()): ScriptChunk[] {
  return [
    ...pushTxVerifyOps(c),                                  // [ rest, newPub, preimage ]
    op(OP.OP_DUP),
    ...extractHashOutputsOps(),                             // [ rest, newPub, preimage, hashOutputs ]
    op(OP.OP_SWAP),                                         // [ rest, newPub, hashOutputs, preimage ]
    ...extractScriptCodeFieldOps(),                         // [ rest, newPub, hashOutputs, scFld ]
    pushData(numLE(fieldPubkeyOffset)), op(OP.OP_SPLIT),    // [ .., pre, oldPub‖suffix ]
    pushData([33]), op(OP.OP_SPLIT), op(OP.OP_NIP),         // [ .., pre, suffix ]  (drop oldPub)
    op(OP.OP_TOALTSTACK),                                   // alt:[suffix];  [ rest, newPub, hashOutputs, pre ]
    op(OP.OP_2), op(OP.OP_ROLL),                            // [ rest, hashOutputs, pre, newPub ]
    op(OP.OP_CAT),                                          // [ rest, hashOutputs, pre‖newPub ]
    op(OP.OP_FROMALTSTACK), op(OP.OP_CAT),                  // [ rest, hashOutputs, modifiedField ]
    pushData(u64le(tokenSats)), op(OP.OP_SWAP), op(OP.OP_CAT), // [ rest, hashOutputs, out0 ]
    op(OP.OP_ROT), op(OP.OP_CAT),                           // [ hashOutputs, out0‖rest ]
    op(OP.OP_HASH256), op(OP.OP_EQUAL),
  ]
}

export interface ReplicateParams {
  /** Offset of the 33-byte owner pubkey within the scriptCode FIELD (varIntSize(scriptLen) + offset-in-script). */
  fieldPubkeyOffset: number
  /** Satoshis on the token (and replica) outputs. Default 1. */
  tokenSats?: number
  /** 20-byte hash160 of the immutable creator address (fee recipient). */
  creatorPubKeyHash: number[]
  /** Fixed fees (sats). */
  creatorFeeSats: number
  holderFeeSats: number
  c?: PushTxConstants
}

/**
 * L4 — Addendum A "unlimited mints" replicate branch. Permissionlessly enforces (no holder signature):
 *   out[0] token returned to the holder  (covenant re-created verbatim — same owner)
 *   out[1] replica to the buyer          (covenant re-created with owner = buyer pubkey)
 *   out[2] creator fee                   (P2PKH to the immutable creator address, fixed sats)
 *   out[3] holder fee                    (P2PKH to the current holder, derived in-script from the owner pubkey)
 *   out[4+] buyer change                 (spender-supplied)
 *
 * Stack on entry (top last): [ buyerChange, buyerPubKey, preimage ]. Leaves a boolean.
 *
 * NOTE: pair this with a SIGHASH_ANYONECANPAY|ALL|FORKID preimage in production so any buyer can add
 * funding inputs without invalidating the holder's outpoint commitment. The output enforcement here is
 * identical regardless of ANYONECANPAY.
 */
/**
 * Shared covenant prefix (runs once, before any branch). Verifies the preimage, stashes hashOutputs
 * on the alt stack, extracts the scriptCode field, and splits it at the owner-pubkey offset into the
 * three reusable pieces. Stack on entry: [ ..., preimage ]. On exit: [ ..., pre, ownerPub, suffix ]
 * with alt = [ hashOutputs ]. `pre` = scriptCode field up to the owner pubkey; `suffix` = the rest.
 */
export function covenantPrefixOps(fieldPubkeyOffset: number, c: PushTxConstants = pushTxConstants()): ScriptChunk[] {
  return [
    ...pushTxVerifyOps(c),
    op(OP.OP_DUP),
    ...extractHashOutputsOps(), op(OP.OP_TOALTSTACK),       // alt:[hashOutputs]
    ...extractScriptCodeFieldOps(),                         // [ ..., scFld ]
    pushData(numLE(fieldPubkeyOffset)), op(OP.OP_SPLIT),    // [ ..., pre, ownerPub‖suffix ]
    pushData([33]), op(OP.OP_SPLIT),                        // [ ..., pre, ownerPub, suffix ]
  ]
}

/**
 * Replicate tail (Addendum A). Stack on entry: [ buyerChange, buyerPub, pre, ownerPub, suffix ],
 * alt = [ hashOutputs ]. Enforces out[0] token→holder (verbatim), out[1] replica→buyer (owner swapped),
 * out[2] creator fee, out[3] holder fee, out[4+] buyerChange. Leaves a boolean.
 */
export function replicateTailOps(p: {
  tokenSats?: number; creatorPubKeyHash: number[]; creatorFeeSats: number; holderFeeSats: number
}): ScriptChunk[] {
  const VALUE1 = u64le(p.tokenSats ?? 1)
  const OUT2 = serializeOutput(p.creatorFeeSats, p2pkhScript(p.creatorPubKeyHash)) // constant
  const C3pre = [...u64le(p.holderFeeSats), 0x19, 0x76, 0xa9, 0x14] // value ‖ varint(25) ‖ OP_DUP OP_HASH160 PUSH20
  const C3suf = [0x88, 0xac]                                        // OP_EQUALVERIFY OP_CHECKSIG
  return [
    // out0 = VALUE1 ‖ pre ‖ ownerPub ‖ suffix (token back to holder, verbatim)
    pushData(VALUE1),
    pushData([3]), op(OP.OP_PICK), op(OP.OP_CAT),
    pushData([2]), op(OP.OP_PICK), op(OP.OP_CAT),
    pushData([1]), op(OP.OP_PICK), op(OP.OP_CAT),
    // out1 = VALUE1 ‖ pre ‖ buyerPub ‖ suffix (replica to buyer)
    pushData(VALUE1),
    pushData([4]), op(OP.OP_PICK), op(OP.OP_CAT),
    pushData([5]), op(OP.OP_PICK), op(OP.OP_CAT),
    pushData([2]), op(OP.OP_PICK), op(OP.OP_CAT),
    op(OP.OP_CAT),                                              // out0 ‖ out1
    pushData(OUT2), op(OP.OP_CAT),                              // ‖ out2 (creator fee, constant)
    pushData(C3pre), op(OP.OP_CAT),
    pushData([2]), op(OP.OP_PICK), op(OP.OP_HASH160), op(OP.OP_CAT), // ‖ HASH160(ownerPub)
    pushData(C3suf), op(OP.OP_CAT),                            // → out3 (holder fee)
    pushData([5]), op(OP.OP_ROLL), op(OP.OP_CAT),             // ‖ buyerChange → expected
    op(OP.OP_TOALTSTACK), op(OP.OP_2DROP), op(OP.OP_2DROP),   // stash expected; drop 4 leftover pieces
    op(OP.OP_FROMALTSTACK), op(OP.OP_HASH256),
    op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  ]
}

/**
 * Transfer tail (owner-signed, enforced). Stack on entry:
 * [ change, newOwnerPub, ownerSig, pre, ownerPub, suffix ], alt = [ hashOutputs ].
 * Verifies the current owner authorized the move (OP_CHECKSIGVERIFY against the extracted ownerPub),
 * then forces out[0] to re-create the covenant with owner = newOwnerPub (value preserved), out[1+] change.
 */
export function transferTailOps(p: { tokenSats?: number }): ScriptChunk[] {
  const VALUE1 = u64le(p.tokenSats ?? 1)
  return [
    // authenticate current owner: <ownerSig> <ownerPub> OP_CHECKSIGVERIFY
    pushData([1]), op(OP.OP_PICK),                 // copy ownerPub
    pushData([4]), op(OP.OP_PICK),                 // copy ownerSig
    op(OP.OP_SWAP), op(OP.OP_CHECKSIGVERIFY),
    // out0 = VALUE1 ‖ pre ‖ newOwnerPub ‖ suffix
    pushData(VALUE1),
    pushData([3]), op(OP.OP_PICK), op(OP.OP_CAT),  // ‖ pre
    pushData([5]), op(OP.OP_PICK), op(OP.OP_CAT),  // ‖ newOwnerPub
    pushData([1]), op(OP.OP_PICK), op(OP.OP_CAT),  // ‖ suffix → out0
    pushData([6]), op(OP.OP_ROLL), op(OP.OP_CAT),  // ‖ change → expected
    op(OP.OP_TOALTSTACK), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_DROP), // drop 5 leftover pieces
    op(OP.OP_FROMALTSTACK), op(OP.OP_HASH256),
    op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  ]
}

/** Standalone replicate covenant (L4 test/reference): prefix + replicate tail. Entry [change, buyerPub, preimage]. */
export function replicateBranchOps(p: ReplicateParams): ScriptChunk[] {
  return [...covenantPrefixOps(p.fieldPubkeyOffset, p.c ?? pushTxConstants()), ...replicateTailOps(p)]
}

// --- Covenant v2 (Addendum G): replicate with a COMPUTED percentage split of the reseller's price ---

export interface ReplicateV2Params {
  tokenSats?: number
  /** 20-byte hash160 of the immutable creator fee address. */
  creatorPubKeyHash: number[]
  /** Creator fee in BASIS POINTS (0–10000): creatorCut = ⌊P × cBps / 10000⌋. */
  cBps: number
  c?: PushTxConstants
}

/**
 * v2 replicate tail. Stack on entry: [ buyerChange, buyerPub, pre, ownerPub, suffix ], alt = [ hashOutputs ].
 * Reads the price P from the edition's price field (the first field in `suffix`) and enforces:
 *   out[0] token→holder (verbatim)   out[1] replica→buyer (owner swapped, price carried verbatim)
 *   out[2] = ⌊P×cBps/10000⌋  → creator P2PKH (baked hash)
 *   out[3] = P − creatorCut   → reseller P2PKH (hash160 of the owner pubkey)
 *   out[4+] buyerChange
 * cBps (≤10000) guarantees creatorCut ≤ P, so resellerCut ≥ 0. Reseller absorbs integer-division dust.
 */
export function replicateTailV2Ops(p: ReplicateV2Params): ScriptChunk[] {
  const VALUE1 = u64le(p.tokenSats ?? 1)
  const CREATOR_P2PKH = [0x19, ...p2pkhScript(p.creatorPubKeyHash)] // varint(25) ‖ 25-byte P2PKH (value computed)
  const RESELLER_PRE = [0x19, 0x76, 0xa9, 0x14]                     // varint(25) ‖ OP_DUP OP_HASH160 PUSH20
  const RESELLER_SUF = [0x88, 0xac]                                 // OP_EQUALVERIFY OP_CHECKSIG
  return [
    // out0 = VALUE1 ‖ pre ‖ ownerPub ‖ suffix (token back to holder, verbatim)
    pushData(VALUE1),
    pushData([3]), op(OP.OP_PICK), op(OP.OP_CAT),
    pushData([2]), op(OP.OP_PICK), op(OP.OP_CAT),
    pushData([1]), op(OP.OP_PICK), op(OP.OP_CAT),
    // out1 = VALUE1 ‖ pre ‖ buyerPub ‖ suffix (replica to buyer; price carried in suffix)
    pushData(VALUE1),
    pushData([4]), op(OP.OP_PICK), op(OP.OP_CAT),
    pushData([5]), op(OP.OP_PICK), op(OP.OP_CAT),
    pushData([2]), op(OP.OP_PICK), op(OP.OP_CAT),
    op(OP.OP_CAT),                                                  // out0‖out1   stack: [.., suffix, out0out1]
    // Extract P from a COPY of suffix (price = first field; skip its 1-byte push opcode, take 8 bytes).
    pushData([1]), op(OP.OP_PICK),
    pushData([1]), op(OP.OP_SPLIT), op(OP.OP_NIP),
    pushData([8]), op(OP.OP_SPLIT), op(OP.OP_DROP),
    op(OP.OP_BIN2NUM),                                              // [.., out0out1, P]
    // creatorCut = ⌊P×cBps/10000⌋ ; resellerCut = P − creatorCut
    op(OP.OP_DUP), pushData(numLE(p.cBps)), op(OP.OP_MUL), pushData(numLE(10000)), op(OP.OP_DIV),
    op(OP.OP_TUCK), op(OP.OP_SUB),                                  // [.., out0out1, creatorCut, resellerCut]
    op(OP.OP_8), op(OP.OP_NUM2BIN),                                 // resellerCut → 8-byte LE
    op(OP.OP_SWAP), op(OP.OP_8), op(OP.OP_NUM2BIN),                 // [.., out0out1, resellerCut8, creatorCut8]
    // out2 = creatorCut8 ‖ CREATOR_P2PKH ; prepend out0out1
    pushData(CREATOR_P2PKH), op(OP.OP_CAT),                         // [.., out0out1, resellerCut8, out2]
    pushData([2]), op(OP.OP_ROLL), op(OP.OP_SWAP), op(OP.OP_CAT),   // out0out1‖out2   [.., resellerCut8, out012]
    // out3 = resellerCut8 ‖ RESELLER_PRE ‖ HASH160(ownerPub) ‖ RESELLER_SUF ; append
    op(OP.OP_SWAP), op(OP.OP_CAT),                                  // out012‖resellerCut8
    pushData(RESELLER_PRE), op(OP.OP_CAT),
    pushData([2]), op(OP.OP_PICK), op(OP.OP_HASH160), op(OP.OP_CAT),
    pushData(RESELLER_SUF), op(OP.OP_CAT),                          // → out0123   [.., suffix, ..., out0123]
    // ‖ buyerChange → expected ; compare HASH256 to hashOutputs
    pushData([5]), op(OP.OP_ROLL), op(OP.OP_CAT),
    op(OP.OP_TOALTSTACK), op(OP.OP_2DROP), op(OP.OP_2DROP),
    op(OP.OP_FROMALTSTACK), op(OP.OP_HASH256),
    op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  ]
}

/** Standalone v2 replicate covenant (prefix + v2 tail), for isolated Spend validation. */
export function replicateBranchV2Ops(p: ReplicateV2Params & { fieldPubkeyOffset: number }): ScriptChunk[] {
  return [...covenantPrefixOps(p.fieldPubkeyOffset, p.c ?? pushTxConstants()), ...replicateTailV2Ops(p)]
}

// --- L5: the real edition token (data fields + transfer/replicate branches) ---

/** SIGHASH used for the covenant's OP_PUSH_TX introspection: ANYONECANPAY|ALL|FORKID (0xc1). */
export const EDITION_SCOPE = 0xc1
/** Record type byte for a covenant edition token (0x01-0x04 are TEMPLATE/TOKEN/FILE/MESSAGE). */
export const RECORD_EDITION = 0x05

/** Serialized byte length of a minimal-length-prefixed data push (matches `pushData`). */
function serializedPushLen(data: number[]): number {
  if (data.length < 76) return 1 + data.length
  if (data.length < 256) return 2 + data.length
  if (data.length < 65536) return 3 + data.length
  return 5 + data.length
}

export interface EditionFields {
  /** Protocol prefix, default [0x50] ("P"). */
  prefix?: number[]
  /** Format version, default [0x03]. */
  version?: number[]
  /** Collection id = TX1 txid (32 bytes). */
  tx1Ref: number[]
  /** 33-byte compressed owner pubkey. */
  ownerPubKey: number[]
  /** v2: fixed-length 8-byte LE price in sats (the reseller's chosen price; the covenant reads it to compute
   *  the percentage split). Carried verbatim into replicas. Default 0. Placed AFTER the owner pubkey so the
   *  owner offset (40) stays fixed. */
  price?: number[]
  /** Mutable per-token state (cloned verbatim into replicas). */
  stateData: number[]
}

/** Normalize a price to the fixed 8-byte LE field the covenant carries (pad LE with zeros; default 0). */
export function editionPriceField(price?: number[]): number[] {
  const p = price ?? []
  if (p.length > 8) throw new Error('editionPriceField: price must be ≤ 8 bytes')
  return [...p, ...new Array(8 - p.length).fill(0)]
}

export interface EditionParams extends EditionFields {
  tokenSats?: number
  /** 20-byte hash160 of the immutable creator fee address. */
  creatorPubKeyHash: number[]
  creatorFeeSats: number
  holderFeeSats: number
  /** Offset of the owner pubkey within the scriptCode field (use buildEditionLock to compute it). */
  fieldPubkeyOffset: number
  c?: PushTxConstants
}

/** v2 edition params: percentage split (cBps) instead of fixed fee amounts (Addendum G). */
export interface EditionV2Params extends EditionFields {
  tokenSats?: number
  /** 20-byte hash160 of the immutable creator fee address. */
  creatorPubKeyHash: number[]
  /** Creator fee in basis points (0–10000). */
  cBps: number
  fieldPubkeyOffset: number
  c?: PushTxConstants
}

/** Edition data-field chunks: [P, version, RECORD_EDITION, tx1Ref, ownerPubKey, price(8), stateData]. */
function editionFieldChunks(f: EditionFields): ScriptChunk[] {
  return [
    pushData(f.prefix ?? [0x50]),
    pushData(f.version ?? [0x03]),
    pushData([RECORD_EDITION]),
    pushData(f.tx1Ref),
    pushData(f.ownerPubKey),
    pushData(editionPriceField(f.price)),
    pushData(f.stateData),
  ]
}

/**
 * Full edition-token locking script ops:
 *   <7 data fields> OP_2DROP OP_2DROP OP_2DROP OP_DROP  (carry token metadata on-chain, then clear the stack)
 *   <shared covenant prefix>                     (verify preimage; extract hashOutputs + scriptCode pieces)
 *   <selector> OP_IF <transfer tail> OP_ELSE <replicate tail> OP_ENDIF
 * Use `buildEditionLock` instead of calling this directly — it computes `fieldPubkeyOffset` for you.
 */
export function editionLockOps(p: EditionParams): ScriptChunk[] {
  const c = p.c ?? pushTxConstants(EDITION_SCOPE)
  return [
    ...editionFieldChunks(p),
    op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_DROP), // 7 fields
    ...covenantPrefixOps(p.fieldPubkeyOffset, c),
    pushData([3]), op(OP.OP_ROLL),                          // bring the branch selector to the top
    op(OP.OP_IF),
    ...transferTailOps({ tokenSats: p.tokenSats }),
    op(OP.OP_ELSE),
    ...replicateTailOps(p),
    op(OP.OP_ENDIF),
  ]
}

/**
 * Build the edition-token locking script, computing the owner-pubkey offset from the field layout.
 * The owner pubkey sits before the variable-length stateData, so its offset is constant for a
 * collection. (Two-pass: the offset push is the same byte-width whether the script is being probed
 * or finalised, so the length used to size the scriptCode varint is stable.)
 */
export function buildEditionLock(p: Omit<EditionParams, 'fieldPubkeyOffset'>): LockingScript {
  const before = [p.prefix ?? [0x50], p.version ?? [0x03], [RECORD_EDITION], p.tx1Ref]
  const O = before.reduce((s, f) => s + serializedPushLen(f), 0) + 1 // +1 for the ownerPubKey push opcode
  const probeLen = new LockingScript(editionLockOps({ ...p, fieldPubkeyOffset: 1 })).toBinary().length
  const varIntSize = probeLen < 253 ? 1 : probeLen < 65536 ? 3 : 5
  return new LockingScript(editionLockOps({ ...p, fieldPubkeyOffset: varIntSize + O }))
}

/** v2 edition lock ops: identical shape to v1 but the replicate branch enforces the percentage split. */
export function editionLockV2Ops(p: EditionV2Params): ScriptChunk[] {
  const c = p.c ?? pushTxConstants(EDITION_SCOPE)
  return [
    ...editionFieldChunks(p),
    op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_DROP), // 7 fields
    ...covenantPrefixOps(p.fieldPubkeyOffset, c),
    pushData([3]), op(OP.OP_ROLL),
    op(OP.OP_IF),
    ...transferTailOps({ tokenSats: p.tokenSats }),
    op(OP.OP_ELSE),
    ...replicateTailV2Ops({ tokenSats: p.tokenSats, creatorPubKeyHash: p.creatorPubKeyHash, cBps: p.cBps, c }),
    op(OP.OP_ENDIF),
  ]
}

/** Format version byte marking a v2 (percentage-pricing) edition covenant. */
export const EDITION_VERSION_V2 = 0x04

/** Build a v2 edition locking script (computes the owner-pubkey offset like buildEditionLock; version 0x04). */
export function buildEditionLockV2(p: Omit<EditionV2Params, 'fieldPubkeyOffset'>): LockingScript {
  const pv = { ...p, version: p.version ?? [EDITION_VERSION_V2] }
  const before = [pv.prefix ?? [0x50], pv.version, [RECORD_EDITION], pv.tx1Ref]
  const O = before.reduce((s, f) => s + serializedPushLen(f), 0) + 1
  const probeLen = new LockingScript(editionLockV2Ops({ ...pv, fieldPubkeyOffset: 1 })).toBinary().length
  const varIntSize = probeLen < 253 ? 1 : probeLen < 65536 ? 3 : 5
  return new LockingScript(editionLockV2Ops({ ...pv, fieldPubkeyOffset: varIntSize + O }))
}

/**
 * Byte offset of the 33-byte owner pubkey within the edition locking script, for the canonical field
 * layout (prefix/version/record are 1-byte: P(2)+ver(2)+record(2)+tx1Ref(33)+pushOpcode(1) = 40).
 */
export const EDITION_OWNER_SCRIPT_OFFSET = 40

/**
 * Byte offset of the 8-byte LE price field within the edition locking script: owner pubkey occupies 40..72
 * (33 bytes), then the price push opcode (0x08) at 73, then the price bytes at 74..81.
 */
export const EDITION_PRICE_SCRIPT_OFFSET = 74

/** Extract the 8-byte LE price field from an edition locking script (JS mirror of the in-script read). */
export function editionPrice(lockBytes: number[]): number[] {
  return lockBytes.slice(EDITION_PRICE_SCRIPT_OFFSET, EDITION_PRICE_SCRIPT_OFFSET + 8)
}

/** Return a copy of an edition locking script with the owner pubkey replaced (JS mirror of the in-script swap). */
export function swapEditionOwner(lockBytes: number[], newOwnerPub: number[]): number[] {
  if (newOwnerPub.length !== 33) throw new Error('swapEditionOwner: owner pubkey must be 33 bytes')
  const out = [...lockBytes]
  for (let i = 0; i < 33; i++) out[EDITION_OWNER_SCRIPT_OFFSET + i] = newOwnerPub[i]
  return out
}

/**
 * Byte offset of the 32-byte tx1Ref (Collection ID) within the edition locking script:
 * P(2) + ver(2) + record(2) + push-opcode(1) = 7 (the 32 ref bytes sit at [7, 39)).
 */
export const EDITION_TX1REF_SCRIPT_OFFSET = 7

/**
 * Reconstruct a holder's exact edition locking script from a collection's covenant TEMPLATE.
 *
 * Every edition of a collection shares one covenant body — identical stateData (immutable storefront),
 * fees, and tokenSats — differing only in the two identity fields the covenant fills in: tx1Ref (the
 * Collection ID, at offset 7) and the owner pubkey (at offset 40). TX1 commits that template with both
 * zeroed. So splicing a real tx1Ref + owner into the template bytes yields the byte-for-byte script of
 * that holder's edition — which is exactly what genesis/replicate produce. This makes the holder's
 * edition deterministically derivable (and thus its UTXO findable by script hash) without any history walk.
 */
export function buildHolderEditionScript(templateCovenantBytes: number[], tx1Ref: number[], ownerPub: number[]): number[] {
  if (tx1Ref.length !== 32) throw new Error('buildHolderEditionScript: tx1Ref must be 32 bytes')
  if (ownerPub.length !== 33) throw new Error('buildHolderEditionScript: owner pubkey must be 33 bytes')
  const out = [...templateCovenantBytes]
  for (let i = 0; i < 32; i++) out[EDITION_TX1REF_SCRIPT_OFFSET + i] = tx1Ref[i]
  for (let i = 0; i < 33; i++) out[EDITION_OWNER_SCRIPT_OFFSET + i] = ownerPub[i]
  return out
}

/** Extract the 33-byte owner pubkey from an edition locking script. */
export function editionOwnerPubKey(lockBytes: number[]): number[] {
  return lockBytes.slice(EDITION_OWNER_SCRIPT_OFFSET, EDITION_OWNER_SCRIPT_OFFSET + 33)
}

export interface ParsedEdition {
  /** Collection id = TX1 txid (hex). */
  tx1RefHex: string
  /** 33-byte owner pubkey (hex). */
  ownerPubKeyHex: string
  /** v2: the reseller's set price (sats), read from the 8-byte price field. */
  priceSats: number
  stateDataHex: string
  /** Economic terms recovered from the covenant body (no out-of-band data needed). */
  terms: { creatorPubKeyHash: number[]; creatorFeeSats: number; holderFeeSats: number }
}

function chunkBytes(c: ScriptChunk): number[] | null {
  if (c.data != null && c.data.length > 0) return c.data
  if (c.op === OP.OP_0) return []
  if (c.op >= 0x51 && c.op <= 0x60) return [c.op - 0x50] // OP_1..OP_16
  if (c.op === OP.OP_1NEGATE) return [0x81]
  return null
}
function leToNum(b: number[]): number {
  let n = 0
  for (let i = b.length - 1; i >= 0; i--) n = n * 256 + b[i]
  return n
}

/**
 * Parse an edition covenant locking script into its data fields + economic terms, or null if the
 * script is not a PHAR LAP edition. The terms are recovered from the covenant body itself (the
 * creator-fee and holder-fee output constants), so a recipient can replicate/transfer with no
 * out-of-band metadata. Structural parse only — lineage/authenticity is a separate verify step.
 */
export function parseEditionScript(script: LockingScript): ParsedEdition | null {
  const ch = script.chunks
  if (ch == null || ch.length < 11) return null
  const P = chunkBytes(ch[0]); const ver = chunkBytes(ch[1]); const rec = chunkBytes(ch[2])
  const tx1Ref = chunkBytes(ch[3]); const ownerPub = chunkBytes(ch[4])
  const price = chunkBytes(ch[5]); const stateData = chunkBytes(ch[6]) ?? []
  if (P == null || P.length !== 1 || P[0] !== 0x50) return null
  if (ver == null || ver[0] !== 0x03) return null
  if (rec == null || rec[0] !== RECORD_EDITION) return null
  if (tx1Ref == null || tx1Ref.length !== 32) return null
  if (ownerPub == null || ownerPub.length !== 33) return null
  if (price == null || price.length !== 8) return null
  if (ch[7].op !== OP.OP_2DROP || ch[8].op !== OP.OP_2DROP || ch[9].op !== OP.OP_2DROP || ch[10].op !== OP.OP_DROP) return null
  // Recover fees/creator from the OUT2 (34B) and C3pre (12B) constants — both carry the P2PKH
  // signature 0x19 0x76 0xa9 0x14 (varint(25) ‖ OP_DUP OP_HASH160 PUSH20) at offset 8.
  let creatorFeeSats = 0, holderFeeSats = 0
  let creatorPubKeyHash: number[] | null = null
  const isP2pkhValue = (d: number[]) => d[8] === 0x19 && d[9] === 0x76 && d[10] === 0xa9 && d[11] === 0x14
  for (const c of ch) {
    const d = chunkBytes(c)
    if (d == null) continue
    if (d.length === 34 && isP2pkhValue(d)) { creatorFeeSats = leToNum(d.slice(0, 8)); creatorPubKeyHash = d.slice(12, 32) }
    else if (d.length === 12 && isP2pkhValue(d)) { holderFeeSats = leToNum(d.slice(0, 8)) }
  }
  if (creatorPubKeyHash == null) return null
  return {
    tx1RefHex: Utils.toHex(tx1Ref), ownerPubKeyHex: Utils.toHex(ownerPub), priceSats: leToNum(price),
    stateDataHex: Utils.toHex(stateData), terms: { creatorPubKeyHash, creatorFeeSats, holderFeeSats },
  }
}

export interface ParsedEditionV2 {
  tx1RefHex: string
  ownerPubKeyHex: string
  /** The reseller's set price (sats). */
  priceSats: number
  stateDataHex: string
  /** v2 terms recovered from the covenant body: creator address + fee basis points (no fixed amounts). */
  terms: { creatorPubKeyHash: number[]; cBps: number }
}

/**
 * Parse a v2 (percentage-pricing) edition covenant. A v2 lock bakes NO fixed fee amounts — instead a 26-byte
 * creator-P2PKH constant (`19 76 a9 14 ‖ hash(20) ‖ 88 ac`) and the `<cBps> OP_MUL <10000> OP_DIV` split
 * pattern — so we recover the creator hash + cBps from those. Version byte = 0x04. Returns null if not a v2
 * edition (use parseEditionScript for v1).
 */
export function parseEditionScriptV2(script: LockingScript): ParsedEditionV2 | null {
  const ch = script.chunks
  if (ch == null || ch.length < 11) return null
  const P = chunkBytes(ch[0]); const ver = chunkBytes(ch[1]); const rec = chunkBytes(ch[2])
  const tx1Ref = chunkBytes(ch[3]); const ownerPub = chunkBytes(ch[4])
  const price = chunkBytes(ch[5]); const stateData = chunkBytes(ch[6]) ?? []
  if (P == null || P.length !== 1 || P[0] !== 0x50) return null
  if (ver == null || ver[0] !== EDITION_VERSION_V2) return null
  if (rec == null || rec[0] !== RECORD_EDITION) return null
  if (tx1Ref == null || tx1Ref.length !== 32) return null
  if (ownerPub == null || ownerPub.length !== 33) return null
  if (price == null || price.length !== 8) return null
  if (ch[7].op !== OP.OP_2DROP || ch[8].op !== OP.OP_2DROP || ch[9].op !== OP.OP_2DROP || ch[10].op !== OP.OP_DROP) return null

  let creatorPubKeyHash: number[] | null = null
  let cBps: number | null = null
  for (let i = 0; i < ch.length; i++) {
    const d = chunkBytes(ch[i])
    // creator P2PKH constant: 19 76 a9 14 <hash20> 88 ac (26 bytes)
    if (d != null && d.length === 26 && d[0] === 0x19 && d[1] === 0x76 && d[2] === 0xa9 && d[3] === 0x14 && d[24] === 0x88 && d[25] === 0xac) {
      creatorPubKeyHash = d.slice(4, 24)
    }
    // split pattern: <cBps> OP_MUL <10000=10 27> OP_DIV
    if (ch[i + 1]?.op === OP.OP_MUL && ch[i + 3]?.op === OP.OP_DIV) {
      const tenK = chunkBytes(ch[i + 2])
      const cb = chunkBytes(ch[i])
      if (tenK != null && tenK.length === 2 && tenK[0] === 0x10 && tenK[1] === 0x27 && cb != null) cBps = leToNum(cb)
    }
  }
  if (creatorPubKeyHash == null || cBps == null) return null
  return {
    tx1RefHex: Utils.toHex(tx1Ref), ownerPubKeyHex: Utils.toHex(ownerPub), priceSats: leToNum(price),
    stateDataHex: Utils.toHex(stateData), terms: { creatorPubKeyHash, cBps },
  }
}

export interface ParsedEditionAny {
  tx1RefHex: string
  ownerPubKeyHex: string
  /** v2 only: the reseller's set price (sats); 0 for v1. */
  priceSats: number
  stateDataHex: string
  /** True if a v2 (percentage-pricing) edition. */
  isV2: boolean
  /** Unified terms: fixed fees for v1 (cBps=0), or cBps for v2 (fee amounts 0). */
  terms: { creatorPubKeyHash: number[]; creatorFeeSats: number; holderFeeSats: number; cBps: number }
}

/** Parse an edition covenant of EITHER version (v2 first, then v1). Lets callers handle both transparently. */
export function parseEditionAny(script: LockingScript): ParsedEditionAny | null {
  const v2 = parseEditionScriptV2(script)
  if (v2 != null) {
    return {
      tx1RefHex: v2.tx1RefHex, ownerPubKeyHex: v2.ownerPubKeyHex, priceSats: v2.priceSats,
      stateDataHex: v2.stateDataHex, isV2: true,
      terms: { creatorPubKeyHash: v2.terms.creatorPubKeyHash, creatorFeeSats: 0, holderFeeSats: 0, cBps: v2.terms.cBps },
    }
  }
  const v1 = parseEditionScript(script)
  if (v1 != null) {
    return {
      tx1RefHex: v1.tx1RefHex, ownerPubKeyHex: v1.ownerPubKeyHex, priceSats: 0,
      stateDataHex: v1.stateDataHex, isV2: false, terms: { ...v1.terms, cBps: 0 },
    }
  }
  return null
}

/** Unlock for a permissionless replicate (no signature): [ buyerChange, buyerPub, OP_0, preimage ]. */
export function editionReplicateUnlockChunks(p: {
  buyerPubKey: number[]; buyerChange: number[]; preimage: number[]
}): ScriptChunk[] {
  return [pushData(p.buyerChange), pushData(p.buyerPubKey), op(OP.OP_0), pushData(p.preimage)]
}

/** Unlock for an owner-signed transfer: [ change, newOwnerPub, ownerSig, OP_1, preimage ]. */
export function editionTransferUnlockChunks(p: {
  newOwnerPubKey: number[]; ownerSig: number[]; change: number[]; preimage: number[]
}): ScriptChunk[] {
  return [pushData(p.change), pushData(p.newOwnerPubKey), pushData(p.ownerSig), op(OP.OP_1), pushData(p.preimage)]
}

/**
 * L1 covenant body. Stack on entry (top last): [ spenderOutputs, preimage ].
 *   - `spenderOutputs` = serialized trailing outputs the spender is free to choose (their change).
 *   - `preimage`       = the sighash preimage of this input.
 * Leaves a boolean: true iff the spending tx's outputs are exactly
 *   `enforcedPrefixBytes ‖ spenderOutputs`.
 */
export function outputPrefixCovenantOps(enforcedPrefixBytes: number[], c: PushTxConstants = pushTxConstants()): ScriptChunk[] {
  return [
    ...pushTxVerifyOps(c),        // [ spenderOutputs, preimage ]  (preimage verified genuine)
    ...extractHashOutputsOps(),   // [ spenderOutputs, hashOutputs ]
    op(OP.OP_SWAP),               // [ hashOutputs, spenderOutputs ]
    pushData(enforcedPrefixBytes),// [ hashOutputs, spenderOutputs, prefix ]
    op(OP.OP_SWAP), op(OP.OP_CAT),// [ hashOutputs, prefix ‖ spenderOutputs ]
    op(OP.OP_HASH256),            // [ hashOutputs, HASH256(expected) ]
    op(OP.OP_EQUAL),              // [ bool ]
  ]
}
