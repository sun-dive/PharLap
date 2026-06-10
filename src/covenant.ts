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
import { OP, type ScriptChunk } from '@bsv/sdk'
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
export function replicateBranchOps(p: ReplicateParams): ScriptChunk[] {
  const c = p.c ?? pushTxConstants()
  const VALUE1 = u64le(p.tokenSats ?? 1)
  const OUT2 = serializeOutput(p.creatorFeeSats, p2pkhScript(p.creatorPubKeyHash)) // constant
  const C3pre = [...u64le(p.holderFeeSats), 0x19, 0x76, 0xa9, 0x14] // value ‖ varint(25) ‖ OP_DUP OP_HASH160 PUSH20
  const C3suf = [0x88, 0xac]                                        // OP_EQUALVERIFY OP_CHECKSIG
  return [
    ...pushTxVerifyOps(c),                                       // [ change, buyerPub, preimage ]
    op(OP.OP_DUP),
    ...extractHashOutputsOps(), op(OP.OP_TOALTSTACK),            // alt:[hashOutputs]; [ change, buyerPub, preimage ]
    ...extractScriptCodeFieldOps(),                             // [ change, buyerPub, scFld ]
    pushData(numLE(p.fieldPubkeyOffset)), op(OP.OP_SPLIT),      // [ change, buyerPub, pre, holderPub‖suffix ]
    pushData([33]), op(OP.OP_SPLIT),                            // [ change, buyerPub, pre, holderPub, suffix ]
    // out0 = VALUE1 ‖ pre ‖ holderPub ‖ suffix (token back to holder, verbatim)
    pushData(VALUE1),
    pushData([3]), op(OP.OP_PICK), op(OP.OP_CAT),               // ‖ pre
    pushData([2]), op(OP.OP_PICK), op(OP.OP_CAT),               // ‖ holderPub
    pushData([1]), op(OP.OP_PICK), op(OP.OP_CAT),               // ‖ suffix → out0
    // out1 = VALUE1 ‖ pre ‖ buyerPub ‖ suffix (replica to buyer)
    pushData(VALUE1),
    pushData([4]), op(OP.OP_PICK), op(OP.OP_CAT),               // ‖ pre
    pushData([5]), op(OP.OP_PICK), op(OP.OP_CAT),               // ‖ buyerPub
    pushData([2]), op(OP.OP_PICK), op(OP.OP_CAT),               // ‖ suffix → out1
    op(OP.OP_CAT),                                              // out0 ‖ out1
    pushData(OUT2), op(OP.OP_CAT),                              // ‖ out2 (creator fee, constant)
    pushData(C3pre), op(OP.OP_CAT),                            // ‖ holder-fee value+script-prefix
    pushData([2]), op(OP.OP_PICK), op(OP.OP_HASH160), op(OP.OP_CAT), // ‖ HASH160(holderPub)
    pushData(C3suf), op(OP.OP_CAT),                            // ‖ holder-fee script-suffix → out3
    pushData([5]), op(OP.OP_ROLL), op(OP.OP_CAT),             // ‖ buyerChange → expected
    op(OP.OP_TOALTSTACK), op(OP.OP_2DROP), op(OP.OP_2DROP),   // stash expected; drop the 4 leftover pieces
    op(OP.OP_FROMALTSTACK), op(OP.OP_HASH256),                // HASH256(expected)
    op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),                  // == hashOutputs
  ]
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
