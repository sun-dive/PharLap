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
